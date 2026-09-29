import {
  createAudioClip,
  createClipEditSession,
  type AudioClip,
  type ClipEditDescriptor,
} from "../../src/core";
import { describe, expect, it, vi } from "vitest";
// Importing the worker entry in Node must be a no-op (the self-registration is
// guarded for real worker scopes only) — the import itself is part of the test.
import "../../src/analyze/worker";
import {
  AUDIO_ANALYSIS_WORKER_PROTOCOL,
  AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
  createAnalysisWorkerState,
  handleAnalyzeRequest,
  prepareResponseForPost,
  type AnalyzeWorkerResponse,
  type AudioWorkerState,
} from "../../src/analyze/api/worker-protocol";
import {
  createAnalysisWorker,
  createRequestTracker,
  resolveAnalysisWorkerUrl,
} from "../../src/analyze/worker-client";
import { createAudioAnalysisSession } from "../../src/analyze/headless/session";
import { sine, clickTrain } from "./signals";

function makeClip(seconds = 0.5, sr = 22050): AudioClip {
  return createAudioClip({
    sampleRate: sr,
    channelData: [sine(440, seconds, sr)],
  });
}

describe("handleAnalyzeRequest (pure)", () => {
  it("registers a clip then analyzes it", async () => {
    const state = createAnalysisWorkerState();
    const clip = makeClip();
    const channels = clip.channels()!;

    const reg = await handleAnalyzeRequest(state, {
      type: "register",
      clipId: clip.id,
      clip: clip.toJSON(),
      channels,
    });
    // register is fire-and-forget — no response.
    expect(reg).toBeNull();
    expect(state.clips.has(clip.id)).toBe(true);

    const res = (await handleAnalyzeRequest(state, {
      type: "analyze",
      id: 7,
      clipId: clip.id,
      tasks: ["peaks", "loudness"],
    })) as AnalyzeWorkerResponse;

    expect(res.type).toBe("analyzed");
    if (res.type === "analyzed") {
      expect(res.id).toBe(7);
      expect(res.result.peaks.levels.length).toBeGreaterThan(0);
      expect(Number.isFinite(res.result.loudness.rms)).toBe(true);
    }
  });

  it("returns an error response for an unregistered clip", async () => {
    const state = createAnalysisWorkerState();
    const res = (await handleAnalyzeRequest(state, {
      type: "analyze",
      id: 1,
      clipId: "missing",
      tasks: ["peaks"],
    })) as AnalyzeWorkerResponse;
    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.id).toBe(1);
      expect(res.message).toMatch(/registered/i);
    }
  });

  it("updates a registered clip with edits", async () => {
    const state = createAnalysisWorkerState();
    const clip = makeClip(1);
    await handleAnalyzeRequest(state, {
      type: "register",
      clipId: clip.id,
      clip: clip.toJSON(),
      channels: clip.channels()!,
    });
    await handleAnalyzeRequest(state, {
      type: "analyze",
      id: 1,
      clipId: clip.id,
      tasks: ["peaks", "loudness"],
    });

    const res = (await handleAnalyzeRequest(state, {
      type: "update",
      id: 2,
      clipId: clip.id,
      edits: [{ op: "gain", factor: 0.5 }],
    })) as AnalyzeWorkerResponse;
    expect(res.type).toBe("analyzed");
    if (res.type === "analyzed") expect(res.id).toBe(2);
  });

  it("serializes concurrent updates so each edit applies to the prior result", async () => {
    const state = createAnalysisWorkerState(createAudioAnalysisSession);
    const clip = createAudioClip({
      sampleRate: 8_000,
      channelData: [new Float32Array([1, 1, 1, 1])],
    });
    await handleAnalyzeRequest(state, {
      type: "register",
      clipId: clip.id,
      clip: clip.toJSON(),
      channels: clip.channels()!,
    });
    await handleAnalyzeRequest(state, {
      type: "analyze",
      id: 1,
      clipId: clip.id,
      tasks: ["peaks", "loudness"],
    });

    const first = handleAnalyzeRequest(state, {
      type: "update",
      id: 2,
      clipId: clip.id,
      edits: [{ op: "gain", factor: 0.5 }],
    });
    const second = handleAnalyzeRequest(state, {
      type: "update",
      id: 3,
      clipId: clip.id,
      edits: [{ op: "gain", factor: 0.5 }],
    });
    await Promise.all([first, second]);

    expect(state.clips.get(clip.id)!.clip.channelData(0)?.[0]).toBeCloseTo(
      0.25,
      6,
    );
  });

  it("release drops the cached clip", async () => {
    const state = createAnalysisWorkerState();
    const clip = makeClip();
    await handleAnalyzeRequest(state, {
      type: "register",
      clipId: clip.id,
      clip: clip.toJSON(),
      channels: clip.channels()!,
    });
    const res = await handleAnalyzeRequest(state, {
      type: "release",
      clipId: clip.id,
    });
    expect(res).toBeNull();
    expect(state.clips.has(clip.id)).toBe(false);
  });
});

