import {Rational} from '../primitives/Rational';
import {assertValidTempo, assertValidTimeSignature, type TimeSignature} from '../types/meta';

export interface TempoEntry {
  /** Position in quarters from score start. */
  atQuarters: Rational;
  /** Beats per minute. */
  bpm: number;
  /** Quarter-note value of the beat the bpm refers to. Default 1 = quarter. */
  unit?: number;
}

export interface MeterEntry {
  atQuarters: Rational;
  timeSignature: TimeSignature;
  /** 1-based measure number at this entry. */
  measureNumber: number;
}

export interface MBS {
  measure: number;
  beat: number;
  subbeat: Rational;
}

/** Minimal measure shape needed for measure-aware MBS mapping. */
export interface MeasureRef {
  /** Display measure number (may be 0 for anacrusis). */
  number: number;
  /** Start position in quarters from score start. */
  onsetQuarters: Rational;
  /** Measure length in quarters. */
  durationQuarters: Rational;
}

/**
 * Bidirectional time conversion: quarters ↔ seconds ↔ Measure:Beat:Subbeat.
 * Tempo is piecewise constant between TempoEntries.
 */
/** Default ticks-per-quarter resolution used by the tick-based legacy API. */
const LEGACY_PPQ = 480;

interface ScoreLike {
  timeMap: TimeMap;
  measures?: ReadonlyArray<MeasureRef>;
}

interface ExplicitEntryOrigins {
  tempi: ReadonlySet<string>;
  meters: ReadonlySet<string>;
}

// A ScoreBuilder can distinguish explicit addTempo/addMeter calls from events
// inferred from measure metadata. Keep that provenance off the public model
// while a score is live. JSON carries a complete `explicit: true | false`
// vector only when this information is known; direct TimeMaps intentionally
// omit it so reconstruction preserves their unknown/independent status.
const explicitEntryOrigins = new WeakMap<TimeMap, ExplicitEntryOrigins>();

function rationalKey(value: Rational): string {
  return `${value.num}/${value.den}`;
}

function tempoKey(entry: TempoEntry): string {
  return `${rationalKey(entry.atQuarters)}:${entry.bpm}:${entry.unit ?? 1}`;
}

function meterKey(entry: MeterEntry): string {
  // A no-grid TimeMap may canonicalise the display measure number of a
  // mid-bar meter change. Provenance belongs to the timeline event (position
  // and signature), not to that derived coordinate label.
  return `${rationalKey(entry.atQuarters)}:${entry.timeSignature.numerator}/${entry.timeSignature.denominator}`;
}

/** @internal Preserve which entries came from explicit ScoreBuilder calls. */
export function setTimeMapExplicitEntries(
  timeMap: TimeMap,
  tempi: ReadonlyArray<TempoEntry>,
  meters: ReadonlyArray<MeterEntry>,
): void {
  explicitEntryOrigins.set(timeMap, {
    tempi: new Set(tempi.map(tempoKey)),
    meters: new Set(meters.map(meterKey)),
  });
}

/**
 * @internal Whether this map was built with Builder/JSON provenance data.
 *
 * Directly constructed maps have no such information. A later measure edit
 * must conservatively regard their timeline entries as independently authored
 * instead of deleting matching values as if they had been inferred.
 */
export function hasTimeMapExplicitEntryOrigins(timeMap: TimeMap): boolean {
  return explicitEntryOrigins.has(timeMap);
}

/** @internal Whether an entry is independently authored rather than inferred. */
export function isExplicitTempoEntry(timeMap: TimeMap, entry: TempoEntry): boolean {
  return explicitEntryOrigins.get(timeMap)?.tempi.has(tempoKey(entry)) ?? false;
}

/** @internal Whether an entry is independently authored rather than inferred. */
export function isExplicitMeterEntry(timeMap: TimeMap, entry: MeterEntry): boolean {
  return explicitEntryOrigins.get(timeMap)?.meters.has(meterKey(entry)) ?? false;
}

