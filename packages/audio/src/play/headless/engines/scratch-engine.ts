import type {AudioClip} from '../../../core';
import {copyClipPcmRange} from '../../../core/model/AudioClip';

const WINDOW_SECONDS = 2;
const FADE_SECONDS = 0.005;
const RAMP_SECONDS = 0.008;
const HOLD_SECONDS = 0.07;
const IDLE_SECONDS = 0.1;
const MAX_VOICES = 4;

type Loop = boolean | {start: number; end: number};
interface RatePoint { time: number; rate: number }
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  direction: number;
  lower: number;
  upper: number;
  phase: number;
  profile: RatePoint[];
  gainProfile: RatePoint[];
  start: number;
  end: number;
  released: boolean;
}

function rateAt(points: RatePoint[], time: number): number {
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const next = points[index];
    if (time <= next.time) {
      const fraction = Math.max(0, Math.min(1, (time - previous.time) / (next.time - previous.time)));
      return previous.rate + (next.rate - previous.rate) * fraction;
    }
  }
  return points[points.length - 1].rate;
}

/** Integral of the same linear rate segments sent to AudioParam. */
function distanceAt(points: RatePoint[], time: number): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const next = points[index];
    const end = Math.min(time, next.time);
    if (end <= previous.time) break;
    const fraction = (end - previous.time) / (next.time - previous.time);
    const endRate = previous.rate + (next.rate - previous.rate) * fraction;
    distance += (previous.rate + endRate) * 0.5 * (end - previous.time);
    if (time <= next.time) break;
  }
  return distance;
}

