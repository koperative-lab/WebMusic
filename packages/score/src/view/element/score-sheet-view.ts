import type {ViewPlayerSnapshot} from './internal/player-binding';
import {SCORE_VIEW_BASE_ATTRIBUTES, ScoreViewElementBase} from './internal/score-view-base';
import {
  SCORE_SHEET_FEATURES, SCORE_SHEET_LAYOUTS, mountScoreSheet, parseScoreSheetFeatures,
  type ScoreSheetFeature, type ScoreSheetHandle, type ScoreSheetLayout, type ScoreSheetOptions,
  type ScoreSheetPlayback, type ScoreSheetSettings,
} from '../render/score-sheet';
import type {ScoreViewEditing} from '../headless/score-editing';
import {boolAttr, defineOnce, numAttr, upgradeProperties} from './base';
import {parseColorAttr} from './score-view';

export type {ScoreSheetDuration, ScoreSheetFeature, ScoreSheetLayout, ScoreSheetSettings} from '../render/score-sheet';

/** `detail` of the `sheetsettingschange` event. */
export interface ScoreSheetSettingsChangeDetail {
  readonly settings: ScoreSheetSettings;
  readonly changed: keyof ScoreSheetSettings;
}

const SHEET_ATTRIBUTES = ['editable', 'tools', 'layout', 'zoom', 'follow-cursor', 'note-color', 'active-note-color'] as const;
/** Attributes the mounted sheet applies in place; the others remount it. */
const SETTING_ATTRIBUTES = new Set(['tools', 'layout', 'zoom', 'follow-cursor']);

/**
 * `<score-sheet-view>` — engraved sheet music. Measures are broken into
 * justified systems and laid out as paper pages (`layout="page"`, the
 * default) or as a continuous column filling the element (`layout="flow"`).
 *
 * ```html
 * <score-sheet-view player="#player" editable tools="pitch input duration tie accidental delete history zoom"></score-sheet-view>
 * ```
 *
 * Data comes from `.score`, `src`, the selected player's score, or a
 * borrowed `.editor` (the caller keeps it). Editing requires `.editor` and
 * `editable`: notes and rests can then be selected, moved in pitch, written
 * in note input mode and given new durations, as in a notation editor. Each
 * edit is one atomic, undoable editor command. `tools` lists the offered
 * features (default: all). Toolbar and keyboard changes to `layout` and
 * `zoom` are reflected to those attributes; every settings change is
 * announced with `sheetsettingschange`.
 */
export class SheetViewElement extends ScoreViewElementBase {
  static get observedAttributes(): string[] {
    return [...SCORE_VIEW_BASE_ATTRIBUTES, ...SHEET_ATTRIBUTES];
  }

  private surface?: ScoreSheetHandle;
  /** The controller the mounted surface borrows; undefined for a fixed score. */
  private surfaceEditing?: ScoreViewEditing;
  private reflecting = false;

