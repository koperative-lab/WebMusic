// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountEnvelope} from '../src/envelope';
import {mountMacro, mountMacroRack} from '../src/macro';
import {mountMeter} from '../src/meter';
import {mountSectionPanel} from '../src/panel';
import {mountCanvasStage, mountStage} from '../src/stage';
import {mountChipStrip, mountFlowLane, mountNameplate, mountWheel} from '../src/harmony';
import {mountFretboard, mountKeyboard, mountStaff} from '../src/pitch';
import {mountStatus} from '../src/status';
import {mountTimeline} from '../src/timeline';
import {createFader, faderStyle, transportStyle} from '../src/transport';
import {mountWorkbench} from '../src/workbench';

afterEach(() => vi.restoreAllMocks());

/**
 * A host that installs no stylesheet is the light-DOM case: a Web Component
 * rendering into its own page cannot inject kit CSS without it applying to the
 * whole document. Every presenter now takes the opt-out the transport had.
 */
const MOUNTS: ReadonlyArray<[string, (host: HTMLElement, stylesheet: boolean) => {destroy: () => void}]> = [
  [
    'envelope',
    (host, stylesheet) =>
      mountEnvelope(
        host,
        {
          snapshot: () => ({
            envelope: {attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.2},
            ranges: {attackMax: 2, decayMax: 2, releaseMax: 2},
          }),
          setEnvelope: vi.fn(),
        },
        {stylesheet},
      ),
  ],
  [
    'meter',
    (host, stylesheet) =>
      mountMeter(host, {readLevel: () => ({level: 0.5}), readSpectrum: () => [0.5]}, {stylesheet}),
  ],
  ['panel', (host, stylesheet) => mountSectionPanel(host, [{id: 'a', label: 'A'}], {stylesheet})],
  ['stage', (host, stylesheet) => mountStage(host, {render: vi.fn()}, {stylesheet})],
  ['status', (host, stylesheet) => mountStatus(host, {snapshot: () => ({kind: 'ready'})}, {stylesheet})],
  [
    'timeline',
    (host, stylesheet) =>
      mountTimeline(host, {snapshot: () => ({duration: 10, regions: []})}, {stylesheet}),
  ],
  [
    'keyboard',
    (host, stylesheet) =>
      mountKeyboard(host, {snapshot: () => ({marks: [{midi: 60, role: 'root'}]})}, {stylesheet}),
  ],
  [
    'staff',
    (host, stylesheet) =>
      mountStaff(
        host,
        {snapshot: () => ({marks: [{midi: 60, diatonic: 28, role: 'root'}]})},
        {stylesheet},
      ),
  ],
  [
    'fretboard',
    (host, stylesheet) =>
      mountFretboard(
        host,
        {snapshot: () => ({marks: [{stringIndex: 1, fret: 3, role: 'root'}]})},
        {stylesheet},
      ),
  ],
  [
    'flow-lane',
    (host, stylesheet) =>
      mountFlowLane(
        host,
        {snapshot: () => ({bands: [{id: 'a', start: 0, end: 4, primary: 'Am7', tone: 9}], now: 0})},
        {stylesheet},
      ),
  ],
  [
    'nameplate',
    (host, stylesheet) =>
      mountNameplate(host, {snapshot: () => ({primary: {symbol: 'Am7'}})}, {stylesheet}),
  ],
  [
    'chip-strip',
    (host, stylesheet) =>
      mountChipStrip(
        host,
        {snapshot: () => ({items: [{id: 'a', start: 0, end: 4, primary: 'C major', meter: 0.5}]})},
        {stylesheet},
      ),
  ],
  [
    'wheel',
    (host, stylesheet) =>
      mountWheel(
        host,
        {snapshot: () => ({outer: [{id: 'c', label: 'C', weight: 1}], needle: {at: 'c'}})},
        {stylesheet},
      ),
  ],
  [
    'workbench',
    (host, stylesheet) =>
      mountWorkbench(
        host,
        {
          snapshot: () => ({
            views: [{id: 'a', label: 'A'}],
            activeViewId: 'a',
            docks: [{id: 'b', label: 'B'}],
          }),
        },
        {stylesheet},
      ),
  ],
];

