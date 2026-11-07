// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type ScoreEditOperation} from '../../src/core';
import {createScoreEditor, createScoreViewEditing, type ScoreEditor} from '../../src/view/headless';
import {SCORE_GRID_FEATURES, mountScoreGrid, parseScoreGridFeatures, type ScoreGridFeature} from '../../src/view/render/score-grid';
import {ScoreGridViewElement, type ScoreGridSettingsChangeDetail} from '../../src/view/element/score-grid-view';
import {ScorePlayerElement} from '../../src/play/element/score-player';

customElements.define('grid-test-view', ScoreGridViewElement);
customElements.define('grid-test-player', ScorePlayerElement);

const a = NoteId('a'); const b = NoteId('b'); const p = PartId('p');
function fixture() {
  const builder = new ScoreBuilder(); builder.addPart({id: p, name: 'Piano'});
  builder.addNote(p, {id: a, pitch: Pitch.fromMidi(60), onsetQuarters: Rational.ONE, duration: Duration.quarter(), voice: VoiceId('v'), velocityOverride: 60});
  builder.addNote(p, {id: b, pitch: Pitch.fromMidi(64), onsetQuarters: new Rational(3), duration: Duration.quarter(), voice: VoiceId('v'), velocityOverride: 90});
  return builder.build();
}
// Default geometry: a 48px key column, a 22px ruler, 64px per quarter, 16px rows from
// MIDI 84 (the fixture's computed upper bound) down to 48.
const X = (quarters: number, scale = 64) => 48 + quarters * scale;
const Y = (midi: number, row = 16) => 22 + (84 - midi) * row + row / 2;
const ROWS = 84 - 48 + 1;

function pointer(target: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const {pointerId = 1, ...init} = extra;
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init});
  Object.defineProperty(event, 'pointerId', {value: pointerId}); target.dispatchEvent(event); return event;
}
function drag(surface: Element, from: [number, number], to: [number, number], extra: Record<string, unknown> = {}) {
  pointer(surface, 'pointerdown', ...from, extra);
  pointer(surface, 'pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra);
  pointer(surface, 'pointermove', ...to, extra);
  pointer(surface, 'pointerup', ...to, extra);
}
function key(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...init}); target.dispatchEvent(event); return event;
}

