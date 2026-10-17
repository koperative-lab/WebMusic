import {createTickSource, type TickSource} from '@webmusic/kernel/tick';
import type {SessionSchedulingBinding, SessionSchedulingSnapshot} from '@webmusic/kernel/session';
import type {HeadlessSynth, ScoreSchedulingCapabilities} from '../audio-contracts';
import type {ScorePlayerSchedulerHost, ScorePlayerSchedulerOptions} from '../score-player-scheduler';
import {ScoreTimeline, type ScheduledScoreNote} from '../score-timeline';

interface SessionVoice {
  key: string;
  epoch: number;
  iteration: number;
  readonly entryIndex: number;
  readonly entry: ScheduledScoreNote;
  readonly id: number;
  readonly synth: HeadlessSynth;
  readonly start: number;
  end: number;
  readonly scheduled: boolean;
  handle?: unknown;
  started: boolean;
  attacked: boolean;
}

export function scoreSchedulingCapabilities(synth?: HeadlessSynth): ScoreSchedulingCapabilities {
  const future = synth?.supportsScheduledCancellation === true && typeof synth.cancelScheduledNote === 'function'
    && typeof synth.noteOffById === 'function';
  return Object.freeze({
    attacks: future ? 'audio-clock' : 'callback',
    releases: future && synth?.supportsScheduledDuration === true ? 'audio-clock' : 'callback',
    loopBoundary: future ? 'lookahead' : 'callback',
    cancellation: (future || synth?.supportsNoteOccurrences === true) && typeof synth?.noteOffById === 'function' ? 'occurrence' : 'pitch',
    crossingNotes: 'clip-and-retrigger',
  });
}

/** Schedules against the borrowed Session anchor; never creates or writes a clock. */
export class SessionScoreScheduler {
  private readonly records = new Map<string, SessionVoice>();
  private readonly committed = new Map<string, number>();
  private unsubscribe?: () => void;
  private tickSource?: TickSource;
  private generation = 0;
  private nextId = 1_000_000_000;
  private disposed = false;
  private ended = false;
  private lastCursorAt = -Infinity;
  private active = false;
  private preservingRate = false;

  constructor(
    readonly binding: SessionSchedulingBinding,
    private readonly timeline: ScoreTimeline,
    private readonly host: ScorePlayerSchedulerHost,
    private readonly options: ScorePlayerSchedulerOptions,
    private readonly changed: () => void,
  ) {}

  connect(): void {
    const unsubscribe = this.binding.subscribe((event) => {
      if (event.type === 'dispose') this.dispose();
      else this.update(event.snapshot, event.cause);
    });
    if (this.disposed) unsubscribe();
    else this.unsubscribe = unsubscribe;
  }

