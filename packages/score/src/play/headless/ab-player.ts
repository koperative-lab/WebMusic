// ============================================================================
// AbPlayer — headless live switching between named arrangements (A / B / …) of
// the same piece. Built on `InteractivePlayer.select()`: every variant is
// registered as a source, an internal `Metronome` advances the beat, and
// `select(id)` swaps the active source with ZERO latency — the cursor carries
// over proportionally, so the music keeps its place across the switch. The
// DOM-free counterpart of the former `<ab-player>` element.
//
//   const ab = new AbPlayer({A: major, B: minor});
//   ab.player.on('beat', (b) => draw(ab.active, b));
//   ab.play();
//   ab.select('B');   // instant, in time
// ============================================================================

import type {Score} from '../../core';
import {InteractivePlayer} from './interactive-player';
import {Sound} from './sound';
import type {HeadlessSynth} from './audio-contracts';
import {Metronome} from './inputs';

export interface AbPlayerOptions {
  /** Timbre for the ensemble. Defaults to a quiet triangle oscillator. */
  sound?: HeadlessSynth;
  /** Quarter-note beats per minute. Defaults to the first source's tempo converted to quarters, else `100`. */
  bpm?: number;
}

/**
 * Live A/B (A/B/C/…) arrangement switcher over one {@link InteractivePlayer}.
 * Construct it with the named arrangements; `play()` starts the metronome,
 * `select(id)` swaps the sounding variant in time, `pause()` stops.
 */
export class AbPlayer {
  /** The underlying pull engine — subscribe to `beat`, read `context`, etc. */
  readonly player: InteractivePlayer;

  private readonly metronome: Metronome;
  private readonly sourceIds: string[];
  private activeId?: string;
  private isPlaying = false;
  private startPromise?: Promise<void>;
  private startGeneration = 0;
  private disposed = false;

  constructor(sources: Record<string, Score>, options: AbPlayerOptions = {}) {
    this.sourceIds = Object.keys(sources);
    const player = new InteractivePlayer();
    const sound = options.sound ?? Sound.oscillator({type: 'triangle', gain: 0.2, releaseSeconds: 0.05});
    player.addVoice('main', sound, {synthOwnership: options.sound ? 'borrowed' : 'owned'});
    for (const id of this.sourceIds) player.addSource(id, sources[id]);
    this.player = player;

    this.activeId = this.sourceIds[0];
    if (this.activeId) player.select(this.activeId, {carry: false});

    const tempo = sources[this.sourceIds[0]]?.timeMap.tempi[0];
    const bpm = options.bpm ?? (tempo ? tempo.bpm * (tempo.unit ?? 1) : 100);
    this.metronome = new Metronome((secondsPerBeat) => player.advance({secondsPerBeat}), {bpm});
  }

  /** The named arrangement ids, in registration order. */
  get ids(): readonly string[] {
    return this.sourceIds;
  }

  /** The currently-sounding arrangement, if any. */
  get active(): string | undefined {
    return this.activeId;
  }

  /** Whether the metronome is currently running. */
  get playing(): boolean {
    return this.isPlaying;
  }

  /** Switch to a named arrangement live — zero-latency; the cursor carries over. */
  select(id: string): void {
    this.assertNotDisposed();
    if (id === this.activeId || !this.sourceIds.includes(id)) return;
    this.player.select(id);
    this.activeId = id;
  }

  /** Prepare audio, then start advancing the beat. */
  play(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('AbPlayer has been disposed.'));
    if (this.sourceIds.length === 0 || this.isPlaying) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    const generation = ++this.startGeneration;
    const pending = this.beginPlay(generation);
    // A supplied sound may pause/dispose the wrapper from its synchronous
    // preparation hook. Do not publish that cancelled start over a retry.
    if (generation === this.startGeneration && !this.disposed) {
      this.startPromise = pending;
    }
    const clear = () => {
      if (this.startPromise === pending) this.startPromise = undefined;
    };
    void pending.then(clear, clear);
    return pending;
  }

  /** Stop and silence any held notes. */
  pause(): void {
    if (this.disposed) return;
    this.cancelPendingStart();
    this.metronome.stop();
    this.player.allNotesOff();
    this.isPlaying = false;
  }

  /** Tear down the metronome and engine. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingStart();
    this.metronome.stop();
    this.player.dispose();
    this.isPlaying = false;
  }

  private async beginPlay(generation: number): Promise<void> {
    await this.player.preload();
    if (
      this.disposed ||
      generation !== this.startGeneration ||
      this.sourceIds.length === 0 ||
      this.isPlaying
    ) return;
    this.metronome.start();
    this.isPlaying = true;
  }

  private cancelPendingStart(): void {
    // beginPlay enters external preparation before play can cache its Promise.
    // Invalidate that work even when startPromise has not been assigned yet.
    this.startGeneration += 1;
    this.startPromise = undefined;
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('AbPlayer has been disposed.');
  }
}

/** Build an {@link AbPlayer} for a set of named arrangements. */
export function createAbPlayer(sources: Record<string, Score>, options?: AbPlayerOptions): AbPlayer {
  return new AbPlayer(sources, options);
}
