export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function pcName(pc: number): string {
  return NOTE_NAMES[pitchClass(pc)];
}

/**
 * The Western notation glyph for a duration in quarters, dot included. Lives
 * here rather than in the presenter that draws it: which glyph a value takes,
 * and that a dot adds half again, are conventions of this domain.
 */
export function durationGlyph(quarters: number): string {
  const glyphs: Record<string, string> = {
    '4': '𝅝',
    '3': '𝅗𝅥·',
    '2': '𝅗𝅥',
    '1.5': '♩·',
    '1': '♩',
    '0.75': '♪·',
    '0.5': '♪',
    '0.25': '𝅘𝅥𝅯',
    '0.125': '𝅘𝅥𝅰',
  };
  return glyphs[String(Math.round(quarters * 1000) / 1000)] ?? String(quarters);
}
