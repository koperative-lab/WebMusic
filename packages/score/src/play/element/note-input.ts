// ============================================================================
// <note-input> — discrete-note performance surface.
//
// The custom element owns host lifecycle, headless mapping and event dispatch.
// The UI presenter owns DOM, focus, pointer/key holding, pressed state and ARIA.
// Every layout emits
// `webscore:noteon` / `webscore:noteoff` with `{midi, velocity}`.
// ============================================================================

import {numAttr} from './internal/base';
import {HTMLElementBase, upgradeProperties} from './internal/base';
import {
  mountNoteSurface,
  type NoteGridCell,
  pianoKeyLayout,
  type NotePianoKey,
  type NoteSurfaceHandle,
  type NoteSurfaceState,
} from '@webmusic/ui/note';
import {
  DEFAULT_CHORDS,
  gridIndexToRef,
  gridPadIndex,
  gridPadMidi,
  gridQwertyCellMidi,
  gridKeyboardMidi,
  normalizeNoteInputLayout,
  parseGridMap,
  qwertyLabelMap,
  qwertyMidi,
  QWERTY_GRID_COLS,
  QWERTY_GRID_KEYS,
  QWERTY_GRID_ROWS,
  QWERTY_SPAN,
  type NoteInputChord,
  type NoteInputDetail,
  type NoteInputLayout,
  type NoteInputPad,
} from '../core/note-input-model';
import {noteName} from './internal/note-names';

export {
  DEFAULT_CHORDS,
  DEFAULT_TR808_GRID_MAP,
  GRID_ROW_LETTERS,
  gridCellMidi,
  gridIndexToRef,
  gridKeyboardMidi,
  gridPadIndex,
  gridPadMidi,
  gridQwertyCellMidi,
  gridRefToCoords,
  gridRefToIndex,
  parseGridMap,
  qwertyMidi,
  qwertyOffsetIsBlack,
  QWERTY_GRID_COLS,
  QWERTY_GRID_KEYS,
  QWERTY_GRID_ROWS,
  QWERTY_KEY_MAP,
} from '../core/note-input-model';
export type {
  NoteInputChord,
  NoteInputDetail,
  NoteInputLayout,
  NoteInputPad,
} from '../core/note-input-model';

// Capture inherited UIKit values at the host, then apply legacy overrides at
// the presenter's root. Defining --wm-* defaults on :host would mask the app's
// inherited theme; referring to the same property on the root would cycle.
const NOTE_INPUT_THEME = [
  ['background', 'bg', 'var(--wm-surface,#fff)'],
  ['surface', 'surface', 'var(--wm-surface-muted,var(--wm-surface,#f3f3f3))'],
  ['key', 'key', 'var(--wm-surface,#fff)'],
  ['key-alt', 'key-alt', 'var(--wm-surface-inverse,#222)'],
  ['active', 'active', 'var(--wm-accent,#444)'],
  ['border', 'border', 'var(--wm-control-border,var(--wm-border,#d8d8d8))'],
  ['label', 'label', 'var(--wm-foreground-muted,var(--wm-foreground,#666))'],
  ['label-active', 'label-active', 'var(--wm-accent-foreground,#fff)'],
  ['height', 'height', '120px'],
  ['cell-height', 'cell-height', '42px'],
  ['gap', 'gap', '.4rem'],
  ['radius', 'radius', 'var(--wm-control-radius,0)'],
  ['focus', 'focus', 'var(--wm-focus,#444)'],
  ['overlay', 'overlay', 'rgba(255,255,255,.82)'],
  ['accent', 'accent', 'var(--wm-accent,#111)'],
  ['accent-foreground', 'accent-color', 'var(--wm-accent-foreground,#fff)'],
];
const NOTE_INPUT_COMPATIBILITY_STYLE = `
:host{min-width:0;max-width:100%;box-sizing:border-box;${NOTE_INPUT_THEME.map(([name, , fallback]) => `--wui-note-host-${name}:var(--wm-note-${name},${fallback});`).join('')}}
:host(:not([hidden])){display:block}
:host([hidden]){display:none}
[part~="root"]{${NOTE_INPUT_THEME.map(([name, legacy]) => `--wm-note-${name}:var(--note-input-${legacy},var(--wui-note-host-${name}));`).join('')}}
`;

