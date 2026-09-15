// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  lfoStyle,
  mountLfo,
  type LfoBinding,
  type LfoHandle,
  type LfoShape,
  type LfoState,
} from '../src/lfo';

const DEFAULT_STATE: LfoState = {
  shape: 'sine',
  rate: 1,
  depth: 0.6,
  phase: 0,
  running: false,
};

class FakeLfo implements LfoBinding {
  state: LfoState = {...DEFAULT_STATE};
  readonly calls: Array<[kind: string, value: boolean | number | LfoShape]> = [];
  readonly listeners = new Set<() => void>();

  snapshot(): LfoState {
    return {...this.state};
  }

  setRunning(running: boolean): void {
    this.calls.push(['running', running]);
    this.state.running = running;
  }

  setShape(shape: LfoShape): void {
    this.calls.push(['shape', shape]);
    this.state.shape = shape;
  }

  setRate(rate: number): void {
    this.calls.push(['rate', rate]);
    this.state.rate = rate;
  }

  setDepth(depth: number): void {
    this.calls.push(['depth', depth]);
    this.state.depth = depth;
  }

  subscribe(notify: () => void): () => void {
    this.listeners.add(notify);
    return () => this.listeners.delete(notify);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }
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
  return {promise, resolve, reject};
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function input(host: ParentNode, name: 'rate' | 'depth'): HTMLInputElement {
  return host.querySelector<HTMLInputElement>(`.wui-lfo__${name}`)!;
}

function setRange(control: HTMLInputElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event('input', {bubbles: true}));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountLfo', () => {
  it('exposes the named control nodes as the stable route to presenter DOM', () => {
    const host = document.createElement('div');
    const binding = new FakeLfo();
    binding.state = {...DEFAULT_STATE, rate: 2, depth: 0.25};

    const handle = mountLfo(host, binding);
    const {controls} = handle;
    expect(handle.element.contains(controls.run)).toBe(true);
    expect(handle.element.contains(controls.shapes)).toBe(true);
    expect(handle.element.contains(controls.wave)).toBe(true);
    expect(controls.wave.contains(controls.curve)).toBe(true);
    expect(controls.wave.contains(controls.head)).toBe(true);
    expect(controls.rateInput.getAttribute('aria-label')).toBe('rate');
    expect(controls.depthInput.getAttribute('aria-label')).toBe('depth');
    expect(controls.rateInput.value).toBe('2');
    expect(controls.depthInput.value).toBe('0.25');
    expect(controls.rateValue.textContent).toBe('2.00Hz');
    expect(controls.depthValue.textContent).toBe('25%');

    binding.state = {...binding.state, rate: 4, depth: 0.5};
    handle.update();
    expect(controls.rateValue.textContent).toBe('4.00Hz');
    expect(controls.depthValue.textContent).toBe('50%');
    handle.destroy();
  });

