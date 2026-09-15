import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundfontSynth } from "../../src/play/headless/soundfont-synth";
import { SpessaSoundBackend } from "../../src/play/headless/sounds/spessa";

function context(
  decodeAudioData = vi.fn(
    async () => ({ length: 1, numberOfChannels: 1 }) as AudioBuffer,
  ),
): AudioContext {
  return {
    currentTime: 0,
    createGain: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    decodeAudioData,
  } as unknown as AudioContext;
}

const fallback = () => ({ noteOn: vi.fn(), dispose: vi.fn() });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SoundfontSynth resource limits", () => {
  it("caps concurrent sample fetch/decode work", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return new Response(new Uint8Array([1]));
      }),
    );
    const synth = new SoundfontSynth(context(), {
      fallback: fallback(),
      maxConcurrentLoads: 2,
      samples: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [
          60 + index,
          `/sample-${index}.wav`,
        ]),
      ),
    });

    await synth.preload();
    expect(peak).toBeLessThanOrEqual(2);
    synth.dispose();
  });

  it("aborts sibling sample requests when one request fails", async () => {
    let slowSignal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("failed")) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        slowSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          slowSignal.addEventListener(
            "abort",
            () => reject(slowSignal.reason),
            { once: true },
          );
        });
      }),
    );
    const synth = new SoundfontSynth(context(), {
      fallback: fallback(),
      maxConcurrentLoads: 2,
      samples: { 60: "/failed.wav", 61: "/slow.wav" },
    });

    await expect(synth.preload()).rejects.toThrow(/request failed/);
    expect(slowSignal.aborted).toBe(true);
    synth.dispose();
  });

  it("rejects declared and streamed sample bodies before retaining them", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(9));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "9" },
        arrayBuffer,
      })),
    );
    const declared = new SoundfontSynth(context(), {
      fallback: fallback(),
      maxSampleBytes: 8,
      samples: { 60: "/declared.wav" },
    });
    await expect(declared.preload()).rejects.toThrow(/maxSampleBytes/);
    expect(arrayBuffer).not.toHaveBeenCalled();

    let cancelled = false;
    const streamedArrayBuffer = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(9));
          },
          cancel() {
            cancelled = true;
          },
        }),
        arrayBuffer: streamedArrayBuffer,
      })),
    );
    const streamed = new SoundfontSynth(context(), {
      fallback: fallback(),
      maxSampleBytes: 8,
      samples: { 60: "/streamed.wav" },
    });
    await expect(streamed.preload()).rejects.toThrow(/maxSampleBytes/);
    expect(cancelled).toBe(true);
    expect(streamedArrayBuffer).not.toHaveBeenCalled();
  });

  it("supports simple injected responses and enforces the post-read cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(9),
      })),
    );
    const synth = new SoundfontSynth(context(), {
      fallback: fallback(),
      maxSampleBytes: 8,
      samples: { 60: "/simple.wav" },
    });

    await expect(synth.preload()).rejects.toThrow(/maxSampleBytes/);
  });

  it("enforces aggregate source bytes before decoding another sample", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(5))),
    );
    const decodeAudioData = vi.fn(
      async () => ({ length: 1, numberOfChannels: 1 }) as AudioBuffer,
    );
    const synth = new SoundfontSynth(context(decodeAudioData), {
      fallback: fallback(),
      maxConcurrentLoads: 1,
      maxSampleBytes: 8,
      maxTotalSampleBytes: 8,
      samples: { 60: "/one.wav", 61: "/two.wav" },
    });

    await expect(synth.preload()).rejects.toThrow(/maxTotalSampleBytes/);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("enforces single and aggregate decoded PCM limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(1))),
    );
    const oversized = new SoundfontSynth(
      context(
        vi.fn(async () => ({ length: 3, numberOfChannels: 1 }) as AudioBuffer),
      ),
      {
        fallback: fallback(),
        maxDecodedSampleBytes: 8,
        samples: { 60: "/expanded.wav" },
      },
    );
    await expect(oversized.preload()).rejects.toThrow(/maxDecodedSampleBytes/);

    const decodeAudioData = vi.fn(
      async () => ({ length: 2, numberOfChannels: 1 }) as AudioBuffer,
    );
    const aggregate = new SoundfontSynth(context(decodeAudioData), {
      fallback: fallback(),
      maxConcurrentLoads: 1,
      maxDecodedSampleBytes: 8,
      maxTotalDecodedSampleBytes: 12,
      samples: { 60: "/one.wav", 61: "/two.wav" },
    });
    await expect(aggregate.preload()).rejects.toThrow(
      /maxTotalDecodedSampleBytes/,
    );
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized ArrayBuffer samples without fetching or decoding", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const decodeAudioData = vi.fn();
    const synth = new SoundfontSynth(context(decodeAudioData), {
      fallback: fallback(),
      maxSampleBytes: 8,
      samples: { 60: new ArrayBuffer(9) },
    });

    await expect(synth.preload()).rejects.toThrow(/maxSampleBytes/);
    expect(fetch).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it.each([
    "maxConcurrentLoads",
    "maxSampleBytes",
    "maxTotalSampleBytes",
    "maxDecodedSampleBytes",
    "maxTotalDecodedSampleBytes",
  ])("validates %s as a positive safe integer", (name) => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () =>
          new SoundfontSynth(context(), {
            fallback: fallback(),
            [name]: value,
          }),
      ).toThrow(new RegExp(name));
    }
  });
});

describe("Spessa SoundFont resource lifecycle", () => {
  it("aborts an in-flight fetch when its route is released", async () => {
    let requestSignal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true },
          );
        });
      }),
    );
    const backend = new SpessaSoundBackend("/bank.sf2", 0, 0);
    const internals = backend as unknown as {
      activeRouteId?: number;
      loadSoundFontSource(source: string): Promise<ArrayBuffer>;
      releaseRoute(routeId: number): void;
    };
    internals.activeRouteId = 7;
    const loading = internals.loadSoundFontSource("/bank.sf2");
    await Promise.resolve();

    internals.releaseRoute(7);

    expect(requestSignal.aborted).toBe(true);
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });

  it("caps URL and in-memory SoundFont sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(9))),
    );
    const backend = new SpessaSoundBackend(
      "/bank.sf2",
      0,
      0,
      undefined,
      undefined,
      8,
    );
    const loading = (
      backend as unknown as {
        loadSoundFontSource(source: string): Promise<ArrayBuffer>;
      }
    ).loadSoundFontSource("/bank.sf2");
    await expect(loading).rejects.toThrow(/maxSoundFontBytes/);

    expect(
      () =>
        new SpessaSoundBackend(
          new ArrayBuffer(9),
          0,
          0,
          undefined,
          undefined,
          8,
        ),
    ).toThrow(/maxSoundFontBytes/);
  });

  it("validates maxSoundFontBytes", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () =>
          new SpessaSoundBackend(
            "/bank.sf2",
            0,
            0,
            undefined,
            undefined,
            value,
          ),
      ).toThrow(/maxSoundFontBytes/);
    }
  });
});
