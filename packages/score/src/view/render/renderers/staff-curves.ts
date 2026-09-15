export type StaffCurveSide = 'above' | 'below';
export type StaffStemDirection = 'up' | 'down';
export interface StaffCurvePoint {x: number; y: number}
export interface StaffCurveBounds {left: number; right: number; top: number; bottom: number}
export interface StaffCurveObstacle extends StaffCurveBounds {
  kind?: 'note' | 'stem' | 'beam' | 'tuplet' | 'curve';
}
export interface StaffCurveAnchor {
  /** Chord head union for a slur; individual notehead for a tie. */
  head: StaffCurveBounds;
  stem?: {x: number; tipY: number};
  stemDirection?: StaffStemDirection;
  /** Outside of this voice when more than one voice shares the staff. */
  voiceSide?: StaffCurveSide;
  chordPosition?: 'top' | 'bottom' | 'inner';
}
export interface StaffCurveRequest {
  kind: 'tie' | 'slur';
  start: StaffCurveAnchor;
  end: StaffCurveAnchor;
  /** All coordinates use the same unscaled SVG units. */
  space: number;
  placement?: StaffCurveSide;
  /** Interior stem directions, used for automatic mixed-stem slurs. */
  stemDirections?: readonly StaffStemDirection[];
  /** Tight ink bounds only. Do not include staff lines or barlines. */
  obstacles?: readonly StaffCurveObstacle[];
  staffLines?: readonly number[];
}
export interface StaffCurveLayout {
  start: StaffCurvePoint;
  control1: StaffCurvePoint;
  control2: StaffCurvePoint;
  end: StaffCurvePoint;
  side: StaffCurveSide;
  /** Closed tapered ribbon. Fill this path; do not add a uniform-width stroke. */
  path: string;
  bounds: StaffCurveBounds;
  /** Narrow conservative strips suitable as obstacles for the next curve. */
  obstacles: StaffCurveObstacle[];
}

export interface StaffCurveEvent {
  /** Unique for this drawn source-note fragment. */
  id: string;
  sourceId?: string;
  /** Slur numbers are scoped to a Part, including all of its staves. */
  part?: string;
  voice: string;
  staff?: number;
  onset: number;
  end: number;
  /** Written step/alter/octave identity. Omit for rests. */
  pitch?: string;
  tie?: 'start' | 'stop' | 'continue';
  tiePlacement?: StaffCurveSide;
  slurs?: readonly {type: 'start' | 'stop' | 'continue'; number?: number; placement?: StaffCurveSide}[];
  continuedFromPrevious?: boolean;
  continuesToNext?: boolean;
}
export interface StaffCurveConnection {
  kind: 'tie' | 'slur';
  startId: string;
  endId: string;
  placement?: StaffCurveSide;
  number?: number;
}

const EPSILON = 1e-8;
const finite = (value: number) => Number.isFinite(value);
const validBounds = (box: StaffCurveBounds) => [box.left, box.right, box.top, box.bottom].every(finite) &&
  box.left <= box.right && box.top <= box.bottom;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Tight vertical strips for a filled, straight-edged beam polygon in SVG units. */
export function staffBeamInk(points: readonly StaffCurvePoint[], space = 10): StaffCurveObstacle[] {
  if (points.length < 3 || !(finite(space) && space > 0) || points.some((point) => !finite(point.x) || !finite(point.y))) return [];
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (right <= left || Math.abs(area) < EPSILON) return [];
  const count = Math.min(512, Math.max(1, Math.ceil((right - left) / (space * 0.5))));
  const strips: StaffCurveObstacle[] = [];
  for (let index = 0; index < count; index += 1) {
    const x0 = left + (right - left) * index / count;
    const x1 = left + (right - left) * (index + 1) / count;
    const ys: number[] = [];
    points.forEach((point, pointIndex) => {
      const next = points[(pointIndex + 1) % points.length];
      if (point.x >= x0 && point.x <= x1) ys.push(point.y);
      if (next.x === point.x) return;
      for (const x of [x0, x1]) {
        const t = (x - point.x) / (next.x - point.x);
        if (t >= 0 && t <= 1) ys.push(point.y + t * (next.y - point.y));
      }
    });
    if (ys.length) strips.push({left: x0, right: x1, top: Math.min(...ys), bottom: Math.max(...ys), kind: 'beam'});
  }
  return strips;
}

