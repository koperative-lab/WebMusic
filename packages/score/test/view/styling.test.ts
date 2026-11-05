// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import type {ScoreNoteSequence} from '../../src/view/core/types';
import {ScoreViewElement} from '../../src/view/element/score-view';
import {SheetViewElement} from '../../src/view/element/score-sheet-view';
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

  it('draws sheet notation with the sheet ink token', async () => {
    const view = document.createElement('styling-sheet-view') as SheetViewElement;
    view.score = score();
    document.body.append(view);
    await vi.waitFor(() => expect(view.querySelector('[part~="system"]')).not.toBeNull());
    const system = view.querySelector<HTMLElement>('[part~="system"] [data-webscore-staff-timeline]')!.parentElement!;
    expect(system.style.getPropertyValue('--webscore-staff-note')).toContain('--wm-score-sheet-note');
    view.remove();
  });
});
