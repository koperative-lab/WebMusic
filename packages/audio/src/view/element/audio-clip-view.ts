import {observeCompanionTarget} from './internal/companion-target';
import {observeElementSource} from '@webmusic/kernel/element';
import {mountStatus, type StatusHandle, type StatusKind} from '@webmusic/ui/status';
import {tempoGridJump} from '@webmusic/kernel/transport';
import {audioSequenceTempoGrid, isAudioClipEditorPort, type AudioClip, type AudioClipEditorPort, type AudioDocumentPlaybackBinding,
  type AudioInteractionSession} from '../../core';
import {audioDocumentPlaybackCompatible, createAudioViewEditing, type AudioViewEditing} from '../headless/audio-editing';
import {AUDIO_FADE_CURVES, type AudioFadeCurve} from '../core/clip-edits';
import {
  AUDIO_CLIP_FEATURES, AUDIO_CLIP_SNAPS, mountAudioClip, parseAudioClipFeatures,
  type AudioClipFeature, type AudioClipHandle, type AudioClipOptions, type AudioClipSettings, type AudioClipSnap, type AudioClipTool,
} from '../render/audio-clip';
import {HTMLElementBase, boolAttr, cssSizeAttr, defineOnce, numAttr, upgradeProperties} from './internal/base';

export type {AudioClipFeature, AudioClipSettings, AudioClipSnap, AudioClipTool} from '../render/audio-clip';

/** `detail` of the `clipsettingschange` event. */
export interface AudioClipSettingsChangeDetail {
  readonly settings: AudioClipSettings;
  readonly changed: keyof AudioClipSettings;
}

interface PlayerFacade {
  readonly documentBinding?: AudioDocumentPlaybackBinding;
  readonly seconds?: number;
  readonly currentTime?: number;
  readonly playing?: boolean;
  seek?(seconds: number): unknown;
}

const OBSERVED = ['src', 'format', 'player', 'input', 'width', 'height', 'editable', 'tools', 'tool', 'snap', 'show-envelopes',
  'pixels-per-second', 'amplitude', 'fade-curve', 'follow', 'grid', 'quantize', 'grid-edit'] as const;
/** Attributes the mounted view applies in place; the others remount it. */
const SETTING_ATTRIBUTES = new Set(['tools', 'tool', 'snap', 'show-envelopes', 'pixels-per-second', 'amplitude', 'fade-curve', 'follow',
  'grid', 'quantize', 'grid-edit']);

/**
 * `<audio-clip-view>` — a waveform editor in the manner of Adobe Audition's
 * waveform view and DAW clip editors: a time ruler with markers, one lane per
 * channel, segment boundaries, fade handles, segment gain lines, gain
 * envelopes and a gain HUD.
 *
 * ```html
 * <audio-player id="player"></audio-player>
 * <audio-clip-view player="#player" editable></audio-clip-view>
 * ```
 *
 * It draws `.clip` or `src` read-only, or a borrowed `.editor` (the caller
 * keeps it). Editing needs `.editor` and `editable`; `tools` lists the
 * offered features (default: all) and each edit is one atomic, undoable
 * editor command.
 */
export class AudioClipViewElement extends HTMLElementBase {
  static get observedAttributes(): string[] { return [...OBSERVED]; }

  private explicitClip?: AudioClip;
  private sourceClip?: AudioClip;
  private explicitEditor?: AudioClipEditorPort;
  private explicitInteractionSession?: AudioInteractionSession;
  private editing?: AudioViewEditing;
  private surface?: AudioClipHandle;
  private surfaceEditing?: AudioViewEditing;
  private status?: StatusHandle;
  private editorCleanup?: () => void;
  private editorStateCleanup?: () => void;
  private editorGeneration = 0;
  private playerCleanup?: () => void;
  private playerTarget?: EventTarget;
  private playerGeneration = 0;
  private loadToken = 0;
  private loadController?: AbortController;
  private loading = false;
  private loadError?: unknown;
  private reflecting = false;
  private ownedSizes = new Map<string, string>();

