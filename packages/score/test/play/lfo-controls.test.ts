// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {LfoBinding, LfoHandle} from '@webmusic/ui/lfo';
import {LfoController, type LfoTarget} from '../../src/play/headless/lfo';
import {
  SynthPanelElement,
  type SynthPanelLfoEventDetail,
  type SynthPanelLfoErrorDetail,
  type SynthPanelLfoState,
} from '../../src/play/element/synth-panel';

let nextTag = 0;

function define<T extends CustomElementConstructor>(
  constructor: T,
  name: string,
): string {
  const tag = `webmusic-${name}-${nextTag++}`;
  const UniqueConstructor = class extends constructor {};
  customElements.define(tag, UniqueConstructor);
  return tag;
}

class FrameScheduler {
  private nextHandle = 1;
  readonly callbacks = new Map<number, FrameRequestCallback>();
  readonly cancelled: number[] = [];

  readonly request = (callback: FrameRequestCallback): number => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  readonly cancel = (handle: number): void => {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  };

  get pending(): number[] {
    return [...this.callbacks.keys()];
  }

  callback(handle: number): FrameRequestCallback {
    const callback = this.callbacks.get(handle);
    if (!callback) throw new Error(`Missing frame ${handle}`);
    return callback;
  }

  fire(handle = this.pending[0]!, timestamp = 0): void {
    const callback = this.callback(handle);
    this.callbacks.delete(handle);
    callback(timestamp);
  }
}

function installRaf(initialMilliseconds = 0): {
  scheduler: FrameScheduler;
  setNow(milliseconds: number): void;
} {
  const scheduler = new FrameScheduler();
  let milliseconds = initialMilliseconds;
  vi.spyOn(performance, 'now').mockImplementation(() => milliseconds);
  vi.stubGlobal('requestAnimationFrame', scheduler.request);
  vi.stubGlobal('cancelAnimationFrame', scheduler.cancel);
  return {
    scheduler,
    setNow(value: number): void {
      milliseconds = value;
    },
  };
}

function setRange(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
}

function eventsOf<T>(
  element: HTMLElement,
  type: string,
): Array<CustomEvent<T>> {
  const events: Array<CustomEvent<T>> = [];
  element.addEventListener(type, (event) => {
    events.push(event as CustomEvent<T>);
  });
  return events;
}

class InspectableSynthPanelElement extends SynthPanelElement {
  controller?: LfoController;
  binding?: LfoBinding;
  presenter?: LfoHandle;

  protected override createSynthLfoController(): LfoController {
    const controller = super.createSynthLfoController();
    this.controller = controller;
    return controller;
  }

  protected override mountSynthLfoUI(
    host: HTMLElement,
    binding: LfoBinding,
  ): LfoHandle {
    this.binding = binding;
    const presenter = super.mountSynthLfoUI(host, binding);
    this.presenter = presenter;
    return presenter;
  }
}

