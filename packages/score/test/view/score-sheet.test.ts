// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {scoreToNoteSequence} from '../../src/view/core/note-sequence';
import {projectStaffNotation} from '../../src/view/core/staff-notation';
import {StaffSVGVisualizer} from '../../src/view/render/renderers/staff';
import {mountScoreSheet, sheetPitch, type ScoreSheetHandle} from '../../src/view/render/score-sheet';
import {createScoreEditor} from '../../src/view/headless';
import {createScoreViewEditing} from '../../src/view/headless/score-editing';

const p = PartId('p'); const v = VoiceId('1');
/** Eight 4/4 measures of quarter notes in E major, two staves. */
function fixture(measures = 8): Score {
  const builder = new ScoreBuilder();
  builder.addPart({id: p, name: 'Piano', staves: 2});
  const pitches = ['E4', 'F#4', 'G#4', 'B4'];
  for (let m = 0; m < measures; m += 1) {
    builder.addMeasure({id: MeasureId(`m${m}`), number: m + 1, onsetQuarters: new Rational(m * 4), durationQuarters: new Rational(4),
      ...(m === 0 ? {timeSignature: {numerator: 4, denominator: 4}, keySignature: {fifths: 4}} : {})});
    for (let beat = 0; beat < 4; beat += 1) {
      builder.addNote(p, {id: NoteId(`n${m}-${beat}`), pitch: Pitch.parse(pitches[beat]), onsetQuarters: new Rational(m * 4 + beat),
        duration: Duration.quarter(), voice: v, staff: 1});
    }
    builder.addNote(p, {id: NoteId(`b${m}`), pitch: Pitch.parse('E3'), onsetQuarters: new Rational(m * 4), duration: Duration.whole(), voice: VoiceId('5'), staff: 2});
  }
  return builder.build();
}

function system(score: Score, start: number, end: number, width?: number) {
  const projection = projectStaffNotation(score, {});
  return new StaffSVGVisualizer(scoreToNoteSequence(score), document.createElement('div'), {noteHeight: 10, showAnnotations: false}, score,
    {start, end, projection, ...(width === undefined ? {} : {width})});
}

describe('staff systems', () => {
  it('justifies a system to the requested width and keeps the natural width otherwise', () => {
    const score = fixture();
    const natural = system(score, 0, 2).systemMetrics.width;
    const justified = system(score, 0, 2, natural + 300).systemMetrics.width;
    expect(justified).toBeGreaterThan(natural + 290);
    expect(justified).toBeLessThan(natural + 310);
    expect(system(score, 2, 4, 900).measureWidths()).toHaveLength(2);
  });

  it('measures natural widths without drawing', () => {
    const score = fixture();
    const projection = projectStaffNotation(score, {});
    const container = document.createElement('div');
    const widths = new StaffSVGVisualizer(scoreToNoteSequence(score), container, {noteHeight: 10}, score,
      {start: 0, end: projection.measures.length, measureOnly: true, projection}).measureWidths();
    expect(widths).toHaveLength(8);
    expect(widths.every((width) => width > 50)).toBe(true);
    expect(container.childElementCount).toBe(0);
  });

  it('restates the clef and key at every system start', () => {
    const score = fixture();
    const later = system(score, 3, 5);
    const host = (later as unknown as {container: HTMLElement}).container;
    expect(host.querySelector('[data-webscore-system-start]')).not.toBeNull();
    const first = later.measureWidths()[0];
    const plain = system(score, 2, 5).measureWidths()[1];
    // The opening measure carries a clef and four sharps; the same measure mid-system does not.
    expect(first).toBeGreaterThan(plain + 30);
  });
});

