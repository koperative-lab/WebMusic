/**
 * Pure windowing math for viewport virtualization and canvas sizing.
 *
 * The visualizers render scores with up to hundreds of thousands of notes;
 * creating one DOM node (or one canvas fill) per note per frame does not
 * scale. These helpers translate a scroll window into a contiguous index
 * range over the (start-time-sorted) note array via binary search, and cap
 * canvas backing-store allocations to browser-safe dimensions.
 *
 * All functions here are pure and DOM-free so they can be unit-tested in
 * plain Node.
 */

/** Minimal time span shape shared by sequence notes. */
export interface NoteTimeSpan {
  startTime: number;
  endTime: number;
}

/** Contiguous index range, `start` inclusive / `end` exclusive. */
export interface IndexRange {
  start: number;
  end: number;
}

/**
 * Note-count threshold above which virtualization defaults to ON.
 *
 * Rationale: a couple thousand SVG rects render and reflow comfortably on
 * commodity hardware (a few ms, ~1-2 MB); past that the initial render and
 * every layout pass start to scale visibly (50k rects ≈ seconds of initial
 * render and tens of MB). 2000 keeps small/medium scores on the simple
 * non-virtualized path (zero behavioral difference) and only turns the
 * machinery on where it pays for itself.
 */
export const DEFAULT_VIRTUALIZATION_THRESHOLD = 2000;

/** Default number of extra viewports of notes kept mounted on each side. */
export const DEFAULT_BUFFER_SCREENS = 1;

/**
 * Safe maximum canvas dimension (device pixels) across engines. Chrome and
 * Firefox allow 32767/65535 in one dimension but Safari historically caps a
 * dimension at 16384 (and total area lower still); exceeding the limit makes
 * the canvas silently blank. 16384 is the largest broadly safe value.
 */
export const MAX_CANVAS_DIMENSION = 16384;

/** Tolerance for float comparisons against the 1e-8-rounded note times. */
const TIME_EPSILON = 1e-6;

