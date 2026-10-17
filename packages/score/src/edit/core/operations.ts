import {ScoreEditError, type ScoreEditOperation, type ScoreNoteInput} from '../../core/editing';
import {Note, type NoteData} from '../../core/model/Note';
import {Part} from '../../core/model/Part';
import {Score} from '../../core/model/Score';
import {Duration} from '../../core/primitives/Duration';
import {Pitch} from '../../core/primitives/Pitch';
import {Rational} from '../../core/primitives/Rational';
import type {NoteId} from '../../core/types/ids';
import {validateScore} from '../../core/validate';
import {applyNotationEntry} from './notation';

function invalid(message: string): never {
  throw new ScoreEditError('invalid-command', message);
}

/** Copy only ordinary JSON data; never invoke a getter or silently drop a field. */
function snapshotJSON(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Command numbers must be finite');
    return value;
  }
  if (!value || typeof value !== 'object') invalid('Commands must contain only JSON data');
  if (ancestors.has(value)) invalid('Commands must not contain cycles');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) {
    invalid('Command records must be plain objects');
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) invalid('Command symbols are not serializable');
    if (array) {
      if (keys.length !== value.length + 1) invalid('Command arrays must be dense and have no extra fields');
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          invalid('Command arrays must contain ordinary data items');
        }
        result.push(snapshotJSON(descriptor.value, ancestors));
      }
      return Object.freeze(result);
    }
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) invalid('Command fields must be enumerable data properties');
      Object.defineProperty(result, key, {
        value: snapshotJSON(descriptor.value, ancestors), enumerable: true,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function record(value: unknown, fields: readonly string[], required: readonly string[] = fields): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a command record');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid('Unknown command field');
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(input, key))) invalid('Missing command field');
  return input;
}

function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(`${label} must be a nonempty string`);
}

function velocity(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 127) {
    invalid('Velocity must be an integer from 1 to 127');
  }
}

function quarters(value: unknown, label: string, positive = false): Rational {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) ||
      !Number.isSafeInteger(value[1]) || value[1] <= 0) {
    invalid(`${label} must be an exact [numerator, positive denominator] pair`);
  }
  const result = new Rational(value[0], value[1]);
  if (result.num !== value[0] || result.den !== value[1]) invalid(`${label} must be reduced to lowest terms`);
  if (positive && !result.gt(Rational.ZERO)) invalid(`${label} must be positive`);
  return result;
}

function noteIds(value: unknown): void {
  if (!Array.isArray(value)) invalid('noteIds must be an array');
  const seen = new Set<string>();
  for (const item of value) {
    id(item, 'Note ID');
    if (seen.has(item)) throw new ScoreEditError('duplicate-id', `Duplicate note ID in operation: ${item}`);
    seen.add(item);
  }
}