describe('the kit-wide stylesheet opt-out', () => {
  it.each(MOUNTS)('installs %s style by default and skips it on request', (_name, mount) => {
    const withSheet = document.createElement('div');
    const handle = mount(withSheet, true);
    const installed = withSheet.querySelector('style');
    expect(installed).not.toBeNull();
    // Every kit-owned sheet identifies itself, so a host can tell it apart.
    expect(installed?.dataset.webmusicUi).toBeTruthy();
    handle.destroy();

    const without = document.createElement('div');
    const opted = mount(without, false);
    expect(without.querySelector('style')).toBeNull();
    // The presenter still mounted: only the sheet is gone.
    expect(without.children.length).toBeGreaterThan(0);
    // And tearing down without a sheet must not throw.
    expect(() => opted.destroy()).not.toThrow();
    expect(without.children.length).toBe(0);
  });

  it('exports the transport stylesheet the opt-out tells callers to install', () => {
    // `stylesheet: false` documents "the caller must style these classes"; the
    // sheet lives in an unpublished module, so the transport entry re-exports it.
    expect(transportStyle).toContain('.wui-transport');
    expect(transportStyle).toContain('.wui-fader');
    expect(faderStyle).toContain('.wui-fader:focus-visible');

    const fader = createFader(document, {label: 'Volume', orientation: 'horizontal'});
    expect(fader.element.className).toBe('wui-fader wui-fader--horizontal');
    fader.destroy();
  });

  it.each([false, true])('keeps embedded harmony and pitch transparent with stylesheet:%s', (stylesheet) => {
    const shellHost = document.createElement('div');
    shellHost.style.setProperty('--wm-component-background', 'rgba(10, 20, 30, .4)');
    shellHost.style.setProperty('--wm-component-border', '3px dashed purple');
    shellHost.style.setProperty('--wm-component-radius', '12px');
    const shell = mountWorkbench(shellHost, {
      snapshot: () => ({views: [{id: 'a', label: 'A'}], activeViewId: 'a', docks: []}),
    }, {chrome: 'bare', stylesheet, parts: {frame: 'surface'}});
    expect(shell.element.querySelector('[part~=frame][part~=surface]')).not.toBeNull();
    const factories = [
      (node: HTMLElement) => mountKeyboard(node, {snapshot: () => ({marks: [{midi: 60}]})}, {stylesheet, surface: 'none'}),
      (node: HTMLElement) => mountStaff(node, {snapshot: () => ({marks: [{midi: 60, diatonic: 28}]})}, {stylesheet, surface: 'none'}),
      (node: HTMLElement) => mountFretboard(node, {snapshot: () => ({marks: [{stringIndex: 0, fret: 0}]})}, {stylesheet, surface: 'none'}),
      (node: HTMLElement) => mountFlowLane(node, {snapshot: () => ({bands: [{id: 'a', start: 0, end: 1, primary: 'A'}], now: 0})}, {stylesheet, surface: 'none'}),
      (node: HTMLElement) => mountNameplate(node, {snapshot: () => ({primary: {symbol: 'A'}})}, {stylesheet, surface: 'none'}),
      (node: HTMLElement) => mountChipStrip(node, {snapshot: () => ({items: [{id: 'a', start: 0, end: 1, primary: 'A'}]})}, {stylesheet, surface: 'none'}),
      (node: HTMLElement) => mountWheel(node, {snapshot: () => ({outer: [{id: 'a', label: 'A'}]})}, {stylesheet, surface: 'none'}),
    ];
    for (const mount of factories) {
      const node = document.createElement('div');
      shell.stage.append(node);
      const child = mount(node);
      for (const repaint of [() => {}, () => child.update()]) {
        repaint();
        expect(child.element.style.background).toBe('transparent');
        expect(child.element.style.border).toBe('0px');
        expect(child.element.style.padding).toBe('0px');
        expect(child.element.style.borderRadius).toBe('0');
      }
      child.destroy();
      node.remove();
    }
    shell.destroy();
    expect(shellHost.childElementCount).toBe(0);
  });

  it.each([false, true])('applies stylesheet:%s to every child in a macro rack', (stylesheet) => {
    const binding = {
      snapshot: () => ({label: 'Macro', value: 0.5, targets: []}),
      setValue: vi.fn(),
    };
    const host = document.createElement('div');
    const macro = mountMacro(host, binding, {stylesheet});
    expect([...host.querySelectorAll('style')].map((node) => node.dataset.webmusicUi))
      .toEqual(stylesheet ? ['macro', 'parameter'] : []);
    macro.destroy();

    const rack = mountMacroRack(host, [binding, binding], {stylesheet});
    expect([...host.querySelectorAll('style')].map((node) => node.dataset.webmusicUi))
      .toEqual(stylesheet ? ['macro-rack', 'macro', 'parameter', 'macro', 'parameter'] : []);
    const input = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = '0.75';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    expect(binding.setValue).toHaveBeenCalledWith(0.75);
    rack.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it.each([false, true])('applies stylesheet:%s to a canvas status overlay', (stylesheet) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const stage = mountCanvasStage(host, {
      draw: vi.fn(),
      status: () => ({kind: 'loading', message: 'Loading score'}),
    }, {stylesheet});
    expect([...host.querySelectorAll('style')].map((node) => node.dataset.webmusicUi))
      .toEqual(stylesheet ? ['stage', 'status'] : []);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading score');
    stage.destroy();
    expect(host.childElementCount).toBe(0);
  });
});
