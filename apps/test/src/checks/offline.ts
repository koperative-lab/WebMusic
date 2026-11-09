import {renderModuleGraph, routeModuleOutput, type ConnectionLease} from '@webmusic/kernel/module';
import {ScorePlayerModule, ScoreRackModule} from '@webmusic/score/play/headless';
import {AudioPlayer, type AudioClipPlayer} from '@webmusic/audio/play/headless';
import {loadClipFromUrl} from '@webmusic/audio/play';
import {loadAudioClipEditor} from '@webmusic/audio/view/headless';
import {createScoreAudioSession, registerAudioParticipant} from '@webmusic/bridge';
import type {MountContext} from '../model';
import {addAction, addReadout, arabesqueAudioUrl, every, loadArabesqueScore} from './shared';

/** Plays a rendered buffer on the device; the check's own listening aid. */
class ResultPlayback {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  buffer?: AudioBuffer;

  async play(): Promise<void> {
    if (!this.buffer) throw new Error('Render first.');
    this.stop();
    this.context ??= new AudioContext();
    await this.context.resume();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    source.start();
    this.source = source;
  }

  stop(): void {
    try { this.source?.stop(); } catch { /* already ended */ }
    this.source?.disconnect();
    this.source = undefined;
  }

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
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

function playbackActions(context: MountContext, playback: ResultPlayback): void {
  addAction(context, {zh: '播放结果', en: 'Play result'}, () => playback.play());
  addAction(context, {zh: '停止', en: 'Stop'}, () => playback.stop());
}

/** H1: a Rack, a Score player and its scheduler rendered offline in one Session. */
export function mountOfflineScore(context: MountContext): () => void {
  const playback = new ResultPlayback();
  const time = addReadout(context, {zh: '渲染耗时', en: 'Render time'});
  const level = addReadout(context, {zh: '各秒峰值', en: 'Peak per second'});
  addAction(context, {zh: '渲染 12 秒', en: 'Render 12 s'}, async () => {
    const score = await loadArabesqueScore('midi');
    const started = performance.now();
    playback.buffer = await renderModuleGraph({
      sampleRate: 44100, durationSeconds: 12,
      build(scope) {
        const rack = new ScoreRackModule(scope, {id: 'desk'});
        const piano = new ScorePlayerModule(score, {id: 'piano', context: rack.context});
        return () => { piano.dispose(); rack.dispose(); };
      },
    });
    time(`${Math.round(performance.now() - started)} ms`);
    level(windows(playback.buffer, [0, 3, 6, 9, 11]));
  }, true);
  playbackActions(context, playback);
  return () => playback.dispose();
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
export function mountOfflineDocument(context: MountContext): () => void {
  const playback = new ResultPlayback();
  const before = addReadout(context, {zh: '剪辑前匹配', en: 'Before-cut match'});
  const after = addReadout(context, {zh: '剪辑后匹配', en: 'After-cut match'});
  const control = addReadout(context, {zh: '对照（应不匹配）', en: 'Control (should not match)'});
  addAction(context, {zh: '渲染剪辑后的文档', en: 'Render edited document'}, async () => {
    const editor = await loadAudioClipEditor(arabesqueAudioUrl(), {signal: context.signal});
    try {
      const sampleRate = editor.getSnapshot().content.sampleRate;
      const cut = editor.cut({startFrame: sampleRate, endFrame: 2 * sampleRate});
      if (cut.status !== 'committed') throw new Error(`Cut ${cut.status}`);
      const edited = editor.getSnapshot();
      const original = (await loadClipFromUrl(arabesqueAudioUrl(), {streaming: false})).channelData(0);
      if (!original) throw new Error('The recording has no decoded samples.');
      playback.buffer = await renderModuleGraph({
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
      const rendered = playback.buffer.getChannelData(0);
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
    } finally {
      editor.dispose();
    }
  }, true);
  playbackActions(context, playback);
  return () => playback.dispose();
}

/** H3: one Session over a Score engine and an Audio clip, commanded from code. */
export async function mountScoreAudioSession(context: MountContext): Promise<() => void> {
  const [score, clip] = await Promise.all([
    loadArabesqueScore('midi'),
    loadClipFromUrl(arabesqueAudioUrl(), {signal: context.signal}),
  ]);
  const composition = createScoreAudioSession(score, clip, {onOperationError: (_operation, error) => context.fail(error)});
  if (context.signal.aborted) { composition.dispose(); return () => {}; }
  addAction(context, {zh: '播放', en: 'Play'}, () => composition.session.play(), true);
  addAction(context, {zh: '暂停', en: 'Pause'}, () => composition.session.pause());
  addAction(context, {zh: '从 30 秒播放', en: 'Play from 30 s'}, async () => {
    await composition.session.seek(30);
    await composition.session.play();
  });
  const state = addReadout(context, {zh: 'Session', en: 'Session'});
  every(context.signal, 200, () => {
    const snapshot = composition.session.snapshot;
    state(`${snapshot.paused ? 'paused' : 'playing'} · ${snapshot.position.toFixed(1)} s · ${snapshot.participantCount} participants`);
  });
  return () => composition.dispose();
}