/** First index whose `startTime >= time` (array sorted by startTime). */
export function lowerBoundByStartTime(notes: ReadonlyArray<NoteTimeSpan>, time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startTime < time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** First index whose `startTime > time` (array sorted by startTime). */
export function upperBoundByStartTime(notes: ReadonlyArray<NoteTimeSpan>, time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startTime <= time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** True when the array is non-decreasing in `startTime`. */
export function isSortedByStartTime(notes: ReadonlyArray<NoteTimeSpan>): boolean {
  for (let index = 1; index < notes.length; index += 1) {
    if (notes[index].startTime < notes[index - 1].startTime) {
      return false;
    }
  }
  return true;
}

/** Longest note duration in the sequence (0 for an empty sequence). */
export function maxNoteDuration(notes: ReadonlyArray<NoteTimeSpan>): number {
  let max = 0;
  for (const note of notes) {
    const duration = note.endTime - note.startTime;
    if (duration > max) {
      max = duration;
    }
  }
  return max;
}

/**
 * Index range of candidate notes intersecting the time window `[t0, t1]`.
 *
 * Notes must be sorted by `startTime`. Because a long note that started well
 * before `t0` can still reach into the window, the lower bound is widened by
 * `maxDuration` (the longest note in the sequence): every note starting
 * before `t0 - maxDuration` is guaranteed to have ended by `t0`. The result
 * is a contiguous superset of the truly-intersecting notes — a few extra
 * just-offscreen notes is the price for a contiguous (cheaply diffable)
 * range.
 */
export function visibleNoteRange(
  notes: ReadonlyArray<NoteTimeSpan>,
  t0: number,
  t1: number,
  maxDuration: number,
): IndexRange {
  if (notes.length === 0 || t1 < t0) {
    return {start: 0, end: 0};
  }
  const start = lowerBoundByStartTime(notes, t0 - Math.max(0, maxDuration) - TIME_EPSILON);
  const end = upperBoundByStartTime(notes, t1 + TIME_EPSILON);
  return end <= start ? {start, end: start} : {start, end};
}

/**
 * Candidate index range for notes that may paint as active for `activeNote`
 * at its onset. All matches started no later and have not ended at that
 * instant, so sorted candidates live in
 * `[lowerBound(activeNote.startTime - maxDuration), upperBound(activeNote.startTime)]`.
 * Turns the per-noteOn O(n) scan into O(log n + candidates).
 */
export function activeNoteCandidateRange(
  notes: ReadonlyArray<NoteTimeSpan>,
  activeNote: NoteTimeSpan,
  maxDuration: number,
): IndexRange {
  if (notes.length === 0) {
    return {start: 0, end: 0};
  }
  const start = lowerBoundByStartTime(notes, activeNote.startTime - Math.max(0, maxDuration) - TIME_EPSILON);
  const end = upperBoundByStartTime(notes, activeNote.startTime + TIME_EPSILON);
  return end <= start ? {start, end: start} : {start, end};
}

/**
 * Buffered scroll window in pixel space: the visible `[offset, offset+size]`
 * stripe widened by `bufferScreens` viewports on each side. `lo` may be
 * negative; callers clamp via the binary search (which handles out-of-range
 * times naturally).
 */
export function bufferedScrollRange(
  scrollOffset: number,
  viewportSize: number,
  bufferScreens: number,
): {lo: number; hi: number} {
  const buffer = Math.max(0, bufferScreens) * viewportSize;
  return {lo: scrollOffset - buffer, hi: scrollOffset + viewportSize + buffer};
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
 * Compute a canvas backing-store size for a CSS size at a device pixel
 * ratio, capped per dimension to `maxDimension` so the canvas never exceeds
 * browser limits (an oversized canvas goes silently blank). When the cap
 * kicks in, the effective scale shrinks below `dpr` — the content stays
 * fully visible, merely less crisp.
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
  const width = Math.max(1, Math.min(Math.round(safeCssWidth * safeDpr), Math.max(1, maxDimension)));
  const height = Math.max(1, Math.min(Math.round(safeCssHeight * safeDpr), Math.max(1, maxDimension)));
  return {
    width,
    height,
    scaleX: width / safeCssWidth,
    scaleY: height / safeCssHeight,
  };
}

/** Additive virtualization config accepted by the visualizers. */
export type VirtualizationOption = boolean | {bufferScreens?: number};

/** Resolved virtualization settings. */
export interface ResolvedVirtualization {
  enabled: boolean;
  bufferScreens: number;
}

/**
 * Resolve the user-facing `virtualization` option.
 *
 * - `undefined` (default): ON when the sequence has more than
 *   {@link DEFAULT_VIRTUALIZATION_THRESHOLD} notes, OFF below — small scores
 *   keep the simple always-mounted DOM, large scores get windowed rendering.
 * - `true` / `false`: force on/off regardless of note count.
 * - `{bufferScreens}`: force ON with a custom buffer (viewports of notes kept
 *   mounted on each side of the visible window; default
 *   {@link DEFAULT_BUFFER_SCREENS}).
 */
export function resolveVirtualization(
  option: VirtualizationOption | undefined,
  noteCount: number,
  threshold: number = DEFAULT_VIRTUALIZATION_THRESHOLD,
): ResolvedVirtualization {
  if (option === false) {
    return {enabled: false, bufferScreens: DEFAULT_BUFFER_SCREENS};
  }
  if (option === true) {
    return {enabled: true, bufferScreens: DEFAULT_BUFFER_SCREENS};
  }
  if (option && typeof option === 'object') {
    const bufferScreens = option.bufferScreens;
    return {
      enabled: true,
      bufferScreens:
        bufferScreens !== undefined && Number.isFinite(bufferScreens) && bufferScreens >= 0
          ? bufferScreens
          : DEFAULT_BUFFER_SCREENS,
    };
  }
  return {enabled: noteCount > threshold, bufferScreens: DEFAULT_BUFFER_SCREENS};
}
