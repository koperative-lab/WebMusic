// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  mountEnvelope,
  type EnvelopeBinding,
  type EnvelopeSnapshot,
  type EnvelopeState,
} from "../src/envelope";

class FakeEnvelope implements EnvelopeBinding {
  state: EnvelopeSnapshot = {
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4 },
    ranges: { attackMax: 2, decayMax: 2, releaseMax: 2 },
  };
  readonly changes: EnvelopeState[] = [];
  readonly subscribers = new Set<() => void>();

  snapshot(): EnvelopeSnapshot {
    return this.state;
  }

  setEnvelope(envelope: EnvelopeState): void {
    this.changes.push({ ...envelope });
    this.state = { ...this.state, envelope: { ...envelope } };
    this.subscribers.forEach((notify) => notify());
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }
}

function range(host: ParentNode, stage: keyof EnvelopeState): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(
    `input[data-stage="${stage}"]`,
  );
  if (!input) throw new Error(`Missing ${stage} input`);
  return input;
}

function inputValue(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pointer(
  target: Element,
  type: string,
  values: { pointerId: number; clientX?: number; clientY?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientX: { value: values.clientX ?? 0 },
    clientY: { value: values.clientY ?? 0 },
  });
  target.dispatchEvent(event);
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mountEnvelope", () => {
  it("renders the canonical ADSR geometry with customizable legacy classes", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const handle = mountEnvelope(host, binding, {
      classNames: {
        root: "wrap",
        grid: "grid",
        area: "area",
        curve: "curve",
        handle: "handle",
        readout: "read",
      },
      parts: { root: "editor", handle: "point" },
    });

    expect(handle.element.classList).toContain("wrap");
    expect(handle.element.getAttribute("part")).toContain("editor");
    expect(host.querySelectorAll(".grid")).toHaveLength(3);
    expect(
      [...host.querySelectorAll<SVGCircleElement>("circle.handle")].map(
        (node) => node.dataset.h,
      ),
    ).toEqual(["a", "ds", "r"]);
    expect(host.querySelector('.handle[data-h="a"]')?.getAttribute("cx")).toBe(
      "0.625",
    );
    expect(host.querySelector('.handle[data-h="ds"]')?.getAttribute("cx")).toBe(
      "3.125",
    );
    expect(host.querySelector('.handle[data-h="ds"]')?.getAttribute("cy")).toBe(
      "40",
    );
    expect(host.querySelector(".read")?.textContent).toBe(
      "A 0.05s · D 0.20s · S 60% · R 0.40s",
    );
    expect(host.querySelector(".curve")?.getAttribute("fill")).toBe("none");
    expect(host.querySelector(".area")?.getAttribute("fill")).toBe("none");
  });

  it("keeps handle circles round across non-uniform SVG resizes", () => {
    let resize!: ResizeObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    });
    const host = document.createElement("div");
    const handle = mountEnvelope(host, new FakeEnvelope());
    const svg = host.querySelector<SVGSVGElement>("svg")!;
    let scaleX = 4;
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({a: scaleX, b: 0, c: 0, d: 1}),
    });

    resize([], {} as ResizeObserver);

    const circles = [...host.querySelectorAll<SVGCircleElement>("circle")];
    expect(observe).toHaveBeenCalledWith(svg);
    expect(circles).toHaveLength(3);
    expect(circles.every((circle) => circle.classList.contains("wui-envelope__handle"))).toBe(true);
    expect(circles.every((circle) => circle.getAttribute("transform")?.includes("scale(0.25 1)"))).toBe(true);

    scaleX = 2;
    resize([], {} as ResizeObserver);
    expect(circles.every((circle) => circle.getAttribute("transform")?.includes("scale(0.5 1)"))).toBe(true);

    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("exposes four native named ranges and maps keyboard focus to visible handles", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const binding = new FakeEnvelope();
    mountEnvelope(host, binding);
    const inputs = host.querySelectorAll<HTMLInputElement>(
      'input[type="range"]',
    );

    expect(inputs).toHaveLength(4);
    expect(
      [...inputs].map((input) => input.getAttribute("aria-label")),
    ).toEqual(["Attack", "Decay", "Sustain", "Release"]);
    expect(range(host, "attack").getAttribute("aria-valuetext")).toBe(
      "0.05 seconds",
    );
    expect(range(host, "sustain").getAttribute("aria-valuetext")).toBe("60%");

    range(host, "decay").focus();
    expect(
      host
        .querySelector('.wui-envelope__handle[data-h="ds"]')
        ?.classList.contains("is-focused"),
    ).toBe(true);
    range(host, "decay").blur();
    expect(
      host
        .querySelector('.wui-envelope__handle[data-h="ds"]')
        ?.classList.contains("is-focused"),
    ).toBe(false);

    inputValue(range(host, "release"), 1.25);
    expect(binding.changes.at(-1)).toEqual({
      attack: 0.05,
      decay: 0.2,
      sustain: 0.6,
      release: 1.25,
    });
    expect(range(host, "release").getAttribute("aria-valuetext")).toBe(
      "1.25 seconds",
    );
  });

  it("drags each legacy handle, captures one pointer, and cancels safely", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    mountEnvelope(host, binding);
    const svg = host.querySelector("svg") as SVGSVGElement & {
      setPointerCapture: Mock<SVGSVGElement["setPointerCapture"]>;
      releasePointerCapture: Mock<SVGSVGElement["releasePointerCapture"]>;
      hasPointerCapture: Mock<SVGSVGElement["hasPointerCapture"]>;
    };
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });
    svg.setPointerCapture = vi.fn<SVGSVGElement["setPointerCapture"]>();
    svg.releasePointerCapture = vi.fn<SVGSVGElement["releasePointerCapture"]>();
    svg.hasPointerCapture = vi.fn(() => true);
    const decay = host.querySelector('.wui-envelope__handle[data-h="ds"]')!;

    pointer(decay, "pointerdown", { pointerId: 7 });
    pointer(svg, "lostpointercapture", { pointerId: 8 });
    pointer(svg, "pointermove", { pointerId: 8, clientX: 20, clientY: 25 });
    expect(binding.changes).toHaveLength(0);
    pointer(svg, "pointermove", { pointerId: 7, clientX: 20, clientY: 25 });
    expect(binding.changes.at(-1)?.decay).toBeCloseTo(1.55);
    expect(binding.changes.at(-1)?.sustain).toBe(0.75);
    expect(svg.setPointerCapture).toHaveBeenCalledWith(7);

    pointer(svg, "pointercancel", { pointerId: 7 });
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(7);
    const count = binding.changes.length;
    pointer(svg, "pointermove", { pointerId: 7, clientX: 25, clientY: 50 });
    expect(binding.changes).toHaveLength(count);
  });

  it("coalesces a synchronous subscriber re-entry and preserves the live control", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const handle = mountEnvelope(host, binding);
    const attack = range(host, "attack");

    inputValue(attack, 0.75);
    handle.update();

    expect(range(host, "attack")).toBe(attack);
    expect(attack.value).toBe("0.75");
    expect(binding.changes).toHaveLength(1);
  });

  it("keeps drag values tied to the resized plot when the readout adds height", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const handle = mountEnvelope(host, binding);
    const svg = host.querySelector("svg")!;
    let plot = {left: 20, top: 30, width: 100, height: 80};
    Object.defineProperty(handle.element, "getBoundingClientRect", {
      value: () => ({...plot, height: 240}),
    });
    Object.defineProperty(svg, "getBoundingClientRect", {value: () => plot});
    pointer(host.querySelector('[data-h="ds"]')!, "pointerdown", {pointerId: 1});
    pointer(svg, "pointermove", {pointerId: 1, clientX: 40, clientY: 50});
    expect(binding.changes.at(-1)?.decay).toBeCloseTo(1.55);
    expect(binding.changes.at(-1)?.sustain).toBe(0.75);
    plot = {...plot, width: 200, height: 120};
    pointer(svg, "pointermove", {pointerId: 1, clientX: 60, clientY: 60});
    expect(binding.changes.at(-1)?.decay).toBeCloseTo(1.55);
    expect(binding.changes.at(-1)?.sustain).toBe(0.75);
    handle.destroy();
  });

  it("keeps the last good drawing through a transient snapshot failure", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const onError = vi.fn();
    const snapshot = binding.snapshot.bind(binding);
    let fail = false;
    binding.snapshot = () => {
      if (fail) throw new Error("snapshot failed");
      return snapshot();
    };
    const handle = mountEnvelope(host, binding, { onError });
    const points = host
      .querySelector(".wui-envelope__curve")
      ?.getAttribute("points");

    fail = true;
    handle.update();

    expect(onError).toHaveBeenCalledOnce();
    expect(
      host.querySelector(".wui-envelope__curve")?.getAttribute("points"),
    ).toBe(points);
  });

  it("normalizes hostile values and ranges without producing invalid geometry", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    binding.state = {
      envelope: {
        attack: Number.NaN,
        decay: Number.POSITIVE_INFINITY,
        sustain: -2,
        release: 9,
      },
      ranges: { attackMax: 0, decayMax: -1, releaseMax: Number.NaN },
    };

    mountEnvelope(host, binding);

    const curve = host
      .querySelector(".wui-envelope__curve")
      ?.getAttribute("points");
    expect(curve).not.toMatch(/NaN|Infinity/);
    expect(range(host, "attack").max).toBe("2");
    expect(range(host, "sustain").value).toBe("0");
  });

  it("reports synchronous and asynchronous command failures and repaints", async () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const failure = new Error("command failed");
    const rejection = new Error("command rejected");
    const pending = deferred();
    const onError = vi.fn();
    binding.setEnvelope = vi
      .fn()
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockReturnValueOnce(pending.promise);
    mountEnvelope(host, binding, { onError });

    inputValue(range(host, "attack"), 0.4);
    inputValue(range(host, "decay"), 0.8);
    pending.reject(rejection);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(onError).toHaveBeenCalledWith(rejection);
    expect(range(host, "attack").value).toBe("0.05");
  });

  it("suppresses stale rejected commands after destroy", async () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const pending = deferred();
    const onError = vi.fn();
    binding.setEnvelope = () => pending.promise;
    const handle = mountEnvelope(host, binding, { onError });
    inputValue(range(host, "attack"), 0.4);

    handle.destroy();
    pending.reject(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores an older command rejection after the latest command settles", async () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const first = deferred();
    const second = deferred();
    const onError = vi.fn();
    const snapshot = vi.spyOn(binding, "snapshot");
    binding.setEnvelope = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    mountEnvelope(host, binding, { onError });

    inputValue(range(host, "attack"), 0.4);
    inputValue(range(host, "attack"), 0.8);
    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const settledSnapshots = snapshot.mock.calls.length;
    const settledValue = range(host, "attack").value;

    first.reject(new Error("stale rejection"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(settledSnapshots);
    expect(range(host, "attack").value).toBe(settledValue);
  });

  it("ignores an older command resolution after the latest command settles", async () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const first = deferred();
    const second = deferred();
    const snapshot = vi.spyOn(binding, "snapshot");
    binding.setEnvelope = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    mountEnvelope(host, binding);

    inputValue(range(host, "release"), 0.6);
    inputValue(range(host, "release"), 1.1);
    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const settledSnapshots = snapshot.mock.calls.length;
    const settledValue = range(host, "release").value;

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshot).toHaveBeenCalledTimes(settledSnapshots);
    expect(range(host, "release").value).toBe(settledValue);
  });

  it("contains an onError throw at the asynchronous command boundary", async () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    binding.setEnvelope = () => Promise.reject(new Error("rejected"));
    const onError = vi.fn(() => {
      throw new Error("reporting failed");
    });
    mountEnvelope(host, binding, { onError });

    inputValue(range(host, "attack"), 0.4);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
  });

  it("best-effort releases active pointer capture during destroy", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    const handle = mountEnvelope(host, binding);
    const svg = host.querySelector("svg") as SVGSVGElement & {
      setPointerCapture: Mock<SVGSVGElement["setPointerCapture"]>;
      releasePointerCapture: Mock<SVGSVGElement["releasePointerCapture"]>;
    };
    svg.setPointerCapture = vi.fn<SVGSVGElement["setPointerCapture"]>();
    svg.releasePointerCapture = vi.fn<SVGSVGElement["releasePointerCapture"]>();
    const attack = host.querySelector('.wui-envelope__handle[data-h="a"]')!;
    pointer(attack, "pointerdown", { pointerId: 12 });

    handle.destroy();

    expect(svg.releasePointerCapture).toHaveBeenCalledWith(12);
  });

  it("replaces one host presenter, cleans subscriptions, and preserves unrelated DOM", () => {
    const host = document.createElement("div");
    const unrelated = document.createElement("p");
    host.append(unrelated);
    const first = new FakeEnvelope();
    const second = new FakeEnvelope();
    const old = mountEnvelope(host, first);
    const next = mountEnvelope(host, second);

    expect(first.subscribers.size).toBe(0);
    expect(second.subscribers.size).toBe(1);
    expect(host.querySelectorAll(".wui-envelope")).toHaveLength(1);
    expect(host.contains(unrelated)).toBe(true);

    old.destroy();
    expect(host.contains(next.element)).toBe(true);
    next.destroy();
    expect(second.subscribers.size).toBe(0);
    expect(host.contains(unrelated)).toBe(true);
  });

  it("disables both pointer and native-input editing", () => {
    const host = document.createElement("div");
    const binding = new FakeEnvelope();
    binding.state.disabled = true;
    mountEnvelope(host, binding);

    expect(
      host.querySelector(".wui-envelope")?.classList.contains("is-disabled"),
    ).toBe(true);
    expect(
      [...host.querySelectorAll<HTMLInputElement>("input")].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    inputValue(range(host, "attack"), 1);
    expect(binding.changes).toHaveLength(0);
  });
});
