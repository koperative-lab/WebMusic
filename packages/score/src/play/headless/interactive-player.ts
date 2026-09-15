// ============================================================================
// InteractivePlayer — stable pull-playback orchestration API. Beat indexing,
// voice/audio mixing and recording live in focused modules under ./interactive.
// ============================================================================

import {EventEmitter, type Score} from '../../core';
import type {ScoreFormat} from '../../io/load';
import type {RecordToScoreOptions} from '../core/record';
import type {
  AddSourceOptions,
  AddVoiceOptions,
  AdvanceOptions,
  BeatNote,
  HeadlessSynth,
  InteractivePlayerEvents,
  InteractivePlayerOptions,
  NoteInput,
} from './interactive/contracts';
import {InteractivePerformanceRecorder} from './interactive/performance-recorder';
import {emitPlaybackEvent, emitPlaybackOperationError} from './playback-events';
import {
  createInteractiveSource,
  InteractiveSourceIndex,
} from './interactive/source-index';
import {InteractiveVoiceMixer} from './interactive/voice-mixer';

export type {
  AddSourceOptions,
  AddVoiceOptions,
  AdvanceOptions,
  BeatNote,
  InteractivePlayerEvents,
  InteractivePlayerOptions,
  NoteInput,
  SourceRoute,
  VoiceResolver,
} from './interactive/contracts';

export function createInteractivePlayer(
  options: InteractivePlayerOptions = {},
): InteractivePlayer {
  return new InteractivePlayer(options);
}

/**
 * Event-driven pull engine for gestures, clocks, MIDI and creative coding. It
 * owns no musical clock: callers select a source and explicitly advance beats,
 * while registered voices provide independently mixed output when Web Audio is
 * available. All source operations remain usable without an AudioContext.
 */
export class InteractivePlayer {
  private readonly emitter = new EventEmitter<InteractivePlayerEvents>();
  private readonly options: InteractivePlayerOptions;
  private readonly lookahead: number;
  private readonly sources = new InteractiveSourceIndex();
  private readonly recorder = new InteractivePerformanceRecorder();
  private readonly mixer: InteractiveVoiceMixer;
  private readonly sourceLoadControllers = new Map<string, AbortController>();
  private disposed = false;

  constructor(options: InteractivePlayerOptions = {}) {
    this.options = options;
    this.lookahead = options.lookaheadSeconds ?? 0.03;
    this.mixer = new InteractiveVoiceMixer(options, {
      onNoteOn: (event) => this.emit('noteOn', event),
      onNoteOff: (event) => this.emit('noteOff', event),
      onOperationError: (operation, error) => {
        emitPlaybackOperationError(
          this.emitter,
          'InteractivePlayer',
          operation,
          error,
        );
      },
      onCapture: (voice, midi, velocity, time, duration) => {
        this.recorder.capture(voice, midi, velocity, time, duration);
      },
    });
  }

  /** Lazily-created Web Audio context. */
  get context(): AudioContext {
    return this.mixer.context;
  }

  addVoice(id: string, synth: HeadlessSynth, options: AddVoiceOptions = {}): this {
    this.mixer.addVoice(id, synth, options);
    return this;
  }

  removeVoice(id: string): this {
    this.mixer.removeVoice(id);
    return this;
  }

  hasVoice(id: string): boolean {
    return this.mixer.hasVoice(id);
  }

  listVoices(): string[] {
    return this.mixer.listVoices();
  }

  setVoiceVolume(id: string, volume: number): this {
    this.mixer.setVoiceVolume(id, volume);
    return this;
  }

  muteVoice(id: string, muted = true): this {
    this.mixer.muteVoice(id, muted);
    return this;
  }

  soloVoice(id: string, solo = true): this {
    this.mixer.soloVoice(id, solo);
    return this;
  }

  setMasterVolume(volume: number): this {
    this.mixer.setMasterVolume(volume);
    return this;
  }

  setMix(mix: Record<string, number>): this {
    this.mixer.setMix(mix);
    return this;
  }

  /**
   * Build voice routes and await optional sample/worklet preparation before
   * externally driven notes are fired. Pull playback remains synchronous after
   * this explicit readiness boundary.
   */
  preload(): Promise<void> {
    return this.mixer.preload();
  }

  /** Pre-index a Score into beat buckets for constant-time pull playback. */
  addSource(id: string, score: Score, options: AddSourceOptions = {}): this {
    this.assertNotDisposed();
    const controller = this.beginSourceChange(id);
    try {
      this.commitSource(id, score, options, controller);
    } finally {
      this.finishSourceChange(id, controller);
    }
    return this;
  }