/** Last index `i` in `positions` (sorted ascending floats) with positions[i] <= x; -1 if none. */
function lastIndexLte(positions: ReadonlyArray<number>, x: number): number {
  let lo = 0;
  let hi = positions.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] <= x) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * TimeMap keeps precomputed float projections alongside its public entries.
 * Snapshot caller-owned objects before calculating those projections: freezing
 * just the outer array would otherwise leave a mutable entry able to disagree
 * with the cached values.
 */
function snapshotTempo(entry: TempoEntry): TempoEntry {
  return Object.freeze({
    atQuarters: entry.atQuarters,
    bpm: entry.bpm,
    ...(entry.unit === undefined ? {} : {unit: entry.unit}),
  });
}

function snapshotTimeSignature(timeSignature: TimeSignature): TimeSignature {
  return Object.freeze({
    numerator: timeSignature.numerator,
    denominator: timeSignature.denominator,
  });
}

function snapshotMeter(entry: MeterEntry): MeterEntry {
  return Object.freeze({
    atQuarters: entry.atQuarters,
    timeSignature: snapshotTimeSignature(entry.timeSignature),
    measureNumber: entry.measureNumber,
  });
}

function snapshotMeasure(measure: MeasureRef): MeasureRef {
  if (!measure || typeof measure !== 'object') {
    throw new TypeError('measure ref must be an object');
  }
  if (!Number.isSafeInteger(measure.number)) {
    throw new RangeError('measure number must be an integer');
  }
  if (!(measure.onsetQuarters instanceof Rational) || !(measure.durationQuarters instanceof Rational)) {
    throw new TypeError('measure onset and duration must be Rational values');
  }
  if (measure.durationQuarters.lt(Rational.ZERO)) {
    throw new RangeError('measure duration must not be negative');
  }
  return Object.freeze({
    number: measure.number,
    onsetQuarters: measure.onsetQuarters,
    durationQuarters: measure.durationQuarters,
  });
}

/**
 * A real measure grid is the authority for Measure:Beat:Subbeat positions.
 * A meter event inside an authored measure would make that coordinate space
 * ambiguous: quartersToMBS could use the new beat length while
 * mbsToQuarters has only one measure onset to invert from. Require callers to
 * split the grid at the change instead. The open tail after the final measure
 * is intentionally allowed so incomplete scores can still declare the meter
 * used for nominal extrapolation.
 */
function assertTempoEntry(entry: TempoEntry): void {
  if (!entry || typeof entry !== 'object') throw new TypeError('tempo entry must be an object');
  if (!(entry.atQuarters instanceof Rational)) {
    throw new TypeError('tempo entry position must be a Rational value');
  }
  assertValidTempo(entry, 'tempo entry');
}

function assertMeterEntry(entry: MeterEntry): void {
  if (!entry || typeof entry !== 'object') throw new TypeError('meter entry must be an object');
  if (!(entry.atQuarters instanceof Rational)) {
    throw new TypeError('meter entry position must be a Rational value');
  }
  if (!Number.isSafeInteger(entry.measureNumber)) {
    throw new RangeError('meter entry measure number must be an integer');
  }
  assertValidTimeSignature(entry.timeSignature, 'meter entry');
}

/**
 * Canonicalise one timeline event per musical position.
 *
 * Callers often receive a source stream that has more than one event at a
 * single tick (for example duplicated MIDI meta events or consecutive
 * MusicXML directions). A TimeMap must have one unambiguous active value at
 * each position, so the last declaration in the supplied order wins. The
 * returned entries are defensive snapshots, sorted by musical position.
 *
 * @internal Used by ScoreBuilder so its explicit-event provenance describes
 * the same canonical timeline that TimeMap exposes.
 */
export function normalizeTempoEntriesByPosition(entries: ReadonlyArray<TempoEntry>): TempoEntry[] {
  const lastByPosition = new Map<string, TempoEntry>();
  for (const entry of entries) {
    assertTempoEntry(entry);
    lastByPosition.set(rationalKey(entry.atQuarters), snapshotTempo(entry));
  }
  return [...lastByPosition.values()].sort((a, b) => a.atQuarters.cmp(b.atQuarters));
}

