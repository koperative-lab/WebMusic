// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest";
import {mountMixer, type MixerBinding} from "../src/mixer";

afterEach(() => document.body.replaceChildren());

/** jsdom has no PointerEvent and no layout; the kit's suites synthesize both. */
function dragTo(control: HTMLElement, fraction: number): void {
  const height = 100;
  control.getBoundingClientRect = () =>
    ({x: 0, y: 0, top: 0, left: 0, right: 20, bottom: height, width: 20, height, toJSON: () => ({})}) as DOMRect;
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: 10,
    clientY: (1 - fraction) * height,
  });
  Object.defineProperty(event, 'pointerId', {configurable: true, value: 1});
  control.dispatchEvent(event);
}


/** The moves the press above never sent: a real scrub is down THEN move. */
function movePointer(control: HTMLElement, fraction: number): void {
  const event = new MouseEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    clientX: 10,
    clientY: (1 - fraction) * 100,
  });
  Object.defineProperty(event, 'pointerId', {configurable: true, value: 1});
  control.dispatchEvent(event);
}

describe("mountMixer", () => {
  it("keeps long channel names readable and the channel bank keyboard reachable across updates", () => {
    let channels = [{id: 'strings', label: 'Orchestral strings — upper-register counter-melody', value: 0.5}];
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountMixer(host, {
      snapshot: () => ({master: 1, channels}),
      setMaster: vi.fn(), setChannel: vi.fn(), setMuted: vi.fn(), setSolo: vi.fn(),
    });
    const bank = host.querySelector<HTMLElement>('[aria-label="Mixer channels"]')!;
    const label = host.querySelector<HTMLElement>('[part~="channel"] [part~="label"]')!;
    expect(bank.tabIndex).toBe(0);
    bank.focus();
    expect(document.activeElement).toBe(bank);
    expect(label.textContent).toBe(channels[0]!.label);
    expect(label.title).toBe(channels[0]!.label);
    expect(getComputedStyle(label).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(label).textOverflow).not.toBe('ellipsis');

    channels = [{...channels[0]!, label: 'Strings — lower-register counter-melody'}];
    handle.update();
    expect(document.activeElement).toBe(bank);
    expect(host.querySelector('[part~="channel"] [part~="label"]')).toBe(label);
    expect(label.textContent).toBe(channels[0]!.label);
    expect(host.querySelector('[aria-label="Strings — lower-register counter-melody volume"]')).not.toBeNull();

    channels = [];
    handle.update();
    expect(bank.tabIndex).toBe(-1);
    handle.destroy();
  });

  it("publishes class and part hooks for the whole strip structure", () => {
    const setMaster = vi.fn();
    const setChannel = vi.fn();
    const setMuted = vi.fn();
    const setSolo = vi.fn();
    const binding: MixerBinding = {
      snapshot: () => ({
        master: 0.8,
        channels: [{id: "piano", label: "Piano", value: 0.5, muted: false, solo: true}],
      }),
      setMaster,
      setChannel,
      setMuted,
      setSolo,
      play: vi.fn(),
    };
    const host = document.createElement("div");
    const handle = mountMixer(host, binding, {
      classNames: {
        root: "legacy-root",
        fader: "legacy-fader",
        input: "legacy-input",
        label: "legacy-label",
        play: "legacy-play",
      },
      parts: {
        root: "custom-root",
        strip: "custom-strip",
        master: "custom-master",
        fader: "custom-fader",
        input: "custom-input",
        label: "custom-label",
        play: "custom-play",
      },
    });

    expect(handle.element.classList.contains("legacy-root")).toBe(true);
    expect(handle.element.getAttribute("part")).toContain("custom-root");
    const master = host.querySelector<HTMLElement>('[part~="master"]')!;
    expect(master.getAttribute("part")).toContain("custom-master");
    expect(master.getAttribute("part")).toContain("custom-strip");
    const faders = [...host.querySelectorAll<HTMLElement>('[part~="fader"]')];
    expect(faders).toHaveLength(2);
    expect(faders.every((node) => node.classList.contains("legacy-fader"))).toBe(true);
    expect(faders.every((node) => node.getAttribute("part")?.includes("custom-fader"))).toBe(true);
    const labels = [...host.querySelectorAll<HTMLElement>('[part~="label"]')];
    expect(labels.map((label) => label.textContent)).toEqual(["master", "Piano"]);
    expect(labels.every((node) => node.classList.contains("legacy-label"))).toBe(true);

    // The strip's control is the kit's shared fader: an ARIA slider drawn from
    // elements, so it is driven by pointer and keyboard rather than by writing
    // `.value` on a native range.
    const channel = host.querySelector<HTMLElement>('[aria-label="Piano volume"]')!;
    expect(channel.classList.contains("legacy-input")).toBe(true);
    expect(channel.getAttribute("part")).toContain("custom-input");
    expect(channel.getAttribute("role")).toBe("slider");
    dragTo(channel, 0.25);
    expect(setChannel).toHaveBeenCalledWith("piano", 0.25);

    const masterInput = host.querySelector<HTMLElement>('[aria-label="master volume"]')!;
    dragTo(masterInput, 0.6);
    expect(setMaster).toHaveBeenCalledWith(0.6);
    host.querySelector<HTMLButtonElement>('[aria-label="Mute Piano"]')!.click();
    expect(setMuted).toHaveBeenCalledWith("piano", true);
    host.querySelector<HTMLButtonElement>('[aria-label="Solo Piano"]')!.click();
    expect(setSolo).toHaveBeenCalledWith(null);
    const play = host.querySelector<HTMLButtonElement>('[aria-label="Play"]')!;
    expect(play.classList.contains("legacy-play")).toBe(true);
    expect(play.getAttribute("part")).toContain("custom-play");
  });

  /**
   * A scrub is a pointerdown FOLLOWED BY MOVES, and this suite only ever
   * pressed. That gap is how the board came to rebuild itself on every commit:
   * `update()` runs on the microtask after the commit, and a browser drops
   * pointer capture the instant the captured element leaves the document, so a
   * drag committed its press and then went dead against a detached node.
   */
  it("keeps scrubbing and keeps focus after a commit lands", async () => {
    let master = 0.2;
    const setMaster = vi.fn((value: number) => {
      master = value;
    });
    const binding: MixerBinding = {
      snapshot: () => ({master, channels: [{id: "piano", label: "Piano", value: 0.5}]}),
      setMaster,
      setChannel: vi.fn(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    mountMixer(host, binding);

    const fader = host.querySelector<HTMLElement>('[aria-label="master volume"]')!;
    dragTo(fader, 0.3);
    expect(setMaster).toHaveBeenCalledTimes(1);
    fader.focus();

    // The browser delivers moves long after the commit's microtask; a rebuild
    // would have replaced this node in between.
    await Promise.resolve();
    await Promise.resolve();
    expect(fader.isConnected).toBe(true);
    expect(host.querySelector('[aria-label="master volume"]')).toBe(fader);
    expect(document.activeElement).toBe(fader);

    movePointer(fader, 0.6);
    movePointer(fader, 0.9);
    expect(setMaster).toHaveBeenCalledTimes(3);
    expect(setMaster).toHaveBeenLastCalledWith(0.9);
    expect(fader.getAttribute("aria-valuenow")).toBe("0.9");
  });

  it("reuses a channel strip across updates and drops one that leaves", async () => {
    let channels = [
      {id: "piano", label: "Piano", value: 0.5},
      {id: "bass", label: "Bass", value: 0.4},
    ];
    const binding: MixerBinding = {
      snapshot: () => ({master: 0.8, channels}),
      setMaster: vi.fn(),
      setChannel: vi.fn(),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountMixer(host, binding);

    const piano = host.querySelector<HTMLElement>('[aria-label="Piano volume"]')!;
    const bass = host.querySelector<HTMLElement>('[aria-label="Bass volume"]')!;

    channels = [{id: "bass", label: "Bass", value: 0.9}];
    handle.update();

    // The surviving strip is the SAME node, repainted — not a look-alike.
    expect(host.querySelector('[aria-label="Bass volume"]')).toBe(bass);
    expect(bass.getAttribute("aria-valuenow")).toBe("0.9");
    expect(host.querySelector('[aria-label="Piano volume"]')).toBeNull();
    expect(piano.isConnected).toBe(false);

    // A departed strip released its slider: its element no longer answers.
    expect(piano.getAttribute("role")).toBeNull();
  });
});
