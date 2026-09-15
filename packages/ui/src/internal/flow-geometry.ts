/**
 * The arithmetic behind the harmony read-outs: where a band sits on a reel,
 * how far the reel has travelled, and how far a needle has turned. No DOM, no
 * tokens, no theory.
 *
 * It is split out for the reason `internal/pitch-geometry` was: the numbers are
 * the part that has to be right, and they are testable with integers only while
 * nothing here can reach a document. `harmony.ts` stays a DOM module and this
 * one stays a calculator.
 *
 * ## The invariant this module exists to keep
 *
 * A band's box is a pure function of the band's own fields and the axis it sits
 * on — never of `now`. {@link flowBox} takes no position argument, and that is
 * not an oversight: `createAnalysisPlayhead` replaces a lit node's whole
 * `style.cssText` with the idle string stamped at render time, so any per-frame
 * inline write on a band is erased at exactly the moment the band matters. The
 * position lives on the reel's transform ({@link flowShift}) and nowhere else.
 */

/** The material's extent on the lane axis, plus the span the boxes divide by. */
export interface FlowAxis {
  start: number;
  end: number;
  /** `end - start`, floored at a positive number so no box divides by zero. */
  span: number;
}

/** Where one band sits on the reel, as percentages of the reel's own width. */
export interface FlowBox {
  left: number;
  width: number;
}

/** Which side of the now line a band is on. */
export type FlowZone = 'ahead' | 'now' | 'wake';

/** The smallest axis this module will divide by. */
const MIN_SPAN = 1e-6;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Trim a computed percentage so an unchanged box serialises to the same bytes. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * The axis a lane draws on: the caller's own extent when it gave one, and
 * otherwise the material's own bounds.
 *
 * An empty lane still gets a positive span. A zero span is not a smaller lane,
 * it is a division by zero in every box on it, and the shape has to stand up
 * before there is anything to put in it.
 */
export function flowAxis(
  declared: {start?: number; end?: number} | undefined,
  bounds: readonly {start: number; end: number}[],
): FlowAxis {
  let start = finite(declared?.start, Number.POSITIVE_INFINITY);
  let end = finite(declared?.end, Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    for (const entry of bounds) {
      if (Number.isFinite(entry.start)) start = Math.min(start, entry.start);
      if (Number.isFinite(entry.end)) end = Math.max(end, entry.end);
    }
  }
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end) || end <= start) end = start + 1;
  return {start, end, span: Math.max(end - start, MIN_SPAN)};
}

/**
 * One band's box, as percentages of the reel.
 *
 * Percentages rather than pixels so that a zoom, a resize or a density change
 * is ONE style write on the reel and every band follows for free — the same
 * bargain `mountTimeline` makes with its regions. A band narrower than a hair
 * still gets a hair: a zero-width band is a chord that happened and cannot be
 * seen to have happened.
 */
export function flowBox(band: {start: number; end: number}, axis: FlowAxis): FlowBox {
  const start = finite(band.start, axis.start);
  const end = finite(band.end, start);
  const left = ((start - axis.start) / axis.span) * 100;
  const width = ((Math.max(end, start) - start) / axis.span) * 100;
  return {left: round(left), width: round(Math.max(width, 0.05))};
}

/**
 * How far the reel is translated, in pixels.
 *
 * `anchor * width` is where the now line is pinned and `now * pxPerUnit` is how
 * far the material has run, so the difference is the offset that keeps the
 * sounding instant under the line. The line does not move. That asymmetry is
 * the whole design: two thirds of the viewport is the future, and seeing the
 * next chord approach is the only reason to prefer this over a map.
 */
export function flowShift(
  now: number,
  axis: FlowAxis,
  pxPerUnit: number,
  anchor: number,
  width: number,
): number {
  const position = finite(now, axis.start);
  const scale = Math.max(finite(pxPerUnit, 1), 0);
  const at = Math.max(finite(width, 0), 0) * Math.max(0, Math.min(1, finite(anchor, 0.33)));
  return round(at - (position - axis.start) * scale);
}

/**
 * Which side of the now line a band is on.
 *
 * Half-open, and the same half-open interval `readAnalysisSpans` compares with:
 * a band ends exactly where the next one starts, and a closed interval would
 * light both of them for one instant on every chord change.
 */
export function flowZone(now: number, band: {start: number; end: number}): FlowZone {
  const position = finite(now, 0);
  const start = finite(band.start, 0);
  const end = finite(band.end, start);
  if (position < start) return 'ahead';
  if (position < end) return 'now';
  return 'wake';
}

