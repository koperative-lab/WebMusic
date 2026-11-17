import {describe, expect, it} from 'vitest';
import {
  TICKS_PER_QUARTER, barsBeatsTicksAt, createMusicalTempo, formatBarsBeatsTicks, nextGridTime, secondsAtBarsBeatsTicks,
  timeValueSeconds, timeValueTicks,
} from '../src/transport';
import {VoiceAllocator, decodeOsc, encodeOsc, isOscBundle, parseModuleProject} from '../src/module';
import {createFFT, createSpectralFrame, hannWindow} from '../src/processor-worklet';

describe('musical time', () => {
  const tempo = createMusicalTempo({bpm: 120, beatsPerBar: 3, beatUnit: 4});
  it('reads note values, dotted and triplet, bars.beats.ticks and plain times', () => {
    expect(timeValueTicks('4n')).toBe(TICKS_PER_QUARTER);
    expect(timeValueTicks('8nd')).toBe(360);
    expect(timeValueTicks('8nt')).toBe(160);
    expect(timeValueTicks('1.0.0', tempo)).toBe(1440);
    expect(timeValueTicks('0.1.240', tempo)).toBe(720);
    expect(timeValueTicks('250ms')).toBeUndefined();
    expect(timeValueSeconds('4n', tempo)).toBe(0.5);
    expect(timeValueSeconds('250ms')).toBe(0.25);
    expect(timeValueSeconds('0.5s')).toBe(0.5);
    expect(timeValueSeconds('2hz')).toBe(0.5);
    expect(timeValueSeconds('100')).toBe(0.1);
    expect(() => timeValueSeconds('3n')).toThrow(/note value/);
    expect(() => timeValueSeconds('soon')).toThrow(SyntaxError);
    expect(() => createMusicalTempo({beatUnit: 3})).toThrow();
  });

  it('converts between seconds and bars:beats:ticks in a meter', () => {
    expect(formatBarsBeatsTicks(barsBeatsTicksAt(0, tempo))).toBe('1.1.0');
    expect(formatBarsBeatsTicks(barsBeatsTicksAt(1.75, tempo))).toBe('2.1.240');
    expect(secondsAtBarsBeatsTicks({bar: 2, beat: 1, tick: 240}, tempo)).toBe(1.75);
    const sixEight = createMusicalTempo({bpm: 120, beatsPerBar: 6, beatUnit: 8});
    expect(formatBarsBeatsTicks(barsBeatsTicksAt(1.5, sixEight))).toBe('2.1.0');
    expect(nextGridTime(1.1, 0.5)).toBe(1.5);
    expect(nextGridTime(1.5, 0.5)).toBe(1.5);
  });

  it('saves tempo in a project session', () => {
    const project = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'p', contexts: [{id: 'root'}], modules: [],
      session: {positionSeconds: 0, rate: 1, tempo: {bpm: 96, beatsPerBar: 7, beatUnit: 8}}});
    expect(project.session.tempo).toEqual({bpm: 96, beatsPerBar: 7, beatUnit: 8});
    expect(() => parseModuleProject({...project, session: {...project.session, tempo: {bpm: 96, beatsPerBar: 7, beatUnit: 6}}})).toThrow();
  });
});

describe('voices', () => {
  it('takes free voices in turn and steals the oldest', () => {
    const voices = new VoiceAllocator(2);
    expect(voices.noteOn('a')).toEqual({voice: 0});
    expect(voices.noteOn('b')).toEqual({voice: 1});
    expect(voices.noteOn('a')).toEqual({voice: 0});
    expect(voices.noteOn('c')).toEqual({voice: 0, stolen: 'a'});
    expect(voices.noteOff('b')).toBe(1);
    expect(voices.noteOff('b')).toBeUndefined();
    expect(voices.noteOn('d')).toEqual({voice: 1});
    expect(voices.held).toEqual(['c', 'd']);
    expect(new VoiceAllocator(1, 'none').noteOn('x')).toEqual({voice: 0});
    const full = new VoiceAllocator(1, 'none'); full.noteOn('x');
    expect(full.noteOn('y')).toEqual({voice: undefined});
  });
});

describe('OSC', () => {
  it('round-trips messages and bundles', () => {
    const message = {address: '/synth/cutoff', args: [{type: 'f' as const, value: 0.5}, {type: 'i' as const, value: -3}, {type: 's' as const, value: 'saw'}, {type: 'T' as const}, {type: 'b' as const, value: new Uint8Array([1, 2, 3])}]};
    const bytes = encodeOsc(message);
    expect(bytes.length % 4).toBe(0);
    expect(decodeOsc(bytes)).toEqual(message);
    const bundle = decodeOsc(encodeOsc({timetag: 1n, elements: [message, {address: '/go', args: []}]}));
    expect(isOscBundle(bundle) && bundle.elements).toHaveLength(2);
    expect(() => encodeOsc({address: 'no', args: []})).toThrow();
    expect(() => decodeOsc(new Uint8Array([47, 97]))).toThrow(/not terminated/);
  });
});

describe('spectral kit', () => {
  it('transforms a sine to one bin and back', () => {
    const fft = createFFT(64);
    const real = Float32Array.from({length: 64}, (_, n) => Math.cos((2 * Math.PI * 4 * n) / 64)), imag = new Float32Array(64);
    const original = real.slice();
    fft.forward(real, imag);
    expect(Math.hypot(real[4]!, imag[4]!)).toBeCloseTo(32, 3);
    expect(Math.hypot(real[5]!, imag[5]!)).toBeCloseTo(0, 3);
    fft.inverse(real, imag);
    for (let n = 0; n < 64; n++) expect(real[n]).toBeCloseTo(original[n]!, 4);
    expect(() => createFFT(48)).toThrow();
    expect(hannWindow(4)).toEqual(Float32Array.from([0, 0.5, 1, 0.5]));
  });

  it('overlap-adds an untouched spectrum back into the input, delayed by its latency', () => {
    const frame = createSpectralFrame({size: 64, hop: 16});
    const input = Float32Array.from({length: 1024}, (_, n) => Math.sin(n * 0.37) + 0.3 * Math.sin(n * 1.9));
    const output = new Float32Array(1024);
    for (let start = 0; start < 1024; start += 50) frame.process(input.subarray(start, start + 50), output.subarray(start, start + 50), () => {});
    for (let n = 3 * 64; n < 1024; n++) expect(output[n]).toBeCloseTo(input[n - frame.latency]!, 3);
  });
});
