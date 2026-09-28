// ============================================================================
// Pure windowing math for viewport virtualization and canvas sizing.
//
// Waveforms and spectrograms can span hours; painting (or DOM-mounting) every
// peak/column per frame does not scale. Unlike WebScore's note virtualization
// (which needs binary search over time-sorted notes plus a max-duration slack
// for long held notes), audio data is a uniform grid of columns indexed by
// pixel — so the visible range is plain arithmetic: pixel → column index, then
// widen by a buffer of viewports on each side.
//
// All functions here are pure and DOM-free so they can be unit-tested in plain
// Node, mirroring the strategy of @webscore/view's windowing helpers.
// ============================================================================

/** Contiguous index range, `start` inclusive / `end` exclusive. */
export interface IndexRange {
  start: number;
  end: number;
}

/** Default number of extra viewports of columns kept rendered on each side. */
export const DEFAULT_BUFFER_SCREENS = 1;

/**
 * Safe maximum canvas dimension (device pixels) across engines. Chrome and
 * Firefox allow 32767/65535 in one dimension but Safari historically caps a
 * dimension at 16384 (and total area lower still); exceeding the limit makes
 * the canvas silently blank. 16384 is the largest broadly safe value.
 */
export const MAX_CANVAS_DIMENSION = 16384;

/**
 * Buffered scroll window in pixel space: the visible `[scrollLeft, scrollLeft +
 * viewportWidth]` stripe widened by `bufferScreens` viewports on each side.
 * `lo` may be negative; callers clamp via {@link visibleColumnRange}.
 */
export function bufferedScrollRange(
  scrollLeft: number,
  viewportWidth: number,
  bufferScreens: number,
): {lo: number; hi: number} {
  const buffer = Math.max(0, bufferScreens) * viewportWidth;
  return {lo: scrollLeft - buffer, hi: scrollLeft + viewportWidth + buffer};
}

/**
 * Visible column index range for a virtualized strip renderer.
 *
 * Columns are a uniform grid `columnWidth` CSS px wide; `totalColumns` is the
 * count available. Given the current `scrollLeft` and `viewportWidth` (both CSS
 * px) and a `bufferScreens` margin, returns the half-open `[start, end)` range
 * of columns that should be painted. The range is clamped to
 * `[0, totalColumns]` and is empty when nothing is in view.
 */
export function visibleColumnRange(
  scrollLeft: number,
  viewportWidth: number,
  columnWidth: number,
  totalColumns: number,
  bufferScreens: number = DEFAULT_BUFFER_SCREENS,
): IndexRange {
  if (!(totalColumns > 0) || !(columnWidth > 0) || !(viewportWidth > 0)) {
    return {start: 0, end: 0};
  }
  const {lo, hi} = bufferedScrollRange(scrollLeft, viewportWidth, bufferScreens);
  let start = Math.floor(lo / columnWidth);
  let end = Math.ceil(hi / columnWidth);
  if (start < 0) start = 0;
  if (end > totalColumns) end = totalColumns;
  if (end < start) end = start;
  return {start, end};
}

/**
 * Visible time window `[startSeconds, endSeconds]` for a horizontal scroll
 * position at a given `pixelsPerSecond`, widened by `bufferScreens`. `start`
 * is clamped at 0; `end` is clamped at `durationSeconds` when finite.
 */
export function visibleTimeRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  durationSeconds: number,
  bufferScreens: number = DEFAULT_BUFFER_SCREENS,
): {startSeconds: number; endSeconds: number} {
  if (!(pixelsPerSecond > 0)) return {startSeconds: 0, endSeconds: 0};
  const {lo, hi} = bufferedScrollRange(scrollLeft, viewportWidth, bufferScreens);
  let startSeconds = Math.max(0, lo / pixelsPerSecond);
  let endSeconds = hi / pixelsPerSecond;
  if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    if (endSeconds > durationSeconds) endSeconds = durationSeconds;
    if (startSeconds > durationSeconds) startSeconds = durationSeconds;
  }
  if (endSeconds < startSeconds) endSeconds = startSeconds;
  return {startSeconds, endSeconds};
}

/** Convert a horizontal pixel offset (CSS px) to seconds at a given zoom. */
export function pixelToSeconds(x: number, pixelsPerSecond: number): number {
  if (!(pixelsPerSecond > 0)) return 0;
  return x / pixelsPerSecond;
}

/** Convert seconds to a horizontal pixel offset (CSS px) at a given zoom. */
export function secondsToPixel(seconds: number, pixelsPerSecond: number): number {
  return seconds * pixelsPerSecond;
}

/** Resolved canvas backing-store allocation. */
export interface CanvasBackingSize {
  /** Backing width in device pixels (capped to `maxDimension`). */
  width: number;
  /** Backing height in device pixels (capped to `maxDimension`). */
  height: number;
  /** Device pixels per CSS pixel actually achieved on x (≤ requested dpr). */
  scaleX: number;
  /** Device pixels per CSS pixel actually achieved on y (≤ requested dpr). */
  scaleY: number;
}

/**
 * Compute a canvas backing-store size for a CSS size at a device pixel ratio,
 * capped per dimension to `maxDimension` so the canvas never exceeds browser
 * limits (an oversized canvas goes silently blank). When the cap kicks in the
 * effective scale shrinks below `dpr` — the content stays fully visible, merely
 * less crisp.
 */
export function clampCanvasBackingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  maxDimension: number = MAX_CANVAS_DIMENSION,
): CanvasBackingSize {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const safeCssWidth = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const safeCssHeight = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const cap = Math.max(1, maxDimension);
  const width = Math.max(1, Math.min(Math.round(safeCssWidth * safeDpr), cap));
  const height = Math.max(1, Math.min(Math.round(safeCssHeight * safeDpr), cap));
  return {
    width,
    height,
    scaleX: width / safeCssWidth,
    scaleY: height / safeCssHeight,
  };
}