  connectedCallback(): void {
    upgradeProperties(this, ['score', 'editor', 'interactionSession', 'editable', 'tools', 'layout', 'zoom', 'followCursor']);
    super.connectedCallback();
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected || !SheetViewElement.observedAttributes.includes(name)) return;
    if (this.handleBaseAttribute(name)) return;
    if (name === 'editable') { this.updateEditable(); if (!this.surface) this.renderCurrent(); return; }
    if (SETTING_ATTRIBUTES.has(name) && this.surface) {
      if (!this.reflecting) this.surface.configure({layout: this.layout, zoom: this.zoom, features: this.tools, followPlayback: this.followCursor});
      return;
    }
    this.renderCurrent();
  }

  /** Allow editing when a ready `.editor` is assigned. */
  set editable(value: boolean) { if (value) this.setAttribute('editable', ''); else this.removeAttribute('editable'); }
  get editable(): boolean { return boolAttr(this, 'editable', false); }

  /** Offered editing features (`tools` attribute; absent means all, unknown tokens are ignored). */
  set tools(value: readonly ScoreSheetFeature[]) { this.setAttribute('tools', parseScoreSheetFeatures(value.join(' ')).join(' ')); }
  get tools(): ScoreSheetFeature[] { return parseScoreSheetFeatures(this.getAttribute('tools')); }

  /** `page` (default) draws paper pages; `flow` fills the element width with systems. */
  set layout(value: ScoreSheetLayout) { this.setAttribute('layout', value); }
  get layout(): ScoreSheetLayout {
    const raw = this.getAttribute('layout')?.trim().toLowerCase() as ScoreSheetLayout | undefined;
    return raw && SCORE_SHEET_LAYOUTS.includes(raw) ? raw : 'page';
  }

  /** Staff size factor (0.5–3); 0 or absent fits a page to the width in page layout and means 1 in flow layout. */
  set zoom(value: number) { this.setAttribute('zoom', String(value)); }
  get zoom(): number {
    const value = numAttr(this, 'zoom', 0);
    return Number.isFinite(value) && value > 0 ? Math.min(3, Math.max(.5, value)) : 0;
  }

  /** Keep the sounding system in view during playback (default true). */
  set followCursor(value: boolean) { this.setAttribute('follow-cursor', String(value)); }
  get followCursor(): boolean { return boolAttr(this, 'follow-cursor', true); }

  /** Current position on the nominal score timeline, in seconds. */
  get currentTime(): number { return this.playheadSeconds; }

  protected editingRequested(): boolean { return this.editable; }
  protected hasEditingSurface(): boolean { return this.surface !== undefined && this.editing !== undefined && this.surfaceEditing === this.editing; }

  protected releaseEditingSurface(): () => void {
    // A surface borrows the editing controller; it must go before the controller does.
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
    for (const error of failures.slice(1)) console.error('[WebScore] Score sheet presentation cleanup failed', error);
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
      this.surface = mountScoreSheet(this, this.editing ? {editing: this.editing} : {score: prepared.score}, this.sheetOptions());
      this.surfaceEditing = this.editing;
      this.surface.updatePlayback(this.sheetPlayback());
    } catch (error) {
      if (this.hasEditorIntent()) this.setAttribute('data-editable-state', 'unavailable');
      this.showStatus('error', this.errorMessage(error));
    }
  }

  protected paintPosition(_snapshot: ViewPlayerSnapshot): void { this.surface?.updatePlayback(this.sheetPlayback()); }
  protected resetPresentationPlayback(): void { this.surface?.updatePlayback(this.sheetPlayback()); }
  protected endPresentationPlayback(): void { this.surface?.updatePlayback({seconds: null}); }

  private sheetPlayback(): ScoreSheetPlayback | undefined {
    if (this.hasEditorIntent()) {
      const snapshot = this.documentPlayback;
      if (!snapshot || !this.documentPlaybackReady()) return {seconds: null};
      return {seconds: snapshot.state === 'playing' || (snapshot.nominalSeconds ?? 0) > 0 ? snapshot.nominalSeconds ?? null : null,
        activeNoteIds: new Set(snapshot.activeNotes.map((note) => note.noteId))};
    }
    if (!this.boundPlayer || !this.lastSnapshot) return {seconds: null};
    return {seconds: this.lastSnapshot.playing || this.lastSnapshot.nominalSeconds > 0 ? this.lastSnapshot.nominalSeconds : null};
  }

  private updateEditable(): void {
    if (this.editing?.state.available) this.editing.setEditable(this.editable);
    if (!this.hasEditorIntent() && !this.editable) { this.removeAttribute?.('data-editable-state'); return; }
    this.setAttribute('data-editable-state', !this.editable ? 'readonly' : this.editing?.state.available ? 'ready' : 'unavailable');
  }

  private sheetOptions(): ScoreSheetOptions {
    const note = parseColorAttr(this.getAttribute('note-color'));
    const active = parseColorAttr(this.getAttribute('active-note-color'));
    return {
      layout: this.layout, zoom: this.zoom, features: this.tools, followPlayback: this.followCursor,
      noteColor: note ? `rgb(${note})` : 'var(--wm-score-sheet-note, var(--wm-foreground, light-dark(#111, #eee)))',
      activeNoteColor: active ? `rgb(${active})` : 'var(--wm-score-sheet-active-note, var(--wm-score-view-active-note, rgb(240, 84, 119)))',
      onPreview: (result) => this.dispatchEvent(new CustomEvent('editpreview', {detail: result, bubbles: true, composed: true})),
      onCommit: (result) => this.dispatchEvent(new CustomEvent('editcommit', {detail: result, bubbles: true, composed: true})),
      onError: (error) => this.dispatchEvent(new CustomEvent('editerror', {detail: {error}, bubbles: true, composed: true})),
      onSettingsChange: (settings, changed) => this.reflectSettings(settings, changed),
    };
  }

  private reflectSettings(settings: ScoreSheetSettings, changed: keyof ScoreSheetSettings): void {
    this.reflecting = true;
    try {
      if (changed === 'layout') this.setAttribute('layout', settings.layout);
      else if (changed === 'zoom') { if (settings.zoom > 0) this.setAttribute('zoom', String(settings.zoom)); else this.removeAttribute('zoom'); }
    } finally { this.reflecting = false; }
    this.dispatchEvent(new CustomEvent<ScoreSheetSettingsChangeDetail>('sheetsettingschange', {detail: {settings, changed}, bubbles: true, composed: true}));
  }
}

/** All sheet editing features, for applications building a `tools` list. */
export const SHEET_VIEW_FEATURES = SCORE_SHEET_FEATURES;

/** Register `<score-sheet-view>` (or a custom tag). Idempotent, SSR-safe. */
export function defineSheetViewElement(tag = 'score-sheet-view'): void {
  defineOnce(tag, SheetViewElement);
}
