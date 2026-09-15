// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {mountDemos} from '../src/components/demo-lifecycle';
import {mountAnalysisSessionDemo, mountLiveTrackersDemo, mountScoreWindowDemo} from '../src/components/headless/analysis-view-playgrounds-client';
import type {DemoScope} from '../src/components/demo-lifecycle';

const cleanups: Array<() => void> = [];
let id = 0;
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); document.body.replaceChildren(); });

function setup<T>(html: string, mount: (root: HTMLElement, scope: DemoScope) => T) {
  const root = document.createElement('div');
  root.dataset.testDemo = String(++id);
  root.innerHTML = `${html}<p data-hl-feedback hidden></p><pre data-hl-readout></pre>`;
  document.body.append(root);
  let handle!: T;
  const dispose = mountDemos(`[data-test-demo="${id}"]`, (root, scope) => { handle = mount(root, scope); });
  cleanups.push(dispose);
  const change = (selector: string, value: string, event = 'change'): void => {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event(event, {bubbles: true}));
  };
  return {root, handle, change, dispose, reset: () => root.dispatchEvent(new CustomEvent('wm:headless-reset', {bubbles: true}))};
}

describe('Headless analysis and score-window live demos', () => {
  it('edits immutable scores through the same session, recreates fixed options and resets controls', () => {
    const {root, handle, change, reset, dispose} = setup(`
      <select data-session-score><option value="major">C</option><option value="minor">Am</option></select>
      <select data-session-pitch><option>A3</option><option selected>C4</option><option>F#4</option></select>
      <select data-session-window><option>1</option><option selected>2</option><option>4</option></select>
      <p data-session-summary></p><div data-session-notes></div><div data-session-chords></div><p data-session-detail></p>`, mountAnalysisSessionDemo);
    const original = handle.model;
    const originalScore = original.score;
    change('[data-session-pitch]', 'F#4');
    expect(handle.model).toBe(original);
    expect(original.score).not.toBe(originalScore);
    expect(original.score.parts[0].notes[0].pitch?.toString()).toBe('F#4');
    expect(root.querySelector('[data-session-notes]')?.textContent).toContain('F#4');
    expect(root.querySelector('[data-hl-readout]')?.textContent).toContain("Pitch.parse('F#4')");
    change('[data-session-score]', 'minor');
    expect(handle.model).toBe(original);
    expect(original.score.metadata.title).toBe('A minor study');
    change('[data-session-window]', '1');
    expect(handle.model).not.toBe(original);
    expect(root.querySelector('[data-session-detail]')?.textContent).toContain('window 1 quarters');
    reset();
    expect(handle.model.score.metadata.title).toBe('C major study');
    expect(root.querySelector('[data-session-summary]')?.textContent).toContain('0 score updates');
    expect(root.querySelector('[data-hl-readout]')?.textContent).toContain('windowQuarters: 2');
    const resetModel = handle.model;
    dispose();
    change('[data-session-score]', 'minor');
    expect(handle.model).toBe(resetModel);
    expect(handle.model.score.metadata.title).toBe('C major study');
  });

  it('feeds real held chords and heard-note key analysis, preserves history on release and clears it on reset', () => {
    const {root, handle, reset, dispose} = setup(`
      <button data-live-midi="60" aria-pressed="false">C4</button><button data-live-preset="C">C</button>
      <button data-live-preset="G7">G7</button><button data-live-release>Release</button>
      <p data-live-chord></p><div data-live-notes></div><p data-live-key></p><div data-live-history></div>`, mountLiveTrackersDemo);
    const press = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();
    press('[data-live-preset="C"]');
    expect(handle.state.midis).toEqual([60, 64, 67]);
    expect(handle.key.heard).toBe(3);
    expect(root.querySelector('[data-live-notes]')?.textContent).toContain('C4');
    expect(root.querySelector('[data-live-key]')?.textContent).toContain('3 notes heard');
    const history = [...handle.state.history];
    press('[data-live-release]');
    expect(handle.state.midis).toEqual([]);
    // Releasing the pitches one by one also names the intermediate held sets.
    expect(handle.state.history.slice(0, history.length)).toEqual(history);
    expect(handle.key.heard).toBe(3);
    for (let index = 0; index < 10; index += 1) press(`[data-live-preset="${index % 2 ? 'C' : 'G7'}"]`);
    expect(handle.state.history).toHaveLength(8);
    expect(root.querySelector('[data-live-history]')?.children).toHaveLength(8);
    reset();
    expect(handle.state.midis).toEqual([]);
    expect(handle.state.history).toEqual([]);
    expect(handle.key.heard).toBe(0);
    expect(root.querySelector('[data-live-key]')?.textContent).toContain('no notes heard');
    press('[data-live-midi]');
    expect(root.querySelector('[data-live-midi]')?.getAttribute('aria-pressed')).toBe('true');
    expect(handle.key.heard).toBe(1);
    dispose();
    const before = root.textContent;
    press('[data-live-preset="C"]');
    handle.chord.noteOn(67);
    expect(root.textContent).toBe(before);
    expect(handle.key.heard).toBe(0);
  });

  it('renders actual viewport candidates and local active notes, then disposes replaced and unmounted views', () => {
    const {root, handle, change, reset, dispose} = setup(`
      <select data-window-viewport><option value="0">0–2</option><option value="2">2–4</option><option value="all">All</option></select>
      <input data-window-position type="range" min="0" max="4" step=".05" value="0" />
      <p data-window-summary></p><div data-window-lane></div><p data-window-time></p><div data-window-active></div>`, mountScoreWindowDemo);
    expect(handle.model.state.visibleNotes).toHaveLength(5);
    expect(root.querySelectorAll('[data-window-note]')).toHaveLength(4);
    expect(root.querySelector('[data-window-active]')?.textContent).toBe('C4');
    change('[data-window-viewport]', '2');
    change('[data-window-position]', '2.25', 'input');
    expect(handle.model.state.currentTime).toBe(2.25);
    expect(handle.model.state.viewport).toEqual({startTime: 2, endTime: 4});
    expect(root.querySelector('[data-window-active]')?.textContent).toBe('B4');
    expect(root.querySelector('[data-window-note][data-active="true"]')).not.toBeNull();
    change('[data-window-viewport]', 'all');
    expect(handle.model.state.visibleNotes).toHaveLength(8);
    expect(root.querySelectorAll('[data-window-note]')).toHaveLength(8);
    expect(root.querySelector('[data-hl-readout]')?.textContent).toContain('view.seek(2.25)');
    const old = handle.model;
    reset();
    expect(() => old.seek(1)).toThrow('disposed');
    expect(handle.model).not.toBe(old);
    expect(handle.model.state.viewport).toEqual({startTime: 0, endTime: 2});
    expect(handle.model.state.currentTime).toBe(0);
    dispose();
    expect(() => handle.model.seek(1)).toThrow('disposed');
    const before = root.textContent;
    change('[data-window-position]', '1', 'input');
    expect(root.textContent).toBe(before);
  });
});
