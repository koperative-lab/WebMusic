// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  mountParameterRack,
  type ParameterRackBinding,
  type ParameterRackState,
} from "../src/parameter";

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

class FakeParameters implements ParameterRackBinding {
  state: ParameterRackState = {
    parameters: [
      {
        id: "rate",
        label: "Rate",
        value: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
        unit: "×",
      },
      {
        id: "mode",
        label: "Mode",
        value: 0,
        min: 0,
        max: 1,
        options: ["Clean", "Warm"],
      },
    ],
  };
  readonly values: Array<[string, number]> = [];
  readonly subscribers = new Set<() => void>();

  snapshot(): ParameterRackState {
    return this.state;
  }

  setValue(id: string, value: number): void {
    this.values.push([id, value]);
    const parameter = this.state.parameters.find(
      (candidate) => candidate.id === id,
    );
    if (parameter) parameter.value = value;
    this.emit();
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  emit(): void {
    this.subscribers.forEach((notify) => notify());
  }
}

describe("mountParameterRack", () => {
  it("renders an accessible flat rack and applies live values", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const handle = mountParameterRack(host, binding, {
      classNames: {
        root: "rack",
        item: "param",
        label: "name",
        control: "knob",
        value: "val",
      },
      parts: { root: "panel", input: "native-control" },
    });
    const inputs = host.querySelectorAll<HTMLInputElement>("input[type=range]");

    expect(handle.element.classList).toContain("rack");
    expect(handle.element.getAttribute("part")).toContain("panel");
    expect(host.querySelectorAll(".param")).toHaveLength(2);
    expect(inputs[0]?.getAttribute("aria-label")).toBe("Rate");
    expect(inputs[0]?.getAttribute("aria-valuetext")).toBe("1 ×");
    expect(inputs[0]?.getAttribute("value")).toBe("1");
    expect(inputs[1]?.getAttribute("aria-valuetext")).toBe("Clean");
    expect(inputs[1]?.getAttribute("part")).toContain("native-control");
    expect(
      [...host.querySelectorAll(".wui-parameter-rack__track")].every(
        (path) => path.getAttribute("fill") === "none",
      ),
    ).toBe(true);
    expect(
      [...host.querySelectorAll(".wui-parameter-rack__fill")].every(
        (path) => path.getAttribute("fill") === "none",
      ),
    ).toBe(true);

    inputs[0]!.value = "1.5";
    inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(binding.values).toEqual([["rate", 1.5]]);
    expect(host.querySelectorAll(".val")[0]?.textContent).toBe("1.5 ×");
    expect(inputs[0]?.getAttribute("aria-valuetext")).toBe("1.5 ×");
  });

  it("exposes item, input and empty nodes through stable accessors", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const handle = mountParameterRack(host, binding);

    const item = handle.itemElement("rate");
    const input = handle.inputElement("rate");
    expect(item?.classList).toContain("wui-parameter-rack__item");
    expect(input).toBe(host.querySelector('input[data-parameter-id="rate"]'));
    expect(item?.contains(input!)).toBe(true);
    expect(handle.itemElement("missing")).toBeUndefined();
    expect(handle.inputElement("missing")).toBeUndefined();
    expect(handle.emptyElement()).toBeUndefined();

    binding.state = { parameters: [] };
    handle.update();
    expect(handle.itemElement("rate")).toBeUndefined();
    expect(handle.emptyElement()?.textContent).toBe("No parameters");

    binding.state = {
      parameters: [{ id: "gain", label: "Gain", value: 0.5, min: 0, max: 1 }],
    };
    handle.update();
    expect(handle.emptyElement()).toBeUndefined();
    expect(handle.inputElement("gain")?.value).toBe("0.5");

    handle.destroy();
    expect(handle.itemElement("gain")).toBeUndefined();
    expect(handle.inputElement("gain")).toBeUndefined();
    expect(handle.emptyElement()).toBeUndefined();
  });

