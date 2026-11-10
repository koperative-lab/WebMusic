/**
 * Units that name what a number means rather than a symbol a reader needs:
 * a plain multiplier or a position reads as the number alone. Physical units
 * (Hz, dB, s, ms, %) are shown.
 */
const UNSHOWN_UNITS = new Set(['linear-gain', 'gain', 'ratio', 'pan', 'native', 'normalized', 'multiplier', 'x', '×']);

/** The unit a readout shows after its number, or undefined for none. */
export function displayUnit(unit: string | undefined): string | undefined {
  const trimmed = unit?.trim();
  return trimmed && !UNSHOWN_UNITS.has(trimmed.toLowerCase()) ? trimmed : undefined;
}
