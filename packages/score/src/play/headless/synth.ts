// ============================================================================
// Adapters for injected third-party synth *instances*.
//
// The Tone.js instrument adapter that used to live here (`ToneSynth`)
// duplicated the adapter inside `./sound` and has been removed — use
// `Sound.from(toneInstrument)` instead, which additionally routes the
// instrument through Sound's per-voice gain bus.
//
// `SpessaSynthSynth` remains because it is genuinely unique: it wraps an
// *existing* spessasynth instance you constructed yourself, whereas
// `Sound.soundfont2(source)` builds one for you from a .sf2/.sf3 source.
// ============================================================================

import type {SynthBackend} from './audio-contracts';
import {reportPlaybackOperationFailure} from './playback-events';

type Timer = ReturnType<typeof setTimeout>;

/**
 * spessasynth plays in real time — its `noteOn(channel, pitch, velocity)` takes
 * no time argument, so the scheduled audio-clock `time` is honoured with a
 * short timer (mirroring SpessaSoundBackend in `./sound`). Timers are tracked
 * and cleared on dispose so nothing fires after teardown.
 *
 * Prefer `Sound.soundfont2(source)` when you just have a .sf2/.sf3 file; use
 * this only to adopt a spessasynth instance you already own.
 */
export class SpessaSynthSynth implements SynthBackend {
  private readonly timers = new Set<Timer>();
  private readonly activeNotes = new Map<number, number>();
  private disposed = false;

  constructor(
    private readonly synth: any,
    private readonly channel = 0,
    /** Optional AudioContext used to convert the scheduled time into a delay. */
    private readonly context?: AudioContext,
  ) {}

  noteOn(pitch: number, velocity: number, time: number): void {
    this.schedule(time, () => {
      if (typeof this.synth.noteOn !== 'function') return;
      // Adopt ownership before calling third-party code. Some implementations
      // can start a voice and then throw, so post-call bookkeeping leaks sound.
      this.activeNotes.set(pitch, (this.activeNotes.get(pitch) ?? 0) + 1);
      try {
        this.synth.noteOn(this.channel, pitch, velocity);
      } catch (error) {
        if (typeof this.synth.noteOff === 'function') {
          try {
            this.synth.noteOff(this.channel, pitch);
            // Keep the intent through the arbitrary backend call. A thrown
            // release is ambiguous (it may have committed), so only a clean
            // return proves that this one attack can be forgotten.
            this.discardActiveNoteIntent(pitch);
          } catch (compensationError) {
            reportPlaybackOperationFailure(
              'SpessaSynthSynth',
              'compensate failed note-on',
              compensationError,
            );
          }
        }
        throw error;
      }
    });
  }

  noteOff(pitch: number, time: number): void {
    this.schedule(time, () => {
      this.synth.noteOff?.(this.channel, pitch);
      const count = this.activeNotes.get(pitch) ?? 0;
      if (count <= 1) this.activeNotes.delete(pitch);
      else this.activeNotes.set(pitch, count - 1);
    }, true);
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
    }
    // Timers only model the missing audio-clock API. Once a note-on has
    // reached the adopted synth, teardown must emit matching note-offs rather
    // than merely forgetting its future release timer. Retain an intent whose
    // release throws so a repeated dispose() can conservatively retry it.
    if (typeof this.synth.noteOff !== 'function') return;
    for (const [pitch, count] of [...this.activeNotes]) {
      let released = 0;
      for (let index = 0; index < count; index += 1) {
        try {
          this.synth.noteOff(this.channel, pitch);
          released += 1;
        } catch (error) {
          reportPlaybackOperationFailure('SpessaSynthSynth', 'dispose note', error);
        }
      }
      const remaining = count - released;
      if (remaining === 0) this.activeNotes.delete(pitch);
      else this.activeNotes.set(pitch, remaining);
    }
  }

  private schedule(time: number, fn: () => void, release = false): void {
    if (this.disposed) return;
    const ctx: {currentTime?: unknown; state?: string} | undefined =
      this.context ?? this.synth?.context ?? this.synth?.targetNode?.context;
    const dueRelease = release && ctx && typeof ctx.currentTime === 'number' && time <= ctx.currentTime;
    const delay =
      !dueRelease && ctx?.state && ctx.state !== 'running' ? 50 :
        ctx && typeof ctx.currentTime === 'number' ? Math.max(0, (time - ctx.currentTime) * 1000) : 0;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.disposed || (!release && ctx?.state === 'closed')) return;
      if (ctx && ((typeof ctx.currentTime === 'number' && ctx.currentTime < time) || (!release && ctx.state && ctx.state !== 'running'))) {
        this.schedule(time, fn, release);
        return;
      }
      fn();
    }, delay);
    this.timers.add(timer);
  }

  private discardActiveNoteIntent(pitch: number): void {
    const count = this.activeNotes.get(pitch);
    if (count == null) return;
    if (count <= 1) this.activeNotes.delete(pitch);
    else this.activeNotes.set(pitch, count - 1);
  }
}
