// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountNoteSurface, noteStyle, pianoKeyLayout, PointerSurface, type NoteSurfaceState} from '../src/note';

function pointer(type: string, pointerId: number): Event {
  const event = new MouseEvent(type, {bubbles: true, clientX: 1, clientY: 1});
  Object.defineProperty(event, 'pointerId', {value: pointerId});
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountNoteSurface', () => {
  it('uses the active foreground on both piano key types without reading surface paint', () => {
    const host = document.createElement('div');
    host.style.setProperty('--wm-surface', 'transparent');
    host.style.setProperty('--wm-accent-foreground', '#fafafa');
    const handle = mountNoteSurface(host, {snapshot: () => ({
      layout: 'piano', piano: pianoKeyLayout(60, 61), activeMidis: [60, 61],
    })});
    expect(handle.element.querySelectorAll('.wui-note__key.down')).toHaveLength(2);
    const colorRule = noteStyle.match(/\.wui-note__key\.down \.wui-note__key-label\s*\{([^}]+)\}/)?.[1];
    expect(colorRule).toContain('--wm-note-label-active');
    expect(colorRule).toContain('--wm-accent-foreground');
    expect(colorRule).not.toContain('--wm-surface');
    handle.destroy();
  });

  it('keeps the full piano playable inside its scroll viewport without replacing held keys', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const setNote = vi.fn();
    const handle = mountNoteSurface(host, {
      snapshot: () => ({layout: 'piano', piano: pianoKeyLayout(21, 108)}),
      interaction: {setNote},
    });
    const viewport = handle.element.querySelector<HTMLElement>('[part="viewport"]')!;
    const board = handle.board!;
    const keys = board.querySelectorAll<HTMLElement>('[data-midi]');
    expect(keys).toHaveLength(88);
    expect(viewport.contains(board)).toBe(true);
    expect(viewport.tabIndex).toBe(0);
    expect(viewport.getAttribute('aria-label')).toBe('Note keyboard');
    let hit = keys[0];
    Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => hit});
    board.dispatchEvent(pointer('pointerdown', 1));
    host.style.width = '180px';
    viewport.scrollLeft = 1200;
    expect(handle.board).toBe(board);
    expect(hit.getAttribute('aria-pressed')).toBe('true');
    hit = keys[keys.length - 1];
    board.dispatchEvent(pointer('pointermove', 1));
    board.dispatchEvent(pointer('pointerup', 1));
    expect(setNote.mock.calls).toEqual([[21, true], [21, false], [108, true], [108, false]]);
    handle.destroy();
  });

  it('scrolls the grid from its QWERTY focus without releasing a held mapped note', () => {
    const host = document.createElement('div');
    const setNote = vi.fn();
    const handle = mountNoteSurface(host, {
      snapshot: () => ({layout: 'grid', keyboard: true, gridColumns: 10, grid: [{midi: 36, code: 'KeyA', ref: 'A1'}]}),
      interaction: {setNote, midiForKey: (code) => code === 'KeyA' ? 36 : null},
    });
    const root = handle.element;
    const viewport = root.querySelector<HTMLElement>('[part="viewport"]')!;
    expect(root.tabIndex).toBe(0);
    expect(viewport.hasAttribute('tabindex')).toBe(false);
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'ArrowRight', bubbles: true}));
    expect(viewport.scrollLeft).toBe(80);
    expect(setNote.mock.calls).toEqual([[36, true]]);
    expect(root.querySelector('[data-midi="36"]')?.getAttribute('aria-pressed')).toBe('true');
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'ArrowLeft', bubbles: true}));
    expect(viewport.scrollLeft).toBe(0);
    root.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA', bubbles: true}));
    expect(setNote.mock.calls).toEqual([[36, true], [36, false]]);
    handle.destroy();
  });

  it('paints active MIDI pitches and clears them on update', () => {
    const host = document.createElement('div');
    let state: NoteSurfaceState = {
      layout: 'grid',
      grid: [{midi: 60}, {midi: 61}],
      activeMidis: [61],
    };
    const handle = mountNoteSurface(host, {snapshot: () => state});

    expect(host.querySelector<HTMLElement>('[data-midi="60"]')?.classList.contains('down')).toBe(false);
    expect(host.querySelector('[data-midi="60"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector<HTMLElement>('[data-midi="61"]')?.classList.contains('down')).toBe(true);
    expect(host.querySelector('[data-midi="61"]')?.getAttribute('aria-pressed')).toBe('true');

    state = {...state, activeMidis: [60]};
    handle.update();
    expect(host.querySelector<HTMLElement>('[data-midi="60"]')?.classList.contains('down')).toBe(true);
    expect(host.querySelector('[data-midi="61"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('owns chord pointer/key holding, pressed ARIA, and overlapping note ref-counts', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const setNote = vi.fn();
    const handle = mountNoteSurface(host, {
      snapshot: () => ({
        layout: 'chords',
        chords: [{label: 'C', index: 0, midis: [60, 64, 67]}],
      }),
      interaction: {setNote},
    });
    const chord = handle.element.querySelector<HTMLButtonElement>('.wui-note__chord')!;

    chord.dispatchEvent(pointer('pointerdown', 1));
    expect(chord.classList.contains('down')).toBe(true);
    expect(chord.getAttribute('aria-pressed')).toBe('true');
    expect(setNote.mock.calls).toEqual([[60, true], [64, true], [67, true]]);

    chord.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', code: 'Space', bubbles: true}));
    chord.dispatchEvent(new KeyboardEvent('keyup', {key: ' ', code: 'Space', bubbles: true}));
    expect(setNote).toHaveBeenCalledTimes(3);
    expect(chord.getAttribute('aria-pressed')).toBe('true');

    chord.dispatchEvent(pointer('pointerup', 1));
    expect(setNote.mock.calls.slice(-3)).toEqual([[60, false], [64, false], [67, false]]);
    expect(chord.classList.contains('down')).toBe(false);
    expect(chord.getAttribute('aria-pressed')).toBe('false');
  });

  it('owns QWERTY focus, pressed state, blur cleanup, and octave requests', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const setNote = vi.fn();
    const requestOctaveShift = vi.fn();
    const handle = mountNoteSurface(host, {
      snapshot: () => ({
        layout: 'grid',
        keyboard: true,
        grid: [{midi: 60, code: 'KeyA'}],
      }),
      interaction: {
        setNote,
        midiForKey: (code) => code === 'KeyA' ? 60 : null,
        requestOctaveShift,
      },
    });
    const root = handle.element;
    const cell = root.querySelector<HTMLElement>('[data-code="KeyA"]')!;
    root.focus();
    expect(root.classList.contains('on')).toBe(true);

    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true, cancelable: true}));
    expect(cell.classList.contains('down')).toBe(true);
    expect(cell.getAttribute('aria-pressed')).toBe('true');
    root.blur();
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
    expect(cell.classList.contains('down')).toBe(false);
    expect(root.classList.contains('on')).toBe(false);

    root.focus();
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyX', bubbles: true, cancelable: true}));
    expect(requestOctaveShift).toHaveBeenCalledWith(1);
  });

  it('plays mapped Z/X cells instead of shifting a map-only grid', () => {
    const host = document.createElement('div');
    const setNote = vi.fn();
    const requestOctaveShift = vi.fn();
    const handle = mountNoteSurface(host, {
      snapshot: () => ({
        layout: 'grid',
        keyboard: true,
        mapOnly: true,
        grid: [{midi: 36, code: 'KeyX'}],
      }),
      interaction: {
        setNote,
        midiForKey: (code) => code === 'KeyX' ? 36 : null,
        requestOctaveShift,
      },
    });
    const root = handle.element;
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyX', bubbles: true, cancelable: true}));
    root.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyX', bubbles: true, cancelable: true}));
    expect(setNote.mock.calls).toEqual([[36, true], [36, false]]);
    expect(requestOctaveShift).not.toHaveBeenCalled();
  });

  it('does not release held notes when an octave request is already bounded', () => {
    const host = document.createElement('div');
    const setNote = vi.fn();
    const requestOctaveShift = vi.fn();
    const handle = mountNoteSurface(host, {
      snapshot: () => ({layout: 'piano', keyboard: true}),
      interaction: {
        setNote,
        midiForKey: (code) => code === 'KeyA' ? 60 : null,
        canShiftOctave: () => false,
        requestOctaveShift,
      },
    });
    const root = handle.element;
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyX', bubbles: true}));
    expect(setNote.mock.calls).toEqual([[60, true]]);
    expect(requestOctaveShift).not.toHaveBeenCalled();
    handle.releaseAll();
    expect(setNote).toHaveBeenLastCalledWith(60, false);
  });

  it('preserves held input across ordinary updates and releases it on destroy', () => {
    const host = document.createElement('div');
    const setNote = vi.fn();
    const binding = {
      snapshot: (): NoteSurfaceState => ({
        layout: 'piano',
        keyboard: true,
        piano: [{midi: 60, left: 0, width: 100}],
      }),
      interaction: {
        setNote,
        midiForKey: (code: string) => code === 'KeyA' ? 60 : null,
      },
    };
    const handle = mountNoteSurface(host, binding);
    handle.element.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    handle.update();
    expect(setNote.mock.calls).toEqual([[60, true]]);

    handle.element.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    handle.destroy();
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
  });

  it('preserves QWERTY focus, DOM and local holds through synchronous store notifications', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let state: NoteSurfaceState = {layout: 'grid', keyboard: true, grid: [{midi: 60, code: 'KeyA'}]};
    let notify = (): void => {};
    const setNote = vi.fn((midi: number, on: boolean) => {
      state = {...state, activeMidis: on ? [midi] : []};
      notify();
    });
    const handle = mountNoteSurface(host, {
      snapshot: () => state,
      interaction: {setNote, midiForKey: () => 60},
      subscribe: (update) => { notify = update; return () => {}; },
    });
    const root = handle.element;
    const cell = root.querySelector('[data-midi="60"]');
    root.focus();
    root.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    state = {...state, activeMidis: [], octaveLabel: 'Octave 4'};
    notify();
    expect(handle.element).toBe(root);
    expect(root.querySelector('[data-midi="60"]')).toBe(cell);
    expect(document.activeElement).toBe(root);
    expect(root.classList.contains('on')).toBe(true);
    expect(cell?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.wui-note__octave')?.textContent).toBe('Octave 4');
    expect(setNote.mock.calls).toEqual([[60, true]]);
    root.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA', bubbles: true}));
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
    expect(cell?.getAttribute('aria-pressed')).toBe('false');
    handle.destroy();
  });

  it('keeps a pointer held across updates and preserves externally active paint after release', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let state: NoteSurfaceState = {layout: 'piano', piano: pianoKeyLayout(60, 62)};
    const setNote = vi.fn();
    const handle = mountNoteSurface(host, {snapshot: () => state, interaction: {setNote}});
    const board = handle.board!;
    const key = board.querySelector<HTMLElement>('[data-midi="60"]')!;
    Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => key});
    board.dispatchEvent(pointer('pointerdown', 1));
    state = {...state, activeMidis: [60, 62]};
    handle.update();
    expect(handle.board).toBe(board);
    expect(setNote.mock.calls).toEqual([[60, true]]);
    board.dispatchEvent(pointer('pointerup', 1));
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
    expect(key.getAttribute('aria-pressed')).toBe('true');
    state = {...state, activeMidis: []};
    handle.update();
    expect(key.getAttribute('aria-pressed')).toBe('false');
    handle.destroy();
  });

  it('preserves a focused chord during updates and releases original pitches on an in-place mapping change', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const midis = [60, 64, 67];
    const state: NoteSurfaceState = {layout: 'chords', chords: [{index: 0, label: 'C', midis}]};
    const setNote = vi.fn();
    const handle = mountNoteSurface(host, {snapshot: () => state, interaction: {setNote}});
    const root = handle.element;
    const chord = root.querySelector<HTMLButtonElement>('button')!;
    chord.focus();
    chord.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true}));
    state.activeMidis = [...midis];
    handle.update();
    expect(handle.element).toBe(root);
    expect(document.activeElement).toBe(chord);
    expect(chord.getAttribute('aria-pressed')).toBe('true');
    expect(setNote.mock.calls).toEqual([[60, true], [64, true], [67, true]]);
    midis[0] = 72;
    handle.update();
    expect(handle.element).not.toBe(root);
    expect(setNote.mock.calls.slice(-3)).toEqual([[60, false], [64, false], [67, false]]);
    handle.destroy();
  });

  it('stops a chord press if a synchronous command destroys the presenter', () => {
    const host = document.createElement('div');
    const setNote = vi.fn((_midi: number, on: boolean) => { if (on) handle.destroy(); });
    const handle: ReturnType<typeof mountNoteSurface> = mountNoteSurface(host, {
      snapshot: () => ({layout: 'chords', chords: [{index: 0, label: 'C', midis: [60, 64, 67]}]}),
      interaction: {setNote},
    });
    handle.element.querySelector('button')!.dispatchEvent(pointer('pointerdown', 1));
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
    expect(host.children).toHaveLength(0);
  });

  it('does not overwrite a replacement mounted during structural note-off cleanup', () => {
    const host = document.createElement('div');
    let state: NoteSurfaceState = {layout: 'piano', keyboard: true, piano: pianoKeyLayout(60, 61)};
    let replacement: ReturnType<typeof mountNoteSurface> | undefined;
    const setNote = vi.fn((_midi: number, on: boolean) => {
      if (!on) replacement = mountNoteSurface(host, {snapshot: () => ({layout: 'grid', grid: [{midi: 72}]})});
    });
    const handle = mountNoteSurface(host, {snapshot: () => state, interaction: {setNote, midiForKey: () => 60}});
    handle.element.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    state = {...state, piano: pianoKeyLayout(72, 73)};
    handle.update();
    expect(host.querySelectorAll('.wui-note')).toHaveLength(1);
    expect(host.querySelector('.wui-note')).toBe(replacement?.element);
    expect(host.querySelector('.wui-note__grid')).not.toBeNull();
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
    replacement?.destroy();
  });

  it('does not start a note after its mapping callback destroys the mount', () => {
    const host = document.createElement('div');
    const setNote = vi.fn();
    const handle: ReturnType<typeof mountNoteSurface> = mountNoteSurface(host, {
      snapshot: () => ({layout: 'piano', keyboard: true}),
      interaction: {setNote, midiForKey: () => { handle.destroy(); return 60; }},
    });
    handle.element.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    expect(setNote).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
  });

  it('does not resume a pointer glide after its note-off callback destroys the mount', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const setNote = vi.fn((_midi: number, on: boolean) => { if (!on) handle.destroy(); });
    const handle: ReturnType<typeof mountNoteSurface> = mountNoteSurface(host, {
      snapshot: () => ({layout: 'piano', piano: pianoKeyLayout(60, 62)}),
      interaction: {setNote},
    });
    const board = handle.board!;
    let hit = board.querySelector<HTMLElement>('[data-midi="60"]')!;
    Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => hit});
    board.dispatchEvent(pointer('pointerdown', 1));
    hit = board.querySelector<HTMLElement>('[data-midi="62"]')!;
    board.dispatchEvent(pointer('pointermove', 1));
    expect(setNote.mock.calls).toEqual([[60, true], [60, false]]);
    expect(host.children).toHaveLength(0);
  });

  it('releases a subscription returned after a synchronous notification remounts its host', () => {
    const host = document.createElement('div');
    const cleanup = vi.fn();
    let replace = false;
    let replacement: ReturnType<typeof mountNoteSurface> | undefined;
    const snapshot = (): NoteSurfaceState => {
      if (replace) {
        replace = false;
        replacement = mountNoteSurface(host, {snapshot: () => ({layout: 'grid'})});
      }
      return {layout: 'piano'};
    };
    mountNoteSurface(host, {
      snapshot,
      subscribe: (notify) => { replace = true; notify(); return cleanup; },
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.wui-note')).toHaveLength(1);
    expect(host.querySelector('.wui-note')).toBe(replacement?.element);
    replacement?.destroy();
  });

  it.each(['document', 'shadow'] as const)('keeps QWERTY highlights inside their own piano in a shared %s root', (kind) => {
    const container = document.createElement('div');
    document.body.append(container);
    const scope = kind === 'shadow' ? container.attachShadow({mode: 'open'}) : container;
    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');
    scope.append(firstHost, secondHost);
    const firstNotes = vi.fn();
    const secondNotes = vi.fn();
    const snapshot = (): NoteSurfaceState => ({
      layout: 'piano',
      keyboard: true,
      piano: [{midi: 60, left: 0, width: 100}],
    });
    const first = mountNoteSurface(firstHost, {
      snapshot,
      interaction: {setNote: firstNotes, midiForKey: () => 60},
    });
    const second = mountNoteSurface(secondHost, {
      snapshot,
      interaction: {setNote: secondNotes, midiForKey: () => 60},
    });
    const firstKey = first.element.querySelector<HTMLElement>('[data-midi="60"]')!;
    const secondKey = second.element.querySelector<HTMLElement>('[data-midi="60"]')!;

    second.element.focus();
    second.element.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    expect(firstNotes).not.toHaveBeenCalled();
    expect(secondNotes.mock.calls).toEqual([[60, true]]);
    expect(firstKey.getAttribute('aria-pressed')).toBe('false');
    expect(secondKey.getAttribute('aria-pressed')).toBe('true');

    second.element.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA', bubbles: true}));
    expect(secondNotes.mock.calls).toEqual([[60, true], [60, false]]);
    expect(firstKey.getAttribute('aria-pressed')).toBe('false');
    expect(secondKey.getAttribute('aria-pressed')).toBe('false');
    first.destroy();
    second.destroy();
  });
});

