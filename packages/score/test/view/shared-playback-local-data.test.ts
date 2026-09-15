// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ScorePlayer} from '../../src/play/headless/score-player';
import {ScoreViewElement} from '../../src/view/element/score-view';
import {ChordAnalysisElement} from '../../src/analyze/element/chord-analysis';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
customElements.define('local-data-score-view', ScoreViewElement);
customElements.define('local-data-chord-analysis', ChordAnalysisElement);
const players: ScorePlayer[] = [];
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
function music(pitch: string): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Part'});
  builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('voice')});
  return builder.build();
}
afterEach(() => {
  document.body.replaceChildren();
  for (const player of players.splice(0)) player.dispose();
  vi.clearAllMocks();
});
describe('shared playback with asynchronously loaded local music', () => {
  it.each(['map', 'piano-roll', 'chord'])('keeps %s at its own origin after a different local src resolves', async (mode) => {
    const player = new ScorePlayer(music('G4'));
    players.push(player);
    await player.playback.seekNominal!(1);
    const owner = Object.assign(document.createElement('div'), {playback: player.playback});
    owner.id = 'local-data-owner';
    document.body.append(owner);
    let finish!: (score: Score) => void;
    io.load.mockImplementationOnce(() => new Promise<Score>((resolve) => { finish = resolve; }));
    const follower = document.createElement(mode === 'chord' ? 'local-data-chord-analysis' : 'local-data-score-view') as ScoreViewElement | ChordAnalysisElement;
    if (follower instanceof ScoreViewElement) follower.type = mode as 'map' | 'piano-roll';
    follower.setAttribute('player', '#local-data-owner');
    follower.setAttribute('src', '/local.mid');
    document.body.append(follower);
    await flush();
    finish(music('C4'));
    await flush();
    expect(follower.getAttribute('data-player-state')).toBe('mismatched');
    expect(follower instanceof ScoreViewElement ? follower.currentTime
      : Number(follower.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'))).toBe(0);
    expect(io.load).toHaveBeenCalledOnce();
  });
});
