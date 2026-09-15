// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {renderStaffVisualizer} from '../../src/view/render';
import {ScrollType} from '../../src/view/render/renderers/staff';
import type {StaffRenderOptions} from '../../src/view/api';
import {parseMusicXML} from '../../src/io';
import {Tuplet} from 'vexflow/bravura';

type Input = {pitch: number; start: number; duration: number; staff?: number; part?: number; voice?: string};
const q = (value: number) => Rational.from(value);
function fixture(notes: Input[], config: StaffRenderOptions = {}, initialWidth = 240) {
  const builder = new ScoreBuilder();
  const parts = new Map<number, ReturnType<typeof PartId>>();
  for (const [index, note] of notes.entries()) {
    const partIndex = note.part ?? 0;
    let part = parts.get(partIndex);
    if (!part) {
      part = PartId(`part-${partIndex}`);
      builder.addPart({id: part, name: 'Part', staves: Math.max(1, ...notes.filter((other) => (other.part ?? 0) === partIndex).map((other) => other.staff ?? 1))});
      parts.set(partIndex, part);
    }
    builder.addNote(part, {id: NoteId(`note-${index}`), pitch: Pitch.fromMidi(note.pitch), onsetQuarters: q(note.start),
      duration: new Duration({base: q(note.duration)}), staff: note.staff, voice: VoiceId(note.voice ?? `staff-${note.staff ?? 1}`)});
  }
  builder.addTempo({atQuarters: q(0), bpm: 120});
  builder.addTempo({atQuarters: q(4), bpm: 60});
  const score = builder.build();
  let width = initialWidth;
  const host = document.createElement('div');
  host.getBoundingClientRect = () => ({width, height: 180, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 180, toJSON() { return {}; }});
  document.body.append(host);
  const rendered = renderStaffVisualizer(score, host, config);
  const rows = [...host.querySelectorAll<SVGElement>('[data-webscore-staff-layer]')];
  const viewport = host.querySelector<HTMLElement>('[data-webscore-staff-timeline]')!;
  const cursor = host.querySelector<HTMLElement>('[data-webscore-staff-playhead]')!;
  const active = () => [...host.querySelectorAll<SVGElement>('[data-webscore-note][data-active]')]
    .map((element) => Number(element.dataset.webscoreNote)).sort((a, b) => a - b);
  return {host, score, rendered, rows, viewport, cursor, active, setWidth: (value: number) => { width = value; }};
}
function headX(element: Element): number {
  const path = element.querySelector('path')!;
  return Number(/M\s*(-?[\d.]+)/i.exec(path.getAttribute('d')!)![1]);
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('staff shared musical timeline', () => {
  it('aligns simultaneous exact onsets across staves with unequal rhythms in one native scroll region', () => {
    const {host, rendered, rows, viewport} = fixture([
      {pitch: 60, start: 0, duration: .5}, {pitch: 62, start: .5, duration: .5}, {pitch: 64, start: 1, duration: 1},
      {pitch: 60, start: 2, duration: 1}, {pitch: 60, start: 6, duration: 1},
      {pitch: 60, start: 0, duration: 2, staff: 2}, {pitch: 60, start: 2, duration: 2, staff: 2},
      {pitch: 60, start: 6, duration: 8, staff: 2},
    ]);
    for (const onset of ['2', '6']) {
      const heads = rows.map((row) => row.querySelector(`[data-webscore-onset="${onset}"] [data-webscore-note]`)!);
      // Filled and open heads have slightly different glyph-outline bearings.
      expect(Math.abs(headX(heads[0]) - headX(heads[1]))).toBeLessThan(1);
    }
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(viewport.contains(rows[0]) && viewport.contains(rows[1])).toBe(true);
    expect(host.querySelectorAll('[data-webscore-system-brace]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-webscore-system-connector]')).toHaveLength(1);
    rendered.redrawAtTime!(5, true);
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    rendered.redrawAtTime!(0, true);
    expect(viewport.scrollLeft).toBe(0);
    expect(host.querySelectorAll('[data-webscore-staff-playhead]')).toHaveLength(1);
    rendered.dispose!();
    expect(host.children).toHaveLength(0);
  });

  it('highlights every sounding staff, handles partial overlaps and uses half-open ends', () => {
    const {rendered, active} = fixture([
      {pitch: 72, start: 0, duration: 4, voice: 'first'}, {pitch: 76, start: 2, duration: 3, voice: 'second'},
      {pitch: 48, start: 0, duration: 1, staff: 2}, {pitch: 50, start: 2, duration: 4, staff: 2},
    ]);
    rendered.redrawAtTime!(1.5, false);
    expect([...new Set(active())]).toEqual([50, 72, 76]);
    rendered.redrawAtTime!(2, false);
    expect([...new Set(active())]).toEqual([50, 76]);
    rendered.redrawAtTime!(4, false);
    expect(active()).toEqual([]);
    rendered.redrawAtTime!(.25, false);
    expect(active()).toEqual([48, 72]);
    rendered.clearActiveNotes();
    expect(active()).toEqual([]);
    expect(() => rendered.redrawAtTime!(Number.NaN)).toThrow(RangeError);
    rendered.dispose!();
  });

  it('integrates tempo changes while the playhead advances through a measure of silence', () => {
    const {host, rendered, cursor} = fixture([{pitch: 72, start: 0, duration: 1}, {pitch: 50, start: 8, duration: 1, staff: 2}], {pixelsPerSecond: 40});
    const positions = [2, 3, 4, 5].map((seconds) => rendered.redrawAtTime!(seconds, false)!);
    expect(positions[1] - positions[0]).toBeCloseTo(positions[2] - positions[1]);
    expect(positions[2] - positions[1]).toBeCloseTo(positions[3] - positions[2]);
    expect(positions[1]).toBeGreaterThan(positions[0]);
    expect(host.querySelectorAll('[data-active]')).toHaveLength(0);
    expect(cursor.dataset.time).toBe('5');
    rendered.dispose!();
  });

  it.each([ScrollType.PAGE, ScrollType.NOTE, ScrollType.BAR])('supports manual pan and backward follow in scroll mode %s', (scrollType) => {
    const {rendered, viewport, rows} = fixture([
      {pitch: 72, start: 0, duration: 1}, {pitch: 76, start: 12, duration: 1}, {pitch: 48, start: 0, duration: 16, staff: 2},
    ], {scrollType, pixelsPerSecond: 80});
    viewport.scrollLeft = 180;
    viewport.dispatchEvent(new Event('scroll'));
    expect(rows.every((row) => viewport.contains(row))).toBe(true);
    rendered.redrawAtTime!(10, true);
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    rendered.redrawAtTime!(0, true);
    expect(viewport.scrollLeft).toBe(0);
    const remove = vi.spyOn(viewport, 'removeEventListener');
    rendered.dispose!();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(() => rendered.redrawAtTime!(2)).not.toThrow();
  });

  it('keeps identical staff numbers from separate parts separate and highlights both duplicate unisons', () => {
    const {rendered, rows, active} = fixture([{pitch: 60, start: 0, duration: 4}, {pitch: 60, start: 0, duration: 4, part: 1}]);
    expect(rows).toHaveLength(2);
    rendered.redrawAtTime!(1);
    expect(active()).toEqual([60, 60]);
    rendered.dispose!();
  });

  it.each([ScrollType.BAR, ScrollType.PAGE])('keeps the first note beyond the fixed signature header after mode %s returns to zero', (scrollType) => {
    const {host, rendered, viewport, cursor, active} = fixture(
      Array.from({length: 48}, (_, index) => ({pitch: 72, start: index / 2, duration: .5})), {scrollType});
    const boundary = parseFloat(host.querySelector<HTMLElement>('[data-webscore-staff-divider]')!.style.left);
    rendered.redrawAtTime!(12, true);
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    rendered.redrawAtTime!(0, true);
    expect(active()).toEqual([72]);
    expect(cursor.hidden).toBe(false);
    expect(parseFloat(cursor.style.left)).toBeGreaterThanOrEqual(boundary);
    const svg = host.querySelector<SVGSVGElement>('[data-webscore-staff-drawing]')!;
    const scale = Number(svg.getAttribute('width')) / Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    expect(headX(host.querySelector('[data-note-id="note-0"]')!) * scale).toBeGreaterThanOrEqual(boundary);
    rendered.dispose!();
  });

  it('keeps the playhead visible when one measure exceeds the viewport', () => {
    const {rendered, viewport, cursor} = fixture([{pitch: 72, start: 0, duration: 4}, {pitch: 48, start: 0, duration: 4, staff: 2}], {
      scrollType: ScrollType.BAR, pixelsPerSecond: 300,
    });
    rendered.redrawAtTime!(1.5, true);
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    expect(cursor.hidden).toBe(false);
    expect(parseFloat(cursor.style.left)).toBeLessThan(240);
    rendered.redrawAtTime!(0, true);
    expect(viewport.scrollLeft).toBe(0);
    rendered.dispose!();
  });

  it.each([true, false])('retains a hidden layout follow request (%s) on resize and releases its observer', (follow) => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const {rendered, viewport, cursor, setWidth} = fixture([{pitch: 72, start: 0, duration: 20}], {pixelsPerSecond: 300}, 0);
    rendered.redrawAtTime!(6, follow);
    setWidth(240);
    resize();
    expect(cursor.dataset.time).toBe('6');
    expect(cursor.hidden).toBe(!follow);
    expect(viewport.scrollLeft > 0).toBe(follow);
    if (follow) {
      viewport.scrollLeft = 50;
      viewport.dispatchEvent(new Event('scroll'));
      setWidth(180);
      resize();
      expect(viewport.scrollLeft).toBe(50);
    }
    rendered.dispose!();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each([true, false])('clips music behind one signature divider on a transparent host with splitStaves=%s', (splitStaves) => {
    const {host, rendered, viewport, rows} = fixture([
      {pitch: 72, start: 0, duration: 2}, {pitch: 74, start: 2, duration: 2}, {pitch: 48, start: 0, duration: 4, staff: 2},
    ], {splitStaves, pixelsPerSecond: 160});
    expect(getComputedStyle(host).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(rows.length).toBe(splitStaves ? 2 : 1);
    const dividers = host.querySelectorAll<HTMLElement>('[data-webscore-staff-divider]');
    expect(dividers).toHaveLength(1);
    const boundary = parseFloat(dividers[0].style.left);
    expect(boundary).toBeGreaterThan(0);
    const drawing = host.querySelector<SVGSVGElement>('[data-webscore-staff-drawing]')!;
    const checkClip = () => {
      expect(viewport.style.clipPath).toBe('');
      const clip = Number(/inset\(0 0 0 ([\d.]+)px\)/.exec(drawing.style.clipPath)![1]);
      expect(clip - viewport.scrollLeft).toBeCloseTo(boundary);
    };
    checkClip();
    rendered.redrawAtTime!(1.5, true);
    checkClip();
    expect(host.querySelectorAll('animate')).toHaveLength(0);
    rendered.dispose!();
    expect(host.children).toHaveLength(0);
  });

  it('renders authored triplet beams at exact rational onsets with the source clef and hidden rest', () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>C</sign><line>3</line></clef></attributes><note print-object="no"><rest/><duration>3</duration><voice>alto</voice><type>quarter</type></note>${['C', 'D', 'E'].map((step, index) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>alto</voice><type>eighth</type><stem>up</stem><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">${['begin', 'continue', 'end'][index]}</beam>${index !== 1 ? `<notations><tuplet type="${index === 0 ? 'start' : 'stop'}" bracket="no"/></notations>` : ''}</note>`).join('')}</measure></part></score-partwise>`;
    const host = document.createElement('div');
    document.body.append(host);
    const score = parseMusicXML(xml);
    const rendered = renderStaffVisualizer(score, host);
    const events = [...host.querySelectorAll<SVGElement>('[data-webscore-onset]')];
    expect(events.map((event) => event.dataset.webscoreOnset)).toEqual(['0', '1', '4/3', '5/3']);
    expect(events[0].getAttribute('visibility')).toBe('hidden');
    expect(new Set(events.map((event) => event.dataset.webscoreVoice))).toEqual(new Set(['P1-alto']));
    expect(host.querySelectorAll('[data-webscore-beam]').length).toBe(1);
    expect(host.querySelectorAll('[data-webscore-tuplet="3"]').length).toBe(1);
    // C4 is on the middle line in alto clef; inferred treble would put it
    // on a ledger line below the stave (near y=90 in local coordinates).
    const firstHeadY = Number(/M\s*-?[\d.]+\s+(-?[\d.]+)/i.exec(events[1].querySelector('[data-webscore-note] path')!.getAttribute('d')!)![1]);
    expect(firstHeadY).toBeGreaterThan(50);
    expect(firstHeadY).toBeLessThan(70);
    rendered.dispose!();
  });

  it('groups unequal written values into one complete tuplet without absorbing the following group', () => {
    const groups: Array<Array<string | undefined>> = [];
    const draw = Tuplet.prototype.draw;
    vi.spyOn(Tuplet.prototype, 'draw').mockImplementation(function (this: Tuplet) {
      groups.push(this.getNotes().map((note) => note.getSVGElement()?.dataset.webscoreOnset));
      return draw.call(this);
    });
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: PartId('p'), name: 'Part'});
    for (const [index, [onset, base]] of [[0, .5], [1 / 3, 1], [1, .5], [4 / 3, .5], [5 / 3, .5]].entries()) {
      const exactOnset = new Rational(Math.round(onset * 3), 3);
      builder.addNote(part, {id: NoteId(`triplet-${index}`), pitch: Pitch.parse('C4'), onsetQuarters: exactOnset,
        duration: new Duration({base, tuplet: [3, 2]}), voice: VoiceId('melody')});
    }
    const host = document.createElement('div');
    document.body.append(host);
    const rendered = renderStaffVisualizer(builder.build(), host);
    expect(host.querySelectorAll('[data-webscore-tuplet="3"]').length).toBe(2);
    expect(groups).toEqual([['0', '1/3'], ['1', '4/3', '5/3']]);
    expect([...host.querySelectorAll<SVGElement>('[data-webscore-onset]')].map((event) => event.dataset.webscoreOnset))
      .toEqual(['0', '1/3', '1', '4/3', '5/3']);
    rendered.dispose!();
  });
});
