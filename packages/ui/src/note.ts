import {readText, textValue, type UITextValue} from './text';
import {installStyle} from './internal/style';
import {claimHost, createErrorSink, createUpdateLoop} from './internal/lifecycle';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import type {NotePianoKey} from './internal/pitch-geometry';
import {surfaceHeight} from './internal/control';
export type NoteSurfaceLayout = "piano" | "grid" | "chords";

/**
 * The keyboard geometry now lives in `internal/pitch-geometry`, and this module
 * re-exports it: `@webmusic/ui/note`'s published surface is byte-identical.
 *
 * The move exists so a read-out surface can reuse the layout without importing
 * this module at runtime, which would drag `PointerSurface` and
 * `NoteSurfaceInteractions` — some 470 lines of pointer, QWERTY and pressed-state
 * machinery a passive surface never runs — into its chunk. This module is the
 * INPUT face; a surface that only reads is a different presenter with the same
 * arithmetic underneath.
 */
export {isBlackKey, pianoKeyLayout} from './internal/pitch-geometry';
export type {NotePianoKey} from './internal/pitch-geometry';

export interface NoteGridCell { midi?: number; code?: string; ref?: string; }
export interface NoteChordCell {
  label: string;
  index: number;
  /** MIDI pitches sounded while this chord cell is held. */
  midis?: readonly number[];
}
export interface NoteSurfaceState {
  layout: NoteSurfaceLayout;
  /** MIDI pitches currently held; the presenter paints their pressed state. */
  activeMidis?: readonly number[];
  keyboard?: boolean;
  mapOnly?: boolean;
  octaveLabel?: string;
  piano?: readonly NotePianoKey[];
  grid?: readonly NoteGridCell[];
  gridColumns?: number;
  chords?: readonly NoteChordCell[];
}
/**
 * Commands and headless mappings consumed by the presenter's optional input
 * behavior. The presenter owns DOM listeners, pointer/key holding, focus,
 * pressed visuals and ARIA; the caller only resolves musical intent.
 */
export interface NoteSurfaceInteractionBinding {
  /** Sound or release one MIDI pitch. */
  setNote(midi: number, on: boolean): void;
  /** Resolve a physical KeyboardEvent.code to a MIDI pitch. */
  midiForKey?(code: string): number | null;
  /** Whether a requested octave shift would change the headless state. */
  canShiftOctave?(delta: -1 | 1): boolean;
  /** Apply a requested QWERTY octave shift. */
  requestOctaveShift?(delta: -1 | 1): void;
}

export interface NoteSurfaceBinding {
  snapshot(): NoteSurfaceState;
  interaction?: NoteSurfaceInteractionBinding;
  subscribe?(notify: () => void): () => void;
}

export interface NoteSurfaceText {
  hint?: UITextValue;
  hintMapped?: UITextValue;
  start?: UITextValue;
  keyboard?: UITextValue;
  grid?: UITextValue;
}