  get running(): boolean { return this.active && !this.ended && !this.disposed; }
  get position(): number {
    const now = this.host.getContext()?.currentTime ?? this.binding.snapshot.referenceTime;
    return Math.max(0, Math.min(this.timeline.duration, this.binding.positionAt(now)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    ++this.generation;
    this.changed();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.tickSource?.dispose();
    this.tickSource = undefined;
    this.cancelAll();
    this.committed.clear();
  }

  private update(snapshot: SessionSchedulingSnapshot, cause?: string): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.active = false;
    this.changed();
    this.tickSource?.stop();
    const now = this.host.getContext()?.currentTime ?? snapshot.referenceTime;
    if (snapshot.phase === 'invalidated' && cause === 'rate') {
      this.preservingRate = true;
      for (const voice of [...this.records.values()]) {
        if (!(voice.attacked && voice.start <= now && voice.end > now && voice.synth.supportsScheduledDuration === true && voice.synth.supportsScheduledRetiming === true && voice.synth.retimeScheduledNote)) this.retire(voice, now, true);
      }
    } else if (snapshot.phase === 'ready' && cause === 'rate' && this.preservingRate && !snapshot.paused) {
      this.preservingRate = false;
      this.retimePreserved(now);
    } else {
      this.preservingRate = false;
      this.cancelAll();
      this.committed.clear();
    }
    if (generation !== this.generation || this.disposed) return;
    this.ended = false;
    this.active = snapshot.phase === 'ready' && !snapshot.paused;
    this.lastCursorAt = -Infinity;
    if (this.active) {
      this.tickSource ??= (this.options.createTickSource ?? ((intervalMs) => createTickSource({intervalMs})))(this.options.schedulerIntervalMs);
      this.tickSource.start(() => this.tick());
      this.tick();
    } else this.emitCursor();
  }

  private tick(): void {
    const context = this.host.getContext();
    if (!this.running || !context || this.binding.snapshot.phase !== 'ready') return;
    if (context.state === 'closed') { this.dispose(); return; }
    // Wall-clock ticks do not imply elapsed audio time during interruptions.
    if (context.state !== 'running') return;
    const generation = this.generation;
    const now = context.currentTime;
    const epoch = this.binding.epoch;
    for (const voice of [...this.records.values()]) {
      if (voice.epoch !== epoch) this.retire(voice, now, true);
      else if (voice.end <= now) this.retire(voice, voice.end, false);
      if (generation !== this.generation) return;
    }
    const segments = this.binding.segments(now, now + this.options.lookaheadSeconds);
    const synth = this.host.getSynth();
    if (!synth) return;
    const capabilities = scoreSchedulingCapabilities(synth);
    const loop = this.binding.snapshot.loop;
    const notes = this.timeline.prepare();
    for (const segment of segments) {
      const gateLimit = loop?.endSeconds ?? this.timeline.duration;
      let index = this.timeline.lowerBound(segment.positionStart - this.timeline.maxNoteDuration);
      for (; index < notes.length; ++index) {
        const entry = notes[index];
        if (entry.start > segment.positionEnd || entry.start >= gateLimit) break;
        if (entry.end <= segment.positionStart) continue;
        const key = `${epoch}:${segment.iteration}:${index}`;
        if (this.committed.has(key)) continue;
        const startPosition = Math.max(entry.start, segment.positionStart);
        const endPosition = Math.min(entry.end, gateLimit);
        if (endPosition <= startPosition) continue;
        const start = segment.referenceStart + (startPosition - segment.positionStart) / segment.rate;
        const end = segment.referenceStart + (endPosition - segment.positionStart) / segment.rate;
        // A segment's right boundary belongs to its successor, except for the
        // lookahead horizon where the same occurrence key deduplicates it.
        if (loop && startPosition >= loop.endSeconds) continue;
        const voice: SessionVoice = {
          key, epoch, iteration: segment.iteration, entryIndex: index, entry, synth, start, end,
          id: this.nextId++, scheduled: capabilities.attacks === 'audio-clock', started: false, attacked: false,
        };
        this.committed.set(key, segment.iteration);
        this.records.set(key, voice);
        if (voice.scheduled) this.attack(voice, start, end - start);
        if (generation !== this.generation || !this.running) return;
      }
    }
    for (const voice of [...this.records.values()]) {
      if (!voice.started && voice.start <= now && voice.end > now) {
        if (!voice.scheduled) this.attack(voice, now, voice.end - now);
        if (!this.records.has(voice.key) || generation !== this.generation) continue;
        voice.started = true;
        this.host.onNoteOn(voice.entry.note, {id: voice.id, entry: voice.entry});
      }
      if (generation !== this.generation || !this.running) return;
    }
    const iteration = segments[0]?.iteration;
    if (iteration !== undefined) for (const [key, pass] of this.committed) {
      if (pass < iteration && !this.records.has(key)) this.committed.delete(key);
    }
    if (!loop && this.position >= this.timeline.duration && this.records.size === 0) {
      this.ended = true;
      this.active = false;
      this.tickSource?.stop();
      this.changed();
      this.host.onEnd();
    }
    if (generation !== this.generation || this.disposed) return;
    if (now - this.lastCursorAt >= this.options.cursorIntervalMs / 1000) {
      this.lastCursorAt = now;
      this.emitCursor();
    }
  }

  private retimePreserved(now: number): void {
    const generation = this.generation;
    const segment = this.binding.segments(now, now + this.options.lookaheadSeconds)[0];
    const limit = this.binding.snapshot.loop?.endSeconds ?? this.timeline.duration;
    const retained = [...this.records.values()];
    this.committed.clear();
    for (const voice of retained) {
      if (!segment || voice.entry.end <= segment.positionStart) { this.retire(voice, now, true); continue; }
      this.records.delete(voice.key);
      voice.epoch = this.binding.epoch;
      voice.iteration = segment.iteration;
      voice.key = `${voice.epoch}:${segment.iteration}:${voice.entryIndex}`;
      voice.end = segment.referenceStart + (Math.min(voice.entry.end, limit) - segment.positionStart) / segment.rate;
      this.records.set(voice.key, voice);
      this.committed.set(voice.key, voice.iteration);
      try { voice.synth.retimeScheduledNote!(voice.handle, voice.end); } catch (error) {
        this.report('session retimeScheduledNote', error);
        this.retire(voice, now, true);
      }
      if (generation !== this.generation) return;
    }
  }

  private attack(voice: SessionVoice, when: number, duration: number): void {
    let handle: unknown;
    try { handle = voice.synth.noteOn(voice.entry.midi, voice.entry.velocity, when, duration); } catch (error) {
      this.records.delete(voice.key);
      this.report('session noteOn', error);
      return;
    }
    const duplicate = handle != null && [...this.records.values()].some((other) => other !== voice && other.synth === voice.synth && other.handle === handle);
    if (duplicate || voice.scheduled && handle == null) {
      this.records.delete(voice.key);
      this.report('session noteOn', new Error('Scheduled synth must return a unique occurrence handle.'));
      return;
    }
    voice.handle = handle;
    voice.attacked = true;
    if (!this.records.has(voice.key) || this.disposed || voice.epoch !== this.binding.epoch) this.release(voice, this.host.getContext()?.currentTime ?? when, true);
  }

  private cancelAll(): void {
    const now = this.host.getContext()?.currentTime ?? 0;
    for (const voice of [...this.records.values()]) this.retire(voice, now, true);
  }

  private retire(voice: SessionVoice, time: number, cancelled: boolean): void {
    if (!this.records.delete(voice.key)) return;
    // Native duration scheduling already owns the precise gate and release
    // tail. A late UI tick must not rewrite that envelope using a late time.
    if (cancelled || !voice.scheduled || voice.synth.supportsScheduledDuration !== true) this.release(voice, time, cancelled);
    if (voice.started) this.host.onNoteOff(voice.entry.note, {id: voice.id, entry: voice.entry});
  }

  private release(voice: SessionVoice, time: number, cancelled: boolean): void {
    if (!voice.attacked) return;
    const {synth, handle} = voice;
    try {
      if (cancelled && voice.scheduled && handle != null && synth.cancelScheduledNote) synth.cancelScheduledNote(handle, time);
      else if (handle != null && synth.noteOffById) synth.noteOffById(handle, time);
      else if (![...this.records.values()].some((other) => other.synth === synth && other.entry.midi === voice.entry.midi && other.started)) synth.noteOff?.(voice.entry.midi, time);
    } catch (error) { this.report('session note release', error); }
  }

  private emitCursor(): void {
    const nominalSeconds = this.position;
    const rate = this.binding.clock.rate;
    const duration = this.timeline.duration / rate;
    this.host.onCursor({nominalSeconds, seconds: nominalSeconds / rate, duration,
      progress: duration > 0 ? Math.min(1, nominalSeconds / (duration * rate)) : 0});
  }

  private report(operation: string, error: unknown): void { this.host.onOperationError?.(operation, error); }
}
