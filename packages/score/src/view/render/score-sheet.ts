import {
  NoteId, Rational, ScoreEditError, VoiceId, makeId,
  type Clef, type Note, type Part, type Score, type ScoreDraftResult, type ScoreEditOperation, type ScoreEditResult,
} from '../../core';
import type {Step} from '../../core/types/pitch';
import {scoreToNoteSequence, secondsToQuarters} from '../core/note-sequence';
import {projectStaffNotation} from '../core/staff-notation';
import {staffOf} from '../core/edit-notation';
import type {ScoreViewEditing} from '../headless/score-editing';
import {STAFF_SYSTEM_INDENT, StaffSVGVisualizer} from './renderers/staff';

/** Editing features a sheet can offer. Selection and navigation are always available while editing. */
export type ScoreSheetFeature = 'pitch' | 'input' | 'duration' | 'tie' | 'accidental' | 'delete' | 'history' | 'zoom';
export const SCORE_SHEET_FEATURES: readonly ScoreSheetFeature[] = Object.freeze(['pitch', 'input', 'duration', 'tie', 'accidental', 'delete', 'history', 'zoom']);
/** `page`: paper pages with margins and a title; `flow`: systems fill the element width. */
export type ScoreSheetLayout = 'page' | 'flow';
export const SCORE_SHEET_LAYOUTS: readonly ScoreSheetLayout[] = Object.freeze(['page', 'flow']);
/** Written note value used by note input and duration changes. */
export type ScoreSheetDuration = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';
export const SCORE_SHEET_DURATIONS: readonly ScoreSheetDuration[] = Object.freeze(['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th']);

/** Sheet state a user can change from the toolbar or keyboard. Every value is also an option. */
export interface ScoreSheetSettings {
  readonly layout: ScoreSheetLayout;
  /** Staff size relative to the default; 0 fits a page to the element width (page layout only). */
  readonly zoom: number;
  /** Note input mode: letters write notes at the input cursor. */
  readonly inputMode: boolean;
  /** Note value for input. */
  readonly duration: ScoreSheetDuration;
  /** Dotted input note value. */
  readonly dotted: boolean;
}

export interface ScoreSheetOptions extends Partial<ScoreSheetSettings> {
  /** Available editing features; defaults to all of them. */
  features?: readonly ScoreSheetFeature[];
  /** Keep the sounding system in view during playback. */
  followPlayback?: boolean;
  noteColor?: string;
  activeNoteColor?: string;
  onPreview?(result: Extract<ScoreDraftResult, {status: 'preview'}>): void;
  onCommit?(result: Extract<ScoreEditResult, {status: 'committed'}>): void;
  onError?(error: unknown): void;
  /** A toolbar or keyboard change; programmatic `configure` calls do not report. */
  onSettingsChange?(settings: ScoreSheetSettings, changed: keyof ScoreSheetSettings): void;
}

/** What the sheet draws: a fixed score, or a borrowed View editing controller. */
export type ScoreSheetContent = {readonly score: Score} | {readonly editing: ScoreViewEditing};

/**
 * Playback overlay. `seconds` is the nominal score position; null hides it.
 * Without `activeNoteIds`, notes sounding at that position are derived from the score.
 */
export interface ScoreSheetPlayback {
  readonly seconds: number | null;
  readonly activeNoteIds?: ReadonlySet<string>;
}

export interface ScoreSheetHandle {
  readonly element: HTMLElement;
  readonly settings: ScoreSheetSettings;
  readonly features: readonly ScoreSheetFeature[];
  /** Number of engraved systems and pages (pages are 1 in flow layout). */
  readonly layoutInfo: {readonly systems: number; readonly pages: number};
  /** Apply settings or features. Invalid values throw before anything changes. */
  configure(options: Partial<ScoreSheetSettings> & {features?: readonly ScoreSheetFeature[]; followPlayback?: boolean}): void;
  updatePlayback(playback?: ScoreSheetPlayback): void;
  cancel(): void;
  dispose(): void;
}

const DURATION_QUARTERS: Record<ScoreSheetDuration, readonly [number, number]> = {
  whole: [4, 1], half: [2, 1], quarter: [1, 1], eighth: [1, 2], '16th': [1, 4], '32nd': [1, 8], '64th': [1, 16],
};
/** MuseScore-style number keys: 1 = 64th … 7 = whole. */
const DURATION_KEYS: Record<string, ScoreSheetDuration> = {1: '64th', 2: '32nd', 3: '16th', 4: 'eighth', 5: 'quarter', 6: 'half', 7: 'whole'};
const DURATION_LABELS: Record<ScoreSheetDuration, string> = {
  whole: 'Whole note', half: 'Half note', quarter: 'Quarter note', eighth: 'Eighth note', '16th': 'Sixteenth note', '32nd': 'Thirty-second note', '64th': 'Sixty-fourth note',
};
const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_CLASS: Record<Step, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
/** A4 at a 1.75 mm staff space: 120 spaces wide, 10 staff units per space. */
const PAGE = {width: 1200, height: 1697, margin: 86, title: 110};
const SYSTEM_GAP = 26;
const ZOOM_RANGE = [.5, 3] as const;
const ZOOM_STEP = 1.2;
/**
 * Zoom per wheel delta pixel. Chromium reports a trackpad pinch as Ctrl+wheel
 * with deltaY = −100 × ln(scale), so this rate follows the fingers; one
 * event's delta is clamped so a mouse wheel notch zooms about 1.5×.
 */
const WHEEL_ZOOM_RATE = .01;
const WHEEL_ZOOM_CLAMP = 40;
/** Trailing delays: report a continuous zoom, and re-break flow lines after it settles. */
const SETTINGS_REPORT_MS = 150;
const FLOW_SETTLE_MS = 250;

// ---------------------------------------------------------------- pitch helpers

function keyAlter(fifths: number, step: Step): number {
  const index = SHARP_ORDER.indexOf(step);
  if (fifths > 0) return index < fifths ? 1 : 0;
  if (fifths < 0) return 6 - index < -fifths ? -1 : 0;
  return 0;
}

type WrittenPitch = {step: Step; alter: -2 | -1 | 0 | 1 | 2; octave: number};

/** Spell a MIDI pitch: in the key first, then natural, then sharp going up and flat going down. */
export function spellPitch(midi: number, fifths: number, direction: 1 | -1): WrittenPitch {
  const options: WrittenPitch[] = [];
  for (const step of STEPS) for (const alter of [-1, 0, 1] as const) {
    if ((((STEP_CLASS[step] + alter) % 12) + 12) % 12 !== ((midi % 12) + 12) % 12) continue;
    options.push({step, alter, octave: Math.floor((midi - alter - STEP_CLASS[step]) / 12) - 1});
  }
  return options.find((pitch) => pitch.alter === keyAlter(fifths, pitch.step))
    ?? options.find((pitch) => pitch.alter === 0)
    ?? options.find((pitch) => pitch.alter === direction) ?? options[0];
}

function diatonicIndex(pitch: {step: Step; octave: number}): number { return pitch.octave * 7 + STEPS.indexOf(pitch.step); }
function fromDiatonic(index: number, fifths: number): WrittenPitch {
  const step = STEPS[((index % 7) + 7) % 7];
  return {step, alter: keyAlter(fifths, step) as WrittenPitch['alter'], octave: Math.floor(index / 7)};
}
function midiOf(pitch: WrittenPitch): number { return (pitch.octave + 1) * 12 + STEP_CLASS[pitch.step] + pitch.alter; }

/** Diatonic index of a clef's top staff line. */
function topLineIndex(clef: Clef): number {
  const line = clef.line ?? (clef.sign === 'F' ? 4 : clef.sign === 'C' ? 3 : 2);
  const anchor = clef.sign === 'F' ? diatonicIndex({step: 'F', octave: 3}) : clef.sign === 'C' ? diatonicIndex({step: 'C', octave: 4}) : diatonicIndex({step: 'G', octave: 4});
  return anchor + (5 - line) * 2 + 7 * (clef.octaveChange ?? 0);
}

// -------------------------------------------------------------------- chrome

