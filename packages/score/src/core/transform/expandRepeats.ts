import {Measure, type MeasureData} from '../model/Measure';
import {Note} from '../model/Note';
import {Part, type PartData} from '../model/Part';
import type {PartClefChange, PartDirection} from '../model/notation';
import {Score} from '../model/Score';
import {Rational} from '../primitives/Rational';
import {TimeMap, type MeterEntry, type TempoEntry} from '../time/TimeMap';
import {MeasureId, NoteId, ScoreId} from '../types/ids';

/** One played occurrence of a source measure. */
interface MeasureOccurrence {
  /** Index into the original `score.measures`. */
  srcIndex: number;
  /** 1-based occurrence count of that source measure (1 = first playthrough). */
  occ: number;
  /** New onset in the expanded timeline. */
  newOnset: Rational;
}

/**
 * Compute the playback order of measure indices, honouring forward/backward
 * repeat barlines (`MeasureData.repeat.start` / `.end`, play count
 * `repeat.times`, default 2) and volta brackets (`MeasureData.volta`: a
 * measure marked e.g. `[1]` is played only on pass 1 of the enclosing
 * repeat).
 *
 * Malformed structures degrade gracefully:
 * - a `start` with no matching `end` (or interrupted by another `start`)
 *   plays through once, unexpanded;
 * - an `end` with no preceding `start` is ignored (no expansion for that
 *   span — we do NOT assume "repeat from the beginning");
 * - nested repeats are not supported (treated as malformed, see above).
 *
 * Segno / coda / D.C. / D.S. jumps are not modelled by `MeasureData` today
 * and are documented future work.
 */
function playbackOrder(measures: ReadonlyArray<Measure>): {order: number[]; changed: boolean} {
  const order: number[] = [];
  let i = 0;
  while (i < measures.length) {
    if (measures[i].repeat?.start) {
      // Find the matching end barline before any new start.
      let end = -1;
      for (let j = i; j < measures.length; j++) {
        if (j > i && measures[j].repeat?.start) break;
        if (measures[j].repeat?.end) {
          end = j;
          break;
        }
      }
      if (end !== -1) {
        const times = Math.max(1, measures[end].repeat?.times ?? 2);
        for (let pass = 1; pass <= times; pass++) {
          for (let k = i; k <= end; k++) {
            const volta = measures[k].volta;
            if (volta && !volta.includes(pass)) continue; // wrong ending for this pass
            order.push(k);
          }
        }
        i = end + 1;
        continue;
      }
      // start without end: fall through and play once.
    }
    order.push(i);
    i++;
  }
  return {order, changed: order.length !== measures.length || order.some((source, index) => source !== index)};
}

/** First index in `notes` (sorted by onset) whose onsetQuarters >= q. */
function lowerBoundByOnset(notes: ReadonlyArray<Note>, q: Rational): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].onsetQuarters.lt(q)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sameTempo(a: TempoEntry, b: TempoEntry): boolean {
  return a.bpm === b.bpm && (a.unit ?? 1) === (b.unit ?? 1);
}

function sameMeter(a: MeterEntry, b: MeterEntry): boolean {
  return (
    a.timeSignature.numerator === b.timeSignature.numerator &&
    a.timeSignature.denominator === b.timeSignature.denominator
  );
}

function appendTempo(entries: TempoEntry[], entry: TempoEntry, declared = false): void {
  const previous = entries[entries.length - 1];
  if (previous?.atQuarters.eq(entry.atQuarters)) {
    entries[entries.length - 1] = entry;
  } else if (declared || !previous || !sameTempo(previous, entry)) {
    entries.push(entry);
  }
}

function appendMeter(entries: MeterEntry[], entry: MeterEntry, declared = false): void {
  const previous = entries[entries.length - 1];
  if (previous?.atQuarters.eq(entry.atQuarters)) {
    entries[entries.length - 1] = entry;
  } else if (declared || !previous || !sameMeter(previous, entry)) {
    entries.push(entry);
  }
}

/**
 * Replay every tempo/meter event that occurs inside a source measure, rather
 * than only sampling its start. Each played occurrence needs its own active
 * state at the barline so the expanded map always begins at quarter zero.
 */