/** See {@link normalizeTempoEntriesByPosition}; the last meter declaration wins. */
export function normalizeMeterEntriesByPosition(entries: ReadonlyArray<MeterEntry>): MeterEntry[] {
  const lastByPosition = new Map<string, MeterEntry>();
  for (const entry of entries) {
    assertMeterEntry(entry);
    lastByPosition.set(rationalKey(entry.atQuarters), snapshotMeter(entry));
  }
  return [...lastByPosition.values()].sort((a, b) => a.atQuarters.cmp(b.atQuarters));
}

function frozenNumbers(values: number[]): ReadonlyArray<number> {
  return Object.freeze(values);
}

/** Exact ceiling for a non-negative Rational without float boundary drift. */
function ceilNonNegativeRational(value: Rational): number {
  if (value.num <= 0) return 0;
  const whole = Math.floor(value.num / value.den);
  return value.num % value.den === 0 ? whole : whole + 1;
}

function nominalMeasureLength(timeSignature: TimeSignature): Rational {
  return new Rational(4 * timeSignature.numerator, timeSignature.denominator);
}

/**
 * Derive non-overlapping MBS labels for a map with no authored measure grid.
 *
 * A time-signature event can land inside the preceding nominal bar (common
 * for MIDI, which has no real measure list). That partial bar still consumes
 * a display-measure label; otherwise q → MBS can produce a coordinate that
 * the next meter segment claims again and MBS → q cannot be its inverse.
 * The resulting starts are also used to canonicalise the public MeterEntry
 * labels, so consumers observing `meters` see the same coordinates as MBS.
 */
function deriveMeterMeasureStarts(meters: ReadonlyArray<MeterEntry>): ReadonlyArray<number> {
  const starts: number[] = [meters[0].measureNumber];
  for (let index = 1; index < meters.length; index += 1) {
    const previous = meters[index - 1];
    const current = meters[index];
    const elapsed = current.atQuarters.sub(previous.atQuarters);
    const consumedMeasures = Math.max(
      1,
      ceilNonNegativeRational(elapsed.div(nominalMeasureLength(previous.timeSignature))),
    );
    const minimumStart = starts[index - 1] + consumedMeasures;
    if (!Number.isSafeInteger(minimumStart)) {
      throw new RangeError('meter measure number exceeds safe integer range');
    }
    starts.push(Math.max(current.measureNumber, minimumStart));
  }
  return frozenNumbers(starts);
}

function canonicalizeMeterMeasureNumbers(meters: ReadonlyArray<MeterEntry>): MeterEntry[] {
  const starts = deriveMeterMeasureStarts(meters);
  return meters.map((entry, index) =>
    entry.measureNumber === starts[index]
      ? entry
      : Object.freeze({...entry, measureNumber: starts[index]}),
  );
}

/** Last meter active at q. Entries must already be sorted and non-empty. */
function meterAtEntries(meters: ReadonlyArray<MeterEntry>, q: Rational): MeterEntry {
  let active = meters[0];
  for (let index = 1; index < meters.length && meters[index].atQuarters.lte(q); index += 1) {
    active = meters[index];
  }
  return active;
}

/**
 * Build the synthetic continuation used after a real measure grid ends.
 *
 * Authored measure numbers are authoritative before the tail. After that
 * point there is no grid, so use the same partial-bar consumption rule as the
 * no-grid MBS path. Meter declarations before the tail only determine the
 * opening meter; declarations at/after it become tail segment boundaries.
 */
