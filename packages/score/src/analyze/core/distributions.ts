// ============================================================================
// Statistical portraits of a score: how its pitch classes, melodic intervals
// and note durations are distributed.
//
// These are aggregates rather than time-located facts, so they answer a
// different question from the chord/key/motif analyzers — "what is this piece
// made of" rather than "what happens when". The pitch-class distribution is
// the same duration-weighted histogram key detection ranks its profiles
// against, so a listener can see the evidence behind the detected key.
// ============================================================================

import {
  isPitchedNote,
  noteDurationTicks,
  noteMidi,
  scoreNotes,
  type Score,
} from '../../core';
import {NOTE_NAMES, pitchClass} from './pitch-class';
import {buildVoiceLanes} from './voice-leading';
import type {Distributions, DistributionBin} from './types';

/**
 * Melodic intervals are read per voice lane, and never across a notated rest —
 * the same rule the motif and voice-leading analyzers use, so a phrase break
 * does not manufacture a leap.
 */
function intervalBins(score: Score): DistributionBin[] {
  const counts = new Map<number, number>();
  for (const part of score.parts) {
    for (const lane of buildVoiceLanes(part)) {
      for (let index = 1; index < lane.onsetKeys.length; index += 1) {
        if (lane.breakBefore[index]) continue;
        const previous = lane.byOnset.get(lane.onsetKeys[index - 1]!);
        const current = lane.byOnset.get(lane.onsetKeys[index]!);
        if (!previous || !current) continue;
        if (!isPitchedNote(previous) || !isPitchedNote(current)) continue;
        const semitones = noteMidi(current) - noteMidi(previous);
        counts.set(semitones, (counts.get(semitones) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([semitones, count]) => ({
      label: semitones > 0 ? `+${semitones}` : String(semitones),
      value: count,
      key: semitones,
    }));
}

/**
 * Durations group on the exact rational, not its float: triplet eighths differ
 * in the last bit between onsets and would otherwise split into two bins.
 */
function durationBins(score: Score): DistributionBin[] {
  const counts = new Map<string, {quarters: number; count: number}>();
  for (const note of scoreNotes(score)) {
    const key = note.duration.quarters.toString();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, {quarters: note.duration.quarters.toFloat(), count: 1});
  }
  return [...counts.values()]
    .sort((a, b) => a.quarters - b.quarters)
    .map(({quarters, count}) => ({
      label: formatQuarters(quarters),
      value: count,
      key: quarters,
    }));
}

function formatQuarters(quarters: number): string {
  const rounded = Math.round(quarters * 1000) / 1000;
  return `${rounded}`;
}

/**
 * Duration-weighted pitch-class histogram, melodic interval counts and note
 * duration counts for one score. Every bin carries a display `label` and a
 * numeric `key` so callers can sort or filter without re-deriving it.
 */
export function distributions(score: Score): Distributions {
  const pitchWeights = Array.from({length: 12}, () => 0);
  for (const note of scoreNotes(score)) {
    if (!isPitchedNote(note)) continue;
    pitchWeights[pitchClass(noteMidi(note))] += noteDurationTicks(note);
  }

  return {
    pitchClasses: pitchWeights.map((value, index) => ({
      label: NOTE_NAMES[index]!,
      value,
      key: index,
    })),
    intervals: intervalBins(score),
    durations: durationBins(score),
  };
}
