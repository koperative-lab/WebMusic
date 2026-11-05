import {ScoreEditError, type ScoreNotationWrite, type ScorePitchChange} from '../../core/editing';
import {Note, type NoteData, type SlurMark, type Tie} from '../../core/model/Note';
import {getPartNoteLookup, type Part} from '../../core/model/Part';
import type {Score} from '../../core/model/Score';
import {Duration} from '../../core/primitives/Duration';
import {Pitch} from '../../core/primitives/Pitch';
import {Rational} from '../../core/primitives/Rational';
import {tieChains} from '../../core/query/ties';
import {NoteId} from '../../core/types/ids';
import {REST_DURATIONS, assertSoundingPitch, staffOf} from './edit-notation';
import {staffMeasureGrid} from './staff-notation';

/*
 * Sheet editing operations. They act locally on the events a user points at,
 * so they work inside real scores with beams, slurs, chords, several voices
 * and tuplets elsewhere in the measure. Anything they cannot rewrite exactly
 * fails with `unsupported-structure` and leaves the score unchanged.
 */

function unsupported(message: string): never { throw new ScoreEditError('unsupported-structure', message); }

function partOf(score: Score, noteId: NoteId): Part {
  const part = score.parts.find((candidate) => getPartNoteLookup(candidate).lookup(noteId));
  if (!part) throw new ScoreEditError('unknown-note', `Unknown note: ${noteId}`);
  return part;
}

function noteOf(score: Score, noteId: NoteId): Note {
  const note = score.getNote(noteId);
  if (!note) throw new ScoreEditError('unknown-note', `Unknown note: ${noteId}`);
  return note;
}

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

function inTuplet(note: Note): boolean {
  return note.tupletId !== undefined || Boolean(note.tupletMarks?.length) || note.duration.tuplet[0] !== note.duration.tuplet[1];
}

function slurMarks(note: Note): readonly SlurMark[] {
  return typeof note.slur === 'string' ? [{type: note.slur}] : Array.isArray(note.slur) ? note.slur : note.slur ? [note.slur as SlurMark] : [];
}

interface SlurPair { readonly start: NoteId; readonly stop: NoteId; readonly number: number }

/** Slur pairs per voice and number, in onset order (as the renderer and deletion guard pair them). */
function slurPairs(part: Part): SlurPair[] {
  const open = new Map<string, NoteId[]>();
  const pairs: SlurPair[] = [];
  for (const note of part.notes) {
    // A close followed by a new start on the same note denotes two slurs.
    for (const mark of [...slurMarks(note)].sort((a, b) => Number(a.type === 'start') - Number(b.type === 'start'))) {
      const number = mark.number ?? 1;
      const key = JSON.stringify([note.voice, number]);
      if (mark.type === 'start') open.set(key, [...open.get(key) ?? [], note.id]);
      else if (mark.type === 'stop') {
        const start = open.get(key)?.shift();
        if (start) pairs.push({start, stop: note.id, number});
      }
    }
  }
  return pairs;
}

function withoutSlurMark(note: Pick<NoteData, 'slur'>, type: 'start' | 'stop', number: number): NoteData['slur'] {
  const marks = typeof note.slur === 'string' ? [{type: note.slur}] : Array.isArray(note.slur) ? note.slur as readonly SlurMark[] : note.slur ? [note.slur as SlurMark] : [];
  const kept = marks.filter((mark) => !(mark.type === type && (mark.number ?? 1) === number));
  return kept.length === 0 ? undefined : kept.length === 1 && kept[0].number === undefined && Object.keys(kept[0]).length === 1 ? kept[0].type : kept;
}

/** Collected per-note changes for notes that stay; merged before the transaction. */
class Patches {
  readonly map = new Map<NoteId, Partial<NoteData>>();
  set(id: NoteId, patch: Partial<NoteData>): void { this.map.set(id, {...this.map.get(id), ...patch}); }
  current<K extends keyof NoteData>(note: Note, key: K): NoteData[K] {
    const patch = this.map.get(note.id);
    return patch && key in patch ? patch[key] as NoteData[K] : (note as unknown as NoteData)[key];
  }
}

