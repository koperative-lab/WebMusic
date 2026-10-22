import {ScoreEditError, type ScoreNotationEntry} from '../../core/editing';
import {Note} from '../../core/model/Note';
import type {Part} from '../../core/model/Part';
import type {Score} from '../../core/model/Score';
import {Duration} from '../../core/primitives/Duration';
import {Pitch} from '../../core/primitives/Pitch';
import {Rational} from '../../core/primitives/Rational';
import {transpositionSemitones} from '../../core/query/transposition';
import {NoteId} from '../../core/types/ids';

function unsupported(message: string): never { throw new ScoreEditError('unsupported-structure', message); }

/** MIDI export and playback add the Part transposition; reject a written pitch that would sound outside 0–127. */
export function assertSoundingPitch(part: Part, pitch: Pitch): void {
  const midi = pitch.midi + transpositionSemitones(part);
  if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) {
    throw new ScoreEditError('invalid-command', `Sounding pitch in part ${part.id} must be in MIDI range 0 to 127`);
  }
}

function staffOf(note: Note, part: Part): number {
  return note.staff ?? ((part.staves ?? 1) > 1 && !note.rest && note.pitch.midi < 60 ? 2 : 1);
}

function assertSimple(note: Note): void {
  if (note.tie || note.tupletId !== undefined || note.tupletMarks?.length || note.grace ||
      note.duration.tuplet[0] !== note.duration.tuplet[1] || note.chord || note.slur ||
      note.beams?.length || note.unpitched || note.printObject === false) {
    unsupported(`Voice contains unsupported tie, tuplet, grace, chord, slur, beam or hidden/percussion notation at ${note.id}`);
  }
}

// Stem, rest-position and tie-side hints are display defaults; a replacement simply does not keep them.
function assertReplaceable(note: Note): void {
  if (note.articulations?.length || note.ornaments?.length || note.dynamic || note.lyric || note.tags?.length) {
    unsupported(`Replacing ${note.id} would discard authored notation; use a dedicated notation command`);
  }
}

/** Musical content written by an entry; IDs and display hints are excluded. */
function entryContent(notes: readonly Note[]): string {
  return notes.map((note) => JSON.stringify([note.rest ? null : note.pitch.toJSON(), note.onsetQuarters.toJSON(),
    note.duration.toJSON(), note.velocityOverride, note.performed])).sort().join('\n');
}

const REST_DURATIONS = [4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64]
  .flatMap((base) => [2, 1, 0].map((dots) => new Duration({base, dots})))
  .filter((duration) => duration.quarters.mul(new Rational(64)).den === 1)
  .sort((a, b) => b.quarters.cmp(a.quarters));

/** One bounded voice rewrite. Stable submitted entry IDs also seed every generated rest ID. */
export function applyNotationEntry(score: Score, entry: ScoreNotationEntry, affected: Set<NoteId>): Score {
  const part = score.getPart(entry.partId);
  if (!part) throw new ScoreEditError('unknown-part', `Unknown part: ${entry.partId}`);
  if (score.getNote(entry.id)) throw new ScoreEditError('duplicate-id', `Duplicate note ID: ${entry.id}`);
  const staff = entry.staff ?? 1;
  const maxStaff = part.notes.reduce((maximum, note) => Math.max(maximum, note.staff ?? 1), part.staves ?? 1);
  if (staff > maxStaff) unsupported('Staff entry cannot add a new staff');
  const onset = Rational.from(entry.onsetQuarters);
  const duration = new Duration(entry.duration);
  const end = onset.add(duration.quarters);
  const measures = score.measures.filter((measure) => measure.onsetQuarters.lte(onset) && measure.offsetQuarters.gt(onset));
  if (measures.length !== 1) unsupported('Staff entry requires an existing, unambiguous authored measure at the cursor');
  const measure = measures[0];
  if (end.gt(measure.offsetQuarters)) unsupported('Staff entry cannot cross a measure boundary');
  if (score.measures.some((other) => other !== measure && other.onsetQuarters.lt(measure.offsetQuarters) && other.offsetQuarters.gt(measure.onsetQuarters))) {
    unsupported('Staff entry requires a nonoverlapping authored measure grid');
  }
  if (score.timeMap.meters.some((meter) => meter.atQuarters.gt(measure.onsetQuarters) && meter.atQuarters.lt(measure.offsetQuarters))) {
    unsupported('Staff entry cannot repair a meter change inside an authored measure');
  }
  const notes = part.notes.filter((note) => note.voice === entry.voice && staffOf(note, part) === staff &&
    note.onsetQuarters.lt(measure.offsetQuarters) &&
    (note.offsetQuarters.gt(measure.onsetQuarters) || note.onsetQuarters.gte(measure.onsetQuarters)));
  let previousEnd = measure.onsetQuarters;
  for (const note of notes) {
    assertSimple(note);
    if (note.onsetQuarters.lt(measure.onsetQuarters) || note.offsetQuarters.gt(measure.offsetQuarters)) {
      unsupported('Staff entry cannot rewrite notes crossing a measure boundary');
    }
    if (note.onsetQuarters.lt(previousEnd)) unsupported('Staff entry requires a monophonic voice without overlapping notes');
    previousEnd = note.offsetQuarters;
  }
  const removed = notes.filter((note) => note.onsetQuarters.lt(end) && note.offsetQuarters.gt(onset));
  for (const note of removed) {
    assertReplaceable(note);
    if (!note.rest && (note.onsetQuarters.lt(onset) || note.offsetQuarters.gt(end))) {
      unsupported('Staff entry cannot truncate a sounding note; select its onset and cover its full duration');
    }
  }
  const entered = new Note({id: entry.id, voice: entry.voice, staff, onsetQuarters: onset, duration,
    ...(entry.pitch === null ? {rest: true} : {pitch: Pitch.fromJSON(entry.pitch),
      ...(entry.velocity === undefined ? {} : {velocityOverride: entry.velocity})})});
  if (!entered.rest) assertSoundingPitch(part, entered.pitch);
  const retained = notes.filter((note) => !removed.includes(note));
  const occupied = [...retained, entered].sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
  const added: Note[] = [entered];
  let cursor = measure.onsetQuarters;
  let restIndex = 0;
  const fill = (to: Rational) => {
    while (cursor.lt(to)) {
      const remaining = to.sub(cursor);
      // The smallest supported exact grid is 1/64 quarter (a 256th note).
      if (remaining.mul(new Rational(64)).den !== 1) {
        unsupported('Automatic rests require gaps on a 1/64-quarter grid');
      }
      const restDuration = REST_DURATIONS.find((value) => value.quarters.lte(remaining));
      if (!restDuration || restIndex >= 256) unsupported('Automatic rest completion exceeds its 256-rest limit');
      const restId = NoteId(`${entry.id}:rest:${restIndex++}`);
      if (score.getNote(restId)) throw new ScoreEditError('duplicate-id', `Generated rest ID already exists: ${restId}`);
      added.push(new Note({id: restId, voice: entry.voice, staff, rest: true,
        onsetQuarters: cursor, duration: restDuration}));
      cursor = cursor.add(restDuration.quarters);
    }
  };
  for (const note of occupied) { fill(note.onsetQuarters); cursor = note.offsetQuarters; }
  fill(measure.offsetQuarters);
  // Re-entering identical content (such as an existing rest) keeps the existing notes, IDs and selection.
  if (entryContent(removed) === entryContent(added)) return score;
  return score.edit((transaction) => {
    for (const note of removed) { transaction.removeNote(note.id); affected.add(note.id); }
    for (const note of added) { transaction.addNote(part.id, note); affected.add(note.id); }
  });
}
