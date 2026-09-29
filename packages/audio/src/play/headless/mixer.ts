// ============================================================================
// AudioMixer — the digital-audio analogue of WebScore's Rack. Coordinates
// several clips/players. Players it creates share one AudioContext; it
// proposes one future start to schedulable members. Each player keeps its own
// transport clock; borrowed players and media adapters may have weaker start
// guarantees. `add()` accepts any structural `PlayerLike`. Volume, mute and
// solo use a master gain factor applied to each member.
// ============================================================================

import {EventEmitter, type AudioClip} from '../../core';
import {type Effect} from '../core/effect';
import {AudioClipPlayer, type PlayerLike} from './player';
import type {MediaPlaybackAdapterFactory} from './engines/media-engine';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';
import type {AudioPlayerTransport} from './audio-player';

/**
 * Scheduling headroom before the stems join, in seconds. Schedulable
 * AudioClipPlayer members receive one future AudioContext time target. Actual
 * alignment depends on each player and backend.
 */
const MIXER_START_LEAD_SECONDS = 0.06;

export interface AudioMixerOptions {
  audioContext?: AudioContext;
  masterVolume?: number;
  destination?: AudioNode;
  mediaAdapterFactory?: MediaPlaybackAdapterFactory;
}

export interface MixerMemberInit {
  id: string;
  clip?: AudioClip;
  player?: PlayerLike;
  effect?: Effect;
  volume?: number;
}

/** Immutable requested mix state; effectiveVolume is the gain sent to a member. */
export interface AudioMixerMemberSnapshot {
  readonly id: string;
  readonly volume: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly effectiveVolume: number;
}

export interface AudioMixerSnapshot {
  readonly masterVolume: number;
  readonly soloId: string | null;
  readonly members: readonly AudioMixerMemberSnapshot[];
}

export interface AudioMixerEvents {
  /** Mix or membership changed. Read snapshot() for the latest state. */
  change: void;
  end: void;
  memberEnd: {id: string};
  error: Error;
}

interface MixerMember {
  id: string;
  player: PlayerLike;
  ownsPlayer: boolean;
  volume: number;
  muted: boolean;
  offEnd: () => void;
}

export class AudioMixer {
  private readonly options: AudioMixerOptions;
  private readonly emitter = new EventEmitter<AudioMixerEvents>();
  private readonly members = new Map<string, MixerMember>();
  private context: AudioContext | null = null;
  private masterVolume: number;
  private soloId: string | null = null;
  private readonly endedIds = new Set<string>();
  private generation = 0;
  private intent: 'playing' | 'paused' | 'stopped' = 'stopped';
  private disposed = false;
  private mixRevision = 0;
  private commandRevision = 0;

  /** Stable borrowed transport adapter. The mixer retains membership and graph ownership. */
  readonly transport: AudioPlayerTransport = (() => {
    const readSeconds = () => this.seconds;
    const readDuration = () => this.duration;
    const readPlaying = () => this.playing;
    return {
      get seconds() { return readSeconds(); },
      get duration() { return readDuration(); },
      get playing() { return readPlaying(); },
      play: () => this.play(), pause: () => this.pause(), stop: () => this.stop(),
      seek: (seconds: number) => this.seek(seconds),
      setVolume: (volume: number) => this.setMasterVolume(volume),
      subscribe: (notify: () => void) => this.on('change', notify),
      onEnd: (notify: () => void) => this.on('end', notify),
      onError: (notify: (error: Error) => void) => this.on('error', notify),
    };
  })();

  /** Content seconds of the furthest timed member; no second clock is introduced. */
  get seconds(): number {
    return Math.max(0, ...[...this.members.values()].map(({player}) => player.seconds ?? 0));
  }
  get duration(): number {
    return Math.max(0, ...[...this.members.values()].map(({player}) => player.duration ?? 0));
  }
  get playing(): boolean {
    return [...this.members.values()].some(({player}) => player.playing === true);
  }

  constructor(options: AudioMixerOptions = {}) {
    this.options = {...options};
    this.masterVolume = normalizeVolume(options.masterVolume ?? 1);
    if (options.audioContext) this.context = options.audioContext;
  }

