import {Rational, type Note, type Score, type TimeSignature} from '../../core';

export interface RhythmInspectionOptions {
  /** Inclusive beginning of the inspected range, in quarter notes. */
  startQuarters?: number;
  /** Exclusive end of the inspected range, in quarter notes. */
  endQuarters?: number;
  /** Restrict attacks to one part. The beat grid remains score-wide. */
  partId?: string;
  /** Number of visible equal divisions per notated beat. Default 2. */
  subdivision?: 1 | 2 | 3 | 4;
}

export interface RhythmBeat {
  atQuarters: number;
  measure: number;
  beat: number;
  beatLengthQuarters: number;
  meter: Readonly<TimeSignature>;
  /** Structural downbeat; not an inferred accent or a performance measurement. */
  metricAccent: boolean;
}

export interface RhythmSubdivision {
  atQuarters: number;
  beatAtQuarters: number;
  index: number;
  of: 1 | 2 | 3 | 4;
}

export interface RhythmPerformedOnset {
  noteId: string;
  onsetSeconds: number;
  /** Performed onset minus the TimeMap projection of the written onset. */
  deviationSeconds: number;
  velocity: number;
}

export interface RhythmOnset {
  /** Stable for a part, voice and exact written onset within this score. */
  id: string;
  atQuarters: number;
  partId: string;
  voiceId: string;
  /** Chord members at this written attack, in their original part order. */
  noteIds: ReadonlyArray<string>;
  measure: number;
  beat: number;
  /** Position within the denominator beat, from 0 inclusive to 1 exclusive. */
  subbeat: number;
  subbeatExact: string;
  offbeat: boolean;
  /** 0 on a beat, otherwise the selected division index, or null if unaligned. */
  subdivisionIndex: number | null;
  metricAccent: boolean;
  /** An authored accent or marcato on at least one member. */
  authoredAccent: boolean;
  /** Conservative cue: an authored accent or marcato on an offbeat attack. */
  syncopationCue: boolean;
  nominalSeconds: number;
  /** Present only for members that carry performed timing in the Score. */
  performed: ReadonlyArray<RhythmPerformedOnset>;
}

export interface RhythmInspection {
  /** Effective range, clamped to the score's duration. */
  range: Readonly<{startQuarters: number; endQuarters: number}>;
  beats: ReadonlyArray<RhythmBeat>;
  subdivisions: ReadonlyArray<RhythmSubdivision>;
  onsets: ReadonlyArray<RhythmOnset>;
  summary: Readonly<{
    beatCount: number;
    onsetCount: number;
    offbeatCount: number;
    authoredAccentCount: number;
    syncopationCueCount: number;
    /** Number of onset groups with at least one performed member. */
    performedCount: number;
  }>;
}

