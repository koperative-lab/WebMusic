// ============================================================================
// Rack — coordinate several single-instrument players through one lazy shared
// AudioContext and master bus. Public contracts, member construction, and mix
// calculations live in focused `rack/*` modules.
// ============================================================================

import {EventEmitter} from '../../core';
import {Effect, insertEffect, type EffectNode} from './effects';
import {assertLiveAudioContext, resolveAudioGraphContext} from './audio-utils';
import {ScorePlayer} from './score-player';
import {InteractivePlayer, type AdvanceOptions, type BeatNote} from './interactive-player';
import {emitPlaybackEvent, emitPlaybackOperationError} from './playback-events';
import {createRackAudioContext} from './rack/audio-context';
import type {
  InternalRackMember,
  RackAddOptions,
  RackEvents,
  RackMember,
  RackOptions,
} from './rack/contracts';
import {
  buildRackMember,
  createRackMember,
  disposeRackMember,
  rackMemberHandle,
  timelineRackPlayers,
} from './rack/members';
import {applyRackMemberGains, clampRackVolume} from './rack/mixer';

export type {
  RackAddOptions,
  RackEvents,
  RackMember,
  RackMemberMode,
  RackOptions,
} from './rack/contracts';

export function createRack(options: RackOptions = {}): Rack {
  return new Rack(options);
}

export class Rack {
  private readonly emitter = new EventEmitter<RackEvents>();
  private readonly options: RackOptions;
  private _context?: AudioContext;
  private master?: GainNode;
  /** Destination actually committed with the live graph. */
  private outputDestination?: AudioNode;
  private ownsContext = false;
  /** Rack-owned snapshot; caller mutation of constructor options cannot rewrite live state. */
  private effectValue?: Effect;
  /** Exact bundle whose insertion and global cleanup this rack currently owns. */
  private effectNode?: EffectNode;
  private effectDispose?: () => void;
  private readonly members = new Map<string, InternalRackMember>();
  private order: string[] = [];
  private autoId = 0;
  private disposed = false;
  private memberGeneration = 0;
  private readonly memberMutationWaiters = new Set<() => void>();
  private startPromise?: Promise<void>;
  private startGeneration = 0;
  private readonly startCancellationWaiters = new Set<() => void>();
  private wantsPlayback = false;
  private audioBuildSerial = 0;
  private activeAudioBuild?: number;

  constructor(options: RackOptions = {}) {
    // Construction options are a snapshot. Runtime setters must not mutate a
    // caller-owned (possibly frozen) object, and later caller mutation must not
    // silently rewrite a graph the Rack already owns.
    this.options = {...options};
    this.effectValue = options.effect;
  }

  // Audio graph (lazy and SSR-safe).

  get context(): AudioContext {
    return this.ensureAudio().context;
  }

  private ensureAudio(): {context: AudioContext; master: GainNode} {
    if (this.disposed) throw new Error('Rack has been disposed.');
    if (this._context && this.master && this.outputDestination) {
      const context = this._context;
      const master = this.master;
      const generation = this.memberGeneration;
      const build = this.beginAudioBuild();
      try {
        this.buildPending(context, master, generation, build);
        this.assertAudioBuildCurrent(build, generation);
        return {context, master};
      } finally {
        this.endAudioBuild(build);
      }
    }
    const generation = this.memberGeneration;
    const build = this.beginAudioBuild();
    let context: AudioContext | undefined;
    let destination: AudioNode | undefined;
    let ownsContext = false;
    let master: GainNode | undefined;
    let effectNode: EffectNode | undefined;
    let effectDispose: (() => void) | undefined;
    try {
      const resolved = resolveAudioGraphContext(
        this.options.audioContext,
        this.options.destination,
        createRackAudioContext,
      );
      context = resolved.context;
      destination = resolved.destination;
      ownsContext = resolved.ownsContext;
      this.assertAudioBuildCurrent(build, generation);

      master = context.createGain();
      master.gain.value = this.options.masterVolume ?? 1;
      this.assertAudioBuildCurrent(build, generation);
      const effect = this.effectValue;
      effectDispose = insertEffect(
        context,
        master,
        destination,
        effect ? Effect.custom((effectContext) => {
          effectNode = effect.build(effectContext);
          return effectNode;
        }) : undefined,
      ).dispose;
      this.assertAudioBuildCurrent(build, generation);
      this.buildPending(context, master, generation, build);
      this.assertAudioBuildCurrent(build, generation);

      // Commit graph ownership only after the complete current member set is
      // still identical to the set this construction started with.
      this.ownsContext = ownsContext;
      this.effectNode = effectNode;
      this.effectDispose = effectDispose;
      this._context = context;
      this.master = master;
      this.outputDestination = destination;
      return {context, master};
    } catch (error) {
      // buildRackMember mutates lazy member records. Roll every member back to
      // its pre-graph state before releasing the shared bus/context.
      for (const member of [...this.members.values()].reverse()) {
        disposeRackMember(member, (operation, failure) => {
          this.reportOperationError(operation, failure);
        });
      }
      if (effectDispose) this.tryCleanup('failed effect.dispose', effectDispose);
      if (master) this.tryCleanup('failed master.disconnect', () => master!.disconnect());
      if (ownsContext && context) this.closeContext(context, 'failed context.close');
      throw error;
    } finally {
      this.endAudioBuild(build);
    }
  }

