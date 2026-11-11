import {defineAllElements} from '@webmusic/score/play/element';
import {defineAllAudioElements as defineAudioPlay} from '@webmusic/audio/play/element';
import {defineAllAudioElements as defineAudioAnalyze} from '@webmusic/audio/analyze/element';
import type {MountContext} from '../model';
import {addChoice, arabesqueAudioUrl, arabesqueUrl, reportErrors, setMarkup, stopPlayers} from './shared';

/** A1, A2, A4: the docs' modular composition — one Session over Score, Audio, a Rack part and shared inserts. */
export function mountComposedDesk(context: MountContext): () => void {
  return mountDesk(context, false);
}

/** A3: the same desk with a second panel on the one shared reverb. */
export function mountSharedEffectDesk(context: MountContext): () => void {
  return mountDesk(context, true);
}

function mountDesk(context: MountContext, sharedPanels: boolean): () => void {
  defineAllElements();
  defineAudioPlay();
  defineAudioAnalyze();
  const midi = arabesqueUrl('midi');
  const wav = arabesqueAudioUrl();
  setMarkup(context.canvas, `
    <score-player controls="show" time-control="full" aria-label="Session transport">
      <score-rack-control id="mt-desk" master mute solo>
        <score-player id="score" src="${midi}" volume="0.3"></score-player>
        <audio-player id="recording" src="${wav}" volume="0.3"></audio-player>
        <score-rack-part id="pad" src="${midi}" sound="triangle"></score-rack-part>
        <score-effect id="mt-room" type="reverb" wet="0.15" dry="1"></score-effect>
        <audio-effect id="mt-filter" type="filter" frequency="6000" q="0.7"></audio-effect>
      </score-rack-control>
    </score-player>
    ${sharedPanels ? `<div class="mt-pair">
      <score-synth-panel target="#mt-room" sections="effects" aria-label="Room parameters"></score-synth-panel>
      <score-synth-panel target="#mt-room" sections="effects" aria-label="The same room parameters"></score-synth-panel>
    </div>` : '<score-synth-panel target="#mt-room" sections="effects" aria-label="Room parameters"></score-synth-panel>'}
    <audio-spectrum-analyzer input="#mt-desk" port="master" aria-label="Mixed output spectrum"></audio-spectrum-analyzer>`);
  const stopErrors = reportErrors(context);
  return () => { stopErrors(); stopPlayers(context.canvas); };
}

type InsertType = 'filter' | 'distortion' | 'bitcrusher' | 'reverb';

/** A5: one insert switched between types; its panel is titled by the type and shows that type's controls. */
export function mountInsertTypes(context: MountContext): () => void {
  defineAllElements();
  setMarkup(context.canvas, `
    <score-player controls="show" time-control="full" src="${arabesqueUrl('midi')}" aria-label="Arabesque No. 1 with one insert">
      <score-effect id="mt-insert" type="distortion"></score-effect>
      <score-synth-panel target="#mt-insert" sections="effects" aria-label="Insert parameters"></score-synth-panel>
      <score-synth-panel sections="sound,envelope" aria-label="Sound and envelope"></score-synth-panel>
    </score-player>`);
  const insert = context.canvas.querySelector('#mt-insert')!;
  addChoice<InsertType>(context, 'Insert type', [
    {id: 'distortion', label: 'Distortion'},
    {id: 'bitcrusher', label: 'Bitcrusher'},
    {id: 'filter', label: 'Filter'},
    {id: 'reverb', label: 'Reverb'},
  ], 'distortion', (type) => { insert.setAttribute('type', type); });
  const stopErrors = reportErrors(context);
  return () => { stopErrors(); stopPlayers(context.canvas); };
}