const ICONS: Record<string, string> = {
  select: '<path d="M6 4v15l4-4 3 6 2-1-3-6h6z"/>',
  input: '<path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/>',
  dot: '<path d="M11 11h2v2h-2z"/><path d="M10 10h4v4h-4z"/>',
  rest: '<path d="M10 4l4 5-3 4 3 4c-2-1-4 0-3 3-3-2-2-6 1-5l-3-4 2-3z"/>',
  flat: '<path d="M8 3v17c4-1 8-3 8-7 0-3-4-3-8 0"/>',
  natural: '<path d="M8 3v13l8-3M16 21V8L8 11"/>',
  sharp: '<path d="M10 3v18M15 3v18M6 10l12-3M6 17l12-3"/>',
  tie: '<path d="M4 14c4 5 12 5 16 0"/><path d="M5 14c4 3.5 10 3.5 14 0"/>',
  delete: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  undo: '<path d="M9 14l-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>',
  'zoom-out': '<path d="M5 12h14"/>',
  'zoom-in': '<path d="M5 12h14M12 5v14"/>',
  page: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  flow: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  whole: '<path d="M7 12a5 3.2 0 1 0 10 0a5 3.2 0 1 0-10 0z"/>',
  half: '<path d="M6 16a4 2.6 0 1 0 8 0a4 2.6 0 1 0-8 0z"/><path d="M14 16V3"/>',
  quarter: '<path d="M6 16a4 2.6 0 1 0 8 0a4 2.6 0 1 0-8 0z" fill="currentColor"/><path d="M14 16V3"/>',
  eighth: '<path d="M6 16a4 2.6 0 1 0 8 0a4 2.6 0 1 0-8 0z" fill="currentColor"/><path d="M14 16V3c0 3 5 4 5 8"/>',
  '16th': '<path d="M6 17a4 2.6 0 1 0 8 0a4 2.6 0 1 0-8 0z" fill="currentColor"/><path d="M14 17V3c0 3 5 3 5 6M14 7c0 3 5 3 5 6"/>',
  '32nd': '<path d="M6 18a4 2.6 0 1 0 8 0a4 2.6 0 1 0-8 0z" fill="currentColor"/><path d="M14 18V2c0 2 5 2 5 5M14 6c0 2 5 2 5 5M14 10c0 2 5 2 5 5"/>',
  '64th': '<path d="M6 19a4 2.6 0 1 0 8 0a4 2.6 0 1 0-8 0z" fill="currentColor"/><path d="M14 19V2c0 2 4 2 4 4M14 5c0 2 4 2 4 4M14 8c0 2 4 2 4 4M14 11c0 2 4 2 4 4"/>',
};

/**
 * Scoped sheet stylesheet. Values resolve through the kit's public tokens to the
 * shared neutral palette, square radius and 2rem control height. `:where()`
 * keeps every rule at zero specificity so application CSS wins.
 */
const SHEET_STYLE = `
:where([data-score-sheet]) {
  --ss-ink: var(--wm-foreground, light-dark(#111, #eee));
  --ss-muted: var(--wm-foreground-muted, light-dark(#777, #aaa));
  --ss-line: var(--wm-control-border, var(--wm-border, light-dark(#d8d8d8, #333)));
  --ss-surface: var(--wm-surface, light-dark(#fff, #111));
  --ss-raised: var(--wm-surface-muted, light-dark(#f3f3f3, #1c1c1c));
  --ss-on-ink: var(--wm-accent-foreground, light-dark(#fff, #111));
  --ss-paper: var(--wm-score-sheet-paper, var(--ss-surface));
  --ss-desk: var(--wm-score-sheet-background, var(--ss-raised));
  --ss-control: var(--wm-control-size, 2rem);
  --ss-mono: var(--wm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  color: var(--ss-ink); background: var(--ss-surface);
  border: var(--wm-component-border, 1px solid var(--ss-line)); border-radius: var(--wm-component-radius, var(--wm-control-radius, 0));
}
:where([data-score-sheet] [part~="toolbar"]) {
  display: flex; flex-wrap: nowrap; align-items: stretch; min-width: 0; height: var(--ss-control); flex: none;
  overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--ss-line);
}
:where([data-score-sheet] [part~="toolbar"])::-webkit-scrollbar, :where([data-score-sheet] [part~="viewport"])::-webkit-scrollbar { display: none; }
:where([data-score-sheet] [part~="toolbar-group"]) { display: flex; flex: none; border-right: 1px solid var(--ss-line); }
:where([data-score-sheet] [part~="toolbar-spacer"]) { flex: 1 1 auto; }
:where([data-score-sheet] [part~="toolbar"] button) {
  display: inline-flex; align-items: center; justify-content: center; gap: .25rem; flex: none;
  min-width: var(--ss-control); height: var(--ss-control); padding: 0 .375rem; margin: 0; border: 0; border-radius: 0;
  background: transparent; color: var(--ss-muted); font: 500 .6875rem/1 var(--ss-mono); letter-spacing: .04em; cursor: pointer;
}
:where([data-score-sheet] [part~="toolbar"] button:hover) { color: var(--ss-ink); background: var(--ss-raised); }
:where([data-score-sheet] [part~="toolbar"] button[aria-pressed="true"], [data-score-sheet] [part~="toolbar"] button[aria-expanded="true"]) {
  color: var(--ss-on-ink); background: var(--ss-ink);
}
:where([data-score-sheet] [part~="toolbar"] button:disabled) { opacity: .3; cursor: default; background: transparent; color: var(--ss-muted); }
:where([data-score-sheet] button:focus-visible, [data-score-sheet] [part~="viewport"]:focus-visible) {
  outline: var(--wm-focus-ring, 2px solid var(--ss-ink)); outline-offset: -2px;
}
:where([data-score-sheet] [part~="toolbar"] svg, [data-score-sheet] [part~="card"] svg) {
  width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: square; stroke-linejoin: miter;
}
:where([data-score-sheet] [part~="message"]) {
  display: flex; align-items: center; flex: 0 1 auto; min-width: 0; padding: 0 .5rem; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; color: var(--ss-muted); font: .6875rem/1 var(--ss-mono); text-transform: uppercase; letter-spacing: .06em;
}
:where([data-score-sheet] [part~="viewport"]) {
  position: relative; flex: 1 1 auto; min-width: 0; overflow: auto; scrollbar-width: none;
  max-height: var(--wm-score-sheet-max-height, 40rem); background: var(--ss-desk); outline: none;
}
:where([data-score-sheet][data-layout="flow"] [part~="viewport"]) { background: var(--ss-paper); }
:where([data-score-sheet] [part~="pages"]) { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1rem; width: max-content; min-width: 100%; box-sizing: border-box; }
:where([data-score-sheet][data-layout="flow"] [part~="pages"]) { padding: .5rem 0; gap: 0; }
:where([data-score-sheet] [part~="page"]) { position: relative; flex: none; background: var(--ss-paper); border: 1px solid var(--ss-line); box-sizing: content-box; }
:where([data-score-sheet][data-layout="flow"] [part~="page"]) { border: 0; }
:where([data-score-sheet] [part~="system"]) { position: absolute; }
:where([data-score-sheet] [part~="title"]) {
  position: absolute; left: 0; right: 0; text-align: center; color: var(--ss-ink);
  font: 400 1.6em/1.2 var(--wm-score-sheet-text-font, Georgia, 'Times New Roman', serif);
}
:where([data-score-sheet] [part~="composer"]) {
  position: absolute; text-align: right; color: var(--ss-ink); font: 400 .9em/1.2 var(--wm-score-sheet-text-font, Georgia, 'Times New Roman', serif);
}
:where([data-score-sheet] [part~="selection"]) {
  position: absolute; pointer-events: none; box-sizing: border-box;
  border: 1px solid var(--ss-ink); background: color-mix(in srgb, var(--ss-ink) 14%, transparent);
}
:where([data-score-sheet] [data-note-id]) { cursor: default; }
:where([data-score-sheet][data-editable] [data-note-id]) { cursor: pointer; }
:where([data-score-sheet] [part~="overlay"]) {
  position: absolute; inset: var(--ss-control) 0 0 0; display: flex; justify-content: center; align-items: flex-start;
  padding: .75rem; background: var(--wm-score-sheet-scrim, rgb(0 0 0 / .45)); z-index: 2;
}
:where([data-score-sheet] [part~="card"]) {
  width: min(100%, 20rem); background: var(--ss-surface); border: 1px solid var(--ss-line); box-shadow: 0 8px 24px rgb(0 0 0 / .18);
}
:where([data-score-sheet] [part~="card-header"]) {
  display: flex; align-items: center; justify-content: space-between; height: var(--ss-control); padding-left: .5rem;
  border-bottom: 1px solid var(--ss-line);
}
:where([data-score-sheet] [part~="card-header"] h2) {
  margin: 0; font: 500 .6875rem/1 var(--ss-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ss-muted);
}
:where([data-score-sheet] [part~="card"] button) {
  display: inline-flex; align-items: center; justify-content: center; gap: .375rem; height: var(--ss-control); min-width: var(--ss-control);
  margin: 0; padding: 0 .5rem; border: 0; border-radius: 0; background: transparent; color: var(--ss-ink); font: .6875rem/1 var(--ss-mono); cursor: pointer;
}
:where([data-score-sheet] [part~="card"] button:hover) { background: var(--ss-raised); }
:where([data-score-sheet] [part~="card"] [part~="duration-option"][aria-pressed="true"]) { background: var(--ss-ink); color: var(--ss-on-ink); }
:where([data-score-sheet] [part~="duration-options"]) { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--ss-line); }
:where([data-score-sheet] [part~="duration-options"] > *) { background: var(--ss-surface); }
:where([data-score-sheet] [part~="offscreen"]) {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
`;