const editors: ScoreEditor[] = [];
// `src`, `.score` and player-score resolution settle after a microtask; editor content draws synchronously.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function editorFor(score = fixture()): ScoreEditor { const editor = createScoreEditor(score); editors.push(editor); return editor; }
function grid(setup: (view: ScoreGridViewElement) => void = () => {}) {
  const editor = editorFor();
  const view = document.createElement('grid-test-view') as ScoreGridViewElement;
  view.editor = editor; view.editable = true; setup(view); document.body.append(view);
  const commits = vi.fn(); view.addEventListener('editcommit', commits);
  const surface = () => view.querySelector('[part="surface"]')!;
  const part = (name: string) => view.querySelector<HTMLElement>(`[part="${name}"]`)!;
  const groupOf = (control: Element) => control.closest<HTMLElement>('[role="group"]:not([part="toolbar"])')!;
  return {editor, view, commits, surface, part, groupOf};
}
afterEach(() => {
  document.body.replaceChildren();
  for (const editor of editors.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe('score grid rendering', () => {
  it('draws a fixed score as a passive grid with keys, ruler bars and notes but no toolbar', async () => {
    const view = document.createElement('grid-test-view') as ScoreGridViewElement;
    view.score = fixture(); document.body.append(view); await settle();
    const element = view.querySelector<HTMLElement>('[part="grid"]')!;
    const surface = view.querySelector('[part="surface"]')!;
    expect(element.dataset.editState).toBe('static');
    expect(view.querySelector<HTMLElement>('[part="toolbar"]')!.hidden).toBe(true);
    expect(view.querySelector<HTMLElement>('[part="note-properties"]')!.hidden).toBe(true);
    expect(surface.getAttribute('role')).toBe('img'); expect(surface.hasAttribute('tabindex')).toBe(false);
    expect(view.querySelectorAll('[data-key]')).toHaveLength(ROWS);
    expect(view.querySelector('[data-ruler]')).toBeTruthy();
    const bars = [...view.querySelectorAll('[data-bar]')];
    expect(bars.map((bar) => bar.getAttribute('data-bar')).slice(0, 2)).toEqual(['1', '2']);
    expect(bars[1].getAttribute('x1')).toBe(String(X(4)));
    const note = view.querySelector('[data-note-id="a"]')!;
    expect(note.getAttribute('x')).toBe(String(X(1)));
    expect(Number(note.getAttribute('y'))).toBeGreaterThanOrEqual(Y(60) - 8);
    expect(view.querySelectorAll('rect[data-note-id]')).toHaveLength(2);
    expect(view.hasAttribute('data-editable-state')).toBe(false);
    // A passive grid ignores pointer edits.
    drag(surface, [X(1) + 6, Y(60)], [X(2), Y(60)]);
    expect(view.querySelector('[data-note-id="a"]')!.getAttribute('x')).toBe(String(X(1)));
  });

  it('shows the toolbar only for an available, editable editor', () => {
    const {view, part} = grid();
    expect(view.getAttribute('data-editable-state')).toBe('ready');
    expect(part('grid').dataset.editState).toBe('ready');
    expect(part('toolbar').hidden).toBe(false);
    for (const name of ['tool-button', 'snap', 'lane-toggle', 'zoom-button', 'delete-button', 'history-button']) {
      expect(view.querySelector<HTMLElement>(`[part="${name}"]`)!.closest<HTMLElement>('[role="group"]')!.hidden).toBe(false);
    }
    expect(part('surface').getAttribute('tabindex')).toBe('0');
    view.editable = false;
    expect(view.getAttribute('data-editable-state')).toBe('readonly');
    expect(part('grid').dataset.editState).toBe('readonly');
    expect(part('toolbar').hidden).toBe(true);
  });

  it('falls back to select when an initial draw tool is not offered', () => {
    const editor = editorFor(); const editing = createScoreViewEditing(editor, {editable: true});
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountScoreGrid(host, {editing}, {tool: 'draw', features: ['move']});
    expect(handle.settings.tool).toBe('select'); expect(handle.element.dataset.tool).toBe('select');
    handle.dispose(); editing.dispose();
  });

  it('parses feature lists strictly and the element getter leniently', () => {
    expect(parseScoreGridFeatures('draw, move  history')).toEqual(['move', 'draw', 'history']);
    expect(parseScoreGridFeatures('')).toEqual([]);
    expect(() => parseScoreGridFeatures('move paint')).toThrow(RangeError);
    const view = document.createElement('grid-test-view') as ScoreGridViewElement;
    expect(view.tools).toEqual([...SCORE_GRID_FEATURES]);
    view.setAttribute('tools', 'move paint velocity');
    expect(view.tools).toEqual(['move', 'velocity']);
    expect(() => { view.tools = ['move', 'paint' as ScoreGridFeature]; }).toThrow(RangeError);
    expect(view.getAttribute('tools')).toBe('move paint velocity');
    view.tools = ['history', 'draw']; expect(view.getAttribute('tools')).toBe('draw history');
  });
});

describe('score grid feature gating', () => {
  const without = (feature: ScoreGridFeature) => (view: ScoreGridViewElement) => { view.tools = SCORE_GRID_FEATURES.filter((value) => value !== feature); };

  it('without move, a note drag only selects and arrow keys are inert', () => {
    const {editor, view, surface, commits} = grid(without('move'));
    drag(surface(), [X(1) + 6, Y(60)], [X(2), Y(62)]);
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([a]);
    expect(view.interactionSession!.getSnapshot().draft).toBeUndefined();
    for (const name of ['ArrowRight', 'ArrowUp']) expect(key(surface(), {key: name}).defaultPrevented).toBe(false);
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(commits).not.toHaveBeenCalled();
  });

  it('without resize, the right edge moves instead and Shift+Arrow is inert', () => {
    const {editor, view, surface} = grid(without('resize'));
    view.interactionSession!.setSelection([a]);
    expect(view.querySelector('[data-resize-handle]')).toBeNull();
    expect(key(surface(), {key: 'ArrowRight', shiftKey: true}).defaultPrevented).toBe(false);
    expect(editor.getSnapshot().documentRevision).toBe(0);
    drag(surface(), [X(2) - 2, Y(60)], [X(2) + 14, Y(60)]);
    expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('1');
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('5/4');
  });

  it('without draw, the tool group is hidden, draw reads as select and inserts are inert', () => {
    const {editor, view, surface, groupOf} = grid((value) => { without('draw')(value); value.tool = 'draw'; });
    expect(view.tool).toBe('select');
    expect(groupOf(view.querySelector('[part="tool-button"]')!).hidden).toBe(true);
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.tool).toBe('select');
    drag(surface(), [X(5), Y(64)], [X(6), Y(64)], {altKey: true});
    surface().dispatchEvent(new MouseEvent('dblclick', {clientX: X(6), clientY: Y(64), bubbles: true}));
    expect(key(surface(), {key: 'b'}).defaultPrevented).toBe(false);
    expect(view.getAttribute('tool')).toBe('draw');
    expect(editor.score.parts[0].notes).toHaveLength(2); expect(editor.getSnapshot().documentRevision).toBe(0);
  });

  it('without delete, the delete button is hidden, Delete is inert and the draw tool does not erase', () => {
    const {editor, view, surface, groupOf} = grid((value) => { without('delete')(value); value.tool = 'draw'; });
    expect(groupOf(view.querySelector('[part="delete-button"]')!).hidden).toBe(true);
    view.interactionSession!.setSelection([a]);
    for (const name of ['Delete', 'Backspace']) expect(key(surface(), {key: name}).defaultPrevented).toBe(false);
    pointer(surface(), 'pointerdown', X(3) + 6, Y(64)); pointer(surface(), 'pointerup', X(3) + 6, Y(64));
    expect(editor.score.getNote(a)).toBeDefined(); expect(editor.score.getNote(b)).toBeDefined();
    expect(editor.getSnapshot().documentRevision).toBe(0);
  });

  it('without velocity, the lane toggle is hidden and the lane never draws', () => {
    const {view, groupOf} = grid((value) => { without('velocity')(value); value.velocityLane = true; });
    expect(groupOf(view.querySelector('[part="lane-toggle"]')!).hidden).toBe(true);
    const lane = () => view.querySelector<HTMLElement>('[data-velocity-lane]')!;
    expect(lane().style.display).toBe('none');
    expect(view.querySelector('[data-velocity-note-id]')).toBeNull();
    view.tools = [...SCORE_GRID_FEATURES];
    expect(lane().style.display).toBe('flex');
    expect(view.querySelector('[data-velocity-note-id]')).toBeTruthy();
  });

  it('without snap or zoom, those groups are hidden and Ctrl+wheel is inert', () => {
    const {view, surface, groupOf} = grid((value) => { value.tools = ['move', 'resize', 'draw', 'delete', 'velocity', 'history']; });
    expect(groupOf(view.querySelector('[part="snap"]')!).hidden).toBe(true);
    expect(groupOf(view.querySelector('[part="zoom-button"]')!).hidden).toBe(true);
    const wheel = new WheelEvent('wheel', {deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true});
    surface().dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false); expect(view.pixelsPerQuarter).toBe(64);
    expect(view.hasAttribute('pixels-per-quarter')).toBe(false);
  });

  it('without history, the history group is hidden and Ctrl+Z / Ctrl+Y are inert', () => {
    const {editor, view, surface, groupOf} = grid(without('history'));
    expect(groupOf(view.querySelector('[part="history-button"]')!).hidden).toBe(true);
    view.interactionSession!.setSelection([a]); key(surface(), {key: 'ArrowUp'});
    expect(editor.score.getNote(a)!.pitch.midi).toBe(61);
    for (const init of [{key: 'z', ctrlKey: true}, {key: 'y', metaKey: true}]) expect(key(surface(), init).defaultPrevented).toBe(false);
    expect(editor.score.getNote(a)!.pitch.midi).toBe(61); expect(editor.getState().history.undoCount).toBe(1);
  });

  it('with no features, selection still works and nothing edits', () => {
    const {editor, view, surface, part} = grid((value) => value.setAttribute('tools', ''));
    expect(view.tools).toEqual([]);
    // Only the note-values toggle remains: selection by list needs no feature.
    expect([...part('toolbar').querySelectorAll<HTMLElement>(':scope > [role="group"]')].filter((group) => !group.hidden)
      .map((group) => group.getAttribute('aria-label'))).toEqual(['Note values']);
    drag(surface(), [X(1) + 6, Y(60)], [X(2), Y(62)]);
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([a]);
    for (const name of ['Delete', 'ArrowLeft']) key(surface(), {key: name});
    expect(key(surface(), {key: 'a', ctrlKey: true}).defaultPrevented).toBe(true);
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([a, b]);
    expect(editor.getSnapshot().documentRevision).toBe(0);
  });
});

describe('score grid editing', () => {
  it('draws notes with the draw tool and erases a clicked note, toggling the tool with B', () => {
    const {editor, view, surface, commits} = grid();
    expect(key(surface(), {key: 'b'}).defaultPrevented).toBe(true);
    expect(view.getAttribute('tool')).toBe('draw'); expect(view.tool).toBe('draw');
    // A click inserts one grid step; a drag stretches it on the grid.
    pointer(surface(), 'pointerdown', X(5) + 3, Y(70)); pointer(surface(), 'pointerup', X(5) + 3, Y(70));
    drag(surface(), [X(6) + 3, Y(72)], [X(7) + 3, Y(72)]);
    const added = editor.score.parts[0].notes.filter((note) => note.id !== a && note.id !== b)
      .map((note) => [note.onsetQuarters.toString(), note.duration.quarters.toString(), note.pitch.midi]);
    expect(added).toEqual([['5', '1/4', 70], ['6', '1', 72]]);
    pointer(surface(), 'pointerdown', X(1) + 6, Y(60)); pointer(surface(), 'pointerup', X(1) + 6, Y(60));
    expect(editor.score.getNote(a)).toBeUndefined();
    expect(commits.mock.calls.map(([event]) => (event as CustomEvent).detail.change.label)).toEqual(['Insert note', 'Insert note', 'Delete notes']);
    view.querySelectorAll<HTMLButtonElement>('[part="tool-button"]')[0].click();
    expect(view.getAttribute('tool')).toBe('select');
  });

  it('selects with a marquee, and Shift-marquee extends the selection', () => {
    const {editor, view, surface} = grid();
    pointer(surface(), 'pointerdown', X(0.5), Y(67));
    pointer(surface(), 'pointermove', X(2.5), Y(58));
    expect(view.querySelector('[data-marquee]')).toBeTruthy();
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([a]);
    pointer(surface(), 'pointerup', X(2.5), Y(58));
    expect(view.querySelector('[data-marquee]')).toBeNull();
    drag(surface(), [X(2.5), Y(66)], [X(3.5), Y(63)], {shiftKey: true});
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([a, b]);
    // A plain marquee over empty space replaces the selection.
    drag(surface(), [X(8), Y(80)], [X(9), Y(78)]);
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([]);
    expect(editor.getSnapshot().documentRevision).toBe(0);
  });

  it('moves a selection in time and pitch on the snap grid, or freely with snap off', () => {
    const {editor, view, surface, commits} = grid();
    drag(surface(), [X(1) + 6, Y(60)], [X(1) + 26, Y(60) - 32]);
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('5/4');
    expect(editor.score.getNote(a)!.pitch.midi).toBe(62);
    view.snap = '1/4';
    drag(surface(), [X(1.25) + 6, Y(62)], [X(1.25) + 26, Y(62)]);
    expect(editor.getSnapshot().documentRevision).toBe(1);
    drag(surface(), [X(1.25) + 6, Y(62)], [X(1.25) + 46, Y(62)]);
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('9/4');
    view.setAttribute('snap', 'off');
    drag(surface(), [X(2.25) + 6, Y(62)], [X(2.25) + 26, Y(62)]);
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('41/16');
    expect(commits).toHaveBeenCalledTimes(3);
    expect(commits.mock.calls.every(([event]) => (event as CustomEvent).detail.change.label === 'Move notes')).toBe(true);
    // Every commit is one undoable history item.
    expect(editor.getState().history.undoCount).toBe(3);
  });

  it('resizes from the right edge on the snap grid', () => {
    const {editor, view, surface} = grid((value) => { value.snap = '1/8'; });
    drag(surface(), [X(2) - 2, Y(60)], [X(2) + 18, Y(60)]);
    expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('3/2');
    drag(surface(), [X(2.5) - 2, Y(60)], [X(1), Y(60)]);
    // A resize never shortens below one grid step.
    expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('1/2');
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([a]);
  });

  it('changes the velocity of the selection in one commit from the velocity lane', () => {
    const {editor, view, surface, commits} = grid((value) => { value.velocityLane = true; });
    const lane = view.querySelector('[data-velocity-lane]')!;
    expect(lane).toBeTruthy();
    view.interactionSession!.setSelection([a, b]);
    const stem = view.querySelector('[data-velocity-note-id="a"]')!;
    // Stems are drawn lane-local; the lane sits at the bottom of the visible frame.
    const cy = Number(stem.getAttribute('cy')) + Number(surface().getAttribute('height')) - 72;
    drag(surface(), [X(1) + 1, cy], [X(1) + 1, cy - 29]);
    expect(editor.score.getNote(a)!.velocity).toBe(124);
    expect(editor.score.getNote(b)!.velocity).toBe(127);
    expect(commits).toHaveBeenCalledOnce();
    const change = (commits.mock.calls[0][0] as CustomEvent).detail.change;
    expect(change.label).toBe('Change velocity');
    expect(change.operations.map((operation: ScoreEditOperation) => operation.type)).toEqual(['set-velocity', 'set-velocity']);
    expect(editor.getState().history.undoCount).toBe(1);
    view.querySelector<HTMLButtonElement>('[part="lane-toggle"]')!.click();
    expect(view.hasAttribute('velocity-lane')).toBe(false);
    expect(view.querySelector<HTMLElement>('[data-velocity-lane]')!.style.display).toBe('none');
    expect(view.querySelector('[data-velocity-note-id]')).toBeNull();
  });
});

describe('score grid settings', () => {
  it('reflects snap in the toolbar and sets it from the in-card snap options', () => {
    const {view, part} = grid((value) => { value.snap = '1/8t'; });
    const events: ScoreGridSettingsChangeDetail[] = [];
    view.addEventListener('gridsettingschange', (event) => events.push((event as CustomEvent<ScoreGridSettingsChangeDetail>).detail));
    const trigger = part('snap') as HTMLButtonElement;
    const value = () => trigger.querySelector('[data-grid-value]')!.textContent;
    const pressed = () => [...view.querySelectorAll<HTMLButtonElement>('[part="snap-option"][aria-pressed="true"]')].map((option) => option.dataset.value);
    expect(value()).toBe('1/8T'); expect(pressed()).toEqual(['1/8t']);
    view.setAttribute('snap', '1/32'); expect(value()).toBe('1/32');
    view.setAttribute('snap', 'bogus'); expect(view.snap).toBe('1/16'); expect(value()).toBe('1/16');
    expect(events).toEqual([]);
    // The trigger opens an adjustment card over a scrim inside the grid window.
    const overlay = part('overlay');
    expect(overlay.hidden).toBe(true);
    trigger.click();
    expect(overlay.hidden).toBe(false); expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(part('card').getAttribute('role')).toBe('dialog'); expect(part('snap-options').hidden).toBe(false);
    expect(part('note-properties').hidden).toBe(true);
    expect(document.activeElement).toBe(view.querySelector('[part="snap-option"][data-value="1/16"]'));
    view.querySelector<HTMLButtonElement>('[part="snap-option"][data-value="1/4"]')!.click();
    expect(view.getAttribute('snap')).toBe('1/4'); expect(overlay.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(events).toHaveLength(1); expect(events[0].changed).toBe('snap'); expect(events[0].settings.snap).toBe('1/4');
    // Escape and the scrim close the card without changing anything.
    trigger.click(); part('card').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(overlay.hidden).toBe(true);
    trigger.click(); overlay.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true}));
    expect(overlay.hidden).toBe(true); expect(events).toHaveLength(1);
  });

  it('zooms with the toolbar and modified wheel within bounds, reflecting attributes', async () => {
    const {view, surface} = grid();
    const changed: string[] = [];
    view.addEventListener('gridsettingschange', (event) => changed.push((event as CustomEvent<ScoreGridSettingsChangeDetail>).detail.changed));
    const button = (label: string) => view.querySelector<HTMLButtonElement>(`[part="zoom-button"][aria-label="${label}"]`)!;
    button('Zoom in horizontally').click();
    expect(view.getAttribute('pixels-per-quarter')).toBe('80'); expect(view.pixelsPerQuarter).toBe(80);
    expect(view.querySelector('[data-note-id="a"]')!.getAttribute('x')).toBe(String(X(1, 80)));
    for (let index = 0; index < 20; index++) button('Zoom in horizontally').click();
    expect(view.pixelsPerQuarter).toBe(512);
    for (let index = 0; index < 20; index++) button('Shorter rows').click();
    expect(view.noteHeight).toBe(6); expect(view.getAttribute('note-height')).toBe('6');
    const count = changed.length;
    button('Shorter rows').click(); expect(changed).toHaveLength(count);
    // Wheel zoom is proportional to the deltas (a notch is clamped to 40), applied once per frame
    // and reported after the gesture settles.
    const reported = changed.length;
    surface().dispatchEvent(new WheelEvent('wheel', {deltaY: -100, altKey: true, bubbles: true, cancelable: true}));
    const wheel = new WheelEvent('wheel', {deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true});
    surface().dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(Number(view.querySelector('[data-note-id="a"]')!.getAttribute('x'))).toBeCloseTo(X(1, 343.204), 2);
    expect(changed).toHaveLength(reported);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(view.noteHeight).toBe(8.951); expect(view.pixelsPerQuarter).toBe(343.204);
    expect(new Set(changed)).toEqual(new Set(['pixelsPerQuarter', 'noteHeight']));
  });

  it('applies settings attributes and features in place, remounting only for other attributes', () => {
    const {view, surface, part} = grid();
    const mounted = surface();
    view.setAttribute('pixels-per-quarter', '32'); view.setAttribute('note-height', '10');
    view.setAttribute('snap', '1/8'); view.tool = 'draw'; view.velocityLane = true; view.tools = ['move', 'velocity', 'draw'];
    expect(surface()).toBe(mounted);
    expect(view.querySelector('[data-note-id="a"]')!.getAttribute('x')).toBe(String(X(1, 32)));
    expect(part('grid').dataset.tool).toBe('draw');
    expect(view.querySelector('[data-velocity-lane]')).toBeTruthy();
    view.tools = ['move'];
    expect(surface()).toBe(mounted); expect(part('grid').dataset.tool).toBe('select');
    // Out-of-range attributes clamp instead of failing.
    view.setAttribute('pixels-per-quarter', '9999'); expect(view.pixelsPerQuarter).toBe(512);
    view.setAttribute('note-color', '#123456');
    expect(surface()).not.toBe(mounted);
    expect(view.querySelector('[data-note-id="a"]')!.getAttribute('fill')).toBe('rgb(18, 52, 86)');
  });

  it('configures a mounted handle atomically and without remounting', () => {
    const editor = editorFor(); const editing = createScoreViewEditing(editor, {editable: true});
    const host = document.createElement('div'); document.body.append(host);
    const settings = vi.fn();
    const handle = mountScoreGrid(host, {editing}, {onSettingsChange: settings});
    const svg = handle.surface;
    handle.configure({pixelsPerQuarter: 100, features: ['move', 'zoom']});
    expect(handle.surface).toBe(svg); expect(handle.settings.pixelsPerQuarter).toBe(100);
    expect(handle.features).toEqual(['move', 'zoom']);
    expect(() => handle.configure({snap: '1/5' as never, pixelsPerQuarter: 32})).toThrow(RangeError);
    expect(() => handle.configure({features: ['erase' as never]})).toThrow(RangeError);
    expect(() => handle.configure({noteHeight: Number.NaN})).toThrow(RangeError);
    expect(handle.settings.pixelsPerQuarter).toBe(100); expect(handle.features).toEqual(['move', 'zoom']);
    expect(settings).not.toHaveBeenCalled();
    handle.dispose(); editing.dispose();
  });
});