describe("prepareResponseForPost (transfer safety)", () => {
  const SR = 22050;

  /**
   * Simulate exactly what worker.ts does with a response: structured-clone it
   * with the prepared transfer list. Like a real `postMessage`, this detaches
   * every buffer in the transfer list on the sender side — so anything the
   * session cache still references must NOT be in that list.
   */
  function post(response: AnalyzeWorkerResponse): AnalyzeWorkerResponse {
    const { message, transfer } = prepareResponseForPost(response);
    return structuredClone(message, { transfer });
  }

  async function registeredState(clipId: string): Promise<AudioWorkerState> {
    const state = createAnalysisWorkerState();
    const clip = createAudioClip({
      sampleRate: SR,
      channelData: [sine(440, 1, SR)],
    });
    await handleAnalyzeRequest(state, {
      type: "register",
      clipId,
      clip: clip.toJSON(),
      channels: clip.channels()!,
    });
    return state;
  }

  function analyzed(
    response: AnalyzeWorkerResponse | null,
  ): Extract<AnalyzeWorkerResponse, { type: "analyzed" }> {
    if (!response) throw new Error("expected a response, got null");
    if (response.type !== "analyzed")
      throw new Error(`expected 'analyzed', got error: ${response.message}`);
    return response;
  }

  it("posting an analyze response must not corrupt the next update (cached buffers detached)", async () => {
    // Length-preserving edit confined to the middle of the clip → the session
    // takes the incremental path that stitches against the cached peaks pyramid.
    const edits: ClipEditDescriptor[] = [
      { op: "gain", factor: 0.5, startSeconds: 0.4, endSeconds: 0.6 },
    ];

    // Worker under test: every response is posted (transferred) like worker.ts does.
    const state = await registeredState("clip");
    const first = analyzed(
      await handleAnalyzeRequest(state, {
        type: "analyze",
        id: 1,
        clipId: "clip",
        tasks: ["peaks", "loudness"],
      }),
    );
    const firstWire = analyzed(post(first));
    // The receiver must get real data across the wire.
    expect(firstWire.result.peaks.levels[0].data.length).toBeGreaterThan(0);

    const updated = analyzed(
      await handleAnalyzeRequest(state, {
        type: "update",
        id: 2,
        clipId: "clip",
        edits,
      }),
    );
    const updatedWire = analyzed(post(updated));

    // Oracle: the identical register → analyze → update sequence, never posted.
    const control = await registeredState("clip");
    await handleAnalyzeRequest(control, {
      type: "analyze",
      id: 1,
      clipId: "clip",
      tasks: ["peaks", "loudness"],
    });
    const expected = analyzed(
      await handleAnalyzeRequest(control, {
        type: "update",
        id: 2,
        clipId: "clip",
        edits,
      }),
    );

    expect(updatedWire.result.peaks.levels.length).toBe(
      expected.result.peaks.levels.length,
    );
    expect(updatedWire.result.peaks.levels[0].data.length).toBeGreaterThan(0);
    expect(Array.from(updatedWire.result.peaks.levels[0].data)).toEqual(
      Array.from(expected.result.peaks.levels[0].data),
    );
    expect(updatedWire.result.loudness.rms).toBeCloseTo(
      expected.result.loudness.rms,
      12,
    );

    // A second update round: posting the first update's response must not have
    // detached the session's *new* cache either.
    const edits2: ClipEditDescriptor[] = [
      { op: "gain", factor: 2, startSeconds: 0.1, endSeconds: 0.2 },
    ];
    const updated2Wire = analyzed(
      post(
        analyzed(
          await handleAnalyzeRequest(state, {
            type: "update",
            id: 3,
            clipId: "clip",
            edits: edits2,
          }),
        ),
      ),
    );
    const expected2 = analyzed(
      await handleAnalyzeRequest(control, {
        type: "update",
        id: 3,
        clipId: "clip",
        edits: edits2,
      }),
    );
    expect(Array.from(updated2Wire.result.peaks.levels[0].data)).toEqual(
      Array.from(expected2.result.peaks.levels[0].data),
    );
  });

  it("re-posting a memoized analyze result stays intact (second request on the same clip)", async () => {
    const state = await registeredState("clip");
    const tasks = ["peaks", "loudness", "spectrogram", "pitch"] as const;
    const firstWire = analyzed(
      post(
        analyzed(
          await handleAnalyzeRequest(state, {
            type: "analyze",
            id: 1,
            clipId: "clip",
            tasks,
          }),
        ),
      ),
    );
    // Second analyze returns the session's memoized cache; posting it again
    // must still deliver intact data (pre-fix its buffers were already detached).
    const secondWire = analyzed(
      post(
        analyzed(
          await handleAnalyzeRequest(state, {
            type: "analyze",
            id: 2,
            clipId: "clip",
            tasks,
          }),
        ),
      ),
    );

    expect(secondWire.result.peaks.levels[0].data.length).toBeGreaterThan(0);
    expect(Array.from(secondWire.result.peaks.levels[0].data)).toEqual(
      Array.from(firstWire.result.peaks.levels[0].data),
    );
    expect(secondWire.result.spectrogram!.magnitudes.length).toBeGreaterThan(0);
    expect(Array.from(secondWire.result.spectrogram!.magnitudes)).toEqual(
      Array.from(firstWire.result.spectrogram!.magnitudes),
    );
    expect(secondWire.result.pitchTrack!.times.length).toBe(
      firstWire.result.pitchTrack!.times.length,
    );
    expect(secondWire.result.loudness.momentary!.length).toBe(
      firstWire.result.loudness.momentary!.length,
    );
  });
});

