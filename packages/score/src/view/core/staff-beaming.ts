/** Written rhythm supplied by the staff notation projection, in quarter notes. */
export interface StaffBeamEvent {
  readonly onset: number;
  readonly duration: number;
  readonly base: number;
  readonly rest: boolean;
  readonly voice: string;
  readonly staff?: number;
  readonly tupletId?: string;
  readonly beams?: readonly {
    readonly number: number;
    readonly type: 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook';
  }[];
}

export interface StaffBeamMeasure {
  readonly start: number;
  readonly numerator: number;
  readonly denominator: number;
  /** Optional additive grouping, in denominator beats, e.g. [2, 2, 3] for 7/8. */
  readonly beatGroups?: readonly number[];
}

export interface StaffBeamGroup {
  /** Original input indexes, ordered by onset; chord members must be combined first. */
  readonly indices: number[];
  /** Original indexes AFTER which the second and subsequent beams break. */
  readonly secondaryBreaks: number[];
  readonly hooks: {index: number; level: number; direction: 'forward' | 'backward'}[];
}

const EPSILON = 1e-8;
const equal = (a: number, b: number) => Math.abs(a - b) < EPSILON;
type StaffBeamMode = NonNullable<StaffBeamEvent['beams']>[number]['type'];

/**
 * Group one measure's written chords/rests, without modifying or rounding them.
 * Authored primary beams take precedence over automatic metric grouping. Voices
 * and staves stay independent; a cross-measure beam must be handled separately.
 */
export function groupStaffBeams(events: readonly StaffBeamEvent[], measure: StaffBeamMeasure): StaffBeamGroup[] {
  if (!Number.isFinite(measure.start) || !Number.isSafeInteger(measure.numerator) || measure.numerator <= 0 ||
      !Number.isSafeInteger(measure.denominator) || measure.denominator <= 0) return [];
  const unit = 4 / measure.denominator;
  const end = measure.start + measure.numerator * unit;
  const groupAt = metricGroupAt(measure);
  const voices = new Map<string, number[]>();
  events.forEach((event, index) => {
    if (!Number.isFinite(event.onset) || !Number.isFinite(event.duration) || !Number.isFinite(event.base) ||
        event.duration <= 0 || event.base <= 0 || event.onset < measure.start - EPSILON || event.onset >= end - EPSILON) return;
    const key = JSON.stringify([event.voice, event.staff ?? 1]);
    const indices = voices.get(key) ?? [];
    indices.push(index);
    voices.set(key, indices);
  });
  const groups: StaffBeamGroup[] = [];
  for (const indices of voices.values()) {
    indices.sort((a, b) => events[a].onset - events[b].onset || a - b);
    const subdivisions = new Map<number, number>();
    for (const index of indices) {
      const event = events[index];
      const beat = Math.floor(event.onset - measure.start + EPSILON);
      subdivisions.set(beat, Math.min(subdivisions.get(beat) ?? Infinity, event.base));
    }
    let current: number[] = [];
    const finish = () => {
      if (current.filter((index) => !events[index].rest).length > 1) groups.push(describeGroup(events, current, measure));
      current = [];
    };
    for (const index of indices) {
      const event = events[index];
      const mode = primary(event);
      if ((event.rest && !isJoinedMode(mode)) || (!event.rest && event.base >= 1 - EPSILON) || isHook(mode)) {
        finish();
        continue;
      }
      if (current.length) {
        const previous = events[current[current.length - 1]];
        const previousMode = primary(previous);
        const connected = equal(previous.onset + previous.duration, event.onset);
        const explicitJoin = (mode === 'continue' || mode === 'end') && previousMode !== 'end';
        const sameTuplet = !!event.tupletId && event.tupletId === previous.tupletId;
        const offset = event.onset - measure.start;
        const crossedBoundary = groupAt(previous.onset - measure.start) !== groupAt(offset);
        // Simple /4 meters use a shorter group when either adjacent beat
        // contains sixteenths. All-eighth passages retain the broader grouping.
        const onQuarter = equal(offset, Math.round(offset));
        const beat = Math.round(offset);
        const subdivided = measure.denominator === 4 && onQuarter &&
          Math.min(subdivisions.get(beat - 1) ?? Infinity, subdivisions.get(beat) ?? Infinity) < 0.5 - EPSILON;
        const tupletBoundary = event.tupletId !== previous.tupletId && (!!event.tupletId || !!previous.tupletId);
        if (!connected || mode === 'begin' || previousMode === 'end' ||
            (!explicitJoin && (tupletBoundary || (!sameTuplet && (crossedBoundary || subdivided))))) finish();
      }
      current.push(index);
      if (mode === 'end') finish();
    }
    finish();
  }
  return groups.sort((a, b) => events[a.indices[0]].onset - events[b.indices[0]].onset || a.indices[0] - b.indices[0]);
}