  private maybeAudio(): {context: AudioContext; master: GainNode; destination: AudioNode} | null {
    return this._context && this.master && this.outputDestination
      ? {context: this._context, master: this.master, destination: this.outputDestination}
      : null;
  }

  private buildPending(
    context: AudioContext,
    master: GainNode,
    generation: number,
    build: number,
  ): void {
    const members = [...this.members.values()];
    const built: InternalRackMember[] = [];
    try {
      for (const member of members) {
        this.assertMemberBuildCurrent(build, generation, member);
        const wasBuilt = member.player !== undefined;
        buildRackMember(
          context,
          master,
          member,
          (id) => this.onMemberEnd(id),
          (operation, error) => this.reportOperationError(operation, error),
        );
        if (!wasBuilt && member.player) built.push(member);
        this.assertMemberBuildCurrent(build, generation, member);
      }
      applyRackMemberGains(this.members.values());
      this.assertAudioBuildCurrent(build, generation);
    } catch (error) {
      for (const member of built.reverse()) {
        disposeRackMember(member, (operation, failure) => {
          this.reportOperationError(operation, failure);
        });
      }
      throw error;
    }
  }

  // Members.

  add(options: RackAddOptions): RackMember {
    if (this.disposed) throw new Error('Rack has been disposed.');
    this.markMemberMutation();
    const id = options.id ?? `player-${this.autoId++}`;
    const previous = this.members.get(id);
    if (previous) {
      // Replacement is one public mutation. Do not call remove(), whose
      // intermediate memberschange event could reentrantly install another
      // member that this outer add would then overwrite and leak.
      this.members.delete(id);
      this.order = this.order.filter((memberId) => memberId !== id);
      disposeRackMember(previous, (operation, error) => {
        this.reportOperationError(operation, error);
      });
      if (this.disposed) throw new Error('Rack has been disposed.');
      if (this.members.has(id)) {
        throw new Error(`Rack member "${id}" changed during replacement.`);
      }
    }
    const member = createRackMember(id, options);
    this.members.set(id, member);
    this.order.push(id);

    const audio = this.maybeAudio();
    if (audio) {
      const generation = this.memberGeneration;
      let build: number | undefined;
      try {
        build = this.beginAudioBuild();
        buildRackMember(
          audio.context,
          audio.master,
          member,
          (memberId) => this.onMemberEnd(memberId),
          (operation, failure) => this.reportOperationError(operation, failure),
        );
        this.assertMemberBuildCurrent(build, generation, member);
        applyRackMemberGains(this.members.values());
        this.assertMemberBuildCurrent(build, generation, member);
      } catch (error) {
        const ownsRegistration = this.members.get(id) === member;
        if (ownsRegistration) {
          this.members.delete(id);
          this.order = this.order.filter((memberId) => memberId !== id);
        }
        disposeRackMember(member, (operation, failure) => {
          this.reportOperationError(operation, failure);
        });
        applyRackMemberGains(this.members.values());
        if (previous && ownsRegistration) this.emit('memberschange', undefined);
        throw error;
      } finally {
        if (build !== undefined) this.endAudioBuild(build);
      }
    }
    this.emit('memberschange', undefined);
    return rackMemberHandle(member);
  }

