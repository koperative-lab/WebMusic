// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {parseMusicXML} from '../../src/io';
import {projectScoreAnnotations} from '../../src/view/core/annotations';
import {createPianoRollLayout} from '../../src/view/core/layout';
import {drawHorizontalScoreAnnotations} from '../../src/view/render/annotations';
import {renderPianoRollVisualizer, renderWaterfallVisualizer} from '../../src/view/render/renderers/factory';
import {mountScoreThumbnail, renderScoreThumbnail} from '../../src/view/render/thumbnail';

const SVG_NS = 'http://www.w3.org/2000/svg';
function music() {
  return parseMusicXML(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <direction><direction-type><words font-style="italic">rit.</words></direction-type></direction>
    <direction><direction-type><rehearsal>A</rehearsal></direction-type></direction>
    <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
    <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type></direction>
    <direction><direction-type><pedal type="start" line="yes" sign="yes"/></direction-type></direction>
    <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
    <direction print-object="no"><direction-type><words>Hidden instruction</words></direction-type></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="2"><direction><direction-type><wedge type="stop"/></direction-type></direction>
    <direction><direction-type><pedal type="change" line="yes"/></direction-type></direction>
    <direction><direction-type><words>a tempo</words></direction-type><sound tempo="60"/></direction>
    <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="3"><direction print-object="no"><direction-type><pedal type="stop" line="yes"/></direction-type></direction>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    </part></score-partwise>`);
}

function surface(width = 600) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', {value: width, configurable: true});
  document.body.append(host);
  return host;
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('source expression projection', () => {
  it('pairs spans across measures, closes visible spans at hidden stops, and excludes hidden point marks', () => {
    const score = music();
    const annotations = projectScoreAnnotations(score);
    expect(new Set(annotations.map((annotation) => annotation.source.kind)))
      .toEqual(new Set(['words', 'rehearsal', 'dynamics', 'metronome', 'pedal', 'wedge']));
    expect(annotations.some((annotation) => annotation.label === 'Hidden instruction')).toBe(false);
    const pedal = annotations.find((annotation) => annotation.source.kind === 'pedal')!;
    expect([pedal.startQuarters, pedal.endQuarters, pedal.changes]).toEqual([0, 8, [4]]);
    const wedge = annotations.find((annotation) => annotation.source.kind === 'wedge')!;
    expect([wedge.startQuarters, wedge.endQuarters]).toEqual([0, 4]);
    expect(annotations.filter((annotation) => annotation.source.kind === 'rehearsal')).toHaveLength(1);
    expect(score.timeMap.tempi.map((tempo) => tempo.bpm)).toEqual([120, 60]);
  });

  it('keeps numbered spans local to their part and staff and filters by part id or name', () => {
    const builder = new ScoreBuilder();
    const first = builder.addPart({id: builder.newPartId(), name: 'Upper', directions: [
      {kind: 'pedal', type: 'start', staff: 1, onsetQuarters: Rational.ZERO},
      {kind: 'pedal', type: 'start', staff: 2, onsetQuarters: Rational.ONE},
      {kind: 'pedal', type: 'stop', staff: 1, onsetQuarters: new Rational(2)},
      {kind: 'pedal', type: 'stop', staff: 2, onsetQuarters: new Rational(3)},
    ]});
    const second = builder.addPart({id: builder.newPartId(), name: 'Lower', directions: [
      {kind: 'pedal', type: 'start', onsetQuarters: Rational.ONE},
      {kind: 'pedal', type: 'stop', onsetQuarters: new Rational(4)},
    ]});
    builder.addNote(first, {id: builder.newNoteId(), pitch: Pitch.parse('C4'), duration: Duration.whole(), onsetQuarters: Rational.ZERO, voice: VoiceId('v')});
    const score = builder.build();
    expect(projectScoreAnnotations(score).map((mark) => [mark.partId, mark.source.staff ?? 1, mark.endQuarters]))
      .toEqual([[first, 1, 2], [first, 2, 3], [second, 1, 4]]);
    expect(projectScoreAnnotations(score, {part: first})).toHaveLength(2);
    expect(projectScoreAnnotations(score, {part: 'Lower'})).toHaveLength(1);
    expect(projectScoreAnnotations(score, {part: 'missing'})).toHaveLength(0);
  });

  it('does not revive hidden rehearsal directions through the legacy measure landmark', () => {
    // The imported fixture already carries A in both representations. Replace
    // the part's directions while preserving the legacy measure landmark.
    const score = music();
    const hidden = new ScoreBuilder();
    const part = hidden.newPartId();
    hidden.addPart({id: part, name: 'Piano', directions: [{kind: 'rehearsal', text: 'A', printObject: false, onsetQuarters: Rational.ZERO}]});
    for (const measure of score.measures) hidden.addMeasure(measure);
    expect(projectScoreAnnotations(hidden.build()).some((annotation) => annotation.label === 'A')).toBe(false);
  });
});

describe('piano-roll expression strip', () => {
  it('aligns expression marks to nominal time and reclaims all strip height when hidden', () => {
    const score = music();
    const host = surface();
    const svg = document.createElementNS(SVG_NS, 'svg');
    host.append(svg);
    const shown = renderPianoRollVisualizer(score, svg, {pixelsPerSecond: 40});
    const shownHeight = Number(svg.getAttribute('height'));
    const notesY = [...svg.querySelectorAll('rect.note')].map((note) => Number(note.getAttribute('y')));
    const aTempo = svg.querySelector('[data-webscore-direction="words"][data-webscore-direction-onset="4"]')!;
    expect(aTempo.getAttribute('aria-label')).toBe('a tempo');
    expect(Number(aTempo.querySelector('text')!.getAttribute('x'))).toBe(80);
    shown.redrawAtTime!(6, false);
    expect(svg.querySelectorAll('rect.active')).toHaveLength(1);
    shown.dispose!();
    const hidden = renderPianoRollVisualizer(score, svg, {pixelsPerSecond: 40, showAnnotations: false});
    expect(svg.querySelector('[data-webscore-annotations]')).toBeNull();
    const hiddenHeight = Number(svg.getAttribute('height'));
    expect(shownHeight).toBeGreaterThan(hiddenHeight);
    expect([...svg.querySelectorAll('rect.note')].map((note) => Number(note.getAttribute('y'))))
      .toEqual(notesY.map((y) => y - shownHeight + hiddenHeight));
    hidden.dispose!();
  });
});

describe('waterfall expression rail', () => {
  it('shares the inverted note-time axis and reclaims the annotation rail width when hidden', () => {
    const score = music();
    const host = surface(400);
    const shown = renderWaterfallVisualizer(score, host, {fitToWidth: true, showOnlyOctavesUsed: true, pixelsPerSecond: 40});
    const svg = host.querySelector<SVGSVGElement>('.waterfall-notes')!;
    const shownNoteWidth = Number(svg.querySelector('[data-index="0"]')!.getAttribute('width'));
    expect(Number(svg.getAttribute('width'))).toBe(400);
    expect(host.querySelector('.waterfall-piano')).toBeNull();
    const words = svg.querySelector('[data-webscore-direction="words"][data-webscore-direction-onset="4"]')!;
    expect(Number(words.getAttribute('data-webscore-annotation-anchor'))).toBe(320);
    expect(svg.querySelector('[data-webscore-annotation-callout]')).not.toBeNull();
    const note = svg.querySelector('[data-index="1"]')!;
    expect(Number(note.getAttribute('y')) + Number(note.getAttribute('height'))).toBe(320);
    shown.redrawAtTime!(2, false);
    expect(svg.querySelectorAll('rect.active')).toHaveLength(1);
    shown.dispose!();
    const hidden = renderWaterfallVisualizer(score, host, {fitToWidth: true, showOnlyOctavesUsed: true, showAnnotations: false});
    expect(host.querySelector('[data-webscore-annotations]')).toBeNull();
    expect(Number(host.querySelector('.waterfall-notes')!.getAttribute('width'))).toBe(400);
    expect(Number(host.querySelector('[data-index="0"]')!.getAttribute('width'))).toBeGreaterThan(shownNoteWidth);
    hidden.dispose!();
    expect(host.children).toHaveLength(0);
  });
});

describe('compact overview annotations', () => {
  it('adds thumbnail height only for visible annotations and keeps the full note extent fitted', () => {
    const score = music();
    const notes = createPianoRollLayout(score);
    const host = surface();
    const shown = renderScoreThumbnail(host, notes, {score})!;
    expect(Number(shown.dataset.webscoreAnnotationHeight)).toBeGreaterThan(0);
    expect(shown.querySelector('[data-webscore-annotations]')).not.toBeNull();
    expect(shown.querySelectorAll('rect')).toHaveLength(notes.length);
    expect(shown.querySelector('svg')!.getAttribute('preserveAspectRatio')).toBe('none');
    const hidden = renderScoreThumbnail(host, notes, {score, showAnnotations: false})!;
    expect(hidden.style.height).toBe('');
    expect(hidden.dataset.webscoreAnnotationHeight).toBeUndefined();
    expect(hidden.querySelector('[data-webscore-annotations]')).toBeNull();
    expect(hidden.getAttribute('height')).toBe('100%');
  });

  it('bounds dense overview height while retaining every full source label as accessible evidence', () => {
    const score = music();
    const annotations = projectScoreAnnotations(score);
    const svg = document.createElementNS(SVG_NS, 'svg');
    const result = drawHorizontalScoreAnnotations(svg, annotations, {width: 80, xAtQuarter: (quarter) => quarter / 12 * 80, maxLanes: 3});
    expect(result.height).toBeLessThanOrEqual(64);
    expect(svg.querySelectorAll('[data-webscore-direction]')).toHaveLength(annotations.length);
    expect([...svg.querySelectorAll('[data-webscore-direction]')].map((mark) => mark.getAttribute('aria-label')).sort())
      .toEqual(annotations.map((annotation) => annotation.label).sort());
    for (const label of svg.querySelectorAll('text')) expect(Number(label.getAttribute('x'))).toBeLessThan(80);
  });

  it('reflows readable thumbnail labels on width changes and releases its resize observer', () => {
    let resize!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const score = music();
    const host = surface(600);
    const heights = vi.fn();
    const dispose = mountScoreThumbnail(host, createPianoRollLayout(score), {score}, heights);
    const first = host.querySelector('svg')!;
    expect(first.hasAttribute('viewBox')).toBe(false);
    expect(first.querySelector('svg')!.hasAttribute('viewBox')).toBe(true);
    expect(first.style.height).toBe('100%');
    expect(first.style.minHeight).toBe('calc(1rem + 24px)');
    expect(heights).toHaveBeenCalledTimes(1);
    resize();
    expect(host.querySelector('svg')).toBe(first);
    Object.defineProperty(host, 'clientWidth', {value: 320, configurable: true});
    resize();
    expect(host.querySelector('svg')).not.toBe(first);
    expect(host.querySelector('svg')!.hasAttribute('viewBox')).toBe(false);
    expect(host.querySelector<SVGSVGElement>('svg svg')!.getAttribute('height')).toBe('48');
    expect(host.querySelector<SVGSVGElement>('svg svg')!.style.height).toBe('48px');
    expect(host.querySelector('text')!.getAttribute('font-size')).toBe('12');
    dispose(); dispose(); resize();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
    expect(heights).toHaveBeenCalledTimes(2);
  });

  it('fits numeric note viewport height after annotation sizing and on height-only container changes', () => {
    let resize!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    let measuredHeight = 72;
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: SVGElement) {
      const height = this.hasAttribute('data-webscore-annotation-height') ? measuredHeight : 0;
      return {x: 0, y: 0, top: 0, left: 0, right: 600, bottom: height, width: 600, height, toJSON() { return {}; }};
    });
    const score = music();
    const host = surface(600);
    const onHeight = vi.fn(() => { measuredHeight = 40; });
    const dispose = mountScoreThumbnail(host, createPianoRollLayout(score), {score}, onHeight);
    const drawing = host.querySelector('svg')!;
    const notes = drawing.querySelector<SVGSVGElement>('[data-webscore-thumbnail-notes]')!;
    // The callback changes host sizing after the initial static draw: the
    // final 40px drawing leaves exactly 16px for notes below the 24px strip.
    expect(notes.getAttribute('height')).toBe('16');
    expect(notes.style.height).toBe('16px');
    measuredHeight = 200;
    resize();
    expect(host.querySelector('svg')).toBe(drawing);
    expect(notes.getAttribute('height')).toBe('176');
    expect(notes.style.height).toBe('176px');
    expect(Number(notes.getAttribute('y')) + Number(notes.getAttribute('height'))).toBe(200);
    expect(onHeight).toHaveBeenCalledTimes(1);
    expect(drawing.querySelector('text')!.getAttribute('font-size')).toBe('12');
    dispose(); resize();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });
});