/**
 * Every edge a band has, sorted and de-duplicated.
 *
 * The lane keeps this so it can ask ONE question per frame — "did anything get
 * crossed since the last frame?" — instead of asking every band whether its
 * zone changed. A frame that crossed nothing does no work at all, which is what
 * makes a two-thousand-band lane cost the same as a four-band one while the
 * material between two chords goes past.
 */
export function flowBoundaries(bands: readonly {start: number; end: number}[]): number[] {
  const edges = new Set<number>();
  for (const band of bands) {
    if (Number.isFinite(band.start)) edges.add(band.start);
    if (Number.isFinite(band.end)) edges.add(band.end);
  }
  return [...edges].sort((a, b) => a - b);
}

/**
 * The index of the first edge strictly above `value`, by bisection.
 *
 * Bisection rather than a scan because the two callers below are asked on every
 * frame, and a scan from index 0 costs more the further into the piece the
 * material has run — the one shape of slowness that gets worse exactly as a
 * listener gets further in.
 */
function firstAbove(boundaries: readonly number[], value: number): number {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (boundaries[middle]! > value) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Whether the move from `from` to `to` passed any of those edges. */
export function flowCrossed(boundaries: readonly number[], from: number, to: number): boolean {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return true;
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  if (low === high) return false;
  const edge = boundaries[firstAbove(boundaries, low)];
  return edge !== undefined && edge <= high;
}

/**
 * The nearest band edge strictly beyond `from`, in the given direction.
 *
 * This is the navigation a list cannot offer: `[` and `]` walk the HARMONY, not
 * the clock, so a listener steps to the next chord rather than to a point four
 * seconds later that may be in the middle of one.
 */
export function flowBoundaryFrom(
  boundaries: readonly number[],
  from: number,
  direction: 1 | -1,
): number | undefined {
  const position = finite(from, 0);
  if (direction > 0) return boundaries[firstAbove(boundaries, position + MIN_SPAN)];
  const above = firstAbove(boundaries, position - MIN_SPAN);
  return above > 0 ? boundaries[above - 1] : undefined;
}

// ---------------------------------------------------------------------------
// The wheel.
// ---------------------------------------------------------------------------

/** A point on a circle, with 0 degrees at twelve o'clock and clockwise positive. */
export function wheelPoint(
  centre: number,
  radius: number,
  degrees: number,
): {x: number; y: number} {
  const radians = ((finite(degrees, 0) - 90) * Math.PI) / 180;
  return {
    x: round(centre + radius * Math.cos(radians)),
    y: round(centre + radius * Math.sin(radians)),
  };
}

/**
 * One ring sector as an SVG path: an annulus segment, drawn clockwise on the
 * outer edge and back anticlockwise on the inner one.
 *
 * The count is the caller's — five segments is as valid as twelve, and a wheel
 * that assumed twelve would be a wheel that knows what it is drawing.
 */
export function wheelSector(
  centre: number,
  outer: number,
  inner: number,
  from: number,
  to: number,
): string {
  const start = wheelPoint(centre, outer, from);
  const end = wheelPoint(centre, outer, to);
  const innerEnd = wheelPoint(centre, inner, to);
  const innerStart = wheelPoint(centre, inner, from);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return [
    `M${start.x} ${start.y}`,
    `A${outer} ${outer} 0 ${large} 1 ${end.x} ${end.y}`,
    `L${innerEnd.x} ${innerEnd.y}`,
    `A${inner} ${inner} 0 ${large} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

/**
 * The needle's angle, accumulated rather than absolute.
 *
 * Segment 11 to segment 0 is **plus one segment**, not minus eleven. A wheel
 * that writes the absolute angle takes the long way round on every wrap and
 * reads as the key lurching backwards through ten unrelated keys — arithmetic
 * that is obvious once seen and invisible until it is.
 */
export function unwrapAngle(previous: number, target: number): number {
  const from = finite(previous, 0);
  const to = finite(target, 0);
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return round(from + delta);
}

/**
 * Resolve a caller's segment reference — an id, or a fractional index — to an
 * index. A fraction is how "between the second and the third" is said without
 * the caller ever writing a number of degrees; degrees are this module's
 * business, not the caller's.
 */
export function segmentIndexOf(
  at: string | number | undefined,
  ids: readonly string[],
): number | undefined {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at !== 'string') return undefined;
  const index = ids.indexOf(at);
  return index >= 0 ? index : undefined;
}