  remove(id: string): this {
    const member = this.members.get(id);
    if (!member) return this;
    this.markMemberMutation();
    this.members.delete(id);
    this.order = this.order.filter((memberId) => memberId !== id);
    disposeRackMember(member, (operation, error) => {
      this.reportOperationError(operation, error);
    });
    // Removing the last solo member reopens every remaining unmuted channel.
    applyRackMemberGains(this.members.values());
    this.emit('memberschange', undefined);
    return this;
  }

  /**
   * Give an existing member a new id without rebuilding its audio graph.
   *
   * The member keeps its player, route, mix state and position. Renaming a
   * missing member or onto an occupied id is an error; renaming a member to its
   * current id is a no-op. Like `add`, a disposed rack rejects the operation.
   */
  rename(oldId: string, newId: string): this {
    if (this.disposed) throw new Error('Rack has been disposed.');
    const member = this.members.get(oldId);
    if (!member) throw new Error(`Rack member "${oldId}" does not exist.`);
    if (oldId === newId) return this;
    if (this.members.has(newId)) {
      throw new Error(`Rack member "${newId}" already exists.`);
    }
    // The only way synchronous code can observe an active construction is by
    // re-entering from a graph hook. Mutating the key in that transaction
    // would leave its rollback looking under the old id, so reject it before
    // changing either the member or the registry.
    if (this.activeAudioBuild !== undefined) {
      throw new Error('Rack members cannot be renamed during audio graph construction.');
    }

    this.markMemberMutation();
    member.id = newId;

    // Delete/set would move this member to the end of Map iteration. Rebuild
    // the registry in place so internal transport order and public list order
    // both remain exactly where the member was.
    const entries = [...this.members.entries()];
    this.members.clear();
    for (const [id, entry] of entries) {
      this.members.set(id === oldId ? newId : id, entry);
    }
    this.order = this.order.map((id) => id === oldId ? newId : id);
    this.emit('memberschange', undefined);
    return this;
  }

  get(id: string): RackMember | undefined {
    const member = this.members.get(id);
    return member ? rackMemberHandle(member) : undefined;
  }

  list(): RackMember[] {
    return this.order.map((id) => rackMemberHandle(this.members.get(id)!));
  }

  // Transport.

  /** Build members and await optional sample/worklet preparation. */
  async preload(): Promise<void> {
    for (;;) {
      if (this.disposed) throw new Error('Rack has been disposed.');
      const {context} = this.ensureAudio();
      await ensureContextRunning(context, 'Rack AudioContext');
      const generation = this.memberGeneration;
      const members = [...this.members.values()];
      const preparations = members.flatMap((member) => {
        const player = member.player;
        return player instanceof ScorePlayer || player instanceof InteractivePlayer
          ? [player.preload()]
          : [];
      });
      const preparation = Promise.allSettled(preparations);
      const mutation = this.waitForMemberMutation(generation);
      const outcome = await Promise.race([
        preparation.then((results) => ({kind: 'prepared' as const, results})),
        mutation.promise.then(() => ({kind: 'mutated' as const})),
      ]);
      mutation.cancel();
      if (outcome.kind === 'mutated') continue;
      const {results} = outcome;

      if (this.disposed) throw new Error('Rack has been disposed.');
      await ensureContextRunning(context, 'Rack AudioContext');
      const graphChanged =
        generation !== this.memberGeneration ||
        members.some((member) => this.members.get(member.id) !== member);
      if (graphChanged) continue;

      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (rejected) throw rejected.reason;
      return;
    }
  }

