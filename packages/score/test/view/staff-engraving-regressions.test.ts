// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SVGContext} from 'vexflow/bravura';
import {parseMusicXML} from '../../src/io';
import {renderStaffVisualizer} from '../../src/view/render';
import type {StaffRenderOptions} from '../../src/view/api';

const attributes = (staves = 2, sign = 'G', line = 2) => `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>${staves}</staves><clef number="1"><sign>${sign}</sign><line>${line}</line></clef>${staves === 2 ? '<clef number="2"><sign>F</sign><line>4</line></clef>' : ''}</attributes>`;
function note(staff: number, voice: number, step: string, octave: number, duration = 1, mark = ''): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 4 ? 'whole' : 'quarter'}</type><stem>down</stem><staff>${staff}</staff>${mark ? `<notations>${mark}</notations>` : ''}</note>`;
}
const slur = (type: 'start' | 'stop') => `<slur number="1" type="${type}"${type === 'start' ? ' placement="below"' : ''}/>`;
function xml(parts: string[]): string {
  return `<score-partwise version="4.0"><part-list>${parts.map((_, index) => `<score-part id="P${index + 1}"><part-name>Piano</part-name></score-part>`).join('')}</part-list>${parts.map((part, index) => `<part id="P${index + 1}">${part}</part>`).join('')}</score-partwise>`;
}
function fixture(source: string, options: StaffRenderOptions = {}, width = 260) {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => ({width, height: 200, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 200, toJSON() { return {}; }});
  document.body.append(host);
  const score = parseMusicXML(source);
  const rendered = renderStaffVisualizer(score, host, options);
  const rows = [...host.querySelectorAll<SVGElement>('[data-webscore-staff-layer]')];
  const drawing = host.querySelector<SVGSVGElement>('[data-webscore-staff-drawing]')!;
  return {host, score, rendered, rows, drawing};
}
const coordinates = (path: Element) => (path.getAttribute('d')!.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
const rowY = (row: Element) => Number(/translate\(0 (-?[\d.]+)\)/.exec(row.getAttribute('transform')!)![1]);

beforeEach(() => {
  // Supply only unavailable browser text metrics; keep real VexFlow notehead,
  // stem and curve geometry. No invented SVG bounds drive these assertions.
  vi.spyOn(SVGContext.prototype, 'measureText').mockImplementation((text) => ({x: 0, y: 0, width: text.length * 8, height: 16}));
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('whole-part staff curves', () => {
  it('connects a lower-staff start to its upper-staff stop across source voices in one global path', () => {
    const source = xml([`<measure number="1">${attributes()}
      <forward><duration>2</duration></forward>${note(1, 1, 'C', 4, 1, slur('stop'))}${note(1, 1, 'D', 4)}
      <backup><duration>4</duration></backup>${note(2, 2, 'G', 3, 1, slur('start'))}${note(2, 2, 'A', 3)}
      <forward><duration>2</duration></forward></measure>`]);
    const {host, score, rendered, rows} = fixture(source);
    const notes = score.parts[0].notes;
    const curves = [...host.querySelectorAll<SVGElement>('[data-webscore-curve="slur"]')];
    expect(curves).toHaveLength(1);
    const curve = curves[0];
    expect(curve.dataset.webscoreCurveStart).toBe(String(notes[0].id));
    expect(curve.dataset.webscoreCurveEnd).toBe(String(notes[2].id));
    expect(curve.hasAttribute('data-webscore-cross-staff')).toBe(true);
    expect(curve.closest('[data-webscore-staff-layer]')).toBeNull();
    const path = curve.querySelector('path')!;
    const points = coordinates(path);
    expect(points.every(Number.isFinite)).toBe(true);
    expect(points[6]).toBeGreaterThan(points[0]);
    expect(points[1]).toBeGreaterThan(points[7]); // Coordinates include both final row translations.
    expect(rowY(rows[1])).toBeGreaterThan(rowY(rows[0]));
    expect(path.getAttribute('stroke')).toBe('none');
    rendered.dispose!();
  });

  it('consumes a cross-staff stop before a much later reuse of the same slur number', () => {
    const measures = Array.from({length: 9}, (_, index) => {
      const number = index + 1;
      const notes = number === 1
        ? `<forward><duration>2</duration></forward>${note(1, 1, 'C', 4, 1, slur('stop'))}${note(1, 1, 'D', 4)}<backup><duration>4</duration></backup>${note(2, 2, 'G', 3, 1, slur('start'))}${note(2, 2, 'A', 3)}<forward><duration>2</duration></forward>`
        : number === 9
          ? `${note(1, 1, 'D', 4, 1, slur('start'))}${note(1, 1, 'C', 4)}<forward><duration>2</duration></forward><backup><duration>4</duration></backup><forward><duration>2</duration></forward>${note(2, 2, 'A', 3, 1, slur('stop'))}${note(2, 2, 'G', 3)}`
          : note(2, 2, 'G', 3, 4, number === 5 ? slur('stop') : '');
      return `<measure number="${number}">${number === 1 ? attributes() : ''}${notes}</measure>`;
    });
    const {host, score, rendered} = fixture(xml([measures.join('')]));
    const notes = new Map(score.parts[0].notes.map((source) => [String(source.id), source]));
    const curves = [...host.querySelectorAll<SVGElement>('[data-webscore-curve="slur"]')];
    expect(curves).toHaveLength(2);
    expect(curves.map((curve) => [notes.get(curve.dataset.webscoreCurveStart!)!.onsetQuarters.toFloat(), notes.get(curve.dataset.webscoreCurveEnd!)!.onsetQuarters.toFloat()]))
      .toEqual([[0, 2], [32, 34]]);
    expect(curves.every((curve) => curve.hasAttribute('data-webscore-cross-staff'))).toBe(true);
    rendered.dispose!();
  });

  it('does not attach an unmatched start in one part to a same-number stop in another part', () => {
    const {host, rendered} = fixture(xml([
      `<measure number="1">${attributes()}${note(2, 2, 'G', 3, 4, slur('start'))}</measure>`,
      `<measure number="1">${attributes(1)}${note(1, 1, 'C', 5)}${note(1, 1, 'D', 5, 1, slur('stop'))}${note(1, 1, 'E', 5)}${note(1, 1, 'F', 5)}</measure>`,
    ]));
    expect(host.querySelectorAll('[data-webscore-curve="slur"]')).toHaveLength(0);
    rendered.dispose!();
  });
});

describe('staff compression without shrinking notation', () => {
  it.each([6, 9])('packs the same musical rows more tightly within one part at noteHeight=%s', (noteHeight) => {
    const upper = note(1, 1, 'B', 4, 4);
    const lower = note(2, 2, 'D', 3, 4);
    const joined = fixture(xml([`<measure number="1">${attributes()}${upper}<backup><duration>4</duration></backup>${lower}</measure>`]), {noteHeight}, 260);
    const separate = fixture(xml([
      `<measure number="1">${attributes(1)}${upper}</measure>`,
      `<measure number="1">${attributes(1, 'F', 4)}${note(1, 2, 'D', 3, 4)}</measure>`,
    ]), {noteHeight}, 720);
    const packedDistance = rowY(joined.rows[1]) - rowY(joined.rows[0]);
    const separateDistance = rowY(separate.rows[1]) - rowY(separate.rows[0]);
    expect(packedDistance).toBeLessThan(separateDistance);
    expect(packedDistance + 40 - 80).toBeGreaterThanOrEqual(40); // At least four unscaled staff spaces between lines.
    expect(Number(joined.drawing.getAttribute('height'))).toBeLessThan(Number(separate.drawing.getAttribute('height')));
    for (const item of [joined, separate]) {
      const viewBox = item.drawing.getAttribute('viewBox')!.split(/\s+/).map(Number);
      expect(Number(item.drawing.getAttribute('width')) / viewBox[2]).toBeCloseTo(noteHeight / 10);
      expect(Number(item.drawing.getAttribute('height')) / viewBox[3]).toBeCloseTo(noteHeight / 10);
      expect(item.rows.every((row) => !row.getAttribute('transform')!.includes('scale'))).toBe(true);
    }
    expect(joined.rows.map((row) => row.querySelector('[data-webscore-note] path')!.getAttribute('d')))
      .toEqual(separate.rows.map((row) => row.querySelector('[data-webscore-note] path')!.getAttribute('d')));
    joined.rendered.dispose!(); separate.rendered.dispose!();
  });
});

describe('source marks retained through MusicXML engraving', () => {
  it('keeps hidden triplet notes in musical time without leaving floating beams or tuplet numbers', () => {
    const triplet = (hidden: boolean) => [0, 1, 2].map((index) => `<note${hidden ? ' print-object="no"' : ''}>
      <pitch><step>${['C', 'D', 'E'][index]}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
      <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      <beam number="1">${['begin', 'continue', 'end'][index]}</beam>
      ${index !== 1 ? `<notations><tuplet type="${index === 0 ? 'start' : 'stop'}"/></notations>` : ''}</note>`).join('');
    const source = (hidden: boolean) => xml([`<measure number="1">${attributes(1).replace('<divisions>1</divisions>', '<divisions>3</divisions>')}${triplet(hidden)}</measure>`]);
    const hidden = fixture(source(true));
    const visible = fixture(source(false));
    expect(hidden.score.parts[0].notes.map((note) => note.onsetQuarters.toFloat()))
      .toEqual(visible.score.parts[0].notes.map((note) => note.onsetQuarters.toFloat()));
    expect(hidden.host.querySelectorAll('[data-webscore-onset][visibility="hidden"]')).toHaveLength(3);
    expect(hidden.host.querySelectorAll('[data-webscore-beam], [data-webscore-tuplet]')).toHaveLength(0);
    expect(visible.host.querySelectorAll('[data-webscore-beam]')).toHaveLength(1);
    expect(visible.host.querySelectorAll('[data-webscore-tuplet]')).toHaveLength(1);
    hidden.rendered.dispose!(); visible.rendered.dispose!();
  });

  it('does not reserve vertical space for hidden SVG ink reported by the browser', () => {
    // Browsers return getBBox() for visibility:hidden paths as well. Simulate
    // those otherwise unavailable bounds; visible notes keep VexFlow metrics.
    const prototype = SVGElement.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, 'getBBox');
    let hiddenMeasurements = 0;
    Object.defineProperty(prototype, 'getBBox', {configurable: true, value(this: SVGElement) {
      if (this.closest('[visibility="hidden"]')) hiddenMeasurements += 1;
      throw new Error('SVG layout is unavailable in jsdom');
    }});
    try {
      const hiddenNote = note(1, 1, 'C', 7, 4).replace('<note>', '<note print-object="no">');
      const {rendered} = fixture(xml([`<measure number="1">${attributes(1)}${hiddenNote}</measure>`]));
      expect(hiddenMeasurements).toBe(0);
      rendered.dispose!();
    } finally {
      if (original) Object.defineProperty(prototype, 'getBBox', original);
      else Reflect.deleteProperty(prototype, 'getBBox');
    }
  });

  it('distinguishes ordinary, double and final bars across both staves and their connector', () => {
    const styles = ['regular', 'light-light', 'light-heavy'];
    const source = xml([styles.map((style, index) => `<measure number="${index + 1}">${index === 0 ? attributes() : ''}
      ${note(1, 1, 'B', 4, 4)}<backup><duration>4</duration></backup>${note(2, 2, 'D', 3, 4)}
      <barline location="right"><bar-style>${style}</bar-style></barline></measure>`).join('')]);
    const {host, score, rendered, rows} = fixture(source);
    expect(score.measures.map((measure) => measure.barlineEnd)).toEqual(styles);
    const barsByRow = rows.map((row) => [...row.querySelectorAll<SVGElement>('[data-webscore-barline]')]);
    for (const bars of barsByRow) {
      expect(bars.map((bar) => bar.dataset.webscoreBarline)).toEqual(styles);
      expect(bars.map((bar) => bar.querySelectorAll('path').length)).toEqual([1, 2, 2]);
      const final = [...bars[2].querySelectorAll('path')];
      expect(Number(final[1].getAttribute('stroke-width'))).toBeGreaterThan(Number(final[0].getAttribute('stroke-width')));
    }
    const connectors = [...host.querySelectorAll<SVGElement>('[data-webscore-system-bars] [data-webscore-barline]')];
    expect(connectors.map((bar) => bar.dataset.webscoreBarline)).toEqual(styles);
    for (const [index, connector] of connectors.entries()) {
      const paths = [...connector.querySelectorAll('path')];
      expect(paths.map((path) => coordinates(path)[0])).toEqual([...barsByRow[0][index].querySelectorAll('path')].map((path) => coordinates(path)[0]));
      for (const path of paths) {
        const [, startY, , endY] = coordinates(path);
        expect(startY).toBe(rowY(rows[0]) + 80);
        expect(endY).toBe(rowY(rows[1]) + 40);
      }
    }
    rendered.dispose!();
  });

  it('uses authored rest display pitches and draws the source articulation glyphs', () => {
    const rest = (step?: string, octave?: number) => `<note><rest>${step ? `<display-step>${step}</display-step><display-octave>${octave}</display-octave>` : ''}</rest><duration>1</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>`;
    const {host, score, rendered} = fixture(xml([`<measure number="1">${attributes(1)}
      ${rest('E', 4)}${rest()}${rest('F', 5)}${note(1, 2, 'C', 5, 1, '<articulations><staccato/><tenuto/><accent/></articulations>')}
      </measure>`]));
    expect(score.parts[0].notes.slice(0, 3).map((source) => source.restDisplay)).toEqual([{step: 'E', octave: 4}, undefined, {step: 'F', octave: 5}]);
    const restY = ['0', '1', '2'].map((onset) => {
      const path = host.querySelector(`[data-webscore-onset="${onset}"] .vf-notehead path`)!;
      expect(path).not.toBeNull();
      return coordinates(path)[1];
    });
    expect(restY[0]).toBeGreaterThan(restY[1]);
    expect(restY[2]).toBeLessThan(restY[1]);
    expect(restY[0] - restY[2]).toBeCloseTo(40); // E4 to F5 spans eight diatonic half-spaces.
    expect(score.parts[0].notes[3].articulations).toEqual(['staccato', 'tenuto', 'accent']);
    const markedNote = host.querySelector('[data-webscore-onset="3"]')!;
    // VexFlow draws these modifier glyphs after the head inside its group.
    // There are no accidentals or dots on this source note.
    const headPaths = [...markedNote.querySelectorAll('.vf-notehead path')];
    expect(headPaths).toHaveLength(4);
    const articulationPaths = headPaths.slice(1);
    expect(articulationPaths).toHaveLength(3);
    expect(new Set(articulationPaths.map((path) => path.getAttribute('d'))).size).toBe(3);
    rendered.dispose!();
  });
});
