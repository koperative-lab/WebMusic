// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { WebMusicElement } from "../src/elements";

let nextTag = 0;

function define<T extends CustomElementConstructor>(constructor: T): T {
  customElements.define(`webmusic-element-test-${nextTag++}`, constructor);
  return constructor;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("WebMusicElement", () => {
  it("can be subclassed and registered as a normal custom element", () => {
    class TestElement extends WebMusicElement {}
    define(TestElement);

    const element = new TestElement();

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element).toBeInstanceOf(WebMusicElement);
  });

  it("mounts once per connection and remounts with a fresh cleanup scope", () => {
    const events: string[] = [];

    class TestElement extends WebMusicElement {
      protected override onMount() {
        events.push("mount");
        this.own(() => events.push("owned"));
        return () => events.push("returned");
      }

      protected override onUnmount() {
        events.push("unmount");
      }
    }
    define(TestElement);
    const element = new TestElement();

    document.body.append(element);
    element.connectedCallback();
    expect(events).toEqual(["mount"]);

    element.remove();
    element.disconnectedCallback();
    expect(events).toEqual(["mount", "unmount", "returned", "owned"]);

    document.body.append(element);
    element.remove();
    expect(events).toEqual([
      "mount",
      "unmount",
      "returned",
      "owned",
      "mount",
      "unmount",
      "returned",
      "owned",
    ]);
  });

  it("finishes every owned cleanup before reporting lifecycle failures", () => {
    const events: string[] = [];
    const failures = [
      new Error("unmount failed"),
      new Error("returned cleanup failed"),
      new Error("owned cleanup failed"),
    ];

    class TestElement extends WebMusicElement {
      readonly reported: unknown[] = [];

      protected override onMount() {
        this.own(() => {
          events.push("owned");
          throw failures[2];
        });
        this.own(() => events.push("middle"));
        return () => {
          events.push("returned");
          throw failures[1];
        };
      }

      protected override onUnmount() {
        events.push("unmount");
        throw failures[0];
      }

      protected override onLifecycleError(error: unknown) {
        this.reported.push(error);
      }
    }
    define(TestElement);
    const element = new TestElement();

    document.body.append(element);
    element.remove();

    expect(events).toEqual(["unmount", "returned", "middle", "owned"]);
    expect(element.reported).toEqual(failures);
  });

  it("rolls back resources registered before a mount failure and can retry", () => {
    const events: string[] = [];
    const mountFailure = new Error("mount failed");

    class TestElement extends WebMusicElement {
      attempts = 0;
      readonly reported: unknown[] = [];

      protected override onMount() {
        this.attempts += 1;
        this.own(() => events.push(`cleanup-${this.attempts}`));
        if (this.attempts === 1) throw mountFailure;
      }

      protected override onLifecycleError(error: unknown) {
        this.reported.push(error);
      }
    }
    define(TestElement);
    const element = new TestElement();

    element.connectedCallback();
    expect(events).toEqual(["cleanup-1"]);
    expect(element.reported).toEqual([mountFailure]);

    element.connectedCallback();
    element.disconnectedCallback();
    expect(events).toEqual(["cleanup-1", "cleanup-2"]);
  });

  it("does not drain a new lifetime registered by synchronous reconnect", () => {
    const events: string[] = [];

    class TestElement extends WebMusicElement {
      mounts = 0;

      protected override onMount() {
        const lifetime = ++this.mounts;
        events.push(`mount-${lifetime}`);
        this.own(() => {
          events.push(`cleanup-${lifetime}`);
          if (lifetime === 1) document.body.append(this);
        });
      }
    }
    define(TestElement);
    const element = new TestElement();

    document.body.append(element);
    element.remove();

    expect(element.isConnected).toBe(true);
    expect(events).toEqual(["mount-1", "cleanup-1", "mount-2"]);

    element.remove();
    expect(events).toEqual(["mount-1", "cleanup-1", "mount-2", "cleanup-2"]);
  });

  it("does not attach late ownership from a stale mount to a reconnected lifetime", () => {
    const events: string[] = [];

    class TestElement extends WebMusicElement {
      mounts = 0;

      protected override onMount() {
        const lifetime = ++this.mounts;
        events.push(`mount-${lifetime}`);
        if (lifetime === 1) {
          this.remove();
          document.body.append(this);
          this.own(() => events.push("late-cleanup-1"));
          return;
        }
        this.own(() => events.push(`cleanup-${lifetime}`));
      }
    }
    define(TestElement);
    const element = new TestElement();

    document.body.append(element);

    expect(element.isConnected).toBe(true);
    expect(events).toEqual(["mount-1", "mount-2", "late-cleanup-1"]);

    element.remove();
    expect(events).toEqual([
      "mount-1",
      "mount-2",
      "late-cleanup-1",
      "cleanup-2",
    ]);
  });

  it("rejects cleanup ownership outside an active mount", () => {
    class TestElement extends WebMusicElement {
      register(cleanup: () => void) {
        return this.own(cleanup);
      }
    }
    define(TestElement);
    const element = new TestElement();

    expect(() => element.register(() => {})).toThrow(
      /only own cleanup while mounted/,
    );
  });

  it.each([undefined, null])("preserves a lifecycle error hook throwing %s after all cleanup", (failure) => {
    const events: string[] = [];
    class TestElement extends WebMusicElement {
      reports = 0;
      protected override onMount() {
        this.own(() => events.push("owned"));
        this.own(() => { throw new Error("owned cleanup failed"); });
        return () => { throw new Error("cleanup failed"); };
      }

      protected override onLifecycleError() {
        if (++this.reports === 1) throw failure;
        throw new Error("later reporting failure");
      }
    }
    define(TestElement);
    const element = new TestElement();
    element.connectedCallback();
    let didThrow = false;
    try {
      element.disconnectedCallback();
    } catch (error) {
      didThrow = true;
      expect(error).toBe(failure);
    }
    expect(didThrow).toBe(true);
    expect(element.reports).toBe(2);
    expect(events).toEqual(["owned"]);
  });

  it("reports a failing returned cleanup from a stale mount only once", () => {
    const failure = new Error("stale cleanup failed");
    const reported: unknown[] = [];
    class TestElement extends WebMusicElement {
      protected override onMount() {
        this.disconnectedCallback();
        return () => { throw failure; };
      }

      protected override onLifecycleError(error: unknown) {
        reported.push(error);
        throw error;
      }
    }
    define(TestElement);
    const element = new TestElement();
    expect(() => element.connectedCallback()).toThrow(failure);
    expect(reported).toEqual([failure]);
  });
});