describe('score grid sources', () => {
  it('remounts from a fixed score to an assigned editor and back', async () => {
    const view = document.createElement('grid-test-view') as ScoreGridViewElement;
    const fixed = fixture(); view.score = fixed; view.editable = true; document.body.append(view); await settle();
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.editState).toBe('static');
    view.score = undefined;
    const builder = new ScoreBuilder(); builder.addPart({id: p, name: 'Piano'});
    builder.addNote(p, {id: NoteId('editor-note'), pitch: Pitch.fromMidi(67), onsetQuarters: Rational.ZERO, duration: Duration.quarter(), voice: VoiceId('v')});
    const editor = editorFor(builder.build());
    view.editor = editor;
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.editState).toBe('ready');
    expect([...view.querySelectorAll('rect[data-note-id]')].map((note) => note.getAttribute('data-note-id'))).toEqual(['editor-note']);
    expect(view.querySelector<HTMLElement>('[part="toolbar"]')!.hidden).toBe(false);
    view.editor = undefined; await settle();
    expect(view.querySelector('[part="grid"]')).toBeNull();
    expect(view.textContent).toContain('Waiting for a score');
    view.score = fixed; await settle();
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.editState).toBe('static');
    expect(view.querySelectorAll('rect[data-note-id]')).toHaveLength(2);
    expect(editor.getSnapshot().status).toBe('ready');
  });
});

