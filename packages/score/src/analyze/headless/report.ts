// ============================================================================
// The at-a-glance report: the handful of scalar facts a reader wants before
// looking at any single analysis. It combines the score summary with the
// detected key and the harmonic segmentation, which otherwise live in three
// separate calls, and returns plain data — no DOM, no formatting decisions
// beyond turning each fact into a display string.
// ============================================================================

import type {Score} from '../../core';
import {segmentChords} from '../core/chords';
import {detectKey} from '../core/key';
import {summarizeScore} from '../core/summary';

export interface ScoreReport {
  /** The score title, or `undefined` when the file carries none. */
  readonly title?: string;
  readonly composer?: string;
  /** Label / value pairs, already formatted for display. */
  readonly rows: ReadonlyArray<{readonly label: string; readonly value: string}>;
}

/**
 * Build the report for one score. Pure: the same score always yields the same
 * report, and nothing is retained between calls.
 */
export function createScoreReport(score: Score): ScoreReport {
  const summary = summarizeScore(score);
  const key = detectKey(score);
  const chords = segmentChords(score);

  const rows: Array<{label: string; value: string}> = [
    {label: 'Key', value: key.scores.length === 0 ? 'Unknown' : `${key.tonic} ${key.mode}`},
    {label: 'Confidence', value: `${Math.round(key.confidence * 100)}%`},
    {label: 'Tempo', value: `${Math.round(summary.tempoBpm)} bpm`},
    {label: 'Meter', value: summary.timeSignature},
    {label: 'Parts', value: String(summary.parts)},
    {label: 'Measures', value: String(summary.measures)},
    {label: 'Notes', value: String(summary.notes)},
  ];
  if (summary.pitchRange) {
    rows.push({
      label: 'Range',
      value: `${summary.pitchRange.low}–${summary.pitchRange.high}`,
    });
  }
  rows.push({label: 'Chord segments', value: String(chords.length)});

  return {title: summary.title, composer: summary.composer, rows};
}