  connectedCallback(): void {
    upgradeProperties(this, ['clip', 'editor', 'interactionSession', 'editable', 'tools', 'tool', 'snap', 'showEnvelopes',
      'pixelsPerSecond', 'amplitude', 'fadeCurve', 'follow', 'grid', 'quantize', 'gridEdit']);
    this.applyHostSize();
    this.bindEditor();
    this.bindPlayer();
    if (!this.hasEditorIntent()) void this.loadSource();
  }

  disconnectedCallback(): void {
    this.cancelLoad();
    this.unbindEditor();
    this.unbindPlayer();
    this.disposePresentation();
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === 'player' || name === 'input') { this.bindPlayer(); return; }
    if (name === 'width' || name === 'height') { this.applyHostSize(); if (name === 'height') this.render(); return; }
    if (name === 'src' || name === 'format') { if (this.hasEditorIntent()) this.bindEditor(); else void this.loadSource(); return; }
    if (name === 'editable') { this.updateEditable(); if (!this.surface) this.render(); return; }
    if (SETTING_ATTRIBUTES.has(name) && this.surface) {
      if (!this.reflecting) {
        // Removing pixels-per-second returns to the initial working zoom.
        const autoZoom = name === 'pixels-per-second' && !this.hasAttribute('pixels-per-second');
        this.surface.configure({...this.attributeSettings(), features: this.tools, followPlayback: this.follow, ...(autoZoom ? {autoZoom} : {})});
      }
      return;
    }
    this.render();
  }

  /** Assign a decoded clip to draw read-only (overrides `src`). */
  set clip(clip: AudioClip | undefined) {
    if (clip !== undefined && this.hasEditorIntent()) throw new Error('source-conflict: An editor cannot be combined with an independent clip');
    this.explicitClip = clip;
    if (this.isConnected) this.render();
  }
  get clip(): AudioClip | undefined { return this.explicitClip ?? this.sourceClip; }

  /** Borrow a document owner; the caller keeps it. Undefined detaches it. */
  set editor(value: AudioClipEditorPort | undefined) {
    if (value !== undefined && !isAudioClipEditorPort(value)) throw new TypeError('editor must implement AudioClipEditorPort');
    if (value !== undefined && (this.explicitClip !== undefined || this.hasAttribute('src'))) throw new Error('source-conflict: An editor cannot be combined with clip or src');
    this.explicitEditor = value;
    if (this.isConnected) { this.bindEditor(); if (!value) void this.loadSource(); }
  }
  get editor(): AudioClipEditorPort | undefined { return this.explicitEditor; }

  /** Borrow a same-document selection and draft; otherwise each editor attachment owns one. */
  set interactionSession(value: AudioInteractionSession | undefined) {
    this.explicitInteractionSession = value;
    if (this.isConnected) this.bindEditor();
  }
  get interactionSession(): AudioInteractionSession | undefined { return this.explicitInteractionSession ?? this.editing?.session; }

  set editable(value: boolean) { if (value) this.setAttribute('editable', ''); else this.removeAttribute('editable'); }
  get editable(): boolean { return boolAttr(this, 'editable', false); }

  /** Offered editing features (`tools` attribute; absent means all, unknown tokens are ignored). */
  set tools(value: readonly AudioClipFeature[]) { this.setAttribute('tools', parseAudioClipFeatures(value.join(' ')).join(' ')); }
  get tools(): AudioClipFeature[] { return parseAudioClipFeatures(this.getAttribute('tools')); }

  /** Pointer tool: `select`, `split` or `envelope`; a tool whose feature is not offered reads as `select`. */
  set tool(value: AudioClipTool) { this.setAttribute('tool', value); }
  get tool(): AudioClipTool {
    const raw = this.getAttribute('tool');
    return (raw === 'split' || raw === 'envelope') && this.tools.includes(raw) ? raw : 'select';
  }

  /** Snap for the cursor and range edges: `off`, `grid` (the snap button), `zero`, `10ms`, `100ms`, `1s`, `beat` or `bar`. */
  set snap(value: AudioClipSnap) { this.setAttribute('snap', value); }
  get snap(): AudioClipSnap {
    const raw = this.getAttribute('snap')?.trim().toLowerCase() as AudioClipSnap | undefined;
    return raw && AUDIO_CLIP_SNAPS.includes(raw) ? raw : 'off';
  }

  /** Draw segment gain envelopes over the waveform. */
  set showEnvelopes(value: boolean) { if (value) this.setAttribute('show-envelopes', ''); else this.removeAttribute('show-envelopes'); }
  get showEnvelopes(): boolean { return boolAttr(this, 'show-envelopes', false); }

  /**
   * Horizontal zoom in pixels per second; 0 fits the clip. Without the
   * attribute the view opens at a working zoom (eight bars of the beat grid,
   * else ten seconds) and the getter returns the mounted zoom.
   */
  set pixelsPerSecond(value: number) { this.setAttribute('pixels-per-second', String(value)); }
  get pixelsPerSecond(): number {
    if (!this.hasAttribute('pixels-per-second')) return this.surface?.settings.pixelsPerSecond ?? 0;
    const value = numAttr(this, 'pixels-per-second', 0);
    return Number.isFinite(value) && value > 0 ? Math.min(48_000, value) : 0;
  }

  /** Vertical waveform magnification, 1–16. */
  set amplitude(value: number) { this.setAttribute('amplitude', String(value)); }
  get amplitude(): number {
    const value = numAttr(this, 'amplitude', 1);
    return Number.isFinite(value) && value > 0 ? Math.min(16, Math.max(1, value)) : 1;
  }

  /** Curve for fades: `linear`, `logarithmic` or `cosine`. */
  set fadeCurve(value: AudioFadeCurve) { this.setAttribute('fade-curve', value); }
  get fadeCurve(): AudioFadeCurve {
    const raw = this.getAttribute('fade-curve')?.trim().toLowerCase() as AudioFadeCurve | undefined;
    return raw && AUDIO_FADE_CURVES.includes(raw) ? raw : 'linear';
  }

  /** Draw the document's beat grid and use it for beat snap, quantize and beat jump. */
  set grid(value: boolean) { if (value) this.setAttribute('grid', ''); else this.removeAttribute('grid'); }
  get grid(): boolean { return boolAttr(this, 'grid', false); }

  /** Ruler seeks land on a beat; a playing player keeps its beat phase. Needs `grid`. */
  set quantize(value: boolean) { if (value) this.setAttribute('quantize', ''); else this.removeAttribute('quantize'); }
  get quantize(): boolean { return boolAttr(this, 'quantize', false); }

  /** Grid Edit mode (needs `editable` and the `grid` feature): grid tools in the toolbar, dragging moves the grid. */
  set gridEdit(value: boolean) { if (value) this.setAttribute('grid-edit', ''); else this.removeAttribute('grid-edit'); }
  get gridEdit(): boolean { return boolAttr(this, 'grid-edit', false) && this.tools.includes('grid'); }

  /** Keep the playhead in view during playback (default true). */
  set follow(value: boolean) { this.setAttribute('follow', String(value)); }
  get follow(): boolean { return boolAttr(this, 'follow', true); }

  /** Visible span in seconds, or undefined before drawing. */
  visibleRange(): {readonly startSeconds: number; readonly endSeconds: number} | undefined { return this.surface?.visibleRange(); }

  // ---- data

  private hasEditorIntent(): boolean { return this.explicitEditor !== undefined; }

  private cancelLoad(): void {
    this.loadToken += 1;
    this.loading = false;
    this.loadController?.abort();
    this.loadController = undefined;
  }

  private async loadSource(): Promise<void> {
    this.cancelLoad();
    this.sourceClip = undefined;
    this.loadError = undefined;
    const src = this.getAttribute('src')?.trim();
    if (!src || this.hasEditorIntent()) { this.render(); return; }
    const token = this.loadToken;
    const controller = new AbortController();
    this.loadController = controller;
    this.loading = true;
    this.render();
    try {
      const play = await import('../../play/api');
      const format = this.getAttribute('format')?.trim();
      const clip = await play.loadClipFromUrl(src, {...(format ? {format: format as never} : {}), signal: controller.signal});
      if (token !== this.loadToken || !this.isConnected) return;
      this.sourceClip = clip;
    } catch (error) {
      if (token !== this.loadToken || !this.isConnected) return;
      this.loadError = error;
    } finally {
      if (token === this.loadToken) { this.loading = false; this.loadController = undefined; }
    }
    if (token === this.loadToken && this.isConnected) this.render();
  }

  private unbindEditor(): void {
    this.editorGeneration += 1;
    const discovery = this.editorCleanup;
    this.editorCleanup = undefined;
    this.detachEditor();
    discovery?.();
  }

  private detachEditor(): void {
    const surface = this.surfaceEditing ? this.surface : undefined;
    if (surface) { this.surface = undefined; this.surfaceEditing = undefined; }
    const unsubscribe = this.editorStateCleanup;
    const editing = this.editing;
    this.editorStateCleanup = undefined;
    this.editing = undefined;
    try { unsubscribe?.(); } finally { try { surface?.dispose(); } finally { editing?.dispose(); } }
  }

  private bindEditor(): void {
    this.unbindEditor();
    const generation = this.editorGeneration;
    const current = () => generation === this.editorGeneration && this.isConnected;
    if (!this.hasEditorIntent()) { this.removeAttribute('data-editor-state'); this.removeAttribute('data-playback-state'); this.updateEditable(); this.render(); return; }
    this.cancelLoad();
    if (this.explicitClip !== undefined || this.hasAttribute('src')) {
      this.setAttribute('data-editor-state', 'source-conflict'); this.updateEditable(); this.render(); return;
    }
    const cleanup = observeElementSource<AudioClipEditorPort>(this, {source: this.explicitEditor, property: 'editor', accepts: isAudioClipEditorPort}, (resolution) => {
      if (!current()) return;
      this.detachEditor();
      this.setAttribute('data-editor-state', resolution.state);
      if (resolution.state === 'ready' && resolution.source) {
        try {
          const editing = createAudioViewEditing(resolution.source, {editable: this.editable, interactionSession: this.explicitInteractionSession});
          this.editing = editing;
          this.editorStateCleanup = editing.subscribe((state) => {
            if (!current() || editing !== this.editing) return;
            this.setAttribute('data-editor-state', state.available ? 'ready' : 'unavailable');
            this.updatePlayback();
            // A mounted surface follows the controller itself; only an unavailable one remounts.
            if (!state.available || !this.surface) this.render();
          });
        } catch (error) {
          this.setAttribute('data-editor-state', 'invalid');
          this.loadError = error;
        }
      }
      this.updateEditable();
      if (current()) this.render();
    });
    if (current()) this.editorCleanup = cleanup; else cleanup();
  }

  private updateEditable(): void {
    if (this.editing?.state.available) this.editing.setEditable(this.editable);
    if (!this.hasEditorIntent() && !this.editable) { this.removeAttribute('data-editable-state'); return; }
    this.setAttribute('data-editable-state', !this.editable ? 'readonly' : this.editing?.state.available ? 'ready' : 'unavailable');
  }

  // ---- playback

  private facade(): PlayerFacade | undefined {
    const target = this.playerTarget as (PlayerFacade & {player?: PlayerFacade}) | undefined;
    return target?.player ?? target;
  }

  private bindPlayer(): void {
    const generation = ++this.playerGeneration;
    this.unbindPlayer();
    // `input` aliases `player`; with neither, the enclosing player scope is followed.
    const cleanup = observeCompanionTarget(this, ['player', 'input'], (target, state) => {
      if (generation !== this.playerGeneration || !this.isConnected) return;
      this.connectPlayer(state === 'ready' ? target : undefined);
    });
    if (generation === this.playerGeneration) {
      const previous = this.playerCleanup;
      this.playerCleanup = () => { previous?.(); cleanup(); };
    } else cleanup();
  }

  private connectPlayer(target: EventTarget | undefined): void {
    this.playerTarget = target;
    if (target) {
      const update = () => this.updatePlayback();
      const events = ['webaudio:timeupdate', 'webaudio:end', 'webaudio:loaded', 'webaudio:documentstatechange', 'webaudio:sourcechange'];
      for (const event of events) target.addEventListener(event, update);
      const previous = this.playerCleanup;
      this.playerCleanup = () => { previous?.(); for (const event of events) target.removeEventListener(event, update); };
    }
    this.updatePlayback();
  }

  private unbindPlayer(): void {
    const cleanup = this.playerCleanup;
    this.playerCleanup = undefined;
    this.playerTarget = undefined;
    cleanup?.();
  }

  private playbackCompatible(): boolean {
    return !this.hasEditorIntent() || Boolean(this.editing && audioDocumentPlaybackCompatible(this.editing.state.document, this.facade()?.documentBinding));
  }

  private updatePlayback(): void {
    const facade = this.facade();
    if (this.hasEditorIntent()) this.setAttribute('data-playback-state', !this.playerTarget ? 'unbound' : this.playbackCompatible() ? 'ready' : 'pending');
    const seconds = facade?.seconds ?? facade?.currentTime;
    this.surface?.updatePlayback({seconds: facade && this.playbackCompatible() && typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null});
  }

  // ---- presentation

  private disposePresentation(): void {
    const surface = this.surface, status = this.status;
    this.surface = undefined;
    this.surfaceEditing = undefined;
    this.status = undefined;
    try { surface?.dispose(); } finally { status?.destroy(); }
    this.replaceChildren();
  }

  private showStatus(kind: StatusKind, message: string): void {
    this.status = mountStatus(this, {snapshot: () => ({kind, message})});
  }

  private render(): void {
    if (!this.isConnected) return;
    this.disposePresentation();
    const owner = (this as {ownerDocument?: Document}).ownerDocument;
    if (!owner) return;
    const style = owner.createElement('style');
    style.textContent = ':where(audio-clip-view) { display: block; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; }';
    this.append(style);
    if (this.hasEditorIntent()) {
      const blocked = this.getAttribute('data-editor-state');
      if (!this.editing?.state.available) {
        this.showStatus(blocked === 'invalid' || blocked === 'source-conflict' ? 'error' : 'waiting',
          blocked === 'source-conflict' ? 'Editor unavailable: source-conflict' : blocked === 'invalid' ? `Editor unavailable: ${this.errorText(this.loadError)}` : 'Waiting for the editor');
        return;
      }
      this.mount({editing: this.editing});
      return;
    }
    if (this.editable) this.setAttribute('data-editable-state', 'unavailable');
    if (this.loading) { this.showStatus('loading', 'Loading audio'); return; }
    if (this.loadError !== undefined) { this.showStatus('error', this.errorText(this.loadError)); return; }
    const clip = this.clip;
    if (!clip) { this.showStatus('waiting', 'Waiting for audio'); return; }
    this.mount({clip});
  }

  private mount(content: {clip: AudioClip} | {editing: AudioViewEditing}): void {
    try {
      this.surface = mountAudioClip(this, content, this.clipOptions());
      this.surfaceEditing = 'editing' in content ? content.editing : undefined;
      this.updatePlayback();
    } catch (error) {
      if (this.hasEditorIntent()) this.setAttribute('data-editable-state', 'unavailable');
      this.showStatus('error', this.errorText(error));
    }
  }

  private errorText(error: unknown): string { return error instanceof Error ? error.message : String(error ?? 'Unknown error'); }

  private attributeSettings(): Partial<AudioClipSettings> {
    return {tool: this.tool, snap: this.snap, envelopes: this.showEnvelopes,
      ...(this.hasAttribute('pixels-per-second') ? {pixelsPerSecond: this.pixelsPerSecond} : {}),
      amplitude: this.amplitude, fadeCurve: this.fadeCurve, grid: this.grid, quantize: this.quantize, gridEdit: this.gridEdit};
  }

  private clipOptions(): AudioClipOptions {
    const height = numAttr(this, 'height', Number.NaN);
    return {
      ...this.attributeSettings(), features: this.tools, followPlayback: this.follow,
      ...(Number.isFinite(height) && height > 0 ? {height: Math.max(60, height - 60)} : {}),
      onPreview: (result) => this.dispatchEvent(new CustomEvent('webaudio:editpreview', {detail: result, bubbles: true, composed: true})),
      onCommit: (result) => this.dispatchEvent(new CustomEvent('webaudio:editcommit', {detail: result, bubbles: true, composed: true})),
      onError: (error) => this.dispatchEvent(new CustomEvent('webaudio:editerror', {detail: {error}, bubbles: true, composed: true})),
      onSeek: (seconds, detail) => this.seekPlayer(seconds, detail?.quantized ?? false),
      onBeatJump: (beats) => this.beatJump(beats),
      onSettingsChange: (settings, changed) => this.reflectSettings(settings, changed),
    };
  }

  /** The edited document's grid on the player's seconds axis. */
  private tempoGrid() {
    return this.editing?.state.available ? audioSequenceTempoGrid(this.editing.state.document.content) : undefined;
  }

  private seekPlayer(seconds: number, quantized: boolean): void {
    const facade = this.facade();
    if (!facade?.seek || !this.playbackCompatible()) return;
    const grid = this.tempoGrid();
    const current = facade.seconds ?? facade.currentTime;
    // Quantize keeps the playing beat phase, so the jump lands in time.
    const target = quantized && grid && facade.playing && typeof current === 'number' ? tempoGridJump(grid, current, seconds) : seconds;
    facade.seek(Math.max(0, target));
  }

  private beatJump(beats: number): void {
    const facade = this.facade();
    const grid = this.tempoGrid();
    const current = facade?.seconds ?? facade?.currentTime;
    if (!facade?.seek || !grid || typeof current !== 'number' || !this.playbackCompatible()) return;
    facade.seek(Math.max(0, current + beats * 60 / grid.bpm));
  }

  private reflectSettings(settings: AudioClipSettings, changed: keyof AudioClipSettings): void {
    this.reflecting = true;
    try {
      if (changed === 'tool') this.setAttribute('tool', settings.tool);
      else if (changed === 'snap') this.setAttribute('snap', settings.snap);
      else if (changed === 'fadeCurve') this.setAttribute('fade-curve', settings.fadeCurve);
      else if (changed === 'envelopes') { if (settings.envelopes) this.setAttribute('show-envelopes', ''); else this.removeAttribute('show-envelopes'); }
      else if (changed === 'pixelsPerSecond') this.setAttribute('pixels-per-second', String(settings.pixelsPerSecond));
      else if (changed === 'grid' || changed === 'quantize' || changed === 'gridEdit') {
        const name = changed === 'gridEdit' ? 'grid-edit' : changed;
        if (settings[changed]) this.setAttribute(name, ''); else this.removeAttribute(name);
      }
      else this.setAttribute('amplitude', String(settings.amplitude));
    } finally { this.reflecting = false; }
    this.dispatchEvent(new CustomEvent<AudioClipSettingsChangeDetail>('clipsettingschange', {detail: {settings, changed}, bubbles: true, composed: true}));
  }

  private applyHostSize(): void {
    const style = (this as {style?: CSSStyleDeclaration}).style;
    if (!style) return;
    const width = cssSizeAttr(this, 'width');
    for (const [property, value] of [['width', width]] as const) {
      if (value) { style.setProperty(property, value); this.ownedSizes.set(property, value); }
      else if (this.ownedSizes.has(property)) { if (style.getPropertyValue(property) === this.ownedSizes.get(property)) style.removeProperty(property); this.ownedSizes.delete(property); }
    }
  }
}

/** Every clip editing feature, for applications building a `tools` list. */
export const AUDIO_CLIP_VIEW_FEATURES = AUDIO_CLIP_FEATURES;

/** Register `<audio-clip-view>` (or a custom tag). Idempotent and SSR-safe. */
export function defineAudioClipViewElement(tag = 'audio-clip-view'): void {
  defineOnce(tag, AudioClipViewElement);
}
