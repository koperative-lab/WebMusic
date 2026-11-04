import {NoteId, PartId, Pitch, Rational, ScoreEditError, VoiceId, makeId,
  type Note, type Score, type ScoreDraftResult, type ScoreEditOperation, type ScoreEditResult} from '../../core';
import type {ScoreViewEditing} from '../headless/score-editing';

/** Editing features a grid can offer. Selection is always available while editing. */
export type ScoreGridFeature = 'move' | 'resize' | 'draw' | 'delete' | 'velocity' | 'snap' | 'zoom' | 'history';
export const SCORE_GRID_FEATURES: readonly ScoreGridFeature[] = Object.freeze(['move', 'resize', 'draw', 'delete', 'velocity', 'snap', 'zoom', 'history']);
/** Pointer tool: `select` picks, drags and resizes; `draw` adds notes and, with `delete`, removes clicked notes. */
export type ScoreGridTool = 'select' | 'draw';
/** Grid resolution as a note value (`1/16` is a sixteenth note; `t` marks triplets). */
export type ScoreGridSnap = 'off' | '1/4' | '1/8' | '1/8t' | '1/16' | '1/16t' | '1/32';
export const SCORE_GRID_SNAPS: readonly ScoreGridSnap[] = Object.freeze(['off', '1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32']);

/** Grid state a user can change from the toolbar. Every value is also an option. */
export interface ScoreGridSettings {
  readonly tool: ScoreGridTool;
  readonly snap: ScoreGridSnap;
  readonly velocityLane: boolean;
  /** Horizontal zoom, pixels per written quarter. */
  readonly pixelsPerQuarter: number;
  /** Vertical zoom, pixels per semitone row. */
  readonly noteHeight: number;
}

export interface ScoreGridOptions extends Partial<ScoreGridSettings> {
  /** Available editing features; defaults to all of them. */
  features?: readonly ScoreGridFeature[];
  minPitch?: number;
  maxPitch?: number;
  noteColor?: string;
  activeNoteColor?: string;
  noteRGB?: string;
  activeNoteRGB?: string;
  onPreview?(result: Extract<ScoreDraftResult, {status: 'preview'}>): void;
  onCommit?(result: Extract<ScoreEditResult, {status: 'committed'}>): void;
  onError?(error: unknown): void;
  /** A toolbar, wheel or keyboard change; programmatic `configure` calls do not report. */
  onSettingsChange?(settings: ScoreGridSettings, changed: keyof ScoreGridSettings): void;
}

/** What the grid draws: a fixed score, or a borrowed View editing controller. */
export type ScoreGridContent = {readonly score: Score} | {readonly editing: ScoreViewEditing};

/**
 * Playback overlay. `seconds` is the nominal score position; null hides the playhead.
 * Without `activeNoteIds`, notes sounding at that position are derived from the score.
 */
export interface ScoreGridPlayback {
  readonly seconds: number | null;
  readonly activeNoteIds?: ReadonlySet<string>;
}

export interface ScoreGridHandle {
  readonly element: HTMLElement;
  readonly surface: SVGSVGElement;
  readonly settings: ScoreGridSettings;
  readonly features: readonly ScoreGridFeature[];
  /** Apply settings or features. Invalid values throw before anything changes. */
  configure(options: Partial<ScoreGridSettings> & {features?: readonly ScoreGridFeature[]}): void;
  updatePlayback(playback?: ScoreGridPlayback): void;
  cancel(): void;
  dispose(): void;
}

interface Gesture {
  pointerId: number;
  revision: number;
  context: string;
  x: number;
  y: number;
  kind: 'move' | 'resize' | 'insert' | 'marquee' | 'velocity';
  notes: readonly Note[];
  insert?: Extract<ScoreEditOperation, {type: 'insert-notes'}>;
  base?: readonly NoteId[];
  valid: boolean;
  changed: boolean;
}

const SVG = 'http://www.w3.org/2000/svg';
const KEY_WIDTH = 48;
const RULER_HEIGHT = 22;
const LANE_HEIGHT = 72;
/** Unsnapped positions still need an exact rational; 1/96 quarter is below any drawn grid line. */
const FINE = new Rational(1, 96);
const SNAP_QUARTERS: Record<Exclude<ScoreGridSnap, 'off'>, Rational> = {
  '1/4': Rational.ONE, '1/8': new Rational(1, 2), '1/8t': new Rational(1, 3),
  '1/16': new Rational(1, 4), '1/16t': new Rational(1, 6), '1/32': new Rational(1, 8),
};
const ZOOM_STEP = 1.25;
const SCALE_RANGE = [8, 512] as const;
const ROW_RANGE = [6, 48] as const;
const BLACK = new Set([1, 3, 6, 8, 10]);

/**
 * DAW-style piano-roll grid. It draws a fixed score or a borrowed editing
 * controller; it creates no document, player or clock. Editing controls and
 * gestures exist only while the controller is available and editable.
 */
