// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScorePlaybackSource } from "@webmusic/score";
import type { TransportBinding } from "@webmusic/ui/transport";
import { mountDemos } from "../src/components/demo-lifecycle";
import { mountBridgeComposition } from "../src/components/bridges/bridge-composition-client";

const boundaries = vi.hoisted(() => ({
  render: vi.fn(),
  pair: vi.fn(),
  waveform: vi.fn(),
  transport: vi.fn(),
}));
vi.mock("@webmusic/score/view/element", () => ({
  defineScoreViewElement: vi.fn(),
}));
vi.mock("@webmusic/score/analyze/element", () => ({
  defineChordAnalysisElement: vi.fn(),
}));
vi.mock("@webmusic/audio/analyze", () => ({ computePeaks: vi.fn(() => ({})) }));
vi.mock("@webmusic/audio/view/render", () => ({
  renderWaveformVisualizer: boundaries.waveform,
}));
vi.mock("@webmusic/bridge", () => ({
  createSyncedPlayback: boundaries.pair,
  renderScoreToClip: boundaries.render,
}));
vi.mock("@webmusic/ui/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@webmusic/ui/transport")>();
  return {
    ...actual,
    mountTransport: (...args: Parameters<typeof actual.mountTransport>) => {
      boundaries.transport(...args);
      return actual.mountTransport(...args);
    },
  };
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const clip = {
  duration: 8,
  sampleRate: 44100,
  channels: () => [new Float32Array(8)],
};
function newPair() {
  const state = {
    revision: 0,
    position: 0,
    rate: 1,
    paused: true,
    pending: false,
  };
  const scoreSnapshot = {
    nominalSeconds: 0,
    nominalDurationSeconds: 8,
    score: { title: "same source" },
  };
  const sync = {
    get snapshot() {
      return { ...state };
    },
    subscribe: vi.fn(() => vi.fn()),
    dispatch: vi.fn(
      async (command: { type: string; position?: number; rate?: number }) => {
        state.revision++;
        if (command.position !== undefined) state.position = command.position;
        if (command.rate !== undefined) state.rate = command.rate;
        if (command.type === "play") state.paused = false;
        if (command.type === "pause") state.paused = true;
        return {
          status: "committed",
          revision: state.revision,
          snapshot: { ...state },
        };
      },
    ),
    dispose: vi.fn(),
  };
  return {
    sync,
    scorePlayer: {
      setVolume: vi.fn(),
      playback: {
        snapshot: vi.fn(() => scoreSnapshot),
        subscribe: vi.fn(() => vi.fn()),
        seekNominal: vi.fn(),
      },
    },
    clipPlayer: { seconds: 0 },
  };
}

let contexts: Array<{
  state: string;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}>;
let stop: (() => void) | undefined;
let binding: TransportBinding;
let pairs: ReturnType<typeof newPair>[];
let waves: Array<{
  redraw: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}>;
function mount() {
  document.body.innerHTML = `<section data-composition-test>
    <button data-load></button><button data-replace></button><button data-dispose></button><button data-attach></button>
    <select data-rate><option value="1">1</option><option value="2">2</option></select><input data-loop type="checkbox">
    <output data-status></output><output data-position></output><pre data-events></pre>
    <div data-score-views></div><div data-wave-surface></div><div data-playback-owner></div><div data-transport></div>
  </section>`;
  stop = mountDemos("[data-composition-test]", mountBridgeComposition);
  return document.querySelector<HTMLElement>("[data-composition-test]")!;
}
function click(root: HTMLElement, selector: string) {
  root.querySelector<HTMLButtonElement>(selector)!.click();
}

beforeEach(() => {
  vi.clearAllMocks();
  contexts = [];
  pairs = [];
  waves = [];
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {
        this.state = "closed";
      });
      constructor() {
        contexts.push(this);
      }
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  boundaries.render.mockReset().mockResolvedValue(clip);
  boundaries.pair.mockReset().mockImplementation(() => {
    const pair = newPair();
    pairs.push(pair);
    return pair;
  });
  boundaries.waveform.mockReset().mockImplementation(() => {
    const wave = { redraw: vi.fn(), dispose: vi.fn() };
    waves.push(wave);
    return wave;
  });
  boundaries.transport
    .mockReset()
    .mockImplementation((_host, supplied: TransportBinding) => {
      binding = supplied;
    });
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  await flush();
  vi.unstubAllGlobals();
});