describe('pitch helpers', () => {
  it('spells in the key, then naturals, then by direction', () => {
    expect(sheetPitch.spellPitch(66, 4, 1)).toEqual({step: 'F', alter: 1, octave: 4});
    expect(sheetPitch.spellPitch(65, 4, 1)).toEqual({step: 'F', alter: 0, octave: 4});
    expect(sheetPitch.spellPitch(70, 0, 1)).toEqual({step: 'A', alter: 1, octave: 4});
    expect(sheetPitch.spellPitch(70, 0, -1)).toEqual({step: 'B', alter: -1, octave: 4});
    expect(sheetPitch.spellPitch(70, -2, 1)).toEqual({step: 'B', alter: -1, octave: 4});
  });

  it('maps staff positions through the clef', () => {
    const treble = sheetPitch.topLineIndex({sign: 'G', line: 2});
    const bass = sheetPitch.topLineIndex({sign: 'F', line: 4});
    expect(sheetPitch.fromDiatonic(treble, 0)).toEqual({step: 'F', alter: 0, octave: 5});
    expect(sheetPitch.fromDiatonic(treble - 8, 0)).toEqual({step: 'E', alter: 0, octave: 4});
    expect(sheetPitch.fromDiatonic(bass, 0)).toEqual({step: 'A', alter: 0, octave: 3});
    expect(sheetPitch.fromDiatonic(sheetPitch.diatonicIndex({step: 'F', octave: 4}), 4)).toEqual({step: 'F', alter: 1, octave: 4});
  });
});

