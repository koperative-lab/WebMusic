// Pure (DOM-free) helpers shared by the transport elements, split out so they
// are unit-testable without evaluating a custom-element class.

/** Format seconds as `m:ss`. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** Parse a `loop` attribute: `""`/`"true"` ⇒ whole-clip loop; `"a-b"` ⇒ A–B window. */
export function parseLoopAttr(raw: string | null): boolean | {start: number; end: number} {
  if (raw == null) return false;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'true' || trimmed === 'loop') return true;
  if (trimmed === 'false') return false;
  const match = trimmed.match(/^(-?\d*\.?\d+)\s*[-:,]\s*(-?\d*\.?\d+)$/);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return {start, end};
  }
  return false;
}