function deriveTailMeterSegments(
  meters: ReadonlyArray<MeterEntry>,
  measures: ReadonlyArray<MeasureRef>,
): ReadonlyArray<MeterEntry> {
  const lastMeasure = measures[measures.length - 1];
  const tailStart = lastMeasure.onsetQuarters.add(lastMeasure.durationQuarters);
  const firstMeasureNumber = lastMeasure.number + 1;
  if (!Number.isSafeInteger(firstMeasureNumber)) {
    throw new RangeError('tail measure number exceeds safe integer range');
  }

  const rawSegments: MeterEntry[] = [
    Object.freeze({
      atQuarters: tailStart,
      timeSignature: meterAtEntries(meters, tailStart).timeSignature,
      measureNumber: firstMeasureNumber,
    }),
    ...meters
      .filter((meter) => meter.atQuarters.gt(tailStart))
      .map((meter) => Object.freeze({...meter, measureNumber: firstMeasureNumber})),
  ];

  const starts: number[] = [firstMeasureNumber];
  for (let index = 1; index < rawSegments.length; index += 1) {
    const previous = rawSegments[index - 1];
    const current = rawSegments[index];
    const elapsed = current.atQuarters.sub(previous.atQuarters);
    const consumedMeasures = Math.max(
      1,
      ceilNonNegativeRational(elapsed.div(nominalMeasureLength(previous.timeSignature))),
    );
    const next = starts[index - 1] + consumedMeasures;
    if (!Number.isSafeInteger(next)) throw new RangeError('tail measure number exceeds safe integer range');
    starts.push(next);
  }

  return Object.freeze(
    rawSegments.map((segment, index) =>
      Object.freeze({...segment, measureNumber: starts[index]}),
    ),
  );
}

/** Clamp legacy-tolerated negative MBS components without returning q < 0. */
function sanitizeMbs(mbs: MBS): MBS {
  if (!mbs || typeof mbs !== 'object') throw new TypeError('MBS must be an object');
  if (!Number.isSafeInteger(mbs.measure)) throw new RangeError('MBS measure must be an integer');
  if (!Number.isSafeInteger(mbs.beat)) throw new RangeError('MBS beat must be an integer');
  if (!(mbs.subbeat instanceof Rational)) throw new TypeError('MBS subbeat must be a Rational value');
  return {
    measure: mbs.measure,
    beat: Math.max(1, mbs.beat),
    subbeat: mbs.subbeat.lt(Rational.ZERO) ? Rational.ZERO : mbs.subbeat,
  };
}

/**
 * Bidirectional time map.
 *
 * NOTE: when constructed without a measure list, the MBS conversions
 * (`quartersToMBS` / `mbsToQuarters`) assume *uniform measures* within each
 * meter segment — every measure is exactly its time signature's nominal
 * length. A meter change inside a nominal bar creates a synthetic partial
 * measure so q → MBS → q remains reversible. Pickup (anacrusis) measures and
 * other irregular authored bars still require the real measure list (third
 * constructor argument, or a Score) for exact measure-aware mapping.
 *
 * At a shared `atQuarters`, the last supplied tempo or meter declaration wins.
 * This keeps direct construction, ScoreBuilder, JSON reconstruction and
 * importer-produced maps on one unambiguous timeline.
 */
export class TimeMap {
  readonly tempi: ReadonlyArray<TempoEntry>;
  readonly meters: ReadonlyArray<MeterEntry>;
  /** Real measure list, when provided. Enables exact MBS mapping for irregular measures. */
  readonly measures?: ReadonlyArray<MeasureRef>;

  // Precomputed at construction (the map is immutable):
  // float quarter positions of each tempo/meter entry, cumulative seconds at
  // each tempo entry, and float onsets of each measure. Used for O(log n)
  // binary-search lookups instead of linear scans.
  private readonly _tempoStartsQ: ReadonlyArray<number>;
  private readonly _tempoStartsSec: ReadonlyArray<number>;
  private readonly _meterStartsQ: ReadonlyArray<number>;
  /** Effective MBS measure label at each meter start for the no-grid path. */
  private readonly _meterMeasureStarts: ReadonlyArray<number>;
  private readonly _measureStartsQ?: ReadonlyArray<number>;
  /** Synthetic meter segments used only after the final authored measure. */
  private readonly _tailMeters?: ReadonlyArray<MeterEntry>;
  private readonly _tailMeterStartsQ?: ReadonlyArray<number>;

