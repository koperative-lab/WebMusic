// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadScore} from '@webmusic/score/io';
import {afterEach, describe, expect, it} from 'vitest';
import {mountDemos} from '../src/components/demo-lifecycle';
import {mountAnalysisSessionDemo, mountLiveTrackersDemo, mountScoreWindowDemo} from '../src/components/headless/analysis-view-playgrounds-client';
import type {DemoScope} from '../src/components/demo-lifecycle';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../public/midi/Arabesque No.1.mid');
const source = (await loadScore(readFileSync(file), {format: 'midi'})).withMetadata({title: 'Arabesque No. 1'});
const cleanups: Array<() => void> = [];
let id = 0;
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); document.body.replaceChildren(); });

function setup<T>(html: string, mount: (root: HTMLElement, scope: DemoScope) => T) {
  const root = document.createElement('div');
  root.dataset.testDemo = String(++id);
  root.innerHTML = `${html}<p data-hl-feedback hidden></p>`;
  document.body.append(root);
  let handle!: T;
  const dispose = mountDemos(`[data-test-demo="${id}"]`, (root, scope) => { handle = mount(root, scope); });
  cleanups.push(dispose);
  const change = (selector: string, value: string, event = 'change'): void => {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event(event, {bubbles: true}));
  };
  return {root, handle, change, dispose};
}

describe('Headless analysis and score-window live demos', () => {
  it('edits immutable scores through the same session and stops after disposal', () => {
    const {root, handle, dispose} = setup(`
      <p data-session-summary></p><div data-session-notes></div><div data-session-chords></div><p data-session-detail></p>
      <button data-session-edit>Edit first note</button>`, (root, scope) => mountAnalysisSessionDemo(root, scope, source));
    const original = handle.model;
    const originalScore = original.score;
    const edit = () => root.querySelector<HTMLButtonElement>('[data-session-edit]')!.click();
    edit();
    expect(handle.model).toBe(original);
    expect(original.score).not.toBe(originalScore);
    expect(original.score.parts[0].notes[0].pitch?.toString()).toBe('D5');
    expect(root.querySelector('[data-session-notes]')?.textContent).toContain('D5');
    expect(root.querySelector('[data-session-summary]')?.textContent).toContain('1 score update');
    edit();
    expect(original.score.parts[0].notes[0].pitch?.toString()).toBe('E5');
    expect(root.querySelector('[data-session-summary]')?.textContent).toContain('2 score updates');
    dispose();
    const after = handle.model.score;
    edit();
    expect(handle.model.score).toBe(after);
  });

  it('feeds real held chords and heard-note key analysis, preserves history on release and resets on disposal', () => {
    const {root, handle, dispose} = setup(`
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
    press('[data-live-release]');
    press('[data-live-midi]');
    expect(root.querySelector('[data-live-midi]')?.getAttribute('aria-pressed')).toBe('true');
    dispose();
    const before = root.textContent;
    press('[data-live-preset="C"]');
    handle.chord.noteOn(67);
    expect(root.textContent).toBe(before);
    expect(handle.key.heard).toBe(0);
  });

  it('renders the viewport candidates and local active notes, then disposes the view on unmount', () => {
    const {root, handle, change, dispose} = setup(`
      <input data-window-position type="range" min="0" max="2" step=".05" value="0" />
      <p data-window-summary></p><div data-window-lane></div><p data-window-time></p><div data-window-active></div>`, (root, scope) => mountScoreWindowDemo(root, scope, source));
    expect(handle.model.state.viewport).toEqual({startTime: 0, endTime: 2});
    expect(handle.model.state.visibleNotes.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('[data-window-note]').length).toBeGreaterThan(0);
    change('[data-window-position]', '1.25', 'input');
    expect(handle.model.state.currentTime).toBe(1.25);
    expect(root.querySelector('[data-window-time]')?.textContent).toContain('1.25s');
    dispose();
    expect(() => handle.model.seek(1)).toThrow('disposed');
    const before = root.textContent;
    change('[data-window-position]', '1', 'input');
    expect(root.textContent).toBe(before);
  });
});