/**
 * Ties that would connect a kept note to a removed or rewritten one are
 * dropped on the kept side, so every remaining tie still has its partner.
 */
function detachTies(part: Part, detached: ReadonlySet<NoteId>, patches: Patches): void {
  for (const chain of tieChains(part)) {
    if (chain.length < 2) continue;
    chain.forEach((note, index) => {
      if (detached.has(note.id)) return;
      const previous = chain[index - 1];
      const next = chain[index + 1];
      let tie = patches.current(note, 'tie') as Tie | undefined;
      if (next && detached.has(next.id)) tie = tie === 'continue' ? 'stop' : tie === 'start' ? undefined : tie;
      if (previous && detached.has(previous.id)) tie = tie === 'continue' ? 'start' : tie === 'stop' ? undefined : tie;
      if (tie !== patches.current(note, 'tie')) patches.set(note.id, {tie});
    });
  }
}

/** Drop the far end of every slur whose other end no longer exists. */
function detachSlurs(part: Part, gone: ReadonlySet<NoteId>, patches: Patches, added: Map<NoteId, NoteData>): void {
  for (const pair of slurPairs(part)) {
    const startGone = gone.has(pair.start), stopGone = gone.has(pair.stop);
    if (startGone === stopGone) continue;
    const [keep, type] = startGone ? [pair.stop, 'stop' as const] : [pair.start, 'start' as const];
    const rewritten = added.get(keep);
    if (rewritten) { rewritten.slur = withoutSlurMark(rewritten, type, pair.number); continue; }
    const note = part.notes.find((candidate) => candidate.id === keep)!;
    patches.set(keep, {slur: withoutSlurMark({slur: patches.current(note, 'slur')}, type, pair.number)});
  }
}

function commit(score: Score, part: Part, removed: readonly NoteId[], added: readonly NoteData[], patches: Patches, affected: Set<NoteId>): Score {
  return score.edit((transaction) => {
    for (const id of removed) { transaction.removeNote(id); affected.add(id); }
    for (const data of added) { transaction.addNote(part.id, new Note(data)); affected.add(data.id); }
    for (const [id, patch] of patches.map) { transaction.updateNote(id, patch); affected.add(id); }
  });
}

// ---------------------------------------------------------------- set-pitches

/** Respell or move notes; a tied note moves its whole tie chain so every tie still joins equal pitches. */
export function applySetPitches(score: Score, changes: readonly ScorePitchChange[], affected: Set<NoteId>): Score {
  const targets = new Map<NoteId, Pitch>();
  const chainOf = new Map<Part, Map<NoteId, Note[]>>();
  for (const change of changes) {
    const note = noteOf(score, change.noteId);
    if (note.rest || note.unpitched) unsupported(`Note ${note.id} has no pitch to change`);
    const part = partOf(score, note.id);
    let chains = chainOf.get(part);
    if (!chains) {
      chains = new Map();
      for (const chain of tieChains(part)) for (const member of chain) chains.set(member.id, chain);
      chainOf.set(part, chains);
    }
    const pitch = Pitch.fromJSON(change.pitch);
    if (pitch.midi < 0 || pitch.midi > 127) throw new ScoreEditError('invalid-command', 'Pitch must be in MIDI range 0 to 127');
    assertSoundingPitch(part, pitch);
    for (const member of chains.get(note.id) ?? [note]) {
      const previous = targets.get(member.id);
      if (previous && !samePitch(previous, pitch)) throw new ScoreEditError('invalid-command', `Tied note ${member.id} cannot take two different pitches`);
      targets.set(member.id, pitch);
    }
  }
  return score.edit((transaction) => {
    for (const [id, pitch] of targets) {
      const note = score.getNote(id)!;
      if (samePitch(note.pitch, pitch)) continue;
      // A drawn stem direction belonged to the old position; let the engraver choose again.
      transaction.updateNote(id, {pitch, stem: note.stem === 'none' ? 'none' : undefined});
      affected.add(id);
    }
  });
}

// ------------------------------------------------------------- notes-to-rests

