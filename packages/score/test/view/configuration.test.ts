import {describe, expect, it} from 'vitest';
import {validateScoreViewConfiguration, type ScoreViewConfiguration} from '../../src/view';

describe('mode-specific view configuration', () => {
  it('accepts each renderer with its own options', () => {
    for (const configuration of [
      {type: 'piano-roll', options: {pixelsPerSecond: 80, showAnnotations: false}},
      {type: 'staff', options: {defaultKey: 2, instruments: [0], splitStaves: false, noteColor: 'var(--ink)', activeNoteColor: '#f00', showAnnotations: true}},
      {type: 'waterfall', options: {whiteNoteWidth: 18, virtualization: true, showAnnotations: false}},
    ] satisfies ScoreViewConfiguration[]) {
      expect(() => validateScoreViewConfiguration(configuration)).not.toThrow();
    }
  });

  it('rejects options for another mode and misspelled options from JavaScript', () => {
    for (const configuration of [
      {type: 'piano-roll', options: {whiteNoteWidth: 18}},
      {type: 'waterfall', options: {defaultKey: 2}},
      {type: 'waterfall', options: {whiteNoteHeight: 70}},
      {type: 'waterfall', options: {blackNoteHeight: 40}},
      {type: 'waterfall', options: {keyboard: () => ({})}},
      {type: 'staff', options: {pixelsPerSeond: 80}},
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
  });
});
