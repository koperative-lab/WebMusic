// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SVGContext} from 'vexflow/bravura';
import {parseMusicXML} from '../../src/io';
import {renderStaffVisualizer} from '../../src/view/render';
import type {StaffRenderOptions} from '../../src/view/api';

function xml(measures: string): string {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
function attributes(clef = 'G', line = 2): string {
  return `<attributes><divisions>6</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${clef}</sign><line>${line}</line></clef></attributes>`;
}
function note(step = 'C', octave = 4, duration = 6, type = 'quarter', extra = ''): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
}
function fixture(source: string, options: StaffRenderOptions = {}) {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => ({width: 240, height: 180, x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 180, toJSON() { return {}; }});
  document.body.append(host);
  const score = parseMusicXML(source);
  const rendered = renderStaffVisualizer(score, host, options);
  const viewport = host.querySelector<HTMLElement>('[data-webscore-staff-timeline]')!;
  return {host, score, rendered, viewport};
}
function coordinates(path: Element): number[] {
  return (path.getAttribute('d')!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
}
function xCoordinates(element: Element): number[] {
  return [...element.querySelectorAll('path')].flatMap((path) => coordinates(path).filter((_, index) => index % 2 === 0));
}
function headPosition(host: Element, onset: string): [number, number] {
  const path = host.querySelector(`[data-webscore-onset="${onset}"] [data-webscore-note] path`)!;
  return coordinates(path).slice(0, 2) as [number, number];
}
beforeEach(() => {
  // jsdom does not measure SVG text. Keep actual glyph/layout/drawing code;
  // provide only the text metrics a real browser supplies through getBBox.
  vi.spyOn(SVGContext.prototype, 'measureText').mockImplementation((text) => ({x: 0, y: 0, width: text.length * 8, height: 16}));
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('timed staff clefs', () => {
  it('draws a mid-measure clef before the new register and positions following notes in that clef', () => {
    const {host, score, rendered} = fixture(xml(`<measure number="1">${attributes('F', 4)}
      ${note('C', 3, 12, 'half')}<attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note('C', 5)}${note('D', 5)}</measure>`));
    expect(score.parts[0].clefChanges?.map((change) => [change.onsetQuarters.toString(), change.clef.sign])).toEqual([['0', 'F'], ['2', 'G']]);
    const change = host.querySelector('[data-webscore-clef="G2"][data-webscore-clef-onset="2"]')!;
    expect(change).not.toBeNull();
    expect(change.querySelectorAll('path').length).toBeGreaterThan(0);
    for (const onset of ['0', '2', '3']) {
      const [, y] = headPosition(host, onset);
      expect(y).toBeGreaterThan(30);
      expect(y).toBeLessThan(90);
    }
    expect(Math.max(...xCoordinates(change))).toBeLessThan(headPosition(host, '2')[0]);
    rendered.dispose!();
  });

  it('updates the fixed clef header when panning beyond a timed change and restores the source clef on return', () => {
    const {host, rendered, viewport} = fixture(xml(`<measure number="1">${attributes('F', 4)}
      ${note('C', 3, 12, 'half')}<attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note('C', 5)}${note('D', 5)}</measure><measure number="2">${note('E', 5, 24, 'whole')}</measure>`));
    const header = () => host.querySelector<SVGElement>('[data-webscore-header-clef]')!.dataset.webscoreHeaderClef;
    expect(header()).toBe('F4');
    const boundary = Number.parseFloat(host.querySelector<HTMLElement>('[data-webscore-staff-divider]')!.style.left);
    const changeX = rendered.redrawAtTime!(1, false)!; // q=2 at the source's 120 qpm.
    viewport.scrollLeft = changeX - boundary + 1;
    viewport.dispatchEvent(new Event('scroll'));
    expect(header()).toBe('G2');
    rendered.redrawAtTime!(0, true);
    expect(viewport.scrollLeft).toBe(0);
    expect(header()).toBe('F4');
    rendered.dispose!();
  });

  it('renders a timed clef in a silence gap even when no note shares its exact onset', () => {
    const {host, rendered} = fixture(xml(`<measure number="1">${attributes('F', 4)}${note('C', 3)}
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes><forward><duration>6</duration></forward>
      ${note('C', 5, 12, 'half')}</measure>`));
    expect(host.querySelectorAll('[data-webscore-clef-onset="1"]').length).toBe(1);
    expect(headPosition(host, '2')[1]).toBeGreaterThan(30);
    expect(headPosition(host, '2')[1]).toBeLessThan(90);
    rendered.dispose!();
  });
});

const expressionScore = () => xml(`<measure number="1">${attributes()}
  <direction placement="above"><direction-type><words font-style="italic">rit.</words></direction-type></direction>
  <direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>
  <direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type></direction>
  <direction placement="below"><direction-type><pedal type="start" line="yes" sign="yes" number="1"/></direction-type></direction>
  ${note('C', 4, 24, 'whole')}</measure><measure number="2">
  <direction placement="below"><direction-type><wedge type="stop" number="1"/></direction-type></direction>
  <direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type></direction>
  <direction placement="below"><direction-type><pedal type="change" line="yes" number="1"/></direction-type></direction>
  ${note('E', 4, 24, 'whole')}
  <direction placement="below"><direction-type><pedal type="stop" line="yes" number="1"/></direction-type></direction>
  </measure>`);

describe('source staff expressions', () => {
  it('hides expressions and removes their layout space while retaining written notes and time', () => {
    const source = expressionScore();
    const shown = fixture(source);
    const hidden = fixture(source, {showAnnotations: false});
    const drawing = (host: Element) => host.querySelector('[data-webscore-staff-drawing]')!;
    expect(shown.host.querySelectorAll('[data-webscore-direction]').length).toBeGreaterThan(0);
    expect(hidden.host.querySelectorAll('[data-webscore-direction]')).toHaveLength(0);
    expect(Number(drawing(hidden.host).getAttribute('height'))).toBeLessThan(Number(drawing(shown.host).getAttribute('height')));
    expect([...hidden.host.querySelectorAll('[data-webscore-note] path')].map((path) => path.getAttribute('d')))
      .toEqual([...shown.host.querySelectorAll('[data-webscore-note] path')].map((path) => path.getAttribute('d')));
    expect(hidden.rendered.redrawAtTime!(2, false)).toBe(shown.rendered.redrawAtTime!(2, false));
    expect(hidden.score.parts[0].directions).toEqual(shown.score.parts[0].directions);
    shown.rendered.dispose!(); hidden.rendered.dispose!();
  });

  it('renders words and dynamics without turning ritardando text into a new playback tempo', () => {
    const {host, score, rendered} = fixture(expressionScore());
    const words = host.querySelector('[data-webscore-direction="words"]')!;
    expect(words.textContent).toBe('rit.');
    expect(words.querySelector('text')?.getAttribute('font-style')).toBe('italic');
    expect([...host.querySelectorAll<SVGElement>('[data-webscore-direction="dynamics"]')].map((group) => group.dataset.webscoreDirectionText))
      .toEqual(['p', 'f']);
    expect(host.querySelector('[data-webscore-direction="dynamics"] path')).not.toBeNull();
    expect(score.timeMap.tempi.map((entry) => entry.bpm)).toEqual([120]);
    rendered.dispose!();
  });

  it('keeps a pedal line across a bar and includes its change notch and final release', () => {
    const {host, rendered} = fixture(expressionScore());
    const pedal = host.querySelector<SVGElement>('[data-webscore-direction="pedal"]')!;
    expect(pedal.dataset.webscoreDirectionOnset).toBe('0');
    expect(pedal.dataset.webscoreDirectionEnd).toBe('8');
    expect(pedal.dataset.webscoreDirectionText).toBe('Ped.');
    const line = [...pedal.querySelectorAll('path')].find((path) => path.getAttribute('fill') === 'none')!;
    expect(line).toBeDefined();
    const points = coordinates(line);
    const x = points.filter((_, index) => index % 2 === 0);
    const y = points.filter((_, index) => index % 2 === 1);
    const barX = coordinates(host.querySelector('[data-webscore-staff-layer] [data-webscore-barline] path')!)[0];
    expect(Math.min(...x)).toBeLessThan(barX);
    expect(Math.max(...x)).toBeGreaterThan(barX);
    expect(y.length).toBeGreaterThanOrEqual(7); // Start, change notch and final upstroke.
    expect(y.at(-1)).toBeLessThan(y.at(-2)!);
    rendered.dispose!();
  });

  it('leaves horizontal room for dynamics at both endpoints of a hairpin', () => {
    const {host, rendered} = fixture(expressionScore());
    const wedge = host.querySelector('[data-webscore-direction="wedge"]')!;
    const dynamics = [...host.querySelectorAll('[data-webscore-direction="dynamics"]')];
    const hairpinX = xCoordinates(wedge);
    expect(hairpinX.length).toBeGreaterThan(0);
    expect(Math.min(...hairpinX)).toBeGreaterThan(Math.max(...xCoordinates(dynamics[0])));
    expect(Math.max(...hairpinX)).toBeLessThan(Math.min(...xCoordinates(dynamics[1])));
    rendered.dispose!();
  });

  it('draws rehearsal/metronome markings and respects print-object=no for hidden directions', () => {
    const {host, rendered} = fixture(xml(`<measure number="1">${attributes()}
      <direction><direction-type><rehearsal>A</rehearsal></direction-type></direction>
      <direction><direction-type><metronome parentheses="yes"><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>
      <direction print-object="no"><direction-type><words>hidden instruction</words></direction-type></direction>
      ${note('C', 4, 24, 'whole')}</measure>`));
    expect(host.querySelector('[data-webscore-direction="rehearsal"]')?.textContent).toBe('A');
    const metronome = host.querySelector('[data-webscore-direction="metronome"]')!;
    expect(metronome.querySelector('path')).not.toBeNull();
    expect(metronome.textContent).toContain('80');
    expect(host.textContent).not.toContain('hidden instruction');
    rendered.dispose!();
  });
});

function tupletXml(bracket: boolean): string {
  return xml(`<measure number="1">${attributes()}${['C', 'D', 'E'].map((step, index) => note(step, 4, 2, 'eighth',
    `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">${['begin', 'continue', 'end'][index]}</beam>${index !== 1 ? `<notations><tuplet type="${index === 0 ? 'start' : 'stop'}" show-number="none" bracket="${bracket ? 'yes' : 'no'}"/></notations>` : ''}`)).join('')}</measure>`);
}

describe('source tuplet number visibility', () => {
  it('omits a hidden tuplet number over a beamed group while retaining the notes and beam', () => {
    const {host, rendered} = fixture(tupletXml(false));
    expect(host.querySelectorAll('[data-webscore-note]').length).toBe(3);
    expect(host.querySelectorAll('[data-webscore-beam]').length).toBe(1);
    expect(host.querySelectorAll('[data-webscore-tuplet]').length).toBe(0);
    rendered.dispose!();
  });

  it('keeps an explicitly requested bracket while hiding its number', () => {
    const {host, rendered} = fixture(tupletXml(true));
    const tuplet = host.querySelector('[data-webscore-tuplet]')!;
    expect(tuplet).not.toBeNull();
    expect(tuplet.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(tuplet.querySelectorAll('path').length).toBe(0); // Number glyphs are paths; bracket strokes are rectangles.
    rendered.dispose!();
  });
});

describe('compact expression lanes', () => {
  it('keeps adjacent pedal spans on one baseline instead of stacking each later span downward', () => {
    const source = xml([1, 2, 3].map((number) => `<measure number="${number}">${number === 1 ? attributes() : ''}
      <direction placement="below"><direction-type><pedal type="start" line="yes"/></direction-type></direction>
      ${note('C', 4, 24, 'whole')}
      <direction placement="below"><direction-type><pedal type="stop" line="yes"/></direction-type></direction>
      </measure>`).join(''));
    const {host, rendered} = fixture(source);
    const spans = [...host.querySelectorAll('[data-webscore-direction="pedal"]')];
    expect(spans).toHaveLength(3);
    const baselines = spans.map((span) => {
      const line = span.querySelector('path[fill="none"]')!;
      const ys = coordinates(line).filter((_, index) => index % 2 === 1);
      return ys[ys.length - 2];
    });
    expect(new Set(baselines).size).toBe(1);
    rendered.dispose!();
  });
});