describe('score grid playback', () => {
  function music() {
    const builder = new ScoreBuilder(); const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
    builder.addNote(part, {id: a, pitch: Pitch.fromMidi(60), onsetQuarters: Rational.ONE, duration: new Duration({base: [4, 1]}), voice: builder.newVoiceId()});
    return builder.build();
  }

  it('follows an editor-bound native player, gating overlays while a commit is prepared', async () => {
    const editor = editorFor(music());
    const player = document.createElement('grid-test-player') as ScorePlayerElement;
    player.id = 'grid-audition'; player.editor = editor;
    const view = document.createElement('grid-test-view') as ScoreGridViewElement;
    view.editor = editor; view.editable = true; view.setAttribute('input', '#grid-audition');
    document.body.append(player, view);
    expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
    await player.seekNominal(1);
    const element = view.querySelector<HTMLElement>('[part="grid"]')!;
    const quarter = editor.score.timeMap.secondsToQuarters(1).toFloat();
    expect(view.currentTime).toBe(1); expect(element.dataset.playbackState).toBe('ready');
    expect(view.querySelector('[data-playhead]')!.getAttribute('x1')).toBe(String(X(quarter)));
    // Editor-bound sounding notes come from the player's report (none while paused), not from the position.
    const reported = player.playback.snapshot().activeNotes.some((note) => note.noteId === a);
    expect(view.querySelector('[data-note-id="a"]')!.getAttribute('data-active')).toBe(String(reported));
    view.interactionSession!.setSelection([a]);
    key(view.querySelector('[part="surface"]')!, {key: 'ArrowRight'});
    expect(editor.getSnapshot().documentRevision).toBe(1);
    expect(view.querySelector('[data-playhead]')).toBeNull();
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.playbackState).toBe('pending');
    expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
    expect(view.querySelector('[data-playhead]')).toBeTruthy();
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.playbackState).toBe('ready');
    await player.seekNominal(0.25);
    expect(view.currentTime).toBe(0.25);
    expect(view.querySelector('[data-playhead]')!.getAttribute('x1')).toBe(String(X(editor.score.timeMap.secondsToQuarters(0.25).toFloat())));
    view.removeAttribute('input');
    expect(view.querySelector('[data-playhead]')).toBeNull();
    expect(view.querySelector<HTMLElement>('[part="grid"]')!.dataset.playbackState).toBe('unbound');
  });

  it('derives sounding notes for a fixed score from the playback position', () => {
    const host = document.createElement('div'); document.body.append(host);
    const score = fixture();
    const handle = mountScoreGrid(host, {score});
    handle.updatePlayback({seconds: score.timeMap.quartersToSeconds(new Rational(3, 2))});
    expect(host.querySelector('[data-note-id="a"]')!.getAttribute('data-active')).toBe('true');
    expect(host.querySelector('[data-note-id="b"]')!.getAttribute('data-active')).toBe('false');
    expect(handle.element.dataset.playbackState).toBe('ready');
    handle.updatePlayback(undefined);
    expect(host.querySelector('[data-playhead]')).toBeNull(); expect(handle.element.dataset.playbackState).toBe('unbound');
    handle.dispose(); expect(host.childElementCount).toBe(0);
  });
});
