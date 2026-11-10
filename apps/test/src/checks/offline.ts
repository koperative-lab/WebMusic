import {renderModuleGraph, routeModuleOutput, type ConnectionLease} from '@webmusic/kernel/module';
import {ScorePlayerModule, ScoreRackModule} from '@webmusic/score/play/headless';
import {AudioPlayer, type AudioClipPlayer} from '@webmusic/audio/play/headless';
import {loadClipFromUrl} from '@webmusic/audio/play';
import {loadAudioClipEditor} from '@webmusic/audio/view/headless';
import {createScoreAudioSession, registerAudioParticipant} from '@webmusic/bridge';
import {createAudioClip} from '@webmusic/audio';
import {defineAllAudioElements as defineAudioPlay, type AudioPlayerElement} from '@webmusic/audio/play/element';
import {defineAllAudioElements as defineAudioView, type AudioClipViewElement} from '@webmusic/audio/view/element';
import {mountTransport} from '@webmusic/ui/transport';
import type {MountContext} from '../model';
import {addAction, addReadout, arabesqueAudioUrl, every, loadArabesqueScore, reportErrors, setMarkup, stopPlayers} from './shared';

/**
 * The rendered result, heard and seen through the package's own player and
 * waveform view in the live canvas.
 */
function resultCanvas(context: MountContext, label: string): (buffer: AudioBuffer) => void {
  defineAudioPlay();
  defineAudioView();
  setMarkup(context.canvas, `
    <audio-player id="mt-result" controls aria-label="${label}"></audio-player>
    <audio-clip-view input="#mt-result" aria-label="${label} waveform"></audio-clip-view>`);
  const player = context.canvas.querySelector<AudioPlayerElement>('#mt-result')!;
  // The view draws its own `.clip` and follows the player for the playhead.
  const view = context.canvas.querySelector<AudioClipViewElement>('audio-clip-view')!;
  const stopErrors = reportErrors(context);
  context.signal.addEventListener('abort', () => { stopErrors(); stopPlayers(context.canvas); }, {once: true});
  return (buffer) => {
    player.stop();
    const clip = createAudioClip({sampleRate: buffer.sampleRate,
      channelData: Array.from({length: buffer.numberOfChannels}, (_, channel) => buffer.getChannelData(channel).slice())});
    player.clip = clip;
    view.clip = clip;
  };
}

/** Peak level per window, so a stalled scheduler shows as silence. */
function windows(buffer: AudioBuffer, seconds: readonly number[]): string {
  const data = buffer.getChannelData(0);
  return seconds.map((from) => {
    let peak = 0;
    const end = Math.min(data.length, Math.floor((from + 1) * buffer.sampleRate));
    for (let index = Math.floor(from * buffer.sampleRate); index < end; index++) peak = Math.max(peak, Math.abs(data[index]!));
    return `${from}s ${peak.toFixed(3)}`;
  }).join(' · ');
}

/** H1: a Rack, a Score player and its scheduler rendered offline in one Session. */
export function mountOfflineScore(context: MountContext): void {
  const show = resultCanvas(context, 'Rendered module graph');
  const time = addReadout(context, 'Render time');
  const level = addReadout(context, 'Peak per second');
  // Rendered once on open, so the result player has its clip before any press.
  addAction(context, 'Render 12 s', async () => {
    const score = await loadArabesqueScore('midi');
    const started = performance.now();
    const buffer = await renderModuleGraph({
      sampleRate: 44100, durationSeconds: 12,
      build(scope) {
        const rack = new ScoreRackModule(scope, {id: 'desk'});
        const piano = new ScorePlayerModule(score, {id: 'piano', context: rack.context});
        return () => { piano.dispose(); rack.dispose(); };
      },
    });
    time(`${Math.round(performance.now() - started)} ms`);
    level(windows(buffer, [0, 3, 6, 9, 11]));
    show(buffer);
  }, true).click();
}

/** Correlation and level of rendered[a…] against source[b…]. */
function match(rendered: Float32Array, source: Float32Array, sampleRate: number, a: number, b: number, seconds: number): string {
  let xy = 0; let xx = 0; let yy = 0;
  for (let index = 0; index < Math.floor(seconds * sampleRate); index++) {
    const p = rendered[Math.floor(a * sampleRate) + index] ?? 0;
    const q = source[Math.floor(b * sampleRate) + index] ?? 0;
    xy += p * q; xx += p * p; yy += q * q;
  }
  return (xy / Math.sqrt(xx * yy || 1)).toFixed(3);
}