  play(): Promise<void> {
    this.wantsPlayback = true;
    if (this.startPromise) return this.startPromise;
    const generation = ++this.startGeneration;
    const promise = this.beginPlay(generation);
    // A synchronous graph hook may have re-entered pause()/stop() before
    // beginPlay returned. Do not publish that already-cancelled generation as
    // the coalescing promise for an immediate, legitimate retry.
    if (generation === this.startGeneration && this.wantsPlayback && !this.disposed) {
      this.startPromise = promise;
    }
    const clear = () => {
      if (this.startPromise === promise) this.startPromise = undefined;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private async beginPlay(generation: number): Promise<void> {
    let players: ScorePlayer[] = [];
    try {
      for (;;) {
        const {context} = this.ensureAudio();
        const running = await this.runStartPhase(
          generation,
          () => ensureContextRunning(context, 'Rack AudioContext'),
        );
        if (running.kind === 'cancelled') return;
        if (running.kind === 'failed') throw running.error;

        const preloaded = await this.runStartPhase(generation, () => this.preload());
        if (preloaded.kind === 'cancelled') return;
        if (preloaded.kind === 'failed') throw preloaded.error;
        if (generation !== this.startGeneration || this.disposed || !this.wantsPlayback) return;

        const memberGeneration = this.memberGeneration;
        const members = [...this.members.values()].filter(
          (member) => member.mode === 'timeline' && member.player instanceof ScorePlayer,
        );
        for (const member of members) member.ended = false;
        const mutation = this.waitForMemberMutation(memberGeneration);
        const cancellation = this.waitForStartCancellation(generation);
        const starts: Promise<void>[] = [];
        players = [];
        for (const member of members) {
          if (
            this.memberSnapshotChanged(memberGeneration, members) ||
            generation !== this.startGeneration ||
            this.disposed ||
            !this.wantsPlayback
          ) {
            break;
          }
          const player = member.player as ScorePlayer;
          players.push(player);
          try {
            starts.push(Promise.resolve(player.play()));
          } catch (error) {
            starts.push(Promise.reject(error));
          }
        }

        // allSettled attaches a rejection handler to every member immediately.
        // The mutation/cancellation branches may win while an old member's
        // start never settles; a later rejection must still not become an
        // unhandled rejection.
        const completion = Promise.allSettled(starts);
        const outcome = await Promise.race([
          completion.then((results) => ({kind: 'settled' as const, results})),
          mutation.promise.then(() => ({kind: 'mutated' as const})),
          cancellation.promise.then(() => ({kind: 'cancelled' as const})),
        ]);
        mutation.cancel();
        cancellation.cancel();

        if (outcome.kind === 'cancelled') {
          this.pausePlayers(players, 'rollback cancelled start');
          players = [];
          return;
        }
        if (outcome.kind === 'mutated') {
          this.pausePlayers(players, 'rollback mutated start');
          players = [];
          continue;
        }

        const rejected = outcome.results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (rejected) {
          const graphChanged = this.memberSnapshotChanged(memberGeneration, members);
          if (
            graphChanged &&
            generation === this.startGeneration &&
            !this.disposed &&
            this.wantsPlayback
          ) {
            this.pausePlayers(players, 'rollback mutated start');
            players = [];
            continue;
          }
          throw rejected.reason;
        }

        const graphChanged = this.memberSnapshotChanged(memberGeneration, members);
        if (graphChanged) {
          this.pausePlayers(players, 'rollback mutated start');
          players = [];
          if (
            generation === this.startGeneration &&
            !this.disposed &&
            this.wantsPlayback
          ) {
            continue;
          }
          return;
        }

        if (
          generation !== this.startGeneration ||
          this.disposed ||
          !this.wantsPlayback
        ) {
          this.pausePlayers(players, 'rollback stale start');
        }
        return;
      }
    } catch (error) {
      const current = generation === this.startGeneration && !this.disposed;
      if (current) this.wantsPlayback = false;
      // Roll back a partial start. If a newer generation now owns the same
      // players, leave it alone; its own start/rollback path is authoritative.
      if (current || !this.wantsPlayback) {
        this.pausePlayers(players, 'rollback failed start');
      }
      throw error;
    }
  }

  pause(): this {
    this.wantsPlayback = false;
    this.cancelPendingStart();
    this.pausePlayers(this.timelinePlayers(), 'pause member');
    return this;
  }

  stop(): this {
    this.wantsPlayback = false;
    this.cancelPendingStart();
    for (const player of this.timelinePlayers()) {
      this.tryCleanup('stop member', () => player.stop());
    }
    this.forEachTimeline((member) => {
      member.ended = false;
    });
    return this;
  }

  seek(seconds: number): this {
    this.timelinePlayers().forEach((player) => player.seek(seconds));
    return this;
  }

  advance(options: AdvanceOptions = {}): Record<string, BeatNote[]> {
    this.ensureAudio();
    const notesByMember: Record<string, BeatNote[]> = {};
    for (const member of this.members.values()) {
      if (member.mode === 'interactive' && member.player instanceof InteractivePlayer) {
        notesByMember[member.id] = member.player.advance(options);
      }
    }
    return notesByMember;
  }

  // Mixing.

  setVolume(id: string, volume: number): this {
    const member = this.members.get(id);
    if (member) {
      member.volume = clampRackVolume(volume);
      applyRackMemberGains(this.members.values());
      this.emit('mixchange', undefined);
    }
    return this;
  }

  mute(id: string, muted = true): this {
    const member = this.members.get(id);
    if (member) {
      member.muted = muted;
      applyRackMemberGains(this.members.values());
      this.emit('mixchange', undefined);
    }
    return this;
  }

  solo(id: string, solo = true): this {
    const member = this.members.get(id);
    if (member) {
      member.solo = solo;
      applyRackMemberGains(this.members.values());
      this.emit('mixchange', undefined);
    }
    return this;
  }

  /**
   * The desk level, `0…1`. Readable for the same reason a member's is: a mixer
   * surface renders the rack, and one that kept its own master beside this one
   * would show a fader that disagrees with the gain node.
   */
  get masterVolume(): number {
    return clampRackVolume(this.options.masterVolume ?? 1);
  }

  /** Rack-level post-processing on the summed master output. */
  get effect(): Effect | undefined {
    return this.effectValue;
  }

  set effect(effect: Effect | undefined) {
    this.setEffect(effect);
  }

  /**
   * Replace the rack-level effect without rebuilding any member players.
   *
   * Before the lazy audio graph exists this only updates its recipe. Once the
   * graph is live, the replacement route is built first and committed only if
   * construction succeeds; a failed effect therefore leaves the previous
   * route and recipe intact.
   */
  setEffect(effect: Effect | undefined): this {
    if (this.disposed) throw new Error('Rack has been disposed.');
    if (effect === this.effectValue) return this;
    // The first graph is still "lazy" until ensureAudio commits. A custom
    // builder must not rewrite its recipe while that graph is being built.
    if (this.activeAudioBuild !== undefined) {
      throw new Error('Rack effects cannot be changed during audio graph construction.');
    }

    const audio = this.maybeAudio();
    if (!audio) {
      this.effectValue = effect;
      return this;
    }

    const generation = this.memberGeneration;
    const build = this.beginAudioBuild();
    const previousNode = this.effectNode;
    const previousDispose = this.effectDispose;
    let replacementNode: EffectNode | undefined;
    let replacementDispose: (() => void) | undefined;
    let insertionAttempted = false;
    let overlapsPrevious = false;
    let committed = false;
    try {
      replacementNode = effect?.build(audio.context);
      overlapsPrevious = effectNodesOverlap(previousNode, replacementNode);
      this.assertAudioBuildCurrent(build, generation);
      if (replacementNode && replacementNode === previousNode) {
        // Effect.custom(existingBundle) may be wrapped by another recipe. Its
        // graph is already connected: retain the exact insertion/disposer so
        // retiring an alias cannot disconnect or dispose the active bundle.
        this.effectValue = effect;
        return this;
      }
      if (overlapsPrevious) {
        // A distinct disposer may own some of the current graph. Neither
        // retiring the old bundle nor rolling back the new one is safe; reject
        // before changing Rack-owned edges and leave cleanup with its caller.
        throw new Error(
          'Rack effect replacements must return fresh input/output nodes or the exact active EffectNode bundle.',
        );
      }
      insertionAttempted = true;
      replacementDispose = insertEffect(
        audio.context,
        audio.master,
        audio.destination,
        replacementNode ? Effect.custom(replacementNode) : undefined,
      ).dispose;
      this.assertAudioBuildCurrent(build, generation);
      this.effectValue = effect;
      this.effectNode = replacementNode;
      this.effectDispose = replacementDispose;
      committed = true;
    } catch (error) {
      if (replacementDispose) {
        this.tryCleanup('failed replacement effect.dispose', replacementDispose);
      } else if (!insertionAttempted && replacementNode && !overlapsPrevious) {
        // An external builder can dispose or mutate the Rack before insertion.
        // Fresh returned resources still need release; insertEffect owns their
        // rollback once insertion has been attempted.
        this.tryCleanup('cancelled replacement effect.dispose', () => replacementNode?.dispose?.());
      }
      throw error;
    } finally {
      this.endAudioBuild(build);
    }

    // The new route is already authoritative. Cleanup faults are reported on
    // Rack's operation channel rather than rolling back to a graph whose
    // teardown may itself have only partially succeeded.
    if (committed && previousDispose) {
      this.tryCleanup('replaced effect.dispose', previousDispose);
    }
    return this;
  }

  setMasterVolume(volume: number): this {
    const value = clampRackVolume(volume);
    const audio = this.maybeAudio();
    if (audio) audio.master.gain.value = value;
    (this.options as {masterVolume?: number}).masterVolume = value;
    this.emit('mixchange', undefined);
    return this;
  }

  // Events and lifecycle.

  on<TName extends keyof RackEvents>(event: TName, callback: (payload: RackEvents[TName]) => void): () => void {
    return this.emitter.on(event, callback);
  }

  private emit<TName extends keyof RackEvents>(
    event: TName,
    payload: RackEvents[TName],
  ): void {
    emitPlaybackEvent(this.emitter, 'Rack', event, payload);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.markMemberMutation();
    this.wantsPlayback = false;
    this.cancelPendingStart();
    const members = [...this.members.values()];
    const master = this.master;
    const effectDispose = this.effectDispose;
    const context = this._context;
    const ownsContext = this.ownsContext;
    this.members.clear();
    this.order = [];
    this.master = undefined;
    this.outputDestination = undefined;
    this.effectNode = undefined;
    this.effectDispose = undefined;
    this.ownsContext = false;
    this._context = undefined;

    for (const member of members) {
      disposeRackMember(member, (operation, error) => {
        this.reportOperationError(operation, error);
      });
    }
    if (effectDispose) this.tryCleanup('effect.dispose', effectDispose);
    if (master) this.tryCleanup('master.disconnect', () => master.disconnect());
    if (ownsContext && context) {
      try {
        const closing = context.close?.();
        if (closing && typeof (closing as Promise<void>).then === 'function') {
          void Promise.resolve(closing).then(
            () => this.emitter.clear(),
            (error: unknown) => {
              this.reportOperationError('context.close', error);
              this.emitter.clear();
            },
          );
          return;
        }
      } catch (error) {
        this.reportOperationError('context.close', error);
      }
    }
    this.emitter.clear();
  }

  private tryCleanup(operation: string, callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.reportOperationError(operation, error);
    }
  }

  private closeContext(context: AudioContext, operation: string): void {
    try {
      const closing = context.close?.();
      void (closing as Promise<void> | undefined)?.catch((error: unknown) => {
        this.reportOperationError(operation, error);
      });
    } catch (error) {
      this.reportOperationError(operation, error);
    }
  }

  private reportOperationError(operation: string, error: unknown): void {
    emitPlaybackOperationError(this.emitter, 'Rack', operation, error);
  }

  private cancelPendingStart(): void {
    this.startGeneration += 1;
    this.startPromise = undefined;
    const waiters = [...this.startCancellationWaiters];
    this.startCancellationWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  private async runStartPhase<T>(
    generation: number,
    operation: () => T | PromiseLike<T>,
  ): Promise<
    | {kind: 'settled'; value: T}
    | {kind: 'failed'; error: unknown}
    | {kind: 'cancelled'}
  > {
    if (generation !== this.startGeneration || this.disposed || !this.wantsPlayback) {
      return {kind: 'cancelled'};
    }
    const cancellation = this.waitForStartCancellation(generation);
    if (generation !== this.startGeneration || this.disposed || !this.wantsPlayback) {
      cancellation.cancel();
      return {kind: 'cancelled'};
    }
    let phase: Promise<T>;
    try {
      phase = Promise.resolve(operation());
    } catch (error) {
      phase = Promise.reject(error);
    }
    const outcome = await Promise.race([
      phase.then(
        (value) => ({kind: 'settled' as const, value}),
        (error: unknown) => ({kind: 'failed' as const, error}),
      ),
      cancellation.promise.then(() => ({kind: 'cancelled' as const})),
    ]);
    cancellation.cancel();
    return outcome;
  }

  private waitForStartCancellation(generation: number): {
    promise: Promise<void>;
    cancel: () => void;
  } {
    if (generation !== this.startGeneration) {
      return {promise: Promise.resolve(), cancel: () => undefined};
    }
    let waiter: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      waiter = resolve;
      this.startCancellationWaiters.add(resolve);
    });
    return {
      promise,
      cancel: () => {
        if (waiter) this.startCancellationWaiters.delete(waiter);
      },
    };
  }

