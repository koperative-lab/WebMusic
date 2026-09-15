import {insertEffect, resolveEffect, type Effect, type EffectNode} from '../effects';
import {assertLiveAudioContext, resolveAudioGraphContext} from '../audio-utils';
import {reportPlaybackOperationFailure} from '../playback-events';
import type {
  AddVoiceOptions,
  HeadlessSynth,
  InteractivePlayerEvents,
  InteractivePlayerOptions,
} from './contracts';

type Timer = ReturnType<typeof setTimeout>;

interface InteractiveVoice {
  id: string;
  synth: HeadlessSynth;
  effect?: Effect;
  effectNode?: EffectNode;
  gain?: GainNode;
  routeCleanup?: () => void;
  synthOwnership: 'borrowed' | 'owned';
  volume: number;
  muted: boolean;
  solo: boolean;
  disposed?: boolean;
}

/** One concrete note attack. MIDI pitch alone is not a voice identifier. */
interface ActiveInteractiveNote {
  id: number;
  voiceId: string;
  midi: number;
  handle: unknown;
  /** noteOn entered arbitrary backend code but has not returned successfully. */
  unconfirmedAttack: boolean;
  /** Backend noteOn is currently on the stack and may commit after reentry. */
  attackInFlight: boolean;
  releasing?: boolean;
  voice: InteractiveVoice;
  onsetTime: number;
  offTimer?: Timer;
}

export interface InteractiveVoiceMixerCallbacks {
  onNoteOn(event: InteractivePlayerEvents['noteOn']): void;
  onNoteOff(event: InteractivePlayerEvents['noteOff']): void;
  onOperationError?(operation: string, error: unknown): void;
  onCapture(
    voice: string,
    midi: number,
    velocity: number,
    time: number,
    durationSeconds: number,
  ): void;
}

/** Lazy audio graph, voice registry, mixer and exact note-release scheduler. */
export class InteractiveVoiceMixer {
  private contextValue?: AudioContext;
  private masterGain?: GainNode;
  private ownsContext = false;
  private effectDispose?: () => void;
  private readonly voices = new Map<string, InteractiveVoice>();
  private voiceOrder: string[] = [];
  private readonly offTimers = new Set<Timer>();
  private readonly activeNotes = new Map<number, ActiveInteractiveNote>();
  private nextActiveNoteId = 1;
  private voiceGeneration = 0;
  private readonly voiceMutationWaiters = new Set<() => void>();
  private disposed = false;
  private disposeSettlement?: Promise<void>;
  private audioBuildSerial = 0;
  private activeAudioBuild?: number;

  constructor(
    private readonly options: InteractivePlayerOptions,
    private readonly callbacks: InteractiveVoiceMixerCallbacks,
  ) {}

  /** Lazily create the graph, throwing when Web Audio is unavailable. */
  get context(): AudioContext {
    return this.ensureAudio().context;
  }

  get firstVoiceId(): string | undefined {
    return this.voiceOrder[0];
  }

  addVoice(id: string, synth: HeadlessSynth, options: AddVoiceOptions = {}): void {
    if (this.disposed) throw new Error('InteractivePlayer has been disposed.');
    this.markVoiceMutation();
    if (this.voices.has(id)) {
      this.removeVoice(id);
      // Releasing an active old voice emits noteOff. A listener may
      // synchronously install its own replacement; never overwrite and orphan
      // that reentrant route when the outer addVoice resumes.
      if (this.voices.has(id)) {
        throw new Error(`Interactive voice "${id}" changed during replacement.`);
      }
      if (this.disposed) throw new Error('InteractivePlayer has been disposed.');
    }
    const voice: InteractiveVoice = {
      id,
      synth,
      effect: options.effect,
      synthOwnership: options.synthOwnership ?? 'borrowed',
      volume: options.volume ?? 1,
      muted: options.muted ?? false,
      solo: false,
    };
    this.voices.set(id, voice);
    this.voiceOrder.push(id);
    const audio = this.currentAudio();
    if (audio) {
      const generation = this.voiceGeneration;
      let build: number | undefined;
      try {
        build = this.beginAudioBuild();
        this.wireVoice(voice, audio.context, audio.master, () => {
          this.assertVoiceBuildCurrent(build!, generation, voice);
        });
        this.refreshGains();
        this.assertVoiceBuildCurrent(build, generation, voice);
      } catch (error) {
        // Registration and route construction are one transaction. A failed
        // connect must not leave a phantom voice in the mixer.
        if (this.voices.get(id) === voice) {
          this.voices.delete(id);
          this.voiceOrder = this.voiceOrder.filter((voiceId) => voiceId !== id);
        }
        this.unwireVoice(voice);
        throw error;
      } finally {
        if (build !== undefined) this.endAudioBuild(build);
      }
    }
  }

