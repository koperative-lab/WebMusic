import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreBuilder} from '../../src/core';
import {notesToScore, type RecordedNote} from '../../src/play/core/record';
import {parseSfz, resolveSfzZones} from '../../src/play/core/sfz';
import {gridKeyboardMidi, gridQwertyCellMidi, parseGridMap, qwertyMidi} from '../../src/play/core/note-input-model';

const captured: RecordedNote = {voice: 'lead', midi: 60, velocity: 100, onsetSec: 0, durationSec: 0.5};

describe('stateless recording allocation boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid ppq %s before allocating any measures', (ppq) => {
      const allocate = vi.spyOn(ScoreBuilder.prototype, 'addMeasure').mockImplementation(() => {
        throw new Error('Unexpected measure allocation');
      });
      expect(() => notesToScore([captured], {ppq})).toThrow(/Recording ppq/);
      expect(() => notesToScore([], {ppq})).toThrow(/Recording ppq/);
      expect(allocate).not.toHaveBeenCalled();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid captured timing %s before allocation', (time) => {
    const allocate = vi.spyOn(ScoreBuilder.prototype, 'addMeasure').mockImplementation(() => {
      throw new Error('Unexpected measure allocation');
    });
    expect(() => notesToScore([{...captured, onsetSec: time}])).toThrow(/onsetSec and durationSec/);
    expect(() => notesToScore([{...captured, durationSec: time}])).toThrow(/onsetSec and durationSec/);
    expect(allocate).not.toHaveBeenCalled();
  });

  it('rejects invalid tempo, non-finite quantization and overflowing derived timing before allocation', () => {
    const allocate = vi.spyOn(ScoreBuilder.prototype, 'addMeasure').mockImplementation(() => {
      throw new Error('Unexpected measure allocation');
    });
    for (const bpm of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => notesToScore([captured], {bpm})).toThrow(/Recording bpm/);
    }
    for (const quantizeGrid of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => notesToScore([captured], {quantizeGrid})).toThrow(/quantizeGrid/);
    }
    expect(() => notesToScore([{...captured, onsetSec: Number.MAX_VALUE}], {bpm: Number.MAX_VALUE})).toThrow(/measure range/);
    expect(allocate).not.toHaveBeenCalled();
  });

  it('retains zero performed duration, low valid ppq, and disabled quantization', () => {
    const score = notesToScore([{...captured, onsetSec: 0.1, durationSec: 0}], {ppq: 4, quantizeGrid: 0});
    expect(score.notes[0].duration.quarters.toFloat()).toBe(0.25);
    expect(score.notes[0].performed).toMatchObject({onsetSec: 0.1, durationSec: 0, velocity: 100});
    expect(score.notes[0].onsetQuarters.toFloat()).toBe(0.25);
  });
});

describe('SFZ independent key defaults', () => {
  it('defaults the key range to the full MIDI range and the root to middle C', () => {
    const [zone] = resolveSfzZones(parseSfz('<region> sample=c.wav'), '/piano/instrument.sfz');
    expect(zone).toMatchObject({sample: '/piano/c.wav', loKey: 0, hiKey: 127, rootKey: 60});
  });

  it('does not reinterpret a range boundary as the sample root', () => {
    const zones = resolveSfzZones(parseSfz('<region> sample=c.wav lokey=48 hikey=72\n<region> sample=d.wav pitch_keycenter=62'), '/piano.sfz');
    expect(zones[0]).toMatchObject({loKey: 48, hiKey: 72, rootKey: 60});
    expect(zones[1]).toMatchObject({loKey: 0, hiKey: 127, rootKey: 62});
  });

  it('preserves inherited explicit key shorthand and regional overrides', () => {
    const zones = resolveSfzZones(parseSfz('<group> key=64\n<region> sample=e.wav\n<region> sample=f.wav pitch_keycenter=65 lokey=60 hikey=72'), '/piano.sfz');
    expect(zones[0]).toMatchObject({loKey: 64, hiKey: 64, rootKey: 64});
    expect(zones[1]).toMatchObject({loKey: 60, hiKey: 72, rootKey: 65});
  });
});

describe('stateless input map parsing', () => {
  it.each(['toString', 'constructor', '__proto__'])('does not map inherited object key %s', (code) => {
    expect(qwertyMidi(code, 60)).toBeNull();
    expect(gridKeyboardMidi(60, code)).toBeNull();
    expect(gridQwertyCellMidi(60, 0, code, {midi: 42, label: 'HH'})).toBe(42);
  });

  it('ignores empty assignments without clearing an earlier map, and still accepts MIDI zero', () => {
    const pads = parseGridMap('a1=60,a1=,a2=;a3=0;a4=nope');
    expect(pads[10]).toEqual({midi: 60, label: 'a1'});
    expect(pads[11]).toBeUndefined();
    expect(pads[12]).toEqual({midi: 0, label: 'a3'});
    expect(pads[13]).toBeUndefined();
  });
});
