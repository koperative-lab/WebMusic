import {
  Duration, Rational,
  type Clef, type KeySignature, type Measure, type Note, type Part, type PartClefChange,
  type PartDirection, type Score, type TimeSignature,
} from '../../core';

export interface StaffNotationOptions {
  instruments?: readonly number[];
  splitStaves?: boolean;
  /** Chromatic major-key index (C = 0), used only before a source key signature. */
  defaultKey?: number;
}

export interface StaffNotationDiagnostic {
  code: 'invalid-measure' | 'measure-limit' | 'mid-measure-meter' | 'unsupported-duration' | 'outside-measures';
  message: string;
  note?: Note;
  measure?: Measure;
}

export interface StaffNotationMeasure {
  index: number;
  source?: Measure;
  number: number;
  startQuarters: Rational;
  endQuarters: Rational;
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  synthetic: boolean;
}

export interface StaffNotationEvent {
  /** Original immutable model objects, including rests and hidden notes. */
  notes: readonly Note[];
  onsetQuarters: Rational;
  duration: Duration;
  rest: boolean;
  /** This fragment continues another fragment of the same source notes. */
  continuedFromPrevious: boolean;
  continuesToNext: boolean;
  /** Effective written clef at this fragment's onset, including timed changes. */
  clef: Clef;
}

type RhythmEvent = Omit<StaffNotationEvent, 'clef'>;

export interface StaffNotationClefChange {
  onsetQuarters: Rational;
  clef: Clef;
  /** Present for an authored, part-local timed clef; never mutate it. */
  source?: PartClefChange;
  inferred: boolean;
}

export interface StaffNotationVoice {
  /** Source voice identifier; never coerced to a number. */
  id: string;
  events: readonly StaffNotationEvent[];
}

export interface StaffNotationLayerMeasure {
  measure: StaffNotationMeasure;
  clef: Clef;
  /** Changes strictly inside this measure; the final endpoint is retained. */
  clefChanges: readonly StaffNotationClefChange[];
  directions: readonly PartDirection[];
  voices: readonly StaffNotationVoice[];
}

export interface StaffNotationLayer {
  partIndex: number;
  part: Part;
  staff: number;
  notes: readonly Note[];
  /** Complete ordered clef state, including the initial clef at quarter zero. */
  clefChanges: readonly StaffNotationClefChange[];
  /** Complete source direction stream for pairing spans across measures. */
  directions: readonly PartDirection[];
  measures: readonly StaffNotationLayerMeasure[];
}

export interface StaffNotationProjection {
  measures: readonly StaffNotationMeasure[];
  layers: readonly StaffNotationLayer[];
  diagnostics: readonly StaffNotationDiagnostic[];
}

const MAX_MEASURES = 16384;
const MAX_DURATION_FRAGMENTS = 256;
const DEFAULT_METER: TimeSignature = Object.freeze({numerator: 4, denominator: 4});
const KEY_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const DURATION_BASES = [8, 4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64];

/**
 * Exact written-time projection. Playback seconds and sounding transposition
 * do not participate in notation: source pitches, voices and spelling survive.
 */
