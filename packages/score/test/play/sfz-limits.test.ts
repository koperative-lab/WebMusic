import {afterEach, describe, expect, it, vi} from 'vitest';
import {RangeSampler} from '../../src/play/headless/sounds/range-sampler';
import type {SampleZone} from '../../src/play/headless/sounds/contracts';
import {parseSfz, resolveSfzZones} from '../../src/play/core/sfz';

const zone = (sample: string): SampleZone => ({
  sample,
  loKey: 0,
  hiKey: 127,
  rootKey: 60,
  loVel: 0,
  hiVel: 127,
});

function context(decodeAudioData = vi.fn(async () => ({length: 1, numberOfChannels: 1} as AudioBuffer))) {
  return {
    createGain: () => ({connect: () => undefined, disconnect: () => undefined}),
    decodeAudioData,
  } as unknown as AudioContext;
}

function playableContext() {
  const parameter = () => ({
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const sources: Array<{stop: ReturnType<typeof vi.fn>}> = [];
  const audio = {
    currentTime: 0,
    createGain: () => ({
      gain: parameter(),
      connect: vi.fn((destination: unknown) => destination),
      disconnect: vi.fn(),
    }),
    createBufferSource: () => {
      const source = {
        buffer: null,
        playbackRate: {value: 1},
        connect: vi.fn((destination: unknown) => destination),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    },
    decodeAudioData: vi.fn(async () => ({length: 1, numberOfChannels: 1} as AudioBuffer)),
  } as unknown as AudioContext;
  return {audio, sources};
}

describe('RangeSampler SFZ resource limits', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects excessive zone counts before making a sample request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const audio = context();
    const sampler = new RangeSampler(audio, {maxZones: 1});

    await expect(sampler.loadZones([zone('/a.wav'), zone('/b.wav')], audio)).rejects.toThrow(/maxZones/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'maxZones',
    'maxConcurrentLoads',
    'maxSampleBytes',
    'maxTotalSampleBytes',
    'maxDecodedSampleBytes',
    'maxTotalDecodedSampleBytes',
  ])('validates %s as a positive safe integer', (name) => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new RangeSampler(context(), {[name]: value})).toThrow(new RegExp(name));
    }
  });

  it('caps concurrent sample loads', async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }));
    const audio = context();
    const sampler = new RangeSampler(audio, {maxConcurrentLoads: 2});

    await sampler.loadZones(Array.from({length: 6}, (_, index) => zone(`/sample-${index}.wav`)), audio);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects sample responses above byte limits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(9))));
    const audio = context();
    const sampler = new RangeSampler(audio, {maxSampleBytes: 8});

    await expect(sampler.loadZones([zone('/too-large.wav')], audio)).rejects.toThrow(/maxSampleBytes/);
  });

  it('cancels a streaming sample before retaining more than its byte limit', async () => {
    let cancelled = false;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: vi.fn(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(9));
        },
        cancel() {
          cancelled = true;
        },
      }),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const audio = context();
    const sampler = new RangeSampler(audio, {maxSampleBytes: 8});

    await expect(sampler.loadZones([zone('/stream.wav')], audio)).rejects.toThrow(/maxSampleBytes/);
    expect(cancelled).toBe(true);
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels a declared-oversized response before reading its body', async () => {
    let cancelled = false;
    const response = {
      ok: true,
      status: 200,
      headers: {get: () => '9'},
      arrayBuffer: vi.fn(),
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const audio = context();
    const sampler = new RangeSampler(audio, {maxSampleBytes: 8});

    await expect(sampler.loadZones([zone('/declared.wav')], audio)).rejects.toThrow(/maxSampleBytes/);
    expect(cancelled).toBe(true);
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });

  it('aborts sibling sample requests when one request fails', async () => {
    let slowSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('failed')) return Promise.resolve(new Response(null, {status: 500}));
      slowSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        slowSignal.addEventListener('abort', () => reject(slowSignal.reason), {once: true});
      });
    }));
    const audio = context();
    const sampler = new RangeSampler(audio, {maxConcurrentLoads: 2});

    await expect(sampler.loadZones([zone('/failed.wav'), zone('/slow.wav')], audio)).rejects.toThrow(/request failed/);
    expect(slowSignal.aborted).toBe(true);
  });

  it('uses a call-time zone snapshot after validating maxZones', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetch);
    const audio = context();
    const sampler = new RangeSampler(audio, {maxZones: 1});
    const zones = [zone('/first.wav')];

    const loading = sampler.loadZones(zones, audio);
    zones.push(zone('/late.wav'));
    await loading;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/first.wav', expect.any(Object));
  });

  it('rejects a decoded buffer that exceeds its retention budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1))));
    const audio = context(vi.fn(async () => ({length: 3, numberOfChannels: 1} as AudioBuffer)));
    const sampler = new RangeSampler(audio, {maxDecodedSampleBytes: 8});

    await expect(sampler.loadZones([zone('/expanded.wav')], audio)).rejects.toThrow(/maxDecodedSampleBytes/);
  });

  it('hard-stops exact and same-pitch voices, then clears retained zones on dispose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
    const {audio, sources} = playableContext();
    const sampler = new RangeSampler(audio, {releaseSeconds: 0.1});
    await sampler.loadZones([zone('/sample.wav')], audio);

    sampler.noteOn(60, 100, 0, 3600);
    sampler.noteOff(60, 0.5);
    expect(sources[0].stop).toHaveBeenLastCalledWith(0.6);

    const exact = sampler.noteOn(60, 100, 0, 3600);
    sampler.noteOffById(exact, 0.75);
    expect(sources[1].stop).toHaveBeenLastCalledWith(0.85);

    sampler.noteOn(60, 100, 1, 3600);
    sampler.dispose();
    for (const source of sources) expect(source.stop).toHaveBeenLastCalledWith(0);
    expect((sampler as unknown as {zones: unknown[]}).zones).toEqual([]);
  });

  it('does not commit a zone load that finishes after dispose', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    const decodeAudioData = vi.fn(async () => ({length: 1, numberOfChannels: 1} as AudioBuffer));
    const audio = context(decodeAudioData);
    const sampler = new RangeSampler(audio);

    const pending = sampler.loadZones([zone('/late.wav')], audio);
    await Promise.resolve();
    sampler.dispose();
    resolveFetch(new Response(new Uint8Array([1])));

    await expect(pending).resolves.toBeUndefined();
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect((sampler as unknown as {zones: unknown[]}).zones).toEqual([]);
  });

  it('keeps the newest zone generation when an older request resolves last', async () => {
    let resolveOld!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      if (String(url).includes('old')) {
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve(new Response(new Uint8Array([2])));
    }));
    const audio = context();
    const sampler = new RangeSampler(audio);

    const oldLoad = sampler.loadZones([zone('/old.wav')], audio);
    await Promise.resolve();
    await sampler.loadZones([zone('/new.wav')], audio);
    resolveOld(new Response(new Uint8Array([1])));
    await expect(oldLoad).resolves.toBeUndefined();

    const loaded = (sampler as unknown as {zones: SampleZone[]}).zones;
    expect(loaded.map((candidate) => candidate.sample)).toEqual(['/new.wav']);
  });
});

describe('SFZ parse resource limits', () => {
  it('rejects oversized source and excessive region counts before zone loading', () => {
    expect(() => parseSfz('<region>', {maxInputCharacters: 4})).toThrow(/maxInputCharacters/);
    expect(() => parseSfz('<region> <region>', {maxRegions: 1})).toThrow(/maxRegions/);
  });

  it('applies the same cap when resolving caller-supplied regions', () => {
    expect(() => resolveSfzZones([
      {sample: 'a.wav'},
      {sample: 'b.wav'},
    ], 'https://example.com/instrument.sfz', {maxRegions: 1})).toThrow(/maxRegions/);
  });
});