/** Continuous native source phase, with bounded local PCM windows for reversal. */
export class ScratchEngine {
  private readonly voices = new Set<Voice>();
  private voice: Voice | null = null;
  private lastRequested: number;
  private lastAccepted: number;
  private lastTime: number;
  private motionRate = 0;
  private disposed = false;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private onDisposed: (() => void) | undefined;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly clip: AudioClip,
    private readonly destination: AudioNode,
    seconds: number,
  ) {
    this.lastRequested = seconds;
    this.lastAccepted = seconds;
    this.lastTime = context.currentTime;
  }

  /** Signed gesture velocity; idle delivery naturally brakes to zero. */
  get velocity(): number {
    const age = Math.max(0, this.context.currentTime - this.lastTime);
    return this.motionRate * Math.max(0, Math.min(1, (IDLE_SECONDS - age) / (IDLE_SECONDS - HOLD_SECONDS)));
  }

  move(requested: number, accepted: number, audible: boolean, loop: Loop): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    const delta = requested - this.lastRequested;
    if (audible && delta === 0 && accepted === this.lastAccepted) return;
    const interval = now - this.lastTime;
    const elapsed = interval > 0 ? Math.max(0.001, Math.min(0.06, interval)) : 1 / 60;
    const changed = accepted !== this.lastAccepted;
    this.lastRequested = requested;
    this.lastAccepted = accepted;
    this.lastTime = now;
    this.motionRate = audible && changed ? Math.max(-8, Math.min(8, delta / elapsed)) : 0;
    this.drive(accepted, this.motionRate, loop);
  }

  /** Playback-owned coast supplies its analytic position and signed rate. */
  drive(accepted: number, signedRate: number, loop: Loop): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    for (const old of this.voices) if (old.end <= now) this.remove(old);
    const speed = Math.min(8, Math.abs(signedRate));
    if (speed < 0.001) {
      this.fadeVoices(now);
      this.voice = null;
      return;
    }
    const direction = Math.sign(signedRate);
    const lower = typeof loop === 'object' && accepted >= loop.start ? loop.start : 0;
    const upper = typeof loop === 'object' ? loop.end : this.clip.duration;
    const position = Math.max(lower, Math.min(upper, accepted));
    let voice = this.voice;
    let phase = voice ? this.phaseAt(voice, now) : position;
    const loopChanged = voice && (voice.lower < lower || voice.upper > upper);
    const error = position - phase;
    // Ordinary movement retains sample phase. Large relocation/loop wrapping
    // explicitly re-anchors through a short crossfade, never a hard splice.
    const relocated = Math.abs(error) > 0.08 || !!loopChanged;
    if (relocated) phase = position;
    const remaining = direction > 0 ? (voice?.upper ?? 0) - phase : phase - (voice?.lower ?? 0);
    if (!voice || voice.released || voice.direction !== direction || relocated || remaining < speed * IDLE_SECONDS + 0.01) {
      voice = this.createVoice(Math.max(lower, Math.min(upper, phase)), direction, speed, lower, upper, now);
      if (!voice) {
        this.fadeVoices(now);
        this.voice = null;
        return;
      }
      this.fadeVoices(now, voice);
      this.voice = voice;
      phase = voice.phase;
    }
    // Small measurement/ramp lag is corrected as velocity, not by repeatedly
    // resetting sample phase at pointer cadence (the previous grain stutter).
    const correction = Math.max(-speed * 0.35, Math.min(speed * 0.35, (position - phase) * direction / 0.06));
    const target = Math.max(0.001, Math.min(8, speed + correction));
    this.schedule(voice, now, target);
  }

  private phaseAt(voice: Voice, now: number): number {
    return voice.phase + voice.direction * distanceAt(voice.profile, now);
  }

  private createVoice(position: number, direction: number, speed: number, lower: number, upper: number, now: number): Voice | null {
    const sampleRate = this.clip.sampleRate;
    const budget = Math.ceil(WINDOW_SECONDS * sampleRate) + 2;
    const firstFrame = direction > 0
      ? Math.max(Math.ceil(lower * sampleRate), Math.floor(position * sampleRate))
      : Math.max(Math.ceil(lower * sampleRate), Math.ceil(position * sampleRate) + 1 - budget);
    const lastFrame = direction > 0
      ? Math.min(this.clip.length, Math.floor(upper * sampleRate), firstFrame + budget)
      : Math.min(this.clip.length, Math.floor(upper * sampleRate), Math.ceil(position * sampleRate) + 1);
    if (lastFrame <= firstFrame) return null;
    const buffer = this.context.createBuffer(this.clip.numberOfChannels, lastFrame - firstFrame, sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      copyClipPcmRange(this.clip, channel, firstFrame, buffer.getChannelData(channel), direction < 0);
    }
    const offset = direction > 0 ? position - firstFrame / sampleRate : (lastFrame - 1) / sampleRate - position;
    const source = this.context.createBufferSource();
    let gain: GainNode | undefined;
    let voice: Voice | undefined;
    try {
      gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = speed;
      source.connect(gain);
      gain.connect(this.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
      voice = {
        source, gain, direction, lower: firstFrame / sampleRate, upper: lastFrame / sampleRate,
        phase: position, profile: [{time: now, rate: speed}],
        gainProfile: [{time: now, rate: 0}, {time: now + FADE_SECONDS, rate: 1}], start: now, end: now + IDLE_SECONDS, released: false,
      };
      const owned = voice;
      source.onended = () => this.remove(owned);
      while (this.voices.size >= MAX_VOICES) this.remove(this.voices.values().next().value!);
      this.voices.add(voice);
      source.start(now, Math.max(0, offset));
      return voice;
    } catch (error) {
      if (voice) this.remove(voice);
      else {
        source.onended = null;
        try { source.stop(); } catch { /* not started */ }
        try { source.disconnect(); } catch { /* partial graph */ }
        try { gain?.disconnect(); } catch { /* partial graph */ }
      }
      throw error;
    }
  }

  private schedule(voice: Voice, now: number, target: number): void {
    const phase = this.phaseAt(voice, now);
    const current = rateAt(voice.profile, now);
    voice.phase = phase;
    voice.profile = [
      {time: now, rate: current},
      {time: now + RAMP_SECONDS, rate: target},
      {time: now + HOLD_SECONDS, rate: target},
      {time: now + IDLE_SECONDS, rate: 0},
    ];
    const rate = voice.source.playbackRate;
    rate.cancelScheduledValues(now);
    rate.setValueAtTime(current, now);
    rate.linearRampToValueAtTime(target, now + RAMP_SECONDS);
    rate.setValueAtTime(target, now + HOLD_SECONDS);
    rate.linearRampToValueAtTime(0, now + IDLE_SECONDS);
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(now);
    const level = rateAt(voice.gainProfile, now);
    voice.gainProfile = [
      {time: now, rate: level}, {time: now + FADE_SECONDS, rate: 1},
      {time: now + HOLD_SECONDS, rate: 1}, {time: now + IDLE_SECONDS, rate: 0},
    ];
    gain.setValueAtTime(level, now);
    gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
    gain.setValueAtTime(1, now + HOLD_SECONDS);
    gain.linearRampToValueAtTime(0, now + IDLE_SECONDS);
    voice.end = now + IDLE_SECONDS;
    voice.source.stop(voice.end);
  }

  release(onDisposed: () => void): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDisposed = onDisposed;
    this.fadeVoices(this.context.currentTime);
    if (this.voices.size === 0) this.dispose();
    else this.cleanupTimer = setTimeout(() => this.dispose(), 20);
  }

  dispose(): void {
    this.disposed = true;
    if (this.cleanupTimer !== undefined) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    for (const voice of this.voices) this.remove(voice);
    const onDisposed = this.onDisposed;
    this.onDisposed = undefined;
    onDisposed?.();
  }

  private fadeVoices(now: number, except?: Voice): void {
    for (const voice of this.voices) {
      if (voice === except || voice.released) continue;
      voice.released = true;
      const end = Math.min(voice.end, now + FADE_SECONDS);
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(rateAt(voice.gainProfile, now), now);
        voice.gain.gain.linearRampToValueAtTime(0, end);
        voice.source.stop(end);
        voice.end = end;
      } catch { this.remove(voice); }
    }
  }

  private remove(voice: Voice): void {
    this.voices.delete(voice);
    if (this.voice === voice) this.voice = null;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* already ended */ }
    try { voice.source.disconnect(); } catch { /* already disconnected */ }
    try { voice.gain.disconnect(); } catch { /* already disconnected */ }
  }
}