describe("createRequestTracker", () => {
  it("correlates resolutions and rejections by id", async () => {
    const tracker = createRequestTracker<number>();
    const a = tracker.add();
    const b = tracker.add();
    expect(tracker.size).toBe(2);
    expect(tracker.resolve(a.id, 10)).toBe(true);
    expect(tracker.reject(b.id, new Error("boom"))).toBe(true);
    expect(tracker.resolve(999, 0)).toBe(false);
    await expect(a.promise).resolves.toBe(10);
    await expect(b.promise).rejects.toThrow("boom");
    expect(tracker.size).toBe(0);
  });

  it("rejectAll fails every pending request", async () => {
    const tracker = createRequestTracker<number>();
    const a = tracker.add();
    tracker.rejectAll(new Error("disposed"));
    await expect(a.promise).rejects.toThrow("disposed");
  });
});

describe("createAnalysisWorker in-process fallback", () => {
  it("analyzes and updates without a Worker available", async () => {
    const client = createAnalysisWorker(); // no Worker in Node → in-process
    const clip = makeClip(0.5);
    const result = await client.analyze(clip, { tasks: ["peaks", "loudness"] });
    expect(result.peaks.levels.length).toBeGreaterThan(0);

    const updated = await client.update(clip, [{ op: "gain", factor: 0.5 }]);
    expect(updated.peaks.levels.length).toBeGreaterThan(0);
    client.dispose();
  });

  it("rejects after dispose", async () => {
    const client = createAnalysisWorker();
    client.dispose();
    await expect(client.analyze(makeClip())).rejects.toThrow(/disposed/i);
  });
});

