import {describe, expect, it} from 'vitest';
import {
  AUDIO_METER_DISPLAY_TYPES,
  AudioMeterDisplay,
  LoudnessEstimator,
  alignTrigger,
  createAudioMeterDisplay,
  describeFrequency,
  fractionOf,
  frequencyAt,
  kWeightingRatio,
  peakFrequency,
  projectSpectrum,
  spectralCentroid,
  stereoCorrelation,
  vuDeflection,
  vuFromRms,
  windowLevel,
  type AudioMeterDisplaySource,
} from '../../src/view/headless/meter-display';

const SAMPLE_RATE = 48_000;
const BINS = 16;

function sine(hz: number, length: number, amplitude: number, phase = 0): Float32Array {
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE + phase);
  }
  return out;
}

interface FakeSource extends AudioMeterDisplaySource {
  time: Float32Array;
  spectrum: Float32Array;
  decibels: Float32Array;
  stereo?: {left: Float32Array; right: Float32Array};
  reads: string[];
}

function source(overrides: Partial<Pick<FakeSource, 'time' | 'spectrum' | 'decibels' | 'stereo'>> = {}): FakeSource {
  const spectrum = overrides.spectrum ?? Float32Array.from({length: BINS}, (_, bin) => (bin === 4 ? 1 : bin === 3 || bin === 5 ? 0.5 : 0));
  const fake: FakeSource = {
    time: overrides.time ?? sine(480, 2_048, 0.5),
    spectrum,
    decibels: overrides.decibels ?? Float32Array.from(spectrum, (value) => (value > 0 ? -100 + value * 70 : -Infinity)),
    stereo: overrides.stereo,
    reads: [],
    frequencyInfo: {sampleRate: SAMPLE_RATE, frequencyBinCount: BINS, minDecibels: -100, maxDecibels: -30},
    readTimeDomain() { fake.reads.push('time'); return fake.time; },
    readFrequency() { fake.reads.push('frequency'); return fake.spectrum; },
    readFrequencyDecibels() { fake.reads.push('decibels'); return fake.decibels; },
    readStereo() { fake.reads.push('stereo'); return fake.stereo; },
  };
  return fake;
}

describe('frequency axis helpers', () => {
  it('round-trips fractions and frequencies on every scale', () => {
    for (const scale of ['log', 'mel', 'linear'] as const) {
      for (const fraction of [0, 0.25, 0.5, 1]) {
        expect(fractionOf(frequencyAt(fraction, scale), scale)).toBeCloseTo(fraction, 6);
      }
      expect(frequencyAt(0, scale)).toBeCloseTo(20);
      expect(frequencyAt(1, scale)).toBeCloseTo(20_000);
    }
    expect(frequencyAt(0.5, 'log')).toBeCloseTo(Math.sqrt(20 * 20_000), 6);
    expect(frequencyAt(0.5, 'linear')).toBeCloseTo(10_010);
    expect(fractionOf(-5, 'log')).toBe(0);
    expect(fractionOf(Number.NaN, 'log')).toBe(0);
    expect(fractionOf(40_000, 'log')).toBe(1);
  });

  it('projects bins by maximum for wide cells and by interpolation for narrow ones', () => {
    const bins = Float32Array.from([0, 0.2, 0.4, 0.6, 0.8, 1, 0.5, 0.1]);
    // Linear axis over 0..sampleRate/2 with 8 bins: two bins per column.
    const wide = projectSpectrum(bins, 16, 4, 'linear', 0, 8);
    expect(wide).toHaveLength(4);
    for (const [index, expected] of [0.2, 0.6, 1, 0.5].entries()) expect(wide[index]).toBeCloseTo(expected, 6);
    const narrow = projectSpectrum(bins, 16, 16, 'linear', 0, 8);
    expect(narrow).toHaveLength(16);
    expect(narrow[1]).toBeGreaterThan(0);
    expect(narrow[1]).toBeLessThan(0.2);
    const scratch = new Float32Array(4);
    expect(projectSpectrum(bins, 16, 4, 'linear', 0, 8, scratch)).toBe(scratch);
    expect(Array.from(projectSpectrum(new Float32Array(0), 16, 3, 'log'))).toEqual([0, 0, 0]);
  });

  it('names frequencies and finds the interpolated peak', () => {
    expect(describeFrequency(440)).toEqual({note: 'A4', cents: 0, midi: 69});
    expect(describeFrequency(446).note).toBe('A4');
    expect(describeFrequency(446).cents).toBe(23);
    expect(describeFrequency(32.7).note).toBe('C1');
    expect(describeFrequency(0).note).toBe('');
    const bins = Float32Array.from([0, 0, 0.5, 1, 0.5, 0, 0, 0]);
    const symmetric = peakFrequency(bins, 1_600);
    expect(symmetric?.bin).toBe(3);
    expect(symmetric?.hz).toBeCloseTo(300);
    const skewed = peakFrequency(Float32Array.from([0, 0, 0.2, 1, 0.8, 0, 0, 0]), 1_600);
    expect(skewed?.hz).toBeGreaterThan(300);
    expect(skewed?.hz).toBeLessThan(400);
    expect(peakFrequency(new Float32Array(8), 1_600)).toBeUndefined();
    expect(spectralCentroid(Float32Array.from([0, 0, 0, 1]), 800)).toBeCloseTo(300);
    expect(spectralCentroid(new Float32Array(4), 800)).toBe(0);
  });
});

