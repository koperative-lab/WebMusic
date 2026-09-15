/** Ink bounds in one staff row's local coordinates. Adjacent rows share X. */
export interface StaffInkBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface StaffSpacingOptions {
  /** Original distance from the upper row's top to the lower row's top. */
  rowDistance: number;
  upperBottomLine: number;
  lowerTopLine: number;
  noteHeight: number;
}

const MAX_BINS = 4096;

/**
 * Pack adjacent staff rows toward a four-space gap without crowding their ink.
 * Bounded horizontal skylines avoid comparing every upper/lower glyph pair.
 * Coarse bins may retain extra space, but cannot permit an ink collision.
 */
export function getStaffOverlap(
  upper: readonly StaffInkBounds[],
  lower: readonly StaffInkBounds[],
  options: StaffSpacingOptions,
): number {
  const {rowDistance, upperBottomLine, lowerTopLine, noteHeight} = options;
  if (!upper.length || !lower.length ||
    ![rowDistance, upperBottomLine, lowerTopLine, noteHeight].every(Number.isFinite) ||
    rowDistance < 0 || noteHeight <= 0) return 0;
  const desired = Math.max(0, rowDistance + lowerTopLine - upperBottomLine - 4 * noteHeight);
  if (!desired || !Number.isFinite(desired)) return 0;

  let left = Infinity;
  let right = -Infinity;
  for (const row of [upper, lower]) for (const box of row) {
    if (![box.left, box.right, box.top, box.bottom].every(Number.isFinite) ||
      box.right < box.left || box.bottom < box.top) return 0;
    left = Math.min(left, box.left);
    right = Math.max(right, box.right);
  }
  // Reserve horizontal breathing room as well as vertical clearance. Include
  // zero-height staff lines and zero-width stems in the collision envelope.
  const padding = noteHeight / 2;
  left -= padding;
  right += padding;
  const span = right - left;
  if (!(span > 0) || !Number.isFinite(span)) return 0;
  const binWidth = Math.max(noteHeight, span / MAX_BINS);
  const count = Math.min(MAX_BINS, Math.max(1, Math.ceil(span / binWidth)));
  const upperBottom = new Float64Array(count).fill(-Infinity);
  const lowerTop = new Float64Array(count).fill(Infinity);
  const collect = (boxes: readonly StaffInkBounds[], skyline: Float64Array, isUpper: boolean): void => {
    for (const box of boxes) {
      const start = Math.max(0, Math.min(count - 1, Math.floor((box.left - padding - left) / binWidth)));
      const end = Math.max(start, Math.min(count - 1, Math.floor((box.right + padding - left) / binWidth)));
      const edge = isUpper ? box.bottom : rowDistance + box.top;
      for (let index = start; index <= end; index += 1) {
        skyline[index] = isUpper ? Math.max(skyline[index], edge) : Math.min(skyline[index], edge);
      }
    }
  };
  collect(upper, upperBottom, true);
  collect(lower, lowerTop, false);
  let overlap = desired;
  for (let index = 0; index < count; index += 1) {
    overlap = Math.min(overlap, lowerTop[index] - upperBottom[index] - noteHeight);
  }
  return Math.max(0, overlap);
}
