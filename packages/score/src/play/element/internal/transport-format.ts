// Presentation formatting kept within the element layer and unit-testable
// without evaluating a Custom Element class.

/** Format seconds as `m:ss`. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
