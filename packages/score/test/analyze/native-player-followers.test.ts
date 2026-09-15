// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {
  defineSimpleScorePlayerElement,
  type SimpleScorePlayerElement,
} from '../../src/play/element/score-player';
import {defineAllAnalysisElements, type ChordAnalysisElement} from '../../src/analyze/element';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));

defineSimpleScorePlayerElement();
defineAllAnalysisElements();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function music(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  const voice = VoiceId('melody');
  ['C4', 'E4', 'G4', 'C5', 'C4', 'E4', 'G4', 'C5'].forEach((pitch, i) => {
    builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(i), duration: Duration.quarter(), voice});
  });
  return builder.build();
}

async function nativePlayer() {
  const source = document.createElement('simple-score-player') as SimpleScorePlayerElement;
  source.id = 'source';
  source.setAttribute('src', 'piece.mid');
  document.body.append(source);
  await flush();
  return source;
}

async function follower(feature: string) {
  const node = document.createElement(`${feature}-analysis`) as ChordAnalysisElement;
  node.setAttribute('player', '#source');
  node.setAttribute('motion', 'stepped');
  document.body.append(node);
  await flush();
  return node;
}

function position(node: Element): number {
  return Number(node.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('native single-score player with independent Analyze components', () => {
  it('loads one src for several companions and initializes a paused position at a changed rate', async () => {
    const score = music();
    io.load.mockResolvedValueOnce(score);
    const source = await nativePlayer();
    source.rate = 2;
    await source.seekNominal(1);
    const chord = await follower('chord');
    const roman = await follower('roman');
    expect(source.resolvedScore).toBe(score);
    expect(io.load).toHaveBeenCalledTimes(1);
    expect(source.currentTime).toBeCloseTo(0.5);
    expect(source.getPlaybackSnapshot()).toMatchObject({nominalSeconds: 1, rate: 2, playing: false});
    expect(position(chord)).toBeCloseTo(1);
    expect(position(roman)).toBeCloseTo(1);

    source.rate = 0.5;
    expect(source.currentTime).toBeCloseTo(2);
    expect(position(chord)).toBeCloseTo(1);
    expect(position(roman)).toBeCloseTo(1);
    expect(io.load).toHaveBeenCalledTimes(1);
  });

  it('delegates a keyboard seek once in nominal seconds and follows stop without playing audio', async () => {
    io.load.mockResolvedValueOnce(music());
    const source = await nativePlayer();
    source.rate = 2;
    await source.seekNominal(1);
    const chord = await follower('chord');
    const roman = await follower('roman');
    const seek = vi.spyOn(source.playback, 'seekNominal');
    const legacyNominal = vi.spyOn(source, 'seekNominal');
    const fallback = vi.spyOn(source, 'seek');
    chord.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await flush();
    expect(seek).toHaveBeenCalledOnce();
    expect(legacyNominal).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    const intended = position(chord);
    expect(intended).toBeGreaterThan(1);
    expect(seek).toHaveBeenCalledWith(intended);
    expect(source.getPlaybackSnapshot()).toMatchObject({nominalSeconds: intended, playing: false});
    expect(source.currentTime).toBeCloseTo(intended / 2);
    expect(position(chord)).toBeCloseTo(intended);
    expect(position(roman)).toBeCloseTo(intended);

    source.stop();
    expect(position(chord)).toBe(0);
    expect(position(roman)).toBe(0);
    expect(source.getPlaybackSnapshot()).toMatchObject({nominalSeconds: 0, playing: false, activeNotes: []});
  });

  it('invalidates borrowed data during a pending replacement and resolves the new source once', async () => {
    io.load.mockResolvedValueOnce(music());
    const source = await nativePlayer();
    const chord = await follower('chord');
    const roman = await follower('roman');
    let resolve!: (score: Score) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((done) => { resolve = done; }));
    source.setAttribute('src', 'replacement.mid');
    expect(source.resolvedScore).toBeUndefined();
    await flush();
    for (const companion of [chord, roman]) {
      expect(companion.textContent).toContain('Waiting for a score');
      expect(companion.querySelector('[role="slider"]')?.getAttribute('aria-disabled')).toBe('true');
    }
    expect(position(chord)).toBe(0);
    expect(position(roman)).toBe(0);
    const replacement = music();
    resolve(replacement);
    await flush();
    expect(source.resolvedScore).toBe(replacement);
    expect(chord.querySelector('[role="slider"]')).not.toBeNull();
    expect(roman.querySelector('[role="slider"]')).not.toBeNull();
    expect(io.load).toHaveBeenCalledTimes(2);
  });
});
