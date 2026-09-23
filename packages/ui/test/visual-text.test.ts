// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountFlowLane, mountNameplate, mountChipStrip, mountWheel, type NameplateState} from '../src/harmony';
import {mountKeyboard, mountStaff, mountFretboard} from '../src/pitch';
import {mountWorkbench} from '../src/workbench';
import {mountSurfaceSlider} from '../src/stage';
import {createFader} from '../src/fader';

const host = (): HTMLElement => {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
};
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

interface VisualOptions {
  getText?: () => {description?: string};
  onError?: (error: unknown) => void;
}
interface VisualHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}
type Subscribe = (notify: () => void) => () => void;
const visualCases: readonly {
  name: string;
  mount(element: HTMLElement, options: VisualOptions, subscribe?: Subscribe): VisualHandle;
}[] = [
  {name: 'FlowLane', mount: (element, options, subscribe) => mountFlowLane(element, {snapshot: () => ({bands: [], now: 0}), subscribe}, {...options, motion: 'none'})},
  {name: 'Nameplate', mount: (element, options, subscribe) => mountNameplate(element, {snapshot: () => ({}), subscribe}, {...options, motion: 'none'})},
  {name: 'ChipStrip', mount: (element, options, subscribe) => mountChipStrip(element, {snapshot: () => ({items: []}), subscribe}, options)},
  {name: 'Wheel', mount: (element, options, subscribe) => mountWheel(element, {snapshot: () => ({outer: []}), subscribe}, options)},
  {name: 'Keyboard', mount: (element, options, subscribe) => mountKeyboard(element, {snapshot: () => ({marks: []}), subscribe}, {...options, motion: 'none'})},
  {name: 'Staff', mount: (element, options, subscribe) => mountStaff(element, {snapshot: () => ({marks: []}), subscribe}, {...options, motion: 'none'})},
  {name: 'Fretboard', mount: (element, options, subscribe) => mountFretboard(element, {snapshot: () => ({marks: []}), subscribe}, {...options, motion: 'none'})},
];