export function projectStaffNotation(score: Score, options: StaffNotationOptions = {}): StaffNotationProjection {
  const diagnostics: StaffNotationDiagnostic[] = [];
  const measures = measureGrid(score, options.defaultKey, diagnostics);
  const layers: StaffNotationLayer[] = [];
  score.parts.forEach((part, partIndex) => {
    if (options.instruments?.length && !options.instruments.includes(partIndex)) return;
    const byStaff = new Map<number, Note[]>();
    // Keep explicitly declared empty staves: an all-rest voice still belongs
    // in a grand staff, and silence does not erase source structure.
    const count = options.splitStaves === false ? 1 : Math.max(1, part.staves ?? 1);
    for (let staff = 1; staff <= count; staff += 1) byStaff.set(staff, []);
    if (options.splitStaves !== false) {
      for (const change of part.clefChanges ?? []) if (!byStaff.has(change.staff)) byStaff.set(change.staff, []);
      for (const direction of part.directions ?? []) if (!byStaff.has(direction.staff ?? 1)) byStaff.set(direction.staff ?? 1, []);
    }
    for (const note of part.notes) {
      const staff = options.splitStaves === false ? 1 : note.staff ?? (
        (part.staves ?? 1) > 1 && !note.rest && note.pitch.midi < 60 ? 2 : 1
      );
      let notes = byStaff.get(staff);
      if (!notes) byStaff.set(staff, notes = []);
      notes.push(note);
    }
    for (const [staff, notes] of [...byStaff].sort(([a], [b]) => a - b)) {
      const voiceMaps = measures.map(() => new Map<string, RhythmEvent[]>());
      for (const event of chordEvents(notes)) distributeEvent(event, measures, voiceMaps, diagnostics);
      const clefChanges = layerClefs(part, notes, measures, staff, count);
      const directions = (part.directions ?? []).filter((direction) => options.splitStaves === false || (direction.staff ?? 1) === staff);
      const directionsByMeasure = measures.map(() => [] as PartDirection[]);
      for (const direction of directions) {
        const index = notationMeasureIndex(measures, direction.onsetQuarters);
        if (index >= 0) directionsByMeasure[index].push(direction);
      }
      const layerMeasures = measures.map((measure, index): StaffNotationLayerMeasure => {
        return {
          measure, clef: clefAt(clefChanges, measure.startQuarters),
          clefChanges: clefChanges.filter((change) => change.onsetQuarters.gt(measure.startQuarters) &&
            (change.onsetQuarters.lt(measure.endQuarters) || index === measures.length - 1 && change.onsetQuarters.eq(measure.endQuarters))),
          directions: directionsByMeasure[index],
          voices: [...voiceMaps[index]].map(([id, events]) => ({
            id, events: events.sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters)).map((event) => ({
              ...event, clef: clefAt(clefChanges, event.onsetQuarters),
            })),
          })),
        };
      });
      layers.push({partIndex, part, staff, notes, clefChanges, directions, measures: layerMeasures});
    }
  });
  return {measures, layers, diagnostics};
}

function measureGrid(score: Score, defaultKey: number | undefined, diagnostics: StaffNotationDiagnostic[]): StaffNotationMeasure[] {
  const measures: StaffNotationMeasure[] = [];
  const meters = score.timeMap.meters;
  let meterIndex = 0;
  let meter = DEFAULT_METER;
  let key: KeySignature = {fifths: KEY_FIFTHS[((Math.round(defaultKey ?? 0) % 12) + 12) % 12] ?? 0};
  let cursor = Rational.ZERO;
  let notationEnd = score.durationQuarters;
  for (const part of score.parts) for (const mark of [...part.clefChanges ?? [], ...part.directions ?? []]) {
    if (mark.onsetQuarters.gt(notationEnd)) notationEnd = mark.onsetQuarters;
  }
  let number = score.measures[0]?.number ?? 1;
  const meterAt = (position: Rational): TimeSignature => {
    while (meterIndex < meters.length && meters[meterIndex].atQuarters.lte(position)) {
      meter = meters[meterIndex++].timeSignature;
    }
    return meter;
  };
  const append = (end: Rational, source?: Measure) => {
    const currentMeter = meterAt(cursor);
    if (source?.keySignature) key = source.keySignature;
    measures.push({
      index: measures.length, source, number: source?.number ?? number,
      startQuarters: cursor, endQuarters: end, timeSignature: currentMeter,
      keySignature: key, synthetic: !source,
    });
    number = (source?.number ?? number) + 1;
    cursor = end;
  };
  const fillUntil = (end: Rational, padLast: boolean) => {
    while (cursor.lt(end) && measures.length < MAX_MEASURES) {
      const currentMeter = meterAt(cursor);
      let next = cursor.add(new Rational(4 * currentMeter.numerator, currentMeter.denominator));
      const nextMeter = meters[meterIndex]?.atQuarters;
      if (nextMeter?.lt(next)) next = nextMeter;
      if (!padLast && end.lt(next)) next = end;
      append(next);
    }
  };
  for (const source of score.measures) {
    if (measures.length >= MAX_MEASURES) break;
    if (source.onsetQuarters.lt(cursor) || !source.durationQuarters.gt(Rational.ZERO)) {
      diagnostics.push({code: 'invalid-measure', measure: source,
        message: `Measure ${source.number} overlaps an earlier measure or has no positive duration.`});
      continue;
    }
    fillUntil(source.onsetQuarters, false);
    if (measures.length >= MAX_MEASURES) break;
    meterAt(cursor);
    // Direct Score construction can provide measure metadata without a
    // matching TimeMap event. At a shared position the canonical map wins.
    if (source.timeSignature && !meters[meterIndex - 1]?.atQuarters.eq(cursor)) meter = source.timeSignature;
    const nextMeter = meters[meterIndex]?.atQuarters;
    if (nextMeter?.lt(source.offsetQuarters)) diagnostics.push({
      code: 'mid-measure-meter', measure: source,
      message: `Measure ${source.number} contains a meter change inside its source boundary.`,
    });
    append(source.offsetQuarters, source);
  }
  fillUntil(notationEnd, true);
  // An empty part still needs one initial stave and its signatures.
  if (!measures.length) append(new Rational(4 * meterAt(Rational.ZERO).numerator, meter.denominator));
  if (cursor.lt(notationEnd)) diagnostics.push({code: 'measure-limit',
    message: `Staff projection stops after ${MAX_MEASURES} measures; later notation remains in the source Score.`});
  return measures;
}

