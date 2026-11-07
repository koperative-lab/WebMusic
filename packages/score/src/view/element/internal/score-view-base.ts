import {
  bindViewPlayer, readViewPlayerScore, readViewPlayerSnapshot,
  type ViewPlayerNote, type ViewPlayerOwner, type ViewPlayerSnapshot,
} from './player-binding';
import type {ModuleHandle} from '@webmusic/kernel/module';
import {isScoreEditorPort, type Score, type ScoreEditorPort, type ScoreInteractionSession,
  type ScorePlaybackSnapshot} from '../../../core';
import {observeElementSource} from '@webmusic/kernel/element';
import {createScoreViewEditing, scoreDocumentPlaybackCompatible, type ScoreViewEditing} from '../../headless/score-editing';
import {HTMLElementBase, cssSizeAttr} from '../base';
import {mountStatus, type StatusHandle, type StatusKind} from '@webmusic/ui/status';

/** Attributes every score View Element observes for its data, playback and size. */
export const SCORE_VIEW_BASE_ATTRIBUTES = Object.freeze(['src', 'format', 'input', 'port', 'width', 'height']);

/**
 * Data, playback and editor binding shared by the score View Elements. A
 * subclass owns its presentation: what it draws, how it follows time and
 * whether the borrowed editor is editable there.
 */
export abstract class ScoreViewElementBase extends HTMLElementBase {
  protected explicitScore?: Score;
  protected explicitEditor?: ScoreEditorPort;
  protected explicitInteractionSession?: ScoreInteractionSession;
  protected editing?: ScoreViewEditing;
  private editorBindingCleanup?: () => void;
  private editorStateCleanup?: () => void;
  protected editorGeneration = 0;
  private editorResolutionRevision = 0;
  protected documentPlayback?: ScorePlaybackSnapshot;
  /** The score currently rendered, whether assigned, loaded from `src` or an editor's visible content. */
  protected resolvedScore?: Score;
  private loadToken = 0;
  private loadController?: AbortController;
  protected boundPlayer?: ViewPlayerOwner;
  private assignedInputModule?: ModuleHandle | null;
  private playerUnbind?: () => void;
  protected lastSnapshot?: ViewPlayerSnapshot;
  protected status?: StatusHandle;
  protected loading = false;
  protected loadError?: unknown;
  protected playheadSeconds = 0;
  protected presentationRevision = 0;
  private sourceInitialized = false;
  private sourceInput?: Score | string;
  private sourceFormat?: string;
  private ownedSizes = new Map<string, string>();

  /** Draw the current state, replacing the previous presentation. */
  protected abstract renderCurrent(preservePosition?: boolean): void;
  /** Release the presentation; returns the new presentation revision. */
  protected abstract disposePresentation(): number;
  /** Paint a nominal position that the base has accepted. */
  protected abstract paintPosition(snapshot: ViewPlayerSnapshot): void;
  /** Clear playback overlays after a reset, unbind or incompatible document snapshot. */
  protected abstract resetPresentationPlayback(): void;
  /** Playback reached its end. */
  protected abstract endPresentationPlayback(): void;
  /** Whether a borrowed editor should accept edits in this presentation. */
  protected editingRequested(): boolean { return false; }
  /** Whether a mounted surface already follows the editing controller itself. */
  protected hasEditingSurface(): boolean { return false; }
  /** Detach any surface that borrows `this.editing`; the returned function releases it. */
  protected releaseEditingSurface(): () => void { return () => {}; }
  /** Editor attachment, availability or editability changed. */
  protected editingStatusChanged(): void {}
  /** An event-only note source without a readable snapshot. */
  protected followEventNote(_note: ViewPlayerNote, _on: boolean): void {}
  /** The editor's visible content or availability changed. */
  protected editingStateChanged(contentChanged: boolean, _available: boolean): void {
    if (contentChanged || !this.hasEditingSurface()) this.renderCurrent(false);
  }

  connectedCallback(): void {
    this.bindEditor();
    this.bindPlayer();
    void this.refresh();
  }

