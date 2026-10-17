// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, ScoreEditError, VoiceId, type ScoreEditOperation, type ScorePlaybackSnapshot} from '../../src/core';
import {createScoreEditor} from '../../src/edit/headless';
import {createScoreView, createScoreViewEditing, scoreDocumentPlaybackCompatible} from '../../src/view/headless';
import {mountPianoRollEditor} from '../../src/view/render/piano-roll-editor';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('editing-score-view', ScoreViewElement);
const a = NoteId('a'); const b = NoteId('b'); const p = PartId('p');
function fixture() {
  const builder = new ScoreBuilder(); builder.addPart({id: p, name: 'Piano'});
  builder.addNote(p, {id: a, pitch: Pitch.fromMidi(60), onsetQuarters: Rational.ONE,
    duration: Duration.quarter(), voice: VoiceId('v'), performed: {onsetSec: .45, durationSec: .48, velocity: 90}});
  builder.addNote(p, {id: b, pitch: Pitch.fromMidi(64), onsetQuarters: new Rational(3), duration: Duration.quarter(), voice: VoiceId('v')});
  return builder.build();
}
const move: ScoreEditOperation = {type: 'move-notes', noteIds: [a], deltaQuarters: [1, 4]};
function playback(editor: ReturnType<typeof createScoreEditor>, overrides: Partial<ScorePlaybackSnapshot> = {}): ScorePlaybackSnapshot {
  const document = editor.getSnapshot();
  return {revision: 1, sourceRevision: 1, readiness: 'ready', state: 'paused', score: document.content,
    nominalSeconds: .5, nominalDurationSeconds: 2, transportSeconds: .5, transportDurationSeconds: 2, rate: 1,
    activeNotes: [], documentId: document.documentId, documentRevision: document.documentRevision,
    documentBinding: {status: 'ready', attempt: 1, requested: document, applied: document, documentCoordinates: true, positionPolicy: 'preserve-quarter'}, ...overrides};
}
function pointer(target: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra});
  Object.defineProperty(event, 'pointerId', {value: 1}); target.dispatchEvent(event);
}
function mounted() {
  const editor = createScoreEditor(fixture());
  const editing = createScoreViewEditing(editor, {editable: true});
  const host = document.createElement('div'); document.body.append(host);
  const commits = vi.fn(); const previews = vi.fn();
  const renderer = mountPianoRollEditor(host, editing, {onCommit: commits, onPreview: previews});
  return {editor, editing, host, renderer, commits, previews};
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('document-bound Score views', () => {
  it('returns the original failure when a synchronous observer clears the displayed error', () => {
    const editor = createScoreEditor(fixture()); const editing = createScoreViewEditing(editor);
    let observed: ScoreEditError | undefined;
    const off = editing.subscribe((state) => {
      if (state.error) { observed = state.error; editing.cancel(); }
    });
    const result = editing.execute('Move', [move]);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toBeInstanceOf(ScoreEditError); expect(result.error).toBe(observed);
      expect(result.error.message).toBe('Editing is disabled');
    }
    expect(editing.state.error).toBeUndefined(); expect(editor.getSnapshot().documentRevision).toBe(0);
    off(); editing.dispose(); editor.dispose();
  });

  it('shares committed content while isolating sessions, and borrows an explicitly shared session', () => {
    const editor = createScoreEditor(fixture());
    const first = createScoreView(editor, {editable: true}); const second = createScoreView(editor);
    first.editing!.select([a]); first.editing!.preview([move]);
    expect(first.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([5, 4]);
    expect(second.score).toBe(editor.score);
    expect(second.editing!.state.interaction.selectedNoteIds).toEqual([]);
    first.editing!.commit('Move');
    expect(second.score).toBe(editor.score);
    expect(editor.getState().history.undoCount).toBe(1);
    const shared = editor.createInteractionSession();
    const third = createScoreView(editor, {interactionSession: shared});
    shared.setSelection([b]); expect(third.editing!.state.interaction.selectedNoteIds).toEqual([b]);
    third.dispose(); expect(shared.getSnapshot().disposed).toBe(false);
    first.dispose(); second.dispose(); expect(editor.getSnapshot().status).toBe('ready'); editor.dispose();
  });

  it('rejects foreign interaction sessions and gates stale, failed or unmapped playback', () => {
    const editor = createScoreEditor(fixture()); const foreign = createScoreEditor(fixture());
    expect(() => createScoreView(editor, {interactionSession: foreign.createInteractionSession()})).toThrow(/bound document/);
    const initial = playback(editor);
    expect(scoreDocumentPlaybackCompatible(editor.getSnapshot(), initial)).toBe(true);
    expect(scoreDocumentPlaybackCompatible(editor.getSnapshot(), {...initial, documentRevision: 99})).toBe(false);
    expect(scoreDocumentPlaybackCompatible(editor.getSnapshot(), {...initial, documentBinding: {...initial.documentBinding!, documentCoordinates: false}})).toBe(false);
    expect(scoreDocumentPlaybackCompatible(editor.getSnapshot(), {...initial, documentBinding: {...initial.documentBinding!, status: 'error'}})).toBe(false);
    const view = createScoreView(editor, {editable: true}); view.updatePlayback(initial);
    expect(view.state.playbackAvailable).toBe(true);
    view.editing!.execute('Move', [move]);
    expect(view.state.playbackAvailable).toBe(false); expect(view.state.activeNotes).toEqual([]);
    view.updatePlayback(playback(editor)); expect(view.state.playbackAvailable).toBe(true);
    view.dispose(); editor.dispose(); foreign.dispose();
  });

  it('disposes its owned session if borrowed playback observation fails during construction', () => {
    const editor = createScoreEditor(fixture());
    const session = editor.createInteractionSession();
    vi.spyOn(editor, 'createInteractionSession').mockReturnValue(session);
    expect(() => createScoreView(editor, {playback: {snapshot: () => playback(editor), subscribe: () => { throw new Error('Cannot observe'); }}})).toThrow('Cannot observe');
    expect(session.getSnapshot().disposed).toBe(true); expect(editor.getSnapshot().status).toBe('ready'); editor.dispose();
  });
});

describe('piano-roll gestures', () => {
  it('repaints newly visible notes when its viewport widens and releases its resize observer', () => {
    let resize = () => {};
    let observed: Element | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe(target: Element) { observed = target; }
      disconnect = disconnect;
    });
    const builder = new ScoreBuilder(); builder.addPart({id: p, name: 'Piano'});
    for (const [id, at] of [[a, 1], [b, 6]] as const) builder.addNote(p, {id, pitch: Pitch.fromMidi(60),
      onsetQuarters: new Rational(at), duration: Duration.quarter(), voice: VoiceId('v')});
    const editor = createScoreEditor(builder.build()); const editing = createScoreViewEditing(editor, {editable: true});
    const host = document.createElement('div'); document.body.append(host);
    const renderer = mountPianoRollEditor(host, editing);
    const viewport = host.querySelector<HTMLElement>('[part="editing-viewport"]')!;
    let width = 232;
    Object.defineProperty(viewport, 'clientWidth', {get: () => width});
    expect(observed).toBe(viewport); resize();
    expect(host.querySelector('[data-note-id="a"]')).toBeTruthy();
    expect(host.querySelector('[data-note-id="b"]')).toBeNull();
    renderer.surface.focus(); const snapshot = editor.getSnapshot();
    width = 553; resize();
    expect(host.querySelector('[data-note-id="b"]')).toBeTruthy();
    expect(editor.getSnapshot()).toBe(snapshot); expect(snapshot.documentRevision).toBe(0);
    expect(document.activeElement).toBe(renderer.surface);
    renderer.dispose(); expect(disconnect).toHaveBeenCalledOnce();
    const paint = vi.spyOn(renderer.surface, 'replaceChildren');
    width = 232; resize(); expect(paint).not.toHaveBeenCalled();
    editing.dispose(); editor.dispose();
  });

  it('cancels its own drag on resize without clearing another surface’s shared preview', () => {
    let resize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const {editor, editing, renderer, host, commits} = mounted();
    const viewport = host.querySelector<HTMLElement>('[part="editing-viewport"]')!;
    let width = 232;
    Object.defineProperty(viewport, 'clientWidth', {get: () => width}); resize();
    pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 70, 490);
    pointer(renderer.surface, 'pointermove', 86, 490);
    expect(editing.state.interaction.draft).toBeDefined();
    width = 553; resize();
    expect(editing.state.interaction.draft).toBeUndefined();
    pointer(renderer.surface, 'pointerup', 86, 490);
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(commits).not.toHaveBeenCalled();
    editing.session.preview([move]);
    width = 232; resize();
    expect(editing.state.interaction.draft).toBeDefined();
    expect(editor.getSnapshot().documentRevision).toBe(0);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('uses written quarters, previews a drag and commits exactly one history item', () => {
    const {editor, editing, renderer, host, commits, previews} = mounted();
    const rectangle = host.querySelector('[data-note-id="a"]')!;
    expect(rectangle.getAttribute('x')).toBe('64'); // performed .45s must not become its editing coordinate
    pointer(rectangle, 'pointerdown', 70, 490);
    pointer(renderer.surface, 'pointermove', 86, 490); pointer(renderer.surface, 'pointermove', 102, 490);
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(previews).toHaveBeenCalledTimes(2);
    pointer(renderer.surface, 'pointerup', 102, 490);
    expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([3, 2]);
    expect(editor.score.getNote(a)!.performed).toBeUndefined();
    expect(editor.getState().history.undoCount).toBe(1); expect(commits).toHaveBeenCalledOnce();
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('cancels escape/capture loss and an externally superseded gesture', () => {
    const {editor, editing, renderer, host, commits} = mounted();
    const begin = () => { pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 70, 490); pointer(renderer.surface, 'pointermove', 86, 490); };
    begin(); renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    pointer(renderer.surface, 'pointerup', 86, 490); expect(editor.getSnapshot().documentRevision).toBe(0);
    begin(); renderer.surface.dispatchEvent(new Event('lostpointercapture'));
    pointer(renderer.surface, 'pointerup', 86, 490); expect(editor.getSnapshot().documentRevision).toBe(0);
    begin(); editor.transaction('External', (tx) => tx.add({type: 'set-velocity', noteIds: [b], velocity: 95}));
    pointer(renderer.surface, 'pointerup', 86, 490);
    expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([1, 1]); expect(commits).not.toHaveBeenCalled();
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('resizes, inserts, nudges and deletes with undo through the same semantic owner', () => {
    const {editor, editing, renderer, host} = mounted();
    pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 126, 490);
    pointer(renderer.surface, 'pointermove', 142, 490); pointer(renderer.surface, 'pointerup', 142, 490);
    expect(editor.score.getNote(a)!.duration.quarters.toJSON()).toEqual([5, 4]);
    renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([5, 4]);
    renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}));
    expect(editor.score.getNote(a)).toBeUndefined();
    renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}));
    expect(editor.score.getNote(a)).toBeDefined();
    renderer.surface.dispatchEvent(new MouseEvent('dblclick', {clientX: 320, clientY: 410, bubbles: true}));
    expect(editor.score.parts[0].notes).toHaveLength(3);
    expect(editor.score.parts[0].notes.find((note) => note.onsetQuarters.eq(new Rational(5)))!.pitch.midi).toBe(64);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('offers exact numeric edits without intercepting text-field keys', () => {
    const {editor, editing, renderer, host} = mounted(); editing.select([a]);
    const field = host.querySelector<HTMLInputElement>('[aria-label="Onset (quarters)"]')!;
    field.value = '1/3'; field.focus(); field.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}));
    expect(editor.score.getNote(a)).toBeDefined();
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Apply to selected note')!.click();
    expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([1, 3]);
    expect(editor.getState().history.undoCount).toBe(1);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('selects a non-first note through the native keyboard alternative and edits, deletes and undoes it', () => {
    const {editor, editing, renderer, host, commits} = mounted();
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="Select existing note"]')!;
    const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const button = (label: string) => [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
    host.querySelector<HTMLDetailsElement>('details')!.open = true;
    picker.focus(); picker.value = 'note:b'; picker.dispatchEvent(new Event('change', {bubbles: true}));
    expect(editing.state.interaction.selectedNoteIds).toEqual([b]); expect(document.activeElement).toBe(picker);
    expect(field('Onset (quarters)').value).toBe('3'); expect(field('Written MIDI pitch').value).toBe('64');
    expect(button('Apply to selected note').disabled).toBe(false); expect(editor.getSnapshot().documentRevision).toBe(0);
    for (const key of ['ArrowLeft', 'Home', 'End', 'Delete']) picker.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(editor.score.getNote(b)).toBeDefined();
    field('Onset (quarters)').focus(); field('Onset (quarters)').value = '7/2';
    button('Apply to selected note').focus(); renderer.updatePlayback(playback(editor));
    expect(field('Onset (quarters)').value).toBe('7/2');
    button('Apply to selected note').click();
    expect(editor.score.getNote(b)!.onsetQuarters.toJSON()).toEqual([7, 2]); expect(editor.score.getNote(b)!.pitch.midi).toBe(64);
    expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([1, 1]); expect(commits).toHaveBeenCalledOnce();
    button('Delete selected').focus(); button('Delete selected').click();
    expect(editor.score.getNote(b)).toBeUndefined(); expect(picker.value).toBe(''); expect(picker.querySelector('[value="note:b"]')).toBeNull();
    button('Undo').focus(); button('Undo').click();
    expect(editor.score.getNote(b)!.onsetQuarters.toJSON()).toEqual([7, 2]); expect(picker.querySelector('[value="note:b"]')).not.toBeNull();
    expect(picker.value).toBe(''); expect(editing.state.interaction.selectedNoteIds).toEqual([]);
    picker.focus(); picker.value = 'note:b'; picker.dispatchEvent(new Event('change', {bubbles: true}));
    expect(field('Onset (quarters)').value).toBe('7/2'); expect(editor.getState().history.undoCount).toBe(1);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('labels stable note identities across parts and reflects external selection and document changes without stealing focus', () => {
    const otherPart = PartId('other'); const builder = new ScoreBuilder();
    for (const id of [p, otherPart]) builder.addPart({id, name: 'Piano'});
    for (const [partId, id, onset] of [[p, 'late', 3], [p, 'early', 0], [otherPart, 'same-pitch', 0]] as const) {
      builder.addNote(partId, {id: NoteId(id), pitch: Pitch.fromMidi(60), onsetQuarters: new Rational(onset), duration: Duration.quarter(), voice: VoiceId('1')});
    }
    const editor = createScoreEditor(builder.build()), editing = createScoreViewEditing(editor, {editable: true});
    const host = document.createElement('div'); document.body.append(host); const renderer = mountPianoRollEditor(host, editing);
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="Select existing note"]')!;
    expect([...picker.options].map((option) => option.value)).toEqual(['', 'note:early', 'note:late', 'note:same-pitch']);
    expect(picker.options[1].textContent).toBe('Piano (part 1) · C4 · quarter 0 · voice 1 · note 1');
    expect(picker.options[3].textContent).toBe('Piano (part 2) · C4 · quarter 0 · voice 1 · note 1');
    picker.focus(); const changes = vi.fn(); picker.addEventListener('change', changes);
    editing.select([NoteId('late')]); expect(picker.value).toBe('note:late');
    const retained = picker.querySelector('[value="note:late"]'); renderer.updatePlayback(playback(editor));
    expect(picker.querySelector('[value="note:late"]')).toBe(retained);
    editor.transaction('External edit', tx => tx.add({type: 'transpose-notes', noteIds: [NoteId('late')], semitones: 2}));
    expect(picker.value).toBe('note:late'); expect(picker.selectedOptions[0].textContent).toContain('D4');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Written MIDI pitch"]')!.value).toBe('62');
    expect(document.activeElement).toBe(picker); expect(changes).not.toHaveBeenCalled();
    editing.select([NoteId('early'), NoteId('same-pitch')]);
    expect(picker.selectedOptions[0].textContent).toBe('2 notes selected'); expect(picker.selectedOptions[0].disabled).toBe(true);
    expect(editing.state.interaction.selectedNoteIds).toEqual([NoteId('early'), NoteId('same-pitch')]);
    const revision = editor.getSnapshot().documentRevision;
    host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(editor.getSnapshot().documentRevision).toBe(revision);
    picker.value = ''; picker.dispatchEvent(new Event('change', {bubbles: true})); expect(editing.state.interaction.selectedNoteIds).toEqual([]);
    editing.setEditable(false); expect(picker.disabled).toBe(true);
    picker.value = 'note:late'; picker.dispatchEvent(new Event('change', {bubbles: true})); expect(editing.state.interaction.selectedNoteIds).toEqual([]);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it.each(['input', 'Apply'])('refreshes numeric values after shared selection changes while %s retains focus', (focused) => {
    const {editor, editing, renderer, host} = mounted();
    const peer = createScoreViewEditing(editor, {interactionSession: editing.session});
    const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const apply = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Apply to selected note')!;
    editing.select([a]); field('Written MIDI pitch').value = '72';
    const active = focused === 'input' ? field('Written MIDI pitch') : apply; active.focus();
    peer.select([b]);
    expect(document.activeElement).toBe(active);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Select existing note"]')!.value).toBe('note:b');
    expect(field('Onset (quarters)').value).toBe('3'); expect(field('Written MIDI pitch').value).toBe('64');
    expect(editor.getSnapshot().documentRevision).toBe(0);
    apply.click();
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('1'); expect(editor.score.getNote(a)!.pitch.midi).toBe(60);
    expect(editor.score.getNote(b)!.onsetQuarters.toString()).toBe('3'); expect(editor.score.getNote(b)!.pitch.midi).toBe(64);
    peer.dispose(); renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('refreshes fields on same-note revisions and history changes but preserves pending values within one binding', () => {
    const {editor, editing, renderer, host} = mounted(); editing.select([a]);
    const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const apply = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Apply to selected note')!;
    field('Onset (quarters)').value = '9'; field('Written MIDI pitch').value = '72'; apply.focus();
    editor.transaction('External change', (tx) => {
      tx.add({type: 'move-notes', noteIds: [a], deltaQuarters: [1, 1]});
      tx.add({type: 'transpose-notes', noteIds: [a], semitones: 2});
      tx.add({type: 'set-velocity', noteIds: [a], velocity: 98});
    });
    expect(document.activeElement).toBe(apply);
    expect(field('Onset (quarters)').value).toBe('2'); expect(field('Written MIDI pitch').value).toBe('62');
    expect(field('Velocity').value).toBe('98');
    apply.click(); expect(editor.getSnapshot().documentRevision).toBe(1);
    editor.undo(); expect(field('Onset (quarters)').value).toBe('1'); expect(field('Written MIDI pitch').value).toBe('60');
    editor.redo(); expect(field('Onset (quarters)').value).toBe('2'); expect(field('Written MIDI pitch').value).toBe('62');
    field('Onset (quarters)').value = '5/2';
    editing.select([a]); editor.markSaved(); renderer.updatePlayback(playback(editor));
    expect(field('Onset (quarters)').value).toBe('5/2');
    renderer.surface.focus(); renderer.updatePlayback(playback(editor));
    expect(field('Onset (quarters)').value).toBe('5/2');
    apply.click(); expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([5, 2]);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('keeps insertion values usable through empty or multiple selection without applying a deleted target', () => {
    const {editor, editing, renderer, host} = mounted(); editing.select([a]);
    const field = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const button = (label: string) => [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
    field('Onset (quarters)').focus(); field('Onset (quarters)').value = '5';
    field('Written MIDI pitch').value = '72'; field('Duration (quarters)').value = '1/2'; field('Velocity').value = '65';
    editor.transaction('Delete externally', (tx) => tx.add({type: 'delete-notes', noteIds: [a]}));
    expect(button('Apply to selected note').disabled).toBe(true);
    host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(editor.getSnapshot().documentRevision).toBe(1);
    editor.undo(); expect(editing.state.interaction.selectedNoteIds).toEqual([]);
    editing.select([a, b]); renderer.updatePlayback(playback(editor));
    expect(field('Onset (quarters)').value).toBe('5'); expect(field('Written MIDI pitch').value).toBe('72');
    host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(editor.getSnapshot().documentRevision).toBe(2);
    button('Insert note').focus(); button('Insert note').click();
    const inserted = editor.score.parts[0].notes.find((note) => note.id !== a && note.id !== b)!;
    expect(inserted.onsetQuarters.toString()).toBe('5'); expect(inserted.pitch.midi).toBe(72);
    expect(inserted.duration.quarters.toJSON()).toEqual([1, 2]); expect(inserted.velocity).toBe(65);
    expect(editing.state.interaction.selectedNoteIds).toEqual([inserted.id]);
    expect(field('Onset (quarters)').value).toBe('5');
    editor.undo(); expect(editing.state.interaction.selectedNoteIds).toEqual([]);
    editor.redo(); expect(editing.state.interaction.selectedNoteIds).toEqual([]);
    expect(button('Apply to selected note').disabled).toBe(true);
    editing.select([a]); expect(field('Onset (quarters)').value).toBe('1'); expect(field('Written MIDI pitch').value).toBe('60');
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('keeps the numeric baseline on committed content while rendering a shared preview', () => {
    const {editor, editing, renderer, host} = mounted(); editing.select([a]);
    renderer.surface.focus(); editing.preview([move]);
    expect(host.querySelector('[data-note-id="a"]')!.getAttribute('x')).toBe('80');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Onset (quarters)"]')!.value).toBe('1');
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Apply to selected note')!.click();
    expect(editing.state.interaction.draft).toBeUndefined();
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('1');
    expect(editor.score.getNote(a)!.performed).toEqual({onsetSec: .45, durationSec: .48, velocity: 90});
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('rejects a numeric edit superseded by a document change while cancelling the shared draft', () => {
    const {editor, editing, renderer, host, commits} = mounted(); editing.select([a]);
    const field = host.querySelector<HTMLInputElement>('[aria-label="Onset (quarters)"]')!;
    field.focus(); field.value = '2'; editing.preview([move]);
    let replace = true;
    const off = editing.session.subscribe((snapshot) => {
      if (replace && !snapshot.draft) {
        replace = false;
        editor.transaction('External transpose', (tx) => tx.add({type: 'transpose-notes', noteIds: [a], semitones: 3}));
      }
    });
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Apply to selected note')!.click();
    expect(editor.getSnapshot().documentRevision).toBe(1);
    expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('1'); expect(editor.score.getNote(a)!.pitch.midi).toBe(63);
    expect(commits).not.toHaveBeenCalled(); expect(host.querySelector('[part="editing-status"]')!.textContent).toMatch(/changed.*review/i);
    off(); renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it.each(['resize', 'move', 'transpose', 'delete-key', 'delete-button', 'double-click'] as const)(
    'rejects captured %s commands when cancelling a shared draft commits an external revision', (command) => {
      const {editor, editing, renderer, host, commits} = mounted(); editing.select([a]); editing.preview([move]);
      let replace = true;
      const off = editing.session.subscribe((snapshot) => {
        if (replace && !snapshot.draft) {
          replace = false;
          editor.transaction('External resize', (tx) => tx.add({type: 'resize-notes', noteIds: [a], durationQuarters: [4, 1]}));
        }
      });
      if (command === 'delete-button') [...host.querySelectorAll('button')].find((button) => button.textContent === 'Delete selected')!.click();
      else if (command === 'double-click') renderer.surface.dispatchEvent(new MouseEvent('dblclick', {clientX: 400, clientY: 410, bubbles: true}));
      else renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {
        key: command === 'delete-key' ? 'Delete' : command === 'transpose' ? 'ArrowUp' : 'ArrowRight',
        shiftKey: command === 'resize', bubbles: true,
      }));
      expect(editor.getSnapshot().documentRevision).toBe(1);
      expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('4');
      expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('1'); expect(editor.score.getNote(a)!.pitch.midi).toBe(60);
      expect(editor.score.parts[0].notes).toHaveLength(2);
      expect(commits).not.toHaveBeenCalled(); expect(host.querySelector('[part="editing-status"]')!.textContent).toMatch(/changed.*review/i);
      off(); renderer.dispose(); editing.dispose(); editor.dispose();
    });

  it.each(['undo-key', 'redo-key', 'undo-button', 'redo-button'] as const)(
    'does not redirect %s to history committed by draft cancellation', (command) => {
      const {editor, editing, renderer, host, commits} = mounted();
      editing.execute('Original edit', [move]);
      if (command.startsWith('redo')) editing.undo();
      editing.select([a]); editing.preview([move]);
      const revision = editor.getSnapshot().documentRevision;
      let replace = true;
      const off = editing.session.subscribe((snapshot) => {
        if (replace && !snapshot.draft) {
          replace = false;
          editor.transaction('External resize', (tx) => tx.add({type: 'resize-notes', noteIds: [a], durationQuarters: [4, 1]}));
        }
      });
      if (command.endsWith('button')) [...host.querySelectorAll('button')].find((button) => button.textContent === (command.startsWith('redo') ? 'Redo' : 'Undo'))!.click();
      else renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, shiftKey: command.startsWith('redo'), bubbles: true}));
      expect(editor.getSnapshot().documentRevision).toBe(revision + 1);
      expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('4');
      expect(commits).not.toHaveBeenCalled(); expect(host.querySelector('[part="editing-status"]')!.textContent).toMatch(/changed.*review/i);
      off(); renderer.dispose(); editing.dispose(); editor.dispose();
    });

  it('rejects a captured keyboard command when cancellation redirects the selection without changing content', () => {
    const {editor, editing, renderer, host, commits} = mounted(); editing.select([a]); editing.preview([move]);
    let cancelledPublications = 0;
    const off = editing.subscribe((state) => {
      // The session cancellation publishes first; the view's own publication
      // follows after the session has left its publication lock.
      if (!state.interaction.draft && ++cancelledPublications === 2) editing.select([b]);
    });
    renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}));
    expect(editing.state.interaction.selectedNoteIds).toEqual([b]);
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(editor.score.getNote(a)).toBeDefined();
    expect(commits).not.toHaveBeenCalled(); expect(host.querySelector('[part="editing-status"]')!.textContent).toMatch(/changed.*review/i);
    off(); renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it.each(['readonly', 'view-dispose', 'surface-dispose', 'editor-dispose'] as const)(
    'stops the pending keyboard command after cancellation causes %s', (action) => {
      const {editor, editing, renderer, commits} = mounted(); editing.select([a]); editing.preview([move]);
      const execute = vi.spyOn(editing, 'execute');
      let cancel = true;
      const off = editing.session.subscribe((snapshot) => {
        if (cancel && !snapshot.draft) {
          cancel = false;
          if (action === 'readonly') editing.setEditable(false);
          else if (action === 'view-dispose') editing.dispose();
          else if (action === 'surface-dispose') renderer.dispose();
          else editor.dispose();
        }
      });
      renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', shiftKey: true, bubbles: true}));
      expect(editor.getSnapshot().documentRevision).toBe(0); expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('1');
      expect(execute).not.toHaveBeenCalled(); expect(commits).not.toHaveBeenCalled();
      off(); renderer.dispose(); editing.dispose(); editor.dispose();
    });

  it.each(['resize', 'insert'] as const)('does not begin a %s gesture after cancellation replaces its captured content', (kind) => {
    const {editor, editing, renderer, host, commits, previews} = mounted(); editing.select([a]); editing.preview([move]);
    let replace = true;
    const off = editing.session.subscribe((snapshot) => {
      if (replace && !snapshot.draft) {
        replace = false;
        editor.transaction('External resize', (tx) => tx.add({type: 'resize-notes', noteIds: [a], durationQuarters: [4, 1]}));
      }
    });
    const inserting = kind === 'insert';
    pointer(inserting ? renderer.surface : host.querySelector('[data-note-id="a"]')!, 'pointerdown', inserting ? 320 : 126, 490, {altKey: inserting});
    pointer(renderer.surface, 'pointermove', 352, 490); pointer(renderer.surface, 'pointerup', 352, 490);
    expect(editor.getSnapshot().documentRevision).toBe(1); expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('4');
    expect(editor.score.parts[0].notes).toHaveLength(2); expect(editing.state.interaction.draft).toBeUndefined();
    expect(commits).not.toHaveBeenCalled(); expect(previews).not.toHaveBeenCalled();
    off(); renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('does not begin a note gesture when selecting its target commits a replacement revision', () => {
    const {editor, editing, renderer, host, commits, previews} = mounted();
    let replace = true;
    const off = editing.session.subscribe((snapshot) => {
      if (replace && snapshot.selectedNoteIds.includes(a)) {
        replace = false;
        editor.transaction('External resize', (tx) => tx.add({type: 'resize-notes', noteIds: [a], durationQuarters: [4, 1]}));
      }
    });
    pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 126, 490);
    pointer(renderer.surface, 'pointermove', 352, 490); pointer(renderer.surface, 'pointerup', 352, 490);
    expect(editor.getSnapshot().documentRevision).toBe(1); expect(editor.score.getNote(a)!.duration.quarters.toString()).toBe('4');
    expect(commits).not.toHaveBeenCalled(); expect(previews).not.toHaveBeenCalled();
    off(); renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('rejects a gesture commit when cancellation redirects its selection', () => {
    const {editor, editing, renderer, host, commits} = mounted();
    pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 70, 490);
    pointer(renderer.surface, 'pointermove', 86, 490);
    expect(editing.state.interaction.draft).toBeDefined();
    let cancelledPublications = 0;
    const off = editing.subscribe((state) => {
      if (!state.interaction.draft && ++cancelledPublications === 2) editing.select([b]);
    });
    pointer(renderer.surface, 'pointerup', 86, 490);
    expect(editing.state.interaction.selectedNoteIds).toEqual([b]);
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(editor.score.getNote(a)!.onsetQuarters.toString()).toBe('1');
    expect(commits).not.toHaveBeenCalled();
    off(); renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('stays disposed when its gesture cancellation callback dispatches another command', () => {
    const {editor, editing, renderer, host, commits} = mounted();
    pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 70, 490);
    pointer(renderer.surface, 'pointermove', 86, 490);
    let pending = true;
    const off = editing.session.subscribe((snapshot) => {
      if (pending && !snapshot.draft) {
        pending = false;
        renderer.surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
      }
    });
    renderer.dispose();
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(editing.state.interaction.draft).toBeUndefined();
    expect(renderer.element.isConnected).toBe(false); expect(commits).not.toHaveBeenCalled();
    off(); editing.dispose(); editor.dispose();
  });

  it('draws an inserted-note draft with Alt-drag and discards the last valid draft after an invalid move', () => {
    const {editor, editing, renderer, host, commits} = mounted();
    pointer(renderer.surface, 'pointerdown', 320, 410, {altKey: true});
    pointer(renderer.surface, 'pointermove', 352, 410);
    expect(editor.score.parts[0].notes).toHaveLength(2);
    expect(host.querySelector('[data-draft="true"]')).toBeTruthy();
    pointer(renderer.surface, 'pointerup', 352, 410);
    expect(editor.score.parts[0].notes).toHaveLength(3);
    expect(editor.score.parts[0].notes.find((note) => note.onsetQuarters.eq(new Rational(5)))!.duration.quarters.toJSON()).toEqual([1, 2]);
    expect(commits).toHaveBeenCalledOnce();
    pointer(host.querySelector('[data-note-id="a"]')!, 'pointerdown', 70, 490);
    pointer(renderer.surface, 'pointermove', 86, 490);
    pointer(renderer.surface, 'pointermove', -100, 490);
    pointer(renderer.surface, 'pointerup', -100, 490);
    expect(editor.score.getNote(a)!.onsetQuarters.toJSON()).toEqual([1, 1]);
    expect(editor.getState().history.undoCount).toBe(1);
    renderer.dispose(); editing.dispose(); editor.dispose();
  });

  it('does not cancel another surface’s shared draft when a passive surface disconnects', () => {
    const editor = createScoreEditor(fixture()); const shared = editor.createInteractionSession();
    const editing = createScoreViewEditing(editor, {interactionSession: shared, editable: true});
    const host = document.createElement('div'); document.body.append(host);
    const renderer = mountPianoRollEditor(host, editing);
    shared.preview([move]); renderer.dispose(); editing.dispose();
    expect(shared.getSnapshot().draft).toBeDefined(); expect(shared.getSnapshot().disposed).toBe(false); editor.dispose();
  });
});

describe('score-view editor composition', () => {
  it('renders object-bound editing, commits events, rejects conflicts and releases only owned sessions', () => {
    const editor = createScoreEditor(fixture()); const view = document.createElement('editing-score-view') as ScoreViewElement;
    view.editor = editor; view.editable = true; document.body.append(view);
    expect(view.getAttribute('data-editor-state')).toBe('ready'); expect(view.querySelector('[part="editing-surface"]')).toBeTruthy();
    const session = view.interactionSession!; const commit = vi.fn(); view.addEventListener('editcommit', commit);
    session.setSelection([a]); view.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(commit).toHaveBeenCalledOnce();
    expect(() => { view.score = fixture(); }).toThrow(/source-conflict/);
    view.setAttribute('src', 'conflict.mid'); expect(view.getAttribute('data-editor-state')).toBe('source-conflict');
    view.removeAttribute('src'); expect(view.getAttribute('data-editor-state')).toBe('ready');
    const current = view.interactionSession!; view.remove(); expect(current.getSnapshot().disposed).toBe(true);
    expect(editor.getSnapshot().status).toBe('ready'); editor.dispose();
  });

  it('resolves and replaces same-root declaration sources while respecting object precedence', async () => {
    const first = createScoreEditor(fixture()); const second = createScoreEditor(fixture());
    const declaration = document.createElement('div') as HTMLDivElement & {editor: typeof first}; declaration.id = 'doc'; declaration.editor = first;
    const view = document.createElement('editing-score-view') as ScoreViewElement; view.setAttribute('editor', '#doc'); view.editable = true;
    document.body.append(declaration, view); expect(view.editor).toBe(first);
    declaration.editor = second; declaration.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true})); expect(view.editor).toBe(second);
    view.editor = first; declaration.editor = second; declaration.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true})); expect(view.editor).toBe(first);
    view.editor = undefined; expect(view.editor).toBe(second);
    declaration.remove(); await new Promise((resolve) => setTimeout(resolve, 0)); expect(view.getAttribute('data-editor-state')).toBe('missing');
    view.remove(); first.dispose(); second.dispose();
  });

  it('suppresses old playback and clears overlays when the player is detached', () => {
    const editor = createScoreEditor(fixture());
    const source = playback(editor, {activeNotes: [{occurrenceId: 'a', noteId: a, partId: p, midi: 60, nominalStartSeconds: .45, nominalEndSeconds: .93}]});
    const player = document.createElement('div') as HTMLDivElement & {playback: {snapshot(): ScorePlaybackSnapshot; subscribe(listener: (snapshot: ScorePlaybackSnapshot) => void): () => void}};
    player.id = 'player'; player.playback = {snapshot: () => source, subscribe: (listener) => { listener(source); return () => {}; }};
    const view = document.createElement('editing-score-view') as ScoreViewElement;
    view.editor = editor; view.setAttribute('player', '#player'); document.body.append(player, view);
    expect(view.querySelector('[data-playhead]')).toBeTruthy();
    expect(view.active).toEqual([60]);
    view.type = 'map'; expect(view.active).toEqual([]);
    view.type = 'thumbnail'; expect(view.active).toEqual([]);
    view.type = 'piano-roll'; expect(view.active).toEqual([60]);
    editor.transaction('Move', (tx) => tx.add(move)); expect(view.querySelector('[data-playhead]')).toBeNull();
    view.removeAttribute('player'); expect(view.querySelector('[data-playhead]')).toBeNull();
    expect(view.querySelector('[part="editor"]')!.getAttribute('data-playback-state')).toBe('unbound');
    view.remove(); editor.dispose();
  });
});
