import type {ViewPlayerSnapshot} from './internal/player-binding';
import {SCORE_VIEW_BASE_ATTRIBUTES, ScoreViewElementBase} from './internal/score-view-base';
import {
  SCORE_GRID_FEATURES, SCORE_GRID_SNAPS, mountScoreGrid, parseScoreGridFeatures,
  type ScoreGridFeature, type ScoreGridHandle, type ScoreGridOptions, type ScoreGridPlayback,
  type ScoreGridSettings, type ScoreGridSnap, type ScoreGridTool,
} from '../render/score-grid';
import type {ScoreViewEditing} from '../headless/score-editing';
import {boolAttr, defineOnce, numAttr, upgradeProperties} from './base';
import {parseColorAttr} from './score-view';

export type {ScoreGridFeature, ScoreGridSettings, ScoreGridSnap, ScoreGridTool} from '../render/score-grid';

/** `detail` of the `gridsettingschange` event. */
export interface ScoreGridSettingsChangeDetail {
  readonly settings: ScoreGridSettings;
  readonly changed: keyof ScoreGridSettings;
}

const GRID_ATTRIBUTES = ['editable', 'tools', 'tool', 'snap', 'velocity-lane', 'pixels-per-quarter', 'note-height',
  'min-pitch', 'max-pitch', 'note-color', 'active-note-color'] as const;
/** Attributes the mounted grid applies in place; the others remount it. */
const SETTING_ATTRIBUTES = new Set(['tools', 'tool', 'snap', 'velocity-lane', 'pixels-per-quarter', 'note-height']);

/**
 * `<score-grid-view>` — a DAW-style piano-roll grid. It draws written pitch
 * rows over bar, beat and snap lines, with piano keys, a bar ruler and an
 * optional velocity lane, and follows a bound player.
 *
 * ```html
 * <score-grid-view player="#player" editable tools="move resize draw delete velocity snap zoom history"
 *   snap="1/16" velocity-lane></score-grid-view>
 * ```
 *
 * Data comes from `.score`, `src`, the selected player's score, or a
 * borrowed `.editor` (the caller keeps it). Editing requires `.editor` and
 * `editable`: the toolbar then offers the features listed in `tools`
 * (default: all), and every edit is an atomic, undoable editor command.
 * Toolbar, wheel and keyboard changes to `tool`, `snap`, `velocity-lane`,
 * `pixels-per-quarter` and `note-height` are reflected to those attributes
 * and announced with `gridsettingschange`.
 */
export class ScoreGridViewElement extends ScoreViewElementBase {
  static get observedAttributes(): string[] {
    return [...SCORE_VIEW_BASE_ATTRIBUTES, ...GRID_ATTRIBUTES];
  }

  private surface?: ScoreGridHandle;
  /** The controller the mounted surface borrows; undefined for a fixed score. */
  private surfaceEditing?: ScoreViewEditing;
  private reflecting = false;

