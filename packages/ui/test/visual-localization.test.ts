// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {createUILocalization} from '../src/localization';
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

describe('visual localization', () => {
  it('keeps a focused alternate while translating text and sends the current candidate', () => {
    const localization = createUILocalization();
    let state: NameplateState = {primary: {symbol: 'C'}, alternates: [{key: 'alt', symbol: 'Em/C', note: 'inversion'}]};
    const selectAlternate = vi.fn();
    const handle = mountNameplate(host(), {snapshot: () => state, selectAlternate}, {localization, motion: 'none'});
    const button = handle.element.querySelector('button')!;
    button.focus();
    state = {...state, alternates: [{key: 'alt', symbol: 'Em/C', note: '转位', weight: .25}]};
    localization.update({messages: {'harmony.chord': '和弦：{names}'}});
    expect(document.activeElement).toBe(button);
    expect(handle.element.querySelector('button')).toBe(button);
    expect(button.textContent).toBe('Em/C (转位)');
    expect(handle.element.getAttribute('aria-label')).toBe('和弦：C');
    button.click();
    expect(selectAlternate).toHaveBeenCalledWith(0, state.alternates![0]);
    handle.destroy();
  });

  it('refreshes default descriptions across retained visuals and releases localization observers', () => {
    const localization = createUILocalization();
    const subscribe = vi.spyOn(localization, 'subscribe');
    const snapshots = [vi.fn(() => ({marks: []})), vi.fn(() => ({marks: []}))] as const;
    const keyboard = mountKeyboard(host(), {snapshot: snapshots[0]!}, {localization, motion: 'none'});
    const staff = mountStaff(host(), {snapshot: snapshots[1]!}, {localization, motion: 'none'});
    const fretboard = mountFretboard(host(), {snapshot: () => ({marks: [], strings: 6, firstFret: 5})}, {localization, motion: 'none'});
    const wheel = mountWheel(host(), {snapshot: () => ({outer: [{id: 'a', label: 'A', weight: 1}]})}, {localization});
    const chips = mountChipStrip(host(), {snapshot: () => ({items: [{id: 'a', primary: 'A', start: 0, end: 1, occurrences: [0]}]})}, {localization});
    const flow = mountFlowLane(host(), {snapshot: () => ({bands: [], span: {start: 0, end: 4}, now: 0}), seek: () => {}}, {localization, motion: 'none'});
    localization.update({messages: {
      'pitch.keyboard': '键盘', 'pitch.staff': '谱表', 'pitch.fretboard': '指板', 'pitch.fret': '第{value}品',
      'harmony.wheel': '分布', 'harmony.readout': '读数', 'harmony.share': '{label}占{value}',
      'harmony.occurrences': '{count}次', 'harmony.flowLane': '进度', 'harmony.position': '位置',
    }, formatters: {percent: value => `百分之${value * 100}`}});
    expect(keyboard.element.getAttribute('aria-label')).toBe('键盘');
    expect(staff.element.getAttribute('aria-label')).toBe('谱表');
    expect(fretboard.element.getAttribute('aria-label')).toBe('指板');
    expect(fretboard.element.textContent).toContain('第5品');
    expect(wheel.element.getAttribute('aria-label')).toBe('分布');
    expect(wheel.index.textContent).toContain('A占百分之100');
    expect(chips.element.textContent).toContain('1次');
    expect(flow.element.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('位置');
    const count = snapshots[0]!.mock.calls.length;
    [keyboard, staff, fretboard, wheel, chips, flow].forEach(view => view.destroy());
    localization.update({messages: {}});
    expect(snapshots[0]).toHaveBeenCalledTimes(count);
    expect(subscribe).toHaveBeenCalledTimes(6);
  });

  it('updates a workbench name while retaining its focused tab and child slot', () => {
    const localization = createUILocalization();
    const handle = mountWorkbench(host(), {snapshot: () => ({views: [{id: 'one', label: 'One'}], activeViewId: 'one', docks: [], phase: 'idle'})}, {localization, motion: 'none'});
    const tab = handle.element.querySelector<HTMLButtonElement>('[role="tab"]')!;
    const stage = handle.stage;
    tab.focus();
    localization.update({messages: {'workbench.views': '视图'}});
    expect(document.activeElement).toBe(tab);
    expect(handle.stage).toBe(stage);
    expect(handle.element.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('视图');
    handle.destroy();
  });

  it('passes the actual share to percent formatters rather than a pre-rounded percentage', () => {
    const percent = vi.fn(value => `${(value * 100).toFixed(1)}%`);
    const localization = createUILocalization({formatters: {percent}});
    const view = mountWheel(host(), {snapshot: () => ({outer: [{id: 'a', label: 'A', weight: 1}, {id: 'b', label: 'B', weight: 2}]})}, {localization});
    expect(view.index.textContent).toContain('A 33.3%');
    expect(percent).toHaveBeenCalledWith(1 / 3);
    view.destroy();
  });

  it('keeps machine slider values numeric, refreshes its name, and restores borrowed attributes', () => {
    const localization = createUILocalization();
    const element = host();
    const handle = mountSurfaceSlider(element, {snapshot: () => ({minimum: 0, maximum: 1, value: .25}), commit: () => {}, valueAt: () => .25}, {localization});
    element.focus();
    localization.update({messages: {'stage.value': '数值'}, formatters: {number: value => String(value).replace('.', ',')}});
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

  it.each(['message', 'formatter'] as const)('does not restore stale ARIA after a %s callback replaces the borrowed surface', kind => {
    const localization = createUILocalization();
    const element = host();
    const binding = {snapshot: () => ({minimum: 0, maximum: 1, value: .25}), commit: vi.fn(), valueAt: () => .25};
    const previous = mountSurfaceSlider(element, binding, {localization});
    let replacement: ReturnType<typeof mountSurfaceSlider> | undefined;
    const replace = (): string => {
      replacement = mountSurfaceSlider(element, binding, {label: 'Replacement', formatValue: () => 'replacement value'});
      return 'stale text';
    };
    localization.update(kind === 'message'
      ? {messages: {'stage.value': replace}}
      : {formatters: {number: replace}});
    expect(element.getAttribute('aria-label')).toBe('Replacement');
    expect(element.getAttribute('aria-valuetext')).toBe('replacement value');
    previous.destroy();
    expect(element.getAttribute('role')).toBe('slider');
    replacement?.destroy();
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(element.hasAttribute('aria-valuetext')).toBe(false);
  });
});