export interface NoteSurfaceOptions {
  /** Read application-resolved text once per paint; call update() after external changes. */
  getText?: () => NoteSurfaceText;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface NoteSurfaceHandle {
  element: HTMLElement;
  board?: HTMLElement;
  /** Release every pointer, chord and QWERTY holder. Idempotent. */
  releaseAll(): void;
  update(): void;
  destroy(): void;
}
type NoteHost = HTMLElement | ShadowRoot;
const mounted = new WeakMap<NoteHost, NoteSurfaceHandle>();

export const noteStyle = `
.wui-note {
${componentSurfaceCss('note', {
  background: 'var(--wm-note-background, var(--wm-surface, #fff))',
})}
min-width:0; max-width:100%; outline:none; }
.wui-note { color:var(--wm-note-foreground,var(--wm-foreground,#444)); }
.wui-note:focus-visible { outline:2px solid var(--wm-note-focus,var(--wm-focus,#444)); outline-offset:2px; }
.wui-note__bar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.35rem .75rem; color:var(--wm-note-label,var(--wm-foreground-muted, var(--wm-foreground, #666))); margin-bottom:.5rem; font:600 .78rem/1.2 var(--wm-font,var(--wm-font-family,system-ui,sans-serif)); }
.wui-note__hint { min-width:0; overflow-wrap:anywhere; font-weight:400; }.wui-note__octave { font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.wui-note__host { position:relative; min-width:0; }.wui-note__viewport { min-width:0; max-width:100%; overflow-x:auto; overscroll-behavior-x:contain; }.wui-note__viewport:focus-visible { outline:2px solid var(--wm-note-focus,var(--wm-focus,#444)); outline-offset:-2px; }.wui-note__overlay { position:absolute; inset:0; z-index:3; display:flex; align-items:center; justify-content:center; background:var(--wm-note-overlay,rgba(255,255,255,.82)); cursor:pointer; }
.wui-note__start { padding:.55rem 1rem; border-radius:var(--wm-note-radius,var(--wm-control-radius,0)); background:var(--wm-note-accent,var(--wm-accent,#111)); color:var(--wm-note-accent-foreground,var(--wm-accent-foreground,#fff)); font:600 .95rem/1 var(--wm-font,var(--wm-font-family,system-ui,sans-serif)); }
.wui-note.on .wui-note__overlay { display:none; }
.wui-note__piano { position:relative; width:100%; min-width:calc(var(--wui-note-white-keys,1) * var(--wm-note-key-min-width,2.25rem)); height:${surfaceHeight('note', 'md')}; user-select:none; touch-action:none; }
.wui-note__key { position:absolute; top:0; display:flex; align-items:flex-end; justify-content:center; box-sizing:border-box; border:1px solid var(--wm-note-border,${controlBorderFallback}); cursor:pointer; }
.wui-note__key-label { min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-bottom:.3rem; pointer-events:none; font:600 .66rem/1 var(--wm-font-mono,ui-monospace,monospace); }
.wui-note__white { height:100%; background:var(--wm-note-key,var(--wm-surface,#fff)); border-radius:var(--wm-note-radius,var(--wm-control-radius,0)); }.wui-note__white .wui-note__key-label{color:var(--wm-note-label,var(--wm-foreground-muted,var(--wm-foreground,#666)))}
.wui-note__black { height:62%; z-index:2; transform:translateX(-50%); border-color:var(--wm-note-key-alt-border,var(--wm-border,#000)); border-radius:var(--wm-note-radius,var(--wm-control-radius,0)); background:var(--wm-note-key-alt,var(--wm-surface-inverse,#222)); }.wui-note__black .wui-note__key-label{color:var(--wm-note-label-alt,var(--wm-foreground-on-inverse,#fff))}
.wui-note__key.down { background:var(--wm-note-active,var(--wm-accent,#444)); }
.wui-note__key.down .wui-note__key-label { color:var(--wm-note-label-active,var(--wm-accent-foreground,#fff)); }
.wui-note__grid { display:grid; grid-template-columns:repeat(var(--wui-note-grid-columns,7),minmax(var(--wm-note-cell-min-width,2.5rem),1fr)); gap:var(--wm-note-gap,.4rem); background:transparent; user-select:none; touch-action:none; }
.wui-note__cell { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:var(--wm-note-cell-height,42px); padding:.3rem .2rem; border:1px solid var(--wm-note-border,${controlBorderFallback}); border-radius:var(--wm-note-radius,var(--wm-control-radius,0)); background:var(--wm-note-surface,var(--wm-surface-muted,var(--wm-surface,#f3f3f3))); cursor:pointer; }
.wui-note__reference { color:var(--wm-note-label,var(--wm-foreground-muted,var(--wm-foreground,#666))); pointer-events:none; font:600 .62rem/1 var(--wm-font-mono,ui-monospace,monospace); }
.wui-note__cell.down { background:var(--wm-note-active,var(--wm-accent,#444)); }.wui-note__cell.down .wui-note__reference{color:var(--wm-note-label-active,var(--wm-accent-foreground,#fff))}
.wui-note__cell.idle { pointer-events:none; cursor:not-allowed; border-style:dashed; opacity:.4; }
.wui-note__chords { display:flex; flex-wrap:wrap; gap:var(--wm-note-gap,.4rem); user-select:none; touch-action:none; }
.wui-note__chord { box-sizing:border-box; flex:1 1 5rem; min-width:0; max-width:100%; min-height:calc(var(--wm-note-cell-height,42px) * 1.5); padding:.6rem .5rem; overflow-wrap:anywhere; border:1px solid var(--wm-note-border,${controlBorderFallback}); border-radius:var(--wm-note-radius,var(--wm-control-radius,0)); background:var(--wm-note-key-alt,var(--wm-surface-inverse,#222)); color:var(--wm-note-label-active,var(--wm-accent-foreground,#fff)); cursor:pointer; font:600 1rem/1.3 var(--wm-font,var(--wm-font-family,system-ui,sans-serif)); }
.wui-note__chord.down { background:var(--wm-note-active,var(--wm-accent,#444)); }
`;

function build(document: Document, state: NoteSurfaceState): HTMLElement {
  const root = document.createElement("div"); root.className = "wui-note wrap"; root.setAttribute("part", "root");
  if (state.keyboard) {
    root.tabIndex = 0;
    const bar = document.createElement("div"); bar.className = "wui-note__bar qwerty-bar";
    const hint = document.createElement("span"); hint.className = "wui-note__hint hint"; hint.textContent = state.layout === "grid" && state.mapOnly ? "Type to play · Esc stop" : "Type to play · Z / X octave · Esc stop";
    const octave = document.createElement("span"); octave.className = "wui-note__octave oct"; octave.textContent = state.octaveLabel ?? ""; bar.append(hint, octave); root.append(bar);
  }
  const host = document.createElement("div"); host.className = "wui-note__host host";
  let board: HTMLElement;
  if (state.layout === "piano") {
    board = document.createElement("div"); board.className = "wui-note__piano board kbd";
    // Infer white-key units from the supplied percentage geometry, including
    // half-key reserves at black-ended ranges. Resizing only changes CSS;
    // it never rebuilds the board or releases an active performance.
    let whiteUnits = 1;
    for (const key of state.piano ?? []) {
      if (Number.isFinite(key.width) && key.width > 0) {
        whiteUnits = Math.max(whiteUnits, 100 * (key.black ? 0.62 : 1) / key.width);
      }
    }
    board.style.setProperty('--wui-note-white-keys', String(whiteUnits));
    for (const key of state.piano ?? []) { const node = document.createElement("div"); node.className = `wui-note__key note key ${key.black ? "wui-note__black black" : "wui-note__white white"}`; node.dataset.midi = String(key.midi); node.style.left = `${key.left}%`; node.style.width = `${key.width}%`; if (key.label) { const label = document.createElement("span"); label.className = "wui-note__key-label keylab"; label.textContent = key.label; node.title = key.label; node.append(label); } board.append(node); }
  } else if (state.layout === "grid") {
    board = document.createElement("div"); board.className = "wui-note__grid board grid qwerty"; board.style.setProperty('--wui-note-grid-columns', String(state.gridColumns ?? 7));
    for (const cell of state.grid ?? []) { const node = document.createElement("div"); node.className = `wui-note__cell cell${cell.midi == null ? " idle" : " note"}`; if (cell.midi != null) node.dataset.midi = String(cell.midi); if (cell.code) node.dataset.code = cell.code; if (cell.ref) { node.dataset.ref = cell.ref; const ref = document.createElement("span"); ref.className = "wui-note__reference ref"; ref.textContent = cell.ref; node.append(ref); } board.append(node); }
  } else {
    board = document.createElement("div"); board.className = "wui-note__chords board chordrow";
    for (const chord of state.chords ?? []) { const button = document.createElement("button"); button.type = "button"; button.className = "wui-note__chord chord"; button.dataset.i = String(chord.index); button.setAttribute("aria-pressed", "false"); const label = document.createElement("span"); label.textContent = chord.label; button.append(label); board.append(button); }
  }
  if (state.layout === 'chords') {
    host.append(board);
  } else {
    const viewport = document.createElement('div');
    viewport.className = 'wui-note__viewport';
    viewport.setAttribute('part', 'viewport');
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', state.layout === 'piano' ? 'Note keyboard' : 'Note grid');
    if (!state.keyboard) viewport.tabIndex = 0;
    viewport.append(board);
    host.append(viewport);
  }
  if (state.keyboard) { const overlay = document.createElement("div"); overlay.className = "wui-note__overlay overlay"; const start = document.createElement("span"); start.className = "wui-note__start start"; start.textContent = "▸ Click to start"; overlay.append(start); host.append(overlay); }
  root.append(host);
  paintActiveMidis(root, state.activeMidis);
  return root;
}

function paintActiveMidis(root: HTMLElement, midis: readonly number[] | undefined): void {
  const active = new Set(midis ?? []);
  for (const node of root.querySelectorAll<HTMLElement>("[data-midi]")) {
    const pressed = active.has(Number(node.dataset.midi));
    node.classList.toggle("down", pressed);
    node.setAttribute("aria-pressed", String(pressed));
  }
}

/** Capture layout values, including mutable caller arrays, without transient paint state. */
function structureKey(state: NoteSurfaceState): string {
  return JSON.stringify([
    state.layout, Boolean(state.keyboard), state.mapOnly === true,
    state.layout === 'piano' ? (state.piano ?? []).map(({midi, black, left, width}) => [midi, Boolean(black), left, width]) : undefined,
    state.layout === 'grid' ? [state.gridColumns ?? 7, (state.grid ?? []).map(({midi, code}) => [midi, code])] : undefined,
    state.layout === 'chords' ? (state.chords ?? []).map(({index, midis}) => [index, [...(midis ?? [])]]) : undefined,
  ]);
}

function copyState(state: NoteSurfaceState): NoteSurfaceState {
  return {
    ...state,
    activeMidis: state.activeMidis && [...state.activeMidis],
    piano: state.piano?.map((key) => ({...key})),
    grid: state.grid?.map((cell) => ({...cell})),
    chords: state.chords?.map((chord) => ({...chord, midis: chord.midis && [...chord.midis]})),
  };
}

export interface PointerSurfaceOptions {
  /** Root used for hit-testing; playable nodes are scoped to the attached board. */
  root: () => Document | ShadowRoot | undefined;
  /** Selector matching playable nodes carrying `data-midi` or `data-pitch`. */
  keySelector: string;
  /** Called once when the first holder presses a pitch and the last releases it. */
  fire: (pitch: number, on: boolean) => void;
  /** Class toggled while a node is held. Defaults to `down`. */
  downClass?: string;
}

export interface PointerSurfaceHit {
  pitch: number;
  element: HTMLElement;
}

/**
 * Reusable multi-pointer interaction for piano keys, pads and other discrete
 * pitch surfaces. It ref-counts both pitches and nodes, supports drag
 * glissando, and guarantees `releaseAll()` emits every outstanding note-off.
 */
export class PointerSurface {
  private readonly pointerKeys = new Map<number, PointerSurfaceHit | null>();
  private readonly held = new Map<number, number>();
  private readonly elementHeld = new Map<HTMLElement, number>();
  private activeMidis = new Set<number>();
  private board?: HTMLElement;

