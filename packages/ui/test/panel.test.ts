// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vitest";
import {mountSectionPanel, sectionPanelStyle} from "../src/panel";

afterEach(() => document.body.replaceChildren());

describe("mountSectionPanel", () => {
  it("owns the style and section-slot skeleton while preserving caller DOM", () => {
    const host = document.createElement("div");
    const unrelated = document.createElement("span");
    unrelated.dataset.callerOwned = "true";
    host.append(unrelated);

    const handle = mountSectionPanel(
      host,
      [
        {
          id: "sound",
          label: "Sound",
          classNames: {section: "legacy-section", slot: "sound-host"},
          parts: {section: "sound-section", slot: "sound-slot"},
        },
        "effects",
        "sound",
        "",
      ],
      {
        label: "Synth controls",
        classNames: {root: "legacy-panel", section: "all-sections", slot: "all-slots"},
        parts: {root: "custom-root", section: "custom-section", slot: "custom-slot"},
        styleText: ".legacy-panel { --wm-panel-gap: 1rem; }",
      },
    );

    expect(host.firstElementChild).toBe(unrelated);
    const style = host.querySelector<HTMLStyleElement>('style[data-webmusic-ui="panel"]')!;
    expect(style.textContent).toContain(sectionPanelStyle);
    expect(style.textContent).toContain("--wm-panel-gap: 1rem");
    expect(handle.element.classList.contains("legacy-panel")).toBe(true);
    expect(handle.element.getAttribute("part")?.split(/\s+/)).toEqual(
      expect.arrayContaining(["root", "custom-root"]),
    );
    expect(handle.element.getAttribute("role")).toBe("group");
    expect(handle.element.getAttribute("aria-label")).toBe("Synth controls");
    expect(handle.slots.size).toBe(2);

    const sound = handle.slot("sound")!;
    expect(sound.classList.contains("sound-host")).toBe(true);
    expect(sound.classList.contains("all-slots")).toBe(true);
    expect(sound.getAttribute("part")?.split(/\s+/)).toEqual(
      expect.arrayContaining(["slot", "custom-slot", "sound-slot"]),
    );
    const section = sound.parentElement!;
    expect(section.tagName).toBe("SECTION");
    expect(section.getAttribute("aria-label")).toBe("Sound");
    expect(section.classList.contains("legacy-section")).toBe(true);
    expect(section.getAttribute("part")?.split(/\s+/)).toEqual(
      expect.arrayContaining(["section", "custom-section", "sound-section"]),
    );
    expect(handle.slot("missing")).toBeUndefined();

    handle.destroy();
    handle.destroy();
    expect([...host.children]).toContain(unrelated);
    expect(host.querySelector(".wui-section-panel")).toBeNull();
    expect(host.querySelector('style[data-webmusic-ui="panel"]')).toBeNull();
  });

  it("replaces only the previous panel mount on the same host", () => {
    const host = document.createElement("div");
    const first = mountSectionPanel(host, ["one"]);
    const firstRoot = first.element;
    const second = mountSectionPanel(host, ["two"]);

    expect(firstRoot.isConnected).toBe(false);
    expect(second.slot("one")).toBeUndefined();
    expect(second.slot("two")).toBeDefined();
    expect(host.querySelectorAll(".wui-section-panel")).toHaveLength(1);
    expect(host.querySelectorAll('style[data-webmusic-ui="panel"]')).toHaveLength(1);
  });
});
