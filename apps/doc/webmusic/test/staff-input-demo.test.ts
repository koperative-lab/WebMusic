// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {afterEach, describe, expect, it} from 'vitest';
import * as core from '../../../../packages/score/src/core';
import * as edit from '../../../../packages/score/src/edit/headless';
import * as view from '../../../../packages/score/src/view/headless';
import {mountDemos, type DemoScope} from '../src/components/demo-lifecycle';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/headless/StaffInputHeadlessDemo.astro'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)![1];
const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const registrations: Array<() => void> = [];

function mount() {
  document.body.innerHTML = `<section data-staff-input-demo>
    <p data-summary></p><ul data-notes></ul><p data-change></p><p data-hl-feedback></p>
    <select data-part><option value="piano">Piano</option></select>
    <input data-voice value="1"><input data-staff value="1"><input data-cursor value="0">
    <select data-duration><option value="1">1</option><option value="1/2">1/2</option></select>
    <select data-dots><option value="0">0</option><option value="1">1</option></select>
    <input data-octave value="4"><select data-alter><option value="0">Natural</option></select>
    <select data-pitch><option value="C">C</option></select><select data-selected></select>
    <input data-editable type="checkbox" checked>
    <button data-action="note">Insert note</button><button data-action="rest">Insert rest</button>
    <button data-action="delete">Delete selected</button><button data-action="undo">Undo</button>
    <button data-action="redo">Redo</button><button data-action="dispose">Dispose input</button>
  </section>`;
  let editor!: edit.ScoreEditor;
  let input!: view.StaffViewEditing;
  const modules: Record<string, unknown> = {
    '@webmusic/score': core,
    '@webmusic/score/edit/headless': {...edit, createScoreEditor: (...args: Parameters<typeof edit.createScoreEditor>) => editor = edit.createScoreEditor(...args)},
    '@webmusic/score/view/headless': {...view, createStaffViewEditing: (...args: Parameters<typeof view.createStaffViewEditing>) => input = view.createStaffViewEditing(...args)},
    '../demo-lifecycle': {mountDemos: (selector: string, setup: (root: HTMLElement, scope: DemoScope) => void) => registrations.push(mountDemos(selector, setup))},
  };
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, {});
  const field = (name: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-${name}]`)!;
  const type = (name: string, value: string): void => {
    field(name).value = value;
    field(name).dispatchEvent(new Event('input', {bubbles: true}));
  };
  const click = (action: string): void => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  return {editor, input, field, type, click};
}

afterEach(() => {
  for (const dispose of registrations.splice(0)) dispose();
  document.body.replaceChildren();
});

describe('Headless staff input demo pending fields', () => {
  it('preserves pending voice and cursor across unrelated redraws and applies them before insertion', () => {
    const {editor, input, field, type, click} = mount();
    click('note');
    expect(editor.getSnapshot().documentRevision).toBe(1);
    expect(input.state.onsetQuarters.toString()).toBe('1');
    type('voice', '2'); type('cursor', '0');
    input.setOctave(5);
    expect(field('voice').value).toBe('2');
    expect(field('cursor').value).toBe('0');
    click('rest');
    expect(editor.getSnapshot().documentRevision).toBe(2);
    expect(input.state.voice).toBe('2');
    expect(input.state.onsetQuarters.toString()).toBe('1');
    expect(field('voice').value).toBe('2');
    expect(field('cursor').value).toBe('1');
    expect([...editor.score.allNotes()].some(note => note.voice === '2' && note.rest && note.onsetQuarters.isZero())).toBe(true);
    expect(editor.score.notes.some(note => note.voice === '1' && note.pitch.toString() === 'C4')).toBe(true);
  });

  it('blocks insertion for invalid pending input without erasing it during another field change', () => {
    const {editor, input, field, type, click} = mount();
    type('voice', '2'); type('cursor', 'invalid');
    field('cursor').dispatchEvent(new Event('change', {bubbles: true}));
    input.setOctave(5);
    click('rest');
    expect(editor.getSnapshot().documentRevision).toBe(0);
    expect(field('cursor').value).toBe('invalid');
    expect(document.querySelector('[data-hl-feedback]')!.textContent).toContain('Use integer or fraction');
    type('cursor', '0'); click('rest');
    expect(editor.getSnapshot().documentRevision).toBe(1);
    expect(input.state.voice).toBe('2');
    expect(field('cursor').value).toBe('1');
  });
});