  constructor(private readonly options: PointerSurfaceOptions) {}

  attach(board: HTMLElement): void {
    if (this.board === board) return;
    this.releaseAll();
    this.detach();
    this.board = board;
    board.addEventListener("pointerdown", this.onDown);
    board.addEventListener("pointermove", this.onMove);
    board.addEventListener("pointerup", this.onUp);
    board.addEventListener("pointercancel", this.onUp);
  }

  detach(): void {
    const board = this.board;
    if (!board) return;
    board.removeEventListener("pointerdown", this.onDown);
    board.removeEventListener("pointermove", this.onMove);
    board.removeEventListener("pointerup", this.onUp);
    board.removeEventListener("pointercancel", this.onUp);
    this.board = undefined;
  }

  /** Repaint caller-held pitches without changing pointer/key holders or firing notes. */
  setActiveMidis(midis: readonly number[] = []): void {
    this.activeMidis = new Set(midis);
    for (const element of this.board?.querySelectorAll<HTMLElement>(this.options.keySelector) ?? []) {
      this.paintPressed(element);
    }
  }

  private paintPressed(element: HTMLElement): void {
    const raw = element.dataset.pitch ?? element.dataset.midi;
    const pressed = (this.elementHeld.get(element) ?? 0) > 0 || (raw != null && this.activeMidis.has(Number(raw)));
    element.classList.toggle(this.options.downClass ?? 'down', pressed);
    element.setAttribute('aria-pressed', String(pressed));
  }