  /** Lazily load and register a MIDI, MusicXML, MXL or ABC source. */
  async addSourceFromUrl(
    id: string,
    url: string,
    options: AddSourceOptions & {format?: ScoreFormat} = {},
  ): Promise<this> {
    this.assertNotDisposed();
    const controller = this.beginSourceChange(id);
    try {
      const {loadScoreFromUrl} = await import('../../io/load');
      this.assertNotDisposed();
      if (this.sourceLoadControllers.get(id) !== controller) return this;
      const score = await loadScoreFromUrl(url, {
        format: options.format,
        signal: controller.signal,
      });
      this.assertNotDisposed();
      this.commitSource(id, score, options, controller);
      return this;
    } catch (error) {
      // A newer source command owns this id. Retiring a URL request is a
      // cancellation, not a late load failure belonging to its replacement.
      if (!this.disposed && this.sourceLoadControllers.get(id) !== controller) return this;
      throw error;
    } finally {
      this.finishSourceChange(id, controller);
    }
  }

  /** Load several named score URLs in parallel; the first becomes active. */
  static async fromUrls(
    sources: Record<string, string>,
    options: InteractivePlayerOptions = {},
  ): Promise<InteractivePlayer> {
    const player = new InteractivePlayer(options);
    const {loadScoreFromUrl} = await import('../../io/load');
    const ids = Object.keys(sources);
    const scores = await Promise.all(ids.map((id) => loadScoreFromUrl(sources[id])));
    ids.forEach((id, index) => player.addSource(id, scores[index]));
    return player;
  }

  removeSource(id: string): this {
    const controller = this.beginSourceChange(id);
    try {
      if (this.sourceLoadControllers.get(id) === controller) this.sources.remove(id);
    } finally {
      this.finishSourceChange(id, controller);
    }
    return this;
  }

  listSources(): string[] {
    return this.sources.list();
  }

  /** Switch sources, carrying proportional cursor position by default. */
  select(id: string, options: {carry?: boolean} = {}): this {
    const source = this.sources.select(id, options.carry ?? true);
    if (!source) {
      console.warn(`[InteractivePlayer] unknown source "${id}"`);
      return this;
    }
    this.emit('sourceChange', {
      source: source.id,
      beat: source.cursor,
      total: source.totalBeats,
    });
    return this;
  }

  get activeSourceId(): string | undefined {
    return this.sources.active?.id;
  }

  get position(): {beat: number; total: number; progress: number} {
    const source = this.sources.active;
    if (!source || source.totalBeats === 0) {
      return {beat: 0, total: 0, progress: 0};
    }
    return {
      beat: source.cursor,
      total: source.totalBeats,
      progress: source.cursor / source.totalBeats,
    };
  }

  seekBeat(beat: number): this {
    const source = this.sources.active;
    if (source && source.totalBeats > 0) {
      source.cursor = ((beat % source.totalBeats) + source.totalBeats) % source.totalBeats;
    }
    return this;
  }

  rewind(): this {
    const source = this.sources.active;
    if (source) source.cursor = 0;
    return this;
  }

  peek(): BeatNote[] {
    const source = this.sources.active;
    if (!source || source.totalBeats === 0) return [];
    return source.beats[source.cursor] ?? [];
  }

  /** Play the active beat and advance its cursor by one. */
  advance(options: AdvanceOptions = {}): BeatNote[] {
    const source = this.sources.active;
    if (!source || source.totalBeats === 0) return [];
    const beat = source.cursor;
    const notes = source.beats[beat] ?? [];
    this.emit('beat', {
      source: source.id,
      beat,
      total: source.totalBeats,
      notes,
    });
    this.playNotes(notes, source.secondsPerBeat, options.secondsPerBeat);
    source.cursor = (beat + 1) % source.totalBeats;
    if (source.cursor === 0) this.emit('wrap', {source: source.id});
    return notes;
  }

  /** Advance one beat with a sustained gate, released by `allNotesOff()`. */
  advanceHold(): BeatNote[] {
    const source = this.sources.active;
    if (!source || source.totalBeats === 0) return [];
    const beat = source.cursor;
    const notes = source.beats[beat] ?? [];
    this.emit('beat', {
      source: source.id,
      beat,
      total: source.totalBeats,
      notes,
    });
    const audio = this.mixer.ensureForPlayback();
    if (audio) {
      const base = audio.context.currentTime + this.lookahead;
      for (const note of notes) {
        const voice = note.voice ??
          this.resolveVoice(note) ??
          this.options.defaultVoice ??
          this.mixer.firstVoiceId;
        this.mixer.fire(voice, note.midi, note.velocity, base, 3600);
      }
    }
    source.cursor = (beat + 1) % source.totalBeats;
    if (source.cursor === 0) this.emit('wrap', {source: source.id});
    return notes;
  }

