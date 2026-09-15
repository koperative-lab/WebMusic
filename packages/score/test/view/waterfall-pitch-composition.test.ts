// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Rational, ScoreBuilder, VoiceId, midiToPitch} from '../../src/core';
import {PitchViewElement} from '../../src/view/element/pitch-view';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('aligned-score-view', class extends ScoreViewElement {});
customElements.define('aligned-pitch-view', class extends PitchViewElement {});

function music(low: number, high: number) {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Alignment fixture'});
  for (let midi = Math.min(low, high); midi <= Math.max(low, high); midi += 1) {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: midiToPitch(midi),
      onsetQuarters: Rational.ZERO, duration: Duration.quarter(), voice: VoiceId('alignment'),
    });
  }
  return builder.build();
}

async function pair(low: number, high: number, white = 32, black = 20) {
  const score = document.createElement('aligned-score-view') as ScoreViewElement;
  const pitch = document.createElement('aligned-pitch-view') as PitchViewElement;
  for (const [key, value] of Object.entries({
    type: 'waterfall', 'min-pitch': low, 'max-pitch': high,
    'white-note-width': white, 'black-note-width': black,
    'pixels-per-second': 60, 'note-spacing': 0, 'show-annotations': 'false',
  })) score.setAttribute(key, String(value));
  for (const [key, value] of Object.entries({
    type: 'keyboard', low, high, 'white-key-width': white, 'black-key-width': black,
    'white-key-height': 80, 'black-key-height': 48, follow: 'none',
  })) pitch.setAttribute(key, String(value));
  score.score = music(low, high);
  document.body.append(score, pitch);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {score, pitch};
}

function pixels(value: string, width: number): number {
  return Number.parseFloat(value) * (value.endsWith('%') ? width / 100 : 1);
}

/** Compare two independently mounted public components, not two copies of a formula. */
function expectAligned(score: ScoreViewElement, pitch: PitchViewElement): void {
  const board = pitch.querySelector<HTMLElement>('.wui-pitch-keyboard__board')!;
  const width = Number.parseFloat(board.style.width);
  expect(board.style.width).toMatch(/px$/);
  expect(Number(score.querySelector('svg')!.getAttribute('width'))).toBeCloseTo(width);
  const notes = [...score.querySelectorAll<SVGRectElement>('rect[data-pitch]')];
  expect(notes.length).toBeGreaterThan(0);
  for (const note of notes) {
    const key = pitch.querySelector<HTMLElement>(`.wui-pitch-keyboard__key[data-midi="${note.dataset.pitch}"]`)!;
    expect(key).not.toBeNull();
    const keyWidth = pixels(key.style.width, width);
    const black = key.classList.contains('wui-pitch-keyboard__key--black');
    const left = pixels(key.style.left, width) - (black ? keyWidth / 2 : 0);
    expect(Number(note.getAttribute('x'))).toBeCloseTo(left, 3);
    expect(Number(note.getAttribute('width'))).toBeCloseTo(keyWidth, 3);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + keyWidth).toBeLessThanOrEqual(width + 1e-6);
  }
}

afterEach(() => document.body.replaceChildren());

describe('separate waterfall and keyboard geometry', () => {
  it.each([[48, 71], [53, 66], [61, 61], [66, 53]])('aligns exact MIDI endpoints %s–%s including raised edge keys', async (low, high) => {
    const {score, pitch} = await pair(low, high);
    expectAligned(score, pitch);
    expect(score.querySelectorAll('[data-midi]')).toHaveLength(0);
  });

  it('retains subpixel columns instead of rounding black-note edges independently', async () => {
    const {score, pitch} = await pair(53, 66, 31.5, 19.53);
    expectAligned(score, pitch);
  });

  it('derives the same natural-key width when only an accidental width is set', async () => {
    const {score, pitch} = await pair(60, 71);
    score.removeAttribute('white-note-width');
    pitch.removeAttribute('white-key-width');
    expectAligned(score, pitch);
  });

  it('changes duration scale without moving pitch columns, and changes both widths without changing musical time', async () => {
    const {score, pitch} = await pair(60, 71);
    const first = () => score.querySelector<SVGRectElement>('rect[data-pitch="60"]')!;
    const originalHeight = Number(first().getAttribute('height'));
    const originalDuration = score.score!.durationSeconds;
    score.setAttribute('pixels-per-second', '120');
    expect(Number(first().getAttribute('height'))).toBeCloseTo(originalHeight * 2);
    expectAligned(score, pitch);
    score.setAttribute('white-note-width', '40');
    score.setAttribute('black-note-width', '25');
    pitch.setAttribute('white-key-width', '40');
    pitch.setAttribute('black-key-width', '25');
    expectAligned(score, pitch);
    expect(score.score!.durationSeconds).toBe(originalDuration);
    expect(pitch.follow).toBe('none');
    score.remove();
    expect(pitch.isConnected).toBe(true);
    expect(pitch.querySelectorAll('[data-midi]')).toHaveLength(12);
  });
});