  constructor(
    tempi: ReadonlyArray<TempoEntry>,
    meters: ReadonlyArray<MeterEntry>,
    measures?: ReadonlyArray<MeasureRef>,
  );
  /** Legacy overload: build from an already-constructed Score by reusing its timeMap. */
  constructor(score: ScoreLike);
  constructor(
    tempiOrScore: ReadonlyArray<TempoEntry> | ScoreLike,
    meters?: ReadonlyArray<MeterEntry>,
    measures?: ReadonlyArray<MeasureRef>,
  ) {
    // Score-shaped argument: forward to its existing timeMap.
    if (!Array.isArray(tempiOrScore) && (tempiOrScore as ScoreLike).timeMap instanceof TimeMap) {
      const score = tempiOrScore as ScoreLike;
      const tm = score.timeMap;
      this.tempi = tm.tempi;
      this.meters = tm.meters;
      this.measures = tm.measures ?? (score.measures?.length ? Object.freeze(score.measures.map(snapshotMeasure)) : undefined);
      this._tempoStartsQ = tm._tempoStartsQ;
      this._tempoStartsSec = tm._tempoStartsSec;
      this._meterStartsQ = tm._meterStartsQ;
      this._meterMeasureStarts = tm._meterMeasureStarts;
      this._measureStartsQ =
        tm._measureStartsQ ??
        (this.measures ? frozenNumbers(this.measures.map((m) => m.onsetQuarters.toFloat())) : undefined);
      this._tailMeters = tm._tailMeters ?? (this.measures ? deriveTailMeterSegments(this.meters, this.measures) : undefined);
      this._tailMeterStartsQ =
        tm._tailMeterStartsQ ??
        (this._tailMeters ? frozenNumbers(this._tailMeters.map((meter) => meter.atQuarters.toFloat())) : undefined);
      const origins = explicitEntryOrigins.get(tm);
      if (origins) explicitEntryOrigins.set(this, origins);
      Object.freeze(this);
      return;
    }

    const tempi = tempiOrScore as ReadonlyArray<TempoEntry>;
    if (!meters) throw new Error('TimeMap requires meter entries');
    if (tempi.length === 0) throw new Error('TimeMap requires at least one tempo entry');
    if (meters.length === 0) throw new Error('TimeMap requires at least one meter entry');
    const sortedTempi = normalizeTempoEntriesByPosition(tempi);
    const sortedMeters = normalizeMeterEntriesByPosition(meters);
    const canonicalMeters =
      measures && measures.length > 0 ? sortedMeters : canonicalizeMeterMeasureNumbers(sortedMeters);
    if (!sortedTempi[0].atQuarters.eq(Rational.ZERO)) {
      throw new Error('First tempo must be at quarter 0');
    }
    if (!canonicalMeters[0].atQuarters.eq(Rational.ZERO)) {
      throw new Error('First meter must be at quarter 0');
    }
    this.tempi = Object.freeze(sortedTempi);
    this.meters = Object.freeze(canonicalMeters);
    if (measures && measures.length > 0) {
      const sortedMeasures = measures.map(snapshotMeasure).sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
      this.measures = Object.freeze(sortedMeasures);
      this._measureStartsQ = frozenNumbers(sortedMeasures.map((m) => m.onsetQuarters.toFloat()));
      this._tailMeters = deriveTailMeterSegments(canonicalMeters, this.measures);
      this._tailMeterStartsQ = frozenNumbers(this._tailMeters.map((meter) => meter.atQuarters.toFloat()));
    }

    this._tempoStartsQ = frozenNumbers(sortedTempi.map((t) => t.atQuarters.toFloat()));
    this._meterStartsQ = frozenNumbers(canonicalMeters.map((m) => m.atQuarters.toFloat()));
    this._meterMeasureStarts = frozenNumbers(canonicalMeters.map((m) => m.measureNumber));
    const cumSec: number[] = [0];
    for (let i = 1; i < sortedTempi.length; i++) {
      const prev = sortedTempi[i - 1];
      const secondsPerQuarter = 60 / (prev.bpm * (prev.unit ?? 1));
      const segQuarters = this._tempoStartsQ[i] - this._tempoStartsQ[i - 1];
      cumSec.push(cumSec[i - 1] + segQuarters * secondsPerQuarter);
    }
    this._tempoStartsSec = frozenNumbers(cumSec);
    Object.freeze(this);
  }

  /** Quarters → seconds; integrates piecewise-constant tempo. */
  quartersToSeconds(q: Rational): number {
    const qf = q.toFloat();
    if (qf <= 0) return 0;
    const i = Math.max(0, lastIndexLte(this._tempoStartsQ, qf));
    const t = this.tempi[i];
    const secondsPerQuarter = 60 / (t.bpm * (t.unit ?? 1));
    return this._tempoStartsSec[i] + (qf - this._tempoStartsQ[i]) * secondsPerQuarter;
  }