  private hitAt(event: PointerEvent): PointerSurfaceHit | null {
    const node = this.options.root()?.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const element = node?.closest?.(this.options.keySelector) as HTMLElement | null;
    if (!element || !this.board?.contains(element)) return null;
    const raw = element.dataset.pitch ?? element.dataset.midi;
    if (raw == null) return null;
    const pitch = Number(raw);
    return Number.isFinite(pitch) ? {pitch, element} : null;
  }

  private keyElement(pitch: number): HTMLElement | null {
    if (!this.board) return null;
    for (const element of this.board.querySelectorAll<HTMLElement>(this.options.keySelector)) {
      const raw = element.dataset.pitch ?? element.dataset.midi;
      if (raw != null && Number(raw) === pitch) return element;
    }
    return null;
  }

  private setDown(element: HTMLElement, on: boolean): void {
    const count = this.elementHeld.get(element) ?? 0;
    if (on) {
      this.elementHeld.set(element, count + 1);
      this.paintPressed(element);
      return;
    }
    if (count <= 1) {
      this.elementHeld.delete(element);
    } else {
      this.elementHeld.set(element, count - 1);
    }
    this.paintPressed(element);
  }

  press(pitch: number, element?: HTMLElement): void {
    const count = this.held.get(pitch) ?? 0;
    this.held.set(pitch, count + 1);
    const target = element ?? this.keyElement(pitch);
    if (target) this.setDown(target, true);
    if (count === 0) this.options.fire(pitch, true);
  }

