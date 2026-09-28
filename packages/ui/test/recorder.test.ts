// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountRecorder,
  recorderStyle,
  type RecorderBinding,
  type RecorderState,
} from "../src/recorder";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeRecorder implements RecorderBinding {
  state: RecorderState = {
    recording: false,
    playing: false,
    level: 0.25,
    takeCount: 1,
    status: "Ready to record",
  };
  readonly subscribers = new Set<() => void>();
  readonly exports: string[] = [];
  readonly destroy = vi.fn();
  recordCalls = 0;
  playCalls = 0;

  snapshot(): RecorderState {
    return this.state;
  }

  toggleRecording(): void {
    this.recordCalls += 1;
    this.state = { ...this.state, recording: !this.state.recording };
    this.emit();
  }

  togglePlayback(): void {
    this.playCalls += 1;
    this.state = { ...this.state, playing: !this.state.playing };
    this.emit();
  }

  export(format: string): void {
    this.exports.push(format);
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  emit(): void {
    for (const notify of [...this.subscribers]) notify();
  }
}

function part<T extends Element = HTMLElement>(
  host: ParentNode,
  name: string,
): T {
  return host.querySelector<T>(`[part~="${name}"]`)!;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("mountRecorder", () => {
  it.each([
    {name: "default", options: {}, label: "Play take"},
    {name: "custom", options: {playLabel: "Preview take"}, label: "Preview take"},
  ])("keeps the $name playback label stable unless a stop label is requested", ({options, label}) => {
    const host = document.createElement("div");
    const binding = new FakeRecorder();
    const handle = mountRecorder(host, binding, options);
    const play = part<HTMLButtonElement>(host, "play");
    expect(play.getAttribute("aria-label")).toBe(label);

    play.click();
    expect(binding.playCalls).toBe(1);
    expect(play.getAttribute("aria-pressed")).toBe("true");
    expect(play.textContent).toBe("■ Stop");
    expect(play.getAttribute("aria-label")).toBe(label);

    play.click();
    expect(binding.playCalls).toBe(2);
    expect(play.getAttribute("aria-pressed")).toBe("false");
    expect(play.getAttribute("aria-label")).toBe(label);
    handle.destroy();
  });

  it("renders accessible native controls, stable hooks and caller-owned DOM", () => {
    const host = document.createElement("div");
    const unrelated = document.createElement("p");
    unrelated.textContent = "caller content";
    host.append(unrelated);
    document.body.append(host);
    const binding = new FakeRecorder();
    binding.state = {
      ...binding.state,
      canPlay: true,
      canExport: true,
      level: 0.375,
    };

    const handle = mountRecorder(host, binding, {
      exportFormats: [
        { id: "wav", label: "<b>WAV</b>" },
        { id: "mp3 compact", label: "MP3" },
      ],
      label: "Session recorder",
      recordLabel: "Capture",
      playLabel: "Preview take",
      meterLabel: "Microphone level",
      exportsLabel: "Download formats",
      statusLabel: "Capture status",
      classNames: {
        root: "custom-root",
        record: "custom-record",
        play: "custom-play",
        meter: "custom-meter",
        level: "custom-level",
        exports: "custom-exports",
        export: "custom-export",
        status: "custom-status",
      },
      parts: {
        root: "recorder-shell",
        record: "capture-control",
        play: "preview-control",
        meter: "input-meter",
        level: "input-level",
        exports: "download-group",
        export: "download-control",
        status: "capture-status",
      },
    });

    expect(host.firstElementChild).toBe(unrelated);
    expect(handle.element.getAttribute("role")).toBe("group");
    expect(handle.element.getAttribute("aria-label")).toBe("Session recorder");
    expect(handle.element.classList).toContain("wrap");
    expect(handle.element.classList).toContain("custom-root");
    expect(handle.element.getAttribute("part")).toContain("root");
    expect(handle.element.getAttribute("part")).toContain("recorder-shell");
    expect(
      host.querySelector('style[data-webmusic-ui="recorder"]')?.textContent,
    ).toBe(recorderStyle);

    const record = part<HTMLButtonElement>(host, "record");
    expect(record.type).toBe("button");
    expect(record.classList).toContain("rec");
    expect(record.classList).toContain("custom-record");
    expect(record.getAttribute("part")).toContain("capture-control");
    expect(record.getAttribute("aria-label")).toBe("Capture");
    expect(record.getAttribute("aria-pressed")).toBe("false");

    const play = part<HTMLButtonElement>(host, "play");
    expect(play.type).toBe("button");
    expect(play.classList).toContain("play");
    expect(play.classList).toContain("custom-play");
    expect(play.getAttribute("aria-label")).toBe("Preview take");

    const meter = part(host, "meter");
    expect(meter.classList).toContain("meter");
    expect(meter.classList).toContain("custom-meter");
    expect(meter.getAttribute("role")).toBe("progressbar");
    expect(meter.getAttribute("aria-label")).toBe("Microphone level");
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("1");
    expect(meter.getAttribute("aria-valuenow")).toBe("0.375");
    expect(meter.getAttribute("aria-valuetext")).toBe("38%");
    expect(part(host, "level").classList).toContain("level");
    expect(part(host, "level").classList).toContain("custom-level");
    expect(
      part<HTMLElement>(host, "level").style.getPropertyValue(
        "--wui-recorder-level",
      ),
    ).toBe("0.375");

    const exportGroup = part(host, "exports");
    expect(exportGroup.getAttribute("role")).toBe("group");
    expect(exportGroup.getAttribute("aria-label")).toBe("Download formats");
    expect(exportGroup.classList).toContain("custom-exports");
    const exportButtons = host.querySelectorAll<HTMLButtonElement>(
      '[part~="export"]',
    );
    expect(exportButtons).toHaveLength(2);
    expect(exportButtons[0]?.type).toBe("button");
    expect(exportButtons[0]?.classList).toContain("wav");
    expect(exportButtons[1]?.classList).toContain("mp3");
    expect(exportButtons[1]?.classList).toContain("compact");
    expect(exportButtons[0]?.classList).toContain("custom-export");
    expect(exportButtons[0]?.getAttribute("part")).toContain(
      "download-control",
    );
    expect(exportButtons[0]?.textContent).toBe("⬇ <b>WAV</b>");
    expect(host.querySelector("b")).toBeNull();

    const status = part(host, "status");
    expect(status.classList).toContain("status");
    expect(status.classList).toContain("custom-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.getAttribute("aria-label")).toBe("Capture status");
    expect(status.textContent).toBe("Ready to record");
  });

  it("renders playback and exports only when their commands exist", () => {
    const basicHost = document.createElement("div");
    const basic = new FakeRecorder();
    basic.togglePlayback = undefined as never;
    basic.export = undefined as never;
    mountRecorder(basicHost, basic, {
      exportFormats: [{ id: "wav", label: "WAV" }],
    });
    expect(basicHost.querySelector('[part~="record"]')).not.toBeNull();
    expect(basicHost.querySelector('[part~="play"]')).toBeNull();
    expect(basicHost.querySelector('[part~="exports"]')).toBeNull();
    expect(basicHost.querySelector('[part~="export"]')).toBeNull();

    const noFormatsHost = document.createElement("div");
    mountRecorder(noFormatsHost, new FakeRecorder());
    expect(noFormatsHost.querySelector('[part~="play"]')).not.toBeNull();
    expect(noFormatsHost.querySelector('[part~="exports"]')).toBeNull();
  });

  it("clamps finite state and gates busy, disabled and unavailable commands", () => {
    const host = document.createElement("div");
    const binding = new FakeRecorder();
    binding.state = {
      recording: false,
      playing: false,
      level: Number.POSITIVE_INFINITY,
      takeCount: 1.9,
    };
    mountRecorder(host, binding, {
      exportFormats: [{ id: "wav", label: "WAV" }],
      stopRecordingLabel: "Finish capture",
      stopPlaybackLabel: "Stop preview",
    });

    const record = part<HTMLButtonElement>(host, "record");
    const exportButton = part<HTMLButtonElement>(host, "export");
    expect(part(host, "meter").getAttribute("aria-valuenow")).toBe("0");
    expect(part(host, "status").textContent).toBe("captured 1");
    expect(part<HTMLButtonElement>(host, "play").disabled).toBe(false);
    expect(exportButton.disabled).toBe(false);

    binding.state = {
      recording: true,
      playing: false,
      level: 2,
      recordedCount: 4.9,
      takeCount: 1,
    };
    binding.emit();
    expect(record.getAttribute("aria-label")).toBe("Finish capture");
    expect(record.getAttribute("aria-pressed")).toBe("true");
    expect(record.classList).toContain("armed");
    expect(part(host, "meter").getAttribute("aria-valuenow")).toBe("1");
    expect(part(host, "status").textContent).toBe("● recording… 4");

    binding.state = {
      recording: false,
      playing: true,
      level: -1,
      canPlay: false,
      canExport: false,
    };
    binding.emit();
    const activePlay = part<HTMLButtonElement>(host, "play");
    expect(activePlay.disabled).toBe(false);
    expect(activePlay.getAttribute("aria-label")).toBe("Stop preview");
    activePlay.click();
    expect(binding.playCalls).toBe(1);

    binding.state = {
      recording: false,
      playing: false,
      busy: true,
      level: 0.5,
      canPlay: true,
      canExport: true,
    };
    binding.emit();
    expect(part(host, "root").getAttribute("aria-busy")).toBe("true");
    expect(record.disabled).toBe(true);
    expect(part<HTMLButtonElement>(host, "play").disabled).toBe(true);
    expect(exportButton.disabled).toBe(true);
    record.dispatchEvent(new Event("click", { bubbles: true }));
    part(host, "play").dispatchEvent(new Event("click", { bubbles: true }));
    exportButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(binding.recordCalls).toBe(0);
    expect(binding.playCalls).toBe(1);
    expect(binding.exports).toEqual([]);

    binding.state = {
      ...binding.state,
      busy: false,
      disabled: true,
    };
    binding.emit();
    expect(part(host, "root").getAttribute("aria-disabled")).toBe("true");
    record.dispatchEvent(new Event("click", { bubbles: true }));
    part(host, "play").dispatchEvent(new Event("click", { bubbles: true }));
    exportButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(binding.recordCalls).toBe(0);
    expect(binding.playCalls).toBe(1);
    expect(binding.exports).toEqual([]);

    binding.state = {
      recording: false,
      playing: false,
      canPlay: false,
      canExport: false,
    };
    binding.emit();
    expect(part(host, "meter").hasAttribute("hidden")).toBe(true);
    expect(record.disabled).toBe(false);
    expect(part<HTMLButtonElement>(host, "play").disabled).toBe(true);
    expect(exportButton.disabled).toBe(true);
    record.click();
    part(host, "play").dispatchEvent(new Event("click", { bubbles: true }));
    exportButton.dispatchEvent(new Event("click", { bubbles: true }));
    expect(binding.recordCalls).toBe(1);
    expect(binding.playCalls).toBe(1);
    expect(binding.exports).toEqual([]);
  });

  it("reconciles stale command settlements but reports only the latest failure", async () => {
    const host = document.createElement("div");
    const first = deferred();
    const second = deferred();
    const staleFailure = new Error("stale recording failed");
    const onError = vi.fn();
    let state: RecorderState = {
      recording: false,
      playing: false,
      canPlay: true,
      status: "Initial",
    };
    const binding: RecorderBinding = {
      snapshot: () => state,
      toggleRecording: () =>
        first.promise.then(() => {
          state = { ...state, recording: true, status: "Recording settled" };
          throw staleFailure;
        }),
      togglePlayback: () =>
        second.promise.then(() => {
          state = { ...state, playing: true, status: "Playback settled" };
        }),
    };
    mountRecorder(host, binding, { onError });

    part<HTMLButtonElement>(host, "record").click();
    part<HTMLButtonElement>(host, "play").click();
    second.resolve();
    await flush();
    expect(part(host, "status").textContent).toBe("Playback settled");

    first.resolve();
    await flush();
    expect(part(host, "status").textContent).toBe("Recording settled");
    expect(part(host, "record").getAttribute("aria-pressed")).toBe("true");
    expect(onError).not.toHaveBeenCalled();
  });

  it("contains subscribe, snapshot, command and async reporter failures", async () => {
    const host = document.createElement("div");
    const binding = new FakeRecorder();
    binding.state = { ...binding.state, canPlay: true };
    const subscribeFailure = new Error("subscribe failed");
    const playbackFailure = new Error("playback failed");
    const snapshotFailure = new Error("snapshot failed");
    const reported: unknown[] = [];
    binding.subscribe = () => {
      throw subscribeFailure;
    };
    binding.toggleRecording = () => {
      throw undefined;
    };
    binding.togglePlayback = () => Promise.reject(playbackFailure);

    const handle = mountRecorder(host, binding, {
      onError: async (error) => {
        reported.push(error);
        throw new Error("reporter failed");
      },
    });
    expect(reported).toEqual([subscribeFailure]);

    expect(() =>
      part(host, "record").dispatchEvent(
        new Event("click", { bubbles: true }),
      ),
    ).not.toThrow();
    expect(reported).toEqual([subscribeFailure, undefined]);

    part<HTMLButtonElement>(host, "play").click();
    await flush();
    expect(reported).toEqual([
      subscribeFailure,
      undefined,
      playbackFailure,
    ]);

    binding.snapshot = () => {
      throw snapshotFailure;
    };
    handle.update();
    expect(reported).toEqual([
      subscribeFailure,
      undefined,
      playbackFailure,
      snapshotFailure,
    ]);
  });

  it("reports an invalid subscribe result and keeps the mounted surface usable", async () => {
    const host = document.createElement("div");
    const binding = new FakeRecorder();
    binding.subscribe = () => 1 as never;
    const onError = vi.fn();

    mountRecorder(host, binding, { onError });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    part<HTMLButtonElement>(host, "record").click();
    await flush();
    expect(binding.recordCalls).toBe(1);
    expect(part(host, "record").getAttribute("aria-pressed")).toBe("true");
  });

  it("bounds synchronous update reentry to 32 passes", () => {
    const host = document.createElement("div");
    let notify: (() => void) | undefined;
    let snapshots = 0;
    const errors: unknown[] = [];
    const binding: RecorderBinding = {
      snapshot: () => {
        snapshots += 1;
        notify?.();
        return { recording: false };
      },
      toggleRecording: () => undefined,
      subscribe: (next) => {
        notify = next;
        return () => {
          notify = undefined;
        };
      },
    };

    mountRecorder(host, binding, { onError: (error) => errors.push(error) });

    expect(snapshots).toBe(32);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(String(errors[0])).toContain("did not stabilize after 32 passes");
  });

  it("keeps stale controls and pending settlements inert after replacement", async () => {
    const host = document.createElement("div");
    const pending = deferred();
    const first = new FakeRecorder();
    const firstError = vi.fn();
    first.toggleRecording = vi.fn(() => pending.promise);
    const firstHandle = mountRecorder(host, first, { onError: firstError });
    const staleRecord = part<HTMLButtonElement>(host, "record");
    staleRecord.click();

    const second = new FakeRecorder();
    second.state = { ...second.state, status: "Replacement" };
    const secondHandle = mountRecorder(host, second);
    staleRecord.dispatchEvent(new Event("click", { bubbles: true }));
    pending.reject(new Error("stale rejection"));
    await flush();

    expect(first.toggleRecording).toHaveBeenCalledOnce();
    expect(firstError).not.toHaveBeenCalled();
    expect(firstHandle.element.isConnected).toBe(false);
    expect(host.querySelectorAll(".wui-recorder")).toHaveLength(1);
    expect(host.querySelector(".wui-recorder")).toBe(secondHandle.element);
    expect(part(host, "status").textContent).toBe("Replacement");
  });

  it("lets a synchronous subscribe remount win and cleans stale ownership once", () => {
    const host = document.createElement("div");
    const attempted = new FakeRecorder();
    const replacement = new FakeRecorder();
    replacement.state = { ...replacement.state, status: "Winner" };
    const cleanup = vi.fn(() => attempted.subscribers.clear());
    let replacementHandle: ReturnType<typeof mountRecorder> | undefined;
    attempted.snapshot = () => {
      replacementHandle = mountRecorder(host, replacement);
      return attempted.state;
    };
    attempted.subscribe = (notify) => {
      attempted.subscribers.add(notify);
      notify();
      return cleanup;
    };

    const staleHandle = mountRecorder(host, attempted);

    expect(replacementHandle).toBeDefined();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(attempted.subscribers.size).toBe(0);
    expect(host.querySelectorAll(".wui-recorder")).toHaveLength(1);
    expect(host.querySelector(".wui-recorder")).toBe(
      replacementHandle!.element,
    );
    expect(part(host, "status").textContent).toBe("Winner");
    staleHandle.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.querySelector(".wui-recorder")).toBe(
      replacementHandle!.element,
    );
  });

  it("never overwrites replacements mounted by capability getters or format iterators", () => {
    const capabilityHost = document.createElement("div");
    const capabilityAttempt = new FakeRecorder();
    const capabilityWinner = new FakeRecorder();
    capabilityWinner.state = {
      ...capabilityWinner.state,
      status: "Capability winner",
    };
    let capabilityHandle: ReturnType<typeof mountRecorder> | undefined;
    Object.defineProperty(capabilityAttempt, "togglePlayback", {
      configurable: true,
      get: () => {
        capabilityHandle = mountRecorder(capabilityHost, capabilityWinner);
        return () => undefined;
      },
    });
    const capabilitySubscribe = vi.spyOn(capabilityAttempt, "subscribe");

    const staleCapability = mountRecorder(
      capabilityHost,
      capabilityAttempt,
    );

    expect(capabilityHandle).toBeDefined();
    expect(capabilitySubscribe).not.toHaveBeenCalled();
    expect(staleCapability.element.isConnected).toBe(false);
    expect(capabilityHost.querySelectorAll(".wui-recorder")).toHaveLength(1);
    expect(capabilityHost.querySelector(".wui-recorder")).toBe(
      capabilityHandle!.element,
    );
    expect(part(capabilityHost, "status").textContent).toBe(
      "Capability winner",
    );

    const iteratorHost = document.createElement("div");
    const iteratorAttempt = new FakeRecorder();
    const iteratorWinner = new FakeRecorder();
    iteratorWinner.state = { ...iteratorWinner.state, status: "Iterator winner" };
    let iteratorHandle: ReturnType<typeof mountRecorder> | undefined;
    const formats = {
      [Symbol.iterator](): Iterator<{ id: string; label: string }> {
        iteratorHandle = mountRecorder(iteratorHost, iteratorWinner);
        return [{ id: "wav", label: "WAV" }][Symbol.iterator]();
      },
    } as unknown as readonly { id: string; label: string }[];
    const iteratorSubscribe = vi.spyOn(iteratorAttempt, "subscribe");

    const staleIterator = mountRecorder(iteratorHost, iteratorAttempt, {
      exportFormats: formats,
    });

    expect(iteratorHandle).toBeDefined();
    expect(iteratorSubscribe).not.toHaveBeenCalled();
    expect(staleIterator.element.isConnected).toBe(false);
    expect(iteratorHost.querySelectorAll(".wui-recorder")).toHaveLength(1);
    expect(iteratorHost.querySelector(".wui-recorder")).toBe(
      iteratorHandle!.element,
    );
    expect(part(iteratorHost, "status").textContent).toBe("Iterator winner");
  });

  it("removes outer nodes committed late by a reentrant host append", () => {
    const host = document.createElement("div");
    const unrelated = document.createElement("p");
    host.append(unrelated);
    const attempted = new FakeRecorder();
    const replacement = new FakeRecorder();
    replacement.state = { ...replacement.state, status: "Append winner" };
    const nativeAppend = host.append.bind(host);
    let nesting = false;
    let replacementHandle: ReturnType<typeof mountRecorder> | undefined;
    vi.spyOn(host, "append").mockImplementation((...nodes) => {
      if (nesting) {
        nativeAppend(...nodes);
        return;
      }
      nesting = true;
      replacementHandle = mountRecorder(host, replacement);
      // Simulate a custom host that commits the stale outer nodes only after
      // the nested mount has already destroyed the outer handle.
      nativeAppend(...nodes);
    });

    const staleHandle = mountRecorder(host, attempted);

    expect(replacementHandle).toBeDefined();
    expect(staleHandle.element.isConnected).toBe(false);
    expect(host.querySelectorAll(".wui-recorder")).toHaveLength(1);
    expect(host.querySelectorAll('style[data-webmusic-ui="recorder"]')).toHaveLength(
      1,
    );
    expect(host.querySelector(".wui-recorder")).toBe(
      replacementHandle!.element,
    );
    expect(part(host, "status").textContent).toBe("Append winner");
    expect(host.firstElementChild).toBe(unrelated);
  });

  it("keeps a cleanup-mounted replacement as the only host owner", () => {
    const host = document.createElement("div");
    const first = new FakeRecorder();
    first.subscribe = () => () => {
      throw new Error("first cleanup failed");
    };
    const replacement = new FakeRecorder();
    replacement.state = { ...replacement.state, status: "Nested winner" };
    let replacementHandle: ReturnType<typeof mountRecorder> | undefined;
    mountRecorder(host, first, {
      onError: () => {
        replacementHandle = mountRecorder(host, replacement);
      },
    });
    const attempted = new FakeRecorder();
    const subscribe = vi.spyOn(attempted, "subscribe");

    const staleHandle = mountRecorder(host, attempted);

    expect(replacementHandle).toBeDefined();
    expect(subscribe).not.toHaveBeenCalled();
    expect(host.querySelectorAll(".wui-recorder")).toHaveLength(1);
    expect(host.querySelector(".wui-recorder")).toBe(
      replacementHandle!.element,
    );
    staleHandle.destroy();
    expect(host.querySelector(".wui-recorder")).toBe(
      replacementHandle!.element,
    );
  });

  it("finishes best-effort destroy, reports undefined and never owns binding", async () => {
    const host = document.createElement("div");
    const unrelated = document.createElement("p");
    host.append(unrelated);
    const binding = new FakeRecorder();
    const pending = deferred();
    binding.toggleRecording = vi.fn(() => pending.promise);
    binding.subscribe = (notify) => {
      binding.subscribers.add(notify);
      return () => {
        binding.subscribers.delete(notify);
        throw undefined;
      };
    };
    const onError = vi.fn();
    const handle = mountRecorder(host, binding, { onError });
    const staleRecord = part<HTMLButtonElement>(host, "record");
    staleRecord.click();

    handle.destroy();
    handle.destroy();
    staleRecord.dispatchEvent(new Event("click", { bubbles: true }));
    pending.reject(new Error("destroyed command"));
    await flush();

    expect(binding.toggleRecording).toHaveBeenCalledOnce();
    expect(binding.subscribers.size).toBe(0);
    expect(binding.destroy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).toBe(unrelated);
  });

  it("rolls back a partially appended mount and remains recoverable", () => {
    const host = document.createElement("div");
    const unrelated = document.createElement("p");
    host.append(unrelated);
    const failure = new Error("append failed");
    const originalAppend = host.append.bind(host);
    const append = vi.spyOn(host, "append").mockImplementation((...nodes) => {
      originalAppend(nodes[0]!);
      throw failure;
    });
    const failedBinding = new FakeRecorder();

    expect(() => mountRecorder(host, failedBinding)).toThrow(failure);
    expect(failedBinding.subscribers.size).toBe(0);
    expect(host.firstElementChild).toBe(unrelated);
    expect(host.childElementCount).toBe(1);
    expect(host.querySelector(".wui-recorder")).toBeNull();
    expect(host.querySelector('style[data-webmusic-ui="recorder"]')).toBeNull();

    append.mockRestore();
    const recovery = mountRecorder(host, new FakeRecorder());
    expect(host.querySelector(".wui-recorder")).toBe(recovery.element);
  });
});