  /** Seconds → quarters, quantised to 1/ppq quarter (default 480). */
  secondsToQuarters(sec: number, ppq = LEGACY_PPQ): Rational {
    if (!Number.isFinite(sec)) throw new RangeError('seconds must be finite');
    if (!Number.isSafeInteger(ppq) || ppq <= 0) throw new RangeError('ppq must be a positive safe integer');
    if (sec <= 0) return Rational.ZERO;
    const i = Math.max(0, lastIndexLte(this._tempoStartsSec, sec));
    const t = this.tempi[i];
    const secondsPerQuarter = 60 / (t.bpm * (t.unit ?? 1));
    const qAccum = this._tempoStartsQ[i] + (sec - this._tempoStartsSec[i]) / secondsPerQuarter;
    return new Rational(Math.round(qAccum * ppq), ppq);
  }

  /**
   * Quarters → Measure:Beat:Subbeat using the prevailing time signature.
   * Uses the real measure list when available; otherwise assumes uniform
   * measures within each meter segment (see class JSDoc).
   */
  quartersToMBS(q: Rational): MBS {
    // Measure-aware path: exact even with pickup / irregular measures.
    if (this.measures && this._measureStartsQ) {
      let mi = lastIndexLte(this._measureStartsQ, q.toFloat());
      if (mi < 0) mi = 0;
      // Float search can land one off at exact rational boundaries; adjust.
      while (mi + 1 < this.measures.length && this.measures[mi + 1].onsetQuarters.lte(q)) mi++;
      while (mi > 0 && this.measures[mi].onsetQuarters.gt(q)) mi--;
      const measure = this.measures[mi];
      const measureEnd = measure.onsetQuarters.add(measure.durationQuarters);
      if (mi === this.measures.length - 1 && q.gte(measureEnd)) {
        return this.tailQuartersToMBS(q);
      }
      // A real grid owns MBS subdivision for its full authored span. A
      // mid-measure meter event remains visible through timeSignatureAt(), but
      // cannot redefine the one existing measure coordinate in only one
      // direction; use the meter that was active when that measure began.
      const ts = this.timeSignatureAt(measure.onsetQuarters);
      const beatLengthQ = new Rational(4, ts.denominator);
      const intoMeasure = q.sub(measure.onsetQuarters);
      const beatNum = Math.max(0, Math.floor(intoMeasure.div(beatLengthQ).toFloat()));
      const intoBeat = intoMeasure.sub(beatLengthQ.mul(new Rational(beatNum, 1)));
      return {
        measure: measure.number,
        beat: beatNum + 1,
        subbeat: intoBeat.div(beatLengthQ),
      };
    }

    let mi = lastIndexLte(this._meterStartsQ, q.toFloat());
    if (mi < 0) mi = 0;
    while (mi + 1 < this.meters.length && this.meters[mi + 1].atQuarters.lte(q)) mi++;
    while (mi > 0 && this.meters[mi].atQuarters.gt(q)) mi--;
    const meter = this.meters[mi];
    const ts = meter.timeSignature;
    const measureLengthQ = new Rational(4 * ts.numerator, ts.denominator);
    const beatLengthQ = new Rational(4, ts.denominator);
    const offsetIntoSeg = q.sub(meter.atQuarters);
    const measuresIntoSeg = Math.floor(offsetIntoSeg.div(measureLengthQ).toFloat());
    const intoMeasure = offsetIntoSeg.sub(measureLengthQ.mul(new Rational(measuresIntoSeg, 1)));
    const beatNum = Math.floor(intoMeasure.div(beatLengthQ).toFloat());
    const intoBeat = intoMeasure.sub(beatLengthQ.mul(new Rational(beatNum, 1)));
    const subbeat = intoBeat.div(beatLengthQ);
    return {
      measure: this._meterMeasureStarts[mi] + measuresIntoSeg,
      beat: beatNum + 1,
      subbeat,
    };
  }