  it("groups parameters and updates values without replacing stable controls", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    binding.state = {
      parameters: [
        {
          id: "cutoff",
          label: "Cutoff",
          value: 400,
          min: 20,
          max: 20_000,
          group: "Filter",
          unit: "Hz",
        },
        {
          id: "resonance",
          label: "Resonance",
          value: 2,
          min: 0.1,
          max: 20,
          group: "Filter",
        },
        {
          id: "attack",
          label: "Attack",
          value: 0.05,
          min: 0,
          max: 2,
          group: "Envelope",
          unit: "s",
        },
      ],
    };
    const handle = mountParameterRack(host, binding, { layout: "grouped" });
    const cutoff = host.querySelector<HTMLInputElement>(
      'input[aria-label="Cutoff"]',
    )!;

    expect(host.querySelectorAll(".wui-parameter-rack__group")).toHaveLength(2);
    const namedGroups = host.querySelectorAll(
      ".wui-parameter-rack__group[role=group]",
    );
    expect(namedGroups).toHaveLength(2);
    for (const group of namedGroups) {
      const labelId = group.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      expect(group.querySelector(`#${labelId}`)).not.toBeNull();
    }
    expect(
      [...host.querySelectorAll(".wui-parameter-rack__group-label")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Filter", "Envelope"]);

    binding.state.parameters[0]!.value = 880;
    binding.emit();

    expect(host.querySelector('input[aria-label="Cutoff"]')).toBe(cutoff);
    expect(cutoff.value).toBe("880");
    expect(cutoff.getAttribute("aria-valuetext")).toBe("880 Hz");

    binding.state.parameters = [
      ...binding.state.parameters,
      {
        id: "release",
        label: "Release",
        value: 0.3,
        min: 0,
        max: 4,
        group: "Envelope",
        unit: "s",
      },
    ];
    handle.update();
    expect(host.querySelectorAll("input")).toHaveLength(4);
  });

  it("uses a keyboard-usable fallback for invalid numeric steps", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    binding.state = {
      parameters: [
        { id: "zero", label: "Zero", value: 0, min: 0, max: 1, step: 0 },
        {
          id: "negative",
          label: "Negative",
          value: 0,
          min: 0,
          max: 1,
          step: -1,
        },
      ],
    };

    mountParameterRack(host, binding);

    expect(
      [...host.querySelectorAll<HTMLInputElement>("input")].map(
        (input) => input.step,
      ),
    ).toEqual(["0.01", "0.01"]);
  });

