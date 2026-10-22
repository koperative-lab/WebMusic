// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAnalysisFader, setAnalysisStatus} from '../src/internal/analysis-controls';

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

it('suppresses redundant transport prose while preserving failures and silence', () => {
  const status = document.createElement('div');
  for (const text of ['Live', 'Paused', 'Frozen', 'Playback paused']) {
    setAnalysisStatus(status, text);
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe('');
  }
  for (const text of ['Live analyser unavailable', 'Waiting for playback', 'No signal']) {
    setAnalysisStatus(status, text);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(text);
  }
});