/**
 * Delete notes the way a notation editor does: a chord loses only the chosen
 * heads, and an event that loses every head becomes a rest of exactly the
 * same written duration, tuplet and beam position. Rests are left alone.
 */
export function applyNotesToRests(score: Score, noteIds: readonly NoteId[], affected: Set<NoteId>): Score {
  const byPart = new Map<Part, Note[]>();
  for (const id of noteIds) {
    const note = noteOf(score, id);
    if (note.rest) continue;
    if (note.grace) unsupported(`Grace note ${note.id} cannot become a rest`);
    const part = partOf(score, id);
    byPart.set(part, [...byPart.get(part) ?? [], note]);
  }
  let next = score;
  for (const [part, selected] of byPart) {
    const chosen = new Set(selected.map((note) => note.id));
    const events = new Map<string, Note[]>();
    for (const note of part.notes) {
      if (note.grace || note.rest) continue;
      const key = JSON.stringify([note.voice, staffOf(note, part), note.onsetQuarters.toJSON()]);
      events.set(key, [...events.get(key) ?? [], note]);
    }
    const removed: NoteId[] = [];
    const added: NoteData[] = [];
    const patches = new Patches();
    for (const event of events.values()) {
      const hit = event.filter((note) => chosen.has(note.id));
      if (!hit.length) continue;
      const kept = event.filter((note) => !chosen.has(note.id));
      removed.push(...hit.map((note) => note.id));
      if (kept.length) {
        // The first remaining head carries the event; the others stay chord members.
        if (kept[0].chord) patches.set(kept[0].id, {chord: undefined});
        continue;
      }
      const head = event.find((note) => !note.chord) ?? event[0];
      added.push({id: head.id, rest: true, voice: head.voice, staff: staffOf(head, part),
        onsetQuarters: head.onsetQuarters, duration: head.duration,
        ...(head.tupletId === undefined ? {} : {tupletId: head.tupletId}),
        ...(head.tupletMarks ? {tupletMarks: head.tupletMarks} : {}),
        ...(head.beams ? {beams: head.beams} : {}),
        ...(head.printObject === false ? {printObject: false} : {})});
    }
    if (!removed.length) continue;
    const gone = new Set(removed.filter((id) => !added.some((data) => data.id === id)));
    detachTies(part, new Set(removed), patches);
    detachSlurs(part, new Set([...gone, ...added.map((data) => data.id)]), patches, new Map());
    for (const id of removed) patches.map.delete(id);
    next = commit(next, next.getPart(part.id)!, removed, added, patches, affected);
  }
  return next;
}

// ------------------------------------------------------------------ tie-notes

/** Tie each note to the next note of the same pitch that starts exactly where it ends, or remove that tie. */
export function applyTieNotes(score: Score, noteIds: readonly NoteId[], tied: boolean, affected: Set<NoteId>): Score {
  const ties = new Map<NoteId, Tie | undefined>();
  const tieOf = (note: Note): Tie | undefined => ties.has(note.id) ? ties.get(note.id) : note.tie;
  const setTie = (note: Note, tie: Tie | undefined) => ties.set(note.id, tie);
  for (const id of noteIds) {
    const note = noteOf(score, id);
    if (note.rest || note.unpitched || note.grace) unsupported(`Note ${note.id} cannot be tied`);
    const part = partOf(score, id);
    const next = part.notes.find((candidate) => !candidate.rest && !candidate.grace && candidate.voice === note.voice &&
      candidate.onsetQuarters.eq(note.offsetQuarters) && candidate.pitch.midi === note.pitch.midi);
    const forward = (tie: Tie | undefined) => tie === 'start' || tie === 'continue';
    if (tied) {
      if (forward(tieOf(note))) continue;
      if (!next) unsupported(`No note of the same pitch follows ${note.id} directly in its voice`);
      setTie(note, tieOf(note) === 'stop' ? 'continue' : 'start');
      const after = tieOf(next);
      setTie(next, after === 'start' || after === 'continue' ? 'continue' : 'stop');
    } else {
      if (!forward(tieOf(note))) continue;
      setTie(note, tieOf(note) === 'continue' ? 'stop' : undefined);
      if (next) {
        const after = tieOf(next);
        setTie(next, after === 'continue' ? 'start' : after === 'stop' ? undefined : after);
      }
    }
  }
  return score.edit((transaction) => {
    for (const [id, tie] of ties) {
      if (score.getNote(id)!.tie === tie) continue;
      transaction.updateNote(id, {tie});
      affected.add(id);
    }
  });
}

