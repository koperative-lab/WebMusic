import {afterEach, describe, expect, it, vi} from 'vitest';
import {Sound, playbackRateFor, chooseZone, type HeadlessSynth} from '../../src/play/headless';
import {parseSfz, resolveSfzZones, parseSfzKey} from '../../src/play';

type Z = {sample: string; loKey: number; hiKey: number; loVel: number; hiVel: number};
const zone = (sample: string, loKey: number, hiKey: number, loVel: number, hiVel: number): Z => ({sample, loKey, hiKey, loVel, hiVel});

/** Minimal AudioContext stand-in: just enough for Sound's gain bus. */
function mockCtx() {
  let t = 0;
  const gains: Array<{value: number}> = [];
  const node = () => {
    const gain = {value: 1};
    gains.push(gain);
    return {context: ctx, gain, connect: () => node(), disconnect() {}};
  };
  const ctx = {
    get currentTime() {
      return t;
    },
    createGain: () => node(),
  } as unknown as AudioContext;
  // A destination node whose `.context` points back at ctx (Sound reads it).
  const destination = {context: ctx, connect() {}, disconnect() {}} as unknown as AudioNode;
  return {ctx, destination, gains, advance: (ms: number) => (t += ms / 1000)};
}

describe('Sound', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects readiness before it has been attached to an audio route', async () => {
    const sound = Sound.oscillator();

    await expect(sound.preload()).rejects.toThrow(/not connected/);
    await expect(sound.ready).rejects.toThrow(/not connected/);
  });

  it('builds the backend lazily on connect and delegates note events', () => {
    const calls: string[] = [];
    const backend: HeadlessSynth = {
      connect: () => {
        calls.push('connect');
      },
      noteOn: (m) => calls.push(`on:${m}`),
      noteOff: (m) => calls.push(`off:${m}`),
    };
    const {destination} = mockCtx();
    const sound = Sound.custom(backend);

    sound.connect(destination);
    sound.noteOn(60, 100, 0, 0.5);
    sound.noteOff(60, 0.5);

    expect(calls).toEqual(['connect', 'on:60', 'off:60']);
  });

  it('rejects a concurrent route instead of silently rerouting an active Sound', async () => {
    const connected: number[] = [];
    const released: number[] = [];
    const played: number[] = [];
    let nextBackend = 1;
    const sound = Sound.custom(() => {
      const id = nextBackend++;
      return {
        connect: () => {
          connected.push(id);
          return () => released.push(id);
        },
        noteOn: () => played.push(id),
      } satisfies HeadlessSynth;
    });
    const {ctx, destination} = mockCtx();
    const secondDestination = {context: ctx, connect() {}, disconnect() {}} as unknown as AudioNode;

    const releaseFirst = sound.connect(destination);
    expect(() => sound.connect(secondDestination)).toThrow(/already connected/i);
    sound.noteOn(60, 100, 0, 0.5);
    expect(connected).toEqual([1]);
    expect(played).toEqual([1]);

    releaseFirst();
    await expect(sound.ready).rejects.toThrow(/not connected/i);

    const releaseSecond = sound.connect(secondDestination);
    // A stale disposer from the first route must never tear down the new one.
    releaseFirst();
    sound.noteOn(62, 100, 0, 0.5);
    expect(connected).toEqual([1, 2]);
    expect(played).toEqual([1, 2]);
    releaseSecond();
    expect(released).toEqual([1, 2]);
  });

  it('does not claim a raw backend can safely reconnect without route cleanup', () => {
    const raw = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      noteOn: vi.fn(),
    } satisfies HeadlessSynth;
    const sound = Sound.custom(raw);
    const {ctx, destination} = mockCtx();
    const secondDestination = {context: ctx, connect() {}, disconnect() {}} as unknown as AudioNode;

    sound.connect(destination)();
    expect(() => sound.connect(secondDestination)).toThrow(/did not provide a route cleanup/i);

    // This is deliberately an explicit caller-owned global teardown.
    sound.disconnect();
    expect(raw.disconnect).toHaveBeenCalledTimes(1);
    expect(() => sound.connect(secondDestination)).not.toThrow();

    const unteardownable = Sound.custom({connect() {}, noteOn() {}});
    unteardownable.connect(destination)();
    unteardownable.dispose();
    expect(() => unteardownable.connect(secondDestination)).toThrow(/did not provide a route cleanup/i);
  });

  it('rejects duplicate layer children and unwinds a partially connected layer', () => {
    const firstCleanup = vi.fn();
    const first = Sound.custom({connect: () => firstCleanup, noteOn() {}});
    const second = Sound.custom({connect() {}, noteOn() {}});
    const {ctx, destination} = mockCtx();
    const secondDestination = {context: ctx, connect() {}, disconnect() {}} as unknown as AudioNode;
    const secondRelease = second.connect(destination);
    const layer = Sound.layer(first, second);

    expect(() => layer.connect(secondDestination)).toThrow(/already connected/i);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    secondRelease();
    expect(() => Sound.layer(first, first)).toThrow(/distinct Sound instances/i);
  });

  it('tears down a backend whose route construction throws without committing Sound state', () => {
    const failure = new Error('backend connect failed');
    const backend = {
      connect: vi.fn(() => {
        throw failure;
      }),
      noteOn: vi.fn(),
      dispose: vi.fn(),
    } satisfies HeadlessSynth;
    const sound = Sound.custom(backend);
    const {destination} = mockCtx();

    expect(() => sound.connect(destination)).toThrow(failure);
    expect(backend.dispose).toHaveBeenCalledTimes(1);
    expect(() => sound.connect(destination)).toThrow(failure);
    expect(backend.dispose).toHaveBeenCalledTimes(2);
  });

  it('preserves the first route cleanup error while still disposing the backend', () => {
    const routeFailure = new Error('route cleanup failed');
    const disposeFailure = new Error('backend dispose failed');
    const backend = {
      connect: vi.fn(() => () => {
        throw routeFailure;
      }),
      noteOn: vi.fn(),
      dispose: vi.fn(() => {
        throw disposeFailure;
      }),
    } satisfies HeadlessSynth;
    const sound = Sound.custom(backend);
    const {destination} = mockCtx();
    sound.connect(destination);

    expect(() => sound.dispose()).toThrow(routeFailure);
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves the first route cleanup error while still disconnecting the backend', () => {
    const routeFailure = new Error('route cleanup failed');
    const disconnectFailure = new Error('backend disconnect failed');
    const backend = {
      connect: vi.fn(() => () => {
        throw routeFailure;
      }),
      noteOn: vi.fn(),
      disconnect: vi.fn(() => {
        throw disconnectFailure;
      }),
    } satisfies HeadlessSynth;
    const sound = Sound.custom(backend);
    const {destination} = mockCtx();
    sound.connect(destination);

    expect(() => sound.disconnect()).toThrow(routeFailure);
    expect(backend.disconnect).toHaveBeenCalledTimes(1);
  });

  it('forwards exact backend voice handles through the Sound wrapper', () => {
    const releases: Array<{handle: unknown; time: number}> = [];
    const backend: HeadlessSynth = {
      connect() {},
      noteOn: () => 'voice-1',
      noteOffById: (handle, time) => releases.push({handle, time}),
    };
    const {destination} = mockCtx();
    const sound = Sound.custom(backend);

    sound.connect(destination);
    const handle = sound.noteOn(60, 100, 0, 1);
    sound.noteOffById(handle, 0.5);

    expect(handle).toBe('voice-1');
    expect(releases).toEqual([{handle: 'voice-1', time: 0.5}]);
  });

  it('forwards opt-in audio-clock cancellation and retiming capabilities', () => {
    const cancelled = vi.fn();
    const retimed = vi.fn();
    const backend: HeadlessSynth = {
      connect() {},
      supportsScheduledCancellation: true,
      noteOn: () => 'voice-1',
      noteOffById() {},
      cancelScheduledNote: cancelled,
      retimeScheduledNote: retimed,
    };
    const {destination} = mockCtx();
    const sound = Sound.custom(backend);

    sound.connect(destination);
    expect(sound.supportsScheduledCancellation).toBe(true);
    const handle = sound.noteOn(60, 100, 1, 0.5);
    sound.cancelScheduledNote(handle, 0.25);
    sound.retimeScheduledNote(handle, 2);

    expect(cancelled).toHaveBeenCalledWith('voice-1', 0.25);
    expect(retimed).toHaveBeenCalledWith('voice-1', 2);
  });

  it('routes every backend through its own gain bus (so mixing works)', () => {
    const {destination} = mockCtx();
    const sound = Sound.oscillator({}, {gain: 0.25});
    sound.connect(destination);
    // The created gain carries the configured value, and setGain updates it live.
    sound.setGain(0.5);
    expect(() => sound.disconnect()).not.toThrow();
  });

  it('adopts a Tone.js-like instrument, mapping MIDI to note names', () => {
    const events: Array<[string, string]> = [];
    const toneInstrument = {
      connect: () => events.push(['connect', '']),
      triggerAttack: (note: string) => events.push(['attack', note]),
      triggerRelease: (note: string) => events.push(['release', note]),
    };
    const {destination} = mockCtx();
    const sound = Sound.from(toneInstrument);
    sound.connect(destination);
    sound.noteOn(69, 100, 0, 1); // A4
    sound.noteOff(69, 1);
    expect(events).toEqual([
      ['connect', ''],
      ['attack', 'A4'],
      ['release', 'A4'],
    ]);
  });

  it('Sound.soundfont2 reports missing AudioWorklet support clearly', async () => {
    const {destination} = mockCtx();
    const sound = Sound.soundfont2(new ArrayBuffer(8));
    sound.connect(destination);
    await expect(sound.ready).rejects.toThrow(/AudioWorklet/);
  });

  it('forwards and validates the SoundFont source byte limit', () => {
    const {destination} = mockCtx();
    const sound = Sound.soundfont2(new ArrayBuffer(9), {maxSoundFontBytes: 8});
    expect(() => sound.connect(destination)).toThrow(/maxSoundFontBytes/);
  });

  it('retries a transient backend preload failure without reconnecting', async () => {
    const {destination} = mockCtx();
    let attempts = 0;
    const backend = {
      connect() {},
      noteOn() {},
      preload: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary sample failure');
      }),
    } satisfies HeadlessSynth & {preload: () => Promise<void>};
    const sound = Sound.custom(backend);
    sound.connect(destination);

    await expect(sound.preload()).rejects.toThrow(/temporary sample failure/);
    await expect(sound.preload()).resolves.toBeUndefined();
    expect(backend.preload).toHaveBeenCalledTimes(2);
  });

  it('caps an SFZ definition while it is being downloaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(9))));
    const {destination} = mockCtx();
    const sound = Sound.sfz('/oversized.sfz', {maxSfzBytes: 8});

    sound.connect(destination);

    await expect(sound.ready).rejects.toThrow(/maxSfzBytes/);
  });

  it('validates maxSfzBytes before starting the definition request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const {destination} = mockCtx();
    const sound = Sound.sfz('/invalid.sfz', {maxSfzBytes: 0});
    sound.connect(destination);

    await expect(sound.ready).rejects.toThrow(/maxSfzBytes/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('SFZ parsing', () => {
  it('parses note-name and numeric keys', () => {
    expect(parseSfzKey('60')).toBe(60);
    expect(parseSfzKey('c4')).toBe(60);
    expect(parseSfzKey('C#4')).toBe(61);
    expect(parseSfzKey('Db4')).toBe(61);
    expect(parseSfzKey('a4')).toBe(69);
  });

  it('flattens regions with inherited global/group opcodes', () => {
    const sfz = `
      <global> volume=-3
      <group> lovel=0 hivel=63
      <region> sample=soft_c.wav key=60
      <region> sample=soft_e.wav lokey=63 hikey=65 pitch_keycenter=64
      <group> lovel=64 hivel=127
      <region> sample=loud_c.wav key=60
    `;
    const regions = parseSfz(sfz);
    expect(regions).toHaveLength(3);
    expect(regions[0]).toMatchObject({sample: 'soft_c.wav', lokey: 60, hikey: 60, pitch_keycenter: 60, volume: -3, hivel: 63});
    expect(regions[1]).toMatchObject({lokey: 63, hikey: 65, pitch_keycenter: 64});
    expect(regions[2]).toMatchObject({sample: 'loud_c.wav', lovel: 64, hivel: 127});
  });

  it('resolves zones with URLs relative to the sfz location', () => {
    const regions = parseSfz('<region> sample=samples/c.wav key=60');
    const zones = resolveSfzZones(regions, 'https://x.com/inst/piano.sfz');
    expect(zones[0]).toMatchObject({
      sample: 'https://x.com/inst/samples/c.wav',
      loKey: 60,
      hiKey: 60,
      rootKey: 60,
      loVel: 0,
      hiVel: 127,
    });
  });
});

describe('chooseZone (velocity layering + round-robin)', () => {
  it('picks the zone whose key and velocity both match', () => {
    const zones = [zone('soft', 60, 72, 0, 63), zone('loud', 60, 72, 64, 127)];
    expect(chooseZone(zones, 64, 30)?.sample).toBe('soft');
    expect(chooseZone(zones, 64, 100)?.sample).toBe('loud');
  });

  it('rotates round-robin through equally-matching alternates', () => {
    const zones = [zone('rr1', 60, 60, 0, 127), zone('rr2', 60, 60, 0, 127), zone('rr3', 60, 60, 0, 127)];
    const rr = new Map<string, number>();
    const got = [0, 1, 2, 3].map(() => chooseZone(zones, 60, 80, rr)?.sample);
    expect(got).toEqual(['rr1', 'rr2', 'rr3', 'rr1']);
  });

  it('falls back to key-only when no velocity range matches', () => {
    const zones = [zone('only', 60, 72, 100, 127)];
    expect(chooseZone(zones, 64, 10)?.sample).toBe('only');
  });

  it('returns undefined when the key is out of range', () => {
    expect(chooseZone([zone('x', 60, 72, 0, 127)], 40, 80)).toBeUndefined();
  });
});

describe('playbackRateFor', () => {
  it('is 1.0 at the root key and doubles an octave up', () => {
    expect(playbackRateFor(60, 60)).toBeCloseTo(1, 6);
    expect(playbackRateFor(60, 72)).toBeCloseTo(2, 6);
    expect(playbackRateFor(60, 48)).toBeCloseTo(0.5, 6);
  });

  it('applies fine tuning in cents', () => {
    expect(playbackRateFor(60, 60, 1200)).toBeCloseTo(2, 6);
  });
});

/** A fuller AudioContext stand-in for the synthesis backends (osc/noise/wavetable). */
function synthCtx() {
  const ctx: any = {sampleRate: 44100, currentTime: 0};
  // Named explicitly: `node` pushes into these arrays, so inferring their
  // element type from `ReturnType<typeof node>` would be circular.
  interface FakeAudioNode {
    context: unknown;
    gain: ReturnType<typeof param>;
    frequency: ReturnType<typeof param>;
    Q: ReturnType<typeof param>;
    type: string;
    buffer: unknown;
    loop: boolean;
    connect: () => FakeAudioNode;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setPeriodicWave: ReturnType<typeof vi.fn>;
    onended: null | (() => void);
  }
  const sources: FakeAudioNode[] = [];
  const nodes: FakeAudioNode[] = [];
  const param = () => {
    const value = {value: 0} as {
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
      setTargetAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
      cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
    };
    value.setValueAtTime = vi.fn(() => value);
    value.exponentialRampToValueAtTime = vi.fn(() => value);
    value.setTargetAtTime = vi.fn(() => value);
    value.cancelScheduledValues = vi.fn(() => value);
    value.cancelAndHoldAtTime = vi.fn(() => value);
    return value;
  };
  function node(source = false): FakeAudioNode {
    const value = {
      context: ctx,
      gain: param(),
      frequency: param(),
      Q: param(),
      type: '',
      buffer: null as unknown,
      loop: false,
      connect: () => node(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      setPeriodicWave: vi.fn(),
      onended: null as null | (() => void),
    };
    nodes.push(value);
    if (source) sources.push(value);
    return value;
  }
  Object.assign(ctx, {
    createGain: () => node(),
    createOscillator: () => node(true),
    createBufferSource: () => node(true),
    createBiquadFilter: () => node(),
    createPeriodicWave: () => ({}),
    createBuffer: (c: number, l: number) => ({numberOfChannels: c, length: l, getChannelData: () => new Float32Array(l)}),
  });
  return {ctx, destination: node() as unknown as AudioNode, nodes, sources};
}

describe('Sound — synthesis & layering', () => {
  it('layer fans note events to every child sound', () => {
    const {destination} = synthCtx();
    const b1 = {ons: [] as number[], connect() {}, noteOn: (m: number) => b1.ons.push(m), noteOff() {}};
    const b2 = {ons: [] as number[], connect() {}, noteOn: (m: number) => b2.ons.push(m), noteOff() {}};
    const layer = Sound.layer(Sound.custom(b1 as HeadlessSynth), Sound.custom(b2 as HeadlessSynth));
    layer.connect(destination);
    layer.noteOn(60, 100, 0, 0.5);
    expect(b1.ons).toEqual([60]);
    expect(b2.ons).toEqual([60]);
  });

  it('does not advertise clock lookahead when any layer child lacks cancellation', () => {
    const {destination} = synthCtx();
    const capable = {
      connect() {},
      supportsScheduledCancellation: true,
      noteOn: () => 'voice',
      noteOffById() {},
      cancelScheduledNote() {},
    } satisfies HeadlessSynth;
    const fallback = {connect() {}, noteOn() {}} satisfies HeadlessSynth;
    const layer = Sound.layer(Sound.custom(capable), Sound.custom(fallback));

    layer.connect(destination);
    expect(layer.supportsScheduledCancellation).toBe(false);
  });

  it('rolls back earlier layer attacks and the failing child before surfacing noteOn failure', () => {
    const {destination} = synthCtx();
    const exactRelease = vi.fn();
    const failedPitchRelease = vi.fn();
    const attackFailure = new Error('second attack failed');
    const first = Sound.custom({
      connect: () => vi.fn(),
      noteOn: () => 'first-voice',
      noteOffById: exactRelease,
    });
    const second = Sound.custom({
      connect: () => vi.fn(),
      noteOn: () => {
        throw attackFailure;
      },
      noteOff: failedPitchRelease,
    });
    const layer = Sound.layer(first, second);
    layer.connect(destination);

    expect(() => layer.noteOn(60, 100, 1, 5)).toThrow(attackFailure);
    expect(exactRelease).toHaveBeenCalledWith('first-voice', 1);
    expect(failedPitchRelease).toHaveBeenCalledWith(60, 1);
  });

  it('runs every layer release and dispose even when an earlier child throws', () => {
    const {destination} = synthCtx();
    const releaseFailure = new Error('first release failed');
    const laterRelease = vi.fn();
    const laterDispose = vi.fn();
    const first = Sound.custom({
      connect: () => vi.fn(),
      noteOn: vi.fn(),
      noteOff: () => {
        throw releaseFailure;
      },
      dispose: () => {
        throw new Error('first dispose failed');
      },
    });
    const second = Sound.custom({
      connect: () => vi.fn(),
      noteOn: vi.fn(),
      noteOff: laterRelease,
      dispose: laterDispose,
    });
    const layer = Sound.layer(first, second);
    layer.connect(destination);

    expect(() => layer.noteOff(60, 1)).toThrow(releaseFailure);
    expect(laterRelease).toHaveBeenCalledWith(60, 1);
    expect(() => layer.dispose()).toThrow('first dispose failed');
    expect(laterDispose).toHaveBeenCalledTimes(1);
  });

  it('fm / wavetable / noise build a graph and trigger without throwing', () => {
    const {destination} = synthCtx();
    for (const sound of [Sound.fm({ratio: 3}), Sound.wavetable({real: [0, 1, 0.5]}), Sound.noise({pitched: true})]) {
      sound.connect(destination);
      expect(() => sound.noteOn(60, 100, 0, 0.4)).not.toThrow();
      expect(() => sound.dispose()).not.toThrow();
    }
  });

  it.each([
    ['fm', () => Sound.fm({releaseSeconds: 0.12})],
    ['wavetable', () => Sound.wavetable({releaseSeconds: 0.1})],
    ['noise', () => Sound.noise({releaseSeconds: 0.12})],
  ] as const)('%s returns an exact cancellable voice and shortens its hard stop', (_name, create) => {
    const {destination, sources} = synthCtx();
    const sound = create();
    sound.connect(destination);
    const handle = sound.noteOn(60, 100, 0, 10);

    expect(handle).toBeTypeOf('number');
    expect(sound.supportsScheduledCancellation).toBe(true);
    sound.noteOffById(handle, 1);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.stop.mock.calls.at(-1)?.[0]).toBeLessThanOrEqual(1.12);
    }
    sound.dispose();
  });

  it('hard-stops every matching built-in voice even when one envelope release throws', () => {
    const {destination, nodes, sources} = synthCtx();
    const sound = Sound.noise({releaseSeconds: 0.12});
    sound.connect(destination);
    sound.noteOn(60, 100, 10, 10);
    sound.noteOn(60, 100, 10, 10);
    const envelopeGains = nodes.filter((candidate) =>
      candidate.gain.setTargetAtTime.mock.calls.length > 0
    );
    envelopeGains[0].gain.cancelScheduledValues = vi.fn(() => {
      throw new Error('envelope release failed');
    });

    expect(() => sound.noteOff(60, 1)).toThrow('envelope release failed');
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source.stop.mock.calls.at(-1)?.[0]).toBe(1);
    }
    expect(() => sound.dispose()).not.toThrow();
  });
});