export class NoteInputElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['layout', 'start', 'end', 'velocity', 'row-interval', 'keyboard', 'map'];
  }

  /** Optional callback fired on every press/release. */
  onNote?: (midi: number, velocity: number, on: boolean) => void;
  /** Override the chord set (layout="chords"). */
  chords: NoteInputChord[] = DEFAULT_CHORDS;
  /** Override the grid pad map (`layout="grid"`). */
  pads?: NoteInputPad[];

  private root?: ShadowRoot;
  private handle?: NoteSurfaceHandle;
  private compatibilityStyle?: HTMLStyleElement;
  private octaveShift = 0;
  private renderRevision = 0;
  private dispatching = false;
  private readonly noteQueue: Array<{detail: NoteInputDetail; on: boolean}> = [];

  connectedCallback(): void {
    upgradeProperties(this, ['onNote', 'chords', 'pads']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.render();
  }

  disconnectedCallback(): void {
    this.renderRevision += 1;
    const handle = this.handle;
    this.handle = undefined;
    handle?.destroy();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.render();
  }

  /** Release every held note and forget pointer, chord, and keyboard state. */
  releaseHeld(): void {
    this.handle?.releaseAll();
  }

  get layout(): NoteInputLayout {
    return normalizeNoteInputLayout(this.getAttribute('layout'));
  }
  set layout(value: NoteInputLayout) {
    this.setAttribute('layout', value);
  }

  private get startMidi(): number {
    return numAttr(this, 'start', this.layout === 'piano' ? 48 : 60);
  }
  private get endMidi(): number {
    return numAttr(this, 'end', this.layout === 'piano' ? 71 : 72);
  }
  private get velocity(): number {
    return numAttr(this, 'velocity', this.layout === 'grid' ? 110 : 100, 1, 127);
  }
  private get rowInterval(): number {
    return numAttr(this, 'row-interval', 5);
  }
  private get qwertyEnabled(): boolean {
    return this.hasAttribute('keyboard');
  }

  get map(): string | null {
    return this.getAttribute('map');
  }
  set map(value: string | null) {
    if (value == null || value === '') this.removeAttribute('map');
    else this.setAttribute('map', value);
  }

  private resolveGridPads(): readonly (NoteInputPad | undefined)[] | undefined {
    if (this.pads != null) return this.pads;
    const raw = this.map;
    return raw?.trim() ? parseGridMap(raw) : undefined;
  }

  private gridUsesMapOnly(): boolean {
    return this.pads == null && Boolean(this.map?.trim());
  }

  /** MIDI note played by A at the current octave shift. */
  private get baseC(): number {
    const anchor = this.layout === 'grid' ? numAttr(this, 'start', 48) : this.startMidi;
    return anchor + this.octaveShift * 12;
  }

  private render(): void {
    if (!this.root) return;
    const revision = ++this.renderRevision;
    const previous = this.handle;
    this.handle = undefined;
    previous?.destroy();
    if (revision !== this.renderRevision || !this.isConnected) return;
    this.octaveShift = 0;
    const ownerDocument = (this.root as unknown as {ownerDocument?: Document}).ownerDocument;
    if (!ownerDocument) return;
    const handle = mountNoteSurface(this.root, {
      snapshot: () => this.noteSurfaceState(),
      interaction: {
        setNote: (midi, on) => this.fire(midi, on),
        midiForKey: (code) => this.qwertyMidiForCode(code),
        canShiftOctave: (delta) => this.canShiftOctave(delta),
        requestOctaveShift: (delta) => this.shiftOctave(delta),
      },
    });
    if (revision !== this.renderRevision || !this.isConnected) {
      handle.destroy();
      return;
    }
    this.handle = handle;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = ownerDocument.createElement('style');
      this.compatibilityStyle.textContent = NOTE_INPUT_COMPATIBILITY_STYLE;
    }
    this.root.append(this.compatibilityStyle);
  }

  private noteSurfaceState(): NoteSurfaceState {
    const layout = this.layout;
    return {
      layout,
      keyboard: this.qwertyEnabled,
      mapOnly: this.gridUsesMapOnly(),
      octaveLabel: `${noteName(this.baseC)} – ${noteName(this.baseC + QWERTY_SPAN)}`,
      piano: layout === 'piano' ? this.pianoKeys() : undefined,
      grid: layout === 'grid' ? this.gridCells() : undefined,
      gridColumns: QWERTY_GRID_COLS,
      chords: layout === 'chords'
        ? this.chords.map((chord, index) => ({label: chord.label, index, midis: chord.notes}))
        : undefined,
    };
  }

  private pianoKeys(): NotePianoKey[] {
    const keyboard = this.qwertyEnabled;
    const lo = keyboard ? this.baseC : Math.min(this.startMidi, this.endMidi);
    const hi = keyboard ? this.baseC + QWERTY_SPAN : Math.max(this.startMidi, this.endMidi);
    const labels = keyboard ? qwertyLabelMap(this.baseC) : undefined;
    return pianoKeyLayout(lo, hi, labels);
  }

  private gridCells(): NoteGridCell[] {
    const pads = this.resolveGridPads();
    const mapOnly = this.gridUsesMapOnly();
    const cells: NoteGridCell[] = [];
    for (let row = 0; row < QWERTY_GRID_ROWS; row += 1) {
      for (let column = 0; column < QWERTY_GRID_COLS; column += 1) {
        const code = QWERTY_GRID_KEYS[row][column].code;
        const index = gridPadIndex(QWERTY_GRID_ROWS, QWERTY_GRID_COLS, row, column);
        const pad = pads?.[index];
        cells.push({
          code,
          ref: gridIndexToRef(row, column),
          midi: this.qwertyEnabled
            ? gridQwertyCellMidi(this.baseC, index, code, pad, mapOnly) ?? undefined
            : gridPadMidi(index, pad) ?? undefined,
        });
      }
    }
    return cells;
  }

  private qwertyMidiForCode(code: string): number | null {
    if (this.layout === 'grid') {
      return gridKeyboardMidi(this.baseC, code, this.resolveGridPads(), this.gridUsesMapOnly());
    }
    return qwertyMidi(code, this.baseC);
  }

  private shiftOctave(delta: number): void {
    const next = Math.max(-3, Math.min(4, this.octaveShift + delta));
    if (next === this.octaveShift) return;
    this.releaseHeld();
    this.octaveShift = next;
    this.handle?.update();
  }

  private canShiftOctave(delta: number): boolean {
    const next = Math.max(-3, Math.min(4, this.octaveShift + delta));
    return next !== this.octaveShift;
  }

  private fire(midi: number, on: boolean): void {
    this.noteQueue.push({detail: {midi, velocity: this.velocity}, on});
    if (this.dispatching) return;
    this.dispatching = true;
    let failed = false;
    let failure: unknown;
    try {
      // A listener can replace this layout or remove the host, causing a
      // synchronous release. Finish both attack outputs before that release.
      for (let index = 0; index < this.noteQueue.length; index += 1) {
        const next = this.noteQueue[index];
        try {
          this.dispatchEvent(new CustomEvent(next.on ? 'webscore:noteon' : 'webscore:noteoff', {
            detail: next.detail, bubbles: true, composed: true,
          }));
          this.onNote?.(next.detail.midi, next.detail.velocity, next.on);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    } finally {
      this.noteQueue.length = 0;
      this.dispatching = false;
    }
    if (failed) throw failure;
  }
}

/** Register `<note-input>`. Call once in the browser. */
export function defineNoteInputElement(tag = 'note-input'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, NoteInputElement);
  }
}
