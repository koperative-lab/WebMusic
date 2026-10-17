import {TransportClock, type TransportClockReader} from '@webmusic/kernel/transport';
import {
  readAudioSequenceRange, retainAudioSequence,
  type AudioSequence, type AudioAssetReader, type AudioAssetLease,
} from '../../core';
import {insertEffect} from '../core/effect';
import type {AudioClipPlayerOptions} from './player';
import {normalizeLoopOption} from './engines/buffer-engine';

type Loop = boolean | {start: number; end: number};
interface Chunk {buffer: AudioBuffer; bytes: number; pins: number; used: number}
interface Voice {source: AudioBufferSourceNode; chunk: Chunk; end: number}
/** Bounded, lazy sequence transport. Document adoption retains references and never reads PCM. */
export class AudioSequenceEngine {
  private content?: AudioSequence;
  private assets?: AudioAssetReader;
  private lease?: AudioAssetLease;
  private context?: AudioContext;
  private gain?: GainNode;
  private panner?: StereoPannerNode;
  private tap?: AnalyserNode;
  private effectDispose?: () => void;
  private readonly transport = new TransportClock(() => this.context?.currentTime ?? 0);
  private readonly chunks = new Map<number, Chunk>();
  private readonly voices = new Set<Voice>();
  private bytes = 0;
  private chunkGeneration = 0;
  private used = 0;
  private timer?: ReturnType<typeof setInterval>;
  private nextFrame = 0;
  private nextTime = 0;
  private disposed = false;
  private generation = 0;
  private volume: number;
  private pan: number;
  private loop: Loop;
  private readonly listeners = new Set<() => void>();
  private readonly loads = new Set<() => void>();
  private readonly ends = new Set<() => void>();
  private readonly errors = new Set<(error: Error) => void>();
  readonly chunkFrames: number;
  readonly preparedBytesLimit: number;