/** Match source relationships before choosing visual endpoints. No pitch-based slur guessing. */
export function pairStaffCurves(events: readonly StaffCurveEvent[]): StaffCurveConnection[] {
  const ordered = events.filter((event) => finite(event.onset) && finite(event.end) && event.end >= event.onset)
    .map((event, order) => ({event, order})).sort((a, b) => a.event.onset - b.event.onset || a.order - b.order);
  const ties = new Map<string, StaffCurveEvent>();
  const slurs = new Map<string, Map<string, Array<{event: StaffCurveEvent; placement?: StaffCurveSide}>>>();
  const connections: Array<StaffCurveConnection & {onset: number; span: number}> = [];
  const connect = (kind: 'tie' | 'slur', first: StaffCurveEvent, last: StaffCurveEvent, placement?: StaffCurveSide, number?: number) => {
    if (first.id === last.id || last.onset <= first.onset + EPSILON) return;
    connections.push({kind, startId: first.id, endId: last.id, placement, number, onset: first.onset, span: last.onset - first.onset});
  };
  for (const {event} of ordered) {
    if (event.pitch !== undefined) {
      const key = JSON.stringify([event.part ?? '', event.staff ?? 1, event.voice, event.pitch]);
      const first = ties.get(key);
      const endsTie = event.continuedFromPrevious || event.tie === 'stop' || event.tie === 'continue';
      if (first && endsTie && Math.abs(first.end - event.onset) <= EPSILON) {
        const sameFragment = !event.continuedFromPrevious || !first.sourceId || !event.sourceId || first.sourceId === event.sourceId;
        if (sameFragment) connect('tie', first, event, first.tiePlacement ?? event.tiePlacement);
      }
      if (event.continuesToNext || event.tie === 'start' || event.tie === 'continue') ties.set(key, event);
      else ties.delete(key);
    }
    // A close followed by a new start on the same note denotes two slurs.
    const marks = [...event.slurs ?? []].sort((a, b) => (a.type === 'start' ? 1 : 0) - (b.type === 'start' ? 1 : 0));
    for (const mark of marks) {
      if ((event.continuedFromPrevious && mark.type === 'start') || (event.continuesToNext && mark.type === 'stop')) continue;
      const key = JSON.stringify([event.part ?? '', mark.number ?? 1]);
      let open = slurs.get(key);
      if (!open) slurs.set(key, open = new Map());
      const channel = JSON.stringify([event.staff ?? 1, event.voice]);
      if (mark.type === 'start') {
        // A voice may change staff inside a Part. Reusing its number starts a
        // new relationship; do not leave its older, unmatched start behind.
        // Other voices can reuse a number in non-overlapping XML document
        // order even when their musical-time spans overlap.
        for (const [id, previous] of open) {
          if (previous[0].event.voice === event.voice && previous[0].event.onset < event.onset - EPSILON) open.delete(id);
        }
        const previous = open.get(channel);
        const first = previous?.[0].event;
        const sameSource = first && (first.sourceId ?? first.id) === (event.sourceId ?? event.id) && Math.abs(first.onset - event.onset) <= EPSILON;
        // Some source files attach multiple starts with the same number to one
        // note. Preserve exactly that multiplicity: each later stop consumes
        // one authored start, without inventing another relationship.
        const starts = sameSource ? previous! : [];
        starts.push({event, placement: mark.placement});
        open.set(channel, starts);
        continue;
      }
      const candidates = [...open.entries()];
      const sameVoice = candidates.filter(([, starts]) => starts[0].event.voice === event.voice);
      const sameStaff = candidates.filter(([, starts]) => (starts[0].event.staff ?? 1) === (event.staff ?? 1));
      const matches = open.has(channel) ? [[channel, open.get(channel)!] as const]
        : sameVoice.length ? sameVoice : sameStaff.length ? sameStaff : candidates;
      const match = matches.length === 1 ? matches[0] : undefined;
      // MusicXML continuation marks describe the same slur. They do not create
      // a new tail, and cannot start an otherwise unmatched connection.
      if (mark.type === 'continue') continue;
      if (!match) {
        // An ambiguous close is not permission to attach an old start to a
        // later reuse of the same number. Drop the unresolved candidates.
        for (const [id] of matches) open.delete(id);
        continue;
      }
      const [id, starts] = match;
      const first = starts.shift()!;
      connect('slur', first.event, event, first.placement ?? mark.placement, mark.number ?? 1);
      if (!starts.length) open.delete(id);
    }
  }
  // Draw ties and shorter/nested arcs first so outer slurs can avoid their ink.
  return connections.sort((a, b) => (a.kind === 'tie' ? 0 : 1) - (b.kind === 'tie' ? 0 : 1) || a.span - b.span || a.onset - b.onset)
    .map(({kind, startId, endId, placement, number}) => ({kind, startId, endId, placement, number}));
}