// -------------------------------------------------------------- write-notation

interface Bounds { readonly start: Rational; readonly end: Rational }

/** The measure holding `at`: authored measures, or bars derived from the meter where none are authored. */
export function measureBoundsAt(score: Score, at: Rational): Bounds | undefined {
  const measure = staffMeasureGrid(score).find((candidate) => candidate.startQuarters.lte(at) && candidate.endQuarters.gt(at));
  return measure ? {start: measure.startQuarters, end: measure.endQuarters} : undefined;
}

/** Fill [from, to) with rests, longest first; the gap must lie on the 1/64-quarter grid. */
function restsBetween(from: Rational, to: Rational, make: (onset: Rational, duration: Duration) => void): void {
  let cursor = from;
  let count = 0;
  while (cursor.lt(to)) {
    const remaining = to.sub(cursor);
    if (remaining.mul(new Rational(64)).den !== 1) unsupported('Rests can only fill gaps on a 1/64-quarter grid');
    const duration = REST_DURATIONS.find((value) => value.quarters.lte(remaining));
    if (!duration || ++count > 256) unsupported('Filling the gap would need more than 256 rests');
    make(cursor, duration);
    cursor = cursor.add(duration.quarters);
  }
}

/** Write one note, chord or rest into a voice: the editing primitive behind note input and duration changes. */
export function applyWriteNotation(score: Score, write: ScoreNotationWrite, affected: Set<NoteId>): Score {
  const part = score.getPart(write.partId);
  if (!part) throw new ScoreEditError('unknown-part', `Unknown part: ${write.partId}`);
  const staff = write.staff ?? 1;
  const maxStaff = part.notes.reduce((maximum, note) => Math.max(maximum, note.staff ?? 1), part.staves ?? 1);
  if (staff > maxStaff) unsupported('Notation input cannot add a new staff');
  const onset = Rational.from(write.onsetQuarters);
  const duration = new Duration(write.duration);
  const end = onset.add(duration.quarters);
  const bounds = measureBoundsAt(score, onset);
  if (!bounds) unsupported('Notation input needs a measure at the cursor');
  if (end.gt(bounds.end)) unsupported('The note does not fit before the barline; choose a shorter duration');
  if (write.notes.some((note) => note.pitch === null) && write.notes.length !== 1) throw new ScoreEditError('invalid-command', 'A rest is written alone');
  const lane = part.notes.filter((note) => note.voice === write.voice && staffOf(note, part) === staff &&
    note.onsetQuarters.lt(bounds.end) && note.offsetQuarters.gt(bounds.start));
  if (lane.some((note) => note.grace && note.onsetQuarters.gte(onset) && note.onsetQuarters.lt(end))) unsupported('Grace notes cannot be overwritten yet');
  // Events are chords or rests: every head in a voice at one onset.
  const groups = new Map<string, Note[]>();
  for (const note of lane) {
    if (note.grace) continue;
    const key = note.onsetQuarters.toString();
    groups.set(key, [...groups.get(key) ?? [], note]);
  }
  const events = [...groups.values()].map((notes) => ({notes, start: notes[0].onsetQuarters,
    end: notes.reduce((latest, note) => note.offsetQuarters.gt(latest) ? note.offsetQuarters : latest, notes[0].offsetQuarters)}))
    .sort((a, b) => a.start.cmp(b.start));
  const touched = events.filter((event) => event.start.lt(end) && event.end.gt(onset));
  for (const event of touched) {
    if (event.start.lt(onset) && !event.notes.every((note) => note.rest)) unsupported('The cursor is inside a sounding note; start at its beginning');
    if (event.start.lt(bounds.start) || event.end.gt(bounds.end)) unsupported('Notes crossing the barline cannot be overwritten yet');
    if (event.notes.some(inTuplet)) unsupported('Tuplet rhythms cannot be rewritten yet; change their pitches instead');
  }
  const regionStart = touched.reduce((earliest, event) => event.start.lt(earliest) ? event.start : earliest, onset);
  const regionEnd = touched.reduce((latest, event) => event.end.gt(latest) ? event.end : latest, end);
  const removedNotes = touched.flatMap((event) => event.notes);
  const removedIds = new Set(removedNotes.map((note) => note.id));
  const seen = new Set<string>();
  for (const input of write.notes) {
    if (seen.has(input.id)) throw new ScoreEditError('duplicate-id', `Duplicate note ID: ${input.id}`);
    seen.add(input.id);
    if (score.getNote(input.id) && !removedIds.has(input.id)) throw new ScoreEditError('duplicate-id', `Duplicate note ID: ${input.id}`);
  }
  const midis = write.notes.filter((note) => note.pitch).map((note) => Pitch.fromJSON(note.pitch!).midi);
  if (new Set(midis).size !== midis.length) throw new ScoreEditError('invalid-command', 'A chord cannot hold the same pitch twice');
  const added = new Map<NoteId, NoteData>();
  write.notes.forEach((input, index) => {
    const previous = removedNotes.find((note) => note.id === input.id);
    // A rewritten note keeps its expression marks; time-bound marks are recomputed.
    const kept: Partial<NoteData> = previous && input.pitch !== null && !previous.rest ? {
      ...(previous.articulations ? {articulations: previous.articulations} : {}),
      ...(previous.ornaments ? {ornaments: previous.ornaments} : {}),
      ...(previous.slur ? {slur: previous.slur} : {}),
      ...(previous.dynamic ? {dynamic: previous.dynamic} : {}),
      ...(previous.lyric ? {lyric: previous.lyric} : {}),
      ...(previous.tags ? {tags: previous.tags} : {}),
    } : {};
    const data: NoteData = input.pitch === null
      ? {id: input.id, rest: true, voice: write.voice, staff, onsetQuarters: onset, duration}
      : {...kept, id: input.id, pitch: Pitch.fromJSON(input.pitch), voice: write.voice, staff, onsetQuarters: onset, duration,
        ...(index > 0 ? {chord: true} : {}),
        ...(input.velocity ?? previous?.velocityOverride) !== undefined ? {velocityOverride: input.velocity ?? previous?.velocityOverride} : {}};
    if (data.pitch) assertSoundingPitch(part, data.pitch);
    added.set(input.id, data);
  });
  const restBase = write.notes[0].id;
  let restIndex = 0;
  const addRest = (at: Rational, value: Duration) => {
    let id = NoteId(`${restBase}:rest:${restIndex++}`);
    while (added.has(id) || (score.getNote(id) && !removedIds.has(id))) id = NoteId(`${restBase}:rest:${restIndex++}`);
    added.set(id, {id, rest: true, voice: write.voice, staff, onsetQuarters: at, duration: value});
  };
  restsBetween(regionStart, onset, addRest);
  restsBetween(end, regionEnd, addRest);
  // Writing what is already there keeps the existing notes, IDs and selection.
  const content = (notes: readonly {rest?: boolean; pitch?: Pitch; onsetQuarters: Rational; duration: Duration}[]) =>
    notes.map((note) => JSON.stringify([note.rest ? null : note.pitch!.toJSON(), note.onsetQuarters.toJSON(), note.duration.toJSON()])).sort().join('\n');
  if (removedNotes.length && content(removedNotes) === content([...added.values()]) &&
      write.notes.every((input) => removedIds.has(input.id))) return score;
  const patches = new Patches();
  // Authored beams no longer describe the rewritten voice; the engraver regroups it by meter.
  for (const note of lane) if (!removedIds.has(note.id) && note.beams) patches.set(note.id, {beams: undefined});
  detachTies(part, removedIds, patches);
  const gone = new Set([...removedIds].filter((id) => !added.has(id) || added.get(id)!.rest));
  detachSlurs(part, gone, patches, added);
  return commit(score, part, [...removedIds], [...added.values()], patches, affected);
}
