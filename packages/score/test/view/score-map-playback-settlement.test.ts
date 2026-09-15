// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type ScorePlaybackSource} from '../../src/core';
import {ScorePlayer} from '../../src/play/headless/score-player';
import {ScoreViewElement as PreviewScoreViewElement} from '../../src/view/element/score-view';
class ScorePreviewElement extends PreviewScoreViewElement {
  override connectedCallback(): void { this.type = 'map'; super.connectedCallback(); }
}

customElements.define('settlement-score-map', ScorePreviewElement);

const players: ScorePlayer[] = [];
const flush = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

function music(pitch = 'C4') {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Part'});
  builder.addNote(part, {
    id: builder.newNoteId(),
    pitch: Pitch.parse(pitch),
    onsetQuarters: Rational.ZERO,
    duration: Duration.whole(),
    voice: VoiceId('voice'),
  });
  return builder.build();
}

function owner(player: ScorePlayer): void {
  players.push(player);
  const element = document.createElement('div') as HTMLDivElement & {playback: ScorePlaybackSource};
  element.id = 'settlement-owner';
  element.playback = player.playback;
  document.body.append(element);
}

function map(): ScorePreviewElement {
  const element = document.createElement('settlement-score-map') as ScorePreviewElement;
  element.setAttribute('player', '#settlement-owner');
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  for (const player of players.splice(0)) player.dispose();
});

describe('ScoreMap native playback settlement', () => {
  it('retains the actual wrapped nominal position after an awaited seek at rate 2', async () => {
    const player = new ScorePlayer(music());
    // Set the nominal loop before changing rate: the scheduler preserves its
    // musical region, while the map's input remains measured in quarters.
    player.setLoop(0, 1);
    player.setRate(2);
    owner(player);
    const element = map();
    document.body.append(element);
    await flush();

    const seek = element.querySelector<HTMLInputElement>('[part~="seek"]');
    expect(seek).not.toBeNull();
    seek!.value = '3'; // 1.5 nominal seconds; the native loop lands at 0.5.
    seek!.dispatchEvent(new Event('input', {bubbles: true}));
    await flush();

    expect(player.nominalSeconds).toBeCloseTo(0.5);
    expect(player.seconds).toBeCloseTo(0.25);
    expect(element.currentTime).toBeCloseTo(player.nominalSeconds);
  });

  it('keeps explicit local music static when the selected player has another score', async () => {
    const player = new ScorePlayer(music('G4'));
    owner(player);
    const local = music('C4');
    const element = map();
    element.score = local;
    document.body.append(element);
    await flush();

    await player.playback.seekNominal!(1.5);
    await flush();

    expect(player.nominalSeconds).toBeCloseTo(1.5);
    expect(element.score).toBe(local);
    expect(element.getAttribute('data-player-state')).toBe('mismatched');
    expect(element.currentTime).toBe(0);
  });
});