  constructor(private readonly getContext: () => AudioContext,
    private readonly options: AudioClipPlayerOptions & {chunkFrames?: number; preparedBytesLimit?: number} = {}) {
    this.chunkFrames = options.chunkFrames ?? 16384;
    this.preparedBytesLimit = options.preparedBytesLimit ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(this.chunkFrames) || this.chunkFrames < 1 ||
        !Number.isSafeInteger(this.preparedBytesLimit) || this.preparedBytesLimit < 1) {
      throw new RangeError('Sequence chunk and memory limits must be positive safe integers');
    }
    this.volume = options.volume ?? 1;
    this.pan = options.pan ?? 0;
    this.loop = normalizeLoopOption(options.loop ?? false);
    this.transport.setRate(options.rate ?? 1, 0);
  }
  get sequence(): AudioSequence | undefined { return this.content; }
  get assetReader(): AudioAssetReader | undefined { return this.assets; }
  get duration(): number { return this.content ? this.content.length / this.content.sampleRate : 0; }
  get seconds(): number { return Math.max(0, Math.min(this.duration, this.wrap(this.transport.position))); }
  get playing(): boolean { return !this.disposed && !this.transport.paused; }
  get clock(): TransportClockReader { return this.transport; }
  get analyser(): AnalyserNode | undefined { return this.tap; }
  get loopOption(): Loop { return this.loop; }
  /** Includes every active and inactive cached PCM chunk. */
  get preparedBytes(): number { return this.bytes; }
  subscribe(notify: () => void): () => void { this.listeners.add(notify); return () => this.listeners.delete(notify); }
  onLoad(notify: () => void): () => void { this.loads.add(notify); return () => this.loads.delete(notify); }
  onEnd(notify: () => void): () => void { this.ends.add(notify); return () => this.ends.delete(notify); }
  onError(notify: (error: Error) => void): () => void { this.errors.add(notify); return () => this.errors.delete(notify); }

  adopt(content: AudioSequence, assets: AudioAssetReader, seconds: number, loop: Loop): boolean {
    if (this.disposed) throw new Error('Sequence engine is disposed');
    const bytes = Math.min(content.length, this.chunkFrames) * content.channelLayout.length * 4;
    if (!Number.isSafeInteger(bytes) || bytes > this.preparedBytesLimit) throw new RangeError('Sequence playback chunk exceeds preparedBytesLimit');
    loop = this.normalizeLoop(loop, content);
    this.checkLoopDensity(loop, content.length / content.sampleRate, this.transport.rate);
    const before = this.generation;
    const lease = retainAudioSequence(content, assets);
    if (this.disposed || before !== this.generation) { lease.release(); return false; }
    this.pause();
    if (this.disposed || this.generation !== before + 1) { lease.release(); return false; }
    const generation = this.generation;
    const oldLease = this.lease;
    this.clearChunks();
    this.content = content;
    this.assets = assets;
    this.lease = lease;
    this.loop = loop;
    this.transport.seekTo(Math.min(content.length / content.sampleRate, Math.max(0, seconds)), this.now());
    try { oldLease?.release(); } catch (error) { this.report(error); }
    return !this.disposed && this.generation === generation;
  }
  async play(when?: number): Promise<void> {
    if (this.disposed || this.playing || !this.content || this.content.length === 0) return;
    if (when !== undefined && !Number.isFinite(when)) throw new RangeError('Playback time must be finite');
    const generation = ++this.generation;
    this.context ??= this.getContext();
    if (this.disposed || generation !== this.generation) return;
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.disposed || generation !== this.generation) return;
    this.ensureGraph();
    if (this.disposed || generation !== this.generation) return;
    const offset = this.wrap(this.seconds >= this.duration ? 0 : this.seconds);
    const at = Math.max(when ?? 0, this.now());
    this.nextFrame = Math.round(offset * this.content.sampleRate);
    this.nextTime = at;
    this.transport.startAt(at, offset);
    try {
      this.schedule();
      if (this.disposed || generation !== this.generation) return;
      this.timer = setInterval(() => {
        try { this.schedule(); }
        catch (error) { if (this.disposed || generation !== this.generation) return; this.pause(); for (const notify of this.errors) notify(asError(error)); }
      }, 25);
      this.notify();
    } catch (error) { if (this.disposed || generation !== this.generation) return; this.pause(); throw error; }
  }
  pause(): void {
    this.generation++;
    const position = this.seconds;
    this.transport.pause(this.now());
    this.transport.seekTo(position, this.now());
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const voice of [...this.voices]) this.releaseVoice(voice, true);
  }
  stop(): void { this.pause(); this.transport.seekTo(0, this.now()); this.notify(); }
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) throw new RangeError('Seek position must be finite');
    const wasPlaying = this.playing;
    const when = this.transport.holding ? Math.max(this.now(), this.transport.state.originTime) : this.now();
    this.pause();
    const frameRate = this.content?.sampleRate ?? 1;
    const target = Math.round(Math.max(0, Math.min(this.duration, this.wrap(seconds))) * frameRate) / frameRate;
    this.transport.seekTo(target, this.now());
    if (wasPlaying) void this.play(when).catch((error) => { for (const notify of this.errors) notify(asError(error)); });
    this.notify();
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Rate must be positive and finite');
    this.checkLoopDensity(this.loop, this.duration, rate);
    const playing = this.playing;
    const when = this.transport.holding ? Math.max(this.now(), this.transport.state.originTime) : this.now();
    this.pause(); this.transport.setRate(rate, this.now());
    if (playing) void this.play(when).catch((error) => { for (const notify of this.errors) notify(asError(error)); });
  }
  setVolume(volume: number): void { this.volume = volume; if (this.gain) this.gain.gain.value = volume; }
  setPan(pan: number): void { this.pan = pan; if (this.panner) this.panner.pan.value = pan; }
  setPreservesPitch(value: boolean): void { if (value) throw new Error('Sequence playback does not support pitch preservation'); }
  setLoop(loop: Loop): void {
    const accepted = this.normalizeLoop(loop, this.content);
    this.checkLoopDensity(accepted, this.duration, this.transport.rate);
    const playing = this.playing;
    const when = this.transport.holding ? Math.max(this.now(), this.transport.state.originTime) : this.now();
    this.pause(); this.loop = accepted;
    if (playing) void this.play(when).catch((error) => { for (const notify of this.errors) notify(asError(error)); });
  }
  preload(): void {
    if (this.disposed || !this.content?.length) return;
    const generation = this.generation;
    this.context ??= this.getContext();
    if (this.disposed || generation !== this.generation) return;
    this.ensureGraph();
    if (this.disposed || generation !== this.generation) return;
    this.chunk(Math.min(this.content.length - 1, Math.floor(this.seconds * this.content.sampleRate)));
  }
  dispose(): void {
    if (this.disposed) return;
    this.pause(); this.disposed = true;
    let failure: unknown;
    const lease = this.lease;
    this.clearChunks(); this.lease = undefined;
    this.content = undefined; this.assets = undefined;
    try { lease?.release(); } catch (error) { failure ??= error; }
    for (const node of [this.gain, this.panner, this.tap]) {
      try { node?.disconnect(); } catch (error) { failure ??= error; }
    }
    try { this.effectDispose?.(); } catch (error) { failure ??= error; }
    this.gain = undefined; this.panner = undefined; this.tap = undefined;
    this.listeners.clear(); this.loads.clear(); this.ends.clear(); this.errors.clear();
    if (failure !== undefined) throw failure;
  }
  private ensureGraph(): void {
    if (this.gain) return;
    const context = this.context!;
    const generation = this.generation;
    const check = () => { if (this.disposed || generation !== this.generation) throw new Error('Sequence graph preparation superseded'); };
    let gain: GainNode | undefined, pan: StereoPannerNode | undefined, tap: AnalyserNode | undefined;
    let release: (() => void) | undefined;
    try {
      gain = context.createGain(); check(); pan = context.createStereoPanner(); check(); tap = context.createAnalyser(); check();
      gain.gain.value = this.volume; pan.pan.value = this.pan;
      gain.connect(pan); check(); release = insertEffect(context, pan, tap, this.options.effect).dispose; check();
      tap.connect(this.options.destination ?? context.destination);
      check(); this.gain = gain; this.panner = pan; this.tap = tap; this.effectDispose = release;
    } catch (error) {
      for (const node of [gain, pan, tap]) { try { node?.disconnect(); } catch { /* release partial graph */ } }
      try { release?.(); } catch { /* preserve graph creation failure */ }
      throw error;
    }
    for (const notify of [...this.loads]) notify();
  }

  private chunk(frame: number): {chunk: Chunk; start: number} {
    const content = this.content!;
    const generation = this.generation;
    const chunkGeneration = this.chunkGeneration;
    const check = () => { if (this.disposed || generation !== this.generation) throw new Error('Sequence chunk preparation superseded'); };
    const start = Math.floor(frame / this.chunkFrames) * this.chunkFrames;
    let chunk = this.chunks.get(start);
    if (chunk) { chunk.used = ++this.used; return {chunk, start}; }
    const length = Math.min(this.chunkFrames, content.length - start);
    const bytes = length * content.channelLayout.length * 4;
    while (this.bytes + bytes > this.preparedBytesLimit) {
      const victim = [...this.chunks.entries()].filter(([, value]) => value.pins === 0).sort((a, b) => a[1].used - b[1].used)[0];
      if (!victim) throw new RangeError('Sequence playback exceeds preparedBytesLimit');
      this.chunks.delete(victim[0]); this.bytes -= victim[1].bytes;
    }
    // Reserve before allocation; exceptions release the reservation.
    this.bytes += bytes;
    let readLease: AudioAssetLease | undefined;
    try {
      const reader = this.assets!;
      readLease = retainAudioSequence(content, reader); check();
      const buffer = this.context!.createBuffer(content.channelLayout.length, length, content.sampleRate);
      check();
      const destinations = Array.from({length: content.channelLayout.length}, (_, channel) => buffer.getChannelData(channel));
      check(); readAudioSequenceRange(content, reader, start, destinations); check();
      readLease.release(); readLease = undefined; check();
      chunk = {buffer, bytes, pins: 0, used: ++this.used}; this.chunks.set(start, chunk);
      return {chunk, start};
    } catch (error) { if (chunkGeneration === this.chunkGeneration) this.bytes -= bytes; throw error; }
    finally { readLease?.release(); }
  }
  private schedule(): void {
    if (!this.playing || !this.content || !this.context) return;
    const generation = this.generation;
    const now = this.now();
    for (const voice of [...this.voices]) if (voice.end <= now) this.releaseVoice(voice, false);
    const content = this.content; const rate = this.transport.rate; const sr = content.sampleRate;
    const bounds = this.bounds(); const endFrame = Math.round(bounds.end * sr);
    if (!this.loop && this.transport.position >= this.duration) {
      this.pause(); this.transport.seekTo(this.duration, now); this.notify();
      for (const notify of this.ends) notify(); return;
    }
    // A throttled host must skip missed output instead of accumulating late sources.
    if (this.nextTime < now) {
      this.nextFrame = Math.min(content.length, Math.round(this.wrap(this.transport.position) * sr));
      this.nextTime = now;
    }
    const horizon = Math.max(now + 0.2, this.transport.state.originTime + 0.05);
    let iterations = 0;
    while (this.nextTime < horizon) {
      if (this.disposed || generation !== this.generation) return;
      if (++iterations > 512 || this.voices.size >= 512) throw new RangeError('Sequence playback exceeds 512 scheduled voices');
      if (this.nextFrame >= endFrame) {
        if (!this.loop) break;
        this.nextFrame = Math.round(bounds.start * sr);
      }
      if (endFrame <= this.nextFrame) break;
      const {chunk, start} = this.chunk(this.nextFrame);
      if (this.disposed || generation !== this.generation) return;
      const frames = Math.min(start + chunk.buffer.length, endFrame) - this.nextFrame;
      if (frames <= 0) break;
      const source = this.context.createBufferSource();
      if (this.disposed || generation !== this.generation) { try {source.disconnect();} catch { /* release stale source */ } return; }
      const duration = frames / sr;
      const voice: Voice = {source, chunk, end: this.nextTime + duration / rate};
      chunk.pins++; this.voices.add(voice);
      try {
        source.buffer = chunk.buffer; source.playbackRate.value = rate; source.connect(this.gain!);
        if (this.disposed || generation !== this.generation) { this.releaseVoice(voice, true); return; }
        source.onended = () => this.releaseVoice(voice, false);
        source.start(this.nextTime, (this.nextFrame - start) / sr, duration);
        if (this.disposed || generation !== this.generation) { try {source.stop();} catch { /* stale start */ } this.releaseVoice(voice, true); return; }
      } catch (error) { this.releaseVoice(voice, true); throw error; }
      this.nextFrame += frames; this.nextTime += duration / rate;
    }
  }
  private releaseVoice(voice: Voice, stop: boolean): void {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* already stopped */ } }
    try { voice.source.disconnect(); } catch { /* already disconnected */ }
    voice.chunk.pins--;
  }
  private checkLoopDensity(loop: Loop, duration: number, rate: number): void {
    if (!loop || !duration) return;
    const span = loop === true ? duration : Math.min(duration, loop.end) - loop.start;
    if (span > 0 && Math.ceil(0.2 * rate / span) + 2 > 512) {
      throw new RangeError('Sequence loop exceeds 512 scheduled voices per lookahead window');
    }
  }
  private normalizeLoop(loop: Loop, content?: AudioSequence): Loop {
    const accepted = normalizeLoopOption(loop, content?.length ? content.length / content.sampleRate : undefined);
    if (typeof accepted !== 'object' || !content) return accepted;
    const start = Math.round(Math.min(content.length, accepted.start * content.sampleRate));
    const end = Math.round(Math.min(content.length, accepted.end * content.sampleRate));
    if (end <= start) throw new RangeError('Sequence loop must span at least one output frame after rounding');
    return {start: start / content.sampleRate, end: end / content.sampleRate};
  }
  private bounds(): {start: number; end: number} {
    return typeof this.loop === 'object' ? {start: this.loop.start, end: Math.min(this.duration, this.loop.end)} : {start: 0, end: this.duration};
  }
  private wrap(seconds: number): number {
    if (!this.loop || this.duration === 0) return seconds;
    const {start, end} = this.bounds();
    return seconds >= end && end > start ? start + (seconds - start) % (end - start) : seconds;
  }
  private clearChunks(): void { this.chunkGeneration++; this.chunks.clear(); this.bytes = 0; }
  private report(error: unknown): void {
    for (const notify of [...this.errors]) { try { notify(asError(error)); } catch { /* cleanup must complete after observer errors */ } }
  }
  private now(): number { return this.context?.currentTime ?? 0; }
  private notify(): void { for (const notify of [...this.listeners]) notify(); }
}
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
