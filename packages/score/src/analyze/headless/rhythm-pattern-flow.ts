import {Rational, type Score} from '../../core';
import type {RhythmPatternOccurrenceGroup} from '../core/rhythm-pattern-occurrences';
import type {FlowBandView, FlowFlagView, FlowLaneView, FlowTrackView} from './workbench';

const MAX_TRACKS = 4;

/**
 * Project recurring written rhythms onto one playback axis. All appearances
 * of a pattern share `group`, so selecting one can emphasize its siblings.
 * The axis is nominal seconds; quarter-note stamps remain on each band for
 * score selection and seek commands.
 */
export function projectRhythmPatternFlow(
  patterns: readonly RhythmPatternOccurrenceGroup[],
  score: Score,
): FlowLaneView {
  const secondsCache = new Map<number, number>();
  const seconds = (quarters: number): number => {
    const cached = secondsCache.get(quarters);
    if (cached !== undefined) return cached;
    const value = score.timeMap.quartersToSeconds(Rational.from(quarters));
    secondsCache.set(quarters, value);
    return value;
  };
  const ranked = [...patterns].sort((left, right) => right.occurrences.length - left.occurrences.length);
  const shown = ranked.slice(0, MAX_TRACKS);
  const tracks: FlowTrackView[] = shown.map((pattern, index) => ({
    id: pattern.id,
    label: `R${index + 1}`,
  }));
  if (ranked.length > MAX_TRACKS) {
    tracks.push({id: 'more', label: `+${ranked.length - MAX_TRACKS} more`, muted: true});
  }

  const bands: FlowBandView[] = [];
  const flags: FlowFlagView[] = [];
  ranked.forEach((pattern, rank) => {
    const track = Math.min(rank, MAX_TRACKS);
    const label = `R${rank + 1}`;
    pattern.occurrences.forEach((occurrence, index) => {
      const id = `${pattern.id}-${index}`;
      bands.push({
        id,
        group: pattern.id,
        start: seconds(occurrence.startQuarters),
        end: seconds(occurrence.endQuarters),
        stampStart: occurrence.startQuarters,
        stampEnd: occurrence.endQuarters,
        track,
        primary: label,
      });
      occurrence.attackQuarters.forEach((at, attack) => {
        flags.push({id: `${id}-attack-${attack}`, at: seconds(at), track});
      });
    });
  });

  return {
    bands,
    tracks,
    flags,
    ruler: score.measures.slice(0, 64).map((measure) => ({
      at: seconds(measure.onsetQuarters.toFloat()),
      label: String(measure.number),
      major: measure.number % 4 === 1,
    })),
    span: {start: 0, end: score.durationSeconds},
    now: 0,
    emptyLabel: 'No recurring written rhythm in this score.',
  };
}
