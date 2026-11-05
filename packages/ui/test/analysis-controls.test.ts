// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  analysisControlStyle, createAnalysisFader, setAnalysisStatus, setAnalysisStatusRegion,
} from '../src/internal/analysis-controls';

afterEach(() => document.body.replaceChildren());

describe('analysis fader unit mapping', () => {
  it('keeps threshold keyboard, pointer and accessible values in dBFS', () => {
    const onInput = vi.fn();
    const fader = createAnalysisFader(document, {
      label: 'Threshold', part: 'threshold', min: -60, max: 0, step: 1,
      value: -12, formatValue: (value) => `${value} dBFS`, onInput,
    });
    document.body.append(fader.element);
    const slider = fader.control;
    expect(slider.getAttribute('aria-valuemin')).toBe('-60');
    expect(slider.getAttribute('aria-valuenow')).toBe('-12');
    expect(slider.getAttribute('aria-valuetext')).toBe('-12 dBFS');
    expect(slider.querySelector('[part~="fader-fill"]')?.getAttribute('style')).toContain('width: 80%');
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'}));
    expect(onInput).toHaveBeenLastCalledWith(-11);
    expect(slider.getAttribute('aria-valuetext')).toBe('-11 dBFS');
    fader.paint(-30);
    expect(onInput).toHaveBeenCalledTimes(1);
    slider.getBoundingClientRect = () => new DOMRect(0, 0, 200, 24);
    slider.dispatchEvent(new MouseEvent('pointerdown', {clientX: 150, clientY: 12, button: 0, bubbles: true}));
    expect(onInput).toHaveBeenLastCalledWith(-15);
    expect(slider.getAttribute('aria-valuenow')).toBe('-15');
    fader.destroy();
    const calls = onInput.mock.calls.length;
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft'}));
    expect(onInput).toHaveBeenCalledTimes(calls);
  });

  it('uses updated timebase bounds and reaches an endpoint between steps', () => {
    const onInput = vi.fn();
    const fader = createAnalysisFader(document, {
      label: 'Timebase', part: 'timebase', min: 1, max: 100, step: .5,
      value: 10, formatValue: (value) => `${value.toFixed(1)} ms`, onInput,
    });
    document.body.append(fader.element);
    fader.paint(8, {max: 10.1});
    fader.control.dispatchEvent(new KeyboardEvent('keydown', {key: 'End'}));
    expect(onInput).toHaveBeenLastCalledWith(10.1);
    expect(fader.control.getAttribute('aria-valuemax')).toBe('10.1');
    expect(fader.control.getAttribute('aria-valuetext')).toBe('10.1 ms');
    fader.paint(.7, {min: .7, max: .7});
    expect(fader.control.getAttribute('aria-disabled')).toBe('true');
    expect(fader.value.textContent).toBe('0.7 ms');
    fader.control.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home'}));
    expect(onInput).toHaveBeenCalledTimes(1);
    fader.destroy();
  });
});

it('clears transport prose, announces informational state without drawing it, and shows only failures', () => {
  const status = document.createElement('div');
  for (const text of ['Live', 'Paused', 'Frozen', 'Playback paused', '']) {
    expect(setAnalysisStatus(status, text)).toBe('none');
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe('');
    expect(status.hasAttribute('data-analysis-quiet')).toBe(false);
  }
  for (const text of ['Waiting for playback', 'No signal', 'Listening', 'No matching edge', 'Loading audio']) {
    expect(setAnalysisStatus(status, text)).toBe('quiet');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(text);
    expect(status.hasAttribute('data-analysis-quiet')).toBe(true);
  }
  for (const text of ['Live analyser unavailable', 'Invalid player selector', 'The audio file could not be decoded']) {
    expect(setAnalysisStatus(status, text)).toBe('error');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(text);
    expect(status.hasAttribute('data-analysis-quiet')).toBe(false);
  }
  expect(analysisControlStyle).toMatch(/:where\(\[data-analysis-quiet\]\) \{ position: absolute;/);
});

it('keeps a pending region for the shared indicator and hides an informational one only visually', () => {
  const region = document.createElement('div');
  const message = document.createElement('span');
  region.append(message);
  setAnalysisStatusRegion(region, message, 'Waiting for playback', true);
  expect([region.hidden, region.hasAttribute('data-analysis-quiet'), message.textContent]).toEqual([false, false, '']);
  setAnalysisStatusRegion(region, message, 'No signal', false);
  expect([region.hidden, region.hasAttribute('data-analysis-quiet'), message.textContent]).toEqual([false, true, 'No signal']);
  setAnalysisStatusRegion(region, message, 'Analyser unavailable', false);
  expect([region.hidden, region.hasAttribute('data-analysis-quiet')]).toEqual([false, false]);
  setAnalysisStatusRegion(region, message, 'Live', false);
  expect(region.hidden).toBe(true);
});

it('lays analysis controls out as one hairline-separated row at the shared control height', () => {
  expect(analysisControlStyle).toContain('flex-wrap: nowrap');
  expect(analysisControlStyle).toContain('overflow-x: auto');
  expect(analysisControlStyle).toContain('scrollbar-width: none');
  expect(analysisControlStyle).toContain(':where(.wui-analysis-row > * + *) { border-left: 1px solid');
  expect(analysisControlStyle).toContain('var(--wm-analysis-control-height, var(--wm-control-size');
  expect(analysisControlStyle).not.toMatch(/1\.5rem|var\(--wm-accent, #444\)/);
  // Every rule keeps zero specificity so application CSS wins.
  const selectors = analysisControlStyle.replace(/\{[^}]*\}/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  expect(selectors.every((selector) => selector.startsWith(':where('))).toBe(true);
});