function validateInput(input: unknown): void {
  const note = record(input, ['id', 'partId', 'pitch', 'onsetQuarters', 'durationQuarters', 'voice', 'velocity'],
    ['id', 'partId', 'pitch', 'onsetQuarters', 'durationQuarters', 'voice']);
  id(note.id, 'Note ID');
  id(note.partId, 'Part ID');
  id(note.voice, 'Voice ID');
  const pitch = record(note.pitch, ['step', 'alter', 'octave']);
  if (!['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(pitch.step as string) ||
      !Number.isSafeInteger(pitch.alter) || (pitch.alter as number) < -2 || (pitch.alter as number) > 2 ||
      !Number.isSafeInteger(pitch.octave)) invalid('Invalid written pitch');
  const written = new Pitch(pitch.step as ScoreNoteInput['pitch']['step'],
    pitch.alter as ScoreNoteInput['pitch']['alter'], pitch.octave as number);
  if (written.midi < 0 || written.midi > 127) invalid('Inserted pitch must be in MIDI range 0 to 127');
  if (quarters(note.onsetQuarters, 'Onset').lt(Rational.ZERO)) invalid('Onset must be nonnegative');
  quarters(note.durationQuarters, 'Duration', true);
  if (note.velocity !== undefined) velocity(note.velocity);
}

/** Validate and freeze the full payload before evaluating any musical operations. */
export function snapshotScoreOperations(operations: readonly ScoreEditOperation[]): readonly ScoreEditOperation[] {
  try {
    const snapshot = snapshotJSON(operations);
    if (!Array.isArray(snapshot)) invalid('operations must be an array');
    for (const value of snapshot) {
      const type = record(value, ['type', 'notes', 'noteIds', 'deltaQuarters', 'durationQuarters', 'semitones', 'velocity', 'grid', 'origin', 'target', 'entry'], ['type']).type;
      switch (type) {
        case 'enter-notation': {
          const operation = record(value, ['type', 'entry']);
          const entry = record(operation.entry, ['id', 'partId', 'voice', 'staff', 'onsetQuarters', 'duration', 'pitch', 'velocity'],
            ['id', 'partId', 'voice', 'onsetQuarters', 'duration', 'pitch']);
          id(entry.id, 'Note ID'); id(entry.partId, 'Part ID'); id(entry.voice, 'Voice ID');
          if (entry.staff !== undefined && (!Number.isSafeInteger(entry.staff) || (entry.staff as number) < 1)) invalid('Staff must be a positive integer');
          if (quarters(entry.onsetQuarters, 'Onset').lt(Rational.ZERO)) invalid('Onset must be nonnegative');
          const duration = record(entry.duration, ['base', 'dots'], ['base']);
          const base = quarters(duration.base, 'Duration base', true);
          if (![4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16].some((value) => base.eq(Rational.from(value))) ||
              (duration.dots !== undefined && (!Number.isSafeInteger(duration.dots) || (duration.dots as number) < 0 || (duration.dots as number) > 2))) {
            invalid('Notation entry supports whole through 64th bases and zero to two dots');
          }
          if (entry.velocity !== undefined) velocity(entry.velocity);
          if (entry.pitch === null) {
            if (entry.velocity !== undefined) invalid('A rest cannot have a velocity');
          } else {
            validateInput({id: entry.id, partId: entry.partId, voice: entry.voice, pitch: entry.pitch,
              onsetQuarters: entry.onsetQuarters, durationQuarters: [1, 1]});
          }
          break;
        }
        case 'insert-notes': {
          const operation = record(value, ['type', 'notes']);
          if (!Array.isArray(operation.notes)) invalid('notes must be an array');
          const seen = new Set<string>();
          for (const note of operation.notes) {
            validateInput(note);
            if (seen.has(note.id)) throw new ScoreEditError('duplicate-id', `Duplicate inserted note ID: ${note.id}`);
            seen.add(note.id);
          }
          break;
        }
        case 'delete-notes': noteIds(record(value, ['type', 'noteIds']).noteIds); break;
        case 'move-notes': {
          const operation = record(value, ['type', 'noteIds', 'deltaQuarters']);
          noteIds(operation.noteIds);
          quarters(operation.deltaQuarters, 'Move delta');
          break;
        }
        case 'resize-notes': {
          const operation = record(value, ['type', 'noteIds', 'durationQuarters']);
          noteIds(operation.noteIds);
          quarters(operation.durationQuarters, 'Duration', true);
          break;
        }
        case 'transpose-notes': {
          const operation = record(value, ['type', 'noteIds', 'semitones']);
          noteIds(operation.noteIds);
          if (!Number.isSafeInteger(operation.semitones)) invalid('Transposition must be safe-integer semitones');
          break;
        }
        case 'set-velocity': {
          const operation = record(value, ['type', 'noteIds', 'velocity']);
          noteIds(operation.noteIds);
          if (operation.velocity !== null) velocity(operation.velocity);
          break;
        }
        case 'quantize-notes': {
          const operation = record(value, ['type', 'noteIds', 'grid', 'origin', 'target'], ['type', 'noteIds']);
          noteIds(operation.noteIds);
          if (operation.grid !== undefined) quarters(operation.grid, 'Grid', true);
          if (operation.origin !== undefined) quarters(operation.origin, 'Origin');
          if (operation.target !== undefined && !['onset', 'duration', 'both'].includes(operation.target as string)) invalid('Invalid quantization target');
          break;
        }
        default: invalid(`Unsupported operation type: ${String(type)}`);
      }
    }
    return snapshot as readonly ScoreEditOperation[];
  } catch (error) {
    if (error instanceof ScoreEditError) throw error;
    invalid(error instanceof Error ? error.message : 'Invalid operation payload');
  }
}

/** Reject ambiguous identity and invalid model values before creating an editor. */
export function validateEditableScore(score: Score): void {
  try {
    if (!(score instanceof Score)) throw new ScoreEditError('invalid-score', 'Expected a Score instance');
    const parts = new Set<string>();
    const notes = new Set<string>();
    for (const part of score.parts) {
      if (!(part instanceof Part) || typeof part.id !== 'string' || !part.id.trim()) {
        throw new ScoreEditError('invalid-score', 'Parts require nonempty IDs and valid Part values');
      }
      if (parts.has(part.id)) throw new ScoreEditError('duplicate-id', `Duplicate part ID: ${part.id}`);
      parts.add(part.id);
      for (const note of part.notes) {
        if (!(note instanceof Note) || typeof note.id !== 'string' || !note.id.trim() ||
            typeof note.voice !== 'string' || !note.voice.trim() || note.onsetQuarters.lt(Rational.ZERO) ||
            (!note.grace && !note.duration.quarters.gt(Rational.ZERO))) {
          throw new ScoreEditError('invalid-score', 'Notes require nonempty IDs/voices and valid musical time');
        }
        if (notes.has(note.id)) throw new ScoreEditError('duplicate-id', `Duplicate note ID: ${note.id}`);
        notes.add(note.id);
        // Re-run model invariants without changing any source object.
        new Note(note);
        if (note.offsetQuarters.lt(note.onsetQuarters)) throw new ScoreEditError('invalid-score', 'Invalid note extent');
      }
    }
    const issues = validateScore(score);
    if (issues.length) throw new ScoreEditError('invalid-score', issues.map(({message}) => message).join('; '));
    // The editor uses this value when constructing its publication/map. Force
    // lazy arithmetic to fail before it can mutate history or publish content.
    if (score.durationQuarters.lt(Rational.ZERO)) throw new ScoreEditError('invalid-score', 'Invalid Score extent');
  } catch (error) {
    if (error instanceof ScoreEditError) throw error;
    throw new ScoreEditError('invalid-score', error instanceof Error ? error.message : 'Invalid Score');
  }
}

/** Exact nearest grid point, with ties toward the later position, including negative offsets. */
function quantize(value: Rational, grid: Rational, origin: Rational): Rational {
  const numerator = (BigInt(value.num) * BigInt(origin.den) - BigInt(origin.num) * BigInt(value.den)) * BigInt(grid.den);
  const denominator = BigInt(value.den) * BigInt(origin.den) * BigInt(grid.num);
  let quotient = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder < 0n) { quotient--; remainder += denominator; }
  if (remainder * 2n >= denominator) quotient++;
  let num = BigInt(origin.num) * BigInt(grid.den) + quotient * BigInt(grid.num) * BigInt(origin.den);
  let den = BigInt(origin.den) * BigInt(grid.den);
  let a = num < 0n ? -num : num;
  let b = den;
  while (b) { const next = a % b; a = b; b = next; }
  num /= a;
  den /= a;
  if (!Number.isSafeInteger(Number(num)) || !Number.isSafeInteger(Number(den))) invalid('Quantized time exceeds safe rational range');
  return new Rational(Number(num), Number(den));
}

