// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountEnvelope, type EnvelopeText} from '../src/envelope';
import {mountEq, type EqText} from '../src/eq';
import {mountLfo, type LfoText} from '../src/lfo';
import {mountMinimap, type MinimapText} from '../src/minimap';
import {mountNoteSurface, type NoteSurfaceState, type NoteSurfaceText} from '../src/note';
import {mountStatus, type StatusState, type StatusText} from '../src/status';
import {mountTimeline, type TimelineState, type TimelineText} from '../src/timeline';

const mounts: Array<{destroy(): void}> = [];
function host() { const node = document.createElement('div'); document.body.append(node); return node; }
function keep<T extends {destroy(): void}>(handle: T): T { mounts.push(handle); return handle; }
afterEach(() => {
  for (const handle of mounts.splice(0)) handle.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('live text on parameter and navigation presenters', () => {
  it('updates envelope names and values without replacing focused ranges or localizing machine values', () => {
    let text: EnvelopeText = {};
    const handle = keep(mountEnvelope(host(), {
      snapshot: () => ({envelope: {attack: 0.15, decay: 0.25, sustain: 0.5, release: 0.3}, ranges: {attackMax: 2, decayMax: 2, releaseMax: 2}}), setEnvelope: vi.fn(),
    }, {getText: () => text, formatters: {number: value => `N${value}`, percent: value => `P${value}`}}));
    const attack = handle.element.querySelector<HTMLInputElement>('[data-stage="attack"]')!;
    attack.focus();
    text = {label: 'Hüllkurve', attack: 'Anstieg', seconds: ({value}) => `${value} Sekunden`,
      secondsShort: ({value}) => `${value} Sek`, readout: ({attack, decay, sustain, release}) => `${attack} / ${decay} / ${sustain} / ${release}`};
    expect(attack.getAttribute('aria-label')).toBe('Attack');
    handle.update();
    expect(document.activeElement).toBe(attack);
    expect(handle.element.getAttribute('aria-label')).toBe('Hüllkurve');
    expect(attack.getAttribute('aria-label')).toBe('Anstieg');
    expect(attack.getAttribute('aria-valuetext')).toBe('N0.15 Sekunden');
    expect(attack.value).toBe('0.15');
    expect(handle.element.textContent).toContain('N0.15 Sek / N0.25 Sek / P0.5');
  });

  it('updates EQ band ARIA in place and preserves application content in the empty-state handle', () => {
    let text: EqText = {};
    const handle = keep(mountEq(host(), {
      snapshot: () => ({bands: [{frequency: 440, gain: -2}], ready: false}), setBand: vi.fn(),
    }, {getText: () => text, formatters: {number: value => `N${value}`}}));
    const frequency = handle.element.querySelector<HTMLInputElement>('[data-axis="frequency"]')!;
    frequency.focus();
    const value = frequency.value;
    handle.emptyElement().replaceChildren(document.createElement('code'));
    const ownedByCaller = handle.emptyElement().firstChild;
    text = {label: 'Égaliseur', bandFrequency: ({index}) => `Fréquence ${index}`, hertz: ({value}) => `${value} Hertz local`,
      frequency: 'fréquence', focusedBand: ({axis, index, value}) => `${axis} ${index} : ${value}`};
    handle.update();
    expect(document.activeElement).toBe(frequency);
    expect(frequency.value).toBe(value);
    expect(frequency.getAttribute('aria-label')).toBe('Fréquence N1');
    expect(frequency.getAttribute('aria-valuetext')).toBe('N440 Hertz local');
    expect(handle.emptyElement().firstChild).toBe(ownedByCaller);
    expect(handle.element.textContent).toContain('fréquence N1');
  });

  it('updates LFO controls, wave names and both visible and spoken values in place', () => {
    let text: LfoText = {};
    const number = vi.fn(() => 'unused');
    const handle = keep(mountLfo(host(), {
      snapshot: () => ({shape: 'sine', rate: 2, depth: 0.5, phase: 0, running: false}),
      setRunning: vi.fn(), setShape: vi.fn(), setRate: vi.fn(), setDepth: vi.fn(),
    }, {getText: () => text, formatters: {number, percent: fraction => `${fraction * 100} pour cent`}, formatRate: (rate) => `explicit ${rate}`}));
    const rate = handle.controls.rateInput;
    rate.focus();
    text = {label: 'Oscillateur', rate: 'Vitesse', depth: 'Profondeur', run: 'Démarrer', shape: 'Forme', sine: 'Sinus'};
    handle.update();
    expect(document.activeElement).toBe(rate);
    expect(rate.getAttribute('aria-label')).toBe('Vitesse');
    expect(rate.getAttribute('aria-valuetext')).toBe('explicit 2');
    expect(handle.controls.rateValue.textContent).toBe('explicit 2');
    expect(number).not.toHaveBeenCalled();
    expect(handle.controls.depthInput.getAttribute('aria-valuetext')).toBe('50 pour cent');
    expect(handle.controls.run.getAttribute('aria-label')).toBe('Démarrer');
    expect(handle.controls.shapes.querySelector('[aria-label="Sinus"]')).not.toBeNull();
  });

  it.each(['formatRate', 'formatDepth'] as const)('keeps the LFO safe fallback localized when %s throws', (formatter) => {
    const failure = new Error('caller formatter failed');
    const onError = vi.fn();
    const text: LfoText = {hertz: ({value}) => `${value} Hertz local`};
    const handle = keep(mountLfo(host(), {
      snapshot: () => ({shape: 'sine', rate: 2, depth: 0.5, phase: 0, running: false}),
      setRunning: vi.fn(), setShape: vi.fn(), setRate: vi.fn(), setDepth: vi.fn(),
    }, {getText: () => text, formatters: {number: value => `N${value}`, percent: value => `P${value}`}, onError, [formatter]: () => { throw failure; }}));
    expect(onError).toHaveBeenCalledWith(failure);
    expect(handle.controls.rateInput.disabled).toBe(true);
    expect(handle.controls.rateValue.textContent).toBe('N1 Hertz local');
    expect(handle.controls.rateInput.getAttribute('aria-valuetext')).toBe('N1 Hertz local');
    expect(handle.controls.depthValue.textContent).toBe('P0.6');
    expect(handle.controls.depthInput.getAttribute('aria-valuetext')).toBe('P0.6');
  });

  it('updates minimap range language while keeping focus and numeric ARIA attributes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let text: MinimapText = {};
    const handle = keep(mountMinimap(host(), {
      snapshot: () => ({minimum: 0, maximum: 10, start: 2, end: 6}), draw: vi.fn(), setRange: vi.fn(),
    }, {getText: () => text, formatters: {number: value => `N${value}`}}));
    handle.brush.focus();
    text = {label: 'Bereich', range: ({start, end}) => `von ${start} bis ${end}`};
    handle.update();
    expect(document.activeElement).toBe(handle.brush);
    expect(handle.brush.getAttribute('aria-label')).toBe('Bereich');
    expect(handle.brush.getAttribute('aria-valuetext')).toBe('von N2 bis N6');
    expect(handle.brush.getAttribute('aria-valuenow')).toBe('2');
    expect(handle.brush.getAttribute('aria-valuemax')).toBe('10');
  });

  it('keeps caller status messages authoritative and translates only defaults', () => {
    let text: StatusText = {};
    let state: StatusState = {kind: 'loading'};
    const handle = keep(mountStatus(host(), {snapshot: () => state}, {getText: () => text}));
    const node = handle.message;
    text = {loading: 'Chargement…', error: 'Échec'};
    handle.update();
    expect(handle.message).toBe(node);
    expect(node.textContent).toBe('Chargement…');
    state = {kind: 'error', message: 'Specific application diagnosis'};
    handle.update();
    text = {error: 'Anderer Fehler'};
    handle.update();
    expect(node.textContent).toBe('Specific application diagnosis');
    expect(handle.element.getAttribute('role')).toBe('alert');
  });

  it('keeps a focused, held chord when translated data labels and language change', () => {
    let text: NoteSurfaceText = {};
    let state: NoteSurfaceState = {layout: 'chords', keyboard: true, chords: [{index: 7, label: 'Major', midis: [60, 64]}]};
    const setNote = vi.fn();
    const handle = keep(mountNoteSurface(host(), {snapshot: () => state, interaction: {setNote}}, {getText: () => text}));
    const root = handle.element;
    const button = root.querySelector<HTMLButtonElement>('button')!;
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(setNote.mock.calls).toEqual([[60, true], [64, true]]);
    state = {...state, chords: [{index: 7, label: 'Dur', midis: [60, 64]}]};
    text = {hint: 'Spielen mit Tastatur', start: 'Hier starten'};
    handle.update();
    expect(handle.element).toBe(root);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('Dur');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('Spielen mit Tastatur');
    expect(root.textContent).toContain('Hier starten');
    expect(setNote.mock.calls).toEqual([[60, true], [64, true]]);
    button.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', bubbles: true}));
    expect(setNote.mock.calls.slice(2)).toEqual([[60, false], [64, false]]);
  });

  it('updates piano and grid labels without rebuilding their musical surfaces', () => {
    let text: NoteSurfaceText = {};
    let state: NoteSurfaceState = {layout: 'piano', piano: [{midi: 60, black: false, left: 0, width: 100, label: 'C'}]};
    const handle = keep(mountNoteSurface(host(), {snapshot: () => state}, {getText: () => text}));
    const key = handle.board!.firstElementChild;
    const viewport = handle.element.querySelector<HTMLElement>('[part="viewport"]')!;
    viewport.focus();
    state = {...state, piano: [{...state.piano![0], label: 'Do'}]};
    text = {keyboard: 'Clavier'};
    handle.update();
    expect(handle.board!.firstElementChild).toBe(key);
    expect(key!.textContent).toBe('Do');
    expect(document.activeElement).toBe(viewport);
    expect(viewport.getAttribute('aria-label')).toBe('Clavier');
    state = {layout: 'grid', grid: [{midi: 60, code: 'KeyA', ref: 'C'}]};
    handle.update();
    const cell = handle.board!.firstElementChild;
    state.grid = [{midi: 60, code: 'KeyA', ref: 'Do'}];
    handle.update();
    expect(handle.board!.firstElementChild).toBe(cell);
    expect(cell!.textContent).toBe('Do');
  });

  it('relabels timeline controls and cached ruler values without detaching a focused region', () => {
    let text: TimelineText = {};
    let prefix = '';
    const state: TimelineState = {duration: 8, playhead: 2, regions: [{id: 'a', start: 0, end: 4}]};
    const selectRegion = vi.fn();
    const handle = keep(mountTimeline(host(), {snapshot: () => state, seek: vi.fn(), selectRegion}, {getText: () => text, formatters: {number: value => `${prefix}${value}`}}));
    const button = handle.regionElement('a')!;
    button.focus();
    const region = vi.fn(({id}: {id: string; start: number; end?: number}) => `Bereich ${id}`);
    text = {label: 'Zeitleiste', playhead: ({label}) => `Position in ${label}`, region};
    prefix = 'N';
    expect(handle.ruler.textContent).not.toContain('N');
    handle.update();
    expect(handle.regionElement('a')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('Bereich a');
    expect(handle.seek.getAttribute('aria-label')).toBe('Position in Zeitleiste');
    expect(handle.seek.getAttribute('aria-valuetext')).toBe('N2');
    expect(handle.ruler.textContent).toContain('N');
    expect(region).toHaveBeenCalledWith({id: 'a', start: 0, end: 4});
    state.regions![0].label = 'Application translation';
    handle.update();
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('Application translation');
    button.click();
    expect(selectRegion).toHaveBeenCalledWith('a', {additive: false});
  });

  it.each([false, true])('reads display input once per paint, even on failure (%s), and ignores updates after destruction', (fails) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const failure = new Error('display input failed');
    const onError = vi.fn();
    const getText = vi.fn(() => { if (fails) throw failure; return {}; });
    const snapshots = vi.fn(() => ({}));
    const options = {getText, onError};
    const handles = [
      mountEnvelope(host(), {snapshot: () => { snapshots(); return {envelope: {attack: 0, decay: 0, sustain: 1, release: 0}, ranges: {attackMax: 2, decayMax: 2, releaseMax: 2}}; }, setEnvelope: vi.fn()}, options),
      mountEq(host(), {snapshot: () => { snapshots(); return {bands: []}; }, setBand: vi.fn()}, options),
      mountLfo(host(), {snapshot: () => { snapshots(); return {shape: 'sine', rate: 1, depth: 0, phase: 0, running: false}; }, setRate: vi.fn(), setDepth: vi.fn(), setShape: vi.fn(), setRunning: vi.fn()}, options),
      mountMinimap(host(), {snapshot: () => { snapshots(); return {minimum: 0, maximum: 1}; }, draw: vi.fn()}, options),
      mountNoteSurface(host(), {snapshot: () => { snapshots(); return {layout: 'grid'}; }}, options),
      mountStatus(host(), {snapshot: () => { snapshots(); return {kind: 'empty'}; }}, options),
      mountTimeline(host(), {snapshot: () => { snapshots(); return {duration: 1, regions: []}; }}, options),
    ];
    getText.mockClear();
    onError.mockClear();
    for (const handle of handles) handle.update();
    expect(getText).toHaveBeenCalledTimes(7);
    expect(onError).toHaveBeenCalledTimes(fails ? 7 : 0);
    for (const handle of handles) { handle.destroy(); handle.destroy(); }
    snapshots.mockClear();
    getText.mockClear();
    for (const handle of handles) handle.update();
    expect(snapshots).not.toHaveBeenCalled();
    expect(getText).not.toHaveBeenCalled();
  });
});