  connectedCallback(): void {
    upgradeProperties(this, ['score', 'editor', 'interactionSession', 'editable', 'tools', 'tool', 'snap', 'velocityLane', 'pixelsPerQuarter', 'noteHeight']);
    super.connectedCallback();
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected || !ScoreGridViewElement.observedAttributes.includes(name)) return;
    if (this.handleBaseAttribute(name)) return;
    if (name === 'editable') { this.updateEditable(); if (!this.surface) this.renderCurrent(); return; }
    if (SETTING_ATTRIBUTES.has(name) && this.surface) {
      if (!this.reflecting) this.surface.configure({...this.attributeSettings(), features: this.tools});
      return;
    }
    this.renderCurrent();
  }

  /** Allow editing when a ready `.editor` is assigned. */
  set editable(value: boolean) { if (value) this.setAttribute('editable', ''); else this.removeAttribute('editable'); }
  get editable(): boolean { return boolAttr(this, 'editable', false); }

  /** Offered editing features (`tools` attribute; absent means all, unknown tokens are ignored). */
  set tools(value: readonly ScoreGridFeature[]) {
    const features = parseScoreGridFeatures(value.join(' '));
    this.setAttribute('tools', features.join(' '));
  }
  get tools(): ScoreGridFeature[] {
    const raw = this.getAttribute('tools');
    if (raw === null) return [...SCORE_GRID_FEATURES];
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    return SCORE_GRID_FEATURES.filter((feature) => tokens.includes(feature));
  }

  /** Pointer tool; `draw` falls back to `select` when the `draw` feature is not offered. */
  set tool(value: ScoreGridTool) { this.setAttribute('tool', value); }
  get tool(): ScoreGridTool { return this.getAttribute('tool') === 'draw' && this.tools.includes('draw') ? 'draw' : 'select'; }

  /** Snap and grid-line resolution as a note value; unknown values fall back to `1/16`. */
  set snap(value: ScoreGridSnap) { this.setAttribute('snap', value); }
  get snap(): ScoreGridSnap {
    const raw = this.getAttribute('snap')?.trim().toLowerCase() as ScoreGridSnap | undefined;
    return raw && SCORE_GRID_SNAPS.includes(raw) ? raw : '1/16';
  }

  /** Show the velocity lane (requires the `velocity` feature). */
  set velocityLane(value: boolean) { if (value) this.setAttribute('velocity-lane', ''); else this.removeAttribute('velocity-lane'); }
  get velocityLane(): boolean { return boolAttr(this, 'velocity-lane', false); }

  /** Horizontal zoom in pixels per written quarter (8–512, default 64). */
  set pixelsPerQuarter(value: number) { this.setAttribute('pixels-per-quarter', String(value)); }
  get pixelsPerQuarter(): number { return this.surface?.settings.pixelsPerQuarter ?? clamp(numAttr(this, 'pixels-per-quarter', 64), 8, 512, 64); }

  /** Row height in pixels per semitone (6–48, default 16). */
  set noteHeight(value: number) { this.setAttribute('note-height', String(value)); }
  get noteHeight(): number { return this.surface?.settings.noteHeight ?? clamp(numAttr(this, 'note-height', 16), 6, 48, 16); }

  /** Current position on the nominal score timeline, in seconds. */
  get currentTime(): number { return this.playheadSeconds; }

  protected editingRequested(): boolean { return this.editable; }
  protected hasEditingSurface(): boolean { return this.surface !== undefined && this.editing !== undefined && this.surfaceEditing === this.editing; }

  protected releaseEditingSurface(): () => void {
    // A surface borrows the editing controller; it must go before the controller does.
    // A fixed-score surface stays until the next render replaces it.
    if (!this.surfaceEditing) return () => {};
    const surface = this.surface;
    this.surface = undefined;
    this.surfaceEditing = undefined;
    return () => surface?.dispose();
  }

  protected editingStatusChanged(): void { this.updateEditable(); }

  protected editingStateChanged(_contentChanged: boolean, available: boolean): void {
    // A mounted surface follows the controller itself; only a missing or unavailable one remounts.
    if (!this.hasEditingSurface() || !available) this.renderCurrent(false);
  }

  protected disposePresentation(): number {
    const revision = ++this.presentationRevision;
    const surface = this.surface, status = this.status;
    this.surface = undefined;
    this.surfaceEditing = undefined;
    this.status = undefined;
    this.replaceChildren();
    const failures: unknown[] = [];
    for (const cleanup of [() => surface?.dispose(), () => status?.destroy()]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    for (const error of failures.slice(1)) console.error('[WebScore] Score grid presentation cleanup failed', error);
    if (failures.length) throw failures[0];
    return revision;
  }

  protected renderCurrent(_preservePosition?: boolean): void {
    const generation = this.editorGeneration;
    const revision = this.disposePresentation();
    if (revision !== this.presentationRevision || generation !== this.editorGeneration) return;
    const prepared = this.prepareRender();
    if (!prepared?.owner) return;
    if (this.hasEditorIntent() && !this.editing) {
      const blocked = this.blockedEditorState();
      this.showStatus(blocked ? 'error' : 'waiting', blocked ? `Editor unavailable: ${blocked}` : 'Waiting for the editor');
      return;
    }
    try {
      this.surface = mountScoreGrid(this, this.editing ? {editing: this.editing} : {score: prepared.score}, this.gridOptions());
      this.surfaceEditing = this.editing;
      this.surface.updatePlayback(this.gridPlayback());
    } catch (error) {
      if (this.hasEditorIntent()) this.setAttribute('data-editable-state', 'unavailable');
      this.showStatus('error', this.errorMessage(error));
    }
  }

  protected paintPosition(_snapshot: ViewPlayerSnapshot): void {
    this.surface?.updatePlayback(this.gridPlayback());
  }

  protected resetPresentationPlayback(): void {
    this.surface?.updatePlayback(this.gridPlayback());
  }

  protected endPresentationPlayback(): void {
    const playback = this.gridPlayback();
    this.surface?.updatePlayback(playback && {seconds: playback.seconds, activeNoteIds: new Set()});
  }

  private gridPlayback(): ScoreGridPlayback | undefined {
    if (this.hasEditorIntent()) {
      const snapshot = this.documentPlayback;
      if (!snapshot) return undefined;
      if (!this.documentPlaybackReady()) return {seconds: null};
      return {seconds: snapshot.nominalSeconds ?? null, activeNoteIds: new Set(snapshot.activeNotes.map((note) => note.noteId))};
    }
    if (!this.boundPlayer) return undefined;
    return {seconds: this.lastSnapshot ? this.lastSnapshot.nominalSeconds : null};
  }

  private updateEditable(): void {
    if (this.editing?.state.available) this.editing.setEditable(this.editable);
    // A passive grid has no editable state; `editable` without an editor reports unavailable.
    if (!this.hasEditorIntent() && !this.editable) { this.removeAttribute?.('data-editable-state'); return; }
    this.setAttribute('data-editable-state', !this.editable ? 'readonly' : this.editing?.state.available ? 'ready' : 'unavailable');
  }

  private attributeSettings(): Partial<ScoreGridSettings> {
    return {tool: this.tool, snap: this.snap, velocityLane: this.velocityLane,
      pixelsPerQuarter: clamp(numAttr(this, 'pixels-per-quarter', 64), 8, 512, 64),
      noteHeight: clamp(numAttr(this, 'note-height', 16), 6, 48, 16)};
  }

  private gridOptions(): ScoreGridOptions {
    const options: ScoreGridOptions = {...this.attributeSettings(), features: this.tools,
      noteColor: 'var(--wm-score-view-note, var(--wm-foreground, light-dark(#333, #ddd)))',
      activeNoteColor: 'var(--wm-score-view-active-note, rgb(240, 84, 119))',
      onPreview: (result) => this.dispatchEvent(new CustomEvent('editpreview', {detail: result, bubbles: true, composed: true})),
      onCommit: (result) => this.dispatchEvent(new CustomEvent('editcommit', {detail: result, bubbles: true, composed: true})),
      onError: (error) => this.dispatchEvent(new CustomEvent('editerror', {detail: {error}, bubbles: true, composed: true})),
      onSettingsChange: (settings, changed) => this.reflectSettings(settings, changed),
    };
    for (const [attribute, key] of [['min-pitch', 'minPitch'], ['max-pitch', 'maxPitch']] as const) {
      const value = numAttr(this, attribute, Number.NaN);
      if (Number.isSafeInteger(value) && value >= 0 && value <= 127) options[key] = value;
    }
    const note = parseColorAttr(this.getAttribute('note-color'));
    const active = parseColorAttr(this.getAttribute('active-note-color'));
    if (note) { options.noteRGB = note; delete options.noteColor; }
    if (active) { options.activeNoteRGB = active; delete options.activeNoteColor; }
    return options;
  }

  private reflectSettings(settings: ScoreGridSettings, changed: keyof ScoreGridSettings): void {
    this.reflecting = true;
    try {
      if (changed === 'tool') this.setAttribute('tool', settings.tool);
      else if (changed === 'snap') this.setAttribute('snap', settings.snap);
      else if (changed === 'velocityLane') { if (settings.velocityLane) this.setAttribute('velocity-lane', ''); else this.removeAttribute('velocity-lane'); }
      else if (changed === 'pixelsPerQuarter') this.setAttribute('pixels-per-quarter', String(settings.pixelsPerQuarter));
      else this.setAttribute('note-height', String(settings.noteHeight));
    } finally { this.reflecting = false; }
    this.dispatchEvent(new CustomEvent<ScoreGridSettingsChangeDetail>('gridsettingschange', {detail: {settings, changed}, bubbles: true, composed: true}));
  }
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(high, Math.max(low, value)) : fallback;
}

/**
 * Register `<score-grid-view>` (or a custom tag). Call once in the browser. A
 * no-op outside the browser and when the tag is already taken.
 */
export function defineScoreGridViewElement(tag = 'score-grid-view'): void {
  defineOnce(tag, ScoreGridViewElement);
}