// ------------------------------------------------------------------ lanes

interface SheetEvent { readonly notes: readonly Note[]; readonly onset: Rational; readonly end: Rational }
interface Lane { readonly part: Part; readonly partIndex: number; readonly staff: number; readonly voice: string; readonly events: readonly SheetEvent[] }

/** Events (chords and rests) per part, staff and voice, in time order. */
function buildLanes(score: Score): Map<string, Lane> {
  const lanes = new Map<string, Lane>();
  score.parts.forEach((part, partIndex) => {
    const groups = new Map<string, Map<string, Note[]>>();
    for (const note of part.notes) {
      if (note.grace) continue;
      const key = JSON.stringify([part.id, staffOf(note, part), note.voice]);
      const lane = groups.get(key) ?? new Map<string, Note[]>();
      const at = note.onsetQuarters.toString();
      lane.set(at, [...lane.get(at) ?? [], note]);
      groups.set(key, lane);
    }
    for (const [key, events] of groups) {
      const [, staff, voice] = JSON.parse(key) as [string, number, string];
      lanes.set(key, {part, partIndex, staff, voice, events: [...events.values()].map((notes) => ({notes, onset: notes[0].onsetQuarters,
        end: notes.reduce((latest, note) => note.offsetQuarters.gt(latest) ? note.offsetQuarters : latest, notes[0].offsetQuarters)}))
        .sort((a, b) => a.onset.cmp(b.onset))});
    }
  });
  return lanes;
}
const laneKey = (partId: string, staff: number, voice: string) => JSON.stringify([partId, staff, voice]);

interface InputCursor { partIndex: number; staff: number; voice: string; quarter: Rational }

interface SystemView {
  visualizer: StaffSVGVisualizer;
  readonly host: HTMLDivElement;
  readonly page: HTMLDivElement;
  readonly start: number;
  readonly end: number;
  readonly startQuarter: number;
  readonly endQuarter: number;
  /** Justified to the line width (every system but a short last one). */
  readonly justify: boolean;
  /** Logical top of the first system on its page, where restacking starts. */
  readonly pageTop: number;
}

/** Geometry shared by every system of one engraving. */
interface SheetGeometry {
  readonly scale: number;
  readonly lineWidth: number;
  readonly margin: number;
  readonly config: {noteHeight: number; noteColor?: string; activeNoteColor?: string};
}

interface Drag { pointerId: number; note: Note; y: number; steps: number; revision: number }

/**
 * Engrave a score as pages of systems and, with an editable borrowed
 * controller, edit it the way a notation editor does: select notes and
 * rests, move pitches, write notes in input mode and change durations.
 */