  /** Add a member from a clip (a player is built) or an existing PlayerLike. */
  add(init: MixerMemberInit): this {
    if (this.disposed) return this;

    let player: PlayerLike;
    let ownsPlayer = false;
    if (init.player) {
      player = init.player;
    } else if (init.clip) {
      const context = this.ensureContext();
      player = new AudioClipPlayer(init.clip, {
        audioContext: context,
        destination: this.options.destination,
        mediaAdapterFactory: this.options.mediaAdapterFactory,
        ...(init.effect ? {effect: init.effect} : {}),
        ...(init.volume !== undefined ? {volume: init.volume} : {}),
      });
      ownsPlayer = true;
    } else {
      throw new Error(`Mixer member "${init.id}" needs either a clip or a player`);
    }

    const previous = this.members.get(init.id);
    if (previous?.player === player) {
      // Reapplying the same borrowed player should keep its existing listener
      // and ownership. Replacing it would dispose a mixer-owned player or
      // briefly detach the only end subscription.
      previous.volume = normalizeVolume(init.volume ?? 1);
      previous.muted = false;
      this.endedIds.delete(init.id);
      this.applyGains();
      return this;
    }

    // Prepare a candidate before committing membership. Its callback is tied
    // to this exact member, so a late callback cannot end a replacement.
    const member: MixerMember = {
      id: init.id,
      player,
      ownsPlayer,
      volume: normalizeVolume(init.volume ?? 1),
      muted: false,
      offEnd: () => {},
    };
    try {
      member.offEnd = player.on('end', () => this.onMemberEnd(member));
    } catch (error) {
      this.releaseMember(member, []);
      throw error;
    }
    // Subscribing a structural player may synchronously replace or dispose
    // the mixer. Do not overwrite that newer ownership decision.
    if (this.disposed || this.members.get(init.id) !== previous) {
      const errors: unknown[] = [];
      this.releaseMember(member, errors);
      if (errors.length) throw errors[0];
      return this;
    }
    this.members.set(init.id, member);
    this.endedIds.delete(init.id);
    const errors: unknown[] = [];
    // Release the old member after its ownership is detached. Cleanup can
    // reenter add/remove without the outer call installing the candidate again.
    if (previous) this.releaseMember(previous, errors);
    try { this.applyGains(); } catch (error) { errors.push(error); }
    if (errors.length) throw errors[0];
    return this;
  }

  remove(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    this.members.delete(id);
    this.endedIds.delete(id);
    if (this.soloId === id) this.soloId = null;
    const errors: unknown[] = [];
    this.releaseMember(member, errors);
    try { this.applyGains(); } catch (error) { errors.push(error); }
    if (errors.length) throw errors[0];
  }

  // --- transport: owned members share a context, not a writable clock ---

  async play(): Promise<void> {
    if (this.disposed) return;
    this.commandRevision++;
    const generation = ++this.generation;
    this.intent = 'playing';
    this.endedIds.clear();
    try {
      const context = this.ensureContext();
      if (context.state === 'suspended') await context.resume();
      if (!this.isCurrent(generation)) return;
      await this.startAligned(context, generation);
      if (this.isCurrent(generation)) this.emitChange();
    } catch (error) {
      if (this.isCurrent(generation)) this.rollbackStart([...this.members.values()], generation);
      this.emitError(error);
      throw error;
    }
  }

  pause(): void {
    if (this.disposed) return;
    const command = ++this.commandRevision;
    this.generation++;
    this.intent = 'paused';
    for (const member of [...this.members.values()]) {
      if (!this.isCurrentCommand(command)) return;
      if (this.members.get(member.id) === member) member.player.pause();
    }
    if (this.isCurrentCommand(command)) this.emitChange();
  }

  stop(): void {
    if (this.disposed) return;
    const command = ++this.commandRevision;
    this.generation++;
    this.intent = 'stopped';
    this.endedIds.clear();
    for (const member of [...this.members.values()]) {
      if (!this.isCurrentCommand(command)) return;
      if (this.members.get(member.id) === member) member.player.stop();
    }
    if (this.isCurrentCommand(command)) this.emitChange();
  }

