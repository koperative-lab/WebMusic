// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {NoteInputElement} from '../../src/play/element/note-input';
import {SynthPanelElement} from '../../src/play/element/synth-panel';
import {Effect} from '../../src/play/headless/effects';

let tagCounter = 0;
function define(ctor: CustomElementConstructor, stem: string): string {
  const tag = `${stem}-${tagCounter++}`;
  customElements.define(tag, ctor);
  return tag;
}

function pointer(type: string, pointerId = 1): Event {
  const event = new Event(type, {bubbles: true, composed: true, cancelable: true});
  Object.assign(event, {pointerId, button: 0, clientX: 1, clientY: 1});
  return event;
}

afterEach(() => document.body.replaceChildren());

describe('<note-input> UI Kit composition', () => {
  const tag = define(NoteInputElement, 'score-note-composition');

  it('mounts the published note surface for every layout', () => {
    for (const layout of ['piano', 'grid', 'chords'] as const) {
      const element = document.createElement(tag);
      element.setAttribute('layout', layout);
      document.body.append(element);
      const root = element.shadowRoot!;
      expect(root.querySelector('.wui-note')).not.toBeNull();
      expect(root.querySelector(`.wui-note__${layout === 'chords' ? 'chords' : layout}`)).not.toBeNull();
      element.remove();
    }
  });

  it('routes presenter pointer activity through the shared PointerSurface', () => {
    const element = document.createElement(tag);
    element.setAttribute('start', '60');
    element.setAttribute('end', '60');
    const events: string[] = [];
    element.addEventListener('webscore:noteon', () => events.push('on'));
    element.addEventListener('webscore:noteoff', () => events.push('off'));
    document.body.append(element);
    const root = element.shadowRoot!;
    const key = root.querySelector<HTMLElement>('[data-midi="60"]')!;
    Object.assign(root, {elementFromPoint: () => key});
    const board = root.querySelector<HTMLElement>('.wui-note__piano')!;
    board.dispatchEvent(pointer('pointerdown'));
    expect(key.classList.contains('down')).toBe(true);
    board.dispatchEvent(pointer('pointerup'));
    expect(events).toEqual(['on', 'off']);
  });

  it('routes QWERTY mapping and commands through presenter-owned interaction', () => {
    const element = document.createElement(tag) as NoteInputElement;
    element.setAttribute('keyboard', '');
    element.setAttribute('start', '60');
    const onNote = vi.fn();
    element.onNote = onNote;
    document.body.append(element);
    const wrap = element.shadowRoot!.querySelector<HTMLElement>('.wui-note')!;
    wrap.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    wrap.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA', bubbles: true}));
    expect(onNote).toHaveBeenNthCalledWith(1, 60, 100, true);
    expect(onNote).toHaveBeenNthCalledWith(2, 60, 100, false);
  });

  it('lets the presenter own chord pointer/key pressed state and ARIA', () => {
    const element = document.createElement(tag) as NoteInputElement;
    element.setAttribute('layout', 'chords');
    const onNote = vi.fn();
    element.onNote = onNote;
    document.body.append(element);
    const chord = element.shadowRoot!.querySelector<HTMLButtonElement>('.wui-note__chord')!;

    chord.dispatchEvent(pointer('pointerdown', 7));
    expect(chord.classList.contains('down')).toBe(true);
    expect(chord.getAttribute('aria-pressed')).toBe('true');
    chord.dispatchEvent(pointer('pointerup', 7));
    expect(chord.getAttribute('aria-pressed')).toBe('false');
    expect(onNote.mock.calls).toEqual([
      [60, 100, true], [64, 100, true], [67, 100, true],
      [60, 100, false], [64, 100, false], [67, 100, false],
    ]);
  });

  it('releases held QWERTY notes before a presenter-requested octave update', () => {
    const element = document.createElement(tag) as NoteInputElement;
    element.setAttribute('keyboard', '');
    element.setAttribute('start', '60');
    const onNote = vi.fn();
    element.onNote = onNote;
    document.body.append(element);
    const first = element.shadowRoot!.querySelector<HTMLElement>('.wui-note')!;
    first.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    first.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyX', bubbles: true}));

    expect(onNote.mock.calls).toEqual([[60, 100, true], [60, 100, false]]);
    const shifted = element.shadowRoot!.querySelector<HTMLElement>('.wui-note')!;
    expect(shifted).not.toBe(first);
    shifted.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    expect(onNote).toHaveBeenLastCalledWith(72, 100, true);
  });
});

