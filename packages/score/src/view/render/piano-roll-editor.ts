import {NoteId, PartId, Pitch, Rational, ScoreEditError, VoiceId, makeId,
  type Note, type Score, type ScoreDraftResult, type ScoreEditOperation, type ScoreEditResult,
  type ScorePlaybackSnapshot, type ScoreQuarterValue} from '../../core';
import {scoreDocumentPlaybackCompatible, type ScoreViewEditing, type ScoreViewEditingState} from '../headless/score-editing';

export interface PianoRollEditingOptions {
  pixelsPerQuarter?: number;
  noteHeight?: number;
  minPitch?: number;
  maxPitch?: number;
  editingGrid?: ScoreQuarterValue;
  noteColor?: string;
  activeNoteColor?: string;
  noteRGB?: string;
  activeNoteRGB?: string;
  onPreview?(result: Extract<ScoreDraftResult, {status: 'preview'}>): void;
  onCommit?(result: Extract<ScoreEditResult, {status: 'committed'}>): void;
  onError?(error: unknown): void;
}
export interface PianoRollEditingHandle {
  readonly element: HTMLElement;
  readonly surface: SVGSVGElement;
  updatePlayback(playback?: ScorePlaybackSnapshot): void;
  cancel(): void;
  dispose(): void;
}

interface Gesture {
  pointerId: number;
  revision: number;
  context: string;
  x: number;
  y: number;
  kind: 'move' | 'resize' | 'insert';
  notes: readonly Note[];
  insert?: Extract<ScoreEditOperation, {type: 'insert-notes'}>;
  valid: boolean;
  changed: boolean;
}

