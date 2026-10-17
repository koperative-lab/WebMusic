import {
  Duration, NoteId, Pitch, Rational, ScoreEditError, VoiceId, makeId,
  type Alter, type PartId, type ScoreDocumentSnapshot, type ScoreEditResult,
  type ScoreNotationEntry, type ScoreQuarterValue, type Step,
} from '../../core';
import type {ScoreViewEditing} from './score-editing';

export interface StaffViewEditingOptions {
  readonly partId?: PartId;
  readonly voice?: VoiceId;
  readonly staff?: number;
  readonly onsetQuarters?: ScoreQuarterValue;
  readonly baseQuarters?: ScoreQuarterValue;
  readonly dots?: number;
  readonly octave?: number;
  readonly alter?: Alter;
}

export interface StaffViewEditingState {
  readonly document: ScoreDocumentSnapshot;
  readonly available: boolean;
  readonly editable: boolean;
  readonly partId?: PartId;
  readonly voice: VoiceId;
  readonly staff: number;
  readonly onsetQuarters: Rational;
  readonly duration: Duration;
  readonly octave: number;
  readonly alter: Alter;
  readonly error?: ScoreEditError;
}

/** Local notation cursor and spelling; all musical changes use the borrowed editor/history. */
export interface StaffViewEditing {
  readonly editing: ScoreViewEditing;
  readonly state: StaffViewEditingState;
  setCursor(onsetQuarters: ScoreQuarterValue): void;
  setPart(partId: PartId): void;
  setVoice(voice: VoiceId): void;
  setStaff(staff: number): void;
  setDuration(baseQuarters: ScoreQuarterValue, dots?: number): void;
  setOctave(octave: number): void;
  setAlter(alter: Alter): void;
  select(noteId: NoteId): void;
  insertPitch(step: Step): ScoreEditResult;
  insertRest(): ScoreEditResult;
  deleteSelected(): ScoreEditResult;
  undo(): ScoreEditResult;
  redo(): ScoreEditResult;
  subscribe(listener: (state: StaffViewEditingState) => void): () => void;
  /** Releases observers only. The editing session and document remain caller-owned. */
  dispose(): void;
}

function invalid(message: string): never { throw new ScoreEditError('invalid-command', message); }
function pair(value: ScoreQuarterValue): Rational {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) ||
      !Number.isSafeInteger(value[1]) || value[1] <= 0) invalid('Position must be exact rational quarters');
  const result = Rational.from(value);
  if (result.num !== value[0] || result.den !== value[1]) invalid('Rational quarters must be reduced');
  return result;
}
function inputDuration(base: ScoreQuarterValue, dots = 0): Duration {
  const rational = pair(base);
  if (![4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16].some((value) => rational.eq(Rational.from(value))) ||
      !Number.isSafeInteger(dots) || dots < 0 || dots > 2) {
    invalid('Staff entry supports whole through 64th bases and zero to two dots');
  }
  return new Duration({base: rational, dots});
}
function validOctave(value: number): void {
  if (!Number.isSafeInteger(value) || value < -1 || value > 9) invalid('Octave must be an integer from -1 to 9');
}
function validAlter(value: Alter): void {
  if (!Number.isSafeInteger(value) || value < -2 || value > 2) invalid('Alter must be an integer from -2 to 2');
}