export function mountScoreGrid(host: HTMLElement, content: ScoreGridContent, options: ScoreGridOptions = {}): ScoreGridHandle {
  const owner = host.ownerDocument;
  const editing = 'editing' in content ? content.editing : undefined;
  const staticScore = 'score' in content ? content.score : undefined;
  if (!editing && !staticScore) throw new TypeError('A score grid needs a score or an editing controller');
  if (editing && !editing.state.available) throw new ScoreEditError('disposed', 'The editing view is unavailable');
  let settings = validSettings({tool: 'select', snap: '1/16', velocityLane: false, pixelsPerQuarter: 64, noteHeight: 16}, options);
  let features = new Set(validFeatures(options.features ?? SCORE_GRID_FEATURES));
  // A tool that is not offered falls back to selection.
  if (settings.tool === 'draw' && !features.has('draw')) settings = {...settings, tool: 'select'};

  const element = owner.createElement('section');
  element.setAttribute('part', 'grid');
  element.style.cssText = 'display:grid;gap:.375rem;min-width:0;color:var(--wm-foreground,inherit)';
  const toolbar = owner.createElement('div');
  toolbar.setAttribute('part', 'toolbar');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Grid editing tools');
  toolbar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .75rem;min-width:0;font-size:.8125rem';
  const instructions = owner.createElement('p');
  instructions.id = makeId('score-grid-help');
  instructions.setAttribute('part', 'editing-instructions');
  instructions.style.cssText = 'margin:0;font:inherit;font-size:.75em;opacity:.8';
  const viewport = owner.createElement('div');
  viewport.setAttribute('part', 'viewport');
  viewport.style.cssText = 'overflow:auto;max-height:var(--wm-score-grid-max-height,32rem);min-width:0;border:1px solid var(--wm-border,#888);background:var(--wm-score-view-background,var(--wm-surface,Canvas))';
  const svg = owner.createElementNS(SVG, 'svg') as SVGSVGElement;
  svg.setAttribute('part', 'surface');
  svg.setAttribute('aria-label', 'Piano roll grid, written pitch and quarter notes');
  svg.style.cssText = 'display:block;touch-action:none;outline-offset:-3px;user-select:none';
  viewport.append(svg);
  const feedback = owner.createElement('div');
  feedback.setAttribute('part', 'editing-status');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.style.cssText = 'font-size:.75em;min-height:1.2em';

  // ---- Toolbar ----
  const group = (label: string): HTMLElement => {
    const node = owner.createElement('span');
    node.setAttribute('role', 'group'); node.setAttribute('aria-label', label);
    node.style.cssText = 'display:inline-flex;align-items:center;gap:.25rem';
    toolbar.append(node); return node;
  };
  const toolButton = (parent: HTMLElement, text: string, label: string, part: string, action: () => void): HTMLButtonElement => {
    const button = owner.createElement('button');
    button.type = 'button'; button.textContent = text; button.title = label;
    button.setAttribute('aria-label', label); button.setAttribute('part', part);
    button.style.cssText = 'font:inherit;min-width:2em;padding:.125rem .5rem;border:1px solid var(--wm-border,#888);border-radius:4px;background:var(--wm-surface,Canvas);color:inherit;cursor:pointer';
    button.addEventListener('click', action);
    parent.append(button); return button;
  };
  const tools = group('Tool');
  const selectTool = toolButton(tools, 'Select', 'Select tool', 'tool-button', () => change({tool: 'select'}, 'tool'));
  const drawTool = toolButton(tools, 'Draw', 'Draw tool (B)', 'tool-button', () => change({tool: 'draw'}, 'tool'));
  const snapGroup = group('Snap');
  const snapLabel = owner.createElement('label');
  snapLabel.textContent = 'Snap ';
  const snapSelect = owner.createElement('select');
  snapSelect.setAttribute('part', 'snap');
  snapSelect.setAttribute('aria-label', 'Snap grid');
  for (const value of SCORE_GRID_SNAPS) {
    const option = owner.createElement('option'); option.value = value;
    option.textContent = value === 'off' ? 'Off' : value.endsWith('t') ? `${value.slice(0, -1)} triplet` : value;
    snapSelect.append(option);
  }
  snapSelect.addEventListener('change', () => change({snap: snapSelect.value as ScoreGridSnap}, 'snap'));
  snapLabel.append(snapSelect); snapGroup.append(snapLabel);
  const laneGroup = group('Lanes');
  const laneToggle = toolButton(laneGroup, 'Velocity', 'Show velocity lane', 'lane-toggle', () => change({velocityLane: !settings.velocityLane}, 'velocityLane'));
  const zoomGroup = group('Zoom');
  toolButton(zoomGroup, '−', 'Zoom out horizontally', 'zoom-button', () => zoom('pixelsPerQuarter', 1 / ZOOM_STEP));
  toolButton(zoomGroup, '+', 'Zoom in horizontally', 'zoom-button', () => zoom('pixelsPerQuarter', ZOOM_STEP));
  toolButton(zoomGroup, '↕−', 'Shorter rows', 'zoom-button', () => zoom('noteHeight', 1 / ZOOM_STEP));
  toolButton(zoomGroup, '↕+', 'Taller rows', 'zoom-button', () => zoom('noteHeight', ZOOM_STEP));
  const editGroup = group('Edit');
  const deleteButton = toolButton(editGroup, 'Delete', 'Delete selected notes', 'delete-button', () => run('Delete notes', [{type: 'delete-notes', noteIds: selectedIds()}]));
  const historyGroup = group('History');
  const undoButton = toolButton(historyGroup, 'Undo', 'Undo', 'history-button', () => travelHistory('undo'));
  const redoButton = toolButton(historyGroup, 'Redo', 'Redo', 'history-button', () => travelHistory('redo'));

  // ---- Numeric note values: the non-pointer path for every pointer edit ----
  const details = owner.createElement('details');
  details.setAttribute('part', 'note-properties');
  details.style.cssText = 'min-width:0;max-width:100%;font-size:.8125rem';
  const summary = owner.createElement('summary');
  summary.textContent = 'Note values and keyboard alternatives';
  details.append(summary);
  const form = owner.createElement('form');
  form.style.cssText = 'display:flex;flex-wrap:wrap;align-items:end;gap:.5rem;padding:.5rem 0';
  const existingLabel = owner.createElement('label'); existingLabel.textContent = 'Select existing note ';
  existingLabel.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr);min-width:0;max-width:100%';
  const existing = owner.createElement('select'); existing.setAttribute('aria-label', 'Select existing note');
  existing.style.cssText = 'width:26em;min-width:0;max-width:100%'; existingLabel.append(existing); form.append(existingLabel);
  existing.addEventListener('change', () => {
    if (!editable() || !editing) return;
    try {
      if (existing.value === '') editing.select([]);
      else if (existing.value.startsWith('note:')) editing.select([NoteId(existing.value.slice(5))]);
      message = ''; draw();
    } catch (error) { report(error); }
  });
  const fields: HTMLLabelElement[] = [];
  const input = (label: string, type: string, value: string): HTMLInputElement => {
    const wrapper = owner.createElement('label');
    wrapper.textContent = `${label} `;
    const field = owner.createElement('input');
    field.type = type; field.value = value; field.setAttribute('aria-label', label);
    field.style.width = '7em';
    wrapper.append(field); form.append(wrapper); fields.push(wrapper);
    return field;
  };
  const onset = input('Onset (quarters)', 'text', '0');
  const duration = input('Duration (quarters)', 'text', '1');
  const pitch = input('Written MIDI pitch', 'number', '60'); pitch.min = '0'; pitch.max = '127'; pitch.step = '1';
  const velocity = input('Velocity', 'number', '80'); velocity.min = '1'; velocity.max = '127'; velocity.step = '1';
  const partLabel = owner.createElement('label'); partLabel.textContent = 'Insert into part ';
  const part = owner.createElement('select'); part.setAttribute('aria-label', 'Insert into part'); partLabel.append(part); form.append(partLabel);
  const formButton = (label: string, action: () => void): HTMLButtonElement => {
    const result = owner.createElement('button'); result.type = 'button'; result.textContent = label;
    result.addEventListener('click', action); form.append(result); return result;
  };
  const apply = formButton('Apply to selected note', () => numeric(false));
  const insert = formButton('Insert note', () => numeric(true));
  form.addEventListener('submit', (event) => { event.preventDefault(); numeric(false); });
  details.append(form);
  element.append(toolbar, instructions, viewport, feedback, details);

  let disposed = false;
  let gesture: Gesture | undefined;
  let playback: ScoreGridPlayback | undefined;
  let message = '';
  let min = 48;
  let max = 84;
  let width = 1;
  let height = 1;
  let partsKey = '';
  let existingContent: Score | undefined;
  let existingSummary = '';
  let numericBinding = '';
  let staticRevision = 0;
  // The last full drawing; playback-only updates repaint overlays on it instead of rebuilding.
  let drawn: {key: unknown; revision: number; left: number; top: number; viewportWidth: number; viewportHeight: number} | undefined;
  const drawnNotes = new Map<string, {rectangle: SVGElement; top: number; active: boolean}>();
  let overlays: SVGElement | undefined;
  let playhead: SVGElement | undefined;
  let marquee: SVGElement | undefined;
  const idleFill = options.noteColor ?? (options.noteRGB ? `rgb(${options.noteRGB})` : 'var(--wm-score-view-note,var(--wm-accent,#4869d8))');
  const activeFill = options.activeNoteColor ?? (options.activeNoteRGB ? `rgb(${options.activeNoteRGB})` : 'var(--wm-score-view-active-note,var(--wm-accent,#e25477))');
  // Selection rings and handles contrast with any note fill by reusing the surface background.
  const contrast = 'var(--wm-score-view-background,var(--wm-surface,Canvas))';

  function committed(): Score { return editing ? editing.state.document.content : staticScore!; }
  function visible(): Score { return editing ? editing.state.interaction.draft?.content ?? editing.state.document.content : staticScore!; }
  function selectedIds(): readonly NoteId[] { return editing?.state.interaction.selectedNoteIds ?? []; }
  function has(feature: ScoreGridFeature): boolean { return features.has(feature); }
  function editable(): boolean { return !disposed && editing !== undefined && editing.state.available && editing.state.editable; }
  function laneVisible(): boolean { return settings.velocityLane && has('velocity'); }
  function grid(): Rational | undefined { return settings.snap === 'off' ? undefined : SNAP_QUARTERS[settings.snap]; }
  /** A drawn or nudged note's length: one grid step, or a sixteenth when snapping is off. */
  function step(): Rational { return grid() ?? new Rational(1, 4); }
  function commandContext(selection = selectedIds()): string {
    if (!editing) return '';
    const document = editing.state.document;
    return JSON.stringify([document.documentId, document.documentRevision, selection]);
  }
  function report(error: unknown): void {
    message = error instanceof Error ? error.message : String(error);
    draw(); options.onError?.(error);
  }
  function completed(result: ScoreEditResult): void {
    if (result.status === 'failed') report(result.error);
    else {
      message = result.status === 'committed' ? result.change.label : 'No change';
      draw();
      if (result.status === 'committed') options.onCommit?.(result);
    }
  }
  function currentContext(expectedContext: string): boolean {
    if (!editable()) return false;
    if (expectedContext !== commandContext()) {
      report(new ScoreEditError('revision-conflict', 'The selection or document changed; review the current values before applying.'));
      return false;
    }
    return true;
  }
  function cancelForCommand(expectedContext = commandContext()): boolean {
    if (!editable()) return false;
    cancel();
    return currentContext(expectedContext);
  }
  function run(label: string, operations: readonly ScoreEditOperation[], expectedContext = commandContext()): void {
    if (!editing || !cancelForCommand(expectedContext)) return;
    completed(editing.execute(label, operations));
  }
  function travelHistory(direction: 'undo' | 'redo'): void {
    if (editing && has('history') && cancelForCommand()) completed(editing[direction]());
  }
  function change(next: Partial<ScoreGridSettings>, key: keyof ScoreGridSettings): void {
    if (disposed) return;
    const updated = validSettings(settings, next);
    if (updated[key] === settings[key]) return;
    if (gesture) cancel();
    settings = updated;
    draw();
    options.onSettingsChange?.(settings, key);
  }
  function zoom(key: 'pixelsPerQuarter' | 'noteHeight', factor: number, anchor?: {clientX: number; clientY: number}): void {
    if (!has('zoom')) return;
    const [low, high] = key === 'pixelsPerQuarter' ? SCALE_RANGE : ROW_RANGE;
    const before = settings[key];
    const after = Math.round(Math.min(high, Math.max(low, before * factor)) * 100) / 100;
    if (after === before) return;
    // Keep the musical point under the pointer (or the viewport's leading edge) in place.
    const rect = viewport.getBoundingClientRect();
    const offset = key === 'pixelsPerQuarter'
      ? (anchor ? anchor.clientX - rect.left : 0) - KEY_WIDTH
      : (anchor ? anchor.clientY - rect.top : 0) - RULER_HEIGHT;
    const scroll = key === 'pixelsPerQuarter' ? viewport.scrollLeft : viewport.scrollTop;
    const units = (scroll + Math.max(0, offset)) / before;
    change({[key]: after}, key);
    const target = Math.max(0, units * after - Math.max(0, offset));
    if (key === 'pixelsPerQuarter') viewport.scrollLeft = target; else viewport.scrollTop = target;
  }
  function parseQuarter(field: HTMLInputElement): Rational {
    const value = field.value.trim();
    const match = /^(-?\d+)(?:\/(\d+))?$/.exec(value);
    if (match) return new Rational(Number(match[1]), Number(match[2] ?? 1));
    if (/^-?\d+\.\d+$/.test(value)) {
      const places = value.length - value.indexOf('.') - 1;
      return new Rational(Number(value.replace('.', '')), 10 ** places);
    }
    throw new RangeError('Enter quarter values as integers, decimals, or fractions such as 1/3');
  }
  function integer(field: HTMLInputElement, label: string, low: number, high: number): number {
    // An empty number field is not zero.
    const value = field.value.trim() === '' ? Number.NaN : Number(field.value);
    if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(`${label} must be an integer from ${low} to ${high}`);
    return value;
  }
  function newNote(at: Rational, length: Rational, midi: number, value: number): Extract<ScoreEditOperation, {type: 'insert-notes'}> {
    const content = committed();
    const selectedPart = content.getPart(PartId(part.value)) ?? content.parts[0];
    if (!selectedPart) throw new Error('Add a part to the document before inserting notes');
    if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Written MIDI pitch must be 0–127');
    return {type: 'insert-notes', notes: [{id: NoteId(makeId('note')), partId: selectedPart.id,
      pitch: Pitch.fromMidi(midi).toJSON(), onsetQuarters: at.toJSON(), durationQuarters: length.toJSON(),
      voice: selectedPart.notes[0]?.voice ?? VoiceId('1'), velocity: value}]};
  }
  function selectInserted(operation: Extract<ScoreEditOperation, {type: 'insert-notes'}>): void {
    if (!disposed && editing?.state.available && editing.state.document.content.getNote(operation.notes[0].id)) editing.select([operation.notes[0].id]);
  }
  function numeric(inserting: boolean): void {
    if (!editable() || !editing) return;
    try {
      const context = commandContext();
      if (numericBinding !== context) {
        report(new ScoreEditError('revision-conflict', 'The selection or document changed; review the current values before applying.'));
        return;
      }
      const at = parseQuarter(onset); const length = parseQuarter(duration);
      const midi = integer(pitch, 'Written MIDI pitch', 0, 127); const value = integer(velocity, 'Velocity', 1, 127);
      if (inserting) {
        if (!has('draw')) return;
        const operation = newNote(at, length, midi, value);
        run('Insert note', [operation], context);
        selectInserted(operation);
        return;
      }
      if (selectedIds().length !== 1) return;
      const note = committed().getNote(selectedIds()[0]);
      if (!note || note.rest || note.unpitched) return;
      // Fields equal to the committed baseline, or owned by a disabled feature, submit nothing.
      const operations: ScoreEditOperation[] = [];
      if (has('move') && !at.eq(note.onsetQuarters)) operations.push({type: 'move-notes', noteIds: [note.id], deltaQuarters: at.sub(note.onsetQuarters).toJSON()});
      if (has('resize') && !length.eq(note.duration.quarters)) operations.push({type: 'resize-notes', noteIds: [note.id], durationQuarters: length.toJSON()});
      if (has('move') && midi !== note.pitch.midi) operations.push({type: 'transpose-notes', noteIds: [note.id], semitones: midi - note.pitch.midi});
      if (has('velocity') && value !== note.velocity) operations.push({type: 'set-velocity', noteIds: [note.id], velocity: value});
      if (operations.length) run('Change note values', operations, context);
      else if (cancelForCommand(context)) { message = 'No change'; draw(); }
    } catch (error) { report(error); }
  }

  // ---- Geometry ----
  function noteLaneTop(midi: number): number { return RULER_HEIGHT + (max - midi) * settings.noteHeight; }
  function quarterX(quarters: number): number { return KEY_WIDTH + quarters * settings.pixelsPerQuarter; }
  function pitchedNotes(score: Score): Note[] { return score.parts.flatMap((item) => item.notes.filter((note) => !note.rest && !note.unpitched)); }
  function geometry(): void {
    const notes = pitchedNotes(committed());
    // A one-sided explicit bound limits the computed side instead of being crossed by it.
    min = options.minPitch ?? Math.min(options.maxPitch ?? 127, Math.max(0, notes.reduce((value, note) => Math.min(value, note.pitch.midi - 2), 48)));
    max = options.maxPitch ?? Math.max(options.minPitch ?? 0, Math.min(127, notes.reduce((value, note) => Math.max(value, note.pitch.midi + 2), 84)));
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max > 127 || min > max) throw new RangeError('Invalid grid pitch range');
    width = Math.ceil(quarterX(Math.max(16, Math.ceil(visible().durationQuarters.toFloat() + 4))));
    height = RULER_HEIGHT + (max - min + 1) * settings.noteHeight + (laneVisible() ? LANE_HEIGHT : 0);
    svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
    svg.style.width = `${width}px`; svg.style.height = `${height}px`; svg.style.maxWidth = 'none';
  }
  function frame(): {left: number; right: number; top: number; bottom: number; laneTop: number} {
    const left = viewport.scrollLeft;
    const top = viewport.scrollTop;
    const right = Math.min(width, left + (viewport.clientWidth || 900));
    const bottom = Math.min(height, top + (viewport.clientHeight || height));
    return {left, right, top, bottom, laneTop: bottom - LANE_HEIGHT};
  }
  function shape(tag: string, attributes: Record<string, string | number>, text?: string, parent: Element = svg): SVGElement {
    const node = owner.createElementNS(SVG, tag) as SVGElement;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    parent.append(node); return node;
  }
  function box(note: Note): {x: number; width: number; top: number} {
    return {x: quarterX(note.onsetQuarters.toFloat()), width: Math.max(4, note.duration.quarters.toFloat() * settings.pixelsPerQuarter), top: noteLaneTop(note.pitch.midi)};
  }
  function band(top: number, active: boolean): {y: number; height: number} {
    const lane = settings.noteHeight;
    // Sounding notes fill their lane: a size cue in addition to the active colour.
    return active ? {y: top + .5, height: Math.max(2, lane - 1)} : {y: top + 2, height: Math.max(2, lane - 4)};
  }
  function velocityY(value: number, laneTop: number): number { return laneTop + LANE_HEIGHT - 6 - (value / 127) * (LANE_HEIGHT - 14); }

  // ---- Drawing ----
  function draw(): void {
    if (disposed) return;
    geometry();
    svg.replaceChildren(); drawnNotes.clear(); playhead = undefined; marquee = undefined;
    const {left, right, top, laneTop} = frame();
    const lane = settings.noteHeight;
    const gridBottom = RULER_HEIGHT + (max - min + 1) * lane;
    const score = visible();
    for (let midi = min; midi <= max; midi++) {
      shape('rect', {x: Math.max(KEY_WIDTH, left), y: noteLaneTop(midi), width: Math.max(0, right - Math.max(KEY_WIDTH, left)), height: lane,
        fill: BLACK.has(midi % 12) ? 'color-mix(in srgb, currentColor 7%, transparent)' : 'transparent',
        stroke: 'color-mix(in srgb, currentColor 8%, transparent)', 'stroke-width': midi % 12 === 0 ? 1 : .5, 'pointer-events': 'none'});
    }
    const bars = barLines(score, (right - KEY_WIDTH) / settings.pixelsPerQuarter + 1);
    const subdivision = grid();
    for (const bar of bars) {
      const barEnd = bar.quarter + bar.length;
      if (quarterX(barEnd) < left || quarterX(bar.quarter) > right) continue;
      // Subdivisions follow the snap grid; lines closer than 6px are omitted, not merged.
      const sub = subdivision && subdivision.toFloat() * settings.pixelsPerQuarter >= 6 ? subdivision.toFloat() : undefined;
      if (sub) {
        for (let at = bar.quarter + sub; at < barEnd - 1e-9; at += sub) {
          if (isBeat(at - bar.quarter, bar.beat)) continue;
          shape('line', {x1: quarterX(at), x2: quarterX(at), y1: RULER_HEIGHT, y2: gridBottom, stroke: 'currentColor', 'stroke-opacity': '.06', 'pointer-events': 'none'});
        }
      }
      for (let at = bar.quarter + bar.beat; at < barEnd - 1e-9; at += bar.beat) {
        shape('line', {x1: quarterX(at), x2: quarterX(at), y1: RULER_HEIGHT, y2: gridBottom, stroke: 'currentColor', 'stroke-opacity': '.14', 'pointer-events': 'none'});
      }
      shape('line', {x1: quarterX(bar.quarter), x2: quarterX(bar.quarter), y1: RULER_HEIGHT, y2: gridBottom, stroke: 'currentColor', 'stroke-opacity': '.35', 'pointer-events': 'none', 'data-bar': bar.number});
    }
    const selected = new Set<string>(selectedIds());
    const draft = editing?.state.interaction.draft;
    const base = committed();
    const visibleNotes: Note[] = [];
    for (const note of pitchedNotes(score)) {
      if (note.pitch.midi < min || note.pitch.midi > max) continue;
      const {x, width: noteWidth, top: noteTop} = box(note);
      if (x + noteWidth < left || x > right) continue;
      visibleNotes.push(note);
      const isSelected = selected.has(note.id);
      const drafted = Boolean(draft && base.getNote(note.id) !== note);
      // Selection, draft and playing states each have a non-colour cue: double ring, dashes, lane height.
      const rectangle = shape('rect', {x, ...band(noteTop, false), width: noteWidth - 1, rx: 2, fill: idleFill,
        'fill-opacity': drafted ? .55 : .35 + .65 * (note.velocity / 127),
        stroke: isSelected && !drafted ? contrast : 'currentColor', 'stroke-width': isSelected || drafted ? 1.5 : .5,
        'stroke-dasharray': drafted ? '4 2' : 'none', 'data-note-id': note.id,
        'data-selected': String(isSelected), 'data-draft': String(drafted), 'data-active': 'false',
        'aria-label': `${note.pitch.toString()}, quarter ${note.onsetQuarters}, duration ${note.duration.quarters}, velocity ${note.velocity}${isSelected ? ', selected' : ''}`, role: 'img'});
      const title = owner.createElementNS(SVG, 'title'); title.textContent = rectangle.getAttribute('aria-label'); rectangle.append(title);
      drawnNotes.set(note.id, {rectangle, top: noteTop, active: false});
      if (isSelected) {
        shape('rect', {x: x - 2, y: noteTop + .75, width: noteWidth + 3, height: Math.max(2, lane - 1.5), rx: 3, fill: 'none',
          stroke: 'currentColor', 'stroke-width': 1.5, 'data-selection-outline': '', 'pointer-events': 'none'});
        if (editable() && has('resize')) {
          shape('line', {x1: x + noteWidth - 5, x2: x + noteWidth - 5, y1: noteTop + Math.min(5, lane / 3), y2: noteTop + lane - Math.min(5, lane / 3),
            stroke: contrast, 'stroke-width': 2, 'stroke-linecap': 'round', 'data-resize-handle': '', 'pointer-events': 'none'});
        }
      }
    }
    // Sticky overlays follow the scroll position; notes pass beneath them.
    overlays = shape('g', {'data-overlays': '', 'pointer-events': 'none'});
    if (laneVisible()) {
      shape('rect', {x: left, y: laneTop, width: right - left, height: LANE_HEIGHT, fill: contrast, stroke: 'currentColor', 'stroke-opacity': '.3', 'data-velocity-lane': ''}, undefined, overlays);
      for (const value of [32, 64, 96, 127]) {
        shape('line', {x1: Math.max(KEY_WIDTH, left), x2: right, y1: velocityY(value, laneTop), y2: velocityY(value, laneTop), stroke: 'currentColor', 'stroke-opacity': '.08'}, undefined, overlays);
      }
      for (const note of visibleNotes) {
        const x = quarterX(note.onsetQuarters.toFloat());
        const y = velocityY(note.velocity, laneTop);
        const isSelected = selected.has(note.id);
        shape('line', {x1: x + 1, x2: x + 1, y1: laneTop + LANE_HEIGHT - 6, y2: y, stroke: isSelected ? activeFill : idleFill, 'stroke-width': 2}, undefined, overlays);
        shape('circle', {cx: x + 1, cy: y, r: isSelected ? 4 : 3, fill: isSelected ? activeFill : contrast, stroke: isSelected ? activeFill : idleFill, 'stroke-width': 1.5,
          'data-velocity-note-id': note.id}, undefined, overlays);
      }
      shape('rect', {x: left, y: laneTop, width: KEY_WIDTH, height: LANE_HEIGHT, fill: contrast, stroke: 'currentColor', 'stroke-opacity': '.3'}, undefined, overlays);
      shape('text', {x: left + 4, y: laneTop + 14, fill: 'currentColor', 'font-size': 10, 'aria-hidden': 'true'}, 'Velocity', overlays);
    }
    // Piano keys: white or black rows, with octave names on C.
    for (let midi = min; midi <= max; midi++) {
      const y = noteLaneTop(midi);
      if (y + lane < top + RULER_HEIGHT && y < top) continue;
      const black = BLACK.has(midi % 12);
      shape('rect', {x: left, y, width: KEY_WIDTH, height: lane, fill: black ? 'color-mix(in srgb, currentColor 70%, transparent)' : contrast,
        stroke: 'color-mix(in srgb, currentColor 30%, transparent)', 'stroke-width': .5, 'data-key': midi}, undefined, overlays);
      if (midi % 12 === 0) shape('text', {x: left + 4, y: y + lane - Math.max(2, (lane - 10) / 2), fill: 'currentColor', 'font-size': Math.min(11, Math.max(7, lane - 3)), 'aria-hidden': 'true'}, Pitch.fromMidi(midi).toString(), overlays);
    }
    // Ruler: bar numbers, and bar.beat labels once beats have room.
    shape('rect', {x: left, y: top, width: right - left, height: RULER_HEIGHT, fill: contrast, stroke: 'currentColor', 'stroke-opacity': '.3', 'data-ruler': ''}, undefined, overlays);
    for (const bar of bars) {
      if (quarterX(bar.quarter + bar.length) < left || quarterX(bar.quarter) > right) continue;
      const labelBeats = bar.beat * settings.pixelsPerQuarter >= 40;
      for (let beat = 0, at = bar.quarter; at < bar.quarter + bar.length - 1e-9; beat++, at += bar.beat) {
        if (beat > 0 && !labelBeats) break;
        const x = quarterX(at);
        shape('line', {x1: x, x2: x, y1: top + (beat ? RULER_HEIGHT - 6 : 2), y2: top + RULER_HEIGHT, stroke: 'currentColor', 'stroke-opacity': beat ? '.4' : '.8'}, undefined, overlays);
        shape('text', {x: x + 3, y: top + 14, fill: 'currentColor', 'font-size': 10, 'fill-opacity': beat ? '.7' : '1', 'aria-hidden': 'true'},
          beat ? `${bar.number}.${beat + 1}` : String(bar.number), overlays);
      }
    }
    shape('rect', {x: left, y: top, width: KEY_WIDTH, height: RULER_HEIGHT, fill: contrast, stroke: 'currentColor', 'stroke-opacity': '.3'}, undefined, overlays);
    paintMarquee();
    drawn = {key: editing ? editing.state : staticScore, revision: staticRevision, left, top, viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight};
    paintControls();
    paintPlayback();
  }
  function paintMarquee(): void {
    if (!gesture || gesture.kind !== 'marquee' || !gesture.changed || !overlays) return;
    const bounds = gesture as Gesture & {currentX?: number; currentY?: number};
    const x = Math.min(bounds.x, bounds.currentX ?? bounds.x); const y = Math.min(bounds.y, bounds.currentY ?? bounds.y);
    marquee = shape('rect', {x, y, width: Math.abs((bounds.currentX ?? bounds.x) - bounds.x), height: Math.abs((bounds.currentY ?? bounds.y) - bounds.y),
      fill: 'color-mix(in srgb, currentColor 8%, transparent)', stroke: 'currentColor', 'stroke-dasharray': '3 2', 'data-marquee': '', 'pointer-events': 'none'});
    svg.insertBefore(marquee, overlays);
  }
  /** `hidden` alone loses to an inline `display`, so flex containers toggle both. */
  function show(node: HTMLElement, shown: boolean, display = ''): void {
    node.hidden = !shown;
    node.style.display = shown ? display : 'none';
  }
  function paintControls(): void {
    const enabled = editable();
    const state = editing?.state;
    // A read-only grid is a labelled graphic, not a tab stop with hidden instructions.
    svg.setAttribute('role', enabled ? 'application' : 'img');
    if (enabled) { svg.setAttribute('tabindex', '0'); svg.setAttribute('aria-describedby', instructions.id); }
    else { svg.removeAttribute('tabindex'); svg.removeAttribute('aria-describedby'); }
    svg.style.cursor = !enabled ? 'default' : settings.tool === 'draw' ? 'crosshair' : 'default';
    element.dataset.editState = !editing ? 'static' : !state!.available ? 'unavailable' : state!.interaction.draft ? 'draft' : enabled ? 'ready' : 'readonly';
    element.dataset.tool = settings.tool;
    const shown = Boolean(editing && state!.available && state!.editable);
    show(toolbar, shown, 'flex'); instructions.hidden = !shown; details.hidden = !shown;
    if (!shown || !editing || !state) return;
    instructions.textContent = helpText();
    show(tools, has('draw'), 'inline-flex');
    for (const [button, tool] of [[selectTool, 'select'], [drawTool, 'draw']] as const) {
      const pressed = settings.tool === tool;
      button.setAttribute('aria-pressed', String(pressed));
      button.style.background = pressed ? 'color-mix(in srgb, currentColor 18%, var(--wm-surface,Canvas))' : 'var(--wm-surface,Canvas)';
      button.style.fontWeight = pressed ? '600' : '400';
    }
    show(snapGroup, has('snap'), 'inline-flex'); snapSelect.value = settings.snap;
    show(laneGroup, has('velocity'), 'inline-flex');
    laneToggle.setAttribute('aria-pressed', String(settings.velocityLane));
    laneToggle.style.background = settings.velocityLane ? 'color-mix(in srgb, currentColor 18%, var(--wm-surface,Canvas))' : 'var(--wm-surface,Canvas)';
    laneToggle.style.fontWeight = settings.velocityLane ? '600' : '400';
    show(zoomGroup, has('zoom'), 'inline-flex');
    show(editGroup, has('delete'), 'inline-flex');
    show(historyGroup, has('history'), 'inline-flex');
    deleteButton.disabled = !enabled || !selectedIds().length;
    undoButton.disabled = !enabled || !state.history.canUndo; redoButton.disabled = !enabled || !state.history.canRedo;
    const content = state.document.content;
    const key = content.parts.map((value) => `${value.id}:${value.name}`).join('|');
    if (key !== partsKey) {
      partsKey = key; const previous = part.value; part.replaceChildren();
      for (const value of content.parts) { const option = owner.createElement('option'); option.value = value.id; option.textContent = value.name; part.append(option); }
      if (content.getPart(PartId(previous))) part.value = previous;
    }
    const committedNote = content.getNote(selectedIds()[0]);
    const listedSelection = selectedIds().length === 1 && committedNote && !committedNote.rest && !committedNote.unpitched;
    const summaryText = selectedIds().length > 1 ? `${selectedIds().length} notes selected` :
      selectedIds().length && !listedSelection ? 'Selection outside piano roll' : '';
    if (existingContent !== content || existingSummary !== summaryText) {
      existingContent = content; existingSummary = summaryText;
      existing.replaceChildren();
      const none = owner.createElement('option'); none.value = ''; none.textContent = 'No selection'; existing.append(none);
      if (summaryText) {
        const option = owner.createElement('option'); option.value = 'selection'; option.textContent = summaryText; option.disabled = true; existing.append(option);
      }
      for (const [partIndex, item] of content.parts.entries()) {
        const notes = item.notes.filter((note) => !note.rest && !note.unpitched).sort((a, b) =>
          a.onsetQuarters.cmp(b.onsetQuarters) || a.pitch.midi - b.pitch.midi || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const [noteIndex, note] of notes.entries()) {
          const option = owner.createElement('option'); option.value = `note:${note.id}`;
          option.textContent = `${item.name} (part ${partIndex + 1}) · ${note.pitch.toString()} · quarter ${note.onsetQuarters} · voice ${note.voice} · note ${noteIndex + 1}`;
          existing.append(option);
        }
      }
    }
    existing.value = listedSelection ? `note:${committedNote.id}` : summaryText ? 'selection' : '';
    const nextNumericBinding = commandContext();
    const bindingChanged = numericBinding !== nextNumericBinding;
    numericBinding = nextNumericBinding;
    // Pending values belong to this committed target/revision, never to a shared
    // preview or a later selection. Same-binding redraws preserve form input.
    if (listedSelection && bindingChanged) {
      onset.value = committedNote.onsetQuarters.toString(); duration.value = committedNote.duration.quarters.toString();
      pitch.value = String(committedNote.pitch.midi); velocity.value = String(committedNote.velocity);
    }
    const [onsetLabel, durationLabel, pitchLabel, velocityLabel] = fields;
    onsetLabel.hidden = !has('move') && !has('draw'); pitchLabel.hidden = !has('move') && !has('draw');
    durationLabel.hidden = !has('resize') && !has('draw'); velocityLabel.hidden = !has('velocity') && !has('draw');
    partLabel.hidden = !has('draw'); insert.hidden = !has('draw');
    apply.hidden = !has('move') && !has('resize') && !has('velocity');
    for (const field of [existing, onset, duration, pitch, velocity, part, insert]) field.disabled = !enabled;
    apply.disabled = !enabled || !listedSelection;
  }
  function helpText(): string {
    const parts = ['Click a note to select; Shift-click adds to the selection; drag empty space to select an area.'];
    if (has('move')) parts.push('Drag a note to move it in time and pitch.');
    if (has('resize')) parts.push('Drag its right edge to resize.');
    if (has('draw')) parts.push(`With the Draw tool (B), click or drag empty space to add a note${has('delete') ? ' and click a note to remove it' : ''}; in Select, double-click or Alt-drag to add.`);
    if (has('velocity')) parts.push('In the velocity lane, drag a note’s stem up or down.');
    if (has('move')) parts.push('Arrow keys nudge.');
    if (has('resize')) parts.push('Shift+Left/Right resizes.');
    if (has('delete')) parts.push('Delete removes.');
    if (has('history')) parts.push('Ctrl/Cmd+Z undoes.');
    if (has('zoom')) parts.push('Ctrl/Cmd+wheel zooms time; Alt+wheel zooms rows.');
    parts.push('Escape cancels. Note values offers every edit without a pointer.');
    return parts.join(' ');
  }
  /** Playhead, sounding notes and status over the current drawing; writes only what changed. */
  function paintPlayback(): void {
    const seconds = playback?.seconds ?? null;
    let active: ReadonlySet<string>;
    if (!playback || seconds === null) active = new Set();
    else if (playback.activeNoteIds) active = playback.activeNoteIds;
    else {
      const at = committed().timeMap.secondsToQuarters(seconds);
      active = new Set(pitchedNotes(committed()).filter((note) => note.onsetQuarters.lte(at) && at.lt(note.offsetQuarters)).map((note) => note.id));
    }
    for (const [id, item] of drawnNotes) {
      const on = active.has(id);
      if (on === item.active) continue;
      item.active = on;
      const {y, height: bandHeight} = band(item.top, on);
      item.rectangle.setAttribute('y', String(y)); item.rectangle.setAttribute('height', String(bandHeight));
      item.rectangle.setAttribute('fill', on ? activeFill : idleFill); item.rectangle.setAttribute('data-active', String(on));
    }
    if (seconds === null) { playhead?.remove(); playhead = undefined; }
    else {
      const x = String(quarterX(committed().timeMap.secondsToQuarters(seconds).toFloat()));
      if (!playhead) {
        playhead = shape('line', {y1: RULER_HEIGHT, y2: RULER_HEIGHT + (max - min + 1) * settings.noteHeight, stroke: 'currentColor', 'stroke-width': 2, 'data-playhead': '', 'pointer-events': 'none'});
        if (overlays) svg.insertBefore(playhead, overlays);
      }
      playhead.setAttribute('x1', x); playhead.setAttribute('x2', x);
    }
    const playbackState = !playback ? 'unbound' : seconds === null ? 'pending' : 'ready';
    if (element.dataset.playbackState !== playbackState) element.dataset.playbackState = playbackState;
    if (!editing) { if (feedback.textContent) feedback.textContent = ''; feedback.hidden = true; return; }
    feedback.hidden = false;
    const state = editing.state;
    const text = message || state.error?.message || `${state.interaction.draft ? 'Draft · ' : ''}${selectedIds().length} selected${!state.available ? ' · Document unavailable' : !editable() ? ' · Read only' : ''}${playback && seconds === null ? ' · Playback pending or unavailable' : ''}`;
    // Rewriting identical text on every playback frame would re-announce or churn the live region.
    if (feedback.textContent !== text) feedback.textContent = text;
  }

  // ---- Pointer and keyboard ----
  function point(event: MouseEvent): {x: number; y: number} {
    const rect = svg.getBoundingClientRect();
    return {x: (event.clientX - rect.left) * (rect.width ? width / rect.width : 1), y: (event.clientY - rect.top) * (rect.height ? height / rect.height : 1)};
  }
  function region(position: {x: number; y: number}): 'grid' | 'lane' | 'ruler' | 'keys' {
    const {left, top, laneTop} = frame();
    if (laneVisible() && position.y >= laneTop) return 'lane';
    if (position.y < top + RULER_HEIGHT || position.y >= RULER_HEIGHT + (max - min + 1) * settings.noteHeight) return 'ruler';
    if (position.x < left + KEY_WIDTH) return 'keys';
    return 'grid';
  }
  function quarterAt(x: number): number { return Math.max(0, (x - KEY_WIDTH) / settings.pixelsPerQuarter); }
  function snapDelta(quarters: number): Rational {
    const unit = grid() ?? FINE;
    return unit.mul(new Rational(Math.round(quarters / unit.toFloat())));
  }
  /** Insertion uses the grid cell under the pointer, so the new note covers the point that created it. */
  function cell(x: number): Rational {
    const unit = grid() ?? FINE;
    return unit.mul(new Rational(Math.floor(quarterAt(x) / unit.toFloat() + 1e-9)));
  }
  function lanePitch(y: number): number { return Math.max(min, Math.min(max, max - Math.floor((y - RULER_HEIGHT) / settings.noteHeight))); }
  /**
   * Hit-test the displayed geometry, not event.target: selection and cancellation redraw the
   * grid, detaching the pressed node, so later click/dblclick events target the SVG itself.
   */
  function hit(position: {x: number; y: number}): Note | undefined {
    let found: NoteId | undefined;
    for (const note of pitchedNotes(visible())) {
      if (note.pitch.midi < min || note.pitch.midi > max) continue;
      const {x, width: noteWidth, top} = box(note);
      if (position.x >= x && position.x < x + noteWidth && position.y >= top && position.y < top + settings.noteHeight) found = note.id;
    }
    return found ? committed().getNote(found) : undefined;
  }
  /** The velocity stem nearest the pointer among notes whose span covers it. */
  function velocityHit(position: {x: number; y: number}): Note | undefined {
    const {laneTop} = frame();
    let best: Note | undefined; let distance = Infinity;
    for (const note of pitchedNotes(committed())) {
      if (note.pitch.midi < min || note.pitch.midi > max) continue;
      const {x, width: noteWidth} = box(note);
      if (position.x < x - 4 || position.x > Math.max(x + 6, x + noteWidth)) continue;
      const gap = Math.abs(velocityY(note.velocity, laneTop) - position.y) + Math.abs(position.x - x) / 4;
      if (gap < distance) { distance = gap; best = note; }
    }
    return best;
  }
  function preview(operations: readonly ScoreEditOperation[]): void {
    const pending = gesture;
    if (!pending || !editing) return;
    if (!currentContext(pending.context)) { cancel(); return; }
    const result = editing.preview(operations);
    if (gesture !== pending || disposed) return;
    pending.valid = result.status === 'preview'; pending.changed = true;
    if (result.status === 'preview') { message = ''; options.onPreview?.(result); }
    else { editing.cancel(); report(result.error); }
  }
  function cancel(): void {
    const previous = gesture; gesture = undefined;
    if (previous && svg.hasPointerCapture?.(previous.pointerId)) svg.releasePointerCapture(previous.pointerId);
    if (previous?.kind === 'marquee') draw();
    editing?.cancel();
  }
  function begin(event: PointerEvent, value: Omit<Gesture, 'pointerId' | 'revision'>): void {
    gesture = {pointerId: event.pointerId, revision: editing!.state.document.documentRevision, ...value};
    svg.setPointerCapture?.(event.pointerId);
  }
  function startInsert(event: PointerEvent, position: {x: number; y: number}, context: string): void {
    if (!editing || !cancelForCommand(context)) return;
    try {
      const insertContext = commandContext(event.shiftKey ? selectedIds() : []);
      if (!event.shiftKey) editing.select([]);
      if (!currentContext(insertContext)) return;
      const operation = newNote(cell(position.x), step(), lanePitch(position.y), 100);
      begin(event, {context: insertContext, ...position, kind: 'insert', notes: [], insert: operation, valid: true, changed: false});
      preview([operation]);
    } catch (error) { cancel(); report(error); }
  }
  function down(event: PointerEvent): void {
    if (!editable() || !editing || event.button !== 0) return;
    const position = point(event);
    const area = region(position);
    if (area === 'ruler' || area === 'keys') return;
    event.preventDefault(); svg.focus();
    const context = commandContext();
    if (area === 'lane') {
      const note = velocityHit(position);
      if (!note || !cancelForCommand(context)) return;
      const selected = selectedIds();
      const gestureContext = commandContext(selected.includes(note.id) ? selected : [note.id]);
      if (!selected.includes(note.id)) editing.select([note.id]);
      if (!currentContext(gestureContext)) return;
      begin(event, {context: gestureContext, ...position, kind: 'velocity',
        notes: selectedIds().map((id) => committed().getNote(id)!).filter(Boolean), valid: true, changed: false});
      return;
    }
    const note = hit(position);
    if (!note) {
      if (has('draw') && (settings.tool === 'draw' || event.altKey)) { startInsert(event, position, context); return; }
      if (!cancelForCommand(context)) return;
      const base = event.shiftKey ? selectedIds() : [];
      if (!event.shiftKey) editing.select([]);
      begin(event, {context: commandContext(), ...position, kind: 'marquee', notes: [], base, valid: true, changed: false});
      return;
    }
    if (!cancelForCommand(context)) return;
    const selected = selectedIds();
    if (settings.tool === 'draw' && has('delete') && !event.shiftKey) {
      run('Delete notes', [{type: 'delete-notes', noteIds: [note.id]}]);
      return;
    }
    if (event.shiftKey) {
      editing.select(selected.includes(note.id) ? selected.filter((id) => id !== note.id) : [...selected, note.id]);
      return;
    }
    const gestureContext = commandContext(selected.includes(note.id) ? selected : [note.id]);
    if (!selected.includes(note.id)) editing.select([note.id]);
    if (!currentContext(gestureContext)) return;
    const edge = quarterX(note.offsetQuarters.toFloat());
    const onEdge = edge - position.x <= Math.min(8, note.duration.quarters.toFloat() * settings.pixelsPerQuarter / 3);
    const kind = onEdge && has('resize') ? 'resize' : has('move') ? 'move' : undefined;
    if (!kind) return;
    begin(event, {context: gestureContext, ...position, kind,
      notes: selectedIds().map((id) => committed().getNote(id)!).filter(Boolean), valid: true, changed: false});
  }
  function move(event: PointerEvent): void {
    const pending = gesture;
    if (!pending || event.pointerId !== pending.pointerId || !editable() || !editing) return;
    // No pressed primary button means its pointerup was lost; never keep previewing that gesture.
    if ((event.buttons & 1) === 0) { cancel(); return; }
    if (!currentContext(pending.context)) { cancel(); return; }
    const position = point(event);
    if (pending.kind === 'marquee') {
      Object.assign(pending, {currentX: position.x, currentY: position.y});
      if (!pending.changed && Math.abs(position.x - pending.x) < 3 && Math.abs(position.y - pending.y) < 3) return;
      pending.changed = true;
      const [x1, x2] = [Math.min(pending.x, position.x), Math.max(pending.x, position.x)];
      const [y1, y2] = [Math.min(pending.y, position.y), Math.max(pending.y, position.y)];
      const inside = pitchedNotes(committed()).filter((note) => {
        if (note.pitch.midi < min || note.pitch.midi > max) return false;
        const {x, width: noteWidth, top} = box(note);
        return x < x2 && x + noteWidth > x1 && top < y2 && top + settings.noteHeight > y1;
      }).map((note) => note.id);
      const next = [...new Set([...(pending.base ?? []), ...inside])];
      const current = selectedIds();
      if (next.length !== current.length || next.some((id, index) => id !== current[index])) editing.select(next);
      pending.context = commandContext();
      draw();
      return;
    }
    if (pending.kind === 'velocity') {
      const delta = Math.round((pending.y - position.y) / (LANE_HEIGHT - 14) * 127);
      if (!pending.changed && delta === 0) return;
      preview(pending.notes.map((note) => ({type: 'set-velocity', noteIds: [note.id], velocity: Math.max(1, Math.min(127, note.velocity + delta))})));
      return;
    }
    const delta = snapDelta((position.x - pending.x) / settings.pixelsPerQuarter);
    if (pending.kind === 'insert' && pending.insert) {
      const start = Rational.from(pending.insert.notes[0].onsetQuarters);
      const end = snapDelta(quarterAt(position.x));
      const length = end.sub(start).gt(step()) ? end.sub(start) : step();
      preview([{...pending.insert, notes: pending.insert.notes.map((note) => ({...note, durationQuarters: length.toJSON()}))}]);
      return;
    }
    if (pending.kind === 'resize') {
      if (!pending.changed && delta.isZero()) return;
      const shortest = grid() ?? FINE;
      preview(pending.notes.map((note) => {
        const next = note.duration.quarters.add(delta);
        return {type: 'resize-notes', noteIds: [note.id], durationQuarters: (next.gt(shortest) ? next : shortest).toJSON()};
      }));
      return;
    }
    const semitones = Math.round((pending.y - position.y) / settings.noteHeight);
    if (!pending.changed && delta.isZero() && semitones === 0) return;
    // Clamp at the score start and the MIDI range instead of failing the whole drag.
    const earliest = pending.notes.reduce((value, note) => note.onsetQuarters.lt(value) ? note.onsetQuarters : value, pending.notes[0]?.onsetQuarters ?? Rational.ZERO);
    const shift = earliest.add(delta).lt(Rational.ZERO) ? earliest.neg() : delta;
    const low = Math.min(...pending.notes.map((note) => note.pitch.midi)); const high = Math.max(...pending.notes.map((note) => note.pitch.midi));
    const transpose = Math.max(-low, Math.min(127 - high, semitones));
    preview([{type: 'move-notes', noteIds: pending.notes.map((note) => note.id), deltaQuarters: shift.toJSON()},
      {type: 'transpose-notes', noteIds: pending.notes.map((note) => note.id), semitones: transpose}]);
  }
  function up(event: PointerEvent): void {
    const pending = gesture;
    if (!pending || event.pointerId !== pending.pointerId || !editing) return;
    gesture = undefined;
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (pending.kind === 'marquee') { draw(); return; }
    if (!pending.valid || !currentContext(pending.context)) { editing.cancel(); return; }
    if (pending.changed) {
      const operations = editing.state.interaction.draft?.operations;
      const label = pending.kind === 'resize' ? 'Resize notes' : pending.kind === 'insert' ? 'Insert note' : pending.kind === 'velocity' ? 'Change velocity' : 'Move notes';
      if (operations) run(label, operations, pending.context);
      if (pending.insert) selectInserted(pending.insert);
    }
  }
  function doubleClick(event: MouseEvent): void {
    if (!editable() || !has('draw') || settings.tool === 'draw') return;
    const position = point(event);
    if (region(position) !== 'grid' || hit(position)) return;
    try {
      const operation = newNote(cell(position.x), step(), lanePitch(position.y), 100);
      run('Insert note', [operation]);
      selectInserted(operation);
    } catch (error) { report(error); }
  }
  function key(event: KeyboardEvent): void {
    if (!editable() || !editing) return;
    const command = event.ctrlKey || event.metaKey;
    const ids = selectedIds();
    // Leave an Escape that cancels nothing to enclosing handlers such as a dialog.
    if (event.key === 'Escape') { if (gesture || editing.state.interaction.draft) { event.preventDefault(); cancel(); } return; }
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault(); editing.select(pitchedNotes(committed()).map((note) => note.id)); return;
    }
    if (command && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      if (!has('history')) return;
      event.preventDefault(); travelHistory(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return;
    }
    if (!command && !event.altKey && event.key.toLowerCase() === 'b' && has('draw')) {
      event.preventDefault(); change({tool: settings.tool === 'draw' ? 'select' : 'draw'}, 'tool'); return;
    }
    if (!ids.length) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && has('delete')) { event.preventDefault(); run('Delete notes', [{type: 'delete-notes', noteIds: ids}]); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const amount = step().mul(new Rational(direction));
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!has('move')) return;
      event.preventDefault(); run('Transpose notes', [{type: 'transpose-notes', noteIds: ids, semitones: direction}]);
    } else if (event.shiftKey) {
      if (!has('resize')) return;
      event.preventDefault();
      run('Resize notes', ids.map((id) => ({type: 'resize-notes', noteIds: [id], durationQuarters: committed().getNote(id)!.duration.quarters.add(amount).toJSON()})));
    } else {
      if (!has('move')) return;
      event.preventDefault(); run('Move notes', [{type: 'move-notes', noteIds: ids, deltaQuarters: amount.toJSON()}]);
    }
  }
  function wheel(event: WheelEvent): void {
    if (!editable() || !has('zoom') || !(event.ctrlKey || event.metaKey || event.altKey) || event.deltaY === 0) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoom(event.altKey && !(event.ctrlKey || event.metaKey) ? 'noteHeight' : 'pixelsPerQuarter', factor, event);
  }
  const onScroll = () => draw();
  const onCancel = () => { if (gesture) cancel(); };
  const onPointerCancel = (event: PointerEvent) => { if (gesture && event.pointerId === gesture.pointerId) cancel(); };
  draw();
  host.append(element);
  let unsubscribe = (): void => {};
  if (editing) {
    try {
      unsubscribe = editing.subscribe((state) => {
        if (gesture && (gesture.revision !== state.document.documentRevision || !state.available || !state.editable)) {
          const previous = gesture; gesture = undefined;
          if (svg.hasPointerCapture?.(previous.pointerId)) svg.releasePointerCapture(previous.pointerId);
        }
        draw();
      });
    } catch (error) { disposed = true; element.remove(); throw error; }
  }
  svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', onPointerCancel); svg.addEventListener('lostpointercapture', onPointerCancel);
  svg.addEventListener('blur', onCancel); svg.addEventListener('keydown', key); svg.addEventListener('dblclick', doubleClick);
  svg.addEventListener('wheel', wheel, {passive: false});
  owner.defaultView?.addEventListener('blur', onCancel);
  viewport.addEventListener('scroll', onScroll, {passive: true});
  let viewportWidth = viewport.clientWidth;
  let viewportHeight = viewport.clientHeight;
  const ViewResizeObserver = owner.defaultView?.ResizeObserver;
  const resizeObserver = ViewResizeObserver ? new ViewResizeObserver(() => {
    if (disposed) return;
    const nextWidth = viewport.clientWidth;
    const nextHeight = viewport.clientHeight;
    if (nextWidth === viewportWidth && nextHeight === viewportHeight) return;
    viewportWidth = nextWidth; viewportHeight = nextHeight;
    // A resized scroll surface invalidates an in-flight pointer coordinate frame.
    // Only cancel this surface's gesture; a borrowed session may hold another view's draft.
    if (gesture) cancel();
    draw();
  }) : undefined;
  resizeObserver?.observe(viewport);
  return {element, surface: svg,
    get settings() { return settings; },
    get features() { return SCORE_GRID_FEATURES.filter((feature) => features.has(feature)); },
    configure(next) {
      const updated = validSettings(settings, next);
      const nextFeatures = next.features ? new Set(validFeatures(next.features)) : features;
      const same = (Object.keys(updated) as (keyof ScoreGridSettings)[]).every((key) => updated[key] === settings[key]) &&
        nextFeatures.size === features.size && [...nextFeatures].every((feature) => features.has(feature));
      if (same || disposed) return;
      if (gesture) cancel();
      settings = updated; features = nextFeatures;
      // A tool that is no longer offered falls back to selection.
      if (settings.tool === 'draw' && !features.has('draw')) settings = {...settings, tool: 'select'};
      staticRevision += 1;
      draw();
    },
    updatePlayback(value) {
      playback = value;
      if (disposed) return;
      // Playback-only frames reuse the drawing; content, interaction or viewport changes redraw it.
      if (drawn && drawn.key === (editing ? editing.state : staticScore) && drawn.revision === staticRevision &&
        drawn.left === viewport.scrollLeft && drawn.top === viewport.scrollTop &&
        drawn.viewportWidth === viewport.clientWidth && drawn.viewportHeight === viewport.clientHeight) paintPlayback();
      else draw();
    }, cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      try { if (gesture) cancel(); }
      finally {
        unsubscribe(); resizeObserver?.disconnect();
        svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', onPointerCancel); svg.removeEventListener('lostpointercapture', onPointerCancel);
        svg.removeEventListener('blur', onCancel); svg.removeEventListener('keydown', key); svg.removeEventListener('dblclick', doubleClick);
        svg.removeEventListener('wheel', wheel);
        owner.defaultView?.removeEventListener('blur', onCancel);
        viewport.removeEventListener('scroll', onScroll); element.remove();
      }
    },
  };
}