  /** Play any beat index, optionally moving the source cursor after it. */
  playBeat(
    beat: number,
    options: AdvanceOptions & {moveCursor?: boolean} = {},
  ): BeatNote[] {
    const source = this.sources.active;
    if (!source || source.totalBeats === 0) return [];
    const index = ((beat % source.totalBeats) + source.totalBeats) % source.totalBeats;
    const notes = source.beats[index] ?? [];
    this.emit('beat', {
      source: source.id,
      beat: index,
      total: source.totalBeats,
      notes,
    });
    this.playNotes(notes, source.secondsPerBeat, options.secondsPerBeat);
    if (options.moveCursor !== false) source.cursor = (index + 1) % source.totalBeats;
    return notes;
  }

  /** Play arbitrary notes without a registered Score source. */
  play(notes: NoteInput[]): this {
    const audio = this.mixer.ensureForPlayback();
    const base = audio ? audio.context.currentTime + this.lookahead : 0;
    for (const note of notes) {
      const voice = note.voice ?? this.options.defaultVoice ?? this.mixer.firstVoiceId;
      this.mixer.fire(
        voice,
        note.midi,
        note.velocity ?? 100,
        base + (note.timeOffsetSeconds ?? 0),
        note.durationSeconds ?? 0.3,
      );
    }
    return this;
  }

  noteOn(
    voice: string,
    midi: number,
    velocity = 100,
    durationSeconds = 0.3,
  ): this {
    const audio = this.mixer.ensureForPlayback();
    const time = audio ? audio.context.currentTime + this.lookahead : 0;
    this.mixer.fire(voice, midi, velocity, time, durationSeconds);
    return this;
  }

  noteOff(voice: string, midi: number): this {
    this.mixer.noteOff(voice, midi);
    return this;
  }

  allNotesOff(): this {
    this.mixer.allNotesOff();
    return this;
  }

  record(): this {
    this.recorder.start();
    return this;
  }

  get isRecording(): boolean {
    return this.recorder.active;
  }

  stopRecording(options: RecordToScoreOptions = {}): Score {
    return this.recorder.stop(options);
  }

  on<TName extends keyof InteractivePlayerEvents>(
    event: TName,
    callback: (payload: InteractivePlayerEvents[TName]) => void,
  ): () => void {
    return this.emitter.on(event, callback);
  }

  private emit<TName extends keyof InteractivePlayerEvents>(
    event: TName,
    payload: InteractivePlayerEvents[TName],
  ): void {
    emitPlaybackEvent(this.emitter, 'InteractivePlayer', event, payload);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const sourceLoadControllers = [...this.sourceLoadControllers.values()];
    this.sourceLoadControllers.clear();
    for (const controller of sourceLoadControllers) controller.abort();
    const disposeSettlement = this.mixer.dispose();
    this.sources.clear();
    this.recorder.reset();
    const clearEmitter = () => this.emitter.clear();
    if (disposeSettlement) {
      // Keep lifecycle observers alive until an owned AudioContext finishes
      // closing so an asynchronous close rejection remains observable.
      void disposeSettlement.then(clearEmitter, clearEmitter);
    } else {
      clearEmitter();
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('InteractivePlayer has been disposed.');
  }

  private beginSourceChange(id: string): AbortController {
    const previous = this.sourceLoadControllers.get(id);
    const controller = new AbortController();
    // Publish identity before aborting: abort listeners may replace this id.
    this.sourceLoadControllers.set(id, controller);
    previous?.abort();
    return controller;
  }

  private finishSourceChange(id: string, controller: AbortController): void {
    if (this.sourceLoadControllers.get(id) === controller) this.sourceLoadControllers.delete(id);
  }

  private commitSource(id: string, score: Score, options: AddSourceOptions, controller: AbortController): void {
    if (this.sourceLoadControllers.get(id) !== controller || this.disposed) return;
    const source = createInteractiveSource(id, score, options.beatUnitQuarters ?? 1, options.route);
    // Routing is application code; a reentrant replacement/disposal wins.
    if (this.sourceLoadControllers.get(id) === controller && !this.disposed) this.sources.add(source);
  }

  private playNotes(
    notes: BeatNote[],
    nominalSecondsPerBeat: number,
    overrideSecondsPerBeat?: number,
  ): void {
    if (notes.length === 0) return;
    const audio = this.mixer.ensureForPlayback();
    if (!audio) return;
    const secondsPerBeat = overrideSecondsPerBeat ?? nominalSecondsPerBeat;
    const base = audio.context.currentTime + this.lookahead;
    for (const note of notes) {
      const voice = note.voice ??
        this.resolveVoice(note) ??
        this.options.defaultVoice ??
        this.mixer.firstVoiceId;
      const duration = overrideSecondsPerBeat != null
        ? note.durationBeats * secondsPerBeat
        : note.durationSeconds;
      const time = base + note.onsetInBeat * secondsPerBeat;
      this.mixer.fire(
        voice,
        note.midi,
        note.velocity,
        time,
        Math.max(0, duration),
      );
    }
  }

  private resolveVoice(note: BeatNote): string | undefined {
    return this.options.resolveVoice?.(note, this.sources.active?.id ?? '');
  }
}