const synthTag = define(InspectableSynthPanelElement, 'synth-lfo-test');

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('<synth-panel sections="lfo"> direct Headless + UI composition', () => {
  it('mounts the canonical presenter behind the legacy LFO section and CSS hooks', () => {
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    document.body.append(panel);
    const root = panel.shadowRoot!;

    expect(root.mode).toBe('open');
    expect(
      root.querySelector('.sec-lfo > .lfo-host > .wui-lfo.lfo'),
    ).not.toBeNull();
    expect(root.querySelector('.lfo-row')).not.toBeNull();
    expect(root.querySelectorAll('.shape')).toHaveLength(4);
    expect(root.querySelector('.shape.on')?.getAttribute('data-s')).toBe(
      'sine',
    );
    expect(root.querySelector('.rate')).not.toBeNull();
    expect(root.querySelector('.depth')).not.toBeNull();
    expect(root.querySelector('.val.ratev')?.textContent).toBe('1.00Hz');
    expect(root.querySelector('.val.depthv')?.textContent).toBe('60%');
    expect(root.querySelector('.wave .lfo-curve')).not.toBeNull();
    expect(root.querySelector('.wave .head')).not.toBeNull();
    expect(panel.controller).toBeInstanceOf(LfoController);
    expect(panel.binding?.snapshot()).toMatchObject({
      shape: 'sine',
      rate: 1,
      depth: 0.6,
      running: false,
    });

    const style = root.querySelector<HTMLStyleElement>(
      'style[data-webmusic-ui="panel"]',
    )?.textContent;
    expect(style).toContain(
      'var(--synth-graph-bg, var(--wm-lfo-wave-background',
    );
    expect(style).toContain(
      'var(--synth-radius, var(--wm-lfo-radius, var(--wm-control-radius, 0)))',
    );
  });

  it('exposes a typed read/write LFO state and updates the mounted presenter', () => {
    const {scheduler} = installRaf();
    const parent = document.createElement('div');
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    const events = eventsOf<SynthPanelLfoEventDetail>(parent, 'webscore:lfo');
    parent.append(panel);
    document.body.append(parent);

    panel.lfo = {
      shape: 'triangle',
      rate: 4,
      depth: 0.25,
      phase: 0.125,
      running: true,
    };

    expect(panel.lfo).toEqual({
      shape: 'triangle',
      rate: 4,
      depth: 0.25,
      phase: 0.125,
      running: true,
    });
    const root = panel.shadowRoot!;
    expect(root.querySelector('.shape.on')?.getAttribute('data-s')).toBe(
      'triangle',
    );
    expect(root.querySelector<HTMLInputElement>('.rate')?.value).toBe('4');
    expect(root.querySelector<HTMLInputElement>('.depth')?.value).toBe('0.25');
    expect(root.querySelector('.run')?.getAttribute('aria-label')).toBe('Stop');
    expect(root.querySelector('.head')?.getAttribute('x1')).toBe('12.5');
    expect(scheduler.pending).toEqual([1]);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual(panel.lfo);
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);

    const snapshot: SynthPanelLfoState = panel.lfo;
    snapshot.rate = 9;
    events[0]!.detail.depth = 0.9;
    expect(panel.lfo).toMatchObject({rate: 4, depth: 0.25});

    // Phase is observable and writable, but is not a semantic control event.
    panel.lfo = {phase: 0.5};
    expect(panel.lfo.phase).toBe(0.5);
    expect(root.querySelector('.head')?.getAttribute('x1')).toBe('50.0');
    expect(events).toHaveLength(1);

    panel.lfo = {running: false};
    expect(root.querySelector('.run')?.getAttribute('aria-label')).toBe('Run');
    expect(scheduler.cancelled).toEqual([1]);
    expect(events).toHaveLength(2);
    expect(events[1]?.detail).toEqual(panel.lfo);
  });

  it('publishes complete bubbling state for UI control changes without frame events', () => {
    const {scheduler, setNow} = installRaf();
    const parent = document.createElement('div');
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    const events = eventsOf<SynthPanelLfoEventDetail>(parent, 'webscore:lfo');
    parent.append(panel);
    document.body.append(parent);
    const root = panel.shadowRoot!;

    root.querySelector<HTMLButtonElement>('[data-s="saw"]')!.click();
    setRange(root.querySelector<HTMLInputElement>('.rate')!, 3);
    setRange(root.querySelector<HTMLInputElement>('.depth')!, 0.4);
    root.querySelector<HTMLButtonElement>('.run')!.click();

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.detail)).toEqual([
      {shape: 'saw', rate: 1, depth: 0.6, running: false, phase: 0},
      {shape: 'saw', rate: 3, depth: 0.6, running: false, phase: 0},
      {shape: 'saw', rate: 3, depth: 0.4, running: false, phase: 0},
      {shape: 'saw', rate: 3, depth: 0.4, running: true, phase: 0},
    ]);
    expect(events.every((event) => event.bubbles && event.composed)).toBe(true);

    setNow(250);
    scheduler.fire(1);
    expect(panel.lfo.phase).toBeCloseTo(0.75);
    expect(events).toHaveLength(4);
  });

  it('honours detached run intent once, then reconnects stopped with state retained', () => {
    const {scheduler} = installRaf();
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    const events = eventsOf<SynthPanelLfoEventDetail>(panel, 'webscore:lfo');

    panel.lfo = {
      shape: 'square',
      rate: 2.5,
      depth: 0.35,
      phase: 0.2,
      running: true,
    };
    expect(panel.lfo).toMatchObject({
      shape: 'square',
      rate: 2.5,
      depth: 0.35,
      running: true,
    });
    expect(panel.lfo.phase).toBeCloseTo(0.2);

    document.body.append(panel);
    expect(panel.lfo.running).toBe(true);
    expect(panel.shadowRoot?.querySelector('.run')?.getAttribute('aria-label')).toBe(
      'Stop',
    );
    expect(scheduler.pending).toEqual([1]);
    expect(events).toHaveLength(0);

    panel.remove();
    expect(panel.lfo).toMatchObject({
      shape: 'square',
      rate: 2.5,
      depth: 0.35,
      running: false,
    });
    expect(panel.lfo.phase).toBeCloseTo(0.2);
    expect(scheduler.cancelled).toEqual([1]);

    document.body.append(panel);
    expect(panel.lfo.running).toBe(false);
    expect(panel.shadowRoot?.querySelector('.run')?.getAttribute('aria-label')).toBe(
      'Run',
    );
    expect(scheduler.pending).toEqual([]);
    expect(events).toHaveLength(0);
  });

  it('keeps target assignment lazy and drives the same legacy RAF maths', () => {
    const {scheduler, setNow} = installRaf();
    const target = {min: 0, max: 10, apply: vi.fn()};
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    panel.target = target;
    expect(panel.target).toBe(target);
    expect(target.apply).not.toHaveBeenCalled();
    document.body.append(panel);
    expect(target.apply).not.toHaveBeenCalled();

    panel.shadowRoot!.querySelector<HTMLButtonElement>('.run')!.click();
    setNow(250);
    scheduler.fire(1);

    expect(target.apply).toHaveBeenCalledExactlyOnceWith(8);
    expect(panel.shadowRoot?.querySelector('.head')?.getAttribute('x1')).toBe(
      '25.0',
    );
    expect(panel.binding?.snapshot().phase).toBeCloseTo(0.25);
  });

  it('keeps modulation running while the section is hidden and remounts the live state', () => {
    const {scheduler, setNow} = installRaf();
    const target = {min: 0, max: 10, apply: vi.fn()};
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    panel.target = target;
    document.body.append(panel);
    panel.shadowRoot!.querySelector<HTMLButtonElement>('.run')!.click();
    setNow(250);
    scheduler.fire(1);

    panel.sections = ['macros'];
    expect(panel.shadowRoot?.querySelector('.wui-lfo')).toBeNull();
    expect(scheduler.pending).toEqual([2]);
    setNow(500);
    scheduler.fire(2);
    expect(target.apply).toHaveBeenNthCalledWith(2, 5);

    panel.sections = ['lfo'];

    expect(panel.shadowRoot?.querySelectorAll('.wui-lfo')).toHaveLength(1);
    expect(panel.binding?.snapshot()).toMatchObject({
      running: true,
      phase: 0.5,
    });
    expect(panel.shadowRoot?.querySelector('.run')?.getAttribute('aria-label')).toBe(
      'Stop',
    );
    expect(panel.shadowRoot?.querySelector('.head')?.getAttribute('x1')).toBe(
      '50.0',
    );
    expect(scheduler.pending).toEqual([3]);
  });

  it('stops on disconnect and retains LFO state without auto-running on reconnect', () => {
    const {scheduler, setNow} = installRaf();
    const target = {min: 0, max: 10, apply: vi.fn()};
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    panel.target = target;
    document.body.append(panel);
    const root = panel.shadowRoot!;
    root.querySelector<HTMLButtonElement>('[data-s="saw"]')!.click();
    setRange(root.querySelector<HTMLInputElement>('.rate')!, 4);
    setRange(root.querySelector<HTMLInputElement>('.depth')!, 0.25);
    root.querySelector<HTMLButtonElement>('.run')!.click();
    setNow(125);
    scheduler.fire(1);
    expect(panel.binding?.snapshot().phase).toBeCloseTo(0.5);

    panel.remove();
    expect(scheduler.cancelled).toEqual([2]);
    document.body.append(panel);

    expect(panel.binding?.snapshot()).toEqual({
      shape: 'saw',
      rate: 4,
      depth: 0.25,
      running: false,
      phase: 0.5,
    });
    expect(panel.shadowRoot).toBe(root);
    expect(panel.shadowRoot?.querySelector('.run')?.getAttribute('aria-label')).toBe(
      'Run',
    );
    expect(scheduler.pending).toEqual([]);
    expect(target.apply).toHaveBeenCalledOnce();
  });

  it('does not let outer disconnect cleanup dispose a synchronously reconnected controller', () => {
    const {scheduler} = installRaf();
    class CleanupReentrantSynth extends SynthPanelElement {
      reenter = true;

      protected override mountSynthLfoUI(
        host: HTMLElement,
        binding: LfoBinding,
      ): LfoHandle {
        const raw = super.mountSynthLfoUI(host, binding);
        return {
          element: raw.element,
          update: () => raw.update(),
          destroy: () => {
            raw.destroy();
            if (this.reenter) {
              this.reenter = false;
              document.body.append(this);
            }
          },
        };
      }
    }
    const tag = define(CleanupReentrantSynth, 'cleanup-reentrant-synth-lfo');
    const panel = document.createElement(tag) as CleanupReentrantSynth;
    panel.sections = ['lfo'];
    document.body.append(panel);

    panel.remove();

    expect(panel.isConnected).toBe(true);
    expect(panel.shadowRoot?.querySelectorAll('.wui-lfo')).toHaveLength(1);
    panel.shadowRoot!.querySelector<HTMLButtonElement>('.run')!.click();
    expect(scheduler.pending).toHaveLength(1);
  });

  it('reads a hot-swapped target and reports current frame failures at the panel boundary', () => {
    const {scheduler, setNow} = installRaf();
    const first = {min: 0, max: 10, apply: vi.fn()};
    const failure = new Error('panel LFO failed');
    const second: LfoTarget = {
      min: 0,
      max: 1,
      apply: () => {
        throw failure;
      },
    };
    const parent = document.createElement('div');
    const panel = document.createElement(
      synthTag,
    ) as InspectableSynthPanelElement;
    panel.sections = ['lfo'];
    panel.target = first;
    const errors = eventsOf<SynthPanelLfoErrorDetail>(parent, 'webscore:error');
    parent.append(panel);
    document.body.append(parent);
    panel.shadowRoot!.querySelector<HTMLButtonElement>('.run')!.click();
    setNow(100);
    scheduler.fire(1);

    panel.target = second;
    setNow(200);
    expect(() => scheduler.fire(2)).not.toThrow();

    expect(first.apply).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.detail).toEqual({
      operation: 'synth-panel',
      error: failure,
    });
    expect(errors[0]?.bubbles).toBe(true);
    expect(errors[0]?.composed).toBe(true);
    expect(panel.binding?.snapshot().running).toBe(false);
  });

  it('exposes the protected binding seam and rejects a stale mount after remount', () => {
    const staleDestroy = vi.fn();
    class ReentrantSynthLfo extends InspectableSynthPanelElement {
      first = true;

      protected override mountSynthLfoUI(
        host: HTMLElement,
        binding: LfoBinding,
      ): LfoHandle {
        if (!this.first) return super.mountSynthLfoUI(host, binding);
        this.first = false;
        this.reportLfoError(new Error('remount'));
        const stale = host.ownerDocument.createElement('div');
        stale.className = 'stale-lfo';
        host.append(stale);
        return {
          element: stale,
          update: () => undefined,
          destroy: () => {
            staleDestroy();
            stale.remove();
          },
        };
      }
    }
    const tag = define(ReentrantSynthLfo, 'reentrant-synth-lfo');
    const panel = document.createElement(tag) as ReentrantSynthLfo;
    panel.sections = ['lfo'];
    panel.addEventListener('webscore:error', () => {
      panel.remove();
      document.body.append(panel);
    });

    document.body.append(panel);

    expect(staleDestroy).toHaveBeenCalledOnce();
    expect(panel.shadowRoot?.querySelector('.stale-lfo')).toBeNull();
    expect(panel.shadowRoot?.querySelectorAll('.wui-lfo')).toHaveLength(1);
    expect(panel.binding?.snapshot()).toMatchObject({running: false});
  });

  it('reports a controller factory seam failure once and recovers on reconnect', () => {
    const failure = new Error('synth controller factory failed');
    class FailingFactorySynth extends SynthPanelElement {
      fail = true;

      protected override createSynthLfoController(): LfoController {
        if (this.fail) {
          this.fail = false;
          throw failure;
        }
        return super.createSynthLfoController();
      }
    }
    const tag = define(FailingFactorySynth, 'factory-synth-lfo');
    const panel = document.createElement(tag) as FailingFactorySynth;
    panel.sections = ['lfo'];
    const errors = eventsOf<SynthPanelLfoErrorDetail>(panel, 'webscore:error');

    expect(() => document.body.append(panel)).not.toThrow();
    expect(errors.map((event) => event.detail)).toEqual([
      {operation: 'synth-panel', error: failure},
    ]);
    expect(panel.shadowRoot?.querySelector('.wui-lfo')).toBeNull();

    panel.remove();
    document.body.append(panel);
    expect(panel.shadowRoot?.querySelectorAll('.wui-lfo')).toHaveLength(1);
  });
});