/** Written-quarter editing surface. It borrows a View controller and creates no document or clock. */
export function mountPianoRollEditor(host: HTMLElement, editing: ScoreViewEditing, options: PianoRollEditingOptions = {}): PianoRollEditingHandle {
  const owner = host.ownerDocument;
  const scale = positive(options.pixelsPerQuarter ?? 64, 'pixelsPerQuarter');
  const lane = positive(options.noteHeight ?? 20, 'noteHeight');
  const grid = Rational.from(options.editingGrid ?? [1, 4]);
  if (!grid.gt(Rational.ZERO)) throw new RangeError('The editing grid must be positive');
  const element = owner.createElement('section');
  element.setAttribute('part', 'editor');
  element.style.cssText = 'display:grid;gap:.5rem;min-width:0;color:var(--wm-foreground,inherit)';
  const instructions = owner.createElement('p');
  instructions.id = makeId('score-edit-help');
  instructions.textContent = 'Click a note to select; Shift-click adds to selection. Use Select existing note in Note values and keyboard alternatives to select without a pointer. Drag to move, drag its right edge to resize. Double-click empty space to insert, or Alt-drag to draw. Arrow keys nudge; Shift+Left/Right resizes. Delete removes; Ctrl/Cmd+Z undoes. Escape cancels.';
  instructions.style.cssText = 'margin:0;font:inherit;font-size:.8em';
  instructions.setAttribute('part', 'editing-instructions');
  const viewport = owner.createElement('div');
  viewport.setAttribute('part', 'editing-viewport');
  viewport.style.cssText = 'overflow:auto;max-height:32rem;min-width:0;border:1px solid var(--wm-border,#888);background:var(--wm-score-view-background,var(--wm-surface,Canvas))';
  const svg = owner.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('part', 'editing-surface');
  svg.setAttribute('aria-label', 'Piano roll, written pitch and quarter notes');
  svg.style.cssText = 'display:block;touch-action:none;outline-offset:-3px';
  viewport.append(svg);
  const feedback = owner.createElement('div');
  feedback.setAttribute('part', 'editing-status');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const details = owner.createElement('details');
  details.setAttribute('part', 'note-properties');
  details.style.cssText = 'min-width:0;max-width:100%';
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
    if (!editable()) return;
    try {
      if (existing.value === '') editing.select([]);
      else if (existing.value.startsWith('note:')) editing.select([NoteId(existing.value.slice(5))]);
      message = ''; draw();
    } catch (error) { report(error); }
  });
  const input = (label: string, type: string, value: string): HTMLInputElement => {
    const wrapper = owner.createElement('label');
    wrapper.textContent = `${label} `;
    const field = owner.createElement('input');
    field.type = type; field.value = value; field.setAttribute('aria-label', label);
    field.style.width = '7em';
    wrapper.append(field); form.append(wrapper);
    return field;
  };
  const onset = input('Onset (quarters)', 'text', '0');
  const duration = input('Duration (quarters)', 'text', '1');
  const pitch = input('Written MIDI pitch', 'number', '60'); pitch.min = '0'; pitch.max = '127'; pitch.step = '1';
  const velocity = input('Velocity', 'number', '80'); velocity.min = '1'; velocity.max = '127'; velocity.step = '1';
  const partLabel = owner.createElement('label'); partLabel.textContent = 'Insert into part ';
  const part = owner.createElement('select'); part.setAttribute('aria-label', 'Insert into part'); partLabel.append(part); form.append(partLabel);
  const button = (label: string, action: () => void): HTMLButtonElement => {
    const result = owner.createElement('button'); result.type = 'button'; result.textContent = label;
    result.addEventListener('click', action); form.append(result); return result;
  };
  const apply = button('Apply to selected note', () => numeric(false));
  const insert = button('Insert note', () => numeric(true));
  const remove = button('Delete selected', () => run('Delete notes', [{type: 'delete-notes', noteIds: selectedIds()}]));
  const undo = button('Undo', () => travelHistory('undo'));
  const redo = button('Redo', () => travelHistory('redo'));
  form.addEventListener('submit', (event) => { event.preventDefault(); numeric(false); });
  details.append(form);
  element.append(instructions, viewport, feedback, details);
  let disposed = false;
  let gesture: Gesture | undefined;
  let playback: ScorePlaybackSnapshot | undefined;
  let message = '';
  let min = 48;
  let max = 84;
  let width = 1;
  let height = 1;
  let partsKey = '';
  let existingContent: Score | undefined;
  let existingSummary = '';
  let numericBinding = '';
  // The last full drawing; playback-only updates repaint overlays on it instead of rebuilding.
  let drawn: {state: ScoreViewEditingState; left: number; viewportWidth: number} | undefined;
  const drawnNotes = new Map<NoteId, {rectangle: SVGElement; top: number; active: boolean}>();
  let playhead: SVGElement | undefined;
  const idleFill = options.noteColor ?? (options.noteRGB ? `rgb(${options.noteRGB})` : 'var(--wm-score-view-note,var(--wm-accent,#4869d8))');
  const activeFill = options.activeNoteColor ?? (options.activeNoteRGB ? `rgb(${options.activeNoteRGB})` : 'var(--wm-score-view-active-note,var(--wm-accent,#e25477))');
  // Selection rings and handles contrast with any note fill by reusing the surface background.
  const contrast = 'var(--wm-score-view-background,var(--wm-surface,Canvas))';
  function selectedIds(): readonly NoteId[] { return editing.state.interaction.selectedNoteIds; }
  function commandContext(selection = selectedIds()): string {
    const document = editing.state.document;
    return JSON.stringify([document.documentId, document.documentRevision, selection]);
  }
  function editable(): boolean { return !disposed && editing.state.available && editing.state.editable; }
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
    if (!cancelForCommand(expectedContext)) return;
    completed(editing.execute(label, operations));
  }
  function travelHistory(direction: 'undo' | 'redo'): void {
    if (cancelForCommand()) completed(editing[direction]());
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
    const content = editing.state.document.content;
    const selectedPart = content.getPart(PartId(part.value)) ?? content.parts[0];
    if (!selectedPart) throw new Error('Add a part to the document before inserting notes');
    if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Written MIDI pitch must be 0–127');
    return {type: 'insert-notes', notes: [{id: NoteId(makeId('note')), partId: selectedPart.id,
      pitch: Pitch.fromMidi(midi).toJSON(), onsetQuarters: at.toJSON(), durationQuarters: length.toJSON(),
      voice: selectedPart.notes[0]?.voice ?? VoiceId('1'), velocity: value}]};
  }
  function numeric(inserting: boolean): void {
    if (!editable()) return;
    try {
      const context = commandContext();
      if (numericBinding !== context) {
        report(new ScoreEditError('revision-conflict', 'The selection or document changed; review the current values before applying.'));
        return;
      }
      const at = parseQuarter(onset); const length = parseQuarter(duration);
      const midi = integer(pitch, 'Written MIDI pitch', 0, 127); const value = integer(velocity, 'Velocity', 1, 127);
      if (inserting) {
        const operation = newNote(at, length, midi, value);
        run('Insert note', [operation], context);
        if (!disposed && editing.state.available && editing.state.document.content.getNote(operation.notes[0].id)) editing.select([operation.notes[0].id]);
      } else {
        if (selectedIds().length !== 1) return;
        const note = editing.state.document.content.getNote(selectedIds()[0]);
        if (!note || note.rest || note.unpitched) return;
        // Fields equal to the committed baseline submit nothing: no history item, dirty state or lost redo.
        const operations: ScoreEditOperation[] = [];
        if (!at.eq(note.onsetQuarters)) operations.push({type: 'move-notes', noteIds: [note.id], deltaQuarters: at.sub(note.onsetQuarters).toJSON()});
        if (!length.eq(note.duration.quarters)) operations.push({type: 'resize-notes', noteIds: [note.id], durationQuarters: length.toJSON()});
        if (midi !== note.pitch.midi) operations.push({type: 'transpose-notes', noteIds: [note.id], semitones: midi - note.pitch.midi});
        if (value !== note.velocity) operations.push({type: 'set-velocity', noteIds: [note.id], velocity: value});
        if (operations.length) run('Change note values', operations, context);
        else if (cancelForCommand(context)) { message = 'No change'; draw(); }
      }
    } catch (error) { report(error); }
  }
  function geometry(): void {
    const notes = editing.state.document.content.parts.flatMap((part) => part.notes.filter((note) => !note.rest && !note.unpitched));
    // A one-sided explicit bound limits the computed side instead of being crossed by it.
    min = options.minPitch ?? Math.min(options.maxPitch ?? 127, Math.max(0, notes.reduce((value, note) => Math.min(value, note.pitch.midi - 2), 48)));
    max = options.maxPitch ?? Math.max(options.minPitch ?? 0, Math.min(127, notes.reduce((value, note) => Math.max(value, note.pitch.midi + 2), 84)));
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max > 127 || min > max) throw new RangeError('Invalid editing pitch range');
    width = Math.max(16, Math.ceil(editing.state.document.content.durationQuarters.toFloat() + 4)) * scale;
    height = (max - min + 1) * lane;
    svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
    svg.style.width = `${width}px`; svg.style.height = `${height}px`; svg.style.maxWidth = 'none';
  }
  function shape(tag: string, attributes: Record<string, string | number>, text?: string): SVGElement {
    const node = owner.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    svg.append(node); return node;
  }
  function box(note: Note): {x: number; width: number; top: number} {
    return {x: note.onsetQuarters.toFloat() * scale, width: Math.max(4, note.duration.quarters.toFloat() * scale), top: (max - note.pitch.midi) * lane};
  }
  function band(top: number, active: boolean): {y: number; height: number} {
    // Sounding notes fill their lane: a size cue in addition to the active colour.
    return active ? {y: top + .5, height: Math.max(2, lane - 1)} : {y: top + 2, height: Math.max(2, lane - 4)};
  }
  function draw(): void {
    if (disposed) return;
    geometry();
    svg.replaceChildren(); drawnNotes.clear(); playhead = undefined;
    const state = editing.state;
    const left = viewport.scrollLeft;
    const right = Math.min(width, left + (viewport.clientWidth || 900));
    for (let midi = min; midi <= max; midi++) {
      const black = [1, 3, 6, 8, 10].includes(midi % 12);
      shape('rect', {x: left, y: (max - midi) * lane, width: right - left, height: lane,
        fill: black ? 'color-mix(in srgb, currentColor 7%, transparent)' : 'transparent', stroke: 'color-mix(in srgb, currentColor 10%, transparent)', 'pointer-events': 'none'});
      if (midi % 12 === 0) shape('text', {x: left + 3, y: (max - midi + 1) * lane - 4, fill: 'currentColor',
        'font-size': Math.min(11, lane - 3), 'pointer-events': 'none', 'aria-hidden': 'true'}, Pitch.fromMidi(midi).toString());
    }
    for (let quarter = Math.max(0, Math.floor(left / scale)); quarter <= Math.ceil(right / scale); quarter++) {
      shape('line', {x1: quarter * scale, x2: quarter * scale, y1: 0, y2: height,
        stroke: 'currentColor', 'stroke-opacity': quarter % 4 ? '.12' : '.3', 'pointer-events': 'none'});
      shape('text', {x: quarter * scale + 3, y: 12, fill: 'currentColor', 'font-size': 10,
        'pointer-events': 'none', 'aria-hidden': 'true'}, String(quarter));
    }
    const selected = new Set(selectedIds());
    const content = state.interaction.draft?.content ?? state.document.content;
    for (const item of content.parts) for (const note of item.notes) {
      if (note.rest || note.unpitched || note.pitch.midi < min || note.pitch.midi > max) continue;
      const {x, width: noteWidth, top} = box(note);
      if (x + noteWidth < left || x > right) continue;
      const isSelected = selected.has(note.id);
      const drafted = Boolean(state.interaction.draft && state.document.content.getNote(note.id) !== note);
      // Selection, draft and playing states each have a non-colour cue: double ring, dashes, lane height.
      const rectangle = shape('rect', {x, ...band(top, false), width: noteWidth - 1, rx: 2, fill: idleFill, 'fill-opacity': drafted ? .55 : 1,
        stroke: isSelected && !drafted ? contrast : 'currentColor', 'stroke-width': isSelected || drafted ? 1.5 : .5,
        'stroke-dasharray': drafted ? '4 2' : 'none', 'data-note-id': note.id,
        'data-selected': String(isSelected), 'data-draft': String(drafted), 'data-active': 'false',
        'aria-label': `${note.pitch.toString()}, quarter ${note.onsetQuarters}, duration ${note.duration.quarters}${isSelected ? ', selected' : ''}`, role: 'img'});
      const title = owner.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = rectangle.getAttribute('aria-label'); rectangle.append(title);
      drawnNotes.set(note.id, {rectangle, top, active: false});
      if (isSelected) {
        shape('rect', {x: x - 2, y: top + .75, width: noteWidth + 3, height: Math.max(2, lane - 1.5), rx: 3, fill: 'none',
          stroke: 'currentColor', 'stroke-width': 1.5, 'data-selection-outline': '', 'pointer-events': 'none'});
        shape('line', {x1: x + noteWidth - 5, x2: x + noteWidth - 5, y1: top + 5, y2: top + lane - 5,
          stroke: contrast, 'stroke-width': 2, 'stroke-linecap': 'round', 'data-resize-handle': '', 'pointer-events': 'none'});
      }
    }
    drawn = {state, left, viewportWidth: viewport.clientWidth};
    const enabled = editable();
    // A read-only grid is a labelled graphic, not a tab stop with hidden instructions.
    svg.setAttribute('role', enabled ? 'application' : 'img');
    if (enabled) { svg.setAttribute('tabindex', '0'); svg.setAttribute('aria-describedby', instructions.id); }
    else { svg.removeAttribute('tabindex'); svg.removeAttribute('aria-describedby'); }
    element.dataset.editState = !state.available ? 'unavailable' : state.interaction.draft ? 'draft' : enabled ? 'ready' : 'readonly';
    instructions.hidden = !state.editable;
    details.hidden = !state.editable;
    const key = state.document.content.parts.map((value) => `${value.id}:${value.name}`).join('|');
    if (key !== partsKey) {
      partsKey = key; const previous = part.value; part.replaceChildren();
      for (const value of state.document.content.parts) { const option = owner.createElement('option'); option.value = value.id; option.textContent = value.name; part.append(option); }
      if (state.document.content.getPart(PartId(previous))) part.value = previous;
    }
    const committedNote = state.document.content.getNote(selectedIds()[0]);
    const listedSelection = selectedIds().length === 1 && committedNote && !committedNote.rest && !committedNote.unpitched;
    const summaryText = selectedIds().length > 1 ? `${selectedIds().length} notes selected` :
      selectedIds().length && !listedSelection ? 'Selection outside piano roll' : '';
    if (existingContent !== state.document.content || existingSummary !== summaryText) {
      existingContent = state.document.content; existingSummary = summaryText;
      existing.replaceChildren();
      const none = owner.createElement('option'); none.value = ''; none.textContent = 'No selection'; existing.append(none);
      if (summaryText) {
        const summary = owner.createElement('option'); summary.value = 'selection'; summary.textContent = summaryText; summary.disabled = true; existing.append(summary);
      }
      for (const [partIndex, item] of state.document.content.parts.entries()) {
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
    // preview or a later selection. Same-binding redraws preserve form input,
    // including Tab to Apply. Without a single target these remain insertion values.
    if (listedSelection && bindingChanged) {
      onset.value = committedNote.onsetQuarters.toString(); duration.value = committedNote.duration.quarters.toString();
      pitch.value = String(committedNote.pitch.midi); velocity.value = String(committedNote.velocity);
    }
    for (const field of [existing, onset, duration, pitch, velocity, part, insert]) field.disabled = !enabled;
    apply.disabled = !enabled || !listedSelection; remove.disabled = !enabled || !selectedIds().length;
    undo.disabled = !enabled || !state.history.canUndo; redo.disabled = !enabled || !state.history.canRedo;
    paintPlayback();
  }
  /** Playhead, sounding notes and status over the current drawing; writes only what changed. */
  function paintPlayback(): void {
    const state = editing.state;
    const compatible = scoreDocumentPlaybackCompatible(state.document, playback);
    const active = new Set<string>(compatible ? playback!.activeNotes.map((note) => note.noteId) : []);
    for (const [id, item] of drawnNotes) {
      const on = active.has(id);
      if (on === item.active) continue;
      item.active = on;
      const {y, height: bandHeight} = band(item.top, on);
      item.rectangle.setAttribute('y', String(y)); item.rectangle.setAttribute('height', String(bandHeight));
      item.rectangle.setAttribute('fill', on ? activeFill : idleFill); item.rectangle.setAttribute('data-active', String(on));
    }
    const seconds = compatible ? playback!.nominalSeconds : null;
    if (seconds === null || seconds === undefined) { playhead?.remove(); playhead = undefined; }
    else {
      const x = String(state.document.content.timeMap.secondsToQuarters(seconds).toFloat() * scale);
      if (!playhead) playhead = shape('line', {y1: 0, y2: height, stroke: 'currentColor', 'stroke-width': 2, 'data-playhead': '', 'pointer-events': 'none'});
      playhead.setAttribute('x1', x); playhead.setAttribute('x2', x);
    }
    const playbackState = !playback ? 'unbound' : compatible ? 'ready' : 'pending';
    if (element.dataset.playbackState !== playbackState) element.dataset.playbackState = playbackState;
    const enabled = editable();
    const text = message || state.error?.message || `${state.interaction.draft ? 'Draft · ' : ''}${selectedIds().length} selected${!state.available ? ' · Document unavailable' : !enabled ? ' · Read only' : ''}${playback && !compatible ? ' · Playback pending or unavailable' : ''}`;
    // Rewriting identical text on every playback frame would re-announce or churn the live region.
    if (feedback.textContent !== text) feedback.textContent = text;
  }
  function point(event: MouseEvent): {x: number; y: number} {
    const rect = svg.getBoundingClientRect();
    return {x: (event.clientX - rect.left) * (rect.width ? width / rect.width : 1), y: (event.clientY - rect.top) * (rect.height ? height / rect.height : 1)};
  }
  function snap(value: number): Rational { return grid.mul(new Rational(Math.round(value / grid.toFloat()))); }
  /** Insertion uses the grid cell under the pointer, so the new note covers the point that created it. */
  function cell(x: number): Rational { return grid.mul(new Rational(Math.floor(Math.max(0, x / scale) / grid.toFloat() + 1e-9))); }
  function lanePitch(y: number): number { return Math.max(min, Math.min(max, max - Math.floor(y / lane))); }
  /**
   * Hit-test the displayed geometry, not event.target: selection and cancellation redraw the
   * grid, detaching the pressed node, so later click/dblclick events target the SVG itself.
   */
  function hit(event: MouseEvent): Note | undefined {
    const position = point(event);
    const state = editing.state;
    let found: NoteId | undefined;
    for (const item of (state.interaction.draft?.content ?? state.document.content).parts) for (const note of item.notes) {
      if (note.rest || note.unpitched || note.pitch.midi < min || note.pitch.midi > max) continue;
      const {x, width: noteWidth, top} = box(note);
      if (position.x >= x && position.x < x + noteWidth && position.y >= top && position.y < top + lane) found = note.id;
    }
    return found ? state.document.content.getNote(found) : undefined;
  }
  function preview(operations: readonly ScoreEditOperation[]): void {
    const pending = gesture;
    if (!pending) return;
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
    editing.cancel();
  }
  function down(event: PointerEvent): void {
    if (!editable() || event.button !== 0) return;
    const context = commandContext();
    const note = hit(event);
    if (!note) {
      if (!event.altKey) { if (!event.shiftKey) editing.select([]); return; }
      event.preventDefault(); svg.focus();
      if (!cancelForCommand(context)) return;
      try {
        const insertContext = commandContext(event.shiftKey ? selectedIds() : []);
        if (!event.shiftKey) editing.select([]);
        if (!currentContext(insertContext)) return;
        const position = point(event);
        const operation = newNote(cell(position.x), grid, lanePitch(position.y), 80);
        gesture = {pointerId: event.pointerId, revision: editing.state.document.documentRevision, context: insertContext, ...position,
          kind: 'insert', notes: [], insert: operation, valid: true, changed: false};
        svg.setPointerCapture?.(event.pointerId);
        preview([operation]);
      } catch (error) { cancel(); report(error); }
      return;
    }
    event.preventDefault(); svg.focus();
    if (!cancelForCommand(context)) return;
    const selected = selectedIds();
    if (event.shiftKey) {
      editing.select(selected.includes(note.id) ? selected.filter((id) => id !== note.id) : [...selected, note.id]);
      return;
    }
    const gestureContext = commandContext(selected.includes(note.id) ? selected : [note.id]);
    if (!selected.includes(note.id)) editing.select([note.id]);
    if (!currentContext(gestureContext)) return;
    const position = point(event);
    const edge = note.offsetQuarters.toFloat() * scale;
    gesture = {pointerId: event.pointerId, revision: editing.state.document.documentRevision, context: gestureContext, ...position,
      kind: edge - position.x <= Math.min(8, note.duration.quarters.toFloat() * scale / 3) ? 'resize' : 'move',
      notes: selectedIds().map((id) => editing.state.document.content.getNote(id)!).filter(Boolean), valid: true, changed: false};
    svg.setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent): void {
    const pending = gesture;
    if (!pending || event.pointerId !== pending.pointerId || !editable()) return;
    // No pressed primary button means its pointerup was lost; never keep previewing that gesture.
    if ((event.buttons & 1) === 0) { cancel(); return; }
    if (!currentContext(pending.context)) { cancel(); return; }
    const position = point(event); const delta = snap((position.x - pending.x) / scale);
    const semitones = Math.round((pending.y - position.y) / lane);
    if (pending.kind === 'insert' && pending.insert) {
      const length = delta.gt(grid) ? delta : grid;
      preview([{...pending.insert, notes: pending.insert.notes.map((note) => ({...note, durationQuarters: length.toJSON()}))}]);
      return;
    }
    if (!pending.changed && delta.isZero() && (pending.kind === 'resize' || semitones === 0)) return;
    if (pending.kind === 'resize') preview(pending.notes.map((note) => ({type: 'resize-notes', noteIds: [note.id], durationQuarters: note.duration.quarters.add(delta).toJSON()})));
    else preview([{type: 'move-notes', noteIds: pending.notes.map((note) => note.id), deltaQuarters: delta.toJSON()},
      {type: 'transpose-notes', noteIds: pending.notes.map((note) => note.id), semitones}]);
  }
  function up(event: PointerEvent): void {
    const pending = gesture;
    if (!pending || event.pointerId !== pending.pointerId) return;
    gesture = undefined;
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!pending.valid || !currentContext(pending.context)) { editing.cancel(); return; }
    if (pending.changed) {
      const operations = editing.state.interaction.draft?.operations;
      if (operations) run(pending.kind === 'resize' ? 'Resize notes' : pending.kind === 'insert' ? 'Insert note' : 'Move notes', operations, pending.context);
      const inserted = pending.insert?.notes[0].id;
      if (!disposed && editing.state.available && inserted && editing.state.document.content.getNote(inserted)) editing.select([inserted]);
    }
  }
  function doubleClick(event: MouseEvent): void {
    if (!editable() || hit(event)) return;
    const position = point(event);
    try {
      const operation = newNote(cell(position.x), Rational.ONE, lanePitch(position.y), 80);
      run('Insert note', [operation]);
      if (!disposed && editing.state.available && editing.state.document.content.getNote(operation.notes[0].id)) editing.select([operation.notes[0].id]);
    } catch (error) { report(error); }
  }
  function key(event: KeyboardEvent): void {
    if (!editable()) return;
    const command = event.ctrlKey || event.metaKey;
    const ids = selectedIds();
    // Leave an Escape that cancels nothing to enclosing handlers such as a dialog.
    if (event.key === 'Escape') { if (gesture || editing.state.interaction.draft) { event.preventDefault(); cancel(); } return; }
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault(); editing.select(editing.state.document.content.parts.flatMap((part) => part.notes.filter((note) => !note.rest && !note.unpitched).map((note) => note.id))); return;
    }
    if (command && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      event.preventDefault(); travelHistory(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return;
    }
    if (!ids.length) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); run('Delete notes', [{type: 'delete-notes', noteIds: ids}]); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') run('Transpose notes', [{type: 'transpose-notes', noteIds: ids, semitones: direction}]);
    else if (event.shiftKey) run('Resize notes', ids.map((id) => ({type: 'resize-notes', noteIds: [id], durationQuarters: editing.state.document.content.getNote(id)!.duration.quarters.add(grid.mul(new Rational(direction))).toJSON()})));
    else run('Move notes', [{type: 'move-notes', noteIds: ids, deltaQuarters: grid.mul(new Rational(direction)).toJSON()}]);
  }
  const onScroll = () => draw();
  const onCancel = () => { if (gesture) cancel(); };
  const onPointerCancel = (event: PointerEvent) => { if (gesture && event.pointerId === gesture.pointerId) cancel(); };
  // Attach nothing for an unavailable controller; a failed subscription rolls back the mounted DOM.
  if (!editing.state.available) throw new ScoreEditError('disposed', 'The editing view is unavailable');
  draw();
  host.append(element);
  let unsubscribe = (): void => {};
  try {
    unsubscribe = editing.subscribe((state) => {
      if (gesture && (gesture.revision !== state.document.documentRevision || !state.available || !state.editable)) {
        const previous = gesture; gesture = undefined;
        if (svg.hasPointerCapture?.(previous.pointerId)) svg.releasePointerCapture(previous.pointerId);
      }
      draw();
    });
  } catch (error) { disposed = true; element.remove(); throw error; }
  svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', onPointerCancel); svg.addEventListener('lostpointercapture', onPointerCancel);
  svg.addEventListener('blur', onCancel); svg.addEventListener('keydown', key); svg.addEventListener('dblclick', doubleClick);
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
    updatePlayback(value) {
      playback = value;
      if (disposed) return;
      // Playback-only frames reuse the drawing; content, interaction or viewport changes redraw it.
      if (drawn && drawn.state === editing.state && drawn.left === viewport.scrollLeft && drawn.viewportWidth === viewport.clientWidth) paintPlayback();
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
        owner.defaultView?.removeEventListener('blur', onCancel);
        viewport.removeEventListener('scroll', onScroll); element.remove();
      }
    },
  };
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
  return value;
}