describe('time-domain helpers', () => {
  it('measures level, aligns a trigger and correlates channels', () => {
    const square = Float32Array.from([-1, -1, 1, 1, -1, -1, 1, 1]);
    expect(windowLevel(square)).toEqual({meanSquare: 1, peak: 1});
    expect(windowLevel(Float32Array.from([Number.NaN, 0.5])).peak).toBe(0.5);
    expect(alignTrigger(square, 4, 'rising')).toEqual({start: 2, triggered: true});
    expect(alignTrigger(square, 4, 'off')).toEqual({start: 4, triggered: false});
    expect(alignTrigger(new Float32Array(8).fill(0.3), 4, 'rising')).toEqual({start: 4, triggered: false});
    expect(alignTrigger(square, 100, 'rising')).toEqual({start: 0, triggered: false});
    const left = sine(100, 480, 0.5);
    expect(stereoCorrelation(left, left)).toBeCloseTo(1);
    expect(stereoCorrelation(left, Float32Array.from(left, (value) => -value))).toBeCloseTo(-1);
    expect(stereoCorrelation(left, new Float32Array(480))).toBe(0);
    expect(Math.abs(stereoCorrelation(left, sine(100, 480, 0.5, Math.PI / 2)))).toBeLessThan(0.05);
  });

  it('calibrates VU so a sine at the reference level reads 0 and deflects linearly in amplitude', () => {
    const referencePeak = Math.pow(10, -18 / 20);
    expect(vuFromRms(referencePeak / Math.SQRT2, -18)).toBeCloseTo(0, 9);
    expect(vuFromRms(0, -18)).toBe(-Infinity);
    expect(vuDeflection(3)).toBeCloseTo(1);
    expect(vuDeflection(0)).toBeCloseTo(0.708, 3);
    expect(vuDeflection(-20)).toBeCloseTo(0.0708, 3);
    expect(vuDeflection(-Infinity)).toBe(0);
    expect(vuDeflection(12)).toBe(1);
  });

  it('estimates loudness from timestamped windows', () => {
    const estimator = new LoudnessEstimator(3_000);
    expect(estimator.read(0, 400, 'k')).toBe(-Infinity);
    for (let time = 0; time <= 1_000; time += 50) estimator.push(time, 1, 0.25);
    expect(estimator.read(1_000, 400, 'k')).toBeCloseTo(-0.691, 6);
    expect(estimator.read(1_000, 400, 'none')).toBeCloseTo(10 * Math.log10(0.25), 6);
    estimator.push(5_000, 0, 0);
    expect(estimator.length).toBe(1);
    expect(estimator.read(5_000, 400, 'k')).toBe(-Infinity);
    estimator.clear();
    expect(estimator.length).toBe(0);
    expect(kWeightingRatio(Float32Array.from([-20, -20]), Float32Array.from([1, 1]))).toBeCloseTo(1);
    expect(kWeightingRatio(Float32Array.from([-20, -Infinity]), Float32Array.from([2, 0.5]))).toBeCloseTo(2);
    expect(kWeightingRatio(new Float32Array(0), new Float32Array(0))).toBe(1);
  });
});

