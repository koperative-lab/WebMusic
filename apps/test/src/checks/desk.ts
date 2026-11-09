import {defineAllElements} from '@webmusic/score/play/element';
import {defineAllAudioElements as defineAudioPlay} from '@webmusic/audio/play/element';
import {defineAllAudioElements as defineAudioAnalyze} from '@webmusic/audio/analyze/element';
import type {MountContext} from '../model';
import {arabesqueAudioUrl, arabesqueUrl, reportErrors, setMarkup, stopPlayers} from './shared';

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