  it("rejects duplicate stable ids without replacing the last good controls", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const onError = vi.fn();
    const handle = mountParameterRack(host, binding, { onError });
    const rate = host.querySelector<HTMLInputElement>(
      'input[data-parameter-id="rate"]',
    )!;

    binding.state = {
      parameters: [
        { id: "same", label: "First", value: 0, min: 0, max: 1 },
        { id: "same", label: "Second", value: 80, min: 20, max: 100 },
      ],
    };
    handle.update();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    expect(host.querySelector('input[data-parameter-id="rate"]')).toBe(rate);
    expect(host.querySelectorAll("input")).toHaveLength(2);

    binding.state = {
      parameters: [
        { id: "first", label: "First", value: 0, min: 0, max: 1 },
        { id: "second", label: "Second", value: 80, min: 20, max: 100 },
      ],
    };
    handle.update();
    expect(host.querySelectorAll("input")).toHaveLength(2);
    expect(
      host.querySelector('input[data-parameter-id="second"]'),
    ).not.toBeNull();
  });

  it("keeps the last good DOM through a transient snapshot failure", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const binding = new FakeParameters();
    const snapshot = binding.snapshot.bind(binding);
    const failure = new Error("transient snapshot failure");
    const onError = vi.fn();
    let failing = false;
    binding.snapshot = () => {
      if (failing) throw failure;
      return snapshot();
    };
    const handle = mountParameterRack(host, binding, { onError });
    const rate = host.querySelector<HTMLInputElement>(
      'input[data-parameter-id="rate"]',
    )!;
    rate.focus();

    failing = true;
    handle.update();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(host.querySelector('input[data-parameter-id="rate"]')).toBe(rate);
    expect(document.activeElement).toBe(rate);

    failing = false;
    binding.state.parameters[0]!.value = 1.4;
    handle.update();
    expect(host.querySelector('input[data-parameter-id="rate"]')).toBe(rate);
    expect(rate.value).toBe("1.4");
    host.remove();
  });

  it("keeps the last good DOM when a structural commit fails", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const failure = new Error("replace failed");
    const onError = vi.fn();
    const handle = mountParameterRack(host, binding, { onError });
    const rate = host.querySelector<HTMLInputElement>(
      'input[data-parameter-id="rate"]',
    )!;
    const replaceChildren = vi
      .spyOn(handle.element, "replaceChildren")
      .mockImplementationOnce(() => {
        throw failure;
      });
    binding.state.parameters = [
      ...binding.state.parameters,
      { id: "gain", label: "Gain", value: 0.5, min: 0, max: 1 },
    ];

    handle.update();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(host.querySelector('input[data-parameter-id="rate"]')).toBe(rate);
    expect(host.querySelectorAll("input")).toHaveLength(2);

    replaceChildren.mockRestore();
    handle.update();
    expect(host.querySelectorAll("input")).toHaveLength(3);
  });

  it("coalesces a synchronous subscription notification during formatting", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const snapshot = vi.spyOn(binding, "snapshot");
    let notified = false;

    mountParameterRack(host, binding, {
      formatValue: (parameter, value) => {
        if (!notified && parameter.id === "rate") {
          notified = true;
          binding.state.parameters[0]!.value = 1.4;
          binding.emit();
        }
        return `${value}`;
      },
    });

    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(
      host.querySelector<HTMLInputElement>('input[data-parameter-id="rate"]')
        ?.value,
    ).toBe("1.4");
  });

  it("preserves unrelated host DOM and disposes a previous mount on remount", () => {
    const host = document.createElement("div");
    const existing = document.createElement("p");
    existing.textContent = "caller owned";
    host.append(existing);
    const first = new FakeParameters();
    const second = new FakeParameters();
    const destroyBinding = vi.fn();
    Object.assign(first, { destroy: destroyBinding });

    mountParameterRack(host, first);
    const secondHandle = mountParameterRack(host, second);

    expect(first.subscribers.size).toBe(0);
    expect(second.subscribers.size).toBe(1);
    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelectorAll(".wui-parameter-rack")).toHaveLength(1);
    expect(destroyBinding).not.toHaveBeenCalled();

    secondHandle.destroy();
    secondHandle.destroy();
    expect(second.subscribers.size).toBe(0);
    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelector(".wui-parameter-rack")).toBeNull();
  });

  it("keeps a reentrant mount as the sole owner during previous cleanup", () => {
    const host = document.createElement("div");
    const first = new FakeParameters();
    const attempted = new FakeParameters();
    const replacement = new FakeParameters();
    const cleanupFailure = new Error("cleanup failed");
    let replacementHandle: ReturnType<typeof mountParameterRack> | undefined;

    first.subscribe = () => () => {
      throw cleanupFailure;
    };
    mountParameterRack(host, first, {
      onError: (error) => {
        expect(error).toBe(cleanupFailure);
        replacementHandle = mountParameterRack(host, replacement);
      },
    });

    const attemptedHandle = mountParameterRack(host, attempted);

    expect(replacementHandle).toBeDefined();
    expect(host.querySelectorAll(".wui-parameter-rack")).toHaveLength(1);
    expect(host.querySelector(".wui-parameter-rack")).toBe(
      replacementHandle!.element,
    );
    expect(attemptedHandle.element.isConnected).toBe(false);

    attemptedHandle.destroy();
    expect(host.querySelector(".wui-parameter-rack")).toBe(
      replacementHandle!.element,
    );
  });

  it("cleans a subscription returned after a mount-time replacement", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const replacement = new FakeParameters();
    const staleCleanup = vi.fn();
    let replacementHandle: ReturnType<typeof mountParameterRack> | undefined;

    binding.subscribe = () => {
      replacementHandle = mountParameterRack(host, replacement);
      return staleCleanup;
    };

    const staleHandle = mountParameterRack(host, binding);

    expect(staleCleanup).toHaveBeenCalledOnce();
    expect(staleHandle.element.isConnected).toBe(false);
    expect(host.querySelectorAll(".wui-parameter-rack")).toHaveLength(1);
    expect(host.querySelector(".wui-parameter-rack")).toBe(
      replacementHandle!.element,
    );
  });

  it("stops an update when onError mounts a replacement on the same host", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const replacement = new FakeParameters();
    const snapshotFailure = new Error("snapshot failed");
    let replacementHandle: ReturnType<typeof mountParameterRack> | undefined;
    const handle = mountParameterRack(host, binding, {
      onError: (error) => {
        expect(error).toBe(snapshotFailure);
        replacementHandle = mountParameterRack(host, replacement);
      },
    });
    binding.snapshot = () => {
      throw snapshotFailure;
    };

    handle.update();

    expect(replacementHandle).toBeDefined();
    expect(host.querySelectorAll(".wui-parameter-rack")).toHaveLength(1);
    expect(host.querySelector(".wui-parameter-rack")).toBe(
      replacementHandle!.element,
    );
    handle.destroy();
    expect(host.querySelector(".wui-parameter-rack")).toBe(
      replacementHandle!.element,
    );
  });

  it("supports empty and disabled snapshots", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    binding.state = { parameters: [], disabled: true };
    const handle = mountParameterRack(host, binding, {
      emptyLabel: "Assign .params",
    });

    expect(host.querySelector(".wui-parameter-rack__empty")?.textContent).toBe(
      "Assign .params",
    );

    binding.state = {
      disabled: true,
      parameters: [{ id: "gain", label: "Gain", value: 0.5, min: 0, max: 1 }],
    };
    handle.update();
    expect(host.querySelector("input")?.disabled).toBe(true);
  });

  it("reports command and cleanup failures after completing cleanup", async () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const commandFailure = new Error("apply failed");
    const cleanupFailure = new Error("unsubscribe failed");
    binding.setValue = vi.fn(() => Promise.reject(commandFailure));
    binding.subscribe = () => () => {
      throw cleanupFailure;
    };
    const onError = vi.fn();
    const handle = mountParameterRack(host, binding, { onError });
    const input = host.querySelector("input")!;

    input.value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(commandFailure);

    handle.destroy();
    expect(host.childElementCount).toBe(0);
    expect(onError).toHaveBeenCalledWith(cleanupFailure);
  });

  it("lets only the latest command settlement repaint one parameter", async () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const first = deferred<void>();
    const second = deferred<void>();
    const third = deferred<void>();
    const failure = new Error("latest command failed");
    const onError = vi.fn();
    Object.assign(binding, { subscribe: undefined });
    binding.setValue = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    mountParameterRack(host, binding, { onError });
    const input = host.querySelector<HTMLInputElement>(
      'input[data-parameter-id="rate"]',
    )!;

    input.value = "1.2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "1.4";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    binding.state.parameters[0]!.value = 1.2;
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(input.value).toBe("1.4");

    binding.state.parameters[0]!.value = 1.4;
    second.resolve();
    await second.promise;
    await Promise.resolve();
    expect(input.value).toBe("1.4");

    input.value = "1.6";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    binding.state.parameters[0]!.value = 1.4;
    third.reject(failure);
    await Promise.allSettled([third.promise]);
    await Promise.resolve();

    expect(input.value).toBe("1.4");
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("refreshes from the authoritative snapshot after an async command", async () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const command = deferred<void>();
    Object.assign(binding, { subscribe: undefined });
    binding.setValue = vi.fn(() => command.promise);
    mountParameterRack(host, binding);
    const input = host.querySelector<HTMLInputElement>(
      'input[data-parameter-id="rate"]',
    )!;

    input.value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("1.5");

    binding.state.parameters[0]!.value = 1.8;
    command.resolve();
    await command.promise;
    await Promise.resolve();

    expect(input.value).toBe("1.8");
    expect(input.getAttribute("aria-valuetext")).toBe("1.8 ×");
  });

  it("ignores command settlements from a destroyed mount", async () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const replacement = new FakeParameters();
    const resolvedCommand = deferred<void>();
    const rejectedCommand = deferred<void>();
    const snapshot = vi.spyOn(binding, "snapshot");
    const onError = vi.fn();
    binding.setValue = vi
      .fn()
      .mockReturnValueOnce(resolvedCommand.promise)
      .mockReturnValueOnce(rejectedCommand.promise);
    const staleHandle = mountParameterRack(host, binding, { onError });
    const input = host.querySelector<HTMLInputElement>(
      'input[data-parameter-id="rate"]',
    )!;

    input.value = "1.2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "1.3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const snapshotCalls = snapshot.mock.calls.length;
    const replacementHandle = mountParameterRack(host, replacement);

    resolvedCommand.resolve();
    rejectedCommand.reject(new Error("stale failure"));
    await Promise.allSettled([
      resolvedCommand.promise,
      rejectedCommand.promise,
    ]);
    await Promise.resolve();

    expect(snapshot).toHaveBeenCalledTimes(snapshotCalls);
    expect(onError).not.toHaveBeenCalled();
    expect(host.querySelectorAll(".wui-parameter-rack")).toHaveLength(1);
    expect(host.querySelector(".wui-parameter-rack")).toBe(
      replacementHandle.element,
    );
    staleHandle.destroy();
    expect(replacementHandle.element.parentElement).toBe(host);
  });

  it("contains onError failures at the async command boundary", async () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const command = deferred<void>();
    const commandFailure = new Error("command failed");
    const reportingFailure = new Error("report failed");
    const onError = vi.fn(() => {
      throw reportingFailure;
    });
    binding.setValue = vi.fn(() => command.promise);
    mountParameterRack(host, binding, { onError });
    const input = host.querySelector<HTMLInputElement>("input")!;

    input.value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    command.reject(commandFailure);
    await Promise.allSettled([command.promise]);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(commandFailure);
  });

  it("reports a custom formatter failure and falls back to the canonical readout", () => {
    const host = document.createElement("div");
    const binding = new FakeParameters();
    const failure = new Error("format failed");
    const onError = vi.fn();

    mountParameterRack(host, binding, {
      formatValue: () => {
        throw failure;
      },
      onError,
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(host.querySelector("input")?.getAttribute("aria-valuetext")).toBe(
      "1 ×",
    );
  });

  it("rolls back its owned DOM when error reporting aborts mount", () => {
    const host = document.createElement("div");
    const existing = document.createElement("p");
    host.append(existing);
    const binding = new FakeParameters();
    const snapshotFailure = new Error("snapshot failed");
    const reportingFailure = new Error("report failed");
    binding.snapshot = () => {
      throw snapshotFailure;
    };

    expect(() =>
      mountParameterRack(host, binding, {
        onError: () => {
          throw reportingFailure;
        },
      }),
    ).toThrow(reportingFailure);
    expect([...host.children]).toEqual([existing]);
  });
});