/**
 * Independent engraving geometry: tapered, monotone-x cubics with bounded
 * clearance solving. Obstacle intervals are checked at their endpoints and
 * every vertical extremum, so thin stems cannot fall between sample points.
 */
export function layoutStaffCurve(request: StaffCurveRequest): StaffCurveLayout | undefined {
  const {start: first, end: last, space, kind} = request;
  if (!(finite(space) && space > 0) || !validBounds(first.head) || !validBounds(last.head)) return undefined;
  const side = chooseSide(request);
  const sign = side === 'above' ? -1 : 1;
  const start = endpoint(first, true, kind, sign, space);
  const end = endpoint(last, false, kind, sign, space);
  const span = end.x - start.x;
  if (!(finite(span) && span > space * 0.2) || ![start.x, start.y, end.x, end.y].every(finite)) return undefined;
  const thickness = space * (kind === 'tie' ? 0.12 : 0.15);
  const clearance = space * (kind === 'tie' ? 0.22 : 0.35) + thickness / 2;
  const ink = (request.obstacles ?? []).filter((box) => validBounds(box) && box.right >= start.x && box.left <= end.x);
  const lengthHeight = kind === 'tie' ? space * clamp(0.7 + Math.sqrt(span / space) * 0.34, 0.8, 2.6)
    : space * clamp(1.1 + Math.log1p(span / space) * 0.62, 1.3, 4.8);
  const defaultHeight = Math.min(lengthHeight, Math.max(space * 0.22, span * 0.45));
  const maxHeight = Math.max(defaultHeight, Math.min(span * 0.7, space * 9));
  let h1 = defaultHeight;
  let h2 = defaultHeight;
  const controls = () => ({
    control1: {x: start.x + span / 3, y: start.y + (end.y - start.y) / 3 + sign * h1},
    control2: {x: start.x + span * 2 / 3, y: start.y + (end.y - start.y) * 2 / 3 + sign * h2},
  });
  const moveEndpointsOffLines = () => {
    for (const point of [start, end]) {
      for (const line of request.staffLines ?? []) {
        if (finite(line) && Math.abs(point.y - line) < space * 0.14) point.y = line + sign * space * 0.14;
      }
    }
  };
  moveEndpointsOffLines();
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (const box of ink) {
      const left = clamp((box.left - space * 0.12 - start.x) / span, 0, 1);
      const right = clamp((box.right + space * 0.12 - start.x) / span, 0, 1);
      const target = sign * (side === 'above' ? box.top : box.bottom) + clearance;
      const {control1, control2} = controls();
      const values = [start.y, control1.y, control2.y, end.y];
      const points = extremaParameters(values, left, right);
      let worst = {gap: 0, t: 0};
      for (const t of points) {
        const gap = target - sign * cubic(values, t);
        if (gap > worst.gap) worst = {gap, t};
      }
      if (worst.gap < 0.001) continue;
      changed = true;
      const {t} = worst;
      const gap = worst.gap + space * 0.025;
      if (t < 0.15) {
        start.y += sign * gap / Math.max(0.1, 1 - t);
      } else if (t > 0.85) {
        end.y += sign * gap / Math.max(0.1, t);
      } else {
        const b1 = 3 * t * (1 - t) ** 2;
        const b2 = 3 * t ** 2 * (1 - t);
        const leftWeight = t <= 0.5 ? 1 : 0.45;
        const rightWeight = t >= 0.5 ? 1 : 0.45;
        const raise = gap / (b1 * leftWeight + b2 * rightWeight);
        const nextH1 = Math.min(maxHeight, h1 + raise * leftWeight);
        const nextH2 = Math.min(maxHeight, h2 + raise * rightWeight);
        const remaining = Math.max(0, gap - (nextH1 - h1) * b1 - (nextH2 - h2) * b2);
        h1 = nextH1; h2 = nextH2;
        // When shape-only adjustment would form a very tall arch, move both
        // attachments outward instead. The curve remains a regular arch.
        start.y += sign * remaining;
        end.y += sign * remaining;
      }
    }
    moveEndpointsOffLines();
    if (!changed) break;
  }
  const {control1, control2} = controls();
  const offset = sign * thickness * 2 / 3;
  const path = `M ${start.x} ${start.y} C ${control1.x} ${control1.y + offset} ${control2.x} ${control2.y + offset} ${end.x} ${end.y}` +
    ` C ${control2.x} ${control2.y - offset} ${control1.x} ${control1.y - offset} ${start.x} ${start.y} Z`;
  const obstacles: StaffCurveObstacle[] = [];
  const values = [start.y, control1.y, control2.y, end.y];
  const pieces = Math.min(128, Math.max(12, Math.ceil(span / (space * 1.5))));
  for (let index = 0; index < pieces; index += 1) {
    const left = index / pieces;
    const right = (index + 1) / pieces;
    const ys = extremaParameters(values, left, right).map((t) => cubic(values, t));
    obstacles.push({left: start.x + span * left, right: start.x + span * right,
      top: Math.min(...ys) - thickness / 2, bottom: Math.max(...ys) + thickness / 2, kind: 'curve'});
  }
  return {start, control1, control2, end, side, path, obstacles,
    bounds: {left: start.x, right: end.x, top: Math.min(...obstacles.map((box) => box.top)), bottom: Math.max(...obstacles.map((box) => box.bottom))}};
}