  /**
   * Seek every member to the same position. While playing, the members are
   * stopped and restarted together on one future anchor: seeking a running
   * buffer engine restarts its source at whatever the context clock reads
   * during that member's own call, so seeking in place would re-scatter the
   * stems this mixer exists to keep aligned. Naturally ended members rejoin
   * when the group still intends playback and the target precedes their end;
   * independently paused members remain paused.
   */
  seek(seconds: number): void {
    if (this.disposed) return;
    const command = ++this.commandRevision;
    const all = [...this.members.values()];
    const running = all.filter((member) => member.player.playing === true);
    const rejoining = this.intent === 'playing'
      ? all.filter((member) => this.endedIds.has(member.id) &&
        seconds < (member.player.duration ?? member.player.seconds ?? Infinity))
      : [];
    const targets = [...new Set([...running, ...rejoining])];
    if (targets.length === 0) {
      const generation = this.generation;
      for (const member of all) {
        if (!this.isCurrent(generation) || !this.isCurrentCommand(command)) return;
        if (this.members.get(member.id) === member) member.player.seek(seconds);
      }
      if (this.isCurrentCommand(command)) this.emitChange();
      return;
    }
    const generation = ++this.generation;
    this.intent = 'playing';
    for (const member of running) {
      if (!this.isCurrent(generation) || !this.isCurrentCommand(command)) return;
      if (this.members.get(member.id) === member) member.player.pause();
    }
    for (const member of all) {
      if (!this.isCurrent(generation) || !this.isCurrentCommand(command)) return;
      if (this.members.get(member.id) === member) member.player.seek(seconds);
    }
    if (!this.isCurrent(generation) || !this.isCurrentCommand(command)) return;
    for (const member of targets) this.endedIds.delete(member.id);
    const context = this.ensureContext();
    void this.startAligned(context, generation, targets).then(() => {
      if (this.isCurrent(generation)) this.emitChange();
    }).catch((error: unknown) => {
      this.emitError(error);
    });
  }

  // --- mixing ---

  setVolume(id: string, volume: number): void {
    const member = this.members.get(id);
    if (!member) return;
    member.volume = normalizeVolume(volume);
    this.applyGains();
  }

  setMasterVolume(volume: number): void {
    if (this.disposed) return;
    this.masterVolume = normalizeVolume(volume);
    this.applyGains();
  }

  mute(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    member.muted = true;
    this.applyGains();
  }

  unmute(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    member.muted = false;
    this.applyGains();
  }

  solo(id: string | null): void {
    if (this.disposed) return;
    this.soloId = id;
    this.applyGains();
  }

  ids(): string[] {
    return [...this.members.keys()];
  }