function expandedTimeMap(
  score: Score,
  sourceMeasures: ReadonlyArray<Measure>,
  occurrences: ReadonlyArray<MeasureOccurrence>,
  measures: ReadonlyArray<Measure>,
): TimeMap {
  if (occurrences.length === 0) {
    return new TimeMap(
      [{...score.timeMap.tempi[0], atQuarters: Rational.ZERO}],
      [{...score.timeMap.meters[0], atQuarters: Rational.ZERO, measureNumber: 1}],
      measures,
    );
  }
  const tempi: TempoEntry[] = [];
  const meters: MeterEntry[] = [];
  occurrences.forEach((occurrence, index) => {
    const source = sourceMeasures[occurrence.srcIndex];
    const start = source.onsetQuarters;
    const end = source.offsetQuarters;
    const shift = (atQuarters: Rational) => occurrence.newOnset.add(atQuarters.sub(start));

    const activeTempo = score.timeMap.tempoAt(start);
    appendTempo(tempi, {
      atQuarters: occurrence.newOnset,
      bpm: activeTempo.bpm,
      unit: activeTempo.unit,
    }, source.tempo !== undefined);
    for (const tempo of score.timeMap.tempi) {
      if (tempo.atQuarters.gt(start) && tempo.atQuarters.lt(end)) {
        appendTempo(tempi, {atQuarters: shift(tempo.atQuarters), bpm: tempo.bpm, unit: tempo.unit});
      }
    }

    const activeMeter = score.timeMap.timeSignatureAt(start);
    appendMeter(meters, {
      atQuarters: occurrence.newOnset,
      timeSignature: activeMeter,
      measureNumber: index + 1,
    }, source.timeSignature !== undefined);
    for (const meter of score.timeMap.meters) {
      if (meter.atQuarters.gt(start) && meter.atQuarters.lt(end)) {
        appendMeter(meters, {
          atQuarters: shift(meter.atQuarters),
          timeSignature: meter.timeSignature,
          measureNumber: index + 1,
        });
      }
    }
  });
  return new TimeMap(tempi, meters, measures);
}

/** Replay authored notation on the same absolute musical axis as the notes. */
function expandedNotation(part: Part, measures: readonly Measure[], occurrences: readonly MeasureOccurrence[]): Pick<PartData, 'clefChanges' | 'directions'> {
  const clefChanges: PartClefChange[] | undefined = part.clefChanges ? [] : undefined;
  const directions: PartDirection[] | undefined = part.directions ? [] : undefined;
  const currentClefs = new Map<number, PartClefChange['clef']>();
  for (const occurrence of occurrences) {
    const measure = measures[occurrence.srcIndex];
    const start = measure.onsetQuarters;
    const end = measure.offsetQuarters;
    const delta = occurrence.newOnset.sub(start);
    const active = new Map<number, PartClefChange>();
    for (const change of part.clefChanges ?? []) {
      if (change.onsetQuarters.gt(start)) break;
      active.set(change.staff, change);
    }
    // A repeat jump must restore the source clef even if that bar contains no
    // declaration. A declaration exactly on its barline is copied below.
    for (const [staff, change] of active) {
      const previous = currentClefs.get(staff);
      if (!change.onsetQuarters.eq(start) && (!previous || previous.sign !== change.clef.sign ||
          previous.line !== change.clef.line || previous.octaveChange !== change.clef.octaveChange)) {
        clefChanges!.push({...change, onsetQuarters: occurrence.newOnset});
        currentClefs.set(staff, change.clef);
      }
    }
    for (const change of part.clefChanges ?? []) {
      if (change.onsetQuarters.gte(start) && (change.onsetQuarters.lt(end) ||
          occurrence.srcIndex === measures.length - 1 && change.onsetQuarters.eq(end))) {
        clefChanges!.push({...change, onsetQuarters: change.onsetQuarters.add(delta)});
        currentClefs.set(change.staff, change.clef);
      }
    }
    for (const direction of part.directions ?? []) {
      // Span endpoints at a barline belong to the phrase which just ended;
      // ordinary marks and starts belong to the following bar.
      const endpoint = (direction.kind === 'wedge' && direction.type === 'stop') ||
        (direction.kind === 'pedal' && (direction.type === 'stop' || direction.type === 'discontinue'));
      const at = direction.onsetQuarters;
      const afterStart = endpoint ? at.gt(start) : at.gte(start);
      const beforeEnd = endpoint ? at.lte(end) : at.lt(end);
      if ((afterStart || occurrence.srcIndex === 0 && at.lte(start)) &&
          (beforeEnd || occurrence.srcIndex === measures.length - 1 && at.gte(end))) {
        directions!.push({...direction, onsetQuarters: at.add(delta)});
      }
    }
  }
  return {clefChanges, directions};
}

