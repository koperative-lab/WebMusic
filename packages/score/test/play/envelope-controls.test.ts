// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvelopeBinding, EnvelopeHandle } from "@webmusic/ui/envelope";
import {
  SynthPanelElement,
  type Envelope,
} from "../../src/play/element";

let nextTag = 0;

function define<T extends CustomElementConstructor>(
  constructor: T,
  name: string,
): string {
  const tag = `webmusic-${name}-${nextTag++}`;
  customElements.define(tag, constructor);
  return tag;
}

class InspectableSynthPanelElement extends SynthPanelElement {
  presenter?: EnvelopeHandle;
  binding?: EnvelopeBinding;

  protected override mountSynthEnvelopeUI(
    host: HTMLElement,
    binding: EnvelopeBinding,
  ): EnvelopeHandle {
    this.binding = binding;
    this.presenter = super.mountSynthEnvelopeUI(host, binding);
    return this.presenter;
  }
}

const synthTag = define(InspectableSynthPanelElement, "synth-envelope-test");

function input(root: ParentNode, stage: keyof Envelope): HTMLInputElement {
  const range = root.querySelector<HTMLInputElement>(
    `input[data-stage="${stage}"]`,
  );
  if (!range) throw new Error(`Missing ${stage} envelope input`);
  return range;
}