/** H2: the WAV as an editor document with 1–2 s cut, rendered offline through a Rack channel. */
export function mountOfflineDocument(context: MountContext): void {
  const show = resultCanvas(context, 'Rendered edited document');
  const before = addReadout(context, 'Before-cut match');
  const after = addReadout(context, 'After-cut match');
  const control = addReadout(context, 'Control (should not match)');
  // Rendered once on open, so the result player has its clip before any press.
  addAction(context, 'Render edited document', async () => {
    const editor = await loadAudioClipEditor(arabesqueAudioUrl(), {signal: context.signal});
    try {
      const sampleRate = editor.getSnapshot().content.sampleRate;
      const cut = editor.cut({startFrame: sampleRate, endFrame: 2 * sampleRate});
      if (cut.status !== 'committed') throw new Error(`Cut ${cut.status}`);
      const edited = editor.getSnapshot();
      const original = (await loadClipFromUrl(arabesqueAudioUrl(), {streaming: false})).channelData(0);
      if (!original) throw new Error('The recording has no decoded samples.');
      const buffer = await renderModuleGraph({
        sampleRate, durationSeconds: 8,
        async build(scope) {
          const rack = new ScoreRackModule(scope, {id: 'desk'});
          const player = new AudioPlayer(undefined, {moduleContext: rack.context});
          player.setDocumentSource(editor);
          await player.waitForDocumentRevision(edited);
          let route: ConnectionLease | undefined;
          const lease = registerAudioParticipant(scope.session!, player as unknown as AudioClipPlayer, {prepare: async () => {
            await player.preload();
            route ??= routeModuleOutput(rack.context, {...player.module, id: 'edited'}, player.outputPort!);
          }});
          return () => { lease.release(); route?.release(); player.dispose(); rack.dispose(); };
        },
      });
      // Find the Session's start lead, then compare around the cut.
      const rendered = buffer.getChannelData(0);
      let lead = 0; let best = -1;
      for (let lag = 0; lag < Math.floor(0.4 * sampleRate); lag++) {
        let xy = 0; let xx = 0; let yy = 0;
        for (let index = 0; index < 2048; index++) {
          const p = rendered[lag + index + sampleRate / 4] ?? 0; const q = original[index + sampleRate / 4] ?? 0;
          xy += p * q; xx += p * p; yy += q * q;
        }
        const value = xy / Math.sqrt(xx * yy || 1);
        if (value > best) { best = value; lead = lag; }
      }
      const offset = lead / sampleRate;
      before(match(rendered, original, sampleRate, 0.1 + offset, 0.1, 0.8));
      after(match(rendered, original, sampleRate, 1.1 + offset, 2.1, 2));
      control(match(rendered, original, sampleRate, 1.1 + offset, 1.1, 2));
      show(buffer);
    } finally {
      editor.dispose();
    }
  }, true).click();
}

/** H3: one Session over a Score engine and an Audio clip, commanded from code. */
export async function mountScoreAudioSession(context: MountContext): Promise<() => void> {
  const [score, clip] = await Promise.all([
    loadArabesqueScore('midi'),
    loadClipFromUrl(arabesqueAudioUrl(), {signal: context.signal}),
  ]);
  const composition = createScoreAudioSession(score, clip, {onOperationError: (_operation, error) => context.fail(error)});
  if (context.signal.aborted) { composition.dispose(); return () => {}; }
  const session = composition.session;
  const transport = mountTransport(context.canvas, {
    snapshot: () => {
      const state = session.snapshot;
      const duration = state.durationSeconds ?? 0;
      return {playing: !state.paused, seconds: state.position, duration,
        progress: duration > 0 ? Math.min(1, state.position / duration) : 0};
    },
    play: () => session.play().then(() => undefined),
    pause: () => { void session.pause().catch((error: unknown) => context.fail(error)); },
    seekFraction: (value) => session.seek(value * (session.snapshot.durationSeconds ?? 0)).then(() => undefined),
    // The Session publishes state changes; its position advances between them.
    subscribe: (notify) => {
      const offSession = session.subscribe(() => notify());
      const timer = setInterval(notify, 100);
      return () => { offSession(); clearInterval(timer); };
    },
  }, {label: 'Score + Audio Session', showTime: true, seekControl: 'surface', onError: (error) => context.fail(error)});
  addAction(context, 'Play from 30 s', async () => {
    await composition.session.seek(30);
    await composition.session.play();
  });
  const state = addReadout(context, 'Session');
  every(context.signal, 200, () => {
    const snapshot = composition.session.snapshot;
    state(`${snapshot.paused ? 'paused' : 'playing'} · ${snapshot.position.toFixed(1)} s · ${snapshot.participantCount} participants`);
  });
  return () => { transport.destroy(); composition.dispose(); };
}