export function mountScoreSheet(host: HTMLElement, content: ScoreSheetContent, options: ScoreSheetOptions = {}): ScoreSheetHandle {
  const document = host.ownerDocument;
  const editing = 'editing' in content ? content.editing : undefined;
  let features = parseFeatures(options.features ?? SCORE_SHEET_FEATURES);
  let settings = normalizeSettings({layout: 'page', zoom: 0, inputMode: false, duration: 'quarter', dotted: false}, options);
  let followPlayback = options.followPlayback ?? false;
  let disposed = false;
  let systems: SystemView[] = [];
  let pageCount = 0;
  let engraved: Score | undefined;
  let tempos: ReturnType<typeof scoreToNoteSequence>['tempos'] = [];
  let geometry: SheetGeometry | undefined;
  let lanes = new Map<string, Lane>();
  let projection: ReturnType<typeof projectStaffNotation> | undefined;
  let playback: ScoreSheetPlayback | undefined;
  let cursor: InputCursor | undefined;
  let anchor: NoteId | undefined;
  let drag: Drag | undefined;
  let lastWidth = 0;
  /**
   * Visual zoom over the engraved scale. Zoom is shown with CSS `zoom` on the
   * pages, so notation stays vector-sharp and nothing re-engraves while it
   * changes; page layout never re-engraves for zoom (its line breaks do not
   * depend on it), flow layout re-breaks once the zoom settles.
   */
  let cssZoom = 1;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let reportTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingZoom: {factor: number; x: number; y: number} | undefined;
  let gestureScale = 1;
  /**
   * A continuous zoom previews as a compositor-only transform of the pages,
   * pinned at the anchor, and lays out once when it settles: changing CSS
   * `zoom` every frame re-lays out and repaints every engraved page.
   */
  let preview: {x: number; y: number; contentX: number; contentY: number; from: number} | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let openCard: 'duration' | undefined;

  const root = document.createElement('section');
  root.dataset.scoreSheet = '';
  root.setAttribute('part', 'sheet');
  root.setAttribute('aria-label', 'Score sheet');
  const style = document.createElement('style');
  style.textContent = SHEET_STYLE;
  const toolbar = document.createElement('div');
  toolbar.setAttribute('part', 'toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Notation editing');
  const viewport = document.createElement('div');
  viewport.setAttribute('part', 'viewport');
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', 'Score pages');
  const pages = document.createElement('div');
  pages.setAttribute('part', 'pages');
  viewport.append(pages);
  const instructions = document.createElement('p');
  instructions.id = makeId('score-sheet-help');
  instructions.setAttribute('part', 'offscreen');
  instructions.textContent = 'Click a note or rest to select it. Arrow keys move between notes and change pitch. Press N for note input, then A to G to write notes, 1 to 7 to choose a duration and 0 for a rest.';
  const live = document.createElement('p');
  live.setAttribute('part', 'offscreen');
  live.setAttribute('role', 'status');
  root.append(style, toolbar, viewport, instructions, live);
  host.append(root);

  // ---- toolbar
  const buttons = new Map<string, HTMLButtonElement>();
  const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const button = (name: string, label: string, run: () => void, part = 'tool-button'): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.setAttribute('part', part);
    element.dataset.sheetAction = name;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.innerHTML = icon(name);
    element.addEventListener('click', () => { run(); });
    buttons.set(name, element);
    return element;
  };
  const group = (...children: HTMLElement[]) => {
    const element = document.createElement('div');
    element.setAttribute('part', 'toolbar-group');
    element.append(...children);
    return element;
  };
  const modeGroup = group(button('select', 'Select (Escape)', () => setSetting('inputMode', false)),
    button('input', 'Note input (N)', () => setSetting('inputMode', true)));
  const durationButton = button('duration', 'Note value', () => toggleCard('duration'), 'duration-button');
  durationButton.setAttribute('aria-haspopup', 'dialog');
  const durationGroup = group(durationButton, button('dot', 'Dot (.)', () => toggleDot()), button('rest', 'Rest (0)', () => restAction()));
  const accidentalGroup = group(button('flat', 'Flat', () => accidental(-1)), button('natural', 'Natural', () => accidental(0)), button('sharp', 'Sharp', () => accidental(1)));
  const tieGroup = group(button('tie', 'Tie (+)', () => tieAction()));
  const deleteGroup = group(button('delete', 'Delete (Del)', () => deleteSelection()));
  const historyGroup = group(button('undo', 'Undo', () => history('undo')), button('redo', 'Redo', () => history('redo')));
  const messageLine = document.createElement('div');
  messageLine.setAttribute('part', 'message');
  messageLine.setAttribute('role', 'status');
  const spacer = document.createElement('div');
  spacer.setAttribute('part', 'toolbar-spacer');
  const zoomGroup = group(button('zoom-out', 'Zoom out', () => zoomBy(1 / ZOOM_STEP)), button('zoom-in', 'Zoom in', () => zoomBy(ZOOM_STEP)),
    button('page', 'Page view', () => setSetting('layout', 'page')), button('flow', 'Continuous view', () => setSetting('layout', 'flow')));
  toolbar.append(modeGroup, durationGroup, accidentalGroup, tieGroup, deleteGroup, historyGroup, messageLine, spacer, zoomGroup);

  // ---- duration card
  const overlay = document.createElement('div');
  overlay.setAttribute('part', 'overlay');
  overlay.hidden = true;
  overlay.style.display = 'none';
  const card = document.createElement('div');
  card.setAttribute('part', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', `${instructions.id}-duration`);
  const header = document.createElement('div');
  header.setAttribute('part', 'card-header');
  const heading = document.createElement('h2');
  heading.id = `${instructions.id}-duration`;
  heading.textContent = 'Note value';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('part', 'card-close');
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = icon('close');
  close.addEventListener('click', () => closeCard());
  header.append(heading, close);
  const options$ = document.createElement('div');
  options$.setAttribute('part', 'duration-options');
  const durationOptions = SCORE_SHEET_DURATIONS.map((value, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('part', 'duration-option');
    option.dataset.duration = value;
    option.setAttribute('aria-label', `${DURATION_LABELS[value]} (${7 - index})`);
    option.title = DURATION_LABELS[value];
    option.innerHTML = icon(value);
    option.addEventListener('click', () => { chooseDuration(value); closeCard(); });
    return option;
  });
  options$.append(...durationOptions);
  card.append(header, options$);
  overlay.append(card);
  root.append(overlay);
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) closeCard(); });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeCard(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [close, ...durationOptions];
    const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
    event.preventDefault();
    focusable[next].focus();
  });

  // ---- state helpers
  const state = () => editing?.state;
  const canEdit = () => Boolean(editing && editing.state.available && editing.state.editable);
  const has = (feature: ScoreSheetFeature) => features.includes(feature);
  const score = (): Score | undefined => editing ? (editing.state.available ? editing.state.interaction.draft?.content ?? editing.state.document.content : undefined) : (content as {score: Score}).score;
  const committed = (): Score | undefined => editing?.state.available ? editing.state.document.content : score();
  const selected = (): readonly NoteId[] => editing?.state.available ? editing.state.interaction.selectedNoteIds : [];
  const show = (node: HTMLElement, shown: boolean) => { node.hidden = !shown; node.style.display = shown ? '' : 'none'; };
  const say = (text: string) => { live.textContent = text; };
  const flash = (text: string) => { messageLine.textContent = text; messageLine.title = text; };

  function fail(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    flash(text);
    say(text);
    options.onError?.(error);
  }

  function run(label: string, operations: readonly ScoreEditOperation[], select?: readonly NoteId[]): boolean {
    if (!editing || !canEdit()) return false;
    const result = editing.execute(label, operations);
    if (result.status === 'failed') { fail(result.error); return false; }
    flash('');
    if (result.status === 'committed') options.onCommit?.(result);
    if (select) editing.select(select.filter((id) => editing.state.document.content.getNote(id)));
    return true;
  }

  function keyFifths(quarter: Rational | number): number {
    const at = typeof quarter === 'number' ? quarter : quarter.toFloat();
    const measures = projection?.measures ?? [];
    const measure = measures.find((candidate) => candidate.startQuarters.toFloat() <= at && at < candidate.endQuarters.toFloat()) ?? measures[measures.length - 1];
    return measure?.keySignature.fifths ?? 0;
  }

  function laneOfNote(note: Note): Lane | undefined {
    const part = committed()?.parts.find((candidate) => candidate.notes.some((other) => other.id === note.id));
    return part ? lanes.get(laneKey(part.id, staffOf(note, part), note.voice)) : undefined;
  }

  // ---- engraving
  function zoomScale(width: number): number {
    if (settings.layout === 'page') {
      if (settings.zoom > 0) return settings.zoom * .7;
      return Math.max(.3, (width - 32) / (PAGE.width + 2));
    }
    return (settings.zoom > 0 ? settings.zoom : 1) * .8;
  }

  function disposeSystems(): void {
    for (const system of systems) system.visualizer.dispose();
    systems = [];
    pages.replaceChildren();
  }

  function engrave(): void {
    if (disposed) return;
    const source = score();
    const scrollTop = viewport.scrollTop;
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = undefined;
    cssZoom = 1;
    pages.style.zoom = '';
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    previewTimer = undefined;
    preview = undefined;
    pages.style.transform = pages.style.transformOrigin = pages.style.willChange = '';
    disposeSystems();
    engraved = source;
    lanes = source ? buildLanes(committed() ?? source) : new Map();
    if (!source || !source.parts.length) { projection = undefined; pageCount = 0; return; }
    const width = viewport.clientWidth || host.getBoundingClientRect().width || 800;
    lastWidth = width;
    root.dataset.layout = settings.layout;
    const scale = zoomScale(width);
    const sequence = scoreToNoteSequence(source);
    tempos = sequence.tempos;
    projection = projectStaffNotation(source, {});
    const config = {noteHeight: scale * 10, noteColor: options.noteColor, activeNoteColor: options.activeNoteColor};
    const scratch = document.createElement('div');
    const natural = new StaffSVGVisualizer(sequence, scratch, config, source,
      {start: 0, end: projection.measures.length, measureOnly: true, projection}).measureWidths();
    const pageWidth = settings.layout === 'page' ? PAGE.width : Math.max(300, (width - 2) / scale);
    const margin = settings.layout === 'page' ? PAGE.margin : 8;
    const lineWidth = pageWidth - 2 * margin;
    // A system restates its clef and key; reserve their width when breaking lines.
    const opening = 90 + Math.abs(projection.measures[0]?.keySignature.fifths ?? 0) * 10;
    const breaks: Array<[number, number]> = [];
    let start = 0;
    let used = opening;
    for (let index = 0; index < natural.length; index += 1) {
      if (index > start && used + natural[index] > lineWidth) { breaks.push([start, index]); start = index; used = opening; }
      used += natural[index];
    }
    if (start < natural.length) breaks.push([start, natural.length]);

    geometry = {scale, lineWidth, margin, config};
    let page: HTMLDivElement | undefined;
    let y = 0;
    let pageTop = 0;
    const pageHeight = PAGE.height;
    const newPage = (first: boolean) => {
      page = document.createElement('div');
      page.setAttribute('part', 'page');
      page.style.width = `${pageWidth * scale}px`;
      if (settings.layout === 'page') page.style.height = `${pageHeight * scale}px`;
      pages.append(page);
      y = settings.layout === 'page' ? margin : 0;
      if (first && settings.layout === 'page') {
        if (source.title) {
          const title = document.createElement('div');
          title.setAttribute('part', 'title');
          title.textContent = source.title;
          title.style.top = `${margin * scale}px`;
          title.style.fontSize = `${scale * 22}px`;
          page.append(title);
        }
        if (source.composer) {
          const composer = document.createElement('div');
          composer.setAttribute('part', 'composer');
          composer.textContent = source.composer;
          composer.style.top = `${(margin + 62) * scale}px`;
          composer.style.right = `${margin * scale}px`;
          composer.style.fontSize = `${scale * 13}px`;
          page.append(composer);
        }
        if (source.title || source.composer) y += PAGE.title;
      }
      pageTop = y;
    };
    newPage(true);
    for (let index = 0; index < breaks.length; index += 1) {
      const first = breaks[index][0];
      let last = breaks[index][1];
      const element = document.createElement('div');
      element.setAttribute('part', 'system');
      element.dataset.systemStart = String(first);
      element.style.left = `${margin * scale}px`;
      element.style.setProperty('--webscore-staff-cursor', 'color-mix(in srgb, var(--ss-ink) 45%, transparent)');
      // The engraver owns its own box; the system frame positions it on the page.
      const surface = document.createElement('div');
      element.append(surface);
      // Engrave attached, so the ink of every system can be measured for stacking.
      page!.append(element);
      const isLast = index === breaks.length - 1;
      const naturalWidth = opening + natural.slice(first, last).reduce((sum, value) => sum + value, 0);
      // The last system stretches only when it is reasonably full.
      const justify = !isLast || naturalWidth > lineWidth * .6;
      let visualizer = new StaffSVGVisualizer(sequence, surface, config, source,
        {start: first, end: last, width: justify ? lineWidth - STAFF_SYSTEM_INDENT : undefined, projection});
      // An underestimated opening can overflow the line; move its last measure on.
      while (visualizer.systemMetrics.width > lineWidth + 2 && last - first > 1) {
        visualizer.dispose();
        const end = breaks[index][1];
        last -= 1;
        breaks[index] = [first, last];
        // The moved measure opens the next system, or a new one when there is none.
        if (index + 1 < breaks.length) breaks[index + 1] = [last, breaks[index + 1][1]];
        else breaks.push([last, end]);
        visualizer = new StaffSVGVisualizer(sequence, surface, config, source, {start: first, end: last, width: lineWidth - STAFF_SYSTEM_INDENT, projection});
      }
      const height = visualizer.systemMetrics.height;
      if (settings.layout === 'page' && y + height > pageHeight - margin && page!.querySelectorAll('[part~="system"]').length > 1) {
        newPage(false);
        page!.append(element);
      }
      element.style.top = `${y * scale}px`;
      const startQuarter = projection.measures[first].startQuarters.toFloat();
      const endQuarter = projection.measures[last - 1].endQuarters.toFloat();
      systems.push({visualizer, host: element, page: page!, start: first, end: last, startQuarter, endQuarter, justify, pageTop});
      y += height + SYSTEM_GAP;
    }
    if (settings.layout === 'flow' && page) page.style.height = `${y * scale}px`;
    pageCount = pages.childElementCount;
    viewport.scrollTop = scrollTop;
    paintSelection();
    paintCursor();
    paintPlayback(false);
  }

  /**
   * Re-engrave only the systems whose notes changed, keeping the line breaks,
   * then restack. A change to the measure grid, or a system that no longer
   * fits its line or page, falls back to a complete engraving.
   */
  function update(): void {
    const next = score();
    const previous = engraved;
    if (!next || !previous || !geometry || !projection || next.parts.length !== previous.parts.length) { engrave(); return; }
    const nextProjection = projectStaffNotation(next, {});
    if (nextProjection.measures.length !== projection.measures.length) { engrave(); return; }
    const changed: number[] = [];
    for (const part of next.parts) for (const note of part.notes) {
      const before = previous.getNote(note.id);
      if (before === note) continue;
      changed.push(note.onsetQuarters.toFloat());
      if (before) changed.push(before.onsetQuarters.toFloat());
    }
    for (const part of previous.parts) for (const note of part.notes) if (!next.getNote(note.id)) changed.push(note.onsetQuarters.toFloat());
    const stale = systems.filter((system) => changed.some((at) => at >= system.startQuarter && at < system.endQuarter));
    engraved = next;
    projection = nextProjection;
    lanes = buildLanes(committed() ?? next);
    if (stale.length) {
      const sequence = scoreToNoteSequence(next);
      tempos = sequence.tempos;
      const {lineWidth, config} = geometry;
      for (const system of stale) {
        system.visualizer.dispose();
        const surface = document.createElement('div');
        system.host.replaceChildren(surface);
        system.visualizer = new StaffSVGVisualizer(sequence, surface, config, next,
          {start: system.start, end: system.end, width: system.justify ? lineWidth - STAFF_SYSTEM_INDENT : undefined, projection: nextProjection});
        if (system.visualizer.systemMetrics.width > lineWidth + 2) { engrave(); return; }
      }
      if (!restack()) { engrave(); return; }
    }
    paintSelection();
    paintCursor();
    paintPlayback(false);
  }

  /** Recompute system tops page by page; false when a page would overflow. */
  function restack(): boolean {
    if (!geometry) return false;
    const {scale, margin} = geometry;
    let page: HTMLDivElement | undefined;
    let y = 0;
    for (const system of systems) {
      if (system.page !== page) {
        if (page && settings.layout === 'flow') page.style.height = `${y * scale}px`;
        page = system.page;
        y = system.pageTop;
      }
      const height = system.visualizer.systemMetrics.height;
      if (settings.layout === 'page' && y + height > PAGE.height - margin && y > system.pageTop) return false;
      system.host.style.top = `${y * scale}px`;
      y += height + SYSTEM_GAP;
    }
    if (page && settings.layout === 'flow') page.style.height = `${y * scale}px`;
    return true;
  }

  // ---- overlays
  function paintSelection(): void {
    for (const element of pages.querySelectorAll('[part~="selection"]')) element.remove();
    const ids = new Set(selected().map(String));
    if (!ids.size) return;
    for (const system of systems) {
      for (const element of system.host.querySelectorAll<SVGGraphicsElement>('[data-note-id]')) {
        if (!ids.has(element.dataset.noteId!)) continue;
        const box = element.getBoundingClientRect();
        const frame = system.page.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        const mark = document.createElement('div');
        mark.setAttribute('part', 'selection');
        // Client boxes include the CSS zoom; the mark lives inside the zoomed pages.
        mark.style.left = `${(box.left - frame.left) / cssZoom - 2}px`;
        mark.style.top = `${(box.top - frame.top) / cssZoom - 2}px`;
        mark.style.width = `${box.width / cssZoom + 4}px`;
        mark.style.height = `${box.height / cssZoom + 4}px`;
        system.page.append(mark);
      }
    }
  }

  function paintCursor(): void {
    const source = engraved;
    for (const system of systems) {
      if (!cursor || !settings.inputMode || !source) { system.visualizer.setEditingCursor(undefined); continue; }
      const part = source.parts[cursor.partIndex];
      system.visualizer.setEditingCursor(part ? {quarters: cursor.quarter.toFloat(), partId: part.id, staff: cursor.staff} : undefined);
    }
  }

  function paintPlayback(follow: boolean): void {
    const seconds = playback?.seconds;
    for (const system of systems) {
      if (seconds === null || seconds === undefined) system.visualizer.clearActiveNotes();
      else system.visualizer.redrawAtTime(seconds, false);
    }
    if (!follow || seconds === null || seconds === undefined || !engraved) return;
    const quarter = secondsToQuarters(tempos, Math.max(0, seconds));
    const system = systems.find((candidate) => quarter >= candidate.startQuarter && quarter < candidate.endQuarter);
    if (!system) return;
    const box = system.host.getBoundingClientRect();
    const top = box.top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const bottom = top + box.height;
    if (top < viewport.scrollTop || bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, top - 16);
  }

  function scrollIntoView(id: NoteId): void {
    const element = [...pages.querySelectorAll<SVGElement>('[data-note-id]')].find((candidate) => candidate.dataset.noteId === String(id));
    if (!element) return;
    const box = element.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    if (box.top < frame.top + 8) viewport.scrollTop -= frame.top + 24 - box.top;
    else if (box.bottom > frame.bottom - 8) viewport.scrollTop += box.bottom - frame.bottom + 24;
  }

  // ---- toolbar state
  function syncChrome(): void {
    const editable = canEdit();
    root.toggleAttribute('data-editable', editable);
    show(toolbar, editable);
    show(modeGroup, editable && has('input'));
    show(durationGroup, editable && (has('input') || has('duration')));
    show(buttons.get('rest')!, has('input') || has('delete'));
    show(accidentalGroup, editable && has('accidental'));
    show(tieGroup, editable && has('tie'));
    show(deleteGroup, editable && has('delete'));
    show(historyGroup, editable && has('history'));
    show(zoomGroup, editable && has('zoom'));
    buttons.get('select')!.setAttribute('aria-pressed', String(!settings.inputMode));
    buttons.get('input')!.setAttribute('aria-pressed', String(settings.inputMode));
    buttons.get('dot')!.setAttribute('aria-pressed', String(settings.dotted));
    buttons.get('page')!.setAttribute('aria-pressed', String(settings.layout === 'page'));
    buttons.get('flow')!.setAttribute('aria-pressed', String(settings.layout === 'flow'));
    durationButton.innerHTML = icon(settings.duration);
    durationButton.setAttribute('aria-label', `Note value: ${DURATION_LABELS[settings.duration]}${settings.dotted ? ', dotted' : ''}`);
    durationButton.title = durationButton.getAttribute('aria-label')!;
    durationButton.setAttribute('aria-expanded', String(openCard === 'duration'));
    for (const option of durationOptions) option.setAttribute('aria-pressed', String(option.dataset.duration === settings.duration));
    const hasSelection = selected().length > 0;
    for (const name of ['flat', 'natural', 'sharp', 'tie', 'delete']) buttons.get(name)!.disabled = !hasSelection;
    buttons.get('undo')!.disabled = !state()?.history.canUndo;
    buttons.get('redo')!.disabled = !state()?.history.canRedo;
    if (editable) {
      viewport.setAttribute('tabindex', '0');
      viewport.setAttribute('aria-describedby', instructions.id);
    } else {
      viewport.removeAttribute('tabindex');
      viewport.removeAttribute('aria-describedby');
    }
  }

  function toggleCard(kind: 'duration'): void {
    if (openCard === kind) { closeCard(); return; }
    openCard = kind;
    show(overlay, true);
    syncChrome();
    (durationOptions.find((option) => option.dataset.duration === settings.duration) ?? close).focus();
  }

  function closeCard(): void {
    if (!openCard) return;
    openCard = undefined;
    show(overlay, false);
    syncChrome();
    durationButton.focus();
  }

  function setSetting<K extends keyof ScoreSheetSettings>(key: K, value: ScoreSheetSettings[K], report = true): void {
    if (settings[key] === value) return;
    settings = normalizeSettings(settings, {[key]: value} as Partial<ScoreSheetSettings>);
    if (key === 'inputMode') {
      if (settings.inputMode) startCursor();
      else cursor = undefined;
      paintCursor();
    }
    if (key === 'layout') engrave();
    else if (key === 'zoom') showZoom();
    syncChrome();
    if (report) options.onSettingsChange?.(settings, key);
  }

  function zoomBy(factor: number, anchor?: {x: number; y: number}, continuous = false): void {
    const width = viewport.clientWidth || 800;
    const current = settings.zoom > 0 ? settings.zoom : zoomScale(width) / (settings.layout === 'page' ? .7 : .8);
    const next = Math.round(Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], current * factor)) * 1000) / 1000;
    if (next === settings.zoom) return;
    if (!continuous) { zoomAnchor = anchor; setSetting('zoom', next); zoomAnchor = undefined; return; }
    settings = normalizeSettings(settings, {zoom: next});
    previewZoom(anchor);
    syncChrome();
    // A pinch reports once it settles, so the host is not re-rendered per frame.
    if (reportTimer !== undefined) clearTimeout(reportTimer);
    reportTimer = setTimeout(() => { reportTimer = undefined; if (!disposed) options.onSettingsChange?.(settings, 'zoom'); }, SETTINGS_REPORT_MS);
  }

  let zoomAnchor: {x: number; y: number} | undefined;
  /**
   * Show `settings.zoom` by scaling the engraved pages, keeping the point under
   * the anchor (viewport pixels; default the top centre) in place.
   */
  function showZoom(): void {
    if (!geometry || !systems.length) { engrave(); return; }
    const width = viewport.clientWidth || lastWidth || 800;
    // The applied CSS value and the hit-testing factor must be the same number.
    const next = Math.round(zoomScale(width) / geometry.scale * 10_000) / 10_000;
    const x = zoomAnchor?.x ?? width / 2;
    const y = zoomAnchor?.y ?? 0;
    const contentX = (viewport.scrollLeft + x) / cssZoom;
    const contentY = (viewport.scrollTop + y) / cssZoom;
    cssZoom = next;
    pages.style.zoom = Math.abs(next - 1) < 1e-6 ? '' : String(next);
    viewport.scrollLeft = Math.max(0, contentX * next - x);
    viewport.scrollTop = Math.max(0, contentY * next - y);
    paintSelection();
    if (settings.layout !== 'flow') return;
    // Flow lines fill the width at the engraved scale: re-break once the zoom settles.
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = undefined; if (!disposed) engrave(); }, FLOW_SETTLE_MS);
  }

  /** Scale the laid-out pages toward `settings.zoom` without layout, pinned at the gesture's first anchor. */
  function previewZoom(anchor?: {x: number; y: number}): void {
    if (!geometry || !systems.length) { showZoom(); return; }
    const width = viewport.clientWidth || lastWidth || 800;
    if (!preview) {
      const x = anchor?.x ?? width / 2, y = anchor?.y ?? 0;
      // The origin is in the pages' own coordinates, which the CSS zoom scales.
      const box = pages.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
      preview = {x, y, contentX: (frame.left + x - box.left) / cssZoom, contentY: (frame.top + y - box.top) / cssZoom, from: cssZoom};
      pages.style.willChange = 'transform';
      pages.style.transformOrigin = `${preview.contentX}px ${preview.contentY}px`;
    }
    const target = Math.round(zoomScale(width) / geometry.scale * 10_000) / 10_000;
    pages.style.transform = `scale(${target / preview.from})`;
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    previewTimer = setTimeout(settlePreview, SETTINGS_REPORT_MS);
  }

  /** End a preview: lay the pages out at the zoom it reached, keeping its anchor in place. */
  function settlePreview(): void {
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    previewTimer = undefined;
    const ended = preview;
    preview = undefined;
    if (!ended || disposed) return;
    pages.style.transform = '';
    pages.style.transformOrigin = '';
    pages.style.willChange = '';
    zoomAnchor = {x: ended.x, y: ended.y};
    showZoom();
    zoomAnchor = undefined;
  }

  /** Apply wheel and pinch zoom at most once per frame, anchored at the latest pointer. */
  function queueZoom(factor: number, x: number, y: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (pendingZoom) { pendingZoom.factor *= factor; pendingZoom.x = x; pendingZoom.y = y; return; }
    pendingZoom = {factor, x, y};
    const view = document.defaultView;
    const apply = () => {
      const zoomNow = pendingZoom;
      pendingZoom = undefined;
      if (zoomNow && !disposed) zoomBy(zoomNow.factor, {x: zoomNow.x, y: zoomNow.y}, true);
    };
    if (view) view.requestAnimationFrame(apply); else apply();
  }

  // ---- editing actions
  function selectedNotes(): Note[] {
    const source = committed();
    return selected().map((id) => source?.getNote(id)).filter((note): note is Note => Boolean(note));
  }

  function select(ids: readonly NoteId[], announce = true): void {
    if (!editing?.state.available) return;
    editing.select(ids);
    anchor = ids[ids.length - 1];
    if (announce) {
      const note = ids.length ? committed()?.getNote(ids[ids.length - 1]) : undefined;
      say(note ? describe(note) : 'Nothing selected');
    }
    if (ids.length) scrollIntoView(ids[ids.length - 1]);
  }

  function describe(note: Note): string {
    const measure = projection?.measures.find((candidate) => candidate.startQuarters.lte(note.onsetQuarters) && candidate.endQuarters.gt(note.onsetQuarters));
    const value = SCORE_SHEET_DURATIONS.find((name) => new Rational(...DURATION_QUARTERS[name]).eq(note.duration.base)) ?? 'note';
    return `${note.rest ? 'Rest' : note.pitch.toString()}, ${value}${note.duration.dots ? ' dotted' : ''}${measure ? `, measure ${measure.number}` : ''}`;
  }

  function step(direction: 1 | -1): void {
    const note = selectedNotes()[selectedNotes().length - 1];
    if (settings.inputMode && cursor) {
      const lane = lanes.get(laneKey(committed()!.parts[cursor.partIndex].id, cursor.staff, cursor.voice));
      const events = lane?.events ?? [];
      const target = direction > 0 ? events.find((event) => event.onset.gt(cursor!.quarter)) : [...events].reverse().find((event) => event.onset.lt(cursor!.quarter));
      if (target) { cursor.quarter = target.onset; paintCursor(); }
      return;
    }
    if (!note) {
      const first = [...lanes.values()][0]?.events[0];
      if (first) select([first.notes[0].id]);
      return;
    }
    const lane = laneOfNote(note);
    if (!lane) return;
    const index = lane.events.findIndex((event) => event.notes.some((other) => other.id === note.id));
    const target = lane.events[index + direction];
    if (target) select([target.notes[0].id]);
  }

  function respell(notes: readonly Note[], next: (note: Note) => WrittenPitch, label: string): void {
    if (!has('pitch') || !notes.length) return;
    const changes = notes.filter((note) => !note.rest && !note.unpitched).map((note) => ({noteId: note.id, pitch: next(note)}));
    if (changes.length) run(label, [{type: 'set-pitches', changes}], notes.map((note) => note.id));
  }

  function transpose(semitones: number): void {
    respell(selectedNotes(), (note) => {
      if (semitones % 12 === 0) return {step: note.pitch.step, alter: note.pitch.alter, octave: note.pitch.octave + semitones / 12} as WrittenPitch;
      return spellPitch(note.pitch.midi + semitones, keyFifths(note.onsetQuarters), semitones > 0 ? 1 : -1);
    }, semitones % 12 === 0 ? 'Move octave' : 'Move pitch');
  }

  function diatonic(steps: number): void {
    respell(selectedNotes(), (note) => fromDiatonic(diatonicIndex(note.pitch) + steps, keyFifths(note.onsetQuarters)), 'Move pitch');
  }

  function accidental(alter: -1 | 0 | 1): void {
    if (!has('accidental')) return;
    respell(selectedNotes(), (note) => ({step: note.pitch.step, alter, octave: note.pitch.octave}), 'Set accidental');
  }

  function inputDuration(): {base: readonly [number, number]; dots?: number} {
    return {base: DURATION_QUARTERS[settings.duration], ...(settings.dotted ? {dots: 1} : {})};
  }

  function chooseDuration(value: ScoreSheetDuration): void {
    if (!has('input') && !has('duration')) return;
    setSetting('duration', value);
    if (!settings.inputMode && has('duration')) rewriteSelected();
  }

  function toggleDot(): void {
    setSetting('dotted', !settings.dotted);
    if (!settings.inputMode && has('duration')) rewriteSelected();
  }

  /** Change the selected events' duration, keeping their pitches and IDs. */
  function rewriteSelected(): void {
    const notes = selectedNotes();
    if (!notes.length) return;
    const source = committed()!;
    const events = new Map<string, Note[]>();
    for (const note of notes) {
      const part = source.parts.find((candidate) => candidate.notes.includes(note))!;
      const key = JSON.stringify([part.id, staffOf(note, part), note.voice, note.onsetQuarters.toString()]);
      events.set(key, [...events.get(key) ?? [], note]);
    }
    const operations: ScoreEditOperation[] = [];
    for (const [key, chosen] of events) {
      const [partId, staff, voice] = JSON.parse(key) as [string, number, string];
      const lane = lanes.get(laneKey(partId, staff, voice));
      const event = lane?.events.find((candidate) => candidate.onset.eq(chosen[0].onsetQuarters));
      const heads = event?.notes ?? chosen;
      operations.push({type: 'write-notation', partId: source.parts.find((part) => part.id === partId)!.id, voice: heads[0].voice, staff,
        onsetQuarters: heads[0].onsetQuarters.toJSON(), duration: inputDuration(),
        notes: heads[0].rest ? [{id: heads[0].id, pitch: null}] : heads.map((head) => ({id: head.id, pitch: head.pitch.toJSON()}))});
    }
    run('Change duration', operations, notes.map((note) => note.id));
  }

  function deleteSelection(): void {
    if (!has('delete')) return;
    const notes = selectedNotes();
    if (notes.length) run('Delete', [{type: 'notes-to-rests', noteIds: notes.map((note) => note.id)}], notes.map((note) => note.id));
  }

  function restAction(): void {
    if (settings.inputMode) write(null);
    else deleteSelection();
  }

  function tieAction(): void {
    if (!has('tie')) return;
    const notes = selectedNotes().filter((note) => !note.rest);
    if (!notes.length) return;
    if (settings.inputMode && cursor && has('input')) {
      // Input mode: write the same pitch at the cursor and tie into it.
      const last = notes[notes.length - 1];
      const id = NoteId(makeId('sheet-note'));
      const part = committed()!.parts[cursor.partIndex];
      const at = cursor.quarter;
      if (run('Tie', [{type: 'write-notation', partId: part.id, voice: VoiceId(cursor.voice), staff: cursor.staff, onsetQuarters: at.toJSON(),
        duration: inputDuration(), notes: [{id, pitch: last.pitch.toJSON()}]}, {type: 'tie-notes', noteIds: [last.id], tied: true}], [id])) advance(id);
      return;
    }
    const tied = !notes.every((note) => note.tie === 'start' || note.tie === 'continue');
    run(tied ? 'Tie' : 'Remove tie', [{type: 'tie-notes', noteIds: notes.map((note) => note.id), tied}], notes.map((note) => note.id));
  }

  function history(kind: 'undo' | 'redo'): void {
    if (!editing || !has('history') || !canEdit()) return;
    const result = kind === 'undo' ? editing.undo() : editing.redo();
    if (result.status === 'failed') fail(result.error);
    else flash('');
  }

  // ---- note input
  function startCursor(): void {
    const source = committed();
    if (!source) return;
    const note = selectedNotes()[0];
    if (note) {
      const part = source.parts.find((candidate) => candidate.notes.includes(note))!;
      cursor = {partIndex: source.parts.indexOf(part), staff: staffOf(note, part), voice: String(note.voice), quarter: note.onsetQuarters};
      return;
    }
    const lane = [...lanes.values()].sort((a, b) => a.partIndex - b.partIndex || a.staff - b.staff)[0];
    cursor = {partIndex: lane?.partIndex ?? 0, staff: lane?.staff ?? 1, voice: lane?.voice ?? '1', quarter: projection?.measures[0]?.startQuarters ?? Rational.ZERO};
  }

  /** The written pitch nearest the previous note in the cursor's voice, for a letter. */
  function pitchForLetter(step: Step): WrittenPitch {
    const source = committed()!;
    const part = source.parts[cursor!.partIndex];
    const fifths = keyFifths(cursor!.quarter);
    const lane = lanes.get(laneKey(part.id, cursor!.staff, cursor!.voice));
    const previous = [...lane?.events ?? []].reverse().find((event) => event.onset.lt(cursor!.quarter) && !event.notes[0].rest)?.notes[0];
    // Without a previous note, start around the middle of the staff (B4 treble, D3 bass).
    const reference = previous ? diatonicIndex(previous.pitch) : diatonicIndex(cursor!.staff > 1 ? {step: 'D', octave: 3} : {step: 'B', octave: 4});
    const base = STEPS.indexOf(step);
    // The nearest octave: at most three diatonic steps away, upward on a tie.
    const offset = ((base - reference) % 7 + 7) % 7;
    return fromDiatonic(reference + (offset <= 3 ? offset : offset - 7), fifths);
  }

  function write(pitch: WrittenPitch | null): void {
    if (!has('input') || !cursor || !canEdit()) return;
    const source = committed()!;
    const part = source.parts[cursor.partIndex];
    const id = NoteId(makeId('sheet-note'));
    if (run(pitch ? 'Enter note' : 'Enter rest', [{type: 'write-notation', partId: part.id, voice: VoiceId(cursor.voice), staff: cursor.staff,
      onsetQuarters: cursor.quarter.toJSON(), duration: inputDuration(), notes: [{id, pitch}]}], [id])) advance(id);
  }

  function advance(id: NoteId): void {
    const note = committed()?.getNote(id);
    if (!note || !cursor) return;
    cursor.quarter = note.offsetQuarters;
    anchor = id;
    say(describe(note));
    paintCursor();
  }

  // ---- pointer
  function systemAt(target: EventTarget | null): SystemView | undefined {
    const element = target instanceof Element ? target.closest('[part~="system"]') : null;
    return systems.find((system) => system.host === element);
  }

  pages.addEventListener('pointerdown', (event) => {
    if (preview) settlePreview();
    if (!canEdit() || event.button !== 0) return;
    viewport.focus({preventScroll: true});
    const target = event.target instanceof Element ? event.target.closest<SVGElement>('[data-note-id]') : null;
    const source = committed();
    if (!source) return;
    if (target) {
      const note = source.getNote(NoteId(target.dataset.noteId!));
      if (!note) return;
      event.preventDefault();
      if (event.shiftKey && anchor) {
        const first = source.getNote(anchor);
        const lane = first && laneOfNote(first);
        if (lane && laneOfNote(note) === lane) {
          const [from, to] = first!.onsetQuarters.lte(note.onsetQuarters) ? [first!.onsetQuarters, note.onsetQuarters] : [note.onsetQuarters, first!.onsetQuarters];
          editing!.select(lane.events.filter((item) => item.onset.gte(from) && item.onset.lte(to)).flatMap((item) => item.notes.map((head) => head.id)));
          return;
        }
      }
      if (event.metaKey || event.ctrlKey) {
        const current = selected();
        select(current.includes(note.id) ? current.filter((id) => id !== note.id) : [...current, note.id]);
        return;
      }
      select([note.id]);
      if (settings.inputMode) {
        const part = source.parts.find((candidate) => candidate.notes.includes(note))!;
        cursor = {partIndex: source.parts.indexOf(part), staff: staffOf(note, part), voice: String(note.voice), quarter: note.onsetQuarters};
        paintCursor();
      } else if (!note.rest && has('pitch')) {
        drag = {pointerId: event.pointerId, note, y: event.clientY, steps: 0, revision: editing!.state.document.documentRevision};
        try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* detached */ }
      }
      return;
    }
    const system = systemAt(event.target);
    if (!system) { if (!settings.inputMode) select([]); return; }
    const box = system.host.getBoundingClientRect();
    const position = system.visualizer.positionAt((event.clientX - box.left) / cssZoom, (event.clientY - box.top) / cssZoom);
    if (!position) return;
    if (!settings.inputMode) { select([]); return; }
    // Input mode: place the cursor and write the clicked staff position.
    const lane = [...lanes.values()].find((candidate) => candidate.partIndex === position.partIndex && candidate.staff === position.staff);
    cursor = {partIndex: position.partIndex, staff: position.staff, voice: cursor?.partIndex === position.partIndex && cursor.staff === position.staff ? cursor.voice : lane?.voice ?? '1',
      quarter: Rational.from(position.quarter)};
    write(fromDiatonic(topLineIndex(position.clef) - position.step, keyFifths(position.quarter)));
  });

  pages.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId || !editing) return;
    const scale = systems[0]?.visualizer.systemMetrics.scale ?? 1;
    const steps = Math.round((drag.y - event.clientY) / (5 * scale * cssZoom));
    if (steps === drag.steps) return;
    drag.steps = steps;
    if (steps === 0) { editing.cancel(); return; }
    const pitch = fromDiatonic(diatonicIndex(drag.note.pitch) + steps, keyFifths(drag.note.onsetQuarters));
    const result = editing.preview([{type: 'set-pitches', changes: [{noteId: drag.note.id, pitch}]}]);
    if (result.status === 'preview') options.onPreview?.(result);
  });

  const endDrag = (event: PointerEvent, commit: boolean) => {
    if (!drag || drag.pointerId !== event.pointerId || !editing) return;
    const steps = drag.steps;
    drag = undefined;
    if (!commit || steps === 0 || !editing.state.interaction.draft) { editing.cancel(); return; }
    const result = editing.commit('Move pitch');
    if (result.status === 'failed') fail(result.error);
    else if (result.status === 'committed') { flash(''); options.onCommit?.(result); }
  };
  pages.addEventListener('pointerup', (event) => endDrag(event, true));
  pages.addEventListener('pointercancel', (event) => endDrag(event, false));
  pages.addEventListener('lostpointercapture', (event) => endDrag(event as PointerEvent, false));

  // ---- keyboard
  viewport.addEventListener('wheel', (event) => {
    if (!canEdit() || !has('zoom') || !(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
    const rect = viewport.getBoundingClientRect();
    queueZoom(Math.exp(-Math.max(-WHEEL_ZOOM_CLAMP, Math.min(WHEEL_ZOOM_CLAMP, delta)) * WHEEL_ZOOM_RATE), event.clientX - rect.left, event.clientY - rect.top);
  }, {passive: false});
  // Safari reports a trackpad pinch as gesture events carrying the cumulative scale.
  viewport.addEventListener('gesturestart', (event) => {
    if (!canEdit() || !has('zoom')) return;
    event.preventDefault();
    gestureScale = 1;
  });
  viewport.addEventListener('gesturechange', (event) => {
    if (!canEdit() || !has('zoom')) return;
    event.preventDefault();
    const detail = event as Event & {scale?: number; clientX?: number; clientY?: number};
    const scale = typeof detail.scale === 'number' && detail.scale > 0 ? detail.scale : 1;
    const rect = viewport.getBoundingClientRect();
    queueZoom(scale / gestureScale, (detail.clientX ?? rect.left + rect.width / 2) - rect.left, (detail.clientY ?? rect.top) - rect.top);
    gestureScale = scale;
  });

  viewport.addEventListener('keydown', (event) => {
    if (!canEdit()) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key;
    const handled = (() => {
      if (command && (key === 'z' || key === 'Z')) { history(event.shiftKey ? 'redo' : 'undo'); return true; }
      if (command && (key === 'y' || key === 'Y')) { history('redo'); return true; }
      if (command && (key === '=' || key === '+')) { if (has('zoom')) zoomBy(ZOOM_STEP); return true; }
      if (command && key === '-') { if (has('zoom')) zoomBy(1 / ZOOM_STEP); return true; }
      if (key === 'Escape') {
        if (settings.inputMode) setSetting('inputMode', false);
        else select([]);
        return true;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') { step(key === 'ArrowRight' ? 1 : -1); return true; }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const direction = key === 'ArrowUp' ? 1 : -1;
        if (event.altKey && event.shiftKey) diatonic(direction);
        else if (command) transpose(12 * direction);
        else transpose(direction);
        return true;
      }
      if (command || event.altKey) return false;
      if ((key === 'n' || key === 'N') && has('input')) { setSetting('inputMode', !settings.inputMode); return true; }
      if (DURATION_KEYS[key] && (has('input') || has('duration'))) { chooseDuration(DURATION_KEYS[key]); return true; }
      if (key === '.') { toggleDot(); return true; }
      if (key === '+') { tieAction(); return true; }
      if (key === 'Delete' || key === 'Backspace') { deleteSelection(); return true; }
      if (/^[a-gA-G]$/.test(key) && has('input')) {
        if (!settings.inputMode) setSetting('inputMode', true);
        if (cursor) write(pitchForLetter(key.toUpperCase() as Step));
        return true;
      }
      if (key === '0' && has('input') && settings.inputMode) { write(null); return true; }
      return false;
    })();
    if (handled) event.preventDefault();
  });

  // ---- lifecycle
  const unsubscribe = editing?.subscribe(() => {
    if (disposed) return;
    if (score() !== engraved) update();
    else paintSelection();
    syncChrome();
  });
  const view = document.defaultView;
  let frame = 0;
  const observer = view?.ResizeObserver ? new view.ResizeObserver(() => {
    if (disposed) return;
    const width = viewport.clientWidth;
    if (!width || Math.abs(width - lastWidth) < 2) return;
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => engrave());
  }) : undefined;
  observer?.observe(viewport);
  syncChrome();
  engrave();

  return {
    element: root,
    get settings() { return settings; },
    get features() { return features; },
    get layoutInfo() { return {systems: systems.length, pages: pageCount}; },
    configure(next) {
      const nextFeatures = next.features ? parseFeatures(next.features) : features;
      const nextSettings = normalizeSettings(settings, next);
      const relayout = nextSettings.layout !== settings.layout;
      const rezoom = !relayout && nextSettings.zoom !== settings.zoom;
      features = nextFeatures;
      if (nextSettings.inputMode !== settings.inputMode) { settings = nextSettings; if (settings.inputMode) startCursor(); else cursor = undefined; paintCursor(); }
      settings = nextSettings;
      if (next.followPlayback !== undefined) followPlayback = next.followPlayback;
      if (relayout) engrave();
      else if (rezoom) showZoom();
      syncChrome();
    },
    updatePlayback(next) {
      playback = next;
      paintPlayback(followPlayback);
    },
    cancel() {
      drag = undefined;
      if (editing?.state.available && editing.state.interaction.draft) editing.cancel();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      view?.cancelAnimationFrame(frame);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      if (reportTimer !== undefined) clearTimeout(reportTimer);
      if (previewTimer !== undefined) clearTimeout(previewTimer);
      settleTimer = reportTimer = previewTimer = undefined;
      preview = undefined;
      pendingZoom = undefined;
      unsubscribe?.();
      disposeSystems();
      root.remove();
    },
  };
}

