// Shared MIDI note-name helpers.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Pitch-class name without the octave, e.g. 61 → "C#". */
export function pitchClassName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

/** Scientific pitch name with the octave, e.g. 61 → "C#4". */
export function noteName(midi: number): string {
  return `${pitchClassName(midi)}${Math.floor(midi / 12) - 1}`;
}