function inferClef(notes: readonly Note[], staff: number, count: number): Clef {
  if (count > 1) return staff > 1 ? {sign: 'F', line: 4} : {sign: 'G', line: 2};
  const pitches = notes.filter((note) => !note.rest).map((note) => note.pitch.midi);
  const average = pitches.length ? pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length : 60;
  return average < 60 ? {sign: 'F', line: 4} : {sign: 'G', line: 2};
}

function layerClefs(
  part: Part, notes: readonly Note[], measures: readonly StaffNotationMeasure[], staff: number, count: number,
): readonly StaffNotationClefChange[] {
  // A part-local stream is authoritative even when empty. The legacy global
  // measure shorthand must not leak another part's clef into that stream.
  const authored: StaffNotationClefChange[] = part.clefChanges !== undefined
    ? part.clefChanges.filter((change) => change.staff === staff).map((source) => ({
      onsetQuarters: source.onsetQuarters, clef: source.clef, source, inferred: false,
    }))
    : measures.flatMap((measure) => {
      const clef = measure.source?.clefs?.[staff] ?? (staff === 1 ? measure.source?.clef : undefined);
      return clef ? [{onsetQuarters: measure.startQuarters, clef, inferred: false}] : [];
    });
  if (!authored.length) return inferStaffClefChanges(notes, inferClef(notes, staff, count));
  const ordered = [...authored].sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
  if (!ordered[0].onsetQuarters.eq(Rational.ZERO)) ordered.unshift({
    onsetQuarters: Rational.ZERO,
    clef: inferClef(notes.filter((note) => note.onsetQuarters.lt(ordered[0].onsetQuarters)), staff, count),
    inferred: true,
  });
  return ordered;
}

function clefAt(changes: readonly StaffNotationClefChange[], at: Rational): Clef {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (changes[mid].onsetQuarters.lte(at)) low = mid + 1;
    else high = mid;
  }
  return changes[Math.max(0, low - 1)].clef;
}

function notationMeasureIndex(measures: readonly StaffNotationMeasure[], at: Rational): number {
  let low = 0;
  let high = measures.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (measures[mid].endQuarters.lte(at)) low = mid + 1;
    else high = mid;
  }
  if (low === measures.length) return measures[low - 1]?.endQuarters.eq(at) ? low - 1 : -1;
  return at.gte(measures[low].startQuarters) ? low : -1;
}

interface ClefFrame {
  onset: Rational;
  end: Rational;
  notes: Note[];
  cost: readonly [number, number];
}

/**
 * Infer clefs only for notation with no authored clef map. A two-state path
 * minimizes duration-weighted ledger-line cost plus a change penalty. A
 * change also needs a sustained register preference at a safe boundary:
 * isolated high/low notes cannot make the clef oscillate. This independent
 * policy is deliberately smaller than MuseScore's MIDI import algorithm.
 */