function requireSimpleRhythm(note: Note): void {
  if (note.tie || note.tupletId !== undefined || note.tupletMarks?.length || note.grace ||
      note.duration.tuplet[0] !== note.duration.tuplet[1]) {
    throw new ScoreEditError('unsupported-structure', `Note ${note.id} requires a tie, tuplet or grace group command`);
  }
}

function timingPatch(note: Note, onset: Rational, duration: Duration): Partial<NoteData> | undefined {
  if (note.onsetQuarters.eq(onset) && note.duration.quarters.eq(duration.quarters)) return undefined;
  requireSimpleRhythm(note);
  if (onset.lt(Rational.ZERO) || !duration.quarters.gt(Rational.ZERO)) invalid('Edited onset/duration is outside the valid musical range');
  return {onsetQuarters: onset, duration, performed: undefined,
    ...(note.performed ? {velocityOverride: note.velocity} : {})};
}

function applyOperation(score: Score, operation: ScoreEditOperation, affected: Set<NoteId>): Score {
  if (operation.type === 'enter-notation') return applyNotationEntry(score, operation.entry, affected);
  if (operation.type === 'insert-notes') {
    for (const note of operation.notes) {
      if (!score.getPart(note.partId)) throw new ScoreEditError('unknown-part', `Unknown part: ${note.partId}`);
      if (score.getNote(note.id)) throw new ScoreEditError('duplicate-id', `Duplicate note ID: ${note.id}`);
    }
    return score.edit((transaction) => {
      for (const input of operation.notes) {
        transaction.addNote(input.partId, new Note({id: input.id, pitch: Pitch.fromJSON(input.pitch),
          onsetQuarters: Rational.from(input.onsetQuarters), duration: new Duration({base: input.durationQuarters}),
          voice: input.voice, ...(input.velocity === undefined ? {} : {velocityOverride: input.velocity})}));
        affected.add(input.id);
      }
    });
  }
  const notes = operation.noteIds.map((noteId) => {
    const note = score.getNote(noteId);
    if (!note) throw new ScoreEditError('unknown-note', `Unknown note: ${noteId}`);
    return note;
  });
  return score.edit((transaction) => {
    for (const note of notes) {
      let patch: Partial<NoteData> | undefined;
      switch (operation.type) {
        case 'delete-notes':
          requireSimpleRhythm(note);
          transaction.removeNote(note.id);
          affected.add(note.id);
          continue;
        case 'move-notes':
          patch = timingPatch(note, note.onsetQuarters.add(Rational.from(operation.deltaQuarters)), note.duration);
          break;
        case 'resize-notes': {
          const duration = Rational.from(operation.durationQuarters);
          if (!duration.eq(note.duration.quarters)) patch = timingPatch(note, note.onsetQuarters, new Duration({base: duration}));
          break;
        }
        case 'transpose-notes': {
          if (operation.semitones === 0) break;
          if (note.tie || note.rest || note.unpitched) throw new ScoreEditError('unsupported-structure', `Note ${note.id} cannot be transposed independently`);
          const midi = note.pitch.midi + operation.semitones;
          if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) invalid('Transposed pitch must be in MIDI range 0 to 127');
          patch = {pitch: note.pitch.transpose(operation.semitones)};
          break;
        }
        case 'set-velocity': {
          const value = operation.velocity ?? undefined;
          if (note.velocityOverride !== value) patch = {velocityOverride: value};
          break;
        }
        case 'quantize-notes': {
          const grid = Rational.from(operation.grid ?? [1, 4]);
          const origin = Rational.from(operation.origin ?? [0, 1]);
          const target = operation.target ?? 'onset';
          const onset = target === 'duration' ? note.onsetQuarters : quantize(note.onsetQuarters, grid, origin);
          const duration = target === 'onset' ? note.duration.quarters : quantize(note.duration.quarters, grid, Rational.ZERO);
          patch = timingPatch(note, onset, duration.eq(note.duration.quarters) ? note.duration : new Duration({base: duration}));
          break;
        }
      }
      if (patch) {
        transaction.updateNote(note.id, patch);
        affected.add(note.id);
      }
    }
  });
}