  release(pitch: number, element?: HTMLElement): void {
    const count = this.held.get(pitch) ?? 0;
    if (count <= 0) return;
    const target = element ?? this.keyElement(pitch);
    if (target) this.setDown(target, false);
    if (count === 1) {
      this.held.delete(pitch);
      this.options.fire(pitch, false);
    } else {
      this.held.set(pitch, count - 1);
    }
  }

  releaseAll(): void {
    const elements = [...this.elementHeld.keys()];
    this.elementHeld.clear();
    for (const element of elements) this.paintPressed(element);
    const sounding = [...this.held.keys()];
    this.held.clear();
    this.pointerKeys.clear();
    for (const pitch of sounding) this.options.fire(pitch, false);
  }

  private sameHit(a: PointerSurfaceHit | null, b: PointerSurfaceHit | null): boolean {
    if (a == null || b == null) return a === b;
    if (a.element === b.element) return true;
    if (a.pitch !== b.pitch) return false;
    const aCode = a.element.dataset.code;
    const bCode = b.element.dataset.code;
    return aCode == null && bCode == null ? true : aCode === bCode;
  }

  private readonly onDown = (event: PointerEvent): void => {
    const hit = this.hitAt(event);
    if (!hit) return;
    try {
      this.board?.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events need not support pointer capture.
    }
    this.pointerKeys.set(event.pointerId, hit);
    this.press(hit.pitch, hit.element);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.pointerKeys.has(event.pointerId)) return;
    const current = this.pointerKeys.get(event.pointerId) ?? null;
    const next = this.hitAt(event);
    if (this.sameHit(current, next)) return;
    const board = this.board;
    if (current) this.release(current.pitch, current.element);
    if (this.board !== board || !this.pointerKeys.has(event.pointerId)) return;
    this.pointerKeys.set(event.pointerId, next);
    if (next) this.press(next.pitch, next.element);
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.pointerKeys.has(event.pointerId)) return;
    const current = this.pointerKeys.get(event.pointerId) ?? null;
    const board = this.board;
    this.pointerKeys.delete(event.pointerId);
    if (current) this.release(current.pitch, current.element);
    try {
      board?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events need not support pointer capture.
    }
  };
}

interface HeldQwertyNote {
  midi: number;
  element?: HTMLElement;
}

/** Presenter-owned pointer, chord and QWERTY lifecycle for a note surface. */
class NoteSurfaceInteractions {
  private root?: HTMLElement;
  private board?: HTMLElement;
  private state?: NoteSurfaceState;
  private readonly cleanups: Array<() => void> = [];
  private readonly pointerChords = new Map<number, number>();
  private readonly keyChords = new Set<number>();
  private readonly qwertyDown = new Map<string, HeldQwertyNote>();
  private readonly surface: PointerSurface;
  private revision = 0;

  constructor(
    private readonly binding: NoteSurfaceInteractionBinding,
    private readonly report: (error: unknown) => void,
  ) {
    this.surface = new PointerSurface({
      root: () => this.root?.getRootNode() as Document | ShadowRoot | undefined,
      keySelector: '.wui-note__key[data-midi],.wui-note__cell[data-midi]',
      fire: (midi, on) => this.command(() => this.binding.setNote(midi, on)),
    });
  }

  attach(root: HTMLElement, board: HTMLElement | undefined, state: NoteSurfaceState): void {
    this.releaseAll();
    this.detach();
    this.root = root;
    this.board = board;
    this.state = state;
    if (!board) return;
    if (state.layout === 'chords') this.attachChords(board);
    else this.surface.attach(board);
    if (state.keyboard) this.attachQwerty(root);
    this.paint(state);
  }