  private pausePlayers(players: readonly ScorePlayer[], operation: string): void {
    for (const player of players) {
      this.tryCleanup(operation, () => player.pause());
    }
  }

  private timelinePlayers(): ScorePlayer[] {
    return timelineRackPlayers(this.members.values());
  }

  private memberSnapshotChanged(
    generation: number,
    members: readonly InternalRackMember[],
  ): boolean {
    return generation !== this.memberGeneration ||
      members.some((member) => this.members.get(member.id) !== member);
  }

  private forEachTimeline(callback: (member: InternalRackMember) => void): void {
    for (const member of this.members.values()) {
      if (member.mode === 'timeline') callback(member);
    }
  }

  private onMemberEnd(id: string): void {
    const member = this.members.get(id);
    if (!member || member.ended) return;
    member.ended = true;
    this.emit('memberEnd', {id});
    const timeline = [...this.members.values()].filter((candidate) => candidate.mode === 'timeline');
    if (timeline.length > 0 && timeline.every((candidate) => candidate.ended)) {
      this.emit('end', undefined);
    }
  }

  private beginAudioBuild(): number {
    if (this.activeAudioBuild !== undefined) {
      throw new Error('Rack audio graph construction cannot be re-entered.');
    }
    const build = ++this.audioBuildSerial;
    this.activeAudioBuild = build;
    return build;
  }

