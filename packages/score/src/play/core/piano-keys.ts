// Pure (DOM-free) keyboard layout helper, split out so it can be unit-tested in
// a non-browser environment without evaluating the custom-element class.

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export interface PianoKey {
  midi: number;
  isBlack: boolean;
}

/** The keys (white + black) spanning [startMidi, endMidi] inclusive, in pitch order. */
export function pianoKeys(startMidi: number, endMidi: number): PianoKey[] {
  const lo = Math.min(startMidi, endMidi);
  const hi = Math.max(startMidi, endMidi);
  const keys: PianoKey[] = [];
  for (let midi = lo; midi <= hi; midi += 1) {
    keys.push({midi, isBlack: BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12)});
  }
  return keys;
}