  paint(state: NoteSurfaceState): void {
    this.state = state;
    this.surface.setActiveMidis(state.activeMidis);
  }

  detach(): void {
    this.revision += 1;
    this.surface.detach();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.root = undefined;
    this.board = undefined;
    this.state = undefined;
  }

  releaseAll(): void {
    this.revision += 1;
    this.qwertyDown.clear();
    this.pointerChords.clear();
    this.keyChords.clear();
    for (const chord of this.root?.querySelectorAll<HTMLElement>('.wui-note__chord') ?? []) {
      chord.classList.remove('down');
      chord.setAttribute('aria-pressed', 'false');
    }
    this.surface.releaseAll();
  }

  private command(work: () => void): void {
    try {
      work();
    } catch (error) {
      this.report(error);
    }
  }

  private chord(index: number): NoteChordCell | undefined {
    return this.state?.chords?.find((candidate) => candidate.index === index);
  }

  private chordIndexFrom(element: EventTarget | null): number | null {
    const chord = (element as HTMLElement | null)?.closest?.('.wui-note__chord') as HTMLElement | null;
    if (!chord || !this.board?.contains(chord)) return null;
    const index = Number(chord.dataset.i);
    return Number.isFinite(index) ? index : null;
  }

  private chordIndexAt(event: PointerEvent): number | null {
    const direct = this.chordIndexFrom(event.target);
    if (direct != null) return direct;
    const tree = this.root?.getRootNode() as (Document | ShadowRoot) | undefined;
    return this.chordIndexFrom(tree?.elementFromPoint?.(event.clientX, event.clientY) ?? null);
  }

  private chordHeld(index: number): boolean {
    if (this.keyChords.has(index)) return true;
    for (const held of this.pointerChords.values()) {
      if (held === index) return true;
    }
    return false;
  }

  private setChordPressed(index: number, pressed: boolean): void {
    for (const chord of this.root?.querySelectorAll<HTMLElement>('.wui-note__chord') ?? []) {
      if (Number(chord.dataset.i) !== index) continue;
      chord.classList.toggle('down', pressed);
      chord.setAttribute('aria-pressed', String(pressed));
    }
  }

  private pressChordNotes(index: number): void {
    const revision = this.revision;
    for (const midi of this.chord(index)?.midis ?? []) {
      if (revision !== this.revision || !this.root) return;
      if (Number.isFinite(midi)) this.surface.press(midi);
    }
  }

  private releaseChordNotes(index: number): void {
    const revision = this.revision;
    for (const midi of this.chord(index)?.midis ?? []) {
      if (revision !== this.revision || !this.root) return;
      if (Number.isFinite(midi)) this.surface.release(midi);
    }
  }

  private attachChords(board: HTMLElement): void {
    const onPointerDown = (event: PointerEvent): void => {
      if (this.pointerChords.has(event.pointerId)) return;
      const index = this.chordIndexAt(event);
      if (index == null || !this.chord(index)) return;
      try {
        board.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events need not support pointer capture.
      }
      this.pointerChords.set(event.pointerId, index);
      this.setChordPressed(index, true);
      this.pressChordNotes(index);
    };
    const onPointerUp = (event: PointerEvent): void => {
      const index = this.pointerChords.get(event.pointerId);
      if (index == null) return;
      this.pointerChords.delete(event.pointerId);
      this.releaseChordNotes(index);
      if (!this.chordHeld(index)) this.setChordPressed(index, false);
      try {
        board.releasePointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events need not support pointer capture.
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const index = this.chordIndexFrom(event.target);
      if (index == null || !this.chord(index)) return;
      event.preventDefault();
      if (event.repeat || this.keyChords.has(index)) return;
      this.keyChords.add(index);
      this.setChordPressed(index, true);
      this.pressChordNotes(index);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const index = this.chordIndexFrom(event.target);
      if (index == null) return;
      event.preventDefault();
      this.releaseKeyChord(index);
    };
    const onFocusOut = (event: FocusEvent): void => {
      const index = this.chordIndexFrom(event.target);
      if (index != null) this.releaseKeyChord(index);
    };
    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerUp);
    board.addEventListener('pointerleave', onPointerUp);
    board.addEventListener('keydown', onKeyDown);
    board.addEventListener('keyup', onKeyUp);
    board.addEventListener('focusout', onFocusOut);
    this.cleanups.push(() => {
      board.removeEventListener('pointerdown', onPointerDown);
      board.removeEventListener('pointerup', onPointerUp);
      board.removeEventListener('pointercancel', onPointerUp);
      board.removeEventListener('pointerleave', onPointerUp);
      board.removeEventListener('keydown', onKeyDown);
      board.removeEventListener('keyup', onKeyUp);
      board.removeEventListener('focusout', onFocusOut);
    });
  }