describe("reference playback composition lifecycle", () => {
  it("destroys the actual public transport presenter when its scope is released", () => {
    const root = mount();
    const host = root.querySelector<HTMLElement>("[data-transport]")!;
    expect(host.querySelector("button")).not.toBeNull();
    stop?.();
    stop = undefined;
    expect(host.querySelector("button")).toBeNull();
  });

  it("does not install a late rendered session after its host is removed", async () => {
    const pending = deferred<typeof clip>();
    boundaries.render.mockReturnValueOnce(pending.promise);
    const root = mount();
    click(root, "[data-load]");
    await flush();
    expect(boundaries.render).toHaveBeenCalledOnce();
    root.remove();
    await flush();
    pending.resolve(clip);
    await flush();
    expect(boundaries.pair).not.toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("retains the previous paused source when replacement rendering fails", async () => {
    const root = mount();
    click(root, "[data-load]");
    await flush();
    const first = pairs[0];
    const owner = root.querySelector("[data-playback-owner]") as HTMLElement & {
      playback: ScorePlaybackSource;
    };
    const previousSource = owner.playback;
    boundaries.render.mockRejectedValueOnce(new Error("offline render failed"));
    click(root, "[data-replace]");
    await flush();
    expect(first.sync.dispatch).toHaveBeenCalledWith({ type: "pause" });
    expect(first.sync.dispose).not.toHaveBeenCalled();
    expect(owner.playback).toBe(previousSource);
    expect(root.querySelector("[data-status]")!.textContent).toContain(
      "previous source remains paused",
    );
    await binding.play();
    expect(first.sync.dispatch).toHaveBeenLastCalledWith({ type: "play" });
  });

  it("replaces followers and releases the old pair only after the candidate is ready", async () => {
    const root = mount();
    click(root, "[data-load]");
    await flush();
    click(root, "[data-attach]");
    const previousView = root.querySelector("score-view")!;
    const pending = deferred<typeof clip>();
    boundaries.render.mockReturnValueOnce(pending.promise);
    click(root, "[data-replace]");
    await flush();
    expect(previousView.isConnected).toBe(true);
    expect(pairs[0].sync.dispose).not.toHaveBeenCalled();
    pending.resolve(clip);
    await flush();
    expect(pairs).toHaveLength(2);
    expect(pairs[0].sync.dispose).toHaveBeenCalledOnce();
    expect(waves[0].dispose).toHaveBeenCalledOnce();
    expect(previousView.isConnected).toBe(false);
    expect(root.querySelector("score-view")).not.toBe(previousView);
    expect(contexts).toHaveLength(1);
  });

  it("disposal during replacement invalidates the candidate and releases the current owner", async () => {
    const root = mount();
    click(root, "[data-load]");
    await flush();
    const pending = deferred<typeof clip>();
    boundaries.render.mockReturnValueOnce(pending.promise);
    click(root, "[data-replace]");
    await flush();
    click(root, "[data-dispose]");
    pending.resolve(clip);
    await flush();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].sync.dispose).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(root.querySelector("score-view")).toBeNull();
    expect(root.querySelector("[data-status]")!.textContent).toContain(
      "Disposed",
    );
  });

  it("late views reuse the source while all seeking goes through the group in nominal seconds", async () => {
    const root = mount();
    click(root, "[data-load]");
    await flush();
    await binding.play();
    click(root, "[data-attach]");
    const owner = root.querySelector("[data-playback-owner]") as HTMLElement & {
      playback: ScorePlaybackSource;
    };
    expect(root.querySelector("score-view")!.getAttribute("player")).toBe(
      `#${owner.id}`,
    );
    expect(root.querySelector("score-chord-analysis")!.hasAttribute("src")).toBe(
      false,
    );
    expect(owner.playback.snapshot()).toBe(
      pairs[0].scorePlayer.playback.snapshot(),
    );
    const rate = root.querySelector<HTMLSelectElement>("[data-rate]")!;
    rate.value = "2";
    rate.dispatchEvent(new Event("change"));
    await flush();
    await binding.seekFraction(0.5);
    expect(pairs[0].sync.dispatch).toHaveBeenLastCalledWith({
      type: "seek",
      position: 4,
    });
    await owner.playback.seekNominal!(4.25);
    expect(pairs[0].sync.dispatch).toHaveBeenLastCalledWith({
      type: "seek",
      position: 4.25,
    });
    expect(pairs[0].scorePlayer.playback.seekNominal).not.toHaveBeenCalled();
    expect(boundaries.render).toHaveBeenCalledOnce();
    expect(boundaries.pair).toHaveBeenCalledOnce();
  });
});