/**
 * Produce a new Score with repeats unrolled into a linear timeline.
 *
 * - Measures are cloned in playback order with sequential 1-based numbers and
 *   shifted onsets; `repeat`/`volta` markers are dropped from the result.
 * - Notes are assigned to the measure containing their onset and cloned with
 *   shifted onsets. Repeated occurrences get derived IDs (`<id>@2`, `<id>@3`,
 *   …, with a collision suffix when needed) so Score's by-id lookup stays unambiguous; first occurrences keep
 *   their original IDs. Notes outside any measure are dropped.
 * - Tempo / meter entries inside each measure are replayed for every played
 *   occurrence, so mid-measure changes survive expansion.
 * - `performed` note times are shifted to the expanded absolute timeline
 *   while retaining each note's source microtiming offset.
 *
 * If the score contains no well-formed repeats (or no measures), the
 * original Score instance is returned unchanged. Malformed repeat structures
 * fall back to no expansion for that span (see `playbackOrder`).
 */
export function expandRepeats(score: Score): Score {
  const src = score.measures;
  if (src.length === 0) return score;
  const {order, changed} = playbackOrder(src);
  if (!changed) return score;

  // --- Clone measures in playback order with new numbers / onsets. ---
  const occCount = new Map<number, number>();
  const measureIds = new Set<string>(src.map((measure) => measure.id));
  const noteIds = new Set<string>();
  for (const note of score.allNotes()) noteIds.add(note.id);
  const occurrences: MeasureOccurrence[] = [];
  const measures: Measure[] = [];
  let cursor = Rational.ZERO;
  order.forEach((srcIndex, idx) => {
    const m = src[srcIndex];
    const occ = (occCount.get(srcIndex) ?? 0) + 1;
    occCount.set(srcIndex, occ);
    occurrences.push({srcIndex, occ, newOnset: cursor});
    measures.push(
      new Measure({
        ...(m as MeasureData),
        id: MeasureId(occurrenceId(m.id, occ, measureIds)),
        number: idx + 1,
        onsetQuarters: cursor,
        repeat: undefined,
        volta: undefined,
      }),
    );
    cursor = cursor.add(m.durationQuarters);
  });

  const timeMap = expandedTimeMap(score, src, occurrences, measures);

  // --- Clone notes measure-by-measure with shifted onsets. ---
  const parts = score.parts.map((p) => {
    const notes: Note[] = [];
    for (const mv of occurrences) {
      const m = src[mv.srcIndex];
      const end = m.offsetQuarters;
      const delta = mv.newOnset.sub(m.onsetQuarters);
      for (let i = lowerBoundByOnset(p.notes, m.onsetQuarters); i < p.notes.length; i++) {
        const n = p.notes[i];
        if (n.onsetQuarters.gte(end)) break;
        const onsetQuarters = n.onsetQuarters.add(delta);
        const performed = n.performed && {
          ...n.performed,
          // Preserve intentional human/MIDI timing relative to the notated
          // event while moving the event to its new absolute playback time.
          onsetSec:
            timeMap.quartersToSeconds(onsetQuarters) +
            (n.performed.onsetSec - score.timeMap.quartersToSeconds(n.onsetQuarters)),
        };
        notes.push(
          n.with({
            id: NoteId(occurrenceId(n.id, mv.occ, noteIds)),
            onsetQuarters,
            ...(performed ? {performed} : {}),
          }),
        );
      }
    }
    return new Part({...(p as PartData), ...expandedNotation(p, src, occurrences), notes});
  });

  return new Score({
    id: ScoreId(`${score.id}#expanded`),
    metadata: score.metadata,
    parts,
    measures,
    timeMap,
  });
}

/** Preserve every source identity and reserve each derived identity once. */
function occurrenceId(source: string, occurrence: number, used: Set<string>): string {
  if (occurrence === 1) return source;
  const base = `${source}@${occurrence}`;
  let candidate = base;
  let collision = 0;
  while (used.has(candidate)) candidate = `${base}~${++collision}`;
  used.add(candidate);
  return candidate;
}

/**
 * Total played duration in seconds with repeats honoured:
 * `durationSeconds` of `expandRepeats(score)`. Equals plain
 * `score.durationSeconds` when there are no (well-formed) repeats.
 */
export function playedDurationSeconds(score: Score): number {
  return expandRepeats(score).durationSeconds;
}