export function inferStaffClefChanges(
  notes: readonly Note[], preferred: Clef = {sign: 'G', line: 2},
): readonly StaffNotationClefChange[] {
  const frames: ClefFrame[] = [];
  for (const note of [...notes].sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters))) {
    if (note.rest || note.unpitched || note.grace || note.printObject === false) continue;
    const previous = frames[frames.length - 1];
    if (previous?.onset.eq(note.onsetQuarters)) {
      previous.notes.push(note);
      if (note.offsetQuarters.gt(previous.end)) previous.end = note.offsetQuarters;
    } else frames.push({onset: note.onsetQuarters, end: note.offsetQuarters, notes: [note], cost: [0, 0]});
  }
  if (!frames.length) return [{onsetQuarters: Rational.ZERO, clef: preferred, inferred: true}];
  const stepIndex: Record<string, number> = {C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6};
  for (const frame of frames) frame.cost = [0, 1].map((index) => frame.notes.reduce((sum, note) => {
    const pitch = note.pitch.octave * 7 + stepIndex[note.pitch.step];
    const bottom = index === 0 ? 30 : 18; // E4–F5 (G clef), G2–A3 (F clef).
    const ledgers = Math.floor(Math.max(0, bottom - pitch, pitch - bottom - 8) / 2);
    // Bound an isolated extreme so it cannot outweigh an otherwise stable
    // register for the entire phrase merely by being arbitrarily far away.
    const cost = Math.min(6, ledgers) ** 2;
    return sum + cost * Math.max(.25, Math.min(2, note.duration.quarters.toFloat()));
  }, 0)) as [number, number];
  const path = new Uint8Array(frames.length * 2);
  let costs = [frames[0].cost[0], frames[0].cost[1]];
  costs[preferred.sign === 'F' ? 0 : 1] += .01;
  let activeEnd = frames[0].end;
  const changePenalty = 8;
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    const hasGap = frame.onset.sub(previous.end).gte(Rational.ONE);
    const boundary = (frame.onset.den === 1 || hasGap) && frame.onset.gte(activeEnd);
    const protectedPhrase = frame.notes.some((note) => note.tie === 'stop' || note.tie === 'continue' ||
      note.beams?.some((beam) => beam.type === 'continue' || beam.type === 'end') ||
      previous.notes.some((prior) => note.tupletId && note.tupletId === prior.tupletId ||
        !note.tupletId && note.duration.tuplet[0] !== note.duration.tuplet[1] &&
        prior.duration.tuplet[0] === note.duration.tuplet[0] && prior.duration.tuplet[1] === note.duration.tuplet[1] &&
        prior.offsetQuarters.eq(frame.onset)));
    const nextCosts = [0, 0];
    for (const clef of [0, 1]) {
      const other = 1 - clef;
      let advantage = 0;
      let stableCount = 0;
      let stableEnd = frame.onset;
      // At most eight future onset groups participate in the stability
      // decision, independent of score length or the size of a dense chord.
      for (let look = index; look < Math.min(frames.length, index + 8); look += 1) {
        const candidate = frames[look];
        if (candidate.onset.sub(frame.onset).gte(new Rational(2))) break;
        const gain = candidate.cost[other] - candidate.cost[clef];
        if (gain < 0) { stableCount = 0; break; }
        advantage += gain;
        stableCount += 1;
        if (candidate.end.gt(stableEnd)) stableEnd = candidate.end;
      }
      const persistent = stableCount >= 3 || stableCount > 0 && stableEnd.sub(frame.onset).gte(new Rational(2));
      const mayChange = boundary && !protectedPhrase && persistent && advantage > changePenalty;
      const changeCost = mayChange ? costs[other] + changePenalty : Infinity;
      const predecessor = changeCost < costs[clef] ? other : clef;
      nextCosts[clef] = frame.cost[clef] + Math.min(costs[clef], changeCost);
      path[index * 2 + clef] = predecessor;
    }
    costs = nextCosts;
    if (frame.end.gt(activeEnd)) activeEnd = frame.end;
  }
  let current = costs[0] <= costs[1] ? 0 : 1;
  const states = new Uint8Array(frames.length);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    states[index] = current;
    current = path[index * 2 + current];
  }
  return frames.flatMap((frame, index): StaffNotationClefChange[] => index === 0 || states[index] !== states[index - 1]
    ? [{onsetQuarters: index === 0 ? Rational.ZERO : frame.onset,
      clef: states[index] === 0 ? {sign: 'G', line: 2} : {sign: 'F', line: 4}, inferred: true}]
    : []);
}

