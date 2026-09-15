export type NoteInputLayout = 'piano' | 'grid' | 'chords';

export interface NoteInputDetail {
  midi: number;
  velocity: number;
}

export interface NoteInputChord {
  label: string;
  notes: number[];
}

export interface NoteInputPad {
  midi: number;
  label: string;
}

/** Diatonic triads of C major (I ii iii IV V vi vii°) — the default chord set. */
export const DEFAULT_CHORDS: NoteInputChord[] = [
  {label: 'C', notes: [60, 64, 67]},
  {label: 'Dm', notes: [62, 65, 69]},
  {label: 'Em', notes: [64, 67, 71]},
  {label: 'F', notes: [65, 69, 72]},
  {label: 'G', notes: [67, 71, 74]},
  {label: 'Am', notes: [69, 72, 76]},
  {label: 'B°', notes: [71, 74, 77]},
];

/** Physical-key → semitone offset from the surface's base C. */
export const QWERTY_KEY_MAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15,
  Semicolon: 16,
};

/** Letter printed on a piano key cap for each mapped physical key. */
export const QWERTY_KEY_LABEL: Readonly<Record<string, string>> = {
  KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T',
  KeyG: 'G', KeyY: 'Y', KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O',
  KeyL: 'L', KeyP: 'P', Semicolon: ';',
};

/** Highest mapped semitone offset from base C (a … ;). */
export const QWERTY_SPAN = Math.max(...Object.values(QWERTY_KEY_MAP));

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** Whether a QWERTY semitone offset from base C is a black-key pitch class. */
export function qwertyOffsetIsBlack(offset: number): boolean {
  return BLACK_PITCH_CLASSES.has(((offset % 12) + 12) % 12);
}

/** Fixed QWERTY Launchpad size — three keyboard rows × ten keys per row. */
export const QWERTY_GRID_ROWS = 3;
export const QWERTY_GRID_COLS = 10;

/** Row letter for each QWERTY Launchpad row (top → bottom): Q, A, Z. */
export const GRID_ROW_LETTERS = ['q', 'a', 'z'] as const;

/** Physical key at each grid cell (top → bottom, left → right): Q–P, A–;, Z–/. */
export const QWERTY_GRID_KEYS: ReadonlyArray<ReadonlyArray<{code: string; label: string}>> = [
  [
    {code: 'KeyQ', label: 'Q'}, {code: 'KeyW', label: 'W'}, {code: 'KeyE', label: 'E'}, {code: 'KeyR', label: 'R'},
    {code: 'KeyT', label: 'T'}, {code: 'KeyY', label: 'Y'}, {code: 'KeyU', label: 'U'}, {code: 'KeyI', label: 'I'},
    {code: 'KeyO', label: 'O'}, {code: 'KeyP', label: 'P'},
  ],
  [
    {code: 'KeyA', label: 'A'}, {code: 'KeyS', label: 'S'}, {code: 'KeyD', label: 'D'}, {code: 'KeyF', label: 'F'},
    {code: 'KeyG', label: 'G'}, {code: 'KeyH', label: 'H'}, {code: 'KeyJ', label: 'J'}, {code: 'KeyK', label: 'K'},
    {code: 'KeyL', label: 'L'}, {code: 'Semicolon', label: ';'},
  ],
  [
    {code: 'KeyZ', label: 'Z'}, {code: 'KeyX', label: 'X'}, {code: 'KeyC', label: 'C'}, {code: 'KeyV', label: 'V'},
    {code: 'KeyB', label: 'B'}, {code: 'KeyN', label: 'N'}, {code: 'KeyM', label: 'M'}, {code: 'Comma', label: ','},
    {code: 'Period', label: '.'}, {code: 'Slash', label: '/'},
  ],
];

/** Normalize the attribute value without leaking string validation into the element. */
export function normalizeNoteInputLayout(raw: string | null): NoteInputLayout {
  return raw === 'grid' || raw === 'chords' ? raw : 'piano';
}

/** The MIDI note a physical key plays for a given base C, or null if unmapped. */
export function qwertyMidi(code: string, baseC: number): number | null {
  if (!Object.prototype.hasOwnProperty.call(QWERTY_KEY_MAP, code)) return null;
  const offset = QWERTY_KEY_MAP[code];
  return offset === undefined ? null : baseC + offset;
}

/** Labels shown over the MIDI notes reachable from one QWERTY base C. */
export function qwertyLabelMap(baseC: number): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [code, offset] of Object.entries(QWERTY_KEY_MAP)) {
    labels.set(baseC + offset, QWERTY_KEY_LABEL[code]);
  }
  return labels;
}

