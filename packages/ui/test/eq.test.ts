// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest";
import {mountEq, type EqBinding, type EqState} from "../src/eq";

function pointer(target: Element, type: string, init: Record<string, number>): void {
  const event = new Event(type, {bubbles: true});
  Object.assign(event, {clientX: 0, clientY: 0}, init);
  target.dispatchEvent(event);
}

class FakeEq implements EqBinding {
  state: EqState = {
    ready: true,
    bands: [
      {frequency: 120, gain: 0, q: 0.8},
      {frequency: 1_000, gain: 3, q: 0.9},
    ],
    response: [
      {x: 0, gain: 0},
      {x: 1, gain: 6},
    ],
  };
  readonly writes: Array<{index: number; frequency: number; gain: number}> = [];
  readonly subscribers = new Set<() => void>();

  snapshot(): EqState {
    return this.state;
  }

  setBand(index: number, band: {frequency: number; gain: number}): void {
    this.writes.push({index, ...band});
    this.state.bands[index] = {...this.state.bands[index], ...band};
    this.subscribers.forEach((notify) => notify());
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mountEq", () => {
  afterEach(() => document.body.replaceChildren());

  it("exposes the empty-state node through the handle and keeps caller content", () => {
    const host = document.createElement("div");
    const binding = new FakeEq();
    const handle = mountEq(host, binding, {emptyLabel: "No graph yet"});

    const empty = handle.emptyElement();
    expect(handle.element.contains(empty)).toBe(true);
    expect(empty.textContent).toBe("No graph yet");

    const code = document.createElement("code");
    code.textContent = ".context";
    empty.replaceChildren("Assign ", code);
    handle.update();
    expect(handle.emptyElement()).toBe(empty);
    expect(empty.querySelector("code")?.textContent).toBe(".context");
    handle.destroy();
  });

  it("renders response, points, parts and accessible band inputs", () => {
    const host = document.createElement("div");
    const binding = new FakeEq();
    const handle = mountEq(host, binding, {
      classNames: {root: "graph", point: "point", readout: "read"},
      parts: {root: "control", point: "handle"},
    });

    expect(handle.element.classList).toContain("graph");
    expect(handle.element.getAttribute("part")).toContain("control");
    expect(host.querySelectorAll(".point")).toHaveLength(2);
    expect(host.querySelector(".point")?.getAttribute("part")).toContain("handle");
    expect(host.querySelector(".wui-eq__curve")?.getAttribute("points")).toBe("0,50 100,33.333333333333336");
    expect(host.querySelector(".read")?.textContent).toBe("120 +0.0dB  ·  1.0k +3.0dB");
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(4);
    expect(host.querySelector("input")?.getAttribute("aria-label")).toBe("Band 1 frequency");
  });

  it("keeps point circles round across non-uniform SVG resizes", () => {
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
    const handle = mountEq(host, new FakeEq());
    let scaleX = 5;
    Object.defineProperty(handle.svg, "getScreenCTM", {
      configurable: true,
      value: () => ({a: scaleX, b: 0, c: 0, d: 1}),
    });

    resize([], {} as ResizeObserver);

    const circles = [...host.querySelectorAll<SVGCircleElement>("circle")];
    expect(observe).toHaveBeenCalledWith(handle.svg);
    expect(circles).toHaveLength(2);
    expect(circles.every((circle) => circle.classList.contains("wui-eq__point"))).toBe(true);
    expect(circles.every((circle) => circle.getAttribute("transform")?.includes("scale(0.2 1)"))).toBe(true);

    scaleX = 2;
    resize([], {} as ResizeObserver);
    expect(circles.every((circle) => circle.getAttribute("transform")?.includes("scale(0.5 1)"))).toBe(true);

    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps pointer ownership and submits logarithmic frequency plus gain", () => {
    const host = document.createElement("div");
    const binding = new FakeEq();
    mountEq(host, binding);
    const svg = host.querySelector<SVGSVGElement>("svg")!;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({left: 0, top: 0, width: 100, height: 100}),
    });
    const point = host.querySelector(".wui-eq__point")!;

    pointer(point, "pointerdown", {pointerId: 4, clientX: 0, clientY: 0});
    pointer(svg, "pointermove", {pointerId: 7, clientX: 100, clientY: 100});
    expect(binding.writes).toHaveLength(0);
    pointer(svg, "pointermove", {pointerId: 4, clientX: 100, clientY: 0});
    expect(binding.writes[0]).toEqual({index: 0, frequency: 18_000, gain: 18});
  });

  it("exposes focusable band ranges, announces physical values and marks the focused band", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const binding = new FakeEq();
    const handle = mountEq(host, binding);
    const frequency = host.querySelector<HTMLInputElement>('input[data-i="1"][data-axis="frequency"]')!;
    const gain = host.querySelector<HTMLInputElement>('input[data-i="1"][data-axis="gain"]')!;
    const point = host.querySelector('.wui-eq__point[data-i="1"]')!;
    const readout = host.querySelector('.wui-eq__readout')!;
    expect(frequency.closest("[hidden]")).toBeNull();
    expect(frequency.getAttribute("aria-valuetext")).toBe("1000 hertz");
    expect(gain.getAttribute("aria-valuetext")).toBe("3.0 decibels");

    frequency.focus();
    expect(document.activeElement).toBe(frequency);
    expect(point.classList.contains("is-focused")).toBe(true);
    expect(readout.textContent).toBe("Band 2 frequency: 1.0k +3.0dB");
    gain.focus();
    expect(point.classList.contains("is-focused")).toBe(true);
    expect(readout.textContent).toBe("Band 2 gain: 1.0k +3.0dB");
    gain.value = "1";
    gain.dispatchEvent(new Event("input", {bubbles: true}));
    expect(binding.writes.at(-1)).toEqual({index: 1, frequency: 1000, gain: 18});
    expect(gain.getAttribute("aria-valuetext")).toBe("18.0 decibels");
    gain.blur();
    expect(point.classList.contains("is-focused")).toBe(false);
    expect(readout.textContent).toBe("120 +0.0dB  ·  1.0k +18.0dB");
    handle.destroy();
  });

  it("clears band focus when the binding replaces its band controls", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const binding = new FakeEq();
    const handle = mountEq(host, binding);
    host.querySelector<HTMLInputElement>('input[data-i="1"]')!.focus();
    binding.state.bands = [{frequency: 400, gain: -2}];
    handle.update();
    expect(host.querySelector(".is-focused")).toBeNull();
    expect(host.querySelector(".wui-eq__readout")?.textContent).toBe("400 -2.0dB");
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(2);
    handle.destroy();
  });

  it("maps dragging to the resized SVG rather than the taller readout container", () => {
    const host = document.createElement("div");
    const binding = new FakeEq();
    const handle = mountEq(host, binding);
    let plot = {left: 20, top: 30, width: 100, height: 80};
    Object.defineProperty(handle.element, "getBoundingClientRect", {
      value: () => ({...plot, height: 240}),
    });
    Object.defineProperty(handle.svg, "getBoundingClientRect", {value: () => plot});
    pointer(host.querySelector(".wui-eq__point")!, "pointerdown", {pointerId: 1});
    pointer(handle.svg, "pointermove", {pointerId: 1, clientX: 70, clientY: 70});
    expect(binding.writes.at(-1)).toEqual({index: 0, frequency: 735, gain: -0});
    plot = {...plot, width: 200, height: 120};
    pointer(handle.svg, "pointermove", {pointerId: 1, clientX: 120, clientY: 90});
    expect(binding.writes.at(-1)).toEqual({index: 0, frequency: 735, gain: -0});
    handle.destroy();
  });

  it("preserves caller DOM, replaces same-host mounts and cleans subscriptions", () => {
    const host = document.createElement("div");
    const caller = document.createElement("span");
    host.append(caller);
    const firstBinding = new FakeEq();
    const first = mountEq(host, firstBinding);
    const secondBinding = new FakeEq();
    const second = mountEq(host, secondBinding);

    expect(host.contains(caller)).toBe(true);
    expect(host.querySelectorAll(".wui-eq")).toHaveLength(1);
    expect(firstBinding.subscribers.size).toBe(0);
    expect(secondBinding.subscribers.size).toBe(1);
    first.destroy();
    expect(host.querySelectorAll(".wui-eq")).toHaveLength(1);
    second.destroy();
    expect(host.contains(caller)).toBe(true);
    expect(secondBinding.subscribers.size).toBe(0);
  });

  it("rolls back an async command failure and contains a throwing reporter", async () => {
    const host = document.createElement("div");
    const error = new Error("write failed");
    const binding = new FakeEq();
    binding.setBand = vi.fn(() => Promise.reject(error));
    const onError = vi.fn(() => {
      throw new Error("report failed");
    });
    mountEq(host, binding, {onError});
    const input = host.querySelector<HTMLInputElement>('input[data-i="0"][data-axis="gain"]')!;
    input.value = "1";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
    expect(input.value).toBe("0.5");
  });
});