  /**
   * Inverse: MBS → quarters. Never returns a negative position: measure
   * numbers below the first known measure clamp to the score start.
   * Uses the real measure list when available; otherwise assumes uniform
   * measures within each meter segment (see class JSDoc).
   */
  mbsToQuarters(mbs: MBS): Rational {
    mbs = sanitizeMbs(mbs);
    // Measure-aware path.
    if (this.measures) {
      const measure = this.measures.find((m) => m.number === mbs.measure);
      if (measure) {
        const ts = this.timeSignatureAt(measure.onsetQuarters);
        const beatLengthQ = new Rational(4, ts.denominator);
        return measure.onsetQuarters
          .add(beatLengthQ.mul(new Rational(Math.max(0, mbs.beat - 1), 1)))
          .add(beatLengthQ.mul(mbs.subbeat));
      }
      // Below the first measure → clamp to score start.
      if (mbs.measure < this.measures[0].number) return this.measures[0].onsetQuarters;
      // Beyond the last measure → extrapolate with the prevailing meter
      // from the last measure's real end.
      const last = this.measures[this.measures.length - 1];
      return this.tailMbsToQuarters(mbs, last.onsetQuarters.add(last.durationQuarters));
    }

    // Measure numbers below the first meter segment clamp to its start
    // (previously this returned negative quarters).
    if (mbs.measure < this._meterMeasureStarts[0]) {
      return this.meters[0].atQuarters;
    }
    for (let i = 0; i < this.meters.length; i++) {
      const m = this.meters[i];
      const ts = m.timeSignature;
      const measureLengthQ = new Rational(4 * ts.numerator, ts.denominator);
      const beatLengthQ = new Rational(4, ts.denominator);
      const segMeasureStart = this._meterMeasureStarts[i];
      const segMeasureEnd = this._meterMeasureStarts[i + 1] ?? Infinity;
      if (mbs.measure < segMeasureEnd) {
        const measuresIn = Math.max(0, mbs.measure - segMeasureStart);
        return m.atQuarters
          .add(measureLengthQ.mul(new Rational(measuresIn, 1)))
          .add(beatLengthQ.mul(new Rational(Math.max(0, mbs.beat - 1), 1)))
          .add(beatLengthQ.mul(mbs.subbeat));
      }
    }
    // mbs.measure >= last meter segment — extrapolate using the last meter.
    const m = this.meters[this.meters.length - 1];
    const ts = m.timeSignature;
    const measureLengthQ = new Rational(4 * ts.numerator, ts.denominator);
    const beatLengthQ = new Rational(4, ts.denominator);
    const measuresIn = Math.max(0, mbs.measure - this._meterMeasureStarts[this._meterMeasureStarts.length - 1]);
    return m.atQuarters
      .add(measureLengthQ.mul(new Rational(measuresIn, 1)))
      .add(beatLengthQ.mul(new Rational(Math.max(0, mbs.beat - 1), 1)))
      .add(beatLengthQ.mul(mbs.subbeat));
  }

  /** Active tempo entry at the given quarter position. */
  tempoAt(q: Rational): TempoEntry {
    let i = lastIndexLte(this._tempoStartsQ, q.toFloat());
    if (i < 0) i = 0;
    while (i + 1 < this.tempi.length && this.tempi[i + 1].atQuarters.lte(q)) i++;
    while (i > 0 && this.tempi[i].atQuarters.gt(q)) i--;
    return this.tempi[i];
  }

  /** Active time signature at the given quarter position. */
  timeSignatureAt(q: Rational): TimeSignature {
    let i = lastIndexLte(this._meterStartsQ, q.toFloat());
    if (i < 0) i = 0;
    while (i + 1 < this.meters.length && this.meters[i + 1].atQuarters.lte(q)) i++;
    while (i > 0 && this.meters[i].atQuarters.gt(q)) i--;
    return this.meters[i].timeSignature;
  }