/** Parse a `tools`-style token list. Unknown tokens throw; an empty list disables every feature. */
export function parseScoreGridFeatures(value: string): ScoreGridFeature[] {
  return validFeatures(value.split(/[\s,]+/).filter(Boolean) as ScoreGridFeature[]);
}

function validFeatures(values: readonly ScoreGridFeature[]): ScoreGridFeature[] {
  for (const value of values) if (!SCORE_GRID_FEATURES.includes(value)) throw new RangeError(`Unknown score grid feature: ${String(value)}`);
  return SCORE_GRID_FEATURES.filter((feature) => values.includes(feature));
}

function validSettings(current: ScoreGridSettings, next: Partial<ScoreGridSettings>): ScoreGridSettings {
  const result = {...current};
  if (next.tool !== undefined) {
    if (next.tool !== 'select' && next.tool !== 'draw') throw new RangeError(`Unknown score grid tool: ${String(next.tool)}`);
    result.tool = next.tool;
  }
  if (next.snap !== undefined) {
    if (!SCORE_GRID_SNAPS.includes(next.snap)) throw new RangeError(`Unknown score grid snap: ${String(next.snap)}`);
    result.snap = next.snap;
  }
  if (next.velocityLane !== undefined) result.velocityLane = Boolean(next.velocityLane);
  if (next.pixelsPerQuarter !== undefined) result.pixelsPerQuarter = bounded(next.pixelsPerQuarter, 'pixelsPerQuarter', SCALE_RANGE);
  if (next.noteHeight !== undefined) result.noteHeight = bounded(next.noteHeight, 'noteHeight', ROW_RANGE);
  return Object.freeze(result);
}