function authoredMeasureAt(score: Score, at: Rational): {onsetQuarters: Rational; endQuarters: Rational; nextQuarters?: Rational} | undefined {
  const measures = score.timeMap.measures;
  if (!measures?.length) return undefined;
  let lo = 0;
  let hi = measures.length - 1;
  let index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (measures[mid].onsetQuarters.lte(at)) {
      index = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (index < 0) return undefined;
  const measure = measures[index];
  const next = measures[index + 1]?.onsetQuarters;
  const end = next ?? measure.onsetQuarters.add(measure.durationQuarters);
  if (at.gte(end)) return undefined;
  return {onsetQuarters: measure.onsetQuarters, endQuarters: end, nextQuarters: next};
}

function beatContext(score: Score, at: Rational): {meter: Readonly<TimeSignature>; boundary?: Rational} {
  const authored = authoredMeasureAt(score, at);
  if (authored) {
    return {
      // TimeMap's MBS mapping uses the meter at the beginning of a real
      // measure, even if another meter event appears inside that measure.
      meter: score.timeMap.timeSignatureAt(authored.onsetQuarters),
      boundary: authored.endQuarters,
    };
  }
  const nextMeter = score.timeMap.meters.find((entry) => entry.atQuarters.gt(at))?.atQuarters;
  const measures = score.timeMap.measures;
  const last = measures?.[measures.length - 1];
  const tailStart = last?.onsetQuarters.add(last.durationQuarters);
  const boundary = tailStart?.gt(at) && (!nextMeter || tailStart.lt(nextMeter)) ? tailStart : nextMeter;
  return {meter: score.timeMap.timeSignatureAt(at), boundary};
}

function nextBeat(score: Score, at: Rational, meter: Readonly<TimeSignature>, boundary?: Rational): Rational {
  const regular = at.add(new Rational(4, meter.denominator));
  return boundary?.lt(regular) ? boundary : regular;
}

function addBeatGrid(
  score: Score,
  start: number,
  end: number,
  subdivision: 1 | 2 | 3 | 4,
): {beats: RhythmBeat[]; subdivisions: RhythmSubdivision[]} {
  const beats: RhythmBeat[] = [];
  const subdivisions: RhythmSubdivision[] = [];
  if (end <= start) return {beats, subdivisions};

  const startAddress = score.timeMap.quartersToMBS(Rational.from(start));
  let at = score.timeMap.mbsToQuarters({
    measure: startAddress.measure,
    beat: startAddress.beat,
    subbeat: Rational.ZERO,
  });
  while (at.toFloat() < end) {
    const {meter, boundary} = beatContext(score, at);
    const following = nextBeat(score, at, meter, boundary);
    if (!following.gt(at)) throw new RangeError('TimeMap beat grid did not advance');
    const address = score.timeMap.quartersToMBS(at);
    const atQuarters = at.toFloat();
    if (atQuarters >= start) {
      beats.push({
        atQuarters,
        measure: address.measure,
        beat: address.beat,
        beatLengthQuarters: new Rational(4, meter.denominator).toFloat(),
        meter,
        metricAccent: address.beat === 1,
      });
    }
    // A shortened measure or a meter event can truncate a beat. Its visible
    // divisions stop at that structural boundary; no invented subdivisions.
    const beatLength = new Rational(4, meter.denominator);
    for (let index = 1; index < subdivision; index += 1) {
      const division = at.add(beatLength.mul(new Rational(index, subdivision)));
      if (division.gte(following) || division.toFloat() < start || division.toFloat() >= end) continue;
      subdivisions.push({atQuarters: division.toFloat(), beatAtQuarters: atQuarters, index, of: subdivision});
    }
    at = following;
  }
  return {beats, subdivisions};
}

function isAttack(note: Note): boolean {
  return !note.rest && note.tie !== 'continue' && note.tie !== 'stop';
}

function alignedDivision(subbeat: Rational, subdivision: number): number | null {
  const scaled = subbeat.mul(new Rational(subdivision));
  return scaled.den === 1 ? scaled.num : null;
}

/**
 * Inspect written beat placement and note attacks in a selected score region.
 * This is observational data: no quantization, inferred groove, playback
 * command or score mutation is performed. Performed timing is reported only
 * when an individual note explicitly contains it.
 */
export function inspectScoreRhythm(score: Score, options: RhythmInspectionOptions = {}): RhythmInspection {
  const duration = score.durationQuarters.toFloat();
  const requestedStart = options.startQuarters ?? 0;
  const requestedEnd = options.endQuarters ?? duration;
  if (!Number.isFinite(requestedStart) || requestedStart < 0 || !Number.isFinite(requestedEnd) || requestedEnd < requestedStart) {
    throw new RangeError('Rhythm inspection range must contain finite non-negative quarters with end >= start');
  }
  const subdivision = options.subdivision ?? 2;
  if (subdivision !== 1 && subdivision !== 2 && subdivision !== 3 && subdivision !== 4) {
    throw new RangeError('Rhythm inspection subdivision must be 1, 2, 3 or 4');
  }
  const start = Math.min(requestedStart, duration);
  const end = Math.min(requestedEnd, duration);
  const parts = options.partId === undefined
    ? score.parts
    : score.parts.filter((part) => part.id === options.partId);
  if (options.partId !== undefined && parts.length === 0) {
    throw new RangeError(`Unknown rhythm inspection part: ${options.partId}`);
  }

  const {beats, subdivisions} = addBeatGrid(score, start, end, subdivision);
  const grouped = new Map<string, RhythmOnset & {noteIds: string[]; performed: RhythmPerformedOnset[]}>();
  for (const part of parts) {
    for (const note of part.notes) {
      const quarter = note.onsetQuarters.toFloat();
      if (quarter < start || quarter >= end || !isAttack(note)) continue;
      const voiceId = String(note.voice);
      const id = JSON.stringify([part.id, voiceId, note.onsetQuarters.toString()]);
      let onset = grouped.get(id);
      if (!onset) {
        const address = score.timeMap.quartersToMBS(note.onsetQuarters);
        const subbeat = address.subbeat;
        onset = {
          id,
          atQuarters: quarter,
          partId: String(part.id),
          voiceId,
          noteIds: [],
          measure: address.measure,
          beat: address.beat,
          subbeat: subbeat.toFloat(),
          subbeatExact: subbeat.toString(),
          offbeat: !subbeat.isZero(),
          subdivisionIndex: alignedDivision(subbeat, subdivision),
          metricAccent: address.beat === 1 && subbeat.isZero(),
          authoredAccent: false,
          syncopationCue: false,
          nominalSeconds: score.timeMap.quartersToSeconds(note.onsetQuarters),
          performed: [],
        };
        grouped.set(id, onset);
      }
      onset.noteIds.push(String(note.id));
      onset.authoredAccent ||= note.articulations?.includes('accent') === true || note.articulations?.includes('marcato') === true;
      onset.syncopationCue = onset.offbeat && onset.authoredAccent;
      if (note.performed) {
        onset.performed.push({
          noteId: String(note.id),
          onsetSeconds: note.performed.onsetSec,
          deviationSeconds: note.performed.onsetSec - onset.nominalSeconds,
          velocity: note.performed.velocity,
        });
      }
    }
  }
  const onsets = [...grouped.values()].sort((a, b) => a.atQuarters - b.atQuarters);
  return {
    range: {startQuarters: start, endQuarters: end},
    beats,
    subdivisions,
    onsets,
    summary: {
      beatCount: beats.length,
      onsetCount: onsets.length,
      offbeatCount: onsets.filter((onset) => onset.offbeat).length,
      authoredAccentCount: onsets.filter((onset) => onset.authoredAccent).length,
      syncopationCueCount: onsets.filter((onset) => onset.syncopationCue).length,
      performedCount: onsets.filter((onset) => onset.performed.length > 0).length,
    },
  };
}
