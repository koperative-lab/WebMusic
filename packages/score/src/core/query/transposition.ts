import type {Note} from '../model/Note';
import type {Part} from '../model/Part';
import {Pitch} from '../primitives/Pitch';
import {assert} from '../utils/invariants';

/**
 * Total transposition of a part in semitones (sounding − written), per
 * MusicXML semantics: chromatic + 12 * octaveChange. 0 for concert-pitch
 * parts (no `transpose` field).
 */
export function transpositionSemitones(part: Part): number {
  const t = part.transpose;
  if (!t) return 0;
  return t.chromatic + 12 * (t.octaveChange ?? 0);
}

/**
 * Concert (sounding) pitch of a written note in a possibly-transposing part.
 *
 * SPELLING CAVEAT: the conversion is MIDI-based via `Pitch.transpose`, so the
 * result uses the default sharp-preferring spelling — the `diatonic` hint is
 * not consulted. Written D4 in a Bb clarinet part (chromatic −2) sounds C4;
 * written E4 sounds D4, but written F4 sounds D#4 (not Eb4).
 *
 * Throws for rest notes (no pitch).
 */
export function soundingPitch(note: Note, part: Part): Pitch {
  assert(note.pitch != null, `soundingPitch: note ${note.id} has no pitch (rest?)`);
  const semis = transpositionSemitones(part);
  return semis === 0 ? note.pitch : note.pitch.transpose(semis);
}

/**
 * Inverse of `soundingPitch`: the written pitch a transposing instrument
 * reads so that `note.pitch` (taken as the concert/sounding pitch) results.
 * Same MIDI-based spelling caveat as `soundingPitch`. Throws for rest notes.
 */
export function writtenPitch(note: Note, part: Part): Pitch {
  assert(note.pitch != null, `writtenPitch: note ${note.id} has no pitch (rest?)`);
  const semis = transpositionSemitones(part);
  return semis === 0 ? note.pitch : note.pitch.transpose(-semis);
}