  /** Piecewise MBS projection after the last authored measure. */
  private tailQuartersToMBS(q: Rational): MBS {
    const meters = this._tailMeters!;
    const startsQ = this._tailMeterStartsQ!;
    let index = lastIndexLte(startsQ, q.toFloat());
    if (index < 0) index = 0;
    while (index + 1 < meters.length && meters[index + 1].atQuarters.lte(q)) index++;
    while (index > 0 && meters[index].atQuarters.gt(q)) index--;
    const meter = meters[index];
    const measureLengthQ = nominalMeasureLength(meter.timeSignature);
    const beatLengthQ = new Rational(4, meter.timeSignature.denominator);
    const offset = q.sub(meter.atQuarters);
    const measuresIn = Math.floor(offset.div(measureLengthQ).toFloat());
    const intoMeasure = offset.sub(measureLengthQ.mul(new Rational(measuresIn, 1)));
    const beatNum = Math.floor(intoMeasure.div(beatLengthQ).toFloat());
    const intoBeat = intoMeasure.sub(beatLengthQ.mul(new Rational(beatNum, 1)));
    return {
      measure: meter.measureNumber + measuresIn,
      beat: beatNum + 1,
      subbeat: intoBeat.div(beatLengthQ),
    };
  }

  /** Inverse MBS projection for the synthetic tail after a real measure grid. */
  private tailMbsToQuarters(mbs: MBS, tailStart: Rational): Rational {
    const meters = this._tailMeters!;
    if (mbs.measure < meters[0].measureNumber) return tailStart;
    for (let index = 0; index < meters.length; index += 1) {
      const meter = meters[index];
      const nextMeasure = meters[index + 1]?.measureNumber ?? Infinity;
      if (mbs.measure >= nextMeasure) continue;
      const measureLengthQ = nominalMeasureLength(meter.timeSignature);
      const beatLengthQ = new Rational(4, meter.timeSignature.denominator);
      const measuresIn = Math.max(0, mbs.measure - meter.measureNumber);
      return meter.atQuarters
        .add(measureLengthQ.mul(new Rational(measuresIn, 1)))
        .add(beatLengthQ.mul(new Rational(Math.max(0, mbs.beat - 1), 1)))
        .add(beatLengthQ.mul(mbs.subbeat));
    }
    // The final segment is unbounded, but preserve a defensive fallback for
    // malformed/non-finite display labels.
    return tailStart;
  }

  toJSON() {
    const origins = explicitEntryOrigins.get(this);
    return {
      tempi: this.tempi.map((t) => ({
        atQuarters: t.atQuarters.toJSON(),
        bpm: t.bpm,
        unit: t.unit,
        ...(origins ? {explicit: origins.tempi.has(tempoKey(t))} : {}),
      })),
      meters: this.meters.map((m) => ({
        atQuarters: m.atQuarters.toJSON(),
        timeSignature: m.timeSignature,
        measureNumber: m.measureNumber,
        ...(origins ? {explicit: origins.meters.has(meterKey(m))} : {}),
      })),
    };
  }

  // --- Legacy tick-based API (uses a fixed 480 PPQ projection). ---

  /** Convert tick (at 480 PPQ) to seconds. */
  tickToSeconds(tick: number): number {
    return this.quartersToSeconds(new Rational(Math.round(tick), LEGACY_PPQ));
  }

  /** Convert seconds to tick (at 480 PPQ). */
  secondsToTick(seconds: number): number {
    return Math.round(this.secondsToQuarters(seconds).toFloat() * LEGACY_PPQ);
  }

  /** Convert tick (at 480 PPQ) to {measure, beat} where beat is a real number. */
  tickToMeasureBeat(tick: number): {measure: number; beat: number} {
    const mbs = this.quartersToMBS(new Rational(Math.round(tick), LEGACY_PPQ));
    return {measure: mbs.measure, beat: mbs.beat + mbs.subbeat.toFloat()};
  }

  /** Full TimePosition lookup from a tick. */
  locateTick(tick: number): {tick: number; seconds: number; measure: number; beat: number} {
    const seconds = this.tickToSeconds(tick);
    const {measure, beat} = this.tickToMeasureBeat(tick);
    return {tick, seconds, measure, beat};
  }

  /** Full TimePosition lookup from seconds. */
  locateSeconds(seconds: number): {tick: number; seconds: number; measure: number; beat: number} {
    return this.locateTick(this.secondsToTick(seconds));
  }
}
