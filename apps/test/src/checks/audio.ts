import {loadClipFromUrl} from '@webmusic/audio/play';
import {defineAllAudioElements as defineAudioPlay, type AudioMixerElement, type AudioPlayerElement} from '@webmusic/audio/play/element';
import {defineAllAudioElements as defineAudioView, type AudioClipViewElement} from '@webmusic/audio/view/element';
import {defineAllAudioElements as defineAudioAnalyze} from '@webmusic/audio/analyze/element';
import {loadAudioClipEditor} from '@webmusic/audio/view/headless';
import type {MountContext} from '../model';
import {addChoice, arabesqueAudioUrl, arabesqueMp3Url, reportErrors, setMarkup, stopPlayers} from './shared';

function defineAudio(): void {
  defineAudioPlay();
  defineAudioView();
  defineAudioAnalyze();
}

function finish(context: MountContext): () => void {
  const stopErrors = reportErrors(context);
  return () => { stopErrors(); stopPlayers(context.canvas); };
}

/** E1: one player over the decoded WAV, with its rate in Parameters. */
export function mountAudioPlayer(context: MountContext): () => void {
  defineAudio();
  setMarkup(context.canvas, `<audio-player id="mt-audio" src="${arabesqueAudioUrl()}" controls aria-label="Arabesque No. 1 recording"></audio-player>`);
  const player = context.canvas.querySelector<AudioPlayerElement>('#mt-audio')!;
  addChoice(context, 'Rate', [
    {id: '0.75', label: '0.75×'},
    {id: '1', label: '1×'},
    {id: '1.25', label: '1.25×'},
  ], '1', (rate) => { player.setAttribute('rate', rate); });
  return finish(context);
}

/** E2 and F3: a looping queue behind a player, with a spectrum and a meter tapping that player. */
export function mountPlaylist(context: MountContext): () => void {
  defineAudio();
  const wav = arabesqueAudioUrl();
  setMarkup(context.canvas, `
    <audio-player id="mt-queue-player" aria-label="Playlist transport"></audio-player>
    <audio-playlist input="#mt-queue-player" loop aria-label="Arabesque No. 1 queue"></audio-playlist>
    <audio-spectrum-analyzer input="#mt-queue-player" aria-label="Queue output spectrum"></audio-spectrum-analyzer>
    <audio-meter input="#mt-queue-player" aria-label="Queue output level"></audio-meter>`);
  const playlist = context.canvas.querySelector<HTMLElement & {entries?: unknown}>('audio-playlist')!;
  playlist.entries = [
    {id: 'wav-1', src: wav, label: 'Arabesque No. 1 · WAV · 1'},
    {id: 'wav-2', src: wav, label: 'Arabesque No. 1 · WAV · 2'},
    {id: 'mp3', src: arabesqueMp3Url(), label: 'Arabesque No. 1 · MP3 · streamed', streaming: true},
  ];
  return finish(context);
}

/** E3: two members of one decoded clip under a mixer backend. */
export async function mountMixer(context: MountContext): Promise<() => void> {
  defineAudio();
  setMarkup(context.canvas, `
    <audio-player id="mt-mix-player" aria-label="Mixer transport"></audio-player>
    <audio-mixer id="mt-mixer" input="#mt-mix-player" aria-label="Two-track mixer"></audio-mixer>`);
  const cleanup = finish(context);
  const player = context.canvas.querySelector<AudioPlayerElement>('#mt-mix-player')!;
  const mixer = context.canvas.querySelector<AudioMixerElement>('#mt-mixer')!;
  player.loading = mixer.loading = true;
  try {
    const clip = await loadClipFromUrl(arabesqueAudioUrl(), {signal: context.signal});
    if (!context.signal.aborted) mixer.members = [{id: 'track A', clip}, {id: 'track B', clip, volume: 0.6}];
  } finally {
    if (!context.signal.aborted) player.loading = mixer.loading = false;
  }
  return () => { cleanup(); mixer.members = undefined; };
}

/** E4: an editor document shared by a waveform editor and a player. */
export async function mountDocumentEditing(context: MountContext): Promise<() => void> {
  defineAudio();
  setMarkup(context.canvas, `
    <audio-player id="mt-audition" controls aria-label="Edited document playback"></audio-player>
    <audio-clip-view id="mt-take-view" input="#mt-audition" editable aria-label="Arabesque No. 1 waveform editor"></audio-clip-view>`);
  const cleanup = finish(context);
  const editor = await loadAudioClipEditor(arabesqueAudioUrl(), {signal: context.signal});
  if (context.signal.aborted) { editor.dispose(); return cleanup; }
  const player = context.canvas.querySelector<AudioPlayerElement>('#mt-audition')!;
  const view = context.canvas.querySelector<AudioClipViewElement>('#mt-take-view')!;
  player.editor = editor;
  view.editor = editor;
  return () => {
    cleanup();
    player.editor = undefined;
    view.editor = undefined;
    editor.dispose();
  };
}

/** F1: microphone capture auditioned through a player. */
export function mountMicrophone(context: MountContext): () => void {
  defineAudio();
  setMarkup(context.canvas, `
    <audio-player id="mt-mic-player" aria-label="Take playback"></audio-player>
    <audio-recorder input="#mt-mic-player" aria-label="Microphone recorder"></audio-recorder>`);
  return finish(context);
}

/** F2: a meter linked to a player by `input`. */
export function mountMeter(context: MountContext): () => void {
  defineAudio();
  setMarkup(context.canvas, `
    <audio-player id="mt-meter-player" src="${arabesqueAudioUrl()}" controls aria-label="Arabesque No. 1 recording"></audio-player>
    <audio-meter input="#mt-meter-player" aria-label="Recording level"></audio-meter>`);
  return finish(context);
}