function chordEvents(notes: readonly Note[]): RhythmEvent[] {
  const groups = new Map<string, {notes: Note[]; event: RhythmEvent}>();
  for (const note of notes) {
    const duration = note.duration;
    const key = JSON.stringify([
      note.voice, note.onsetQuarters.toString(), duration.base.toString(), duration.dots,
      duration.tuplet, note.tupletId, !!note.rest, !!note.grace,
      // A hidden spacing rest must not suppress an audible chord's drawing.
      'printObject' in note ? note.printObject : undefined,
    ]);
    const previous = groups.get(key);
    if (previous && !note.rest) previous.notes.push(note);
    else {
      const chord = [note];
      const event: RhythmEvent = {notes: chord, onsetQuarters: note.onsetQuarters,
        duration, rest: !!note.rest, continuedFromPrevious: false, continuesToNext: false};
      // Simultaneous rests remain separate events, just like their source.
      groups.set(previous ? `${key}:${note.id}` : key, {notes: chord, event});
    }
  }
  return [...groups.values()].map(({event}) => event).sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
}

/**
 * Spell a duration exactly as ordinary dotted values, retaining its tuplet
 * ratio. Undefined means no supported exact spelling; never round timing.
 * The bound protects projections of extreme or freely performed durations.
 */
export function spellStaffDuration(quarters: Rational, tuplet: readonly [number, number] = [1, 1]): readonly Duration[] | undefined {
  if (quarters.lt(Rational.ZERO)) return undefined;
  if (quarters.isZero()) return [];
  const values = DURATION_BASES.flatMap((base) => [0, 1, 2, 3].map((dots) => new Duration({base, dots, tuplet})))
    .sort((a, b) => b.quarters.cmp(a.quarters));
  const result: Duration[] = [];
  let remaining = quarters;
  while (!remaining.isZero() && result.length < MAX_DURATION_FRAGMENTS) {
    const next = values.find((duration) => duration.quarters.lte(remaining));
    if (!next) return undefined;
    result.push(next);
    remaining = remaining.sub(next.quarters);
  }
  return remaining.isZero() ? result : undefined;
}

function isWrittenDuration(duration: Duration): boolean {
  return DURATION_BASES.some((base) => duration.base.eq(Rational.from(base)));
}

function distributeEvent(
  event: RhythmEvent,
  measures: readonly StaffNotationMeasure[],
  voiceMaps: Map<string, RhythmEvent[]>[],
  diagnostics: StaffNotationDiagnostic[],
): void {
  const start = event.onsetQuarters;
  const end = start.add(event.duration.quarters);
  // Binary search puts long scores on an O(notes log measures) path rather
  // than scanning the measure grid from its beginning for every note.
  let low = 0;
  let high = measures.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (measures[mid].endQuarters.lte(start)) low = mid + 1;
    else high = mid;
  }
  if (low === measures.length || start.lt(measures[low].startQuarters)) {
    diagnostics.push({code: 'outside-measures', note: event.notes[0],
      message: `Note ${event.notes[0].id} begins outside the available measure grid.`});
    return;
  }
  let position = start;
  for (let index = low; index < measures.length; index += 1) {
    const measure = measures[index];
    const fragmentEnd = end.lt(measure.endQuarters) ? end : measure.endQuarters;
    const complete = position.eq(start) && fragmentEnd.eq(end);
    let durations: readonly Duration[] | undefined = complete && (isWrittenDuration(event.duration) || !!event.notes[0].grace)
      ? [event.duration] : spellStaffDuration(fragmentEnd.sub(position), event.duration.tuplet);
    if (!durations?.length) {
      diagnostics.push({code: 'unsupported-duration', note: event.notes[0], measure: measure.source,
        message: `Note ${event.notes[0].id} has no exact supported written duration at quarter ${position}.`});
      // Preserve the exact musical interval for a renderer's explicit fallback.
      durations = [new Duration({base: fragmentEnd.sub(position)})];
    }
    for (const duration of durations) {
      const next = position.add(duration.quarters);
      const fragment = complete && durations.length === 1 && duration === event.duration ? event : {
        ...event, onsetQuarters: position, duration,
        continuedFromPrevious: !event.rest && position.gt(start),
        continuesToNext: !event.rest && next.lt(end),
      };
      const voice = String(event.notes[0].voice);
      let events = voiceMaps[index].get(voice);
      if (!events) voiceMaps[index].set(voice, events = []);
      events.push(fragment);
      position = next;
    }
    if (position.gte(end)) return;
  }
  diagnostics.push({code: 'outside-measures', note: event.notes[0],
    message: `Note ${event.notes[0].id} continues beyond the available measure grid.`});
}