function chooseSide(request: StaffCurveRequest): StaffCurveSide {
  if (request.placement) return request.placement;
  if (request.start.voiceSide || request.end.voiceSide) return request.start.voiceSide ?? request.end.voiceSide!;
  if (request.kind === 'tie') {
    if (request.start.chordPosition === 'top') return 'above';
    if (request.start.chordPosition === 'bottom') return 'below';
  }
  const stems = [request.start.stemDirection, request.end.stemDirection, ...request.stemDirections ?? []];
  if (stems.includes('up') && stems.includes('down')) return 'above';
  return request.start.stemDirection === 'up' ? 'below' : 'above';
}

function endpoint(anchor: StaffCurveAnchor, first: boolean, kind: 'tie' | 'slur', sign: number, space: number): StaffCurvePoint {
  const {head} = anchor;
  if (kind === 'tie') return {
    x: first ? head.right + space * 0.13 : head.left - space * 0.13,
    y: (sign < 0 ? head.top : head.bottom) + sign * space * 0.16,
  };
  const stemSide = (sign < 0 && anchor.stemDirection === 'up') || (sign > 0 && anchor.stemDirection === 'down');
  if (stemSide && anchor.stem && finite(anchor.stem.x) && finite(anchor.stem.tipY)) return {
    x: anchor.stem.x + (first ? 1 : -1) * space * 0.2,
    y: anchor.stem.tipY + sign * space * 0.3,
  };
  return {x: (head.left + head.right) / 2 + (first ? 1 : -1) * space * 0.1,
    y: (sign < 0 ? head.top : head.bottom) + sign * space * 0.3};
}

function cubic(values: readonly number[], t: number): number {
  const u = 1 - t;
  return u ** 3 * values[0] + 3 * u ** 2 * t * values[1] + 3 * u * t ** 2 * values[2] + t ** 3 * values[3];
}

function extremaParameters(values: readonly number[], left: number, right: number): number[] {
  const [p0, p1, p2, p3] = values;
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const result = [left, right];
  const add = (value: number) => { if (value > left && value < right) result.push(value); };
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) >= 1e-12) add(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      add((-b - root) / (2 * a)); add((-b + root) / (2 * a));
    }
  }
  return result;
}
