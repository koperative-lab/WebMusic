// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import type {ScoreNoteSequence} from '../../src/view/core/types';
import {ScoreViewElement} from '../../src/view/element/score-view';
import {SheetViewElement} from '../../src/view/element/sheet-view';
import {PianoRollCanvasVisualizer} from '../../src/view/render/renderers/piano-roll';

customElements.define('styling-score-view', ScoreViewElement);
customElements.define('styling-sheet-view', SheetViewElement);

function score() {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)});
  builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId('one')});
  return builder.build();
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('View drawing colors', () => {
  it.each(['thumbnail', 'map'] as const)('%s gives explicit CSS colors priority over RGB/attributes and keeps inherited tokens live', async (type) => {
    const view = document.createElement('styling-score-view') as ScoreViewElement;
    view.type = type;
    view.score = score();
    view.setAttribute('note-color', '#123456');
    view.options = {noteRGB: '4, 5, 6', noteColor: 'rebeccapurple'};
    document.body.append(view);
    const paint = () => type === 'thumbnail'
      ? view.querySelector('rect')?.getAttribute('fill')
      : (view.querySelector('button') as HTMLElement)?.style.getPropertyValue('--wui-timeline-region-color');
    await vi.waitFor(() => expect(paint()).toContain('rebeccapurple'));
    view.options = {noteRGB: '4, 5, 6'};
    expect(paint()).toContain('rgb(4, 5, 6)');
    view.options = {};
    expect(paint()).toContain('rgb(18, 52, 86)');
    view.removeAttribute('note-color');
    expect(paint()).toContain(type === 'thumbnail' ? '--wm-score-view-note' : '--wm-score-view-map');
    const drawing = view.querySelector(type === 'thumbnail' ? '[part="drawing"]' : 'input');
    view.style.setProperty('--wm-score-view-note', 'orange');
    view.style.setProperty('--wm-score-view-map', 'orange');
    expect(view.querySelector(type === 'thumbnail' ? '[part="drawing"]' : 'input')).toBe(drawing);
    expect(view.currentTime).toBe(0);
  });

  it('resolves inherited canvas colors at paint time, preserving velocity alpha and the paused sample', () => {
    const contexts: Array<{fillStyle: string; globalAlpha: number; paints: Array<[string, number]>}> = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) {
      const context = {fillStyle: '', globalAlpha: 1, paints: [] as Array<[string, number]>,
        setTransform() {}, clearRect() {},
        fillRect() { this.paints.push([this.fillStyle, this.globalAlpha]); }};
      contexts.push(context);
      return context as unknown as CanvasRenderingContext2D;
    });
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.style.color = 'rgb(12, 34, 56)';
    host.append(canvas); document.body.append(host);
    // jsdom does not resolve var()/currentColor. Supply the browser's computed
    // result only at that boundary; the renderer must use it in actual paints.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element.tagName === 'SPAN' && (element as HTMLElement).style.color === 'var(--ink)') {
        return {...computed(element), color: host.style.color} as CSSStyleDeclaration;
      }
      return computed(element);
    });
    const sequence: ScoreNoteSequence = {notes: [{pitch: 60, startTime: 0, endTime: 2, velocity: 40}],
      ticksPerQuarter: 480, totalTime: 2, tempos: [{time: 0, qpm: 120}],
      keySignatures: [], timeSignatures: [], partInfos: []};
    const renderer = new PianoRollCanvasVisualizer(sequence, canvas, {
      noteRGB: '9, 9, 9', activeNoteRGB: '8, 8, 8',
      noteColor: 'var(--ink)', activeNoteColor: 'rebeccapurple',
    });
    expect(contexts[0]!.paints[0]![0]).toBe('rgb(12, 34, 56)');
    expect(contexts[0]!.paints[0]![1]).toBeCloseTo(.6);
    renderer.redrawAtTime(1, false);
    const lastPaint = (index: number) => contexts[index]!.paints[contexts[index]!.paints.length - 1]!;
    expect(lastPaint(1)[0]).toBe('rgb(102, 51, 153)');
    host.style.color = 'rgb(65, 43, 21)';
    renderer.redrawAtTime(1, false);
    expect(lastPaint(0)[0]).toBe('rgb(65, 43, 21)');
    expect(lastPaint(1)[0]).toBe('rgb(102, 51, 153)');
    expect(canvas.childElementCount).toBe(0); // no retained color probes
    renderer.dispose();
  });

  it('themes the actual OSMD note, line and title paints without rebuilding on a CSS change', async () => {
    // The optional peer is installed by the docs workspace. Font metrics and
    // skyline pixels are stubbed; the real SVG backend/paint attributes run.
    const context = new Proxy({measureText: (text: string) => ({width: text.length * 8}),
      getImageData: () => ({data: new Uint8ClampedArray(800 * 600 * 4)}),
      createLinearGradient: () => ({addColorStop() {}})}, {
      get(target, property) { return Reflect.get(target, property) ?? (() => {}); },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('');
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    const {OpenSheetMusicDisplay} = await import('opensheetmusicdisplay');
    const view = document.createElement('styling-sheet-view') as SheetViewElement;
    view.setAttribute('follow-cursor', 'false');
    // Use an independently authored engraving fixture: this regression owns
    // SVG theming, not the Score-to-MusicXML serialization contract.
    view.OpenSheetMusicDisplay = class extends OpenSheetMusicDisplay {
      override load() {
        return super.load('<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Theme test</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>');
      }
    } as never;
    view.score = score();
    document.body.append(view);
    await vi.waitFor(() => expect(view.querySelector('svg [fill="#010203"]')).not.toBeNull());
    expect(view.querySelector('svg [stroke="#010203"]')).not.toBeNull();
    expect(view.querySelector('svg [fill="#fff"], svg [fill="#ffffff"], svg [fill="white"]')).toBeNull();
    const ink = view.querySelector('svg [fill="#010203"]')!;
    const rules = [...view.querySelectorAll('style')].flatMap((style) => [...(style.sheet?.cssRules ?? [])]);
    const paintRule = rules.find((rule): rule is CSSStyleRule => 'selectorText' in rule
      && ink.matches((rule as CSSStyleRule).selectorText)
      && (rule as CSSStyleRule).style.getPropertyValue('fill').includes('--wm-sheet-foreground'));
    expect(paintRule).toBeDefined();
    // Prove the matching rule paints the vendor path, not just the stage shell.
    paintRule!.style.setProperty('fill', 'rgb(210, 220, 230)');
    expect(getComputedStyle(ink).fill).toBe('rgb(210, 220, 230)');
    const svg = view.querySelector('svg');
    view.style.setProperty('--wm-sheet-foreground', 'orange');
    view.classList.add('alternate-theme');
    await Promise.resolve();
    expect(view.querySelector('svg')).toBe(svg);
  });
});
