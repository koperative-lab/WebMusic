// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {defineAllAnalysisElements} from '../../src/analyze/element';
import {defineAllViewElements, type PitchViewElement} from '../../src/view/element';

defineAllAnalysisElements();
defineAllViewElements();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const panels = ['score-chord-analysis', 'score-interval-analysis', 'score-scale-analysis', 'score-rhythm-analysis'];

function source() {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  ['C4', 'E4', 'G4', 'C5'].forEach((pitch, index) => builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index),
    duration: Duration.quarter(), voice: VoiceId('melody'),
  }));
  const player = Object.assign(document.createElement('div'), {
    resolvedScore: builder.build(), seekNominal: vi.fn(),
    getPlaybackSnapshot: () => ({nominalSeconds: 0, rate: 1, playing: false, activeNotes: []}),
  });
  player.id = 'performance';
  document.body.append(player);
  return player;
}

function panel(tag: string, type?: string) {
  const element = document.createElement(tag);
  element.setAttribute('player', '#performance');
  if (type) element.setAttribute('type', type);
  element.setAttribute('motion', 'stepped');
  document.body.append(element);
  return element;
}

const note = (player: Element, midi: number, on = true) => player.dispatchEvent(new CustomEvent(
  on ? 'webscore:noteon' : 'webscore:noteoff', {detail: {midi}},
));

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('atomic player-bound composition', () => {
  it.each(panels)('%s mounts exactly one display with no nested view or configuration UI', async (tag) => {
    source();
    const element = panel(tag);
    await flush();
    expect(element.querySelectorAll('[data-slot]')).toHaveLength(1);
    expect(element.querySelector('score-pitch-view, score-view')).toBeNull();
    expect(element.querySelector('.wui-pitch-keyboard, .wui-pitch-staff, .wui-pitch-fretboard')).toBeNull();
    expect(element.querySelector('[role="tablist"], [role="switch"], [part~="header"], [part~="dock"]')).toBeNull();
  });

  it('explains an empty standalone lane without a hidden workbench status bar', async () => {
    const element = panel('score-chord-analysis');
    await flush();
    const visible = [...element.querySelectorAll<HTMLElement>('[role="status"]')].filter((node) => !node.hidden);
    expect(visible.map((node) => node.textContent)).toEqual(['Waiting for a score — set player, src or .score.']);
    expect(element.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(element.querySelector('[part~="header"], [part~="status"]')).toBeNull();
  });

  it('composes chord analysis with independent keyboard, staff and fretboard listeners', async () => {
    const player = source();
    const chord = panel('score-chord-analysis');
    const keyboard = panel('score-pitch-view', 'keyboard') as PitchViewElement;
    const staff = panel('score-pitch-view', 'staff') as PitchViewElement;
    const frets = panel('score-pitch-view', 'fretboard') as PitchViewElement;
    await flush();
    for (const midi of [60, 64, 67]) note(player, midi);
    for (const element of [keyboard, staff, frets]) expect(element.active).toEqual([60, 64, 67]);
    expect(chord.querySelector('[data-slot="flow"]')).not.toBeNull();
    expect(chord.contains(keyboard)).toBe(false);
    keyboard.remove();
    note(player, 64, false);
    expect(keyboard.active).toEqual([]);
    expect(staff.active).toEqual([60, 67]);
    expect(frets.active).toEqual([60, 67]);
    player.dispatchEvent(new CustomEvent('webscore:stop'));
    expect(staff.active).toEqual([]);
    expect(frets.active).toEqual([]);
  });

});
