// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ScoreViewElement} from '../../src/view/element/score-view';

const requests = vi.hoisted(() => [] as ((score: Score) => void)[]);
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: () => new Promise<Score>((resolve) => requests.push(resolve))}));
customElements.define('loading-map-view', class extends ScoreViewElement {});

const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
function music() {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId('v')});
  return builder.build();
}
afterEach(() => { document.body.replaceChildren(); requests.length = 0; });

it('does not commit a previous seek while replacement URL input is still loading', async () => {
  let finish!: () => void;
  const player = Object.assign(document.createElement('div'), {
    id: 'loading-map-owner', score: music(),
    seek: () => new Promise<void>((resolve) => { finish = resolve; }),
  });
  const view = document.createElement('loading-map-view') as ScoreViewElement;
  view.type = 'map';
  view.setAttribute('player', '#loading-map-owner');
  document.body.append(player, view);
  await flush();
  const range = view.querySelector<HTMLInputElement>('[part~="seek"]')!;
  range.value = '3';
  range.dispatchEvent(new Event('input', {bubbles: true}));
  expect(view.currentTime).toBe(0);
  view.setAttribute('src', 'replacement.mxl');
  await vi.waitFor(() => expect(requests.length).toBe(1));
  finish();
  await flush();
  expect(view.currentTime).toBe(0);
  requests[0]!(music());
  await flush();
  expect(view.currentTime).toBe(0);
});