describe('PointerSurface', () => {
  it('ref-counts pitches and elements and guarantees final note-off', () => {
    const board = document.createElement('div');
    const key = document.createElement('button');
    key.className = 'key';
    key.dataset.midi = '60';
    board.append(key);
    document.body.append(board);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => key),
    });
    const fire = vi.fn();
    const surface = new PointerSurface({
      root: () => document,
      keySelector: '.key',
      fire,
    });
    surface.attach(board);

    board.dispatchEvent(pointer('pointerdown', 1));
    board.dispatchEvent(pointer('pointerdown', 2));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(60, true);
    expect(key.classList.contains('down')).toBe(true);
    expect(key.getAttribute('aria-pressed')).toBe('true');

    board.dispatchEvent(pointer('pointerup', 1));
    expect(fire).toHaveBeenCalledTimes(1);
    expect(key.classList.contains('down')).toBe(true);

    surface.releaseAll();
    expect(fire).toHaveBeenLastCalledWith(60, false);
    expect(key.classList.contains('down')).toBe(false);
    expect(key.getAttribute('aria-pressed')).toBe('false');
    surface.detach();
  });

  it('supports drag glissando and reattaching without duplicate listeners', () => {
    const board = document.createElement('div');
    const first = document.createElement('button');
    first.className = 'key';
    first.dataset.midi = '60';
    const second = document.createElement('button');
    second.className = 'key';
    second.dataset.midi = '62';
    board.append(first, second);
    let hit: HTMLElement = first;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => hit),
    });
    const fire = vi.fn();
    const surface = new PointerSurface({root: () => document, keySelector: '.key', fire});
    surface.attach(board);
    surface.attach(board);

    board.dispatchEvent(pointer('pointerdown', 9));
    hit = second;
    board.dispatchEvent(pointer('pointermove', 9));
    board.dispatchEvent(pointer('pointerup', 9));

    expect(fire.mock.calls).toEqual([
      [60, true],
      [60, false],
      [62, true],
      [62, false],
    ]);
  });

  it('releases a captured drag outside its board without playing a neighboring board', () => {
    const board = document.createElement('div');
    const ownKey = document.createElement('button');
    ownKey.className = 'key';
    ownKey.dataset.midi = '60';
    board.append(ownKey);
    const neighbor = document.createElement('div');
    const otherKey = document.createElement('button');
    otherKey.className = 'key';
    otherKey.dataset.midi = '72';
    neighbor.append(otherKey);
    document.body.append(board, neighbor);
    let hit = ownKey;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => hit,
    });
    const fire = vi.fn();
    const surface = new PointerSurface({root: () => document, keySelector: '.key', fire});
    surface.attach(board);

    board.dispatchEvent(pointer('pointerdown', 1));
    hit = otherKey;
    // Captured events still arrive at the original board after crossing over.
    board.dispatchEvent(pointer('pointermove', 1));
    expect(fire.mock.calls).toEqual([[60, true], [60, false]]);
    expect(otherKey.classList.contains('down')).toBe(false);

    hit = ownKey;
    board.dispatchEvent(pointer('pointermove', 1));
    board.dispatchEvent(pointer('pointerup', 1));
    expect(fire.mock.calls).toEqual([[60, true], [60, false], [60, true], [60, false]]);
    surface.detach();
  });
});