  /** Detached, deeply frozen state for any number of presenters. */
  snapshot(): AudioMixerSnapshot {
    return Object.freeze({
      masterVolume: this.masterVolume,
      soloId: this.soloId,
      members: Object.freeze([...this.members.values()].map((member) => Object.freeze({
        id: member.id,
        volume: member.volume,
        muted: member.muted,
        solo: this.soloId === member.id,
        effectiveVolume: this.effectiveVolume(member),
      }))),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.mixRevision++;
    this.intent = 'stopped';
    const members = [...this.members.values()];
    const context = this.context;
    this.members.clear();
    this.endedIds.clear();
    this.soloId = null;
    this.context = null;
    const errors: unknown[] = [];
    for (const member of members) this.releaseMember(member, errors);
    if (context && !this.options.audioContext) {
      try { void context.close().catch(() => {}); } catch (error) { errors.push(error); }
    }
    this.emitChange();
    this.emitter.removeAllListeners();
    if (errors.length) throw errors[0];
  }

  // --- events ---

  on<K extends keyof AudioMixerEvents>(event: K, listener: (data: AudioMixerEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }
  once<K extends keyof AudioMixerEvents>(event: K, listener: (data: AudioMixerEvents[K]) => void): () => void {
    return this.emitter.once(event, listener);
  }
  off<K extends keyof AudioMixerEvents>(event: K, listener: (data: AudioMixerEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }

  // --- internals ---

  /**
   * Start `members` (default: all) at one AudioContext time target. Members
   * are warmed first so a first-play decode cannot land inside the alignment
   * window, then every scheduled-start member is handed the same `when` — the
   * buffer engine passes that target to `source.start(when)` for audio-clock
   * scheduling. This does not establish measured output-device precision.
   * Structural players without a scheduled start begin as soon as they can,
   * exactly as before; they are the reason this stays best-effort.
   */
  private async startAligned(
    context: AudioContext,
    generation: number,
    members?: readonly MixerMember[],
  ): Promise<void> {
    const targets = members ?? [...this.members.values()];
    if (targets.length === 0) return;
    try {
      await Promise.all(
        targets.map((m) => (m.player instanceof AudioClipPlayer ? m.player.preload() : undefined)),
      );
      if (!this.isCurrent(generation)) return;
      const when = context.currentTime + MIXER_START_LEAD_SECONDS;
      await Promise.all(
        targets.map(async (m) => {
          // A member removed or replaced while warming no longer belongs to
          // this start. Recheck per member because play may call host listeners.
          if (!this.isCurrent(generation) || this.members.get(m.id) !== m) return;
          await (m.player instanceof AudioClipPlayer ? m.player.play(when) : m.player.play());
          // Structural players can finish an async start after pause/stop.
          if (!this.isCurrent(generation) && this.members.get(m.id) === m) {
            if (this.intent === 'paused') m.player.pause();
            else if (this.intent === 'stopped') m.player.stop();
          }
        }),
      );
    } catch (error) {
      if (this.isCurrent(generation)) this.rollbackStart(targets, generation);
      throw error;
    }
  }

  /** Retract every participant, including starts scheduled before one rejects. */
  private rollbackStart(targets: readonly MixerMember[], generation: number): void {
    if (!this.isCurrent(generation)) return;
    const command = ++this.commandRevision;
    this.generation++;
    this.intent = 'paused';
    for (const member of targets) {
      if (!this.isCurrentCommand(command)) return;
      if (this.members.get(member.id) !== member) continue;
      try { member.player.pause(); } catch (error) { this.emitError(error); }
    }
    if (this.isCurrentCommand(command)) this.emitChange();
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private isCurrentCommand(command: number): boolean {
    return !this.disposed && command === this.commandRevision;
  }

  private releaseMember(member: MixerMember, errors: unknown[]): void {
    try { member.offEnd(); } catch (error) { errors.push(error); }
    if (member.ownsPlayer) {
      try { member.player.dispose?.(); } catch (error) { errors.push(error); }
    }
  }

  private emitChange(): void {
    this.emitter.emitSafely('change', undefined, (error) => this.emitError(error));
  }

  private emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emitter.emitSafely('error', normalized, () => {});
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    this.context = createWebAudioContext('AudioContext is not available in this environment');
    return this.context;
  }

  private effectiveVolume(member: MixerMember): number {
    const excluded = this.soloId !== null && this.soloId !== member.id;
    return member.muted || excluded ? 0 : member.volume * this.masterVolume;
  }

  /** Reentrant gain commands supersede the remaining writes of this pass. */
  private applyGains(): void {
    if (this.disposed) return;
    const revision = ++this.mixRevision;
    const errors: unknown[] = [];
    for (const member of [...this.members.values()]) {
      if (this.disposed || revision !== this.mixRevision) break;
      if (this.members.get(member.id) !== member) continue;
      try { member.player.setVolume?.(this.effectiveVolume(member)); }
      catch (error) { errors.push(error); }
    }
    if (!this.disposed && revision === this.mixRevision) this.emitChange();
    if (errors.length) throw errors[0];
  }

  private onMemberEnd(member: MixerMember): void {
    if (this.members.get(member.id) !== member || this.endedIds.has(member.id)) return;
    const generation = this.generation;
    this.endedIds.add(member.id);
    this.emitter.emitSafely('memberEnd', {id: member.id}, (error) => this.emitError(error));
    if (!this.isCurrent(generation) || this.members.size === 0 ||
      this.members.get(member.id) !== member || !this.endedIds.has(member.id)) return;
    if (this.endedIds.size >= this.members.size) {
      this.intent = 'stopped';
      this.emitter.emitSafely('end', undefined, (error) => this.emitError(error));
    }
  }
}

/** Build an {@link AudioMixer} (the `createX` convention). */
export function createAudioMixer(options?: AudioMixerOptions): AudioMixer {
  return new AudioMixer(options);
}

function normalizeVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.max(0, volume) : 1;
}
