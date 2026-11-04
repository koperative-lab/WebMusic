// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type ScorePlaybackSource} from '../../src/core';
import {ScorePlayer} from '../../src/play/headless/score-player';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('local-music-score-view', ScoreViewElement);

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

function view(): ScoreViewElement {
  const element = document.createElement('local-music-score-view') as ScoreViewElement;
  element.setAttribute('player', '#settlement-owner');
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  for (const player of players.splice(0)) player.dispose();
});

describe('score-view with local music and a native player', () => {
  it('keeps explicit local music static when the selected player has another score', async () => {
    const player = new ScorePlayer(music('G4'));
    owner(player);
    const local = music('C4');
    const element = view();
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