function move(range: HTMLInputElement, value: number): void {
  range.value = String(value);
  range.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function deferred(): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
} {
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

function eventsOf(element: HTMLElement, type: string): CustomEvent[] {
  const events: CustomEvent[] = [];
  element.addEventListener(type, (event) => events.push(event as CustomEvent));
  return events;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("<synth-panel> envelope presenter composition", () => {
  it("mounts the same canonical presenter behind the legacy graph.env section", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope"];
    document.body.append(panel);
    const root = panel.shadowRoot!;

    expect(
      root.querySelector(
        ".sec-envelope > .envelope-host > .wui-envelope.graph.env",
      ),
    ).not.toBeNull();
    expect(root.querySelectorAll(".env .handle[data-h]")).toHaveLength(3);
    expect(root.querySelectorAll('.env input[type="range"]')).toHaveLength(4);
    expect(root.querySelector(".env .read")?.textContent).toBe(
      "A 0.05s · D 0.20s · S 60% · R 0.40s",
    );
    const style = root.querySelector<HTMLStyleElement>(
      'style[data-webmusic-ui="panel"]',
    )?.textContent;
    expect(style).toContain("--synth-graph-bg");
    expect(style).toContain("--wm-envelope-background");
  });

  it("keeps event/apply order and the existing partial setter contract", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope"];
    const order: string[] = [];
    panel.addEventListener("webscore:envelope", () => order.push("event"));
    panel.apply = () => order.push("apply");
    document.body.append(panel);
    move(input(panel.shadowRoot!, "decay"), 0.9);
    panel.envelope = { sustain: 0.35 };

    expect(order).toEqual([
      "event",
      "apply",
      "event",
      "apply",
      "event",
      "apply",
    ]);
    expect(panel.envelope).toEqual({
      attack: 0.05,
      decay: 0.9,
      sustain: 0.35,
      release: 0.4,
    });
    const clone = panel.envelope;
    clone.decay = 0;
    expect(panel.envelope.decay).toBe(0.9);
  });

  it("destroys before section replacement, remounts one editor, and preserves state", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope", "macros"];
    document.body.append(panel);
    panel.envelope = { release: 1.4 };
    const first = panel.presenter;

    panel.sections = ["macros"];
    expect(panel.shadowRoot?.querySelector(".wui-envelope")).toBeNull();
    panel.sections = ["envelope"];

    expect(panel.presenter).not.toBe(first);
    expect(panel.shadowRoot?.querySelectorAll(".wui-envelope")).toHaveLength(1);
    expect(input(panel.shadowRoot!, "release").value).toBe("1.4");
  });

  it("publishes apply failures at the panel boundary without reverting state", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope"];
    const failure = new Error("panel apply failed");
    const errors = eventsOf(panel, "webscore:error");
    panel.apply = () => {
      throw failure;
    };
    document.body.append(panel);

    expect(errors.at(-1)?.detail).toEqual({
      operation: "synth-panel",
      error: failure,
    });
    expect(panel.envelope).toEqual({
      attack: 0.05,
      decay: 0.2,
      sustain: 0.6,
      release: 0.4,
    });
  });

  it("suppresses a superseded asynchronous panel callback failure", async () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope"];
    const pending = deferred();
    const errors = eventsOf(panel, "webscore:error");
    panel.apply = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(undefined);
    document.body.append(panel);
    panel.envelope = { decay: 0.7 };

    pending.reject(new Error("superseded panel failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toHaveLength(0);
  });

  it("exposes a protected presenter seam with the current structural binding", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope"];
    panel.ranges = { attackMax: 4, decayMax: 3, releaseMax: 5 };
    document.body.append(panel);

    expect(panel.presenter?.element.classList.contains("wui-envelope")).toBe(
      true,
    );
    expect(panel.binding?.snapshot()).toEqual({
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4 },
      ranges: { attackMax: 4, decayMax: 3, releaseMax: 5 },
    });
  });

  it("repaints a mounted envelope when its ranges property changes", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["envelope"];
    document.body.append(panel);
    const presenter = panel.presenter;

    panel.ranges = { attackMax: 4, decayMax: 3, releaseMax: 5 };

    expect(panel.presenter).toBe(presenter);
    expect(input(panel.shadowRoot!, "attack").max).toBe("4");
    expect(input(panel.shadowRoot!, "decay").max).toBe("3");
    expect(input(panel.shadowRoot!, "release").max).toBe("5");
    expect(panel.ranges).toEqual({attackMax: 4, decayMax: 3, releaseMax: 5});
  });

  it("does not emit or apply when the envelope presenter fails to mount", () => {
    class BrokenSynthPanel extends SynthPanelElement {
      protected override mountSynthEnvelopeUI(): EnvelopeHandle {
        throw new Error("mount failed");
      }
    }
    const tag = define(BrokenSynthPanel, "broken-synth-envelope-test");
    const panel = document.createElement(tag) as BrokenSynthPanel;
    panel.sections = ["envelope"];
    const envelopes = eventsOf(panel, "webscore:envelope");
    const errors = eventsOf(panel, "webscore:error");
    const apply = vi.fn();
    panel.apply = apply;

    document.body.append(panel);

    expect(envelopes).toHaveLength(0);
    expect(apply).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it("still emits setter changes while the envelope section is absent", () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ["macros"];
    const envelopes = eventsOf(panel, "webscore:envelope");
    const apply = vi.fn();
    panel.apply = apply;
    document.body.append(panel);
    panel.envelope = { decay: 0.65 };

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.detail.decay).toBe(0.65);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("upgrades a pre-definition envelope without a duplicate initial emit", () => {
    class LazySynthPanel extends SynthPanelElement {}
    const tag = `webmusic-lazy-synth-${nextTag++}`;
    const panel = document.createElement(tag) as SynthPanelElement;
    const events = eventsOf(panel, "webscore:envelope");
    const apply = vi.fn();
    panel.sections = ["envelope"];
    panel.envelope = { sustain: 0.2 };
    panel.apply = apply;
    document.body.append(panel);

    customElements.define(tag, LazySynthPanel);

    expect(events).toHaveLength(1);
    expect(apply).toHaveBeenCalledOnce();
    expect(events[0]?.detail.sustain).toBe(0.2);
  });

  it("does not let an outer section render overwrite destroy re-entry", () => {
    class ReentrantSynthPanel extends SynthPanelElement {
      reenter = false;

      protected override mountSynthEnvelopeUI(
        host: HTMLElement,
        binding: EnvelopeBinding,
      ): EnvelopeHandle {
        const raw = super.mountSynthEnvelopeUI(host, binding);
        return {
          element: raw.element,
          update: () => raw.update(),
          destroy: () => {
            raw.destroy();
            if (this.reenter) {
              this.reenter = false;
              this.sections = ["envelope"];
            }
          },
        };
      }
    }
    const tag = define(ReentrantSynthPanel, "reentrant-synth-test");
    const panel = document.createElement(tag) as ReentrantSynthPanel;
    panel.sections = ["envelope"];
    document.body.append(panel);
    panel.reenter = true;

    panel.sections = ["macros"];

    expect(panel.sections).toEqual(["envelope"]);
    expect(panel.shadowRoot?.querySelectorAll(".wui-envelope")).toHaveLength(1);
  });
});
