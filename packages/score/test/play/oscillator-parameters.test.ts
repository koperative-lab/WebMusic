import {describe, expect, it, vi} from 'vitest';
import {OscillatorSynth} from '../../src/play/headless/oscillator-synth';
import {Sound} from '../../src/play/headless/sound';

function fixture() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const node = <T extends object>(properties: T) => ({
    connect: vi.fn((destination: unknown) => destination), disconnect: vi.fn(), ...properties,
  });
  type Parameter = ReturnType<typeof param>;
  const gains: Array<{gain: Parameter}> = [];
  const filters: Array<{frequency: Parameter; Q: Parameter}> = [];
  const oscillators: Array<{frequency: Parameter; detune: Parameter; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>}> = [];
  const context = {
    currentTime: 0,
    createGain: vi.fn(() => { const result = node({gain: param()}); gains.push(result); return result; }),
    createBiquadFilter: vi.fn(() => { const result = node({frequency: param(), Q: param()}); filters.push(result); return result; }),
    createOscillator: vi.fn(() => {
      const result = node({frequency: param(), detune: param(), start: vi.fn(), stop: vi.fn()});
      oscillators.push(result); return result;
    }),
  } as unknown as AudioContext;
  const destination = {...node({}), context} as unknown as AudioNode;
  return {context, destination, gains, filters, oscillators};
}

describe('authoritative oscillator and Sound parameters', () => {
  it('writes the same handles through setParam and updates current and subsequent voices', () => {
    const {context, filters, oscillators, gains} = fixture();
    const synth = new OscillatorSynth(context);
    const params = synth.params;
    const notify = vi.fn();
    params.get('cutoff')!.subscribe(notify);
    synth.setParam('cutoff', 1200);
    expect(params.get('cutoff')!.snapshot.baseValue).toBe(1200);
    params.get('detune')!.setBaseValue(25);
    params.get('gain')!.setBaseValue(0.4);
    params.get('attackSeconds')!.setBaseValue(0.2);
    params.get('releaseSeconds')!.setBaseValue(0.3);
    const voice = synth.noteOn(60, 127, 1, 2);
    expect(filters[0].frequency.value).toBe(1200);
    expect(oscillators[0].detune.value).toBe(25);
    expect(gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 1.2);
    expect(gains[2].gain.value).toBe(0.4);
    synth.noteOffById(voice, 1.5);
    expect(oscillators[0].stop).toHaveBeenLastCalledWith(1.8);
    params.get('cutoff')!.setBaseValue(2400);
    synth.noteOn(62, 100, 2, 1);
    expect(filters[1].frequency.value).toBe(2400);
    expect(filters[0].frequency.value).toBe(2400);
    expect(synth.params).toBe(params);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(params.get('cutoff')!.descriptor.modulation).toBe('audio-rate');
    synth.dispose();
    expect(params.get('cutoff')!.snapshot.disposed).toBe(true);
  });

  it('keeps oscillator handles and values stable before connection and across new backends', () => {
    const {context, destination, filters} = fixture();
    const sound = Sound.oscillator();
    const params = sound.params;
    const cutoff = params.get('cutoff')!;
    cutoff.setBaseValue(1700);
    expect(context.createGain).not.toHaveBeenCalled();
    const release = sound.connect(destination);
    sound.noteOn(60, 100, 0, 0.5);
    expect(filters[0].frequency.value).toBe(1700);
    release();
    cutoff.setBaseValue(3400);
    sound.connect(destination);
    sound.noteOn(60, 100, 1, 0.5);
    expect(sound.params).toBe(params);
    expect(sound.params.get('cutoff')).toBe(cutoff);
    expect(filters[1].frequency.value).toBe(3400);
    sound.dispose();
    // Sound's reusable configuration survives backend teardown.
    expect(cutoff.snapshot.disposed).toBe(false);
  });

  it('keeps useful control viewports independent of broader legal parameter values', () => {
    const oscillator = Sound.oscillator({cutoff: 20000, attackSeconds: 10});
    const expected = {
      gain: {min: 0, max: 1}, detune: {min: -1200, max: 1200},
      cutoff: {min: 20, max: 12000}, resonance: {min: 0, max: 20},
      attackSeconds: {min: 0, max: 2}, decaySeconds: {min: 0, max: 2},
      sustainLevel: {min: 0, max: 1}, releaseSeconds: {min: 0, max: 5},
    };
    for (const [id, range] of Object.entries(expected)) {
      expect(oscillator.params.get(id)!.descriptor.displayRange).toEqual(range);
    }
    expect(oscillator.params.get('resonance')!.descriptor.unit).toBe('dB');
    oscillator.params.get('cutoff')!.setBaseValue(30000);
    oscillator.params.get('attackSeconds')!.setBaseValue(20);
    expect(oscillator.params.get('cutoff')!.snapshot.baseValue).toBe(30000);
    expect(oscillator.params.get('attackSeconds')!.snapshot.baseValue).toBe(20);
    for (const sound of [Sound.fm(), Sound.wavetable(), Sound.noise(), Sound.samples({})]) {
      for (const id of ['attackSeconds', 'decaySeconds', 'sustainLevel', 'releaseSeconds'] as const) {
        expect(sound.params.get(id)!.descriptor.displayRange).toEqual(expected[id]);
      }
    }
  });

  it('rejects invalid envelope settings before creating any native audio resources', () => {
    const {context} = fixture();
    for (const options of [{sustainLevel: 1.1}, {sustainLevel: -0.1}, {attackSeconds: -1}, {decaySeconds: -1}, {releaseSeconds: NaN}]) {
      expect(() => new OscillatorSynth(context, options)).toThrow(/Invalid envelope/);
      expect(() => Sound.oscillator(options)).toThrow(/Invalid envelope/);
    }
    expect(context.createGain).not.toHaveBeenCalled();
  });

  it('shares live bus gain with setGain and supports the historical positive boost range', () => {
    const {destination, gains} = fixture();
    const sound = Sound.custom({noteOn() {}}, {gain: 0.25});
    const gain = sound.params.get('busGain')!;
    sound.connect(destination);
    gain.setBaseValue(0.6);
    expect(gains[0].gain.value).toBe(0.6);
    sound.setGain(2);
    expect(gain.snapshot.baseValue).toBe(2);
    expect(gains[0].gain.value).toBe(2);
    sound.setGain(-1);
    expect(gain.snapshot.baseValue).toBe(0);
    sound.dispose();
  });
});