describe('AudioMeterDisplay', () => {
  it('defaults, validates and reconfigures its options', () => {
    const display = createAudioMeterDisplay({type: 'bogus' as never, scale: 'nope' as never, bars: 2, windowSeconds: 0.1});
    expect(display.type).toBe('vu');
    expect(display.scale).toBe('log');
    expect(display.bars).toBe(4);
    expect(display.windowSeconds).toBe(0.5);
    expect(display.wantsStereo).toBe(false);
    display.configure({type: 'stereometer', bars: 0, loudnessMode: 'rms-slow', trigger: 'off', gain: 2});
    expect(display.type).toBe('stereometer');
    expect(display.wantsStereo).toBe(true);
    expect(display.bars).toBe(0);
    expect(display.loudnessMode).toBe('rms-slow');
    expect(display.trigger).toBe('off');
    expect(display.gain).toBe(2);
    expect(AUDIO_METER_DISPLAY_TYPES).toHaveLength(7);
  });

  it('reads a VU window with ballistics, hold and indicator lamps', () => {
    const display = new AudioMeterDisplay({type: 'vu', peakDecay: 0.1});
    const quiet = source({time: sine(480, 2_048, 0.05)});
    const first = display.capture(quiet, 0);
    expect(first.type).toBe('vu');
    if (first.type !== 'vu') return;
    const rms = Math.sqrt(windowLevel(quiet.time).meanSquare);
    expect(first.vu).toBeCloseTo(vuFromRms(rms, -18), 6);
    expect(first.deflection).toBeCloseTo(vuDeflection(first.vu), 6);
    expect(first.hold).toBeCloseTo(first.deflection, 6);
    expect(first.peakLit).toBe(false);
    expect(first.clipLit).toBe(false);
    expect(first.silent).toBe(false);

    const loud = source({time: sine(480, 2_048, 0.999_95)});
    const second = display.capture(loud, 16);
    if (second.type !== 'vu') return;
    // 16 ms into a 65 ms time constant the needle has not reached the new level.
    expect(second.vu).toBeGreaterThan(first.vu);
    expect(second.vu).toBeLessThan(vuFromRms(Math.sqrt(windowLevel(loud.time).meanSquare), -18));
    expect(second.peakLit).toBe(true);
    expect(second.clipLit).toBe(true);
    expect(second.hold).toBeGreaterThanOrEqual(second.deflection);
    const silent = display.capture(source({time: new Float32Array(2_048)}), 2_000);
    if (silent.type !== 'vu') return;
    expect(silent.silent).toBe(true);
    expect(silent.peakLit).toBe(false);
    expect(silent.clipLit).toBe(false);
    expect(silent.peakDbfs).toBe(-Infinity);
  });

  it('reads loudness from the stereo branch when present and from a doubled mono window otherwise', () => {
    const display = new AudioMeterDisplay({type: 'loudness', loudnessMode: 'rms-slow'});
    const mono = source({time: sine(1_000, 2_048, 0.5)});
    const fallback = display.capture(mono, 0);
    if (fallback.type !== 'loudness') return;
    expect(fallback.stereo).toBe(false);
    expect(fallback.unit).toBe('dB');
    expect(fallback.value).toBeCloseTo(10 * Math.log10(windowLevel(mono.time).meanSquare), 3);
    expect(mono.reads).not.toContain('decibels');

    display.clear();
    const left = sine(1_000, 2_048, 0.5);
    const right = sine(1_000, 2_048, 0.25);
    const stereo = source({stereo: {left, right}});
    const summed = display.capture(stereo, 0);
    if (summed.type !== 'loudness') return;
    expect(summed.stereo).toBe(true);
    expect(summed.value).toBeCloseTo(10 * Math.log10((windowLevel(left).meanSquare + windowLevel(right).meanSquare) / 2), 3);
    expect(summed.peakDbfs).toBeCloseTo(20 * Math.log10(0.5), 1);

    display.configure({loudnessMode: 'momentary'});
    const weighted = display.capture(stereo, 50);
    if (weighted.type !== 'loudness') return;
    expect(weighted.unit).toBe('LUFS');
    expect(weighted.mode).toBe('momentary');
    expect(Number.isFinite(weighted.value)).toBe(true);
    expect(stereo.reads).toContain('decibels');
    expect(weighted.peakHoldDbfs).toBeGreaterThanOrEqual(weighted.peakDbfs);
  });

  it('keeps bounded waveform and spectrogram histories with the axis it was given', () => {
    const display = new AudioMeterDisplay({type: 'waveform', windowSeconds: 0.5, columnsPerSecond: 10});
    const input = source();
    display.capture(input, 0);
    const second = display.capture(input, 100);
    if (second.type !== 'waveform') return;
    expect(second.history.rows).toBe(3);
    expect(second.history.length).toBe(2);
    expect(second.history.capacity).toBe(5);
    expect(second.gain).toBe(1.8);
    const column = second.history.at(1)!;
    expect(column.values[0]).toBeCloseTo(-0.5, 2);
    expect(column.values[1]).toBeCloseTo(0.5, 2);
    expect(column.values[2]).toBeGreaterThan(0);
    expect(column.values[2]).toBeLessThan(1);

    display.configure({type: 'spectrogram', spectrogramRows: 16});
    expect(display.history).toBeUndefined();
    const spectrogram = display.capture(input, 200);
    if (spectrogram.type !== 'spectrogram') return;
    expect(spectrogram.history.rows).toBe(16);
    expect(spectrogram.history.length).toBe(1);
    expect(spectrogram.maxHz).toBe(20_000);
    expect(spectrogram.scale).toBe('log');
    expect(Math.max(...spectrogram.history.at(0)!.values)).toBeGreaterThan(0);
    display.configure({scale: 'mel'});
    expect(display.history).toBeUndefined();
  });

  it('aligns an oscilloscope window to the latest rising crossing within the timebase', () => {
    const display = new AudioMeterDisplay({type: 'oscilloscope', timebaseMs: 1});
    const input = source();
    const aligned = display.capture(input, 0);
    if (aligned.type !== 'oscilloscope') return;
    expect(aligned.samples).toHaveLength(49);
    expect(aligned.triggered).toBe(true);
    expect(aligned.samples[0]).toBeGreaterThanOrEqual(0);
    expect(aligned.timebaseMs).toBeCloseTo(1, 6);
    display.configure({trigger: 'off', timebaseMs: 1_000});
    const free = display.capture(input, 16);
    if (free.type !== 'oscilloscope') return;
    expect(free.triggered).toBe(false);
    expect(free.samples).toHaveLength(2_048);
    expect(free.silent).toBe(false);
  });

  it('describes the loudest spectrum bin and bounds the bar count', () => {
    const display = new AudioMeterDisplay({type: 'spectrum', bars: 3});
    const snapshot = display.capture(source(), 0);
    if (snapshot.type !== 'spectrum') return;
    expect(snapshot.bars).toBe(4);
    expect(snapshot.maxHz).toBe(20_000);
    expect(snapshot.peak?.hz).toBeCloseTo(4 * (SAMPLE_RATE / 2 / BINS));
    expect(snapshot.peak?.decibels).toBeCloseTo(-30);
    expect(snapshot.peak?.note).toBe(describeFrequency(6_000).note);
    expect(snapshot.silent).toBe(false);
    const empty = display.capture(source({spectrum: new Float32Array(BINS)}), 16);
    if (empty.type !== 'spectrum') return;
    expect(empty.peak).toBeUndefined();
    expect(empty.silent).toBe(true);
  });

  it('mirrors a mono window for the stereometer and smooths correlation', () => {
    const display = new AudioMeterDisplay({type: 'stereometer', gain: 1});
    const mono = source();
    const mirrored = display.capture(mono, 0);
    if (mirrored.type !== 'stereometer') return;
    expect(mirrored.stereo).toBe(false);
    expect(Array.from(mirrored.right)).toEqual(Array.from(mirrored.left));
    expect(mirrored.correlation).toBeCloseTo(1);
    expect(mirrored.gain).toBe(1);
    expect(mirrored.hue).toBeGreaterThan(0);

    const left = sine(1_000, 2_048, 0.5);
    const inverted = Float32Array.from(left, (value) => -value);
    const wide = display.capture(source({stereo: {left, right: inverted}}), 100);
    if (wide.type !== 'stereometer') return;
    expect(wide.stereo).toBe(true);
    // 100 ms into a 250 ms time constant: on the way to -1 but not there yet.
    expect(wide.correlation).toBeLessThan(0.5);
    expect(wide.correlation).toBeGreaterThan(-1);
    const silent = display.capture(source({stereo: {left: new Float32Array(8), right: new Float32Array(8)}}), 200);
    if (silent.type !== 'stereometer') return;
    expect(silent.silent).toBe(true);
    expect(silent.correlation).toBe(0);
  });
});