describe('external presentation inputs', () => {
  it.each(visualCases)('$name coalesces text-triggered updates and bounds an unsettled callback', ({mount}) => {
    let reenter = false;
    let repeat = false;
    let label = 'Initial';
    const onError = vi.fn();
    const getText = vi.fn(() => {
      const description = label;
      if (reenter) {
        reenter = repeat;
        label = 'Latest';
        handle?.update();
      }
      return {description};
    });
    const handle: VisualHandle = mount(host(), {getText, onError});
    getText.mockClear();
    reenter = true;
    handle.update();
    expect(getText).toHaveBeenCalledTimes(2);
    expect(handle.element.getAttribute('aria-label')).toBe('Latest');
    expect(onError).not.toHaveBeenCalled();

    getText.mockClear();
    reenter = repeat = true;
    handle.update();
    expect(getText.mock.calls.length).toBeLessThanOrEqual(40);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![0].message).toContain('update did not stabilize');
    repeat = reenter = false;
    label = 'Recovered';
    handle.update();
    expect(handle.element.getAttribute('aria-label')).toBe('Recovered');
    handle.destroy();
  });

  it.each(visualCases)('$name does not subscribe after an initial text callback replaces its host', ({mount}) => {
    const element = host();
    let replacement: VisualHandle | undefined;
    const subscribe = vi.fn(() => vi.fn());
    const previous = mount(element, {getText: () => {
      replacement = mount(element, {getText: () => ({description: 'Replacement'})});
      return {description: 'Stale'};
    }}, subscribe);
    expect(subscribe).not.toHaveBeenCalled();
    previous.update();
    previous.destroy();
    expect(replacement?.element.parentElement).toBe(element);
    expect(replacement?.element.getAttribute('aria-label')).toBe('Replacement');
    replacement?.destroy();
  });

  it.each(visualCases)('$name releases a late subscription after a text callback replaces its host', ({mount}) => {
    const element = host();
    let replacement: VisualHandle | undefined;
    let replace = false;
    let lateNotify: (() => void) | undefined;
    const stop = vi.fn();
    const getText = vi.fn(() => {
      if (replace) replacement = mount(element, {getText: () => ({description: 'Replacement'})});
      return {description: 'Stale'};
    });
    const previous = mount(element, {getText}, notify => {
      lateNotify = notify;
      replace = true;
      notify();
      return stop;
    });
    expect(stop).toHaveBeenCalledOnce();
    const reads = getText.mock.calls.length;
    lateNotify?.();
    previous.destroy();
    expect(getText).toHaveBeenCalledTimes(reads);
    expect(stop).toHaveBeenCalledOnce();
    expect(replacement?.element.parentElement).toBe(element);
    replacement?.destroy();
  });

  it.each(['FlowLane', 'Nameplate'] as const)('%s releases frame and clock resources when text replaces its host', name => {
    const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(37);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const mount = (element: HTMLElement, options: VisualOptions, subscribe?: Subscribe, clock?: NonNullable<Parameters<typeof mountNameplate>[2]>['clock']): VisualHandle => name === 'FlowLane'
      ? mountFlowLane(element, {snapshot: () => ({bands: [], now: 0}), subscribe}, {...options, motion: 'continuous', animate: true, clock})
      : mountNameplate(element, {snapshot: () => ({}), subscribe}, {...options, motion: 'continuous', animate: true, clock});
    const replaceStill = (element: HTMLElement): VisualHandle => name === 'FlowLane'
      ? mountFlowLane(element, {snapshot: () => ({bands: [], now: 0})}, {motion: 'none', animate: false, label: 'Replacement'})
      : mountNameplate(element, {snapshot: () => ({})}, {motion: 'none', animate: false, label: 'Replacement'});

    const initialHost = host();
    let initialReplacement: VisualHandle | undefined;
    const initial = mount(initialHost, {getText: () => {
      initialReplacement = replaceStill(initialHost);
      return {description: 'Stale'};
    }});
    expect(request).not.toHaveBeenCalled();
    initial.destroy();
    initialReplacement?.destroy();

    for (const useClock of [false, true]) {
      const element = host();
      let replacement: VisualHandle | undefined;
      let replace = false;
      const stopClock = vi.fn();
      const stopBinding = vi.fn();
      const clock = useClock ? {read: () => ({at: 0, now: 0, continuous: false}), subscribe: vi.fn(() => stopClock)} : undefined;
      const previous = mount(element, {getText: () => {
        if (replace) replacement = replaceStill(element);
        return {description: 'Stale'};
      }}, notify => {
        replace = true;
        notify();
        return stopBinding;
      }, clock);
      expect(stopBinding).toHaveBeenCalledOnce();
      if (useClock) expect(stopClock).toHaveBeenCalledOnce();
      else {
        expect(request).toHaveBeenCalledOnce();
        expect(cancel).toHaveBeenCalledWith(37);
      }
      previous.destroy();
      replacement?.destroy();
      request.mockClear();
      cancel.mockClear();
    }
  });

  it('keeps a focused alternate while translating text and sends the current candidate', () => {
    let translated = false;
    let state: NameplateState = {primary: {symbol: 'C'}, alternates: [{key: 'alt', symbol: 'Em/C', note: 'inversion'}]};
    const selectAlternate = vi.fn();
    const handle = mountNameplate(host(), {snapshot: () => state, selectAlternate}, {getText: () => ({description: translated ? ({names}) => `和弦：${names}` : undefined}), motion: 'none'});
    const button = handle.element.querySelector('button')!;
    button.focus();
    state = {...state, alternates: [{key: 'alt', symbol: 'Em/C', note: '转位', weight: .25}]};
    translated = true;
    handle.update();
    expect(document.activeElement).toBe(button);
    expect(handle.element.querySelector('button')).toBe(button);
    expect(button.textContent).toBe('Em/C (转位)');
    expect(handle.element.getAttribute('aria-label')).toBe('和弦：C');
    button.click();
    expect(selectAlternate).toHaveBeenCalledWith(0, state.alternates![0]);
    handle.destroy();
  });

  it('refreshes external text across retained visuals only when the application asks', () => {
    let translated = false;
    const snapshots = [vi.fn(() => ({marks: []})), vi.fn(() => ({marks: []}))] as const;
    const keyboard = mountKeyboard(host(), {snapshot: snapshots[0]!}, {getText: () => ({description: translated ? '键盘' : undefined}), motion: 'none'});
    const staff = mountStaff(host(), {snapshot: snapshots[1]!}, {getText: () => ({description: translated ? '谱表' : undefined}), motion: 'none'});
    const fretboard = mountFretboard(host(), {snapshot: () => ({marks: [], strings: 6, firstFret: 5})}, {getText: () => ({description: translated ? '指板' : undefined, fret: translated ? ({value}) => `第${value}品` : undefined}), motion: 'none'});
    const wheel = mountWheel(host(), {snapshot: () => ({outer: [{id: 'a', label: 'A', weight: 1}]})}, {
      getText: () => ({description: translated ? '分布' : undefined, share: translated ? ({label, value}) => `${label}占${value}` : undefined}),
      formatters: {percent: value => translated ? `百分之${value * 100}` : `${value * 100}%`},
    });
    const chips = mountChipStrip(host(), {snapshot: () => ({items: [{id: 'a', primary: 'A', start: 0, end: 1, occurrences: [0]}]})}, {getText: () => ({occurrences: translated ? ({count}) => `${count}次` : undefined})});
    const flow = mountFlowLane(host(), {snapshot: () => ({bands: [], span: {start: 0, end: 4}, now: 0}), seek: () => {}}, {getText: () => ({position: translated ? '位置' : undefined}), motion: 'none'});
    const views = [keyboard, staff, fretboard, wheel, chips, flow];
    translated = true;
    expect(keyboard.element.getAttribute('aria-label')).toBe('Sounding');
    views.forEach(view => view.update());
    expect(keyboard.element.getAttribute('aria-label')).toBe('键盘');
    expect(staff.element.getAttribute('aria-label')).toBe('谱表');
    expect(fretboard.element.getAttribute('aria-label')).toBe('指板');
    expect(fretboard.element.textContent).toContain('第5品');
    expect(wheel.element.getAttribute('aria-label')).toBe('分布');
    expect(wheel.index.textContent).toContain('A占百分之100');
    expect(chips.element.textContent).toContain('1次');
    expect(flow.element.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('位置');
    const count = snapshots[0]!.mock.calls.length;
    views.forEach(view => view.destroy());
    translated = false;
    views.forEach(view => view.update());
    expect(snapshots[0]).toHaveBeenCalledTimes(count);
  });

  it('updates a workbench name while retaining its focused tab and child slot', () => {
    let translated = false;
    const handle = mountWorkbench(host(), {snapshot: () => ({views: [{id: 'one', label: 'One'}], activeViewId: 'one', docks: [], phase: 'idle'})}, {getText: () => ({views: translated ? '视图' : undefined}), motion: 'none'});
    const tab = handle.element.querySelector<HTMLButtonElement>('[role="tab"]')!;
    const stage = handle.stage;
    tab.focus();
    translated = true;
    handle.update();
    expect(document.activeElement).toBe(tab);
    expect(handle.stage).toBe(stage);
    expect(handle.element.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('视图');
    handle.destroy();
  });

  it('passes the actual share to percent formatters rather than a pre-rounded percentage', () => {
    const percent = vi.fn(value => `${(value * 100).toFixed(1)}%`);
    const view = mountWheel(host(), {snapshot: () => ({outer: [{id: 'a', label: 'A', weight: 1}, {id: 'b', label: 'B', weight: 2}]})}, {formatters: {percent}});
    expect(view.index.textContent).toContain('A 33.3%');
    expect(percent).toHaveBeenCalledWith(1 / 3);
    view.destroy();
  });

  it('keeps machine slider values numeric, refreshes its name, and restores borrowed attributes', () => {
    let decimalComma = false;
    const element = host();
    const handle = mountSurfaceSlider(element, {snapshot: () => ({minimum: 0, maximum: 1, value: .25}), commit: () => {}, valueAt: () => .25}, {formatValue: value => decimalComma ? String(value).replace('.', ',') : String(value)});
    element.focus();
    decimalComma = true;
    handle.updateLabel('数值');
    handle.update();
    expect(document.activeElement).toBe(element);
    expect(element.getAttribute('aria-valuenow')).toBe('0.25');
    expect(element.getAttribute('aria-valuetext')).toBe('0,25');
    expect(element.getAttribute('aria-label')).toBe('数值');
    handle.destroy();
    expect(element.hasAttribute('aria-label')).toBe(false);
    const fader = createFader(document, {label: 'Volume', formatValue: value => `${value * 100} percent`});
    fader.updateLabel('音量'); fader.paint(.5);
    expect(fader.element.getAttribute('aria-valuetext')).toBe('50 percent');
    expect(fader.element.getAttribute('aria-label')).toBe('音量');
    fader.destroy();
    expect(fader.element.hasAttribute('aria-label')).toBe(false);
  });

  it('does not restore stale ARIA after a formatter replaces the borrowed surface', () => {
    let replaceOnFormat = false;
    const element = host();
    const binding = {snapshot: () => ({minimum: 0, maximum: 1, value: .25}), commit: vi.fn(), valueAt: () => .25};
    let replacement: ReturnType<typeof mountSurfaceSlider> | undefined;
    const previous = mountSurfaceSlider(element, binding, {formatValue: () => {
      if (replaceOnFormat) replacement = mountSurfaceSlider(element, binding, {label: 'Replacement', formatValue: () => 'replacement value'});
      return 'stale text';
    }});
    replaceOnFormat = true;
    previous.update();
    expect(element.getAttribute('aria-label')).toBe('Replacement');
    expect(element.getAttribute('aria-valuetext')).toBe('replacement value');
    previous.destroy();
    expect(element.getAttribute('role')).toBe('slider');
    replacement?.destroy();
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(element.hasAttribute('aria-valuetext')).toBe(false);
  });

  it('contains a failed external text read and cannot paint over a replacement', () => {
    const element = host();
    const onError = vi.fn();
    let fail = false;
    let replace = false;
    let replacement: ReturnType<typeof mountNameplate> | undefined;
    const view = mountNameplate(element, {snapshot: () => ({primary: {symbol: 'C'}})}, {
      motion: 'none', onError,
      getText: () => {
        if (fail) throw new Error('external text unavailable');
        if (replace) replacement = mountNameplate(element, {snapshot: () => ({primary: {symbol: 'D'}})}, {label: 'Replacement', motion: 'none'});
        return {description: 'External title'};
      },
    });
    fail = true;
    view.update();
    expect(view.element.getAttribute('aria-label')).toBe('Chord: C');
    expect(onError).toHaveBeenCalledOnce();
    fail = false; replace = true;
    view.update();
    view.destroy();
    expect(element.firstElementChild).not.toBe(view.element);
    expect(replacement?.element.getAttribute('aria-label')).toBe('Replacement');
    replacement?.destroy();
  });
});