describe("analysis worker client lifecycle", () => {
  it("resolves the worker beside each emitted entry format", () => {
    expect(
      resolveAnalysisWorkerUrl("https://cdn.test/pkg/dist/api/worker-client.js")
        ?.href,
    ).toBe("https://cdn.test/pkg/dist/worker.js");
    expect(
      resolveAnalysisWorkerUrl("https://cdn.test/pkg/dist/chunk-ABC.js")?.href,
    ).toBe("https://cdn.test/pkg/dist/worker.js");
    expect(
      resolveAnalysisWorkerUrl(
        undefined,
        "https://cdn.test/pkg/dist/auto.global.js",
      )?.href,
    ).toBe("https://cdn.test/pkg/dist/worker.js");
    expect(
      resolveAnalysisWorkerUrl(
        undefined,
        "https://cdn.test/pkg/dist/api/worker-client.cjs",
      )?.href,
    ).toBe("https://cdn.test/pkg/dist/worker.js");
    expect(
      resolveAnalysisWorkerUrl(
        undefined,
        "https://cdn.test/pkg/dist/element/auto.cjs",
      )?.href,
    ).toBe("https://cdn.test/pkg/dist/worker.js");
    expect(
      resolveAnalysisWorkerUrl(
        undefined,
        "https://cdn.test/@webmusic/audio/analyze@0.1.0/global",
      )?.href,
    ).toBe("https://cdn.test/@webmusic/audio/analyze@0.1.0/worker");
    expect(
      resolveAnalysisWorkerUrl(
        undefined,
        "https://cdn.test/@webmusic/audio/analyze@0.1.0/global/?cache=1",
      )?.href,
    ).toBe("https://cdn.test/@webmusic/audio/analyze@0.1.0/worker");
    expect(resolveAnalysisWorkerUrl()).toBeUndefined();
  });

  it("removes listeners without terminating a caller-owned Worker", () => {
    const worker = new FakeWorker();
    const client = createAnalysisWorker(worker);
    expect(worker.listenerCount("message")).toBe(1);
    expect(worker.listenerCount("error")).toBe(1);

    client.dispose();
    expect(worker.listenerCount("message")).toBe(0);
    expect(worker.listenerCount("error")).toBe(0);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("terminates a factory-created Worker and rejects synchronous postMessage failures", async () => {
    const worker = new FakeWorker();
    const client = createAnalysisWorker(() => worker);
    const clip = makeClip();
    worker.failAnalyze = true;

    await expect(client.analyze(clip, { tasks: ["peaks"] })).rejects.toThrow(
      "post failed",
    );
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listenerCount("message")).toBe(0);
  });

  it("fails future calls promptly after a terminal Worker error", async () => {
    const worker = new FakeWorker();
    const client = createAnalysisWorker(worker);
    const pending = client.analyze(makeClip(), { tasks: ["peaks"] });

    worker.emitError("worker crashed");

    await expect(pending).rejects.toThrow(/worker crashed/);
    await expect(client.analyze(makeClip())).rejects.toThrow(/worker crashed/);
    client.dispose();
  });
});

describe("createAudioAnalysisSession (incremental)", () => {
  it("memoizes analyze() and reuses on a no-op update", async () => {
    const clip = createAudioClip({
      sampleRate: 22050,
      channelData: [clickTrain(120, 1, 22050)],
    });
    const session = createAudioAnalysisSession(clip, {
      tasks: ["peaks", "loudness", "onsets"],
    });
    const first = await session.analyze();
    const same = await session.analyze();
    expect(same).toBe(first); // memoized identity

    // Update with a clip that has identical samples (metadata-only change):
    const renamed = clip.withMetadata({ title: "x" });
    const reused = await session.update(renamed);
    expect(reused).toBe(first); // unchanged samples → reuse the cached result
    expect(session.clip).toBe(renamed);
  });

  it("recomputes after a real edit and stays correct", async () => {
    const clip = createAudioClip({
      sampleRate: 22050,
      channelData: [sine(440, 1, 22050, 1.0)],
    });
    const session = createAudioAnalysisSession(clip, {
      tasks: ["peaks", "loudness"],
    });
    const before = await session.analyze();

    const edited = createClipEditSession(clip).gain(0.25).apply();
    const after = await session.update(edited);

    // Halving twice the amplitude lowers RMS noticeably.
    expect(after.loudness.rms).toBeLessThan(before.loudness.rms);
    expect(after.peaks.levels.length).toBeGreaterThan(0);
  });
});

class FakeWorker {
  readonly terminate = vi.fn();
  readonly listeners = {
    message: new Set<(event: MessageEvent) => void>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };
  failAnalyze = false;

  postMessage(message: unknown): void {
    if (this.failAnalyze && (message as { type?: string }).type === "analyze") {
      throw new Error("post failed");
    }
  }

  addEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void),
  ): void {
    (this.listeners[type] as Set<typeof listener>).add(listener);
  }

  removeEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void),
  ): void {
    (this.listeners[type] as Set<typeof listener>).delete(listener);
  }

  listenerCount(type: "message" | "error"): number {
    return this.listeners[type].size;
  }

  emitError(message: string): void {
    for (const listener of this.listeners.error) {
      listener({ message } as ErrorEvent);
    }
  }
}

