// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest";
import {mountMacro, mountMacroRack, type MacroBinding} from "../src/macro";

afterEach(() => document.body.replaceChildren());

describe("mountMacroRack", () => {
  it("owns every macro item host and exposes one compound lifecycle", () => {
    const host = document.createElement("div");
    const setFirst = vi.fn();
    const bindings: MacroBinding[] = [
      {
        snapshot: () => ({label: "MORPH", value: 0.25, targets: [{label: "cutoff", value: 500, unit: "Hz"}]}),
        setValue: setFirst,
      },
      {
        snapshot: () => ({label: "SPACE", value: 0.5, targets: []}),
        setValue: vi.fn(),
      },
    ];

    const handle = mountMacroRack(host, bindings, {
      classNames: {root: "legacy-rack", item: "legacy-item"},
      parts: {root: "custom-root", item: "custom-item"},
    });

    expect(handle.element.classList.contains("legacy-rack")).toBe(true);
    expect(handle.element.getAttribute("part")).toContain("custom-root");
    expect(handle.items).toHaveLength(2);
    expect(handle.item(0)).toBe(handle.items[0]);
    expect(handle.item(2)).toBeUndefined();
    const itemHosts = [...handle.element.children] as HTMLElement[];
    expect(itemHosts).toHaveLength(2);
    expect(itemHosts.every((item) => item.classList.contains("legacy-item"))).toBe(true);
    expect(itemHosts.every((item) => item.getAttribute("part")?.includes("custom-item"))).toBe(true);
    expect(itemHosts.every((item) => item.querySelector(".wui-macro") != null)).toBe(true);

    const input = itemHosts[0]!.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = "0.75";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    expect(setFirst).toHaveBeenCalledWith(0.75);

    handle.update();
    handle.destroy();
    handle.destroy();
    expect(host.querySelector(".wui-macro-rack")).toBeNull();
    expect(host.querySelectorAll(".wui-macro")).toHaveLength(0);
  });
});

describe("mountMacro host ownership", () => {
  const binding = (label: string): MacroBinding => ({
    snapshot: () => ({label, value: 0.5, targets: []}),
    setValue: vi.fn(),
  });

  it("survives a replacement mounted from the previous macro's teardown", () => {
    const host = document.createElement("div");
    const first = mountMacro(host, binding("FIRST"));
    let replacement: ReturnType<typeof mountMacro> | undefined;

    // The previous macro's cleanup mounts the next one. That replacement claims
    // the host and destroys the in-flight handle — which used to reach a `const`
    // still in its temporal dead zone and throw ReferenceError, leaving the host
    // unusable for every later mount.
    const originalDestroy = first.destroy;
    first.destroy = () => {
      originalDestroy();
      replacement = mountMacro(host, binding("REPLACEMENT"));
    };

    let superseded: ReturnType<typeof mountMacro> | undefined;
    expect(() => {
      superseded = mountMacro(host, binding("SUPERSEDED"));
    }).not.toThrow();

    expect(host.querySelectorAll(".wui-macro")).toHaveLength(1);
    expect(host.querySelector(".wui-macro")).toBe(replacement?.element);
    // The superseded handle is inert rather than explosive.
    expect(() => superseded?.update()).not.toThrow();
    expect(() => superseded?.destroy()).not.toThrow();

    // And the host still takes a fresh mount afterwards.
    expect(() => mountMacro(host, binding("LATER")).destroy()).not.toThrow();
  });
});
