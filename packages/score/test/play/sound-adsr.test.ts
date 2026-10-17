import {describe, expect, it, vi} from 'vitest';
import {Sound} from '../../src/play/headless/sound';

function audioFixture() {
  const param = () => ({
    value: 0, automationRate: 'a-rate',
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const nodes: ReturnType<typeof makeNode>[] = [];
  const voices: ReturnType<typeof makeNode>[] = [];
  const constants: ReturnType<typeof makeNode>[] = [];
  const filters: ReturnType<typeof makeNode>[] = [];
  const context = {currentTime: 0, sampleRate: 8000} as unknown as AudioContext;
  function makeNode() {
    return {
      context, gain: param(), frequency: param(), detune: param(), Q: param(), offset: param(),
      start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(),
      connect: vi.fn((destination: unknown) => destination), setPeriodicWave: vi.fn(), onended: null as (() => void) | null,
    };
  }
  function node() {
    const value = makeNode();
    nodes.push(value);
    return value;
  }
  Object.assign(context, {
    createGain: node,
    createOscillator: () => { const value = node(); voices.push(value); return value; },
    createBufferSource: () => { const value = node(); voices.push(value); return value; },
    createConstantSource: () => { const value = node(); constants.push(value); return value; },
    createBiquadFilter: () => { const value = node(); filters.push(value); return value; },
    createPeriodicWave: () => ({}),
    createBuffer: (_channels: number, length: number) => ({getChannelData: () => new Float32Array(length)}),
  });
  return {context, destination: node() as unknown as AudioNode, nodes, voices, constants, filters};
}

const factories = [
  ['oscillator', () => Sound.oscillator({releaseSeconds: 0.2})],
  ['fm', () => Sound.fm({releaseSeconds: 0.2})],
  ['wavetable', () => Sound.wavetable({releaseSeconds: 0.2})],
  ['noise', () => Sound.noise({releaseSeconds: 0.2})],
] as const;

describe('native Sound note occurrences and ADSR', () => {
  it.each(factories)('%s holds same-pitch occurrences independently and captures envelope settings at onset', (_name, create) => {
    const {destination, voices} = audioFixture();
    const sound = create();
    expect(sound.params.get('decaySeconds')!.snapshot.baseValue).toBe(0);
    sound.params.get('decaySeconds')!.setBaseValue(0.3);
    sound.params.get('sustainLevel')!.setBaseValue(0.4);
    sound.connect(destination);
    expect(sound.supportsNoteOccurrences).toBe(true);
    const first = sound.noteOn(60, 127, 0, Infinity);
    const firstCount = voices.length;
    const second = sound.noteOn(60, 127, 0, Infinity);
    expect(second).not.toBe(first);
    expect(voices.every((voice) => voice.stop.mock.calls.length === 0)).toBe(true);
    sound.params.get('releaseSeconds')!.setBaseValue(0.5);
    sound.noteOffById(first, 1);
    for (const voice of voices.slice(0, firstCount)) expect(voice.stop).toHaveBeenLastCalledWith(1.2);
    for (const voice of voices.slice(firstCount)) expect(voice.stop).not.toHaveBeenCalled();
    const later = sound.noteOn(62, 127, 2, Infinity);
    sound.noteOffById(later, 3);
    expect(voices.at(-1)!.stop).toHaveBeenLastCalledWith(3.5);
    sound.dispose();
    for (const voice of voices) expect(voice.stop).toHaveBeenLastCalledWith(0);
  });

  it('sample voices use the same decay/sustain and analytic early-release contract', async () => {
    class BufferFixture { readonly length = 8000; readonly numberOfChannels = 1; }
    vi.stubGlobal('AudioBuffer', BufferFixture);
    const {destination, voices, nodes} = audioFixture();
    const sound = Sound.samples({60: new BufferFixture() as unknown as AudioBuffer}, {
      attackSeconds: 1, decaySeconds: 1, sustainLevel: 0.25, releaseSeconds: 0.5,
    });
    try {
      sound.connect(destination);
      await sound.preload();
      const first = sound.noteOn(60, 127, 0, Infinity);
      sound.noteOn(60, 127, 0, Infinity);
      const envelopes = nodes.filter((node) => node.gain.linearRampToValueAtTime.mock.calls.length);
      expect(envelopes[0].gain.linearRampToValueAtTime.mock.calls).toEqual([[1, 1], [0.25, 2]]);
      sound.noteOffById(first, 1.5);
      expect(envelopes[0].gain.linearRampToValueAtTime.mock.calls.slice(-2)).toEqual([[0.625, 1.5], [0, 2]]);
      expect(voices[0].stop).toHaveBeenLastCalledWith(2);
      expect(voices[1].stop).not.toHaveBeenCalled();
    } finally {
      sound.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('still stops every sample source when one envelope cancellation fails', async () => {
    class BufferFixture { readonly length = 8000; readonly numberOfChannels = 1; }
    vi.stubGlobal('AudioBuffer', BufferFixture);
    const {destination, voices, nodes} = audioFixture();
    const sound = Sound.samples({60: new BufferFixture() as unknown as AudioBuffer});
    try {
      sound.connect(destination);
      await sound.preload();
      sound.noteOn(60, 127, 10, Infinity);
      sound.noteOn(60, 127, 10, Infinity);
      const envelopes = nodes.filter((node) => node.gain.linearRampToValueAtTime.mock.calls.length);
      envelopes[0].gain.cancelScheduledValues.mockImplementationOnce(() => { throw new Error('envelope unavailable'); });
      expect(() => sound.noteOff(60, 1)).toThrow('envelope unavailable');
      for (const source of voices) expect(source.stop).toHaveBeenLastCalledWith(1);
    } finally {
      sound.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('releasing a native Sound route stops its held and releasing voices but retains reusable configuration', () => {
    const {destination, voices} = audioFixture();
    const sound = Sound.oscillator();
    const sustain = sound.params.get('sustainLevel')!;
    sustain.setBaseValue(0.35);
    const release = sound.connect(destination);
    const first = sound.noteOn(60, 127, 0, Infinity);
    sound.noteOn(64, 127, 0, Infinity);
    sound.noteOffById(first, 0.2);
    release();
    for (const voice of voices) expect(voice.stop).toHaveBeenLastCalledWith(0);
    expect(sustain.snapshot.disposed).toBe(false);
    expect(sustain.snapshot.baseValue).toBe(0.35);
    expect(() => sound.connect(destination)).not.toThrow();
    sound.dispose();
  });

  it('fans out one parameter bus to current and future voices without double-counting base', () => {
    const {context, destination, filters, constants, voices} = audioFixture();
    const sound = Sound.oscillator({cutoff: 1200});
    sound.connect(destination);
    sound.noteOn(60, 127, 0, Infinity);
    expect(constants).toHaveLength(0);
    expect(filters[0].frequency.value).toBe(1200);
    const cutoff = sound.params.get('cutoff')!;
    const signal = {output: context.createGain(), range: {min: -1, max: 1}, rate: 'a-rate' as const};
    const mapping = cutoff.connectModulation(signal, {depth: 100});
    const bus = constants[0];
    expect(bus.offset.value).toBe(1200);
    expect(filters[0].frequency.value).toBe(0);
    sound.noteOn(64, 127, 0, Infinity);
    expect(filters[1].frequency.value).toBe(0);
    expect(bus.connect).toHaveBeenCalledWith(filters[0].frequency);
    expect(bus.connect).toHaveBeenCalledWith(filters[1].frequency);
    cutoff.setBaseValue(1800);
    expect(bus.offset.setValueAtTime).toHaveBeenLastCalledWith(1800, 0);
    expect(filters.every((filter) => filter.frequency.value === 0)).toBe(true);
    voices[0].onended?.();
    expect(bus.disconnect).toHaveBeenCalledWith(filters[0].frequency);
    expect(bus.disconnect).not.toHaveBeenCalledWith(filters[1].frequency);
    mapping.release();
    expect(cutoff.snapshot.baseValue).toBe(1800);
    sound.dispose();
    expect(bus.stop).toHaveBeenCalledOnce();
  });
});
