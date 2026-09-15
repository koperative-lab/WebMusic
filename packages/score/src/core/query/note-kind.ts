import type {Note} from '../model/Note';
import type {Pitch} from '../primitives/Pitch';

/** A non-rest note with a pitch available for display and timing projections. */
export type SoundingNote = Note & {
  readonly pitch: Pitch;
  readonly rest?: false;
};

/** A sounding note whose pitch represents musical pitch rather than percussion display placement. */
export type PitchedNote = SoundingNote & {
  readonly unpitched?: false;
};

/**
 * True for notes a score view may render: explicit rests are excluded, while
 * unpitched percussion remains displayable at its MusicXML display pitch.
 */
export function isSoundingNote(note: Note): note is SoundingNote {
  return note.rest !== true && note.pitch != null;
}

/**
 * True for notes suitable for tonal, harmonic, melodic, and voice-leading
 * analysis. Unpitched percussion has a display pitch but is not tonal input.
 */
export function isPitchedNote(note: Note): note is PitchedNote {
  return isSoundingNote(note) && note.unpitched !== true;
}