describe("analysis worker protocol envelope", () => {
  const registerOf = (clip: ReturnType<typeof makeClip>) => ({
    type: "register" as const,
    clipId: clip.id,
    clip: clip.toJSON(),
    channels: clip.channels()!,
  });

  it("accepts a request carrying the current protocol header", async () => {
    const state = createAnalysisWorkerState(createAudioAnalysisSession);
    const clip = makeClip();
    const registered = await handleAnalyzeRequest(state, {
      protocol: AUDIO_ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
      ...registerOf(clip),
    });
    expect(registered).toBeNull();
    expect(state.clips.has(clip.id)).toBe(true);
  });

  it("still accepts a legacy request that omits the header", async () => {
    const state = createAnalysisWorkerState(createAudioAnalysisSession);
    const clip = makeClip();
    await handleAnalyzeRequest(state, registerOf(clip));
    expect(state.clips.has(clip.id)).toBe(true);
  });

  it("rejects a foreign protocol instead of running the analysis", async () => {
    const state = createAnalysisWorkerState(createAudioAnalysisSession);
    const clip = makeClip();
    const response = await handleAnalyzeRequest(state, {
      protocol: "someone-elses-worker",
      protocolVersion: 1,
      ...registerOf(clip),
    } as never);
    expect(response?.type).toBe("error");
    if (response?.type === "error") {
      expect(response.message).toMatch(/Unsupported analysis worker protocol/);
    }
    // The foreign message never reached the state.
    expect(state.clips.has(clip.id)).toBe(false);
  });

  it("rejects a future protocol version and echoes the correlation id", async () => {
    const state = createAnalysisWorkerState(createAudioAnalysisSession);
    const clip = makeClip();
    await handleAnalyzeRequest(state, registerOf(clip));
    const response = await handleAnalyzeRequest(state, {
      protocol: AUDIO_ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: 99,
      type: "analyze",
      id: 7,
      clipId: clip.id,
    } as never);
    expect(response?.type).toBe("error");
    if (response?.type === "error") {
      expect(response.id).toBe(7);
      expect(response.message).toMatch(/protocol version 99/);
    }
  });

  it("rejects a half-filled header rather than guessing the sender", async () => {
    const state = createAnalysisWorkerState(createAudioAnalysisSession);
    const clip = makeClip();
    const response = await handleAnalyzeRequest(state, {
      protocolVersion: AUDIO_ANALYSIS_WORKER_PROTOCOL_VERSION,
      ...registerOf(clip),
    } as never);
    expect(response?.type).toBe("error");
    if (response?.type === "error") {
      expect(response.message).toMatch(/both be present or both be omitted/);
    }
  });
});