describe('mountScoreSheet', () => {
  let handle: ScoreSheetHandle | undefined;
  afterEach(() => { handle?.dispose(); handle = undefined; document.body.replaceChildren(); });

  function mount(score: Score, options: Parameters<typeof mountScoreSheet>[2] = {}, editable = false) {
    const host = document.createElement('div');
    document.body.append(host);
    if (!editable) return {host, handle: handle = mountScoreSheet(host, {score}, options)};
    const editor = createScoreEditor(score);
    const editing = createScoreViewEditing(editor, {editable: true});
    handle = mountScoreSheet(host, {editing}, options);
    return {host, handle, editor, editing};
  }
  const key = (host: HTMLElement, value: string, init: KeyboardEventInit = {}) =>
    host.querySelector('[part~="viewport"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: value, bubbles: true, ...init}));

  it('engraves pages of systems and hides the toolbar for a fixed score', () => {
    const {host} = mount(fixture(), {layout: 'page'});
    expect(handle!.layoutInfo.systems).toBeGreaterThan(1);
    expect(host.querySelectorAll('[part~="page"]').length).toBe(handle!.layoutInfo.pages);
    expect((host.querySelector('[part~="toolbar"]') as HTMLElement).hidden).toBe(true);
    expect(host.querySelector('[part~="viewport"]')!.hasAttribute('tabindex')).toBe(false);
  });

  it('switches to the flow layout without pages', () => {
    const {host} = mount(fixture(), {layout: 'flow'});
    expect(host.querySelector('[data-score-sheet]')!.getAttribute('data-layout')).toBe('flow');
    expect(handle!.layoutInfo.pages).toBe(1);
    handle!.configure({layout: 'page'});
    expect(host.querySelector('[data-score-sheet]')!.getAttribute('data-layout')).toBe('page');
  });

  it('shows the offered toolbar groups and takes focus while editable', () => {
    const {host} = mount(fixture(), {features: ['pitch', 'history']}, true);
    expect((host.querySelector('[part~="toolbar"]') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('[data-sheet-action="undo"]')!.closest('[part~="toolbar-group"]') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('[data-sheet-action="input"]')!.closest('[part~="toolbar-group"]') as HTMLElement).hidden).toBe(true);
    expect(host.querySelector('[part~="viewport"]')!.getAttribute('tabindex')).toBe('0');
  });

  it('moves pitch with arrows, octave with the command key and diatonically with Alt+Shift', () => {
    const {host, editor, editing} = mount(fixture(), {}, true);
    editing!.select([NoteId('n0-0')]);
    key(host, 'ArrowUp');
    expect(editor!.score.getNote(NoteId('n0-0'))!.pitch.toString()).toBe('F4');
    key(host, 'ArrowUp');
    expect(editor!.score.getNote(NoteId('n0-0'))!.pitch.toString()).toBe('F#4');
    key(host, 'ArrowUp', {ctrlKey: true});
    expect(editor!.score.getNote(NoteId('n0-0'))!.pitch.toString()).toBe('F#5');
    key(host, 'ArrowDown', {altKey: true, shiftKey: true});
    expect(editor!.score.getNote(NoteId('n0-0'))!.pitch.toString()).toBe('E5');
    key(host, 'z', {ctrlKey: true});
    expect(editor!.score.getNote(NoteId('n0-0'))!.pitch.toString()).toBe('F#5');
  });

  it('walks between events with Left and Right', () => {
    const {host, editing} = mount(fixture(), {}, true);
    editing!.select([NoteId('n0-1')]);
    key(host, 'ArrowRight');
    expect(editing!.state.interaction.selectedNoteIds).toEqual([NoteId('n0-2')]);
    key(host, 'ArrowLeft'); key(host, 'ArrowLeft');
    expect(editing!.state.interaction.selectedNoteIds).toEqual([NoteId('n0-0')]);
  });

  it('turns selected notes into rests with Delete', () => {
    const {host, editor, editing} = mount(fixture(), {}, true);
    editing!.select([NoteId('n1-2')]);
    key(host, 'Delete');
    expect(editor!.score.getNote(NoteId('n1-2'))!.rest).toBe(true);
  });

  it('changes the selected duration with the number keys', () => {
    const {host, editor, editing} = mount(fixture(), {}, true);
    editing!.select([NoteId('n2-0')]);
    key(host, '6');
    const note = editor!.score.getNote(NoteId('n2-0'))!;
    expect(note.duration.quarters.toString()).toBe('2');
    expect(editor!.score.getNote(NoteId('n2-1'))).toBeUndefined();
    expect(handle!.settings.duration).toBe('half');
  });

  it('writes notes in input mode at an advancing cursor', () => {
    const onSettingsChange = vi.fn();
    const {host, editor, editing} = mount(fixture(), {onSettingsChange}, true);
    editing!.select([NoteId('n3-0')]);
    key(host, 'n');
    expect(handle!.settings.inputMode).toBe(true);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({inputMode: true}), 'inputMode');
    key(host, '4');
    key(host, 'a'); key(host, 'c');
    const lane = editor!.score.parts[0].notes.filter((note) => note.voice === v && note.onsetQuarters.gte(new Rational(12)) && note.onsetQuarters.lt(new Rational(13)));
    expect(lane.map((note) => `${note.pitch.toString()}@${note.onsetQuarters}`)).toEqual(['A4@12', 'C#5@25/2']);
    key(host, '0');
    expect(editor!.score.parts[0].notes.find((note) => note.onsetQuarters.eq(new Rational(13)) && note.voice === v)!.rest).toBe(true);
    key(host, 'Escape');
    expect(handle!.settings.inputMode).toBe(false);
  });

  it('re-engraves only the system an edit touches', () => {
    const {host, editing} = mount(fixture(), {layout: 'flow', zoom: 1}, true);
    const drawings = () => [...host.querySelectorAll('[part~="system"]')].map((system) => system.querySelector('svg'));
    const before = drawings();
    expect(before.length).toBeGreaterThan(1);
    editing!.select([NoteId('n0-0')]);
    key(host, 'ArrowUp');
    const after = drawings();
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it('reports what the score cannot take without changing it', () => {
    const onError = vi.fn();
    const {host, editor, editing} = mount(fixture(), {onError}, true);
    const before = editor!.score;
    editing!.select([NoteId('n0-3')]);
    key(host, '7');
    expect(editor!.score).toBe(before);
    expect(onError).toHaveBeenCalled();
    expect(host.querySelector('[part~="message"]')!.textContent).toMatch(/barline/);
  });

  it('withholds features that are not offered', () => {
    const {host, editor, editing} = mount(fixture(), {features: ['history']}, true);
    editing!.select([NoteId('n0-0')]);
    key(host, 'ArrowUp'); key(host, 'Delete'); key(host, '6');
    expect(editor!.score.getNote(NoteId('n0-0'))!.pitch.toString()).toBe('E4');
    expect(editor!.score.getNote(NoteId('n0-0'))!.duration.quarters.toString()).toBe('1');
  });

  it('rejects invalid settings before changing anything', () => {
    mount(fixture());
    expect(() => handle!.configure({layout: 'scroll' as never})).toThrow(RangeError);
    expect(() => handle!.configure({zoom: -1})).toThrow(RangeError);
    expect(handle!.settings.layout).toBe('page');
  });

  it('releases its DOM on dispose', () => {
    const {host} = mount(fixture());
    handle!.dispose();
    expect(host.querySelector('[data-score-sheet]')).toBeNull();
    handle = undefined;
  });
});