  removeVoice(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.markVoiceMutation();
    this.voices.delete(id);
    this.voiceOrder = this.voiceOrder.filter((voiceId) => voiceId !== id);
    const time = this.currentAudio()?.context.currentTime ?? 0;
    for (const note of [...this.activeNotes.values()]) {
      if (note.voice === voice) this.releaseNote(note, time);
    }
    this.disposeVoice(voice);
  }

  hasVoice(id: string): boolean {
    return this.voices.has(id);
  }

  listVoices(): string[] {
    return [...this.voiceOrder];
  }

  setVoiceVolume(id: string, volume: number): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.volume = clamp01(volume);
    this.refreshGains();
  }

  muteVoice(id: string, muted: boolean): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.muted = muted;
    this.refreshGains();
  }

  soloVoice(id: string, solo: boolean): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.solo = solo;
    this.refreshGains();
  }

  setMasterVolume(volume: number): void {
    const normalized = clamp01(volume);
    const audio = this.currentAudio();
    if (audio) audio.master.gain.value = normalized;
    this.options.masterVolume = normalized;
  }

  setMix(mix: Record<string, number>): void {
    for (const [id, volume] of Object.entries(mix)) {
      const voice = this.voices.get(id);
      if (voice) voice.volume = clamp01(volume);
    }
    this.refreshGains();
  }

  /** Create audio only when at least one voice exists; stay safe in SSR/tests. */
  ensureForPlayback(): {context: AudioContext; master: GainNode} | null {
    if (this.voices.size === 0) return null;
    try {
      return this.ensureAudio();
    } catch (error) {
      // SSR intentionally degrades to source/cursor-only operation, but a
      // real graph or Sound lifecycle failure must reach the caller instead
      // of becoming a silent no-audio player.
      if (error instanceof Error && error.message.startsWith('Web Audio is not available.')) {
        return null;
      }
      throw error;
    }
  }

  /** Build voice routes and await any optional Sound-like sample preparation. */
  async preload(): Promise<void> {
    for (;;) {
      if (this.disposed) throw new Error('InteractivePlayer has been disposed.');
      const audio = this.ensureForPlayback();
      if (!audio) return;
      await ensureContextRunning(audio.context, 'InteractivePlayer AudioContext');

      const generation = this.voiceGeneration;
      const voices = [...this.voices.values()];
      const preparation = Promise.allSettled(
        voices.map(async (voice) => {
          const preloadable = voice.synth as HeadlessSynth & {
            preload?: () => Promise<void>;
          };
          await preloadable.preload?.();
        }),
      );
      const mutation = this.waitForVoiceMutation(generation);
      const outcome = await Promise.race([
        preparation.then((results) => ({kind: 'prepared' as const, results})),
        mutation.promise.then(() => ({kind: 'mutated' as const})),
      ]);
      mutation.cancel();
      if (outcome.kind === 'mutated') continue;
      const {results} = outcome;

      if (this.disposed) throw new Error('InteractivePlayer has been disposed.');
      await ensureContextRunning(audio.context, 'InteractivePlayer AudioContext');
      const graphChanged =
        generation !== this.voiceGeneration ||
        voices.some((voice) => this.voices.get(voice.id) !== voice);
      if (graphChanged) continue;

      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (rejected) throw rejected.reason;
      return;
    }
  }

  fire(
    voiceId: string | undefined,
    midi: number,
    velocity: number,
    when: number,
    durationSeconds: number,
  ): void {
    if (!voiceId) return;
    const voice = this.voices.get(voiceId);
    const audio = this.currentAudio();
    if (!voice || !audio) return;

    if (audio.context.state !== 'running') {
      throw new Error(
        `AudioContext is ${audio.context.state} and cannot play synchronously. ` +
          'Await InteractivePlayer.preload() before synchronous note playback.',
      );
    }

    const note: ActiveInteractiveNote = {
      id: this.nextActiveNoteId++,
      voiceId,
      midi,
      handle: undefined,
      unconfirmedAttack: true,
      attackInFlight: true,
      voice,
      onsetTime: when,
    };
    // Adopt compensation ownership before invoking third-party code. A synth
    // may start its voice and then throw; post-call bookkeeping would lose the
    // only record that allNotesOff()/dispose() can retry.
    this.activeNotes.set(note.id, note);
    try {
      note.handle = voice.synth.noteOn(midi, velocity, when, durationSeconds);
      note.attackInFlight = false;
      note.unconfirmedAttack = false;
    } catch (error) {
      note.attackInFlight = false;
      // releaseNote keeps the record when every compensation path fails. It
      // contains cleanup errors through operationError while the original
      // noteOn exception remains the public failure.
      this.releaseNote(note, audio.context.currentTime, when, false);
      throw error;
    }

    // Reentrant removeVoice()/dispose() may already have released this exact
    // intent while noteOn was on the stack. Never publish events or arm a
    // second release for a record no longer owned by the mixer.
    if (!this.activeNotes.has(note.id)) {
      // A reentrant owner may have released its provisional record before the
      // backend returned, then the backend committed a new exact handle later
      // in the same noteOn call. Conservatively retract that returned attack.
      this.releaseReturnedAttack(
        voice.synth,
        note.handle,
        midi,
        audio.context.currentTime,
        when,
      );
      return;
    }
    if (this.disposed || this.voices.get(voiceId) !== voice) {
      this.releaseNote(note, audio.context.currentTime, when, false);
      return;
    }

    // Arm release before notifying application listeners. Event callbacks are
    // outside the mixer lifecycle and must not be able to strand this voice.
    this.armRelease(note, when + durationSeconds);
    this.callbacks.onNoteOn({voice: voiceId, midi, velocity, time: when});
    this.callbacks.onCapture(voiceId, midi, velocity, when, durationSeconds);
  }

  noteOff(voiceId: string, midi: number): void {
    const audio = this.currentAudio();
    const voice = this.voices.get(voiceId);
    if (!voice || !audio) return;
    const note = [...this.activeNotes.values()].find(
      (active) => active.voiceId === voiceId && active.midi === midi,
    );
    if (note) {
      // Match one concrete attack rather than cutting every overlapping C4.
      this.releaseNote(note, audio.context.currentTime);
      return;
    }
    if (voice.synth.noteOff) {
      this.tryBackendCall('noteOff', () => {
        voice.synth.noteOff!(midi, audio.context.currentTime);
      });
    }
    this.callbacks.onNoteOff({voice: voiceId, midi, time: audio.context.currentTime});
  }

  allNotesOff(): void {
    const audio = this.currentAudio();
    const time = audio?.context.currentTime ?? 0;
    for (const note of [...this.activeNotes.values()]) this.releaseNote(note, time);
    // Each release clears its own timer. A noteOff observer may create a new
    // note, whose release belongs to that newer command and must survive.
  }

  private armRelease(note: ActiveInteractiveNote, offTime: number): void {
    if (!this.activeNotes.has(note.id)) return;
    const context = this.currentAudio()?.context;
    const delay = context && context.state !== 'running'
      ? 50
      : Math.max(0, (offTime - (context?.currentTime ?? offTime)) * 1000);
    const timer = setTimeout(() => {
      this.offTimers.delete(timer);
      if (note.offTimer !== timer) return;
      note.offTimer = undefined;
      const current = this.currentAudio()?.context;
      if (current && current.state !== 'closed' && current.currentTime < offTime) {
        this.armRelease(note, offTime);
        return;
      }
      this.releaseNote(note, current?.currentTime ?? offTime, offTime);
    }, delay);
    note.offTimer = timer;
    this.offTimers.add(timer);
  }

  dispose(): Promise<void> | undefined {
    if (this.disposed) {
      // A prior teardown may have retained ambiguous releases. Repeated
      // disposal is an explicit retry boundary even though graph ownership is
      // already terminal.
      this.allNotesOff();
      return this.disposeSettlement;
    }
    this.disposed = true;
    this.markVoiceMutation();
    const voices = [...this.voices.values()];
    this.voices.clear();
    this.voiceOrder = [];
    this.allNotesOff();
    for (const voice of voices) this.disposeVoice(voice);
    if (this.effectDispose) {
      this.tryBackendCall('effect.dispose', this.effectDispose);
    }
    if (this.masterGain) {
      this.tryBackendCall('master.disconnect', () => this.masterGain!.disconnect());
    }
    this.effectDispose = undefined;
    const context = this.contextValue;
    const ownsContext = this.ownsContext;
    this.ownsContext = false;
    this.contextValue = undefined;
    this.masterGain = undefined;
    if (ownsContext && context) {
      try {
        const closing = context.close?.();
        if (!closing) return undefined;
        this.disposeSettlement = Promise.resolve(closing).catch((error: unknown) => {
          this.reportOperationError('context.close', error);
        });
        return this.disposeSettlement;
      } catch (error) {
        this.reportOperationError('context.close', error);
      }
    }
    return undefined;
  }

  private ensureAudio(): {context: AudioContext; master: GainNode} {
    if (this.disposed) throw new Error('InteractivePlayer has been disposed.');
    if (this.contextValue && this.masterGain) {
      return {context: this.contextValue, master: this.masterGain};
    }
    const generation = this.voiceGeneration;
    const voices = [...this.voices.values()];
    const build = this.beginAudioBuild();
    let context: AudioContext | undefined;
    let destination: AudioNode | undefined;
    let ownsContext = false;
    let master: GainNode | undefined;
    let effectDispose: (() => void) | undefined;
    const wired: InteractiveVoice[] = [];
    try {
      const resolved = resolveAudioGraphContext(
        this.options.audioContext,
        this.options.destination,
      );
      context = resolved.context;
      destination = resolved.destination;
      ownsContext = resolved.ownsContext;
      this.assertAudioBuildCurrent(build, generation);

      master = context.createGain();
      master.gain.value = this.options.masterVolume ?? 1;
      this.assertAudioBuildCurrent(build, generation);
      const effect = resolveEffect(this.options.effect, this.options.reverb);
      effectDispose = insertEffect(context, master, destination, effect).dispose;
      this.assertAudioBuildCurrent(build, generation);
      for (const voice of voices) {
        this.assertVoiceBuildCurrent(build, generation, voice);
        this.wireVoice(voice, context, master, () => {
          this.assertVoiceBuildCurrent(build, generation, voice);
        });
        if (voice.gain) wired.push(voice);
      }
      this.refreshGains();
      this.assertAudioBuildCurrent(build, generation);

      this.ownsContext = ownsContext;
      this.effectDispose = effectDispose;
      this.contextValue = context;
      this.masterGain = master;
      return {context, master};
    } catch (error) {
      for (const voice of wired.reverse()) this.unwireVoice(voice);
      if (effectDispose) this.tryBackendCall('failed effect.dispose', effectDispose);
      if (master) {
        this.tryBackendCall('failed master.disconnect', () => master!.disconnect());
      }
      if (ownsContext && context) this.closeContext(context, 'failed context.close');
      throw error;
    } finally {
      this.endAudioBuild(build);
    }
  }

  private currentAudio(): {context: AudioContext; master: GainNode} | null {
    if (this.contextValue && this.masterGain) {
      return {context: this.contextValue, master: this.masterGain};
    }
    return null;
  }

  private wireVoice(
    voice: InteractiveVoice,
    context: AudioContext,
    master: GainNode,
    assertCurrent: () => void,
  ): void {
    if (voice.gain) return;
    const gain = context.createGain();
    let gainRouteAttempted = false;
    let effectOutputRouteAttempted = false;
    let effectNode: EffectNode | undefined;
    let routeCleanup: (() => void) | undefined;
    try {
      gainRouteAttempted = true;
      gain.connect(master);
      assertCurrent();

      if (!voice.synth.connect) {
        // A self-routed structural backend does not participate in the mixer
        // graph; retain the historic behavior without publishing a dead gain.
        this.tryBackendCall('unused voice gain.disconnect', () => gain.disconnect(master));
        return;
      }

      let synthDestination: AudioNode = gain;
      if (voice.effect) {
        effectNode = voice.effect.build(context);
        assertCurrent();
        // Complete the owned effect-to-gain edge before invoking the arbitrary
        // synth connect hook, so no fallible graph mutation follows a backend
        // route that may not provide exact cleanup.
        effectOutputRouteAttempted = true;
        effectNode.output.connect(gain);
        assertCurrent();
        synthDestination = effectNode.input;
      }

      const route = voice.synth.connect(synthDestination);
      routeCleanup = typeof route === 'function' ? route : undefined;
      assertCurrent();

      // Publish only after the complete local graph and identity gate succeed.
      voice.gain = gain;
      voice.effectNode = effectNode;
      voice.routeCleanup = routeCleanup;
    } catch (error) {
      if (routeCleanup) this.tryBackendCall('failed synth route cleanup', routeCleanup);
      if (effectOutputRouteAttempted && effectNode) {
        this.tryBackendCall('failed voice effect output.disconnect', () => {
          effectNode!.output.disconnect(gain);
        });
      }
      if (effectNode) {
        this.tryBackendCall('failed voice effect input.disconnect', () => effectNode!.input.disconnect());
        if (effectNode.dispose) {
          this.tryBackendCall('failed voice effect.dispose', () => effectNode!.dispose!());
        }
      }
      if (gainRouteAttempted) {
        this.tryBackendCall('failed voice gain.disconnect', () => gain.disconnect(master));
      }
      throw error;
    }
  }

  private refreshGains(): void {
    const anySolo = [...this.voices.values()].some((voice) => voice.solo);
    for (const voice of this.voices.values()) {
      if (!voice.gain) continue;
      const gate = voice.muted || (anySolo && !voice.solo) ? 0 : 1;
      voice.gain.gain.value = voice.volume * gate;
    }
  }

  private releaseNote(
    note: ActiveInteractiveNote,
    synthTime: number,
    eventTime = synthTime,
    emitEvent = true,
  ): boolean {
    if (!this.activeNotes.has(note.id)) return true;
    if (note.releasing) return false;
    note.releasing = true;
    try {
      if (note.offTimer) {
        clearTimeout(note.offTimer);
        this.offTimers.delete(note.offTimer);
        note.offTimer = undefined;
      }

      const voice = note.voice;
      const sameMidiStillActive = [...this.activeNotes.values()].some(
        (active) => active.id !== note.id && active.voice === voice && active.midi === note.midi,
      );
      let released = false;
      let releaseAttempted = false;
      if (
        synthTime <= note.onsetTime &&
        note.handle != null &&
        voice.synth.supportsScheduledCancellation === true &&
        voice.synth.cancelScheduledNote
      ) {
        releaseAttempted = true;
        released = this.tryBackendCall('cancelScheduledNote', () => {
          voice.synth.cancelScheduledNote!(note.handle, synthTime);
        });
      }
      if (
        !released &&
        note.handle != null &&
        voice.synth.noteOffById
      ) {
        releaseAttempted = true;
        released = this.tryBackendCall('noteOffById', () => {
          voice.synth.noteOffById!(note.handle, synthTime);
        });
      }
      if (!released && !sameMidiStillActive && voice.synth.noteOff) {
        // Legacy synths can only release by pitch. Keep an overlapping pitch
        // alive until its final instance ends instead of truncating it early.
        releaseAttempted = true;
        released = this.tryBackendCall('noteOff', () => {
          voice.synth.noteOff!(note.midi, synthTime);
        });
      }
      if (!released && !releaseAttempted && !note.unconfirmedAttack) {
        // Either this backend is duration-self-managed, or a pitch-only attack
        // shares its release with a later overlapping gate. Both are clean
        // logical releases; an unconfirmed commit-then-throw attack never takes
        // this path because it still requires concrete compensation.
        released = true;
      }
      if (!released || note.attackInFlight) return false;

      this.activeNotes.delete(note.id);
      if (emitEvent) {
        this.callbacks.onNoteOff({voice: note.voiceId, midi: note.midi, time: eventTime});
      }
      return true;
    } finally {
      note.releasing = false;
    }
  }

  private disposeVoice(voice: InteractiveVoice): void {
    if (voice.disposed) return;
    voice.disposed = true;
    this.unwireVoice(voice);
    if (voice.synthOwnership === 'owned') {
      if (voice.synth.dispose) {
        this.tryBackendCall('synth.dispose', () => voice.synth.dispose!());
      } else if (voice.synth.disconnect) {
        this.tryBackendCall('synth.disconnect', () => voice.synth.disconnect!());
      }
    }
  }

  /** Remove one voice route without disposing its reusable synth. */
  private unwireVoice(voice: InteractiveVoice): void {
    const routeCleanup = voice.routeCleanup;
    const effectNode = voice.effectNode;
    const gain = voice.gain;
    voice.routeCleanup = undefined;
    voice.effectNode = undefined;
    voice.gain = undefined;
    if (routeCleanup) this.tryBackendCall('synth route cleanup', routeCleanup);
    if (effectNode) {
      this.tryBackendCall('voice effect output.disconnect', () => effectNode.output.disconnect());
      this.tryBackendCall('voice effect input.disconnect', () => effectNode.input.disconnect());
      if (effectNode.dispose) {
        this.tryBackendCall('voice effect.dispose', () => effectNode.dispose!());
      }
    }
    if (gain) this.tryBackendCall('voice gain.disconnect', () => gain.disconnect());
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

  private releaseReturnedAttack(
    synth: HeadlessSynth,
    handle: unknown,
    midi: number,
    time: number,
    onsetTime: number,
  ): void {
    if (
      time <= onsetTime &&
      handle != null &&
      synth.supportsScheduledCancellation === true &&
      synth.cancelScheduledNote &&
      this.tryBackendCall('cancelScheduledNote', () => {
        synth.cancelScheduledNote!(handle, time);
      })
    ) {
      return;
    }
    if (
      handle != null &&
      synth.noteOffById &&
      this.tryBackendCall('noteOffById', () => synth.noteOffById!(handle, time))
    ) {
      return;
    }
    if (synth.noteOff) {
      this.tryBackendCall('noteOff', () => synth.noteOff!(midi, time));
    }
  }

  private tryBackendCall(operation: string, callback: () => unknown): boolean {
    try {
      callback();
      return true;
    } catch (error) {
      this.reportOperationError(operation, error);
      return false;
    }
  }

  private reportOperationError(operation: string, error: unknown): void {
    if (this.callbacks.onOperationError) {
      this.callbacks.onOperationError(operation, error);
      return;
    }
    reportPlaybackOperationFailure('InteractivePlayer', operation, error);
  }

  private beginAudioBuild(): number {
    if (this.activeAudioBuild !== undefined) {
      throw new Error('InteractivePlayer audio graph construction cannot be re-entered.');
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
      this.voiceGeneration !== generation
    ) {
      throw new Error('InteractivePlayer voices changed during audio graph construction.');
    }
  }

  private assertVoiceBuildCurrent(
    build: number,
    generation: number,
    voice: InteractiveVoice,
  ): void {
    this.assertAudioBuildCurrent(build, generation);
    if (voice.disposed || this.voices.get(voice.id) !== voice) {
      throw new Error(`Interactive voice "${voice.id}" changed during audio graph construction.`);
    }
  }

  private markVoiceMutation(): void {
    this.voiceGeneration += 1;
    const waiters = [...this.voiceMutationWaiters];
    this.voiceMutationWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  private waitForVoiceMutation(generation: number): {
    promise: Promise<void>;
    cancel: () => void;
  } {
    if (generation !== this.voiceGeneration) {
      return {promise: Promise.resolve(), cancel: () => undefined};
    }
    let waiter: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      waiter = resolve;
      this.voiceMutationWaiters.add(resolve);
    });
    return {
      promise,
      cancel: () => {
        if (waiter) this.voiceMutationWaiters.delete(waiter);
      },
    };
  }
}

async function ensureContextRunning(context: AudioContext, label: string): Promise<void> {
  assertLiveAudioContext(context, label);
  if (context.state !== 'running') await context.resume();
  assertLiveAudioContext(context, label);
  if (context.state !== 'running') {
    throw new Error(`${label} is ${context.state} and cannot drive live playback.`);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
