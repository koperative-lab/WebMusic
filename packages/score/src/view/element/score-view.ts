import {bindPlayerToVisualizer, type PlayerBindingHandlers} from '../render/binding';
import {validateScoreViewConfiguration} from '../core/configuration';
import {findSequenceNote} from '../core/note-sequence';
import {
  bindViewPlayer, readViewPlayerScore, readViewPlayerSnapshot,
  type ViewPlayerNote, type ViewPlayerSnapshot,
} from './internal/player-binding';
import {NoteId, isScoreEditorPort, type Score, type ScoreEditorPort, type ScoreInteractionSession,
  type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../core';
import {observeElementSource} from '@webmusic/kernel/element';
import {createScoreViewEditing, scoreDocumentPlaybackCompatible, type ScoreViewEditing} from '../headless/score-editing';
import {mountPianoRollEditor, type PianoRollEditingHandle, type PianoRollEditingOptions} from '../render/piano-roll-editor';
import {createStaffViewEditing, type StaffViewEditing} from '../headless/staff-editing';
import {mountStaffEditor, type StaffEditingHandle} from '../render/staff-editor';
import {createScoreView, type ScoreView} from '../headless/score-view';
import {renderScoreVisualizer} from '../render/score-visualizer';
import type {
  RenderedScoreVisualizer,
  ScoreViewType,
  ScoreViewConfiguration,
  StaffRenderOptions,
  VisualizerRenderOptions,
  WaterfallRenderOptions,
} from '../core/types';
import {HTMLElementBase, boolAttr, cssSizeAttr, defineOnce, numAttr, upgradeProperties} from './base';
import {mountStage, type StageHandle} from '@webmusic/ui/stage';
import {mountStatus, type StatusHandle, type StatusKind} from '@webmusic/ui/status';

const ELEMENT_NOTE_RGB = '51, 51, 51';
const ELEMENT_ACTIVE_NOTE_RGB = '240, 84, 119';

export type {ScoreViewType} from '../core/types';
export type {ScoreViewConfiguration, ScoreViewOptionsByType} from '../core/types';

/** `<score-view>` draws exactly the three renderer types. */
export type ScoreViewElementType = ScoreViewType;

/**
 * Every render option `<score-view>` can forward — the union of the three
 * views' option bags. Keys that a view does not understand are ignored by its
 * renderer, so one bag can safely describe all three `type`s.
 */
export type ScoreViewRenderOptions = VisualizerRenderOptions & WaterfallRenderOptions & StaffRenderOptions &
  Pick<PianoRollEditingOptions, 'pixelsPerQuarter' | 'editingGrid'>;

/** Numeric layout attributes forwarded to the renderer (kebab → camel). */
const NUMERIC_OPTION_ATTRS: ReadonlyArray<readonly [attr: string, key: keyof ScoreViewRenderOptions]> = [
  // All views: note geometry + horizontal scale + pitch range.
  ['pixels-per-second', 'pixelsPerSecond'],
  ['note-height', 'noteHeight'],
  ['note-spacing', 'noteSpacing'],
  ['min-pitch', 'minPitch'],
  ['max-pitch', 'maxPitch'],
  // Waterfall: pitch-column geometry.
  ['white-note-width', 'whiteNoteWidth'],
  ['black-note-width', 'blackNoteWidth'],
  // Staff: key signature fallback (chromatic pitch class, 0 = C).
  ['default-key', 'defaultKey'],
];

/** Colour attributes forwarded to the renderer as `"r, g, b"` strings. */
const COLOR_OPTION_ATTRS: ReadonlyArray<readonly [attr: string, key: keyof ScoreViewRenderOptions]> = [
  ['note-color', 'noteRGB'],
  ['active-note-color', 'activeNoteRGB'],
];

/** Staff `scroll-type` attribute values → `ScrollType` enum numbers. */
const SCROLL_TYPES: Record<string, number> = {page: 0, note: 1, bar: 2};

/**
 * Parse a colour attribute into the `"r, g, b"` form the renderers expect
 * (they compose `rgba(<noteRGB>, <opacity>)`). Accepts `#rgb` / `#rrggbb`
 * hex, `rgb(r, g, b)`, or a raw `r, g, b` triple. Anything else →
 * `undefined` (the element's built-in skin remains in effect).
 */
export function parseColorAttr(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();

  const hex = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
    return channels.join(', ');
  }

  const triple = value.match(/^(?:rgb\(\s*)?(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i);
  if (triple) {
    const channels = triple.slice(1, 4).map((c) => Math.min(255, Number(c)));
    return channels.join(', ');
  }

  return undefined;
}

/**
 * `<score-view>` — the single WebScore visualization element. The `type`
 * attribute picks the drawing (`piano-roll` by default, `staff` or
 * `waterfall`). Switching it disposes the old presentation and reuses the
 * resolved score.
 *
 * ```html
 * <score-view type="waterfall" src="song.mid"
 *   width="640" height="300" min-pitch="48" max-pitch="84"
 *   note-height="8" note-color="#2563eb" active-note-color="#f59e0b"></score-view>
 * ```
 *
 * Resolves a `Score` from `.score`, `src`, or the selected player's already
 * loaded data (in that order). URL parsing loads the optional I/O stack on
 * demand; `format` forces a parser. Drawing delegates to the package's
 * `render*Visualizer` functions.
 *
 * Every visual knob is customizable per instance, declaratively (attributes)
 * or programmatically (`.options`, which wins on conflict):
 *
 * - **Element size** — `width` / `height` (bare number = px, or any CSS
 *   length). A fixed `height` clips-and-scrolls views taller than it.
 * - **Note geometry** — `note-height`, `note-spacing`, and the horizontal
 *   scale `pixels-per-second`.
 * - **Pitch range** — `min-pitch` / `max-pitch` (MIDI numbers); on
 *   the waterfall, `show-only-octaves-used` trims the columns to the octaves
 *   the score actually uses.
 * - **Pitch-column geometry** (waterfall) — `white-note-width` and
 *   `black-note-width`. Compose a separate `<score-pitch-view>` for a keyboard.
 * - **Colours** — `note-color` / `active-note-color` (hex, `rgb()`, or a raw
 *   `r, g, b` triple).
 * - **Expressions** (staff only) — `show-annotations` (default true) shows
 *   supported score directions. False removes their space without changing
 *   musical data. Piano roll and waterfall never draw annotations.
 * - **Staff** — `default-key` (chromatic key index), `scroll-type`
 *   (`page` · `note` · `bar`), and `split-staves` (default true; false combines
 *   source staves within each part).
 *
 * All numeric attributes are NaN-safe: absent, empty or non-numeric values
 * fall back to the renderer default instead of poisoning the layout.
 *
 * Set `player="#id"` to bind the view to a `<score-player>`: the view
 * follows its initial and subsequent nominal position, including paused seeks
 * and rate changes. Event-only note sources retain their note-on/off behavior.
 * The structural binding never imports the Play implementation.
 */
export class ScoreViewElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return [
      'src',
      'format',
      'player',
      'editable',
      'type',
      'width',
      'height',
      'show-annotations',
      'show-only-octaves-used',
      'scroll-type',
      'split-staves',
      ...NUMERIC_OPTION_ATTRS.map(([attr]) => attr),
      ...COLOR_OPTION_ATTRS.map(([attr]) => attr),
    ];
  }

  private explicitScore?: Score;
  private explicitEditor?: ScoreEditorPort;
  private explicitInteractionSession?: ScoreInteractionSession;
  private editing?: ScoreViewEditing;
  private editorBindingCleanup?: () => void;
  private editorStateCleanup?: () => void;
  private editorGeneration = 0;
  private editorResolutionRevision = 0;
  private editorSurface?: PianoRollEditingHandle | StaffEditingHandle;
  /** Lives for one editor attachment; `detachEditor` releases it. */
  private staffEditing?: StaffViewEditing;
  private staffInputArmed = false;
  private documentPlayback?: ScorePlaybackSnapshot;
  /** The score currently rendered, whether assigned or loaded from `src`. */
  private resolvedScore?: Score;
  private explicitOptions?: ScoreViewRenderOptions;
  private loadToken = 0;
  private loadController?: AbortController;
  private boundPlayer?: Element;
  private playerUnbind?: () => void;
  private lastSnapshot?: ViewPlayerSnapshot;
  private visualizerHandlers?: PlayerBindingHandlers;
  private renderedUnbind?: () => void;
  private rendered?: RenderedScoreVisualizer;
  private view?: ScoreView;
  private stage?: StageHandle;
  private status?: StatusHandle;
  private loading = false;
  private loadError?: unknown;
  private playheadSeconds = 0;
  private presentationRevision = 0;
  private snapshotRevision = 0;
  private sourceInitialized = false;
  private sourceInput?: Score | string;
  private sourceFormat?: string;
  private ownedSizes = new Map<string, string>();

  connectedCallback(): void {
    upgradeProperties(this, ['score', 'options', 'type', 'editor', 'editable', 'interactionSession']);
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

  attributeChangedCallback(name: string): void {
    if (!this.isConnected || !ScoreViewElement.observedAttributes.includes(name)) return;
    if (name === 'player') this.bindPlayer();
    else if (name === 'editable') { this.updateEditable(); this.renderCurrent(); }
    // In editor mode only an added or removed src (a conflict) matters; format alone keeps the session.
    else if (name === 'src' || name === 'format') { if (this.hasEditorIntent()) { if (name === 'src') this.bindEditor(); } else void this.refresh(); }
    else if (name === 'width' || name === 'height') this.applyHostSize();
    else { if (name === 'type') this.updateEditable(); this.renderCurrent(); }
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
  set editable(value: boolean) { if (value) this.setAttribute('editable', ''); else this.removeAttribute('editable'); }
  get editable(): boolean { return boolAttr(this, 'editable', false); }
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

  /** Current position on the nominal score timeline, in seconds. */
  get currentTime(): number {
    return this.view?.state.currentTime ?? this.playheadSeconds;
  }

  /** MIDI pitches intersecting the current score position, ascending. */
  get active(): number[] {
    if (this.editing && scoreDocumentPlaybackCompatible(this.editing.state.document, this.documentPlayback)) {
      return [...new Set(this.documentPlayback!.activeNotes.flatMap((note) => {
        const pitch = this.editing!.state.document.content.getNote(NoteId(note.noteId))?.pitch;
        return pitch ? [pitch.midi] : [];
      }))].sort((a, b) => a - b);
    }
    return [...new Set(this.view?.state.activeNotes.map((note) => note.pitch) ?? [])].sort((a, b) => a - b);
  }

  /** Renderer options merged over the attributes (property wins). */
  set options(options: ScoreViewRenderOptions | undefined) {
    this.explicitOptions = options;
    if (this.isConnected) this.renderCurrent();
  }

  get options(): ScoreViewRenderOptions | undefined {
    return this.explicitOptions;
  }

  /**
   * Set mode and compatible options together. Invalid configuration throws before
   * changing this view. Replaces `.options`; attribute defaults still apply.
   * The legacy `.options` property remains permissive for existing callers.
   */
  configure(configuration: ScoreViewConfiguration): void {
    validateScoreViewConfiguration(configuration);
    const options = configuration.options ? {...configuration.options} : undefined;
    this.explicitOptions = options;
    if (this.getAttribute('type') !== configuration.type) {
      this.setAttribute('type', configuration.type);
    } else if (this.isConnected) {
      this.renderCurrent();
    }
  }

  /** Reflects the `type` attribute; unknown values fall back to `piano-roll`. */
  get type(): ScoreViewElementType {
    const raw = this.getAttribute('type');
    return raw === 'staff' || raw === 'waterfall' ? raw : 'piano-roll';
  }

  set type(type: ScoreViewElementType) {
    this.setAttribute('type', type);
  }

  private async refresh(): Promise<void> {
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
    const native = (this.boundPlayer as (Element & {playback?: ScorePlaybackSource}) | undefined)?.playback?.snapshot();
    if (native && native.readiness !== 'unavailable' && native.score && score !== native.score) {
      this.lastSnapshot = undefined;
      this.setAttribute('data-player-state', 'mismatched');
    }
    this.playheadSeconds = score ? this.lastSnapshot?.nominalSeconds ?? 0 : 0;
    this.renderCurrent(false);
  }

  private disposePresentation(): number {
    const revision = ++this.presentationRevision;
    // Staff input settings belong to the editor attachment and survive presentation re-renders.
    const surface = this.editorSurface;
    const binding = this.renderedUnbind;
    const rendered = this.rendered, view = this.view, stage = this.stage, status = this.status;
    this.staffInputArmed = surface !== undefined && surface.surface.dataset.inputEnabled === 'true';
    this.editorSurface = undefined;
    this.renderedUnbind = undefined;
    this.visualizerHandlers = undefined;
    this.rendered = undefined;
    this.view = undefined;
    this.stage = undefined;
    this.status = undefined;
    // A draft cancellation can synchronously mount a newer presentation. Clear
    // only this lifetime's DOM before invoking its captured cleanup callbacks.
    this.replaceChildren();
    const failures: unknown[] = [];
    for (const cleanup of [() => binding?.(), () => surface?.dispose(),
      () => rendered?.dispose?.(), () => view?.dispose(),
      () => stage?.destroy(), () => status?.destroy()]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    for (const error of failures.slice(1)) console.error('[WebScore] Score View presentation cleanup failed', error);
    if (failures.length) throw failures[0];
    return revision;
  }

  private renderCurrent(preservePosition = true): void {
    if (preservePosition) this.playheadSeconds = this.currentTime;
    const generation = this.editorGeneration;
    const revision = this.disposePresentation();
    if (revision !== this.presentationRevision || generation !== this.editorGeneration) return;
    this.applyHostSize();
    const score = this.resolvedScore;
    const type = this.type;
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
      ? (this.boundPlayer as (Element & {playback?: ScorePlaybackSource}) | undefined)?.playback?.snapshot()
      : undefined;
    if (this.loading || native?.readiness === 'loading') {
      if (owner) this.showStatus('loading', 'Loading score');
      return;
    }
    const sourceError = this.loadError ?? (native?.readiness === 'error' ? native.error ?? new Error('Could not load playback source.') : undefined);
    if (sourceError !== undefined) {
      if (owner) this.showStatus('error', this.errorMessage(sourceError));
      return;
    }
    if (!score) {
      // A missing, loading or disposed editor is pending; only an unusable selection is an error.
      const blocked = this.hasEditorIntent() ? this.blockedEditorState() : undefined;
      if (owner) this.showStatus(this.loadError === undefined && !blocked ? 'waiting' : 'error',
        this.loadError !== undefined ? this.errorMessage(this.loadError) : blocked ? `Editor unavailable: ${blocked}` : 'Waiting for a score');
      return;
    }
    if (this.editing && type === 'piano-roll' && owner) {
      try {
        this.editorSurface = mountPianoRollEditor(this, this.editing, {...this.renderOptions(),
          onPreview: (result) => this.dispatchEvent(new CustomEvent('editpreview', {detail: result, bubbles: true, composed: true})),
          onCommit: (result) => this.dispatchEvent(new CustomEvent('editcommit', {detail: result, bubbles: true, composed: true})),
          onError: (error) => this.dispatchEvent(new CustomEvent('editerror', {detail: {error}, bubbles: true, composed: true})),
        });
        this.editorSurface.updatePlayback(this.documentPlayback);
      } catch (error) {
        this.setAttribute('data-editable-state', 'unavailable');
        this.showStatus('error', this.errorMessage(error));
      }
      return;
    }
    if (this.editing && type === 'staff' && this.editable && owner) {
      try {
        // Reuse the attachment's controller so cursor, voice, staff, duration and spelling persist.
        this.staffEditing ??= createStaffViewEditing(this.editing);
        this.editorSurface = mountStaffEditor(this, this.staffEditing, {...this.renderOptions(), inputEnabled: this.staffInputArmed,
          onCommit: (result) => this.dispatchEvent(new CustomEvent('editcommit', {detail: result, bubbles: true, composed: true})),
          onError: (error) => this.dispatchEvent(new CustomEvent('editerror', {detail: {error}, bubbles: true, composed: true})),
        });
        this.editorSurface.updatePlayback(this.documentPlayback);
      } catch (error) {
        this.setAttribute('data-editable-state', 'unavailable');
        this.showStatus('error', this.errorMessage(error));
      }
      return;
    }
    const blocked = this.hasEditorIntent() && !this.editing ? this.blockedEditorState() : undefined;
    if (blocked && owner) this.showStatus('error', `Editor unavailable: ${blocked}`);
    this.view = createScoreView(score, {type});
    if (owner && !this.view.sequence.notes.length) {
      this.view.dispose();
      this.view = undefined;
      this.showStatus('empty', 'No notes to display');
      return;
    }
    if (!owner) {
      this.replaceChildren();
      this.rendered = this.renderScore(score, this as unknown as HTMLElement, type);
      this.rebindRendered(this.rendered);
      return;
    }
    let failed = false;
    let failure: unknown;
    this.stage = mountStage(
      this,
      {render: (surface) => { this.rendered = this.renderScore(score, surface, type); }},
      {
        label: 'Score visualization', fill: true, overflow: 'auto',
        onError: (error) => { failed = true; failure = error; },
      },
    );
    // Theme the public stage handle without shadowing inherited presenter tokens.
    this.stage.element.style.background = 'var(--wm-score-view-background, var(--wm-stage-background, var(--wm-stage-surface-background, var(--wm-component-background, var(--wm-surface, light-dark(#fff, #111))))))';
    if (failed) {
      this.stage.destroy();
      this.stage = undefined;
      this.rendered?.dispose?.();
      this.rendered = undefined;
      this.view.dispose();
      this.view = undefined;
      this.showStatus('error', this.errorMessage(failure));
      return;
    }
    this.rebindRendered(this.rendered);
  }

  private cancelLoad(): void {
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
  private applyHostSize(): void {
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

  private renderScore(score: Score, surface: HTMLElement, type: ScoreViewType): RenderedScoreVisualizer {
    const options = this.renderOptions();
    // Only the staff draws score annotations; the other renderers never receive the switch.
    if (type !== 'staff') delete options.showAnnotations;
    if (type !== 'waterfall') return renderScoreVisualizer(score, surface, type, options);
    return renderScoreVisualizer(score, surface, type, {
      ...options,
      fitToWidth: true,
      showOnlyOctavesUsed: options.showOnlyOctavesUsed ?? true,
    });
  }

  /** An editor selection that is unusable rather than pending, if any. */
  private blockedEditorState(): string | undefined {
    const state = this.getAttribute('data-editor-state');
    return state === 'invalid' || state === 'ambiguous' || state === 'source-conflict' ? state : undefined;
  }

  private showStatus(kind: StatusKind, message: string): void {
    this.status?.destroy();
    this.status = mountStatus(this, {snapshot: () => ({kind, message})});
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Attribute-derived render options, overridden by `.options`. */
  private renderOptions(): ScoreViewRenderOptions {
    const options: Record<string, unknown> = {
      noteRGB: ELEMENT_NOTE_RGB,
      activeNoteRGB: ELEMENT_ACTIVE_NOTE_RGB,
      noteColor: 'var(--wm-score-view-note, var(--wm-foreground, light-dark(#333, #ddd)))',
      activeNoteColor: 'var(--wm-score-view-active-note, var(--wm-accent, rgb(240, 84, 119)))',
    };

    for (const [attr, key] of NUMERIC_OPTION_ATTRS) {
      if (this.getAttribute(attr) == null) continue;
      const value = numAttr(this, attr, Number.NaN);
      if (Number.isFinite(value)) options[key] = value;
    }

    for (const [attr, key] of COLOR_OPTION_ATTRS) {
      const value = parseColorAttr(this.getAttribute(attr));
      if (value !== undefined) {
        options[key] = value;
        delete options[key === 'noteRGB' ? 'noteColor' : 'activeNoteColor'];
      }
    }

    if (this.getAttribute('show-only-octaves-used') != null) {
      options.showOnlyOctavesUsed = boolAttr(this, 'show-only-octaves-used');
    }
    if (this.getAttribute('show-annotations') != null) {
      options.showAnnotations = boolAttr(this, 'show-annotations');
    }
    if (this.getAttribute('split-staves') != null) {
      options.splitStaves = boolAttr(this, 'split-staves');
    }

    const scrollType = this.getAttribute('scroll-type')?.trim().toLowerCase();
    if (scrollType && scrollType in SCROLL_TYPES) {
      options.scrollType = SCROLL_TYPES[scrollType];
    }

    if (this.explicitOptions?.noteRGB !== undefined) delete options.noteColor;
    if (this.explicitOptions?.activeNoteRGB !== undefined) delete options.activeNoteColor;
    return {...(options as ScoreViewRenderOptions), ...this.explicitOptions};
  }

  private async resolveScore(input: Score | string | undefined, format: string | undefined, signal: AbortSignal): Promise<Score | undefined> {
    if (typeof input !== 'string') return input;
    try {
      const io = await import('../../io/load');
      const loaded = await io.loadScoreFromUrl(input, {
        ...(format ? {format: format as never} : {}),
        signal,
      });
      return loaded;
    } catch (error) {
      if (signal.aborted) return undefined;
      this.loadError = error;
      console.error('[WebScore] <score-view> failed to load', input, error, '(is @webmusic/score/io installed?)');
      return undefined;
    }
  }

  // ---- Playback sync (player="#id") ----

  private bindPlayer(): void {
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
        this.snapshotRevision += 1;
        this.lastSnapshot = undefined;
        this.documentPlayback = undefined;
        this.editorSurface?.updatePlayback(undefined);
        this.playheadSeconds = 0;
        this.view?.reset();
        this.rendered?.clearActiveNotes();
      },
      end: () => {
        if (this.lastSnapshot) this.view?.seek(this.lastSnapshot.nominalSeconds);
        else this.view?.end();
        this.view?.clearActiveNotes();
        this.rendered?.clearActiveNotes();
        if (!readViewPlayerSnapshot(this.boundPlayer)) this.playheadSeconds = 0;
      },
    });
    if (!this.playerUnbind && !this.explicitScore && !this.getAttribute('src')) void this.refresh();
  }

  private unbindPlayer(): void {
    this.playerUnbind?.();
    this.playerUnbind = undefined;
    this.boundPlayer = undefined;
    this.lastSnapshot = undefined;
    this.documentPlayback = undefined;
    this.editorSurface?.updatePlayback(undefined);
    if (this.hasEditorIntent()) this.setAttribute('data-playback-state', 'unbound');
    this.snapshotRevision += 1;
    this.playheadSeconds = 0;
    this.view?.reset();
    this.rendered?.clearActiveNotes();
  }

  private followNote(note: ViewPlayerNote, on: boolean): void {
    if (this.hasEditorIntent()) return;
    const snapshot = readViewPlayerSnapshot(this.boundPlayer);
    if (snapshot) {
      this.followSnapshot(snapshot);
      return;
    }
    if (note.startTime === undefined || !Number.isFinite(note.startTime) || note.startTime < 0) return;
    if (on) this.visualizerHandlers?.noteOn(note.midi, note.startTime);
    else this.visualizerHandlers?.noteOff(note.midi, note.startTime);
  }

  private followSnapshot(snapshot: ViewPlayerSnapshot): void {
    if (this.hasEditorIntent() && (!this.editing || !scoreDocumentPlaybackCompatible(this.editing.state.document, this.documentPlayback))) return;
    this.snapshotRevision += 1;
    this.lastSnapshot = snapshot;
    this.playheadSeconds = this.resolvedScore ? snapshot.nominalSeconds : 0;
    this.paintPosition(snapshot.nominalSeconds);
  }

  private paintPosition(seconds: number): void {
    if (!this.view || !this.rendered) return;
    const state = this.view.seek(seconds);
    if (this.rendered.redrawAtTime) {
      this.rendered.redrawAtTime(state.currentTime, true);
      return;
    }
    const latest = state.activeNotes[state.activeNotes.length - 1];
    const note = latest ? findSequenceNote(this.rendered.noteSequence, latest.pitch, latest.startTime) : undefined;
    if (note) this.rendered.redraw(note, true);
    else this.rendered.clearActiveNotes();
  }

  /** Keep legacy event-only note binding, then restore the current snapshot. */
  private rebindRendered(rendered: RenderedScoreVisualizer | undefined): void {
    this.renderedUnbind?.();
    this.renderedUnbind = undefined;
    this.visualizerHandlers = undefined;
    if (!rendered) return;
    this.renderedUnbind = bindPlayerToVisualizer(rendered, (handlers) => {
      this.visualizerHandlers = handlers;
      return () => { this.visualizerHandlers = undefined; };
    }, this.view);
    if (this.hasEditorIntent() && (!this.editing || !scoreDocumentPlaybackCompatible(this.editing.state.document, this.documentPlayback))) {
      this.view?.reset(); rendered.clearActiveNotes();
    } else if (this.lastSnapshot) this.followSnapshot(this.lastSnapshot);
    else this.paintPosition(this.playheadSeconds);
  }

  private hasEditorIntent(): boolean { return this.explicitEditor !== undefined; }

  private updateEditable(): void {
    const supported = this.type === 'piano-roll' || this.type === 'staff';
    if (this.editing?.state.available) this.editing.setEditable(this.editable && supported);
    // A passive view has no editable state; `editable` without an editor reports unavailable.
    if (!this.hasEditorIntent() && !this.editable) { this.removeAttribute?.('data-editable-state'); return; }
    this.setAttribute('data-editable-state', !this.editable ? 'readonly' : !supported ? 'unsupported-type' : this.editing?.state.available ? 'ready' : 'unavailable');
  }

  /** Detach the old attachment before releasing anything that can publish. */
  private detachEditor(): () => void {
    const surface = this.editorSurface;
    const staff = this.staffEditing;
    const unsubscribe = this.editorStateCleanup;
    const editing = this.editing;
    this.editorSurface = undefined;
    this.staffEditing = undefined;
    this.editorStateCleanup = undefined;
    this.editing = undefined;
    this.documentPlayback = undefined;
    return () => {
      try { unsubscribe?.(); } finally {
        try { surface?.dispose(); } finally {
          try { staff?.dispose(); } finally { editing?.dispose(); }
        }
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

  private bindEditor(): void {
    const generation = this.unbindEditor();
    const current = () => generation === this.editorGeneration && this.isConnected;
    if (!current()) return;
    if (!this.hasEditorIntent()) { this.removeAttribute?.('data-editor-state'); this.removeAttribute?.('data-playback-state'); this.updateEditable(); this.sourceInitialized = false; if (current()) void this.refresh(); return; }
    this.cancelLoad();
    if (!current()) return;
    if (this.explicitScore !== undefined || this.getAttribute('src') !== null) {
      this.setAttribute('data-editor-state', 'source-conflict'); this.updateEditable(); if (current()) this.renderCurrent(); return;
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
            editable: this.editable && (this.type === 'piano-roll' || this.type === 'staff'), interactionSession: this.explicitInteractionSession,
          });
          if (!attached()) { editing.dispose(); return; }
          this.editing = editing;
          const unsubscribe = editing.subscribe((state) => {
            if (!attached() || editing !== this.editing) return;
            const visibleScore = state.available ? state.interaction.draft?.content ?? state.document.content : undefined;
            const changed = this.resolvedScore !== visibleScore;
            this.resolvedScore = visibleScore;
            this.setAttribute('data-editor-state', state.available ? 'ready' : 'unavailable');
            this.setAttribute('data-editable-state', !this.editable ? 'readonly' : this.type !== 'piano-roll' && this.type !== 'staff' ? 'unsupported-type' : state.available ? 'ready' : 'unavailable');
            if (this.documentPlayback) this.followDocumentPlayback(this.documentPlayback);
            // A disposed or otherwise unavailable editor must not leave its editing surface on screen.
            if (attached() && editing === this.editing && (this.editorSurface ? !state.available : changed || !this.rendered)) this.renderCurrent(false);
          });
          if (attached() && editing === this.editing) this.editorStateCleanup = unsubscribe;
          else { unsubscribe(); editing.dispose(); return; }
        } catch (error) {
          if (!attached()) return;
          this.setAttribute('data-editor-state', 'invalid'); this.loadError = error;
        }
      }
      if (!attached()) return;
      this.updateEditable();
      if (attached() && !this.editorSurface) this.renderCurrent(false);
    });
    if (current()) this.editorBindingCleanup = cleanup; else cleanup();
  }

  private followDocumentPlayback(snapshot: ScorePlaybackSnapshot): void {
    this.documentPlayback = snapshot;
    const compatible = this.editing && scoreDocumentPlaybackCompatible(this.editing.state.document, snapshot);
    const playbackState = compatible ? 'ready' : 'pending';
    if (this.getAttribute('data-playback-state') !== playbackState) this.setAttribute('data-playback-state', playbackState);
    this.editorSurface?.updatePlayback(snapshot);
    if (!compatible) {
      this.lastSnapshot = undefined; this.playheadSeconds = 0;
      this.view?.reset(); this.rendered?.clearActiveNotes(); return;
    }
    this.followSnapshot({nominalSeconds: snapshot.nominalSeconds ?? 0, transportSeconds: snapshot.transportSeconds ?? 0,
      transportDurationSeconds: snapshot.transportDurationSeconds ?? 0, rate: snapshot.rate ?? 1, playing: snapshot.state === 'playing'});
  }
}

/**
 * Register `<score-view>` (or a custom tag). Call once in the browser. A
 * no-op outside the browser and when the tag is already taken. Tree-shakeable:
 * importing the package does not register elements until you invoke this.
 */
export function defineScoreViewElement(tag = 'score-view'): void {
  defineOnce(tag, ScoreViewElement);
}
