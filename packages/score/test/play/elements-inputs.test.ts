// Plain-Node coverage for SSR-safe imports and the headless models behind the
// composed input elements. Browser DOM composition lives in
// element-composition.test.ts.
import {describe, expect, it, vi} from 'vitest';
import {
  DEFAULT_CHORDS,
  DEFAULT_TR808_GRID_MAP,
  NoteInputElement,
  QWERTY_GRID_COLS,
  QWERTY_GRID_KEYS,
  QWERTY_GRID_ROWS,
  QWERTY_KEY_MAP,
  defineNoteInputElement,
  gridIndexToRef,
  gridKeyboardMidi,
  gridPadIndex,
  gridPadMidi,
  gridQwertyCellMidi,
  gridRefToIndex,
  parseGridMap,
  qwertyMidi,
  qwertyOffsetIsBlack,
} from '../../src/play/element/note-input';
import {
  SynthPanelElement,
  defineSynthPanelElement,
  lfoWave,
  parseSections,
} from '../../src/play/element/synth-panel';

describe('input element SSR safety', () => {
  it('imports and constructs without DOM globals', async () => {
    expect(() => new NoteInputElement()).not.toThrow();
    expect(() => new SynthPanelElement()).not.toThrow();
    await expect(import('../../src/play/element/index')).resolves.toBeDefined();
  });

  it('registration helpers are no-ops without customElements', () => {
    expect(() => defineNoteInputElement()).not.toThrow();
    expect(() => defineSynthPanelElement()).not.toThrow();
  });
});

describe('note-input headless mapping', () => {
  it('maps the chromatic QWERTY row and octave anchor', () => {
    expect(qwertyMidi('KeyA', 60)).toBe(60);
    expect(qwertyMidi('KeyW', 60)).toBe(61);
    expect(qwertyMidi('Semicolon', 60)).toBe(76);
    expect(qwertyMidi('KeyQ', 60)).toBeNull();
    expect(Math.max(...Object.values(QWERTY_KEY_MAP))).toBe(16);
  });

  it('maps Launchpad cells and spreadsheet references', () => {
    expect(gridPadIndex(3, 10, 2, 0)).toBe(0);
    expect(gridPadIndex(3, 10, 0, 9)).toBe(29);
    expect(gridPadMidi(3, {midi: 42, label: 'HH'})).toBe(42);
    expect(gridQwertyCellMidi(48, 10, 'KeyA')).toBe(48);
    expect(gridIndexToRef(1, 0)).toBe('a1');
    expect(gridRefToIndex('Z10')).toBe(9);
  });

  it('parses sparse grid maps and resolves mapped keyboard input', () => {
    const pads = parseGridMap('a1=35,a2=26,z3=42');
    expect(pads[10]).toEqual({midi: 35, label: 'a1'});
    expect(pads[11]).toEqual({midi: 26, label: 'a2'});
    expect(pads[2]).toEqual({midi: 42, label: 'z3'});
    expect(gridKeyboardMidi(48, 'KeyA', pads, true)).toBe(35);
    expect(gridKeyboardMidi(48, 'KeyD', pads, true)).toBeNull();
    expect(parseGridMap(DEFAULT_TR808_GRID_MAP).filter(Boolean)).toHaveLength(17);
  });

  it('publishes the physical grid and default chord contracts', () => {
    expect([QWERTY_GRID_ROWS, QWERTY_GRID_COLS]).toEqual([3, 10]);
    expect(QWERTY_GRID_KEYS[0].map((key) => key.label).join('')).toBe('QWERTYUIOP');
    expect(qwertyOffsetIsBlack(1)).toBe(true);
    expect(DEFAULT_CHORDS[0]).toEqual({label: 'C', notes: [60, 64, 67]});
  });
});

describe('synth-panel headless contracts', () => {
  it('normalizes section lists', () => {
    expect(parseSections(null)).toEqual(['sound', 'effects']);
    expect(parseSections('Macros, envelope,macros')).toEqual(['macros', 'envelope']);
    expect(parseSections('unknown')).toEqual(['sound', 'effects']);
  });

  it('retains public aliases and applies assigned macros without DOM', () => {
    const panel = new SynthPanelElement();
    const params = [{name: 'volume', value: 0.5, min: 0, max: 1, apply: vi.fn()}];
    panel.params = params;
    expect(panel.sound).toBe(params);
    expect(panel.bands).toHaveLength(3);

    const apply = vi.fn();
    panel.macros = [{label: 'MORPH', value: 0.5, targets: [{min: 0, max: 1000, apply}]}];
    expect(apply).toHaveBeenCalledWith(500);
  });

  it('evaluates every LFO shape in its normalized range', () => {
    expect(lfoWave('sine', 0.25)).toBeCloseTo(1, 6);
    expect(lfoWave('triangle', 0.5)).toBe(-1);
    expect(lfoWave('square', 0.75)).toBe(-1);
    expect(lfoWave('saw', 0)).toBe(-1);
  });
});