function bounded(value: number, name: string, [low, high]: readonly [number, number]): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
  return Math.min(high, Math.max(low, value));
}

function isBeat(offset: number, beat: number): boolean {
  const ratio = offset / beat;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

interface BarLine { number: number; quarter: number; length: number; beat: number }

/** Bars from the score's time signatures (4/4 before the first one), up to `until` quarters. */
function barLines(score: Score, until: number): BarLine[] {
  const ppq = score.ppq || 480;
  const signatures = [...score.timeSignatures].map((entry) => ({quarter: entry.tick / ppq, numerator: entry.numerator, denominator: entry.denominator}))
    .filter((entry) => entry.numerator > 0 && entry.denominator > 0).sort((a, b) => a.quarter - b.quarter);
  if (!signatures.length || signatures[0].quarter > 0) signatures.unshift({quarter: 0, numerator: 4, denominator: 4});
  const bars: BarLine[] = [];
  let index = 0; let at = 0; let number = 1;
  while (at < until && bars.length < 100_000) {
    while (index + 1 < signatures.length && signatures[index + 1].quarter <= at + 1e-9) index++;
    const signature = signatures[index];
    const beat = 4 / signature.denominator;
    let length = signature.numerator * beat;
    // A signature change inside a bar ends that bar early.
    const next = signatures[index + 1];
    if (next && next.quarter < at + length - 1e-9) length = next.quarter - at;
    bars.push({number, quarter: at, length, beat});
    at += length; number++;
  }
  return bars;
}