export function createStaffViewEditing(editing: ScoreViewEditing, options: StaffViewEditingOptions = {}): StaffViewEditing {
  if (!editing.state.available) throw new ScoreEditError('disposed', 'The editing view is unavailable');
  let disposed = false;
  let partId = options.partId ?? editing.state.document.content.parts[0]?.id;
  let voice = options.voice ?? editing.state.document.content.getPart(partId!)?.notes[0]?.voice ?? VoiceId('1');
  let staff = options.staff ?? 1;
  let onsetQuarters = pair(options.onsetQuarters ?? [0, 1]);
  let duration = inputDuration(options.baseQuarters ?? [1, 1], options.dots);
  let octave = options.octave ?? 4;
  let alter = options.alter ?? 0;
  validOctave(octave); validAlter(alter);
  if (onsetQuarters.lt(Rational.ZERO)) invalid('Cursor must be nonnegative');
  if (typeof voice !== 'string' || !voice.trim()) invalid('Voice must be a nonempty string');
  if (!Number.isSafeInteger(staff) || staff < 1) invalid('Staff must be a positive integer');
  if (partId !== undefined && !editing.state.document.content.getPart(partId)) throw new ScoreEditError('unknown-part', `Unknown part: ${partId}`);
  let error: ScoreEditError | undefined;
  let localRevision = 0;
  const listeners = new Set<(state: StaffViewEditingState) => void>();
  let state = snapshot();
  function snapshot(): StaffViewEditingState {
    return Object.freeze({document: editing.state.document,
      available: !disposed && editing.state.available && partId !== undefined && Boolean(editing.state.document.content.getPart(partId)),
      editable: editing.state.editable, partId, voice, staff, onsetQuarters, duration, octave, alter,
      ...(error ? {error} : {})});
  }
  function publish(): void {
    const next = state = snapshot();
    for (const listener of [...listeners]) {
      if (disposed || state !== next) break;
      if (listeners.has(listener)) {
        try { listener(next); } catch (cause) { console.error('Staff editing subscriber failed', cause); }
      }
    }
  }
  function assertAvailable(): void {
    if (disposed || !editing.state.available) throw new ScoreEditError('disposed', 'The staff editing view is unavailable');
  }
  function local(action: () => void): void { assertAvailable(); localRevision++; action(); error = undefined; publish(); }
  function failure(cause: unknown): ScoreEditResult {
    const commandError = cause instanceof ScoreEditError ? cause : new ScoreEditError('invalid-command', cause instanceof Error ? cause.message : String(cause));
    error = commandError;
    publish();
    return Object.freeze({status: 'failed', error: commandError});
  }
  function run(action: () => ScoreEditResult): ScoreEditResult {
    try {
      assertAvailable();
      const result = action();
      error = result.status === 'failed' ? result.error : undefined;
      publish();
      return result;
    } catch (cause) { return failure(cause); }
  }
  function enter(pitch: ScoreNotationEntry['pitch'], advance: boolean): ScoreEditResult {
    return run(() => {
      if (!partId) throw new ScoreEditError('unknown-part', 'Staff entry requires a part');
      if (pitch) {
        const midi = Pitch.fromJSON(pitch).midi;
        if (midi < 0 || midi > 127) invalid('Entered pitch must be in MIDI range 0 to 127');
      }
      const end = onsetQuarters.add(duration.quarters);
      const capturedLocalRevision = localRevision;
      const result = editing.execute(pitch ? 'Enter staff note' : 'Enter staff rest', [{type: 'enter-notation', entry: {
        id: NoteId(makeId('notation')), partId, voice, staff, onsetQuarters: onsetQuarters.toJSON(),
        duration: {base: duration.base.toJSON(), dots: duration.dots}, pitch,
      }}]);
      if (result.status !== 'failed' && !disposed && advance && localRevision === capturedLocalRevision &&
          editing.state.document.documentRevision === result.snapshot.documentRevision) onsetQuarters = end;
      return result;
    });
  }
  let document = editing.state.document;
  const off = editing.subscribe((value) => {
    if (disposed) return;
    if (value.document !== document) {
      document = value.document;
      if (document.change?.origin === 'restore') onsetQuarters = Rational.ZERO;
      const end = document.content.durationQuarters;
      if (onsetQuarters.gt(end)) onsetQuarters = end;
      if (partId && !document.content.getPart(partId)) partId = document.content.parts[0]?.id;
      error = undefined;
    }
    publish();
  });
  const controller: StaffViewEditing = {
    editing,
    get state() { return state; },
    setCursor(value) { local(() => { const next = pair(value); if (next.lt(Rational.ZERO)) invalid('Cursor must be nonnegative'); onsetQuarters = next; }); },
    setPart(value) { local(() => {
      if (!editing.state.document.content.getPart(value)) throw new ScoreEditError('unknown-part', `Unknown part: ${value}`);
      partId = value; staff = 1;
    }); },
    setVoice(value) { local(() => { if (typeof value !== 'string' || !value.trim()) invalid('Voice must be a nonempty string'); voice = value; }); },
    setStaff(value) { local(() => { if (!Number.isSafeInteger(value) || value < 1) invalid('Staff must be a positive integer'); staff = value; }); },
    setDuration(base, dots) { local(() => { duration = inputDuration(base, dots); }); },
    setOctave(value) { local(() => { validOctave(value); octave = value; }); },
    setAlter(value) { local(() => { validAlter(value); alter = value; }); },
    select(noteId) { local(() => {
      const score = editing.state.document.content;
      const part = score.parts.find((candidate) => candidate.notes.some((note) => note.id === noteId));
      const note = score.getNote(noteId);
      if (!part || !note) throw new ScoreEditError('unknown-note', `Unknown note: ${noteId}`);
      partId = part.id; voice = note.voice;
      staff = note.staff ?? ((part.staves ?? 1) > 1 && !note.rest && note.pitch.midi < 60 ? 2 : 1);
      onsetQuarters = note.onsetQuarters; duration = note.duration;
      if (!note.rest) { octave = note.pitch.octave; alter = note.pitch.alter; }
      editing.select([noteId]);
    }); },
    insertPitch(step) { return enter({step, alter, octave}, true); },
    insertRest() { return enter(null, true); },
    deleteSelected() {
      return run(() => {
        const base = editing.state.document;
        const selected = editing.state.interaction.selectedNoteIds;
        if (selected.length !== 1) invalid('Staff deletion requires exactly one selected note');
        const part = base.content.parts.find((candidate) => candidate.notes.some((note) => note.id === selected[0]));
        const note = base.content.getNote(selected[0]);
        if (!part || !note) throw new ScoreEditError('unknown-note', `Unknown note: ${selected[0]}`);
        const entry: ScoreNotationEntry = {
          id: NoteId(makeId('notation')), partId: part.id, voice: note.voice,
          staff: note.staff ?? ((part.staves ?? 1) > 1 && !note.rest && note.pitch.midi < 60 ? 2 : 1),
          onsetQuarters: note.onsetQuarters.toJSON(),
          duration: {base: note.duration.base.toJSON(), dots: note.duration.dots}, pitch: null,
        };
        // Selection publishes synchronously. Keep the deletion target immutable
        // while observers may change local input settings or the document.
        controller.select(selected[0]);
        assertAvailable();
        const current = editing.state.document;
        if (current.documentId !== base.documentId) throw new ScoreEditError('document-mismatch', 'Staff deletion targets another document');
        if (current.documentRevision !== base.documentRevision) throw new ScoreEditError('revision-conflict', 'Staff deletion was superseded during selection');
        return editing.execute('Enter staff rest', [{type: 'enter-notation', entry}]);
      });
    },
    undo() { return run(() => editing.undo()); },
    redo() { return run(() => editing.redo()); },
    subscribe(listener) {
      assertAvailable(); listeners.add(listener);
      try { listener(state); } catch (cause) { console.error('Staff editing subscriber failed', cause); }
      return () => { listeners.delete(listener); };
    },
    dispose() { if (disposed) return; disposed = true; off(); state = snapshot(); listeners.clear(); },
  };
  return controller;
}