  private releaseKeyChord(index: number): void {
    if (!this.keyChords.delete(index)) return;
    this.releaseChordNotes(index);
    if (!this.chordHeld(index)) this.setChordPressed(index, false);
  }

  private cellForCode(code: string): HTMLElement | undefined {
    for (const cell of this.root?.querySelectorAll<HTMLElement>('.wui-note__cell[data-code]') ?? []) {
      if (cell.dataset.code === code) return cell;
    }
    return undefined;
  }

  private midiForKey(code: string): number | null {
    try {
      const midi = this.binding.midiForKey?.(code);
      return typeof midi === 'number' && Number.isFinite(midi) ? midi : null;
    } catch (error) {
      this.report(error);
      return null;
    }
  }

  private canShiftOctave(delta: -1 | 1): boolean {
    try {
      return this.binding.canShiftOctave?.(delta) ?? true;
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  private attachQwerty(root: HTMLElement): void {
    const onFocus = (): void => root.classList.add('on');
    const onBlur = (): void => {
      root.classList.remove('on');
      this.releaseQwerty();
    };
    const onPointerDown = (): void => root.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      const revision = this.revision;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const code = event.code;
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        const viewport = root.querySelector<HTMLElement>('.wui-note__viewport');
        if (viewport) {
          event.preventDefault();
          viewport.scrollLeft += code === 'ArrowLeft' ? -80 : 80;
          return;
        }
      }
      if (code === 'Escape') {
        root.blur();
        return;
      }
      const shiftsOctave =
        (code === 'KeyZ' || code === 'KeyX') &&
        (this.state?.layout !== 'grid' || this.state.mapOnly !== true) &&
        this.binding.requestOctaveShift !== undefined;
      if (shiftsOctave) {
        event.preventDefault();
        const delta = code === 'KeyX' ? 1 : -1;
        if (!event.repeat && this.canShiftOctave(delta) && revision === this.revision && this.root === root) {
          this.releaseAll();
          if (this.root !== root) return;
          this.command(() => this.binding.requestOctaveShift!(delta));
        }
        return;
      }
      const midi = this.midiForKey(code);
      if (revision !== this.revision || this.root !== root) return;
      if (midi == null || (event.target !== root && this.state?.layout === 'chords')) return;
      event.preventDefault();
      if (event.repeat || this.qwertyDown.has(code)) return;
      const element = this.state?.layout === 'grid' ? this.cellForCode(code) : undefined;
      this.qwertyDown.set(code, {midi, element});
      this.surface.press(midi, element);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const held = this.qwertyDown.get(event.code);
      if (!held) return;
      event.preventDefault();
      this.qwertyDown.delete(event.code);
      this.surface.release(held.midi, held.element);
    };
    root.addEventListener('focus', onFocus);
    root.addEventListener('blur', onBlur);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    this.cleanups.push(() => {
      root.removeEventListener('focus', onFocus);
      root.removeEventListener('blur', onBlur);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('keyup', onKeyUp);
    });
  }

  private releaseQwerty(): void {
    const heldNotes = [...this.qwertyDown.values()];
    this.qwertyDown.clear();
    for (const held of heldNotes) this.surface.release(held.midi, held.element);
  }
}

function noteBoard(root: HTMLElement): HTMLElement | undefined {
  return root.querySelector<HTMLElement>('.board') ?? undefined;
}