function parseFeatures(input: readonly ScoreSheetFeature[]): ScoreSheetFeature[] {
  for (const feature of input) if (!SCORE_SHEET_FEATURES.includes(feature)) throw new ScoreEditError('invalid-command', `Unknown sheet feature: ${String(feature)}`);
  return SCORE_SHEET_FEATURES.filter((feature) => input.includes(feature));
}

/** Parse a `tools` token list; unknown tokens are ignored and absence means all features. */
export function parseScoreSheetFeatures(value: string | null | undefined): ScoreSheetFeature[] {
  if (value === null || value === undefined) return [...SCORE_SHEET_FEATURES];
  const tokens = value.split(/[\s,]+/).filter(Boolean);
  return SCORE_SHEET_FEATURES.filter((feature) => tokens.includes(feature));
}

function normalizeSettings(current: ScoreSheetSettings, next: Partial<ScoreSheetSettings>): ScoreSheetSettings {
  const layout = next.layout ?? current.layout;
  if (!SCORE_SHEET_LAYOUTS.includes(layout)) throw new RangeError(`Unknown sheet layout: ${String(layout)}`);
  const duration = next.duration ?? current.duration;
  if (!SCORE_SHEET_DURATIONS.includes(duration)) throw new RangeError(`Unknown note value: ${String(duration)}`);
  const zoom = next.zoom ?? current.zoom;
  if (!Number.isFinite(zoom) || zoom < 0) throw new RangeError('Zoom must be 0 (fit) or a positive factor');
  return Object.freeze({layout, duration, zoom: zoom === 0 ? 0 : Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], zoom)),
    inputMode: next.inputMode ?? current.inputMode, dotted: next.dotted ?? current.dotted});
}

/** Pitch spelling for a MIDI number in a key; exported for tests. @internal */
export const sheetPitch = {spellPitch, fromDiatonic, diatonicIndex, topLineIndex, midiOf};