/** Own-property comparison supports cyclic metadata while leaving custom class values opaque. */
function equalValue(a: unknown, b: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.prototype && proto !== null && !Array.isArray(a) &&
      !(a instanceof Rational) && !(a instanceof Duration) && !(a instanceof Pitch) && !(a instanceof Note)) return false;
  if (seen.get(a)?.has(b)) return true;
  if (!seen.has(a)) seen.set(a, new WeakSet());
  seen.get(a)!.add(b);
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) &&
    equalValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen));
}

/** Compare immutable musical content without serializing the whole score. */
export function sameScoreContent(a: Score, b: Score): boolean {
  if (a === b) return true;
  if (a.id !== b.id || !equalValue(a.metadata, b.metadata) || a.parts.length !== b.parts.length) return false;
  if (a.timeMap !== b.timeMap && !equalValue(a.timeMap.toJSON(), b.timeMap.toJSON())) return false;
  if (a.measures !== b.measures && (a.measures.length !== b.measures.length ||
      a.measures.some((measure, index) => measure !== b.measures[index] && !equalValue(measure.toJSON(), b.measures[index].toJSON())))) return false;
  return a.parts.every((part, index) => {
    const other = b.parts[index];
    if (part === other) return true;
    if (part.id !== other.id || part.notes.length !== other.notes.length) return false;
    const {notes: _notes, ...partData} = part;
    const {notes: _otherNotes, ...otherData} = other;
    if (!equalValue(partData, otherData)) return false;
    const byId = new Map(other.notes.map((note) => [note.id, note]));
    return part.notes.every((note) => equalValue(note, byId.get(note.id)));
  });
}

/** Evaluate against private immutable candidates; any failure leaves the caller's Score intact. */
export function applyScoreOperations(score: Score, operations: readonly ScoreEditOperation[]): {
  score: Score;
  operations: readonly ScoreEditOperation[];
  affectedNoteIds: readonly NoteId[];
} {
  validateEditableScore(score);
  const snapshot = snapshotScoreOperations(operations);
  try {
    let candidate = score;
    const affected = new Set<NoteId>();
    for (const operation of snapshot) candidate = applyOperation(candidate, operation, affected);
    validateEditableScore(candidate);
    if (sameScoreContent(score, candidate)) return {score, operations: snapshot, affectedNoteIds: Object.freeze([])};
    return {score: candidate, operations: snapshot, affectedNoteIds: Object.freeze([...affected])};
  } catch (error) {
    if (error instanceof ScoreEditError) throw error;
    invalid(error instanceof Error ? error.message : 'Score operation failed');
  }
}
