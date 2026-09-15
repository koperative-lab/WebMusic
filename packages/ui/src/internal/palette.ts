/** Neutral defaults shared by the frame and analysis presenters. Role colours
 * (pitch classes, selection, errors and warnings) belong to their own palettes. */
export const neutralPalette = {
  foreground: ['#111', '#eee'],
  muted: ['#777', '#aaa'],
  border: ['#d8d8d8', '#333'],
  surfaceMuted: ['#eee', '#222'],
} as const;

export function neutralColor(role: keyof typeof neutralPalette): string {
  const [light, dark] = neutralPalette[role];
  return `light-dark(${light}, ${dark})`;
}