/** Pad index, ordered left → right and bottom → top. */
export function gridPadIndex(rows: number, cols: number, rowFromTop: number, col: number): number {
  return (rows - 1 - rowFromTop) * cols + col;
}

/** Resolve a grid cell in keyboard mode, with explicit map entries taking priority when requested. */
export function gridQwertyCellMidi(
  baseC: number,
  index: number,
  code: string,
  pad?: NoteInputPad,
  mapOnly = false,
): number | null {
  if (mapOnly) return pad?.midi ?? null;
  const typed = qwertyMidi(code, baseC);
  if (typed != null) return typed;
  return pad?.midi ?? null;
}

/** MIDI for a physical key on the QWERTY Launchpad (`layout="grid"` + `keyboard`). */
export function gridKeyboardMidi(
  baseC: number,
  code: string,
  pads?: readonly (NoteInputPad | undefined)[],
  mapOnly = false,
): number | null {
  if (!mapOnly) {
    const typed = qwertyMidi(code, baseC);
    if (typed != null) return typed;
  }
  for (let row = 0; row < QWERTY_GRID_ROWS; row += 1) {
    for (let col = 0; col < QWERTY_GRID_COLS; col += 1) {
      if (QWERTY_GRID_KEYS[row][col].code !== code) continue;
      const index = gridPadIndex(QWERTY_GRID_ROWS, QWERTY_GRID_COLS, row, col);
      return mapOnly ? pads?.[index]?.midi ?? null : gridQwertyCellMidi(baseC, index, code, pads?.[index]);
    }
  }
  return null;
}

/** MIDI for a Launchpad pad — `.pads[i].midi` only (no `start` fallback). */
export function gridPadMidi(_index: number, pad?: NoteInputPad): number | null {
  return pad?.midi ?? null;
}

/** Spreadsheet-style address for a grid cell, such as `a1` or `z10`. */
export function gridIndexToRef(rowFromTop: number, col: number): string {
  const row = GRID_ROW_LETTERS[rowFromTop];
  if (!row || col < 0 || col >= QWERTY_GRID_COLS) return '';
  return `${row}${col + 1}`;
}

/** Parse an address into its top-origin row and zero-based column. */
export function gridRefToCoords(ref: string): {row: number; col: number} | null {
  const match = /^([qaz])(\d{1,2})$/i.exec(ref.trim());
  if (!match) return null;
  const row = GRID_ROW_LETTERS.indexOf(match[1].toLowerCase() as (typeof GRID_ROW_LETTERS)[number]);
  if (row < 0) return null;
  const col = Number(match[2]) - 1;
  if (!Number.isFinite(col) || col < 0 || col >= QWERTY_GRID_COLS) return null;
  return {row, col};
}

/** Pad index (bottom-left = 0) for a grid ref such as `a1` or `z10`. */
export function gridRefToIndex(ref: string): number | null {
  const coords = gridRefToCoords(ref);
  if (!coords) return null;
  return gridPadIndex(QWERTY_GRID_ROWS, QWERTY_GRID_COLS, coords.row, coords.col);
}

/** Parse comma, semicolon, or whitespace separated `ref=midi` pairs. */
export function parseGridMap(map: string): NoteInputPad[] {
  const pads: NoteInputPad[] = [];
  for (const part of map.split(/[,;\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const ref = trimmed.slice(0, eq).trim();
    const rawMidi = trimmed.slice(eq + 1).trim();
    if (rawMidi === '') continue;
    const midi = Number(rawMidi);
    if (!Number.isFinite(midi)) continue;
    const index = gridRefToIndex(ref);
    if (index == null) continue;
    pads[index] = {midi: Math.round(midi), label: ref.toLowerCase()};
  }
  return pads;
}

/** Default TR-808 grid map (program `0`, channel `0`). */
export const DEFAULT_TR808_GRID_MAP =
  'z1=35,z2=36,z3=37,z4=38,z5=39,z6=40,z7=42,z8=45,z9=46,z10=49,' +
  'a1=50,a2=56,a3=62,a4=63,a5=64,a6=70,a7=75';

/** MIDI for an isomorphic grid cell at a top-origin row and left-origin column. */
export function gridCellMidi(start: number, rows: number, rowInterval: number, row: number, col: number): number {
  return start + col + (rows - 1 - row) * rowInterval;
}
