// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type ScorePlaybackSnapshot} from '../../src/core';
import {createScoreEditor} from '../../src/edit/headless';
import {createScoreViewEditing} from '../../src/view/headless/score-editing';
import {createStaffViewEditing} from '../../src/view/headless/staff-editing';
import {mountStaffEditor} from '../../src/view/render/staff-editor';
import {mountPianoRollEditor} from '../../src/view/render/piano-roll-editor';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('staff-editing-score-view', ScoreViewElement);
const partId = PartId('piano');
function score() {
  const builder = new ScoreBuilder(); builder.addPart({id: partId, name: 'Piano'});
  for (let number = 1; number <= 2; number++) {
    builder.addMeasure({id: builder.newMeasureId(), number, onsetQuarters: new Rational((number - 1) * 4), durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
    builder.addNote(partId, {id: NoteId(`rest-${number}`), pitch: Pitch.parse('C4'), rest: true,
      onsetQuarters: new Rational((number - 1) * 4), duration: Duration.whole(), voice: VoiceId('1')});
  }
  return builder.build();
}
function key(target: Element, value: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...extra});
  target.dispatchEvent(event); return event;
}
function mounted() {
  const editor = createScoreEditor(score()); const editing = createScoreViewEditing(editor, {editable: true});
  const staff = createStaffViewEditing(editing); const host = document.createElement('div'); document.body.append(host);
  const commits = vi.fn(); const errors = vi.fn();
  const renderer = mountStaffEditor(host, staff, {onCommit: commits, onError: errors});
  return {editor, editing, staff, host, renderer, commits, errors, dispose() { renderer.dispose(); staff.dispose(); editing.dispose(); editor.dispose(); }};
}
function field(host: Element, label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  input.focus(); input.value = value; input.dispatchEvent(new Event('change', {bubbles: true}));
}
function button(host: Element, label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === label)!;
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('staff notation editing surface', () => {
  it('arms pitch entry explicitly, preserves focus across commits, and shares undo/redo', () => {
    const item = mounted(); const {editor, renderer, host, commits} = item;
    renderer.surface.focus();
    key(renderer.surface, 'a'); expect(editor.getSnapshot().documentRevision).toBe(0);
    key(renderer.surface, 'n'); key(renderer.surface, '4'); key(renderer.surface, 'a');
    const note = editor.score.parts[0].notes.find((note) => !note.rest)!;
    expect(note.pitch.toString()).toBe('A4'); expect(note.duration.quarters.toJSON()).toEqual([1, 2]);
    expect(commits).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(renderer.surface);
    expect(host.querySelector('[data-staff-input-cursor]')?.getAttribute('data-quarters')).toBe('0.5');
    key(renderer.surface, 'b', {repeat: true}); expect(commits).toHaveBeenCalledOnce();
    key(renderer.surface, 'Escape'); expect(renderer.surface.dataset.inputEnabled).toBe('false');
    key(renderer.surface, 'c'); expect(commits).toHaveBeenCalledOnce();
    key(renderer.surface, 'z', {ctrlKey: true}); expect(editor.score.parts[0].notes.every((note) => note.rest)).toBe(true);
    key(renderer.surface, 'z', {metaKey: true, shiftKey: true}); expect(editor.score.parts[0].notes.some((note) => !note.rest)).toBe(true);
    expect(editor.getState().history.undoCount).toBe(1); item.dispose();
  });

  it('uses exact accessible fields for cursor, voice, duration and written spelling', () => {
    const item = mounted(); const {host, editor, renderer} = item;
    field(host, 'Cursor (quarters)', '4'); field(host, 'Voice', '2'); field(host, 'Duration (quarters)', '1/2');
    field(host, 'Octave', '5'); field(host, 'Accidental', '-1'); field(host, 'Pitch letter', 'D');
    key(host.querySelector('[aria-label="Voice"]')!, 'Delete'); expect(editor.getSnapshot().documentRevision).toBe(0);
    button(host, 'Insert note').click();
    const note = editor.score.parts[0].notes.find((note) => !note.rest)!;
    expect([note.pitch.toString(), note.voice, note.onsetQuarters.toString(), note.duration.quarters.toString()]).toEqual(['Db5', '2', '4', '1/2']);
    expect(editor.score.parts[0].notes.filter((note) => note.voice === VoiceId('2')).reduce((sum, note) => sum + note.duration.quarters.toFloat(), 0)).toBe(4);
    expect(renderer.surface.dataset.inputEnabled).toBe('false');
    field(host, 'Cursor (quarters)', '4/0'); button(host, 'Insert rest').click();
    expect(editor.getSnapshot().documentRevision).toBe(1); expect(item.errors).toHaveBeenCalled(); item.dispose();
  });

  it('selects notes and authored rests, replacing a selection with one undoable rest', () => {
    const item = mounted(); const {editor, renderer, host, staff} = item;
    key(renderer.surface, 'n'); key(renderer.surface, 'c');
    const note = editor.score.parts[0].notes.find((note) => !note.rest)!;
    host.querySelector<SVGElement>(`[data-note-id="${note.id}"]`)!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(staff.state.onsetQuarters.toString()).toBe('0');
    expect(host.querySelector(`[data-note-id="${note.id}"][data-selected]`)).toBeTruthy();
    expect(host.querySelector('[part="editing-status"]')?.textContent).toContain('Selected 1: C4');
    key(renderer.surface, 'Delete'); expect(editor.score.parts[0].notes.every((note) => note.rest)).toBe(true);
    key(renderer.surface, 'z', {ctrlKey: true}); expect(editor.score.getNote(note.id)?.pitch.toString()).toBe('C4');
    host.querySelector<SVGElement>('[data-note-id="rest-2"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(staff.state.onsetQuarters.toString()).toBe('4'); expect(staff.state.duration.quarters.toString()).toBe('4'); item.dispose();
  });

  it('updates the numeric cursor while an insert button retains focus', () => {
    const item = mounted();
    const insert = button(item.host, 'Insert note'); insert.focus(); insert.click();
    const cursor = item.host.querySelector<HTMLInputElement>('[aria-label="Cursor (quarters)"]')!;
    expect(document.activeElement).toBe(insert); expect(cursor.value).toBe('1');
    insert.click(); expect(cursor.value).toBe('2');
    expect(item.editor.score.parts[0].notes.filter((note) => !note.rest).map((note) => note.onsetQuarters.toString())).toEqual(['0', '1']);
    item.dispose();
  });

  it('applies a focused numeric field before Enter submits without requiring blur', () => {
    const item = mounted();
    expect(button(item.host, 'Insert note').type).toBe('submit');
    const cursor = item.host.querySelector<HTMLInputElement>('[aria-label="Cursor (quarters)"]')!;
    cursor.focus(); cursor.value = '4';
    item.host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(item.editor.score.parts[0].notes.find((note) => !note.rest)?.onsetQuarters.toString()).toBe('4');
    expect(document.activeElement).toBe(cursor); expect(cursor.value).toBe('5'); item.dispose();
  });

  it('retains a pending cursor across other field changes and applies it when the button submits', () => {
    const item = mounted(); const {host, renderer, editor} = item;
    key(renderer.surface, 'n'); key(renderer.surface, 'd'); key(renderer.surface, 'Escape');
    const cursor = host.querySelector<HTMLInputElement>('[aria-label="Cursor (quarters)"]')!;
    cursor.focus(); cursor.value = '4'; cursor.dispatchEvent(new Event('input', {bubbles: true}));
    // Moving among controls need not deliver a change/blur event for the old field.
    field(host, 'Duration (quarters)', '1/2'); field(host, 'Pitch letter', 'F'); field(host, 'Accidental', '1');
    expect(cursor.value).toBe('4');
    const insert = button(host, 'Insert note'); insert.focus(); insert.click();
    const note = editor.score.parts[0].notes.find((note) => !note.rest && note.onsetQuarters.eq(new Rational(4)))!;
    expect(note.pitch.toString()).toBe('F#4'); expect(note.duration.quarters.toString()).toBe('1/2');
    expect(editor.getSnapshot().documentRevision).toBe(2); expect(cursor.value).toBe('9/2');
    expect(item.errors).not.toHaveBeenCalled(); item.dispose();
  });

  it('keeps the cursor and selection independent of playback revisions and exposes pending state', () => {
    const item = mounted(); const {editor, renderer, host, staff} = item;
    key(renderer.surface, 'n'); key(renderer.surface, 'c'); staff.setCursor([4, 1]);
    const document = editor.getSnapshot();
    const playback: ScorePlaybackSnapshot = {revision: 1, sourceRevision: 1, readiness: 'ready', state: 'paused', score: document.content,
      nominalSeconds: 0, nominalDurationSeconds: 4, transportSeconds: 0, transportDurationSeconds: 4, rate: 1, activeNotes: [],
      documentId: document.documentId, documentRevision: document.documentRevision,
      documentBinding: {status: 'ready', attempt: 1, requested: document, applied: document, documentCoordinates: true, positionPolicy: 'preserve-quarter'}};
    renderer.updatePlayback(playback);
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-playback-state')).toBe('ready');
    expect(host.querySelector('[data-staff-input-cursor]')?.getAttribute('data-quarters')).toBe('4');
    expect(host.querySelector('[data-webscore-staff-playhead]')?.getAttribute('data-time')).toBe('0');
    key(renderer.surface, 'd');
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-playback-state')).toBe('pending');
    expect(host.querySelector<HTMLElement>('[data-webscore-staff-playhead]')?.hidden).toBe(true); item.dispose();
  });

  it('shows and cancels a piano-roll draft from an explicitly shared session without committing it', () => {
    const item = mounted(); const {editor, editing, renderer, host, commits} = item;
    key(renderer.surface, 'n'); key(renderer.surface, 'c'); renderer.surface.focus();
    const note = editor.score.parts[0].notes.find((note) => !note.rest)!;
    const pianoEditing = createScoreViewEditing(editor, {editable: true, interactionSession: editing.session});
    const pianoHost = document.createElement('div'); document.body.append(pianoHost);
    const piano = mountPianoRollEditor(pianoHost, pianoEditing);
    const snapshot = editor.getSnapshot();
    renderer.updatePlayback({revision: 1, sourceRevision: 1, readiness: 'ready', state: 'paused', score: snapshot.content,
      nominalSeconds: 0, nominalDurationSeconds: 4, transportSeconds: 0, transportDurationSeconds: 4, rate: 1, activeNotes: [],
      documentId: snapshot.documentId, documentRevision: snapshot.documentRevision,
      documentBinding: {status: 'ready', attempt: 1, requested: snapshot, applied: snapshot, documentCoordinates: true, positionPolicy: 'preserve-quarter'}});
    pianoEditing.select([note.id]);
    expect(pianoEditing.preview([{type: 'transpose-notes', noteIds: [note.id], semitones: 7}]).status).toBe('preview');
    expect(host.querySelector(`[data-note-id="${note.id}"]`)?.getAttribute('data-webscore-note')).toBe('67');
    expect(pianoHost.querySelector(`[data-note-id="${note.id}"]`)?.getAttribute('aria-label')).toContain('G4');
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-edit-state')).toBe('draft');
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-playback-state')).toBe('pending');
    expect(host.querySelector<HTMLElement>('[data-webscore-staff-playhead]')?.hidden).toBe(true);
    expect(document.activeElement).toBe(renderer.surface); expect(editor.getSnapshot()).toBe(snapshot);
    expect(editor.score.getNote(note.id)?.pitch.toString()).toBe('C4'); expect(commits).toHaveBeenCalledOnce();
    pianoEditing.cancel();
    expect(host.querySelector(`[data-note-id="${note.id}"]`)?.getAttribute('data-webscore-note')).toBe('60');
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-playback-state')).toBe('ready');
    expect(editor.getState().history.undoCount).toBe(1); expect(document.activeElement).toBe(renderer.surface);
    piano.dispose(); pianoEditing.dispose(); item.dispose();
  });

  it('reveals a moved input cursor, gates readonly commands, and releases only its observers', () => {
    const item = mounted(); const {editing, staff, renderer, editor, host} = item;
    const container = host.querySelector<HTMLElement>('[part="drawing"] > div')!;
    container.getBoundingClientRect = () => ({width: 220, height: 100, left: 0, right: 220, top: 0, bottom: 100, x: 0, y: 0, toJSON() { return {}; }});
    staff.setCursor([7, 1]);
    expect(host.querySelector<HTMLElement>('[data-webscore-staff-timeline]')!.scrollLeft).toBeGreaterThan(0);
    editing.setEditable(false); key(renderer.surface, 'n'); key(renderer.surface, 'c');
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(renderer.surface.getAttribute('aria-disabled')).toBe('true');
    renderer.dispose(); renderer.dispose(); expect(editor.getSnapshot().status).toBe('ready');
    expect(editing.session.getSnapshot().disposed).toBe(false); staff.dispose(); editing.dispose(); editor.dispose();
  });

  it('keeps authored staff-two input visible in its own part when staves are combined', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)});
    for (const [id, name] of [['piano', 'Piano'], ['organ', 'Organ']] as const) {
      const part = PartId(id); builder.addPart({id: part, name, staves: 2});
      for (const staff of [1, 2]) builder.addNote(part, {id: NoteId(`${id}-${staff}`), pitch: Pitch.parse(staff === 1 ? 'C4' : 'C3'),
        onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId(String(staff)), staff});
    }
    const editor = createScoreEditor(builder.build());
    const editing = createScoreViewEditing(editor, {editable: true}); const staff = createStaffViewEditing(editing);
    const host = document.createElement('div'); document.body.append(host);
    const renderer = mountStaffEditor(host, staff, {splitStaves: false});
    const cursor = () => host.querySelector<HTMLElement>('[data-staff-input-cursor]')!;
    staff.select(NoteId('piano-1')); const firstPartTop = cursor().style.top;
    staff.select(NoteId('piano-2'));
    expect(cursor().hidden).toBe(false); expect(cursor().style.top).toBe(firstPartTop);
    staff.select(NoteId('organ-2'));
    expect(cursor().hidden).toBe(false); expect(cursor().dataset.staff).toBe('2');
    expect(Number.parseFloat(cursor().style.top)).toBeGreaterThan(Number.parseFloat(firstPartTop));
    key(renderer.surface, 'n'); key(renderer.surface, 'b');
    expect(editor.score.getPart(PartId('organ'))!.notes.find((note) => note.staff === 2)?.pitch.toString()).toBe('B3');
    expect(staff.state.staff).toBe(2); expect(cursor().hidden).toBe(false);
    expect(host.querySelectorAll('[data-webscore-staff-layer]')).toHaveLength(2);
    renderer.dispose(); staff.dispose(); editing.dispose(); editor.dispose();
  });

  it('rejects an empty octave field instead of entering octave 0', () => {
    const item = mounted();
    field(item.host, 'Octave', '');
    expect(item.staff.state.octave).toBe(4); expect(item.errors).toHaveBeenCalledOnce();
    expect(item.host.querySelector('[part="editing-status"]')?.textContent).toMatch(/Octave must be an integer/);
    item.dispose();
  });

  it('does not re-apply an unchanged focused field, so entry stays on the selected staff', () => {
    const builder = new ScoreBuilder(); builder.addPart({id: partId, name: 'Piano', staves: 2});
    builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
    for (const staff of [1, 2]) builder.addNote(partId, {id: NoteId(`rest-${staff}`), pitch: Pitch.parse('C4'), rest: true,
      onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId(String(staff)), staff});
    const editor = createScoreEditor(builder.build()); const editing = createScoreViewEditing(editor, {editable: true});
    const staff = createStaffViewEditing(editing); const host = document.createElement('div'); document.body.append(host);
    const renderer = mountStaffEditor(host, staff);
    staff.select(NoteId('rest-2'));
    // Safari keeps focus on the last field when a button is clicked.
    host.querySelector<HTMLSelectElement>('[aria-label="Insert into part"]')!.focus(); button(host, 'Insert note').click();
    const entered = editor.score.parts[0].notes.find((note) => !note.rest)!;
    expect(entered.staff).toBe(2); expect(staff.state.staff).toBe(2);
    renderer.dispose(); staff.dispose(); editing.dispose(); editor.dispose();
  });

  it('leaves Escape to enclosing handlers unless it exits note input', () => {
    const item = mounted();
    expect(key(item.renderer.surface, 'Escape').defaultPrevented).toBe(false);
    key(item.renderer.surface, 'n');
    expect(key(item.renderer.surface, 'Escape').defaultPrevented).toBe(true);
    expect(item.renderer.surface.dataset.inputEnabled).toBe('false'); item.dispose();
  });

  it('rolls back its DOM when mounted on an unavailable controller', () => {
    const editor = createScoreEditor(score()); const editing = createScoreViewEditing(editor, {editable: true});
    const staff = createStaffViewEditing(editing); staff.dispose();
    const host = document.createElement('div'); document.body.append(host);
    expect(() => mountStaffEditor(host, staff)).toThrow(/unavailable/);
    expect(host.childElementCount).toBe(0); editing.dispose(); editor.dispose();
  });

  it('repaints only the playback overlay for playback frames and leaves an unchanged status alone', () => {
    const item = mounted(); const {editor, renderer, host} = item;
    const document = editor.getSnapshot();
    const frame = (nominalSeconds: number): ScorePlaybackSnapshot => ({revision: 1, sourceRevision: 1, readiness: 'ready', state: 'playing', score: document.content,
      nominalSeconds, nominalDurationSeconds: 4, transportSeconds: nominalSeconds, transportDurationSeconds: 4, rate: 1, activeNotes: [],
      documentId: document.documentId, documentRevision: document.documentRevision,
      documentBinding: {status: 'ready', attempt: 1, requested: document, applied: document, documentCoordinates: true, positionPolicy: 'preserve-quarter'}});
    const status = host.querySelector('[part="editing-status"]')!;
    const writes = new MutationObserver(() => {}); writes.observe(status, {childList: true, characterData: true, subtree: true});
    renderer.updatePlayback(frame(0)); renderer.updatePlayback(frame(.5)); renderer.updatePlayback(frame(1));
    expect(writes.takeRecords()).toEqual([]);
    expect(host.querySelector('[data-webscore-staff-playhead]')?.getAttribute('data-time')).toBe('1');
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-playback-state')).toBe('ready');
    writes.disconnect(); item.dispose();
  });

  it('keeps Element staff input settings and armed mode across presentation re-renders', () => {
    const editor = createScoreEditor(score());
    const view = document.createElement('staff-editing-score-view') as ScoreViewElement;
    view.type = 'staff'; view.editor = editor; view.editable = true; document.body.append(view);
    const surface = view.querySelector<HTMLElement>('[part="staff-input-surface"]')!;
    key(surface, 'n'); key(surface, '4'); key(surface, 'ArrowRight'); key(surface, 'ArrowUp');
    view.setAttribute('note-color', '#336699');
    const next = view.querySelector<HTMLElement>('[part="staff-input-surface"]')!;
    expect(next).not.toBe(surface); expect(next.dataset.inputEnabled).toBe('true');
    expect(view.querySelector<HTMLInputElement>('[aria-label="Cursor (quarters)"]')!.value).toBe('1/2');
    key(next, 'c');
    const note = editor.score.parts[0].notes.find((value) => !value.rest)!;
    expect([note.pitch.toString(), note.onsetQuarters.toString(), note.duration.quarters.toString()]).toEqual(['C5', '1/2', '1/2']);
    view.remove(); editor.dispose();
  });

  it('keeps Element input state and focus when another view changes the shared document', () => {
    const editor = createScoreEditor(score());
    const view = document.createElement('staff-editing-score-view') as ScoreViewElement;
    view.type = 'staff'; view.editor = editor; view.editable = true; document.body.append(view);
    const surface = view.querySelector<HTMLElement>('[part="staff-input-surface"]')!;
    expect(view.getAttribute('data-editable-state')).toBe('ready'); surface.focus();
    key(surface, 'n'); key(surface, 'c');
    const note = editor.score.parts[0].notes.find((note) => !note.rest)!;
    editor.transaction('External pitch change', (tx) => tx.add({type: 'transpose-notes', noteIds: [note.id], semitones: 2}));
    expect(view.querySelector('[part="staff-input-surface"]')).toBe(surface); expect(document.activeElement).toBe(surface);
    expect(surface.dataset.inputEnabled).toBe('true');
    view.editable = false; expect(view.querySelector('[part="staff-input-surface"]')).toBeNull();
    expect(view.querySelector('[data-webscore-staff-drawing]')).toBeTruthy();
    const session = view.interactionSession!; view.remove(); expect(session.getSnapshot().disposed).toBe(true);
    expect(editor.getSnapshot().status).toBe('ready'); editor.dispose();
  });
});