  private endAudioBuild(build: number): void {
    if (this.activeAudioBuild === build) this.activeAudioBuild = undefined;
  }

  private assertAudioBuildCurrent(build: number, generation: number): void {
    if (
      this.disposed ||
      this.activeAudioBuild !== build ||
      this.memberGeneration !== generation
    ) {
      throw new Error('Rack members changed during audio graph construction.');
    }
  }

  private assertMemberBuildCurrent(
    build: number,
    generation: number,
    member: InternalRackMember,
  ): void {
    this.assertAudioBuildCurrent(build, generation);
    if (this.members.get(member.id) !== member) {
      throw new Error(`Rack member "${member.id}" changed during audio graph construction.`);
    }
  }

  private markMemberMutation(): void {
    this.memberGeneration += 1;
    const waiters = [...this.memberMutationWaiters];
    this.memberMutationWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  private waitForMemberMutation(generation: number): {
    promise: Promise<void>;
    cancel: () => void;
  } {
    if (generation !== this.memberGeneration) {
      return {promise: Promise.resolve(), cancel: () => undefined};
    }
    let waiter: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      waiter = resolve;
      this.memberMutationWaiters.add(resolve);
    });
    return {
      promise,
      cancel: () => {
        if (waiter) this.memberMutationWaiters.delete(waiter);
      },
    };
  }
}

function effectNodesOverlap(previous: EffectNode | undefined, replacement: EffectNode | undefined): boolean {
  if (!previous || !replacement) return false;
  return previous.input === replacement.input || previous.input === replacement.output ||
    previous.output === replacement.input || previous.output === replacement.output;
}

async function ensureContextRunning(context: AudioContext, label: string): Promise<void> {
  assertLiveAudioContext(context, label);
  if (context.state !== 'running') await context.resume();
  assertLiveAudioContext(context, label);
  if (context.state !== 'running') {
    throw new Error(`${label} is ${context.state} and cannot drive live playback.`);
  }
}