function primary(event: StaffBeamEvent): StaffBeamMode | undefined {
  return event.beams?.find((beam) => beam.number === 1)?.type;
}

function isJoinedMode(mode: ReturnType<typeof primary>): boolean {
  return mode === 'begin' || mode === 'continue' || mode === 'end';
}

function isHook(mode: ReturnType<typeof primary>): boolean {
  return mode === 'forward hook' || mode === 'backward hook';
}

function metricGroupAt(measure: StaffBeamMeasure): (offset: number) => number {
  const {numerator, denominator} = measure;
  const supplied = measure.beatGroups;
  let groups: readonly number[];
  if (supplied?.length && supplied.every((count) => Number.isSafeInteger(count) && count > 0) &&
      supplied.reduce((sum, count) => sum + count, 0) === numerator) {
    groups = supplied;
  } else if (denominator === 8 && numerator >= 3 && numerator % 3 === 0) {
    return (offset) => Math.floor((offset + EPSILON) / 1.5);
  } else if (denominator === 8 && (numerator === 5 || numerator === 7)) {
    groups = numerator === 5 ? [3, 2] : [3, 2, 2];
  } else if (denominator === 4 && (numerator === 4 || numerator === 5 || numerator === 6)) {
    groups = numerator === 4 ? [2, 2] : numerator === 5 ? [3, 2] : [3, 3];
  } else {
    return (offset) => Math.floor((offset + EPSILON) * denominator / 4);
  }
  let at = 0;
  const boundaries = groups.slice(0, -1).map((count) => (at += count * 4 / denominator));
  return (offset) => {
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (boundaries[middle] <= offset + EPSILON) low = middle + 1;
      else high = middle;
    }
    return low;
  };
}

function describeGroup(events: readonly StaffBeamEvent[], indices: number[], measure: StaffBeamMeasure): StaffBeamGroup {
  const secondaryBreaks: number[] = [];
  const hooks: StaffBeamGroup['hooks'] = [];
  indices.forEach((index, position) => {
    const event = events[index];
    for (const beam of event.beams ?? []) {
      if (beam.number > 1 && isHook(beam.type)) {
        hooks.push({index, level: beam.number, direction: beam.type === 'forward hook' ? 'forward' : 'backward'});
      }
    }
    if (position === 0) return;
    const previousIndex = indices[position - 1];
    const previous = events[previousIndex];
    const secondary = event.beams?.find((beam) => beam.number === 2)?.type;
    const previousSecondary = previous.beams?.find((beam) => beam.number === 2)?.type;
    const authoredBreak = secondary === 'begin' || previousSecondary === 'end' || isHook(secondary) || isHook(previousSecondary);
    const authoredJoin = secondary === 'continue' || secondary === 'end';
    // Thirty-seconds and shorter retain a primary beam across each eighth,
    // while their secondary beams expose its subdivision. Tuplet subdivisions
    // use written positions derived from that group's actual/written ratio.
    const first = events[indices[0]];
    const ratio = event.tupletId && event.tupletId === first.tupletId ? first.base / first.duration : 1;
    const origin = ratio === 1 ? measure.start : first.onset;
    const eighths = (event.onset - origin) * ratio * 2;
    const automaticBreak = Math.min(previous.base, event.base) <= 0.125 + EPSILON &&
      equal(eighths, Math.round(eighths));
    if (authoredBreak || (!authoredJoin && automaticBreak)) secondaryBreaks.push(previousIndex);
  });
  return {indices, secondaryBreaks, hooks};
}