  disconnectedCallback(): void {
    this.cancelLoad();
    const generation = this.unbindEditor();
    if (generation !== this.editorGeneration) return;
    this.unbindPlayer();
    this.disposePresentation();
    this.resolvedScore = undefined;
    this.sourceInitialized = false;
  }

  /** Handle a shared attribute; returns false for subclass attributes. */
  protected handleBaseAttribute(name: string): boolean {
    if (name === 'input' || name === 'port') this.bindPlayer();
    // In editor mode only an added or removed src (a conflict) matters; format alone keeps the session.
    else if (name === 'src' || name === 'format') { if (this.hasEditorIntent()) { if (name === 'src') this.bindEditor(); } else void this.refresh(); }
    else if (name === 'width' || name === 'height') this.applyHostSize();
    else return false;
    return true;
  }

  /**
   * Explicit module input (DEC-068): follow this module's `source` port (or
   * the one `port` names) instead of the `input` selector or the enclosing
   * scope. `null` unbinds; `undefined` returns to discovery.
   */
  get inputModule(): ModuleHandle | null | undefined { return this.assignedInputModule; }
  set inputModule(value: ModuleHandle | null | undefined) {
    if (value === this.assignedInputModule) return;
    this.assignedInputModule = value;
    if (this.isConnected) this.bindPlayer();
  }

  /** Assign a pre-loaded score programmatically (overrides `src`). */
  set score(score: Score | undefined) {
    if (score !== undefined && this.hasEditorIntent()) throw new Error('source-conflict: An editor cannot be combined with an independent score');
    this.explicitScore = score;
    if (this.isConnected) void this.refresh();
  }

  get score(): Score | undefined {
    return this.explicitScore ?? this.resolvedScore;
  }

  /** Borrow a document owner; the caller keeps it. Undefined detaches it. */
  set editor(value: ScoreEditorPort | undefined) {
    if (value !== undefined && !isScoreEditorPort(value)) throw new TypeError('editor must implement ScoreEditorPort');
    if (value !== undefined && (this.explicitScore !== undefined || this.getAttribute('src') !== null)) throw new Error('source-conflict: An editor cannot be combined with score or src');
    if (value && this.explicitInteractionSession && this.explicitInteractionSession.getSnapshot().documentId !== value.getSnapshot().documentId) throw new Error('The interaction session belongs to another document');
    this.explicitEditor = value;
    if (this.isConnected) { this.bindEditor(); this.bindPlayer(); }
  }
  get editor(): ScoreEditorPort | undefined { return this.explicitEditor ?? this.editing?.editor; }

  /** Borrow a same-document selection and draft; otherwise each editor attachment owns one. */
  set interactionSession(value: ScoreInteractionSession | undefined) {
    if (value && this.editor && value.getSnapshot().documentId !== this.editor.getSnapshot().documentId) throw new Error('The interaction session belongs to another document');
    this.explicitInteractionSession = value;
    if (this.isConnected) {
      const generation = this.editorGeneration + 1;
      this.bindEditor();
      // A paused player will not publish again. Restore its current snapshot
      // unless session cleanup superseded this attachment or disconnected us.
      if (this.isConnected && generation === this.editorGeneration) this.bindPlayer();
    }
  }
  get interactionSession(): ScoreInteractionSession | undefined { return this.explicitInteractionSession ?? this.editing?.session; }

  protected async refresh(): Promise<void> {
    if (this.hasEditorIntent()) return;
    const src = this.getAttribute('src');
    const input = this.explicitScore ?? (src || readViewPlayerScore(this.boundPlayer));
    const format = typeof input === 'string' ? this.getAttribute('format') ?? undefined : undefined;
    if (this.sourceInitialized && input === this.sourceInput && format === this.sourceFormat) return;
    this.sourceInitialized = true;
    this.sourceInput = input;
    this.sourceFormat = format;
    this.loadError = undefined;
    this.cancelLoad();
    const token = this.loadToken;
    const controller = new AbortController();
    this.loadController = controller;
    this.loading = typeof input === 'string';
    if (this.loading) this.renderCurrent(false);
    let score: Score | undefined;
    try {
      score = await this.resolveScore(input, format, controller.signal);
    } finally {
      if (this.loadController === controller) this.loadController = undefined;
    }
    if (token !== this.loadToken || !this.isConnected) return; // superseded or detached
    this.loading = false;
    this.resolvedScore = score;
    const native = this.boundPlayer?.playback?.snapshot();
    if (native && native.readiness !== 'unavailable' && native.score && score !== native.score) {
      this.lastSnapshot = undefined;
      this.setAttribute('data-player-state', 'mismatched');
    }
    this.playheadSeconds = score ? this.lastSnapshot?.nominalSeconds ?? 0 : 0;
    this.renderCurrent(false);
  }

