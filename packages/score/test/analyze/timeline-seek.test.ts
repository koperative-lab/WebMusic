// @vitest-environment jsdom

// One bug, one file. `<chord-analysis>` computed NOMINAL seconds and handed
// them to `player.seek()`, which takes RATE-SCALED TRANSPORT seconds. At rate 1
// the two coincide, which is why every existing test passed and why clicking
// bar 5 at rate 2 landed on bar 9.
//
// This regression now exercises the retained chord-progression surface.

import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ChordAnalysisElement} from '../../src/analyze/element/index';

let nextTag = 0;
const tag = (): string => {
  const name = `webscore-timeline-seek-${nextTag++}`;
  customElements.define(name, class extends ChordAnalysisElement {});
  return name;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function melody(): Score {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Melody'});
  const voice = VoiceId(`${partId}-v1`);
  ['C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4', 'G4'].forEach((name, index) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(index),
      duration: Duration.quarter(),
      voice,
    });
  });
  return builder.build();
}

/** A player that answers `seek` and nothing else. */
function stubPlayer(): HTMLElement & {seeks: number[]} {
  const element = document.createElement('div') as unknown as HTMLElement & {
    seeks: number[];
    seek(seconds: number): void;
  };
  element.id = 'player';
  element.seeks = [];
  element.seek = (seconds: number) => element.seeks.push(seconds);
  document.body.append(element);
  return element;
}

/**
 * One cursor tick, which is the ONLY way the rate reaches a listener: the
 * durations are the pair that is defined at position 0, where both positions
 * are 0 and their ratio is not.
 */
function reportRate(player: HTMLElement, score: Score, rate: number): void {
  player.dispatchEvent(
    new CustomEvent('webscore:timeupdate', {
      detail: {
        seconds: 0,
        nominalSeconds: 0,
        transportSeconds: 0,
        // Playing at rate 2 means the transport is half as long as the music.
        transportDurationSeconds: score.durationSeconds / rate,
      },
      bubbles: true,
    }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('<chord-analysis> seeking at a rate other than 1', () => {
  it('seeks in transport seconds while the event still reports nominal ones', async () => {
    const score = melody();
    const player = stubPlayer();
    const element = document.createElement(tag()) as HTMLElement & {score?: Score};
    element.setAttribute('player', '#player');
    element.score = score;
    document.body.append(element);
    await flush();
    reportRate(player, score, 2);

    const seeks: {quarters: number; seconds: number}[] = [];
    element.addEventListener('webscore:seek', (event) => {
      seeks.push((event as CustomEvent<{quarters: number; seconds: number}>).detail);
    });

    element.querySelectorAll<HTMLElement>('.wui-harmony-flow__lane[data-lane="chords"] > *')[1]!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}));
    await flush();

    expect(seeks).toHaveLength(1);
    const nominal = seeks[0].seconds;
    expect(nominal).toBeGreaterThan(0);
    // The detail stays nominal — it is documented, and nominal is the analysis
    // axis every other reader of this event is on.
    expect(nominal).toBeCloseTo(score.timeMap.quartersToSeconds(Rational.from(seeks[0].quarters)), 9);
    // The player is driven in its own units.
    expect(player.seeks).toEqual([nominal / 2]);
  });

  it('is unchanged at rate 1, which is why nothing caught this', async () => {
    const score = melody();
    const player = stubPlayer();
    const element = document.createElement(tag()) as HTMLElement & {score?: Score};
    element.setAttribute('player', '#player');
    element.score = score;
    document.body.append(element);
    await flush();
    reportRate(player, score, 1);

    const seeks: {quarters: number; seconds: number}[] = [];
    element.addEventListener('webscore:seek', (event) => {
      seeks.push((event as CustomEvent<{quarters: number; seconds: number}>).detail);
    });

    element.querySelectorAll<HTMLElement>('.wui-harmony-flow__lane[data-lane="chords"] > *')[1]!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}));
    await flush();

    expect(player.seeks).toEqual([seeks[0].seconds]);
  });

  it('prefers a player that can take the nominal figure itself', async () => {
    const score = melody();
    const player = stubPlayer() as HTMLElement & {
      seeks: number[];
      nominal: number[];
      seekNominal(seconds: number): void;
    };
    player.nominal = [];
    player.seekNominal = (seconds: number) => player.nominal.push(seconds);

    const element = document.createElement(tag()) as HTMLElement & {score?: Score};
    element.setAttribute('player', '#player');
    element.score = score;
    document.body.append(element);
    await flush();
    reportRate(player, score, 2);

    const seeks: {seconds: number}[] = [];
    element.addEventListener('webscore:seek', (event) => {
      seeks.push((event as CustomEvent<{seconds: number}>).detail);
    });

    element.querySelectorAll<HTMLElement>('.wui-harmony-flow__lane[data-lane="chords"] > *')[1]!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}));
    await flush();

    // Called for its effect, so never chained with `??` — that would run the
    // fallback as well and seek twice, to two different places.
    expect(player.nominal).toEqual([seeks[0].seconds]);
    expect(player.seeks).toEqual([]);
  });
});
