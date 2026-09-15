// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {ScoreViewElement} from '../../src/view/element/score-view';
import {renderPianoRollVisualizer, renderWaterfallVisualizer} from '../../src/view/render/renderers/factory';

customElements.define('time-score-view', ScoreViewElement);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function score() {
  const builder = new ScoreBuilder();
  const first = builder.newPartId();
  const second = builder.newPartId();
  builder.addPart({id: first, name: 'First'});
  builder.addPart({id: second, name: 'Second'});
  for (const [part, midi, start, end] of [
    [first, 60, 0, 2], [first, 64, 1, 3], [first, 67, 1, 1.5], [second, 64, 1, 2.5],
  ] as const) builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.fromMidi(midi), onsetQuarters: new Rational(start * 2),
    duration: new Duration({base: (end - start) * 2}), voice: VoiceId('one'),
  });
  return builder.build();
}

function activeIndexes(host: ParentNode): number[] {
  return [...host.querySelectorAll('.note.active')].map((rect) => Number((rect as HTMLElement).dataset.index));
}

afterEach(() => document.body.replaceChildren());

describe.each(['piano-roll', 'waterfall'] as const)('%s precise time highlighting', (type) => {
  it('paints exact half-open overlaps across parts and releases unequal-duration chord members', () => {
    const host = document.createElement('div');
    let height = 200;
    Object.defineProperty(host, 'clientHeight', {get: () => height});
    document.body.append(host);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.append(svg);
    const rendered = type === 'piano-roll'
      ? renderPianoRollVisualizer(score(), svg, {virtualization: true})
      : renderWaterfallVisualizer(score(), host, {showOnlyOctavesUsed: true, virtualization: true});
    const notes = rendered.noteSequence.notes;
    expect(rendered.redrawAtTime).toBeTypeOf('function');
    // Legacy note redraw is an onset sample, including earlier overlapping notes.
    rendered.redraw(notes[1], false);
    expect(activeIndexes(host)).toEqual([0, 1, 2, 3]);
    for (const seconds of [0, 0.999, 1, 1.5, 2, 2.5, 3]) {
      rendered.redrawAtTime!(seconds, false);
      const expected = notes.flatMap((note, index) => note.startTime <= seconds && seconds < note.endTime ? [index] : []);
      expect(activeIndexes(host), `${seconds}s`).toEqual(expected);
    }
    if (type === 'waterfall') {
      rendered.redrawAtTime!(2, false);
      height = 320;
      window.dispatchEvent(new Event('resize'));
      expect(activeIndexes(host)).toEqual([1, 2]);
    }
    expect(() => rendered.redrawAtTime!(Number.NaN)).toThrow(RangeError);
    rendered.dispose!();
    expect(() => rendered.redrawAtTime!(2)).not.toThrow();
  });

  it('scales sounding duration and preserves an explicit zero note gap', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const lengthAt = (pixelsPerSecond: number, noteSpacing: number): number => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      host.append(svg);
      const rendered = type === 'piano-roll'
        ? renderPianoRollVisualizer(score(), svg, {pixelsPerSecond, noteSpacing})
        : renderWaterfallVisualizer(score(), host, {pixelsPerSecond, noteSpacing});
      const note = host.querySelector('[data-index="0"]')!;
      const length = Number(note.getAttribute(type === 'waterfall' ? 'height' : 'width'));
      rendered.dispose!();
      svg.remove();
      return length;
    };
    expect(lengthAt(30, 0)).toBe(60);
    expect(lengthAt(60, 0)).toBe(120);
    expect(lengthAt(60, 3)).toBe(117);
    expect(lengthAt(60, -1)).toBe(119);
    expect(lengthAt(60, Number.NaN)).toBe(119);
  });

  it('follows a paused player snapshot through rate changes, seeks and silent positions', async () => {
    const state = {nominalSeconds: 1.25, rate: 2, playing: false, activeNotes: []};
    const owner = Object.assign(document.createElement('div'), {
      resolvedScore: score(), getPlaybackSnapshot: () => ({...state}),
    });
    owner.id = 'time-owner';
    document.body.append(owner);
    const view = document.createElement('time-score-view') as ScoreViewElement;
    view.type = type;
    view.setAttribute('player', '#time-owner');
    document.body.append(view);
    await flush();
    expect(activeIndexes(view)).toEqual([0, 1, 2, 3]);
    state.rate = 0.5;
    state.nominalSeconds = 2;
    owner.dispatchEvent(new CustomEvent('webscore:seek'));
    expect(view.currentTime).toBe(2);
    expect(activeIndexes(view)).toEqual([1, 2]);
    state.nominalSeconds = 3;
    owner.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail: {...state}}));
    expect(activeIndexes(view)).toEqual([]);
    state.nominalSeconds = 1.5;
    owner.dispatchEvent(new CustomEvent('webscore:seek'));
    expect(activeIndexes(view)).toEqual([0, 1, 2]);
    view.type = type === 'piano-roll' ? 'waterfall' : 'piano-roll';
    expect(activeIndexes(view)).toEqual([0, 1, 2]);
  });
});