  /**
   * Shared render prelude: host size and style, then loading, error and
   * waiting states. Returns the score to draw, or undefined when a status
   * presenter now fills the element.
   */
  protected prepareRender(): {score: Score; owner?: Document} | undefined {
    this.applyHostSize();
    const score = this.resolvedScore;
    const owner = (this as {ownerDocument?: Document}).ownerDocument;
    if (owner) {
      const style = owner.createElement('style');
      const selector = this.localName.replace(/[^a-z0-9-]/gi, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
      style.textContent = `:where(${selector}) { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; }
:where(${selector}:not([hidden])) { display: block; }`;
      this.append(style);
    }
    // An editor-bound view renders document content; its player contributes time only.
    const native = !this.hasEditorIntent() && !this.explicitScore && !this.getAttribute('src')
      ? this.boundPlayer?.playback?.snapshot()
      : undefined;
    if (this.loading || native?.readiness === 'loading') {
      if (owner) this.showStatus('loading', 'Loading score');
      return undefined;
    }
    const sourceError = this.loadError ?? (native?.readiness === 'error' ? native.error ?? new Error('Could not load playback source.') : undefined);
    if (sourceError !== undefined) {
      if (owner) this.showStatus('error', this.errorMessage(sourceError));
      return undefined;
    }
    if (!score) {
      // A missing, loading or disposed editor is pending; only an unusable selection is an error.
      const blocked = this.hasEditorIntent() ? this.blockedEditorState() : undefined;
      if (owner) this.showStatus(this.loadError === undefined && !blocked ? 'waiting' : 'error',
        this.loadError !== undefined ? this.errorMessage(this.loadError) : blocked ? `Editor unavailable: ${blocked}` : 'Waiting for a score');
      return undefined;
    }
    return {score, owner};
  }

  protected cancelLoad(): void {
    this.loadToken += 1;
    this.loading = false;
    const controller = this.loadController;
    this.loadController = undefined;
    controller?.abort();
  }

  /**
   * Reflect the `width` / `height` attributes onto the host box. With a fixed
   * `height`, content taller than the box scrolls vertically inside it
   * (horizontal panning stays inside each view's own scroller).
   */
  protected applyHostSize(): void {
    // `style` exists on any real HTMLElement; the guard is for the SSR-safe
    // base class, which is a plain object in Node.
    const style = (this as {style?: CSSStyleDeclaration}).style;
    if (!style) return;
    const width = cssSizeAttr(this, 'width');
    const height = cssSizeAttr(this, 'height');
    const apply = (property: string, value: string | undefined): void => {
      if (value) {
        style.setProperty(property, value);
        this.ownedSizes.set(property, value);
      } else if (this.ownedSizes.has(property)) {
        if (!style.getPropertyValue || style.getPropertyValue(property) === this.ownedSizes.get(property)) {
          style.removeProperty(property);
        }
        this.ownedSizes.delete(property);
      }
    };
    apply('width', width);
    apply('height', height);
    apply('overflow-y', height ? 'auto' : undefined);
  }

  /** An editor selection that is unusable rather than pending, if any. */
  protected blockedEditorState(): string | undefined {
    const state = this.getAttribute('data-editor-state');
    return state === 'invalid' || state === 'ambiguous' || state === 'source-conflict' ? state : undefined;
  }

  protected showStatus(kind: StatusKind, message: string): void {
    this.status?.destroy();
    this.status = mountStatus(this, {snapshot: () => ({kind, message})});
  }

  protected errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async resolveScore(input: Score | string | undefined, format: string | undefined, signal: AbortSignal): Promise<Score | undefined> {
    if (typeof input !== 'string') return input;
    try {
      const io = await import('../../../io/load');
      const loaded = await io.loadScoreFromUrl(input, {
        ...(format ? {format: format as never} : {}),
        signal,
      });
      return loaded;
    } catch (error) {
      if (signal.aborted) return undefined;
      this.loadError = error;
      console.error(`[WebScore] <${this.localName}> failed to load`, input, error, '(is @webmusic/score/io installed?)');
      return undefined;
    }
  }

  // ---- Playback sync (player="#id") ----

  protected bindPlayer(): void {
    this.unbindPlayer();
    this.playerUnbind = bindViewPlayer(this, {
      // A local draft is not playback data: compare the player with committed document content.
      score: () => this.hasEditorIntent() ? this.editing?.state.document.content : this.explicitScore ?? (this.getAttribute('src') ? this.resolvedScore : undefined),
      ...(this.hasEditorIntent() ? {playbackSnapshot: (snapshot: ScorePlaybackSnapshot) => this.followDocumentPlayback(snapshot)} : {}),
      targetChanged: (target) => {
        this.boundPlayer = target;
      },
      scoreChanged: () => {
        if (!this.hasEditorIntent() && !this.explicitScore && !this.getAttribute('src')) void this.refresh();
      },
      readinessChanged: () => {
        if (!this.hasEditorIntent() && !this.explicitScore && !this.getAttribute('src')) this.renderCurrent(false);
      },
      snapshot: (snapshot) => this.followSnapshot(snapshot),
      noteOn: (note) => this.followNote(note, true),
      noteOff: (note) => this.followNote(note, false),
      reset: () => {
        this.lastSnapshot = undefined;
        this.documentPlayback = undefined;
        this.playheadSeconds = 0;
        this.resetPresentationPlayback();
      },
      end: () => {
        this.endPresentationPlayback();
        if (!readViewPlayerSnapshot(this.boundPlayer)) this.playheadSeconds = 0;
      },
    }, this.assignedInputModule);
    if (!this.playerUnbind && !this.explicitScore && !this.getAttribute('src')) void this.refresh();
  }

  protected unbindPlayer(): void {
    this.playerUnbind?.();
    this.playerUnbind = undefined;
    this.boundPlayer = undefined;
    this.lastSnapshot = undefined;
    this.documentPlayback = undefined;
    if (this.hasEditorIntent()) this.setAttribute('data-playback-state', 'unbound');
    this.playheadSeconds = 0;
    this.resetPresentationPlayback();
  }

  private followNote(note: ViewPlayerNote, on: boolean): void {
    if (this.hasEditorIntent()) return;
    const snapshot = readViewPlayerSnapshot(this.boundPlayer);
    if (snapshot) {
      this.followSnapshot(snapshot);
      return;
    }
    this.followEventNote(note, on);
  }

  protected followSnapshot(snapshot: ViewPlayerSnapshot): void {
    if (this.hasEditorIntent() && !this.documentPlaybackReady()) return;
    this.lastSnapshot = snapshot;
    this.playheadSeconds = this.resolvedScore ? snapshot.nominalSeconds : 0;
    this.paintPosition(snapshot);
  }

  /** Whether the bound player's snapshot addresses the editor's current committed revision. */
  protected documentPlaybackReady(): boolean {
    return Boolean(this.editing && scoreDocumentPlaybackCompatible(this.editing.state.document, this.documentPlayback));
  }

  protected hasEditorIntent(): boolean { return this.explicitEditor !== undefined; }

  /** Detach the old attachment before releasing anything that can publish. */
  private detachEditor(): () => void {
    const releaseSurface = this.releaseEditingSurface();
    const unsubscribe = this.editorStateCleanup;
    const editing = this.editing;
    this.editorStateCleanup = undefined;
    this.editing = undefined;
    this.documentPlayback = undefined;
    return () => {
      try { unsubscribe?.(); } finally {
        try { releaseSurface(); } finally { editing?.dispose(); }
      }
    };
  }

  private unbindEditor(): number {
    const generation = ++this.editorGeneration;
    const discovery = this.editorBindingCleanup;
    this.editorBindingCleanup = undefined;
    const release = this.detachEditor();
    try { discovery?.(); } finally { release(); }
    return generation;
  }

  protected bindEditor(): void {
    const generation = this.unbindEditor();
    const current = () => generation === this.editorGeneration && this.isConnected;
    if (!current()) return;
    if (!this.hasEditorIntent()) { this.removeAttribute?.('data-editor-state'); this.removeAttribute?.('data-playback-state'); this.editingStatusChanged(); this.sourceInitialized = false; if (current()) void this.refresh(); return; }
    this.cancelLoad();
    if (!current()) return;
    if (this.explicitScore !== undefined || this.getAttribute('src') !== null) {
      this.setAttribute('data-editor-state', 'source-conflict'); this.editingStatusChanged(); if (current()) this.renderCurrent(); return;
    }
    // Editors are assigned through `.editor` only; there is no selector attribute.
    const cleanup = observeElementSource<ScoreEditorPort>(this, {source: this.explicitEditor,
      property: 'editor', accepts: isScoreEditorPort}, (resolution) => {
      if (!current()) return;
      // Reentrant sourcechange can replace this resolution without replacing
      // the discovery subscription, so it needs its own attachment revision.
      const revision = ++this.editorResolutionRevision;
      const attached = () => current() && revision === this.editorResolutionRevision;
      this.detachEditor()();
      if (!attached()) return;
      this.setAttribute('data-editor-state', resolution.state);
      this.lastSnapshot = undefined; this.playheadSeconds = 0;
      // Without a ready editor there is no content to show; never keep a previous editor's score.
      if (!resolution.source || resolution.state !== 'ready') this.resolvedScore = undefined;
      if (resolution.source && resolution.state === 'ready') {
        try {
          const editing = createScoreViewEditing(resolution.source, {
            editable: this.editingRequested(), interactionSession: this.explicitInteractionSession,
          });
          if (!attached()) { editing.dispose(); return; }
          this.editing = editing;
          const unsubscribe = editing.subscribe((state) => {
            if (!attached() || editing !== this.editing) return;
            const visibleScore = state.available ? state.interaction.draft?.content ?? state.document.content : undefined;
            const changed = this.resolvedScore !== visibleScore;
            this.resolvedScore = visibleScore;
            this.setAttribute('data-editor-state', state.available ? 'ready' : 'unavailable');
            this.editingStatusChanged();
            if (this.documentPlayback) this.followDocumentPlayback(this.documentPlayback);
            if (attached() && editing === this.editing) this.editingStateChanged(changed, state.available);
          });
          if (attached() && editing === this.editing) this.editorStateCleanup = unsubscribe;
          else { unsubscribe(); editing.dispose(); return; }
        } catch (error) {
          if (!attached()) return;
          this.setAttribute('data-editor-state', 'invalid'); this.loadError = error;
        }
      }
      if (!attached()) return;
      this.editingStatusChanged();
      if (attached() && !this.hasEditingSurface()) this.renderCurrent(false);
    });
    if (current()) this.editorBindingCleanup = cleanup; else cleanup();
  }

  private followDocumentPlayback(snapshot: ScorePlaybackSnapshot): void {
    this.documentPlayback = snapshot;
    const compatible = this.documentPlaybackReady();
    const playbackState = compatible ? 'ready' : 'pending';
    if (this.getAttribute('data-playback-state') !== playbackState) this.setAttribute('data-playback-state', playbackState);
    if (!compatible) {
      this.lastSnapshot = undefined; this.playheadSeconds = 0;
      this.resetPresentationPlayback(); return;
    }
    this.followSnapshot({nominalSeconds: snapshot.nominalSeconds ?? 0, transportSeconds: snapshot.transportSeconds ?? 0,
      transportDurationSeconds: snapshot.transportDurationSeconds ?? 0, rate: snapshot.rate ?? 1, playing: snapshot.state === 'playing'});
  }
}