  it('renders accessible canonical DOM, customization hooks, and semantic style tokens', () => {
    const host = document.createElement('div');
    const unrelated = document.createElement('span');
    unrelated.dataset.callerOwned = 'true';
    host.append(unrelated);
    const binding = new FakeLfo();
    binding.state = {
      shape: 'triangle',
      rate: 2,
      depth: 0.25,
      phase: 0.3,
      running: false,
    };

    const handle = mountLfo(host, binding, {
      label: 'Filter modulation',
      runLabel: 'Start modulation',
      stopLabel: 'Stop modulation',
      classNames: {
        root: 'legacy-root',
        row: 'legacy-row',
        run: 'legacy-run',
        shapes: 'legacy-shapes',
        shape: 'legacy-shape',
        control: 'legacy-control',
        rateControl: 'legacy-rate-control',
        depthControl: 'legacy-depth-control',
        label: 'legacy-label',
        input: 'legacy-input',
        rateInput: 'legacy-rate-input',
        depthInput: 'legacy-depth-input',
        value: 'legacy-value',
        rateValue: 'legacy-rate-value',
        depthValue: 'legacy-depth-value',
        wave: 'legacy-wave',
        curve: 'legacy-curve',
        head: 'legacy-head',
      },
      parts: {
        root: 'custom-root',
        row: 'custom-row',
        run: 'custom-run',
        shapes: 'custom-shapes',
        shape: 'custom-shape',
        control: 'custom-control',
        rateControl: 'custom-rate-control',
        depthControl: 'custom-depth-control',
        label: 'custom-label',
        input: 'custom-input',
        rateInput: 'custom-rate-input',
        depthInput: 'custom-depth-input',
        value: 'custom-value',
        rateValue: 'custom-rate-value',
        depthValue: 'custom-depth-value',
        wave: 'custom-wave',
        curve: 'custom-curve',
        head: 'custom-head',
      },
      formatRate: (rate) => `${rate.toFixed(1)} hertz`,
      formatDepth: (depth) => `${Math.round(depth * 100)} percent`,
    });

    expect(host.firstElementChild).toBe(unrelated);
    expect(host.querySelector('style[data-webmusic-ui="lfo"]')?.textContent).toBe(lfoStyle);
    expect(handle.element).toBe(host.querySelector('.wui-lfo'));
    expect(handle.element.classList.contains('legacy-root')).toBe(true);
    expect(handle.element.getAttribute('part')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['root', 'custom-root']),
    );
    expect(handle.element.getAttribute('role')).toBe('group');
    expect(handle.element.getAttribute('aria-label')).toBe('Filter modulation');

    const row = host.querySelector<HTMLElement>('.wui-lfo__row')!;
    expect(row.classList.contains('legacy-row')).toBe(true);
    expect(row.getAttribute('part')).toContain('custom-row');
    const run = host.querySelector<HTMLButtonElement>('.wui-lfo__run')!;
    expect(run.type).toBe('button');
    expect(run.classList.contains('legacy-run')).toBe(true);
    expect(run.getAttribute('part')).toContain('custom-run');
    expect(run.getAttribute('aria-label')).toBe('Start modulation');
    expect(run.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    const shapes = host.querySelector<HTMLElement>('.wui-lfo__shapes')!;
    expect(shapes.classList.contains('legacy-shapes')).toBe(true);
    expect(shapes.getAttribute('role')).toBe('group');
    expect(shapes.getAttribute('aria-label')).toBe('Shape');
    const shapeButtons = [...shapes.querySelectorAll<HTMLButtonElement>('button')];
    expect(shapeButtons).toHaveLength(4);
    expect(shapeButtons.map((button) => button.dataset.s)).toEqual([
      'sine',
      'triangle',
      'square',
      'saw',
    ]);
    for (const button of shapeButtons) {
      expect(button.classList.contains('legacy-shape')).toBe(true);
      expect(button.getAttribute('part')).toContain('custom-shape');
      expect(button.getAttribute('aria-label')).toBe(button.dataset.s);
      expect(button.title).toBe(button.dataset.s);
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(shapes.querySelector('[data-s="triangle"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(shapes.querySelector('[data-s="sine"]')?.getAttribute('aria-pressed')).toBe('false');

    const controls = [...host.querySelectorAll<HTMLLabelElement>('.wui-lfo__control')];
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control.classList.contains('legacy-control')).toBe(true);
      expect(control.classList.contains('legacy-label')).toBe(true);
      expect(control.getAttribute('part')?.split(/\s+/)).toEqual(
        expect.arrayContaining(['control', 'label', 'custom-control', 'custom-label']),
      );
    }
    expect(controls[0]!.getAttribute('part')).toContain('rate-control');
    expect(controls[1]!.getAttribute('part')).toContain('depth-control');
    expect(controls[0]!.classList.contains('legacy-rate-control')).toBe(true);
    expect(controls[0]!.getAttribute('part')).toContain('custom-rate-control');
    expect(controls[1]!.classList.contains('legacy-depth-control')).toBe(true);
    expect(controls[1]!.getAttribute('part')).toContain('custom-depth-control');

    const rate = input(host, 'rate');
    const depth = input(host, 'depth');
    expect(rate.classList.contains('legacy-input')).toBe(true);
    expect(rate.classList.contains('legacy-rate-input')).toBe(true);
    expect(rate.getAttribute('part')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['input', 'rate', 'custom-input']),
    );
    expect(rate.getAttribute('part')).toContain('custom-rate-input');
    expect([rate.min, rate.max, rate.step, rate.value]).toEqual(['0.05', '12', '0.05', '2']);
    expect(rate.getAttribute('aria-label')).toBe('rate');
    expect(rate.getAttribute('aria-valuetext')).toBe('2.0 hertz');
    expect([depth.min, depth.max, depth.step, depth.value]).toEqual(['0', '1', '0.01', '0.25']);
    expect(depth.getAttribute('aria-label')).toBe('depth');
    expect(depth.classList.contains('legacy-depth-input')).toBe(true);
    expect(depth.getAttribute('part')).toContain('custom-depth-input');
    expect(depth.getAttribute('aria-valuetext')).toBe('25 percent');
    const values = [...host.querySelectorAll<HTMLElement>('.wui-lfo__value')];
    expect(values.map((value) => value.textContent)).toEqual(['2.0 hertz', '25 percent']);
    expect(values.every((value) => value.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(values.every((value) => value.classList.contains('legacy-value'))).toBe(true);
    expect(values.every((value) => value.getAttribute('part')?.includes('custom-value'))).toBe(true);
    expect(values[0]!.classList.contains('legacy-rate-value')).toBe(true);
    expect(values[0]!.getAttribute('part')).toContain('custom-rate-value');
    expect(values[1]!.classList.contains('legacy-depth-value')).toBe(true);
    expect(values[1]!.getAttribute('part')).toContain('custom-depth-value');

    const wave = host.querySelector<HTMLElement>('.wui-lfo__wave')!;
    expect(wave.classList.contains('legacy-wave')).toBe(true);
    expect(wave.getAttribute('part')).toContain('custom-wave');
    const svg = wave.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    const curve = wave.querySelector('.wui-lfo__curve')!;
    expect(curve.classList.contains('legacy-curve')).toBe(true);
    expect(curve.getAttribute('part')).toContain('custom-curve');
    expect(curve.getAttribute('points')?.split(' ')).toHaveLength(51);
    const head = wave.querySelector('.wui-lfo__head')!;
    expect(head.classList.contains('legacy-head')).toBe(true);
    expect(head.getAttribute('part')).toContain('custom-head');
    expect(head.getAttribute('x1')).toBe('30.0');
    expect(head.getAttribute('x2')).toBe('30.0');

    for (const property of [
      '--wm-lfo-padding',
      '--wm-lfo-border',
      '--wm-lfo-radius',
      '--wm-lfo-background',
      '--wm-lfo-foreground',
      '--wm-lfo-font',
      '--wm-lfo-gap',
      '--wm-lfo-button-background',
      '--wm-lfo-button-foreground',
      '--wm-lfo-shape-gap',
      '--wm-lfo-chip-border',
      '--wm-lfo-chip-background',
      '--wm-lfo-chip-foreground',
      '--wm-lfo-chip-active-background',
      '--wm-lfo-chip-active-foreground',
      '--wm-lfo-label',
      '--wm-lfo-input-width',
      '--wm-lfo-track',
      '--wm-lfo-thumb',
      '--wm-lfo-value',
      '--wm-lfo-wave-height',
      '--wm-lfo-wave-background',
      '--wm-lfo-wave',
      '--wm-lfo-head',
    ]) {
      expect(lfoStyle, property).toContain(property);
    }
  });

  it('normalizes hostile snapshots and disables every interactive command', () => {
    const host = document.createElement('div');
    const binding = new FakeLfo();
    binding.state = {
      shape: 'invalid' as LfoShape,
      rate: Number.POSITIVE_INFINITY,
      depth: Number.NaN,
      phase: Number.NEGATIVE_INFINITY,
      running: true,
      disabled: true,
    };
    mountLfo(host, binding);

    const root = host.querySelector('.wui-lfo')!;
    expect(root.classList.contains('is-disabled')).toBe(true);
    expect(input(host, 'rate').value).toBe('0.05');
    expect(input(host, 'depth').value).toBe('0');
    expect(host.querySelector('.wui-lfo__head')?.getAttribute('x1')).toBe('0.0');
    expect(host.querySelector('[data-s="sine"]')?.getAttribute('aria-pressed')).toBe('true');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(input(host, 'rate').disabled).toBe(true);
    expect(input(host, 'depth').disabled).toBe(true);

    buttons[0]!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    setRange(input(host, 'rate'), '8');
    setRange(input(host, 'depth'), '0.9');
    expect(binding.calls).toEqual([]);
  });

  it('routes run, shape, rate, and depth through one optimistic command surface', async () => {
    const host = document.createElement('div');
    const binding = new FakeLfo();
    const handle = mountLfo(host, binding, {
      runLabel: 'Play LFO',
      stopLabel: 'Pause LFO',
    });
    const run = host.querySelector<HTMLButtonElement>('.wui-lfo__run')!;

    run.click();
    expect(run.getAttribute('aria-label')).toBe('Pause LFO');
    expect(binding.calls.at(-1)).toEqual(['running', true]);
    await flushPromises();
    expect(run.getAttribute('aria-label')).toBe('Pause LFO');

    host.querySelector<HTMLButtonElement>('[data-s="square"]')!.click();
    expect(host.querySelector('[data-s="square"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(binding.calls.at(-1)).toEqual(['shape', 'square']);
    await flushPromises();

    setRange(input(host, 'rate'), '4.5');
    expect(input(host, 'rate').value).toBe('4.5');
    expect(binding.calls.at(-1)).toEqual(['rate', 4.5]);
    await flushPromises();

    setRange(input(host, 'depth'), '0.34');
    expect(input(host, 'depth').value).toBe('0.34');
    expect(binding.calls.at(-1)).toEqual(['depth', 0.34]);
    await flushPromises();

    expect(binding.calls).toEqual([
      ['running', true],
      ['shape', 'square'],
      ['rate', 4.5],
      ['depth', 0.34],
    ]);
    expect(handle.element.querySelector('.wui-lfo__depth-value')?.textContent).toBe('34%');
  });

  it('shows an optimistic value immediately and repaints the authoritative snapshot on settle', async () => {
    const host = document.createElement('div');
    const command = deferred();
    const binding = new FakeLfo();
    binding.setRate = vi.fn(() => command.promise);
    mountLfo(host, binding);

    setRange(input(host, 'rate'), '6');
    expect(input(host, 'rate').value).toBe('6');
    binding.state.rate = 7.25;
    command.resolve();
    await flushPromises();

    expect(input(host, 'rate').value).toBe('7.25');
    expect(host.querySelector('.wui-lfo__rate-value')?.textContent).toBe('7.25Hz');
  });

  it('rolls back and reports the latest synchronous or asynchronous command failure', async () => {
    const asyncHost = document.createElement('div');
    const asyncFailure = new Error('rate rejected');
    const pending = deferred();
    const asyncErrors: unknown[] = [];
    const asyncBinding = new FakeLfo();
    asyncBinding.setRate = () => pending.promise;
    mountLfo(asyncHost, asyncBinding, {onError: (error) => asyncErrors.push(error)});

    setRange(input(asyncHost, 'rate'), '8');
    expect(input(asyncHost, 'rate').value).toBe('8');
    pending.reject(asyncFailure);
    await flushPromises();
    expect(input(asyncHost, 'rate').value).toBe('1');
    expect(asyncErrors).toEqual([asyncFailure]);

    const syncHost = document.createElement('div');
    const syncFailure = new Error('shape threw');
    const syncErrors: unknown[] = [];
    const syncBinding = new FakeLfo();
    syncBinding.setShape = () => {
      throw syncFailure;
    };
    mountLfo(syncHost, syncBinding, {onError: (error) => syncErrors.push(error)});

    expect(() => syncHost.querySelector<HTMLButtonElement>('[data-s="saw"]')!.click()).not.toThrow();
    expect(syncHost.querySelector('[data-s="sine"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(syncErrors).toEqual([syncFailure]);
  });

  it('reports undefined rejection reasons instead of confusing them with success', async () => {
    const host = document.createElement('div');
    const command = deferred();
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    binding.setDepth = () => command.promise;
    mountLfo(host, binding, {onError: (error) => errors.push(error)});

    setRange(input(host, 'depth'), '0.95');
    command.reject(undefined);
    await flushPromises();

    expect(input(host, 'depth').value).toBe('0.6');
    expect(errors).toEqual([undefined]);
  });

  it('reports one error and invokes no command when optimistic formatting fails', () => {
    const host = document.createElement('div');
    const formatFailure = new Error('optimistic format failed');
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    const setRate = vi.spyOn(binding, 'setRate');
    let fail = false;
    mountLfo(host, binding, {
      formatRate: (rate) => {
        if (fail) throw formatFailure;
        return `${rate.toFixed(2)} custom`;
      },
      onError: (error) => errors.push(error),
    });
    fail = true;

    setRange(input(host, 'rate'), '4');

    expect(setRate).not.toHaveBeenCalled();
    expect(input(host, 'rate').value).toBe('1');
    expect(host.querySelector('.wui-lfo__rate-value')?.textContent).toBe('1.00 custom');
    expect(errors).toEqual([formatFailure]);
  });

  it('keeps the latest same-kind command authoritative and silences stale settlements', async () => {
    const host = document.createElement('div');
    const first = deferred();
    const second = deferred();
    const errors = vi.fn();
    const binding = new FakeLfo();
    let command = 0;
    binding.setRate = () => (++command === 1 ? first.promise : second.promise);
    mountLfo(host, binding, {onError: errors});

    setRange(input(host, 'rate'), '2');
    setRange(input(host, 'rate'), '3');
    binding.state.rate = 3;
    second.resolve();
    await flushPromises();
    expect(input(host, 'rate').value).toBe('3');

    binding.state.rate = 2;
    first.reject(new Error('stale rate failure'));
    await flushPromises();
    expect(input(host, 'rate').value).toBe('3');
    expect(errors).not.toHaveBeenCalled();
  });

  it('tracks independent pending command kinds without one settlement reverting another', async () => {
    const host = document.createElement('div');
    const rateCommand = deferred();
    const depthCommand = deferred();
    const binding = new FakeLfo();
    binding.setRate = () => rateCommand.promise;
    binding.setDepth = () => depthCommand.promise;
    mountLfo(host, binding);

    setRange(input(host, 'rate'), '4');
    setRange(input(host, 'depth'), '0.8');
    expect(input(host, 'rate').value).toBe('4');
    expect(input(host, 'depth').value).toBe('0.8');

    binding.state.depth = 0.8;
    depthCommand.resolve();
    await flushPromises();
    expect(input(host, 'rate').value).toBe('4');
    expect(input(host, 'depth').value).toBe('0.8');

    binding.state.rate = 4;
    rateCommand.resolve();
    await flushPromises();
    expect(input(host, 'rate').value).toBe('4');
    expect(input(host, 'depth').value).toBe('0.8');
  });

  it('rolls back only the failed kind while another independent command stays optimistic', async () => {
    const host = document.createElement('div');
    const rateCommand = deferred();
    const depthCommand = deferred();
    const rateFailure = new Error('rate failed');
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    binding.setRate = () => rateCommand.promise;
    binding.setDepth = () => depthCommand.promise;
    mountLfo(host, binding, {onError: (error) => errors.push(error)});

    setRange(input(host, 'rate'), '4');
    setRange(input(host, 'depth'), '0.8');
    rateCommand.reject(rateFailure);
    await flushPromises();

    expect(input(host, 'rate').value).toBe('1');
    expect(input(host, 'depth').value).toBe('0.8');
    expect(errors).toEqual([rateFailure]);

    binding.state.depth = 0.8;
    depthCommand.resolve();
    await flushPromises();
    expect(input(host, 'rate').value).toBe('1');
    expect(input(host, 'depth').value).toBe('0.8');
  });

  it('updates from subscriptions and preserves the last-good frame after snapshot or formatter failures', () => {
    const host = document.createElement('div');
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    let failSnapshot = false;
    let failFormat = false;
    binding.snapshot = () => {
      if (failSnapshot) throw new Error('snapshot failed');
      return {...binding.state};
    };
    mountLfo(host, binding, {
      formatRate: (rate) => {
        if (failFormat) throw new Error('format failed');
        return `${rate.toFixed(3)} hz`;
      },
      onError: (error) => errors.push(error),
    });

    binding.state = {
      shape: 'saw',
      rate: 2.5,
      depth: 0.2,
      phase: 0.75,
      running: true,
    };
    binding.notify();
    expect(input(host, 'rate').value).toBe('2.5');
    expect(host.querySelector('.wui-lfo__rate-value')?.textContent).toBe('2.500 hz');
    expect(host.querySelector('.wui-lfo__head')?.getAttribute('x1')).toBe('75.0');
    const lastGoodCurve = host.querySelector('.wui-lfo__curve')?.getAttribute('points');

    failSnapshot = true;
    binding.notify();
    expect(input(host, 'rate').value).toBe('2.5');
    expect(host.querySelector('.wui-lfo__head')?.getAttribute('x1')).toBe('75.0');
    expect(host.querySelector('.wui-lfo__curve')?.getAttribute('points')).toBe(lastGoodCurve);

    failSnapshot = false;
    failFormat = true;
    binding.state.rate = 9;
    binding.state.phase = 0.1;
    binding.notify();
    expect(input(host, 'rate').value).toBe('2.5');
    expect(host.querySelector('.wui-lfo__head')?.getAttribute('x1')).toBe('75.0');
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'snapshot failed',
      'format failed',
    ]);
  });

  it('mounts a disabled safe frame and reports an initial snapshot failure', () => {
    const host = document.createElement('div');
    const failure = new Error('initial snapshot failed');
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    binding.snapshot = () => {
      throw failure;
    };

    const handle = mountLfo(host, binding, {onError: (error) => errors.push(error)});

    expect(host.contains(handle.element)).toBe(true);
    expect(handle.element.classList.contains('is-disabled')).toBe(true);
    expect(input(host, 'rate').value).toBe('1');
    expect(input(host, 'depth').value).toBe('0.6');
    expect(host.querySelector('[data-s="sine"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(errors).toEqual([failure]);
  });

  it('keeps the safe initial frame when a caller formatter throws', () => {
    const host = document.createElement('div');
    const failure = new Error('initial formatter failed');
    const errors: unknown[] = [];
    const binding = new FakeLfo();

    const handle = mountLfo(host, binding, {
      formatRate: () => {
        throw failure;
      },
      onError: (error) => errors.push(error),
    });

    expect(host.contains(handle.element)).toBe(true);
    expect(handle.element.classList.contains('is-disabled')).toBe(true);
    expect(input(host, 'rate').value).toBe('1');
    expect(host.querySelector('.wui-lfo__rate-value')?.textContent).toBe('1.00Hz');
    expect(errors).toEqual([failure]);
  });

  it('handles subscription setup failure and synchronous subscription notification', () => {
    const throwingHost = document.createElement('div');
    const subscribeFailure = new Error('subscribe failed');
    const errors: unknown[] = [];
    const throwingBinding = new FakeLfo();
    throwingBinding.state.rate = 3;
    throwingBinding.subscribe = () => {
      throw subscribeFailure;
    };
    mountLfo(throwingHost, throwingBinding, {onError: (error) => errors.push(error)});
    expect(input(throwingHost, 'rate').value).toBe('3');
    expect(errors).toEqual([subscribeFailure]);

    const notifyingHost = document.createElement('div');
    const notifyingBinding = new FakeLfo();
    const cleanup = vi.fn();
    notifyingBinding.subscribe = (notify) => {
      notifyingBinding.state.rate = 5;
      notify();
      return cleanup;
    };
    const handle = mountLfo(notifyingHost, notifyingBinding);
    expect(input(notifyingHost, 'rate').value).toBe('5');
    handle.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('mounts into an open shadow root and removes only presenter-owned nodes', () => {
    const element = document.createElement('div');
    const shadow = element.attachShadow({mode: 'open'});
    const marker = document.createElement('span');
    shadow.append(marker);
    const binding = new FakeLfo();

    const handle = mountLfo(shadow, binding);

    expect(shadow.contains(marker)).toBe(true);
    expect(shadow.contains(handle.element)).toBe(true);
    expect(shadow.querySelectorAll('.wui-lfo')).toHaveLength(1);
    expect(shadow.querySelectorAll('style[data-webmusic-ui="lfo"]')).toHaveLength(1);
    handle.destroy();
    expect(shadow.contains(marker)).toBe(true);
    expect(shadow.querySelector('.wui-lfo')).toBeNull();
    expect(shadow.querySelector('style[data-webmusic-ui="lfo"]')).toBeNull();
  });

  it('remounts one presenter per host, preserves caller DOM, and leaves old controls inert', () => {
    const host = document.createElement('div');
    const marker = document.createElement('span');
    host.append(marker);
    const firstBinding = new FakeLfo();
    const secondBinding = new FakeLfo();
    secondBinding.state.rate = 8;
    const first = mountLfo(host, firstBinding);
    const oldRun = first.element.querySelector<HTMLButtonElement>('.wui-lfo__run')!;
    const second = mountLfo(host, secondBinding);

    expect(host.contains(first.element)).toBe(false);
    expect(host.contains(second.element)).toBe(true);
    expect(host.contains(marker)).toBe(true);
    expect(host.querySelectorAll('.wui-lfo')).toHaveLength(1);
    expect(host.querySelectorAll('style[data-webmusic-ui="lfo"]')).toHaveLength(1);
    expect(input(host, 'rate').value).toBe('8');
    oldRun.click();
    expect(firstBinding.calls).toEqual([]);
    expect(secondBinding.calls).toEqual([]);
  });

  it('keeps a nested same-host remount authoritative when previous cleanup re-enters', () => {
    const host = document.createElement('div');
    const firstBinding = new FakeLfo();
    const outerBinding = new FakeLfo();
    outerBinding.state.rate = 4;
    const nestedBinding = new FakeLfo();
    nestedBinding.state.rate = 9;
    let nested: LfoHandle | undefined;
    firstBinding.subscribe = () => () => {
      nested = mountLfo(host, nestedBinding);
    };
    const first = mountLfo(host, firstBinding);

    const outer = mountLfo(host, outerBinding);

    expect(host.contains(first.element)).toBe(false);
    expect(host.contains(outer.element)).toBe(false);
    expect(host.contains(nested?.element ?? null)).toBe(true);
    expect(host.querySelectorAll('.wui-lfo')).toHaveLength(1);
    expect(host.querySelectorAll('style[data-webmusic-ui="lfo"]')).toHaveLength(1);
    expect(input(host, 'rate').value).toBe('9');
  });

  it('keeps a nested remount authoritative when an initial error callback re-enters', () => {
    const host = document.createElement('div');
    const outerBinding = new FakeLfo();
    const nestedBinding = new FakeLfo();
    const snapshotFailure = new Error('outer snapshot failed');
    nestedBinding.state.rate = 10;
    outerBinding.snapshot = () => {
      throw snapshotFailure;
    };
    let nested: LfoHandle | undefined;

    const outer = mountLfo(host, outerBinding, {
      onError: () => {
        nested = mountLfo(host, nestedBinding);
      },
    });

    expect(host.contains(outer.element)).toBe(false);
    expect(host.contains(nested?.element ?? null)).toBe(true);
    expect(host.querySelectorAll('.wui-lfo')).toHaveLength(1);
    expect(host.querySelectorAll('style[data-webmusic-ui="lfo"]')).toHaveLength(1);
    expect(input(host, 'rate').value).toBe('10');
  });

  it('rolls back listeners, subscription, ownership, and DOM after a mount-tail failure', () => {
    const host = document.createElement('div');
    const cleanup = vi.fn();
    const snapshotFailure = new Error('snapshot failed');
    const reportingFailure = new Error('reporting failed');
    const binding = new FakeLfo();
    binding.subscribe = () => cleanup;
    binding.snapshot = () => {
      throw snapshotFailure;
    };

    expect(() =>
      mountLfo(host, binding, {
        onError: () => {
          throw reportingFailure;
        },
      }),
    ).toThrow(reportingFailure);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-lfo')).toBeNull();
    expect(host.querySelector('style[data-webmusic-ui="lfo"]')).toBeNull();

    const replacement = mountLfo(host, new FakeLfo());
    expect(host.contains(replacement.element)).toBe(true);
    expect(host.querySelectorAll('.wui-lfo')).toHaveLength(1);
  });

  it('silences pending failures after destroy or replacement and swallows throwing async error reporters', async () => {
    const destroyedHost = document.createElement('div');
    const destroyedCommand = deferred();
    const destroyedErrors = vi.fn();
    const destroyedBinding = new FakeLfo();
    destroyedBinding.setRate = () => destroyedCommand.promise;
    const destroyed = mountLfo(destroyedHost, destroyedBinding, {onError: destroyedErrors});
    setRange(input(destroyedHost, 'rate'), '2');
    destroyed.destroy();
    destroyedCommand.reject(new Error('destroyed failure'));
    await flushPromises();
    expect(destroyedErrors).not.toHaveBeenCalled();
    expect(destroyedHost.querySelector('.wui-lfo')).toBeNull();

    const replacedHost = document.createElement('div');
    const replacedCommand = deferred();
    const replacedErrors = vi.fn();
    const firstBinding = new FakeLfo();
    firstBinding.setDepth = () => replacedCommand.promise;
    mountLfo(replacedHost, firstBinding, {onError: replacedErrors});
    setRange(input(replacedHost, 'depth'), '0.9');
    const replacement = mountLfo(replacedHost, new FakeLfo());
    replacedCommand.reject(new Error('replaced failure'));
    await flushPromises();
    expect(replacedErrors).not.toHaveBeenCalled();
    expect(replacedHost.contains(replacement.element)).toBe(true);

    const reporterHost = document.createElement('div');
    const reporterCommand = deferred();
    const reporterBinding = new FakeLfo();
    reporterBinding.setRunning = () => reporterCommand.promise;
    mountLfo(reporterHost, reporterBinding, {
      onError: () => {
        throw new Error('reporter failed');
      },
    });
    reporterHost.querySelector<HTMLButtonElement>('.wui-lfo__run')!.click();
    reporterCommand.reject(new Error('command failed'));
    await flushPromises();
  });

  it('consumes a contextual-void onError Promise rejection without an unhandled rejection', async () => {
    const host = document.createElement('div');
    const command = deferred();
    const reporter = deferred();
    const commandFailure = new Error('command rejected');
    const reporterFailure = new Error('async reporter rejected');
    const binding = new FakeLfo();
    const onError = vi.fn(() => reporter.promise);
    binding.setRate = () => command.promise;
    mountLfo(host, binding, {onError});

    setRange(input(host, 'rate'), '3');
    command.reject(commandFailure);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(commandFailure));
    expect(input(host, 'rate').value).toBe('1');

    reporter.reject(reporterFailure);
    await flushPromises();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('bounds re-entrant updates and reports non-stabilization once', () => {
    const host = document.createElement('div');
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    const owner: {handle?: LfoHandle} = {};
    let reenter = false;
    let snapshots = 0;
    binding.snapshot = () => {
      snapshots += 1;
      if (reenter) owner.handle?.update();
      return {...binding.state};
    };
    const handle = mountLfo(host, binding, {onError: (error) => errors.push(error)});
    owner.handle = handle;
    reenter = true;

    expect(() => handle.update()).not.toThrow();

    expect(snapshots).toBe(33);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('LFO update did not stabilize after 32 passes');
    expect(host.contains(handle.element)).toBe(true);
  });

  it('cleans listeners, subscription, nodes, and style exactly once even when cleanup reports an error', () => {
    const host = document.createElement('div');
    const marker = document.createElement('span');
    host.append(marker);
    const cleanupFailure = new Error('cleanup failed');
    const cleanup = vi.fn(() => {
      throw cleanupFailure;
    });
    const errors: unknown[] = [];
    const binding = new FakeLfo();
    binding.subscribe = () => cleanup;
    const handle = mountLfo(host, binding, {onError: (error) => errors.push(error)});
    const oldRun = handle.element.querySelector<HTMLButtonElement>('.wui-lfo__run')!;

    handle.destroy();
    handle.destroy();
    oldRun.click();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(errors).toEqual([cleanupFailure]);
    expect(binding.calls).toEqual([]);
    expect(host.contains(marker)).toBe(true);
    expect(host.querySelector('.wui-lfo')).toBeNull();
    expect(host.querySelector('style[data-webmusic-ui="lfo"]')).toBeNull();
  });
});
