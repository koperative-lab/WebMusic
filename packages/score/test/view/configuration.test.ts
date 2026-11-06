import {describe, expect, it} from 'vitest';
import {validateScoreViewConfiguration, type ScoreViewConfiguration} from '../../src/view';

describe('mode-specific view configuration', () => {
  it('accepts each renderer with its own options', () => {
    for (const configuration of [
      {type: 'piano-roll', options: {pixelsPerSecond: 80, direction: 'up'}},
      {type: 'piano-roll', options: {noteHeight: 16, minPitch: 48, maxPitch: 84}},
      {type: 'staff', options: {defaultKey: 2, instruments: [0], splitStaves: false, noteColor: 'var(--ink)', activeNoteColor: '#f00', showAnnotations: true}},
      {type: 'waterfall', options: {whiteNoteWidth: 18, virtualization: true, direction: 'left'}},
    ] satisfies ScoreViewConfiguration[]) {
      expect(() => validateScoreViewConfiguration(configuration)).not.toThrow();
    }
  });

  it('rejects options for another mode and misspelled options from JavaScript', () => {
    for (const configuration of [
      {type: 'piano-roll', options: {whiteNoteWidth: 18}},
      {type: 'piano-roll', options: {showAnnotations: false}},
      // Written-quarter grid geometry belongs to <score-grid-view>, not the read-only piano roll.
      {type: 'piano-roll', options: {pixelsPerQuarter: 32}},
      {type: 'piano-roll', options: {editingGrid: [1, 3]}},
      {type: 'waterfall', options: {showAnnotations: true}},
      {type: 'staff', options: {pixelsPerQuarter: 32}},
      {type: 'waterfall', options: {editingGrid: [1, 4]}},
      {type: 'waterfall', options: {defaultKey: 2}},
      {type: 'waterfall', options: {whiteNoteHeight: 70}},
      {type: 'waterfall', options: {blackNoteHeight: 40}},
      {type: 'waterfall', options: {keyboard: () => ({})}},
      {type: 'staff', options: {pixelsPerSeond: 80}},
      {type: 'staff', options: {direction: 'up'}},
      {type: 'unknown'},
      {type: 'staff', options: null},
      {type: 'staff', options: []},
    ]) {
      expect(() => validateScoreViewConfiguration(configuration as ScoreViewConfiguration)).toThrow(TypeError);
    }
  });

  it('rejects incompatible option variables at compile time', () => {
    const waterfallOptions = {whiteNoteWidth: 18};
    // @ts-expect-error Waterfall-only options cannot configure staff, even via a variable.
    const invalid: ScoreViewConfiguration = {type: 'staff', options: waterfallOptions};
    expect(() => validateScoreViewConfiguration(invalid)).toThrow(/whiteNoteWidth/);
    const directedOptions = {direction: 'up' as const};
    // @ts-expect-error Staff notation retains its normal reading direction.
    const directedStaff: ScoreViewConfiguration = {type: 'staff', options: directedOptions};
    expect(() => validateScoreViewConfiguration(directedStaff)).toThrow(/direction/);
    // @ts-expect-error The read-only piano roll has no written-quarter grid geometry.
    const gridGeometry: ScoreViewConfiguration = {type: 'piano-roll', options: {pixelsPerQuarter: 32}};
    expect(() => validateScoreViewConfiguration(gridGeometry)).toThrow(/pixelsPerQuarter/);
  });
});