describe('<synth-panel> UI Kit composition', () => {
  const tag = define(SynthPanelElement, 'score-synth-composition');

  it('retains the working effect recipe and route after a failed property assignment', () => {
    const node = () => ({connect: vi.fn(), disconnect: vi.fn()}) as unknown as AudioNode;
    const context = {createGain: node} as unknown as AudioContext;
    const previousDispose = vi.fn();
    const previous = Effect.custom(() => ({input: node(), output: node(), dispose: previousDispose}));
    const pendingDispose = vi.fn();
    const pending = Effect.custom(() => ({input: node(), output: node(), dispose: pendingDispose}));
    const element = document.createElement(tag) as SynthPanelElement;
    element.setAttribute('sections', 'effects');
    element.effects = [previous];
    element.context = context;
    document.body.append(element);
    const input = element.input;
    expect(() => { element.effects = [pending, Effect.custom(() => {throw new Error('effect failed');})]; }).toThrow('effect failed');
    expect(element.effects).toEqual([previous]);
    expect(element.input).toBe(input);
    expect(previousDispose).not.toHaveBeenCalled();
    expect(pendingDispose).toHaveBeenCalledOnce();
    element.remove();
    expect(previousDispose).toHaveBeenCalledOnce();
  });

  it('does not shadow inherited theme tokens with legacy or UIKit color defaults', () => {
    const element = document.createElement(tag) as SynthPanelElement;
    element.sections = ['sound', 'envelope', 'eq', 'lfo', 'macros'];
    document.body.append(element);
    const style = element.shadowRoot!.querySelector<HTMLStyleElement>('style[data-webmusic-ui="panel"]')!.textContent!;
    // Host-level defaults would hide an application's inherited modern theme
    // before the legacy-to-UIKit fallback chains have a chance to resolve.
    expect(style).not.toMatch(/--synth-[\w-]+\s*:/);
    expect(style).not.toMatch(/--wm-(?:panel|envelope|eq|lfo)-[\w-]+\s*:/);
    expect(style).toContain('var(--synth-graph-bg, var(--wm-envelope-background');
    expect(style).toContain('var(--synth-graph, var(--wm-eq-curve, var(--wm-foreground-on-inverse');
    expect(style).toContain('var(--synth-bg, var(--wm-panel-background');
  });

  it('mounts every specialized presenter into compound panel-owned slots', () => {
    const element = document.createElement(tag) as SynthPanelElement;
    element.setAttribute('sections', 'sound,macros');
    element.sound = [{name: 'gain', value: 0.5, min: 0, max: 1, apply: vi.fn()}];
    element.macros = [{label: 'MORPH', value: 0.5, targets: []}];
    document.body.append(element);

    const root = element.shadowRoot!;
    expect(root.querySelector('.wui-section-panel')).not.toBeNull();
    expect(root.querySelector('style[data-webmusic-ui="panel"]')).not.toBeNull();
    expect([...root.querySelectorAll('.sec')].map((section) => [
      section.classList.contains('sec-sound'),
      section.classList.contains('sec-macros'),
    ])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(root.querySelector('.sound-host > .wui-parameter-rack')).not.toBeNull();
    expect(root.querySelector('.macros-host > .wui-macro-rack')).not.toBeNull();
    expect(root.querySelector('.wui-macro-rack__item > .wui-macro')).not.toBeNull();
    expect(root.querySelector('.sound-knob, .macro-knob')).toBeNull();

    const css = [...root.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('');
    // Read the shared outline at each consumer; a host-level legacy default
    // would hide an inherited application override before that chain resolves.
    expect(css).not.toContain('--synth-box-border:');
    expect(css).toContain('1px solid var(--synth-box-border, var(--wm-control-border, var(--wm-border, #d8d8d8)))');
    expect(css).toContain(
      'border-color: var(--synth-box-border, var(--wm-lfo-chip-border, var(--wm-control-border, var(--wm-border, #d8d8d8))))',
    );
    expect(css).not.toContain('border-color: var(--synth-thumb, var(--wm-lfo-chip-border');
  });
});
