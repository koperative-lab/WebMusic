import {defineAllElements} from '@webmusic/score/play/element';
import {defineAllAudioElements as defineAudioPlay} from '@webmusic/audio/play/element';
import {defineAllAudioElements as defineAudioAnalyze} from '@webmusic/audio/analyze/element';
import type {MountContext} from '../model';
import {addChoice, arabesqueAudioUrl, arabesqueUrl, reportErrors, setMarkup, stopPlayers, wireMonitoredInput} from './shared';

type Width = 'full' | '480' | '375' | '320';

/**
 * G1–G3: one canvas with every interactive family the earlier checks use — a
 * Session transport over a desk, note input with a recorder, and an audio
 * player with its queue and meter — so keyboard, screen-reader and touch
 * passes cover the shipped controls in one place.
 */
function mountTour(context: MountContext): () => void {
  defineAllElements();
  defineAudioPlay();
  defineAudioAnalyze();
  const midi = arabesqueUrl('midi');
  const wav = arabesqueAudioUrl();
  setMarkup(context.canvas, `
    <score-player controls="show" time-control="full" aria-label="Desk transport">
      <score-rack-control id="mt-tour-desk" master mute solo>
        <score-rack-part id="piano" src="${midi}"></score-rack-part>
        <score-rack-part id="pad" src="${midi}" sound="triangle" volume="0.4"></score-rack-part>
        <score-effect id="mt-tour-room" type="reverb" wet="0.15" dry="1"></score-effect>
      </score-rack-control>
    </score-player>
    <score-synth-panel target="#mt-tour-room" sections="effects" aria-label="Room parameters"></score-synth-panel>
    <score-note-input id="mt-tour-keys" layout="piano" start="60" end="72" keyboard routing="manual" aria-label="Piano keys"></score-note-input>
    <score-recorder id="mt-tour-take" quantize="0" aria-label="Take recorder"></score-recorder>
    <audio-player id="mt-tour-player" aria-label="Recording transport"></audio-player>
    <audio-playlist input="#mt-tour-player" aria-label="Arabesque No. 1 queue"></audio-playlist>
    <audio-meter input="#mt-tour-player" aria-label="Recording level"></audio-meter>`);
  wireMonitoredInput(context.canvas.querySelector('#mt-tour-keys')!, context.canvas.querySelector('#mt-tour-take')!);
  const playlist = context.canvas.querySelector<HTMLElement & {entries?: unknown}>('audio-playlist')!;
  playlist.entries = [
    {id: 'wav-1', src: wav, label: 'Arabesque No. 1 · WAV · 1'},
    {id: 'wav-2', src: wav, label: 'Arabesque No. 1 · WAV · 2'},
  ];
  const stopErrors = reportErrors(context);
  return () => { stopErrors(); stopPlayers(context.canvas); };
}

/** G1 and G2: the tour at the page's width. */
export function mountAccessibilityTour(context: MountContext): () => void {
  return mountTour(context);
}

/** G3: the tour with the canvas narrowed to a phone width in Parameters. */
export function mountNarrowTour(context: MountContext): () => void {
  const cleanup = mountTour(context);
  const apply = (width: Width) => { context.canvas.style.maxWidth = width === 'full' ? '' : `${width}px`; };
  addChoice<Width>(context, 'Canvas width', [
    {id: 'full', label: 'Full'},
    {id: '480', label: '480 px'},
    {id: '375', label: '375 px'},
    {id: '320', label: '320 px'},
  ], 'full', apply);
  return () => { context.canvas.style.maxWidth = ''; cleanup(); };
}