/** Mount a note surface, optionally with presenter-owned performance input. */
export function mountNoteSurface(
  host: NoteHost,
  binding: NoteSurfaceBinding,
  options: NoteSurfaceOptions = {},
): NoteSurfaceHandle {
  const document = host.ownerDocument;
  const initialState = copyState(binding.snapshot());
  const style = installStyle(document, 'note', noteStyle, options.stylesheet);
  let root = build(document, initialState);
  let structure = structureKey(initialState);
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  const report = createErrorSink(options.onError);
  const interactions = binding.interaction
    ? new NoteSurfaceInteractions(binding.interaction, report)
    : undefined;
  const isCurrent = (): boolean => !destroyed && claim.isCurrent();
  const paint = (state: NoteSurfaceState): void => {
    const text = readText(options.getText, options.onError);
    if (!isCurrent()) return;
    const hint = root.querySelector<HTMLElement>('.wui-note__hint');
    if (hint) hint.textContent = state.layout === 'grid' && state.mapOnly
      ? textValue(text?.hintMapped, 'Type to play · Esc stop', {}, options.onError)
      : textValue(text?.hint, 'Type to play · Z / X octave · Esc stop', {}, options.onError);
    const start = root.querySelector<HTMLElement>('.wui-note__start');
    if (start) start.textContent = textValue(text?.start, '▸ Click to start', {}, options.onError);
    const viewport = root.querySelector<HTMLElement>('.wui-note__viewport');
    if (viewport) viewport.setAttribute('aria-label', state.layout === 'piano'
      ? textValue(text?.keyboard, 'Note keyboard', {}, options.onError)
      : textValue(text?.grid, 'Note grid', {}, options.onError));
    // Names are presentation data. Updating them must not release a held note
    // or replace a focused chord button whose musical identity did not change.
    root.querySelectorAll<HTMLElement>('.wui-note__key').forEach((node, index) => {
      const text = state.piano?.[index]?.label ?? '';
      let label = node.querySelector<HTMLElement>('.wui-note__key-label');
      if (!label && text) {
        label = document.createElement('span');
        label.className = 'wui-note__key-label keylab';
        node.append(label);
      }
      if (label) { label.textContent = text; label.hidden = !text; }
      if (text) node.title = text;
      else node.removeAttribute('title');
    });
    root.querySelectorAll<HTMLElement>('.wui-note__cell').forEach((node, index) => {
      const text = state.grid?.[index]?.ref ?? '';
      let label = node.querySelector<HTMLElement>('.wui-note__reference');
      if (!label && text) {
        label = document.createElement('span');
        label.className = 'wui-note__reference ref';
        node.append(label);
      }
      if (label) { label.textContent = text; label.hidden = !text; }
      if (text) node.dataset.ref = text;
      else delete node.dataset.ref;
    });
    root.querySelectorAll<HTMLElement>('.wui-note__chord').forEach((node, index) => {
      const label = node.firstElementChild;
      if (label) label.textContent = state.chords?.[index]?.label ?? '';
    });
    const octave = root.querySelector<HTMLElement>('.wui-note__octave');
    if (octave) octave.textContent = state.octaveLabel ?? '';
    if (interactions) interactions.paint(state);
    else paintActiveMidis(root, state.activeMidis);
  };
  const loop = createUpdateLoop({
    name: 'Note surface',
    isCurrent,
    report,
    pass: () => {
      try {
        const state = copyState(binding.snapshot());
        if (!isCurrent()) return;
        const nextStructure = structureKey(state);
        if (nextStructure === structure) {
          paint(state);
          return;
        }
        // Build successfully before ending a performance. Held notes use the
        // copied old mapping until release, even if the caller mutated arrays.
        const next = build(document, state);
        const tree = root.getRootNode() as Document | ShadowRoot;
        const focused = root.contains(tree.activeElement);
        interactions?.detach();
        interactions?.releaseAll();
        if (!isCurrent()) return;
        root.replaceWith(next);
        root = next;
        structure = nextStructure;
        interactions?.attach(root, noteBoard(root), state);
        paint(state);
        if (focused && state.keyboard) root.focus();
      } catch (error) {
        report(error);
      }
    },
  });
  const update = loop.run;

  const handle: NoteSurfaceHandle = {
    get element() {
      return root;
    },
    get board() {
      return noteBoard(root);
    },
    releaseAll(): void {
      interactions?.releaseAll();
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loop.cancel();
      interactions?.detach();
      interactions?.releaseAll();
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  // Claim before caller cleanup: a replacement mounted there takes precedence.
  const claim = claimHost(mounted, host, handle);
  claim.destroyPrevious();
  if (!isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!isCurrent()) {
    handle.destroy();
    return handle;
  }
  interactions?.attach(root, noteBoard(root), initialState);
  // Previous teardown can change the caller's state after the initial read.
  update();
  if (isCurrent() && binding.subscribe) {
    try {
      const cleanup = binding.subscribe(update);
      // A synchronous notification can dispose or remount before setup returns.
      if (isCurrent()) unsubscribe = cleanup;
      else cleanup();
    } catch (error) {
      report(error);
    }
  }
  return handle;
}
