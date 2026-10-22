import {noteMidi, noteOnsetSeconds, type Note, type Score, type ScorePlaybackReadiness, type ScorePlaybackSource} from '../../core';
import {PlaybackPublisher} from '../headless/playback-source';
// Type-only: the four-format parser stack (and its XML / zip / MIDI / ABC
// dependencies) is pulled in on demand from resolveScore(), the way every
// other consumer in the package reaches io. A value import here would land
// the whole thing in the /play/element, /play/auto and minified /play/global
// graphs for every caller, including those that only ever set `.score`.
import type {ScoreFormat} from '../../io/load';
import type {HeadlessSynth} from '../headless/audio-contracts';
import type {PlayerController} from '../headless/controller';
import {createSoundfontSynth} from '../headless/soundfont-synth';
import {
  mountControllerPlayer,
  mountPresetPlayer,
  mountRackPlayer,
  type ControllerPlayerOptions,
  type PresetPlayerHandle,
  type PresetPlayerOptions,
  type RackPlayerOptions,
  type TimeControl,
  type VolumeControl,
} from './internal/preset-player';
import type {Rack} from '../headless/rack';
import type {Effect} from '../headless/effects';
import {boolAttr, numAttr, WebMusicElement, upgradeProperties} from './internal/base';
import {RACK_DESK_TAG, RACK_SHARE_EVENT} from './internal/rack-part';
import {isModularComposition, observeModuleContext, provideModuleContext, notifyModuleContext, notifyModuleChange} from '@webmusic/kernel/element';
import {ModuleAudioEnvironment, ModuleContext, sameModuleScope, type ModuleHandle} from '@webmusic/kernel/module';
import {SessionTransport} from '@webmusic/kernel/session';
import {ScorePlayerModule} from '../headless/score-module';
import {mountModuleTransport, setModuleTransportVisibility} from './internal/module-transport';
import {createModuleSoundfont} from './internal/lazy-module-soundfont';

let nextElementModuleId = 0;

/**
 * Detail payload for the DOM events a `<score-player>` dispatches. View
 * elements (e.g. `<simple-staff>`) listen for these to highlight the active
 * note, so the contract is a plain object — no cross-package import coupling.
 */
export interface ScorePlayerNoteEventDetail {
  /** MIDI note number. */
  midi: number;
  /** Onset of the note in seconds (matches the visualizer note's startTime). */
  startTime: number;
}

/**
 * Detail payload for the `webscore:timeupdate` DOM event.
 *
 * The element deliberately reports both score and transport coordinates: score
 * consumers (such as analyzers) need nominal timing, while progress controls
 * need the rate-scaled transport clock. New listeners should use the explicit
 * fields rather than the compatibility aliases.
 */
export interface ScorePlayerTimeUpdateEventDetail {
  /** Position on the unscaled score timeline, in nominal score seconds. */
  nominalSeconds: number;
  /** Position on the current rate-scaled transport timeline, in real seconds. */
  transportSeconds: number;
  /** Total current rate-scaled transport duration, in real seconds. */
  transportDurationSeconds: number;
  /** `transportSeconds / transportDurationSeconds`, clamped to `[0, 1]`. */
  progress: number;
  /** Actual current playback rate. */
  rate?: number;
  /** Whether the mounted score engine is playing. */
  playing?: boolean;
  /**
   * @deprecated Compatibility alias for `nominalSeconds`. It must not be
   * combined with `duration`, which is in the transport domain.
   */
  seconds: number;
  /** @deprecated Compatibility alias for `transportDurationSeconds`. */
  duration: number;
}

/** Snapshot of the native single-score engine; borrowed Rack/controller modes omit it. */
export interface ScorePlayerPlaybackSnapshot extends ScorePlayerTimeUpdateEventDetail {
  rate: number;
  playing: boolean;
  /** Held occurrences, including equal pitches from different score notes. */
  activeNotes: ReadonlyArray<ScorePlayerNoteEventDetail>;
}

/**
 * `<score-player>` — a self-contained transport widget.
 *
 * ```html
 * <score-player src="song.mid"></score-player>
 * <score-player src="song.musicxml" format="musicxml"></score-player>
 * <score-player src="song.mid" sound-font="https://cdn/{midi}.mp3"></score-player>
 * <score-player src="song.mid" volume="0.5" rate="0.8" pan="-1" loop></score-player>
 * ```
 *
 * `volume` / `rate` / `pan` / `loop` apply live, without rebuilding the player.
 * Each one is seeded from its attribute until the matching property is
 * assigned; from then on the property wins and the attribute is ignored.
 *
 * `time-control` adds the clock — `simple` for the elapsed time alone, `full`
 * for `elapsed / total` — and `volume-control` adds a volume control as either
 * a `fader` or a `knob`. Both default to `off` and both change in place;
 * `volume-control` needs the element's own engine, so it is inert in `.rack`
 * and `.controller` mode.
 *
 * All scheduling and audio run through this package's `ScorePlayer` engine (via
 * `mountPresetPlayer`); this element only loads the score and reflects
 * attributes. A `Score` can also be assigned directly via the `.score` property.
 *
 * The same chrome can also drive playback the element does not own: assign a
 * Headless {@link PlayerController} to `.controller` and the element renders
 * play/seek bound to it — no score is loaded and the caller keeps the
 * controller (and its player) alive.
 */
export class ScorePlayerElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return [
      'src',
      'format',
      'sound-font',
      'volume',
      'rate',
      'pan',
      'loop',
      'time-control',
      'volume-control',
      'composition',
      'session',
      'controls',
    ];
  }

  private handle?: PresetPlayerHandle;
  private explicitScore?: Score;
  private mountedScore?: Score;
  private readonly activeNotes = new Map<Note, ScorePlayerNoteEventDetail>();
  private explicitRack?: Rack;
  private externalController?: PlayerController;
  private explicitSound?: HeadlessSynth;
  private explicitEffect?: Effect;
  private explicitContext?: AudioContext;
  private explicitDestination?: AudioNode;
  private rateValue = 1;
  private volumeValue = 1;
  /** The rack announced by a `<score-rack-control>` written inside this element. */
  private composedRack?: Rack;
  private rackObserver?: MutationObserver;
  /** Where a rack transport is mounted, so it cannot replace the desk below it. */
  private rackHost?: HTMLElement;
  private panValue = 0;
  private loopOn = false;
  // Assigning one of the four live knobs as a property pins it: the attribute
  // seeds the value declaratively, but an imperative set is the caller's final
  // word and a later attribute change must not silently undo it. This is the
  // rule `sound-font` already follows for `.sound`.
  private pinnedRate = false;
  private pinnedVolume = false;
  private pinnedPan = false;
  private pinnedLoop = false;
  private loadToken = 0;
  private renderRequest = 0;
  private loadController?: AbortController;
  // Sound-font synth cache: one AudioContext per element, reused across renders
  // instead of leaking a fresh context every attribute change.
  private ownedContext?: AudioContext;
  private ownedSynth?: HeadlessSynth;
  private ownedSynthContext?: AudioContext;
  private ownedTemplate?: string;
  private playbackReadiness: ScorePlaybackReadiness = 'empty';
  private sourceRevision = 0;
  private playbackError?: unknown;
  private modular = false;
  private readonly moduleId = `score-player-module-${++nextElementModuleId}`;
  private moduleContext?: ModuleContext;
  private moduleUpstream?: ModuleContext;
  private moduleSource?: ScorePlayerModule;
  private moduleAudio?: ModuleAudioEnvironment;
  private ownedSession?: SessionTransport;
  private moduleUnsubscribe?: () => void;
  private moduleSessionUnsubscribe?: () => void;
  private modulePendingSource?: ReturnType<SessionTransport['holdPendingSource']>;
  private readonly moduleListeners = new Set<() => void>();
  private readonly moduleFacade: ModuleHandle = (() => {
    const source = () => this.moduleSource;
    return {
    id: this.moduleId,
    get params() { return source()?.params; },
    get inserts() { return source()?.inserts; },
    get capabilities() { return source()?.capabilities; },
    getPort: (name) => this.moduleSource?.getPort(name),
    prepare: () => this.moduleSource?.prepare(),
    subscribe: (listener) => {
      this.moduleListeners.add(listener);
      return () => this.moduleListeners.delete(listener);
    },
    };
  })();
  private unbindPlayback?: () => void;
  private readonly playbackPublisher = new PlaybackPublisher(() => {
    const native = this.handle?.player?.playback?.snapshot();
    return {
      sourceRevision: this.sourceRevision,
      readiness: this.playbackReadiness,
      state: native?.state ?? 'stopped',
      score: native?.score,
      nominalSeconds: native?.nominalSeconds ?? null,
      nominalDurationSeconds: native?.nominalDurationSeconds ?? null,
      transportSeconds: native?.transportSeconds ?? null,
      transportDurationSeconds: native?.transportDurationSeconds ?? null,
      rate: native?.rate ?? null,
      activeNotes: native?.activeNotes ?? Object.freeze([]),
      error: this.playbackError,
    };
  }, (seconds) => {
    if (this.modular) return this.seekNominal(seconds);
    const source = this.handle?.player?.playback;
    if (!source?.seekNominal) return Promise.reject(new Error('Native score playback is unavailable.'));
    return source.seekNominal(seconds);
  });

  /** Stable borrowed source; controller/rack modes explicitly report unavailable. */
  get playback(): ScorePlaybackSource {
    return this.playbackPublisher;
  }

  get module(): ModuleHandle | undefined {
    return this.modular && this.moduleContext ? this.moduleFacade : undefined;
  }

  /** Borrow the current command authority without preparing audio. */
  get sessionTransport(): SessionTransport | undefined {
    return this.moduleContext?.session;
  }

  override disconnectedCallback(): void {
    if (!this.modular) { super.disconnectedCallback(); return; }
    // A synchronous layout move keeps the engine and Session registration.
    queueMicrotask(() => { if (!this.isConnected) super.disconnectedCallback(); });
  }

  protected override onMount(): void {
    this.modular = isModularComposition(this);
    if (this.modular) { this.mountModularComposition(); return; }
    // Register lifetime teardown before property upgrades or mounts: an
    // inherited setter/hook may fail, but a partial player/load must not leak.
    this.own(() => this.teardown());
    // A `<score-rack-control>` written inside this element announces its rack upward;
    // this is also PULLED below, because whichever of the two upgraded first
    // decides which half of that exchange happened at all.
    this.addEventListener(RACK_SHARE_EVENT, this.onRackShared);
    this.own(() => this.removeEventListener(RACK_SHARE_EVENT, this.onRackShared));
    this.own(() => { this.rackHost?.remove(); this.rackHost = undefined; });
    this.adoptComposedRack();
    if (typeof MutationObserver !== 'undefined') {
      this.rackObserver = new MutationObserver(() => {
        if (this.isConnected && this.adoptComposedRack() && !this.explicitRack && !this.externalController) this.requestRender();
      });
      this.rackObserver.observe(this, {childList: true, subtree: true});
      this.own(() => { this.rackObserver?.disconnect(); this.rackObserver = undefined; });
    }
    upgradeProperties(this, [
      'score',
      'rack',
      'controller',
      'sound',
      'effect',
      'audioContext',
      'destination',
      'rate',
      'volume',
      'pan',
      'loop',
    ]);
    // After the upgrade, so a property assigned before this element upgraded
    // still wins over the markup.
    this.syncKnobAttributes();
    this.requestRender();
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected) return;
    if (name === 'composition' || (name === 'session' && this.modular)) {
      super.disconnectedCallback();
      super.connectedCallback();
      return;
    }
    if (name === 'controls' && this.modular) {
      if (this.handle) setModuleTransportVisibility(this.handle.element, this.moduleControlsVisible);
      return;
    }
    // The live knobs apply in place. Re-rendering for them would tear the
    // player down and restart the piece just to change a volume.
    if (name === 'rate' || name === 'volume' || name === 'pan' || name === 'loop') {
      this.syncKnobAttributes(name);
      return;
    }
    // Chrome flags move visibility on the mounted transport. Re-rendering for
    // them would reload the source just to reveal a readout.
    if (name === 'time-control') {
      this.handle?.setChrome({time: this.timeControl});
      return;
    }
    if (name === 'volume-control') {
      this.handle?.setChrome({volume: this.volumeControl});
      return;
    }
    this.requestRender();
  }

  /** Assign a pre-loaded score programmatically (overrides `src`). */
  set score(score: Score | undefined) {
    this.explicitScore = score;
    if (this.isConnected) this.requestRender();
  }

  get score(): Score | undefined {
    return this.explicitScore;
  }

  /** The resolved score currently mounted for playback, including a loaded `src`. */
  get resolvedScore(): Score | undefined {
    return this.mountedScore;
  }

  /** Read the current native score transport without starting or allocating audio. */
  getPlaybackSnapshot(): ScorePlayerPlaybackSnapshot | undefined {
    const player = this.handle?.player;
    if (!player || !this.mountedScore) return undefined;
    const rate = player.rate ?? this.rateValue;
    const nominalSeconds = player.nominalSeconds ?? player.seconds * rate;
    return {
      nominalSeconds,
      transportSeconds: player.seconds,
      transportDurationSeconds: player.durationSeconds,
      progress: player.progress,
      seconds: nominalSeconds,
      duration: player.durationSeconds,
      rate,
      playing: player.isPlaying?.() ?? this.handle?.isPlaying() ?? false,
      activeNotes: [...this.activeNotes.values()],
    };
  }

  /**
   * Drive a whole {@link Rack} instead of a single score — the play head moves
   * every member in lockstep and the progress bar follows the longest one. The
   * same `Rack` instance can be wired to a `<score-rack-control>` mixer, so the two
   * elements stay in sync through the shared rack. Overrides `score` / `src`.
   */
  set rack(rack: Rack | undefined) {
    this.explicitRack = rack;
    if (this.isConnected) this.requestRender();
  }

  get rack(): Rack | undefined {
    return this.explicitRack;
  }

  /**
   * Drive an existing Headless {@link PlayerController} instead of owning
   * playback: the element renders its play/seek chrome bound to the borrowed
   * controller and never loads a score. Takes precedence over `rack`, `score`
   * and `src`. The caller owns the controller's lifetime — disconnecting the
   * element (or clearing this property) only unmounts the UI. Transport state
   * is never pushed onto the controller at mount; `rate`, `volume`, `pan` and
   * `loop` stay with the controller's owner (setting `.rate` delegates live to
   * `controller.setRate()`, the others are inert in this mode).
   */
  set controller(controller: PlayerController | undefined) {
    this.externalController = controller;
    if (this.isConnected) this.requestRender();
  }

  get controller(): PlayerController | undefined {
    return this.externalController;
  }

  /** Assign a timbre (Sound / HeadlessSynth) — overrides the `sound-font` attribute. */
  set sound(sound: HeadlessSynth | undefined) {
    this.explicitSound = sound;
    if (this.isConnected) this.requestRender();
  }

  get sound(): HeadlessSynth | undefined {
    return this.explicitSound;
  }

  /** Assign a post-processing effect chain. */
  set effect(effect: Effect | undefined) {
    (this.moduleSource?.player ?? this.handle?.player)?.setEffect(effect);
    this.explicitEffect = effect;
  }

  get effect(): Effect | undefined {
    return this.explicitEffect;
  }

  /** Share an existing AudioContext (e.g. so the player and an analyser agree on one). */
  set audioContext(context: AudioContext | undefined) {
    this.setAudioConfiguration(context, this.explicitDestination);
  }

  get audioContext(): AudioContext | undefined {
    return this.explicitContext;
  }

  /** Route the player's output into this node (e.g. an analyser or effect input). */
  set destination(node: AudioNode | undefined) {
    this.setAudioConfiguration(this.explicitContext, node);
  }

  get destination(): AudioNode | undefined {
    return this.explicitDestination;
  }

  private setAudioConfiguration(context: AudioContext | undefined, destination: AudioNode | undefined): void {
    const modular = this.modular || isModularComposition(this);
    const selected = context ?? destination?.context;
    if (modular) {
      if (context && destination && destination.context !== context) throw new Error('Destination must use the same AudioContext.');
      if (selected?.state === 'closed') throw new Error('Module audio context is closed.');
      const borrowed = !this.moduleAudio ? this.moduleContext?.audio.peek() : undefined;
      if (selected && borrowed && selected !== borrowed) throw new Error('A module must use its provider AudioContext.');
    }
    const previous = this.explicitContext ?? this.explicitDestination?.context;
    const routeChanged = destination !== this.explicitDestination;
    this.explicitContext = context;
    this.explicitDestination = destination;
    if (!this.isConnected) return;
    if (this.modular && this.moduleAudio && this.moduleContext) {
      if (selected !== this.moduleAudio.peek() && (selected || previous)) {
        // A new reference clock requires a fresh, paused Session and scope.
        // Validation above happens before releasing the working owner.
        this.bindModularContext(undefined, 'missing');
        return;
      }
      if (routeChanged) {
        // A new resolver identity revokes descendant default routes as well.
        this.moduleContext = new ModuleContext({
          id: `${this.moduleId}:context`, audio: this.moduleAudio,
          registry: this.moduleContext.registry, session: this.moduleContext.session,
          destination: () => this.explicitDestination, target: this.moduleFacade,
        });
        notifyModuleContext(this);
      }
    }
    this.requestRender();
  }

  /** Playback rate (1 = normal). Applies live. */
  set rate(rate: number) {
    this.pinnedRate = true;
    this.setRateValue(rate, true);
  }
  get rate(): number {
    if (this.modular) return this.moduleContext?.session?.snapshot.rate ?? this.rateValue;
    return this.externalController?.rate ?? this.handle?.player?.rate ?? this.rateValue;
  }

  /** Master volume (linear, 1 = unchanged). Applies live. */
  set volume(volume: number) {
    this.pinnedVolume = true;
    this.setVolumeValue(volume);
  }
  get volume(): number {
    return this.volumeValue;
  }

  /** Stereo pan (-1 left … 0 centre … +1 right). Applies live. */
  set pan(pan: number) {
    this.pinnedPan = true;
    this.setPanValue(pan);
  }
  get pan(): number {
    return this.panValue;
  }

  /** Loop the whole piece. Applies live. */
  set loop(on: boolean) {
    this.pinnedLoop = true;
    this.setLoopValue(!!on);
  }
  get loop(): boolean {
    return this.loopOn;
  }

  /**
   * The clock the chrome should carry. An unrecognized word reads as `off`
   * rather than throwing: an attribute is authored by hand, and a typo should
   * leave the player working with no readout, not break the mount.
   */
  private get timeControl(): TimeControl {
    const raw = this.getAttribute('time-control');
    return raw === 'simple' || raw === 'full' ? raw : 'off';
  }

  /** The volume control the chrome should carry, on the same terms. */
  private get volumeControl(): VolumeControl {
    const raw = this.getAttribute('volume-control');
    return raw === 'fader' || raw === 'knob' ? raw : 'off';
  }

  /**
   * Seed the live knobs from their attributes, skipping every one whose
   * property has already been assigned. Called once per mount and again for
   * the single attribute that changed.
   */
  private syncKnobAttributes(name?: string): void {
    const wanted = (knob: string) => name === undefined || name === knob;
    if (!this.pinnedRate && wanted('rate')) this.setRateValue(numAttr(this, 'rate', 1), false);
    if (!this.pinnedVolume && wanted('volume')) this.setVolumeValue(numAttr(this, 'volume', 1));
    if (!this.pinnedPan && wanted('pan')) this.setPanValue(numAttr(this, 'pan', 0));
    if (!this.pinnedLoop && wanted('loop')) this.setLoopValue(boolAttr(this, 'loop'));
  }

  // The clamping seams the property setters and the attribute sync share. They
  // never touch the pins, so an attribute can reach them without pinning.
  private setRateValue(rate: number, explicit = false): void {
    this.rateValue = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.applyRate(explicit);
  }

  private setVolumeValue(volume: number): void {
    this.volumeValue = Math.max(0, volume);
    (this.moduleSource?.player ?? this.handle?.player)?.setVolume(this.volumeValue);
  }

  private setPanValue(pan: number): void {
    this.panValue = Math.max(-1, Math.min(1, pan));
    (this.moduleSource?.player ?? this.handle?.player)?.setPan(this.panValue);
  }

  private setLoopValue(on: boolean): void {
    this.loopOn = on;
    this.applyLoop();
  }

  private applyRate(explicit: boolean): void {
    if (this.modular && this.moduleContext?.session) {
      if (explicit || this.ownedSession) void this.moduleContext.session.setRate(this.rateValue).catch((error) => this.reportPlaybackError(error));
      return;
    }
    // A borrowed controller owns its transport; only an explicit `.rate` set
    // reaches it (render() never re-pushes stored state onto it).
    if (this.externalController) {
      if (explicit) this.externalController.setRate(this.rateValue);
      return;
    }
    this.handle?.player?.setRate(this.rateValue);
    this.emitState();
  }

  private applyLoop(): void {
    if (this.modular) {
      if (!this.isConnected) return;
      const session = this.moduleContext?.session;
      if (!session || (!this.ownedSession && !this.pinnedLoop)) return;
      const duration = session.snapshot.durationSeconds;
      const loop = this.loopOn && duration !== null && Number.isFinite(duration) && duration > 0
        ? {startSeconds: 0, endSeconds: duration} : null;
      const current = session.snapshot.loop;
      if (current?.startSeconds === loop?.startSeconds && current?.endSeconds === loop?.endSeconds) return;
      void session.setLoop(loop).catch((error) => this.reportPlaybackError(error));
      return;
    }
    const player = this.handle?.player;
    if (!player) return;
    if (this.loopOn) player.setLoop(0, player.durationSeconds);
    else player.clearLoop();
  }

  play(): Promise<void> {
    if (this.modular) return this.moduleContext?.session?.play().then(() => undefined) ?? Promise.resolve();
    // A borrowed controller reports play() failures via its own 'error'
    // channel, so this resolves like any controller-initiated play.
    if (this.externalController) {
      this.externalController.play();
      return Promise.resolve();
    }
    return this.handle?.play() ?? Promise.resolve();
  }

  pause(): void {
    if (this.modular) { void this.moduleContext?.session?.pause().catch((error) => this.reportPlaybackError(error)); return; }
    if (this.externalController) {
      this.externalController.pause();
      return;
    }
    this.handle?.pause();
    this.emitState();
  }

  /** Stop and rewind to the start. */
  stop(): void {
    if (this.modular) { void this.moduleContext?.session?.stop().catch((error) => this.reportPlaybackError(error)); return; }
    if (this.externalController) {
      this.externalController.stop();
      return;
    }
    this.handle?.stop();
    this.activeNotes.clear();
    this.dispatchEvent(new CustomEvent('webscore:stop', {bubbles: true}));
    this.emitState();
  }

  /** Jump to a position in seconds (clamped to `[0, duration]`). */
  seek(seconds: number): void {
    if (this.modular) { void this.moduleContext?.session?.seek(seconds).catch((error) => this.reportPlaybackError(error, 'seek')); return; }
    if (this.externalController) {
      this.externalController.seek(seconds);
      return;
    }
    const handle = this.handle;
    const player = handle?.player;
    if (player) this.reportSeekFailure(player.seek(seconds), handle);
    else if (handle?.seek) this.reportSeekFailure(handle.seek(seconds), handle);
    else if (handle?.seekFraction) {
      this.reportSeekFailure(handle.seekFraction(this.duration > 0 ? seconds / this.duration : 0), handle);
    }
    if (handle !== this.handle || !this.isConnected) return;
    this.dispatchEvent(new CustomEvent('webscore:seek', {bubbles: true}));
    if (handle === this.handle && this.isConnected) this.emitState();
  }

  /** Seek in nominal score seconds; delegates to the existing transport. */
  seekNominal(seconds: number): Promise<void> {
    if (this.modular) {
      if (!this.moduleSource) return Promise.reject(new Error('This aggregate Session has no nominal score axis.'));
      return this.moduleContext?.session?.seek(seconds).then(() => undefined) ?? Promise.resolve();
    }
    if (this.externalController) {
      this.externalController.seek(seconds / this.externalController.rate);
      return Promise.resolve();
    }
    if (this.explicitRack || this.composedRack) {
      return Promise.reject(new Error('Rack has no single nominal score axis; use seek() or seekFraction().'));
    }
    const handle = this.handle;
    const pending = handle?.player ? handle.player.seekNominal(seconds)
      : Promise.resolve(handle?.seek?.(seconds / this.rateValue));
    if (handle !== this.handle || !this.isConnected) return pending;
    this.dispatchEvent(new CustomEvent('webscore:seek', {bubbles: true}));
    if (handle === this.handle && this.isConnected) this.emitState();
    return pending;
  }

  /** Jump to a fraction of the piece (`0` = start, `1` = end). */
  seekFraction(fraction: number): void {
    if (this.modular) { this.seek(Math.max(0, Math.min(1, fraction)) * this.duration); return; }
    if (this.externalController) {
      this.externalController.seekFraction(fraction);
      return;
    }
    const handle = this.handle;
    const player = handle?.player;
    if (player) this.reportSeekFailure(player.seekFraction(fraction), handle);
    else this.reportSeekFailure(handle?.seekFraction?.(fraction), handle);
    if (handle !== this.handle || !this.isConnected) return;
    this.dispatchEvent(new CustomEvent('webscore:seek', {bubbles: true}));
    if (handle === this.handle && this.isConnected) this.emitState();
  }

  /** Current rate-scaled transport position in seconds (0 before a score is mounted). */
  get currentTime(): number {
    return this.externalController?.currentTime ?? this.handle?.currentTime ?? this.handle?.player?.seconds ?? 0;
  }

  /** Total rate-scaled transport duration in seconds (0 before a score is mounted). */
  get duration(): number {
    return this.externalController?.duration ?? this.handle?.duration ?? this.handle?.player?.durationSeconds ?? 0;
  }

  private reportPlaybackError(error: unknown, operation: 'playback' | 'seek' = 'playback'): void {
    try {
      this.dispatchEvent(new CustomEvent('webscore:error', {detail: {operation, error}, bubbles: true, composed: true}));
    } catch (reportingError) {
      console.error('[WebScore] <score-player> error reporting failed', reportingError);
    }
  }

  /** Void compatibility commands report a failed async restart without leaking a rejection. */
  private reportSeekFailure(pending: void | Promise<void>, handle: PresetPlayerHandle | undefined): void {
    if (pending) void pending.catch((error: unknown) => {
      if (handle === this.handle && this.isConnected) this.reportPlaybackError(error, 'seek');
    });
  }

  /**
   * Start one latest-wins render task and contain its asynchronous failure at
   * the Element lifecycle boundary. An async function turns even a synchronous
   * Rack mount throw into a rejected promise, so every caller must pass through
   * this helper rather than fire-and-forget {@link render} directly.
   */
  private requestRender(): void {
    const request = ++this.renderRequest;
    void this.render().catch((error: unknown) => {
      if (request !== this.renderRequest || !this.isConnected) return;
      this.rollbackFailedRender(error);
    });
  }

  /** Roll back the active partial mount, then report every contained failure. */
  private rollbackFailedRender(error: unknown): void {
    const failures: unknown[] = [error];
    try {
      this.teardown(this.modular && !!this.modulePendingSource);
      if (this.modular) this.releaseModuleSource();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    this.playbackReadiness = 'error';
    this.playbackError = error;
    this.playbackPublisher.notify();

    for (const failure of failures) {
      try {
        this.onLifecycleError(failure);
      } catch (reportingError) {
        // Async lifecycle work cannot throw back through connectedCallback.
        // Keep the failure observable without creating an unhandled rejection.
        console.error(`[WebScore] <${this.localName}> lifecycle failed`, reportingError);
      }
    }
  }

  private readonly onRackShared = (event: Event): void => {
    if (event.target !== this.querySelector(RACK_DESK_TAG)) return;
    if (this.adoptComposedRack() && this.isConnected && !this.explicitRack && !this.externalController) this.requestRender();
  };

  /** Reconcile both additions and removals against the currently attached desk. */
  private adoptComposedRack(): boolean {
    if (this.modular) return false;
    const desk = this.querySelector(RACK_DESK_TAG);
    const rack = (desk as {rack?: Rack} | null)?.rack;
    if (rack === this.composedRack) return false;
    this.composedRack = rack;
    return true;
  }

  /**
   * The host every transport mode mounts into.
   *
   * Never this element itself: the facade takes the container it is given and
   * calls `replaceChildren()` on it, which for a master would delete the
   * `<score-rack-control>` written inside it — the very thing it is the transport for.
   */
  private ensureTransportHost(): HTMLElement {
    if (!this.rackHost || this.rackHost.parentElement !== this) {
      const host = this.ownerDocument.createElement('div');
      host.dataset.rackTransport = '';
      this.insertBefore(host, this.firstChild);
      this.rackHost = host;
    }
    return this.rackHost;
  }

  protected async render(): Promise<void> {
    if (this.modular) { await this.renderModular(); return; }
    // A caller can remove the desk and assign a score before the observer's
    // microtask. Never mount the removed desk's now-disposed Rack in that gap.
    this.adoptComposedRack();
    this.cancelLoad();
    const token = this.loadToken;
    this.replaceHandle(undefined);
    if (token !== this.loadToken || !this.isConnected) return;
    this.playbackError = undefined;
    this.playbackReadiness = 'loading';
    this.playbackPublisher.notify();
    if (token !== this.loadToken || !this.isConnected) return;

    // A borrowed controller means the element is chrome only: mount the
    // transport UI against it and leave engine ownership with the caller.
    // Synchronous — nothing to load.
    if (this.externalController) {
      if (this.commitHandle(this.mountController(this.externalController, {timeControl: this.timeControl, onError: (error) => { if (token === this.loadToken) this.reportPlaybackError(error); }}), token)) this.publishMountedPlayback();
      return;
    }

    // A rack drives every member in lockstep. This path is synchronous — the
    // members carry the music, so there is nothing here to load.
    if (this.explicitRack) {
      if (this.commitHandle(this.mountRack(this.explicitRack, {timeControl: this.timeControl, onError: (error) => { if (token === this.loadToken) this.reportPlaybackError(error); }}), token)) this.publishMountedPlayback();
      return;
    }

    // A desk written inside this element makes it the group's only transport.
    if (this.composedRack) {
      if (this.commitHandle(this.mountRack(this.composedRack, {timeControl: this.timeControl, onError: (error) => { if (token === this.loadToken) this.reportPlaybackError(error); }}), token)) this.publishMountedPlayback();
      return;
    }

    const controller = new AbortController();
    this.loadController = controller;
    let score: Score | undefined;
    try {
      score = await this.resolveScore(controller.signal);
    } finally {
      if (this.loadController === controller) this.loadController = undefined;
    }
    if (token !== this.loadToken || !this.isConnected) return; // superseded or detached

    if (!score) {
      // Only what this element mounted: light-DOM children may be a desk and
      // its parts, which nothing here put there and nothing here may remove.
      this.rackHost?.remove();
      this.rackHost = undefined;
      this.playbackReadiness = 'empty';
      this.playbackPublisher.notify();
      return;
    }
    const audio = this.buildSynth();
    if (token !== this.loadToken || !this.isConnected) return;
    const candidate = this.mountScore(score, {
      ...audio,
      synth: this.explicitSound ?? audio.synth,
      effect: this.explicitEffect,
      audioContext: this.explicitContext ?? audio.audioContext,
      destination: this.explicitDestination,
      timeControl: this.timeControl,
      volumeControl: this.volumeControl,
      volume: this.volumeValue,
      // The slider moves the same knob `volume` sets, so keep the element's
      // value in step — without pinning it, since the reader did not assign
      // the property and the attribute should still win a later change.
      onError: (error) => { if (token === this.loadToken) this.reportPlaybackError(error); },
      onVolumeChange: (volume) => {
        this.volumeValue = volume;
      },
      onNoteOn: (note) => {
        if (token === this.loadToken) this.emitNote('webscore:noteon', note, score);
      },
      onNoteOff: (note) => {
        if (token === this.loadToken) this.emitNote('webscore:noteoff', note, score);
      },
      onPause: () => {
        if (token === this.loadToken) this.emitState();
      },
      onSeek: () => {
        if (token !== this.loadToken || !this.isConnected) return;
        this.dispatchEvent(new CustomEvent('webscore:seek', {bubbles: true}));
        // A seek listener may replace the source or detach the element.
        if (token === this.loadToken && this.isConnected) this.emitState();
      },
      // Fired on every cursor tick (and once per seek). Keep nominal score
      // time and rate-scaled transport time explicit; the older `seconds` /
      // `duration` pair used different domains and made rate-aware consumers
      // prone to mixing coordinates.
      onCursor: (position) => {
        if (token !== this.loadToken) return;
        const player = this.handle?.player;
        const transportSeconds = player?.seconds ?? 0;
        const transportDurationSeconds = player?.durationSeconds ?? 0;
        const detail: ScorePlayerTimeUpdateEventDetail = {
          nominalSeconds: position.seconds,
          rate: player?.rate ?? this.rateValue,
          playing: player?.isPlaying?.() ?? this.handle?.isPlaying() ?? false,
          transportSeconds,
          transportDurationSeconds,
          progress:
            player?.progress ??
            (transportDurationSeconds > 0 ? Math.min(1, transportSeconds / transportDurationSeconds) : 0),
          // Keep the nominal alias for existing analysis/view event bindings.
          seconds: position.seconds,
          // Keep the transport alias for existing progress listeners.
          duration: transportDurationSeconds,
        };
        this.dispatchEvent(new CustomEvent('webscore:timeupdate', {detail, bubbles: true}));
      },
      onEnd: () => {
        if (token !== this.loadToken) return;
        this.activeNotes.clear();
        this.emitState();
        this.dispatchEvent(new CustomEvent('webscore:end', {bubbles: true}));
      },
    });
    if (!this.commitHandle(candidate, token)) return;
    const current = () => token === this.loadToken && this.isConnected && this.handle === candidate;
    // Player setters can synchronously dispatch events whose listeners replace
    // this mount. Do not continue configuring or publish data for that old pass.
    candidate.player?.setRate(this.rateValue);
    if (!current()) return;
    candidate.player?.setVolume(this.volumeValue);
    if (!current()) return;
    candidate.player?.setPan(this.panValue);
    if (!current()) return;
    this.applyLoop();
    if (!current()) return;
    this.setResolvedScore(score);
    if (current()) this.publishMountedPlayback();
    if (current()) this.emitState();
  }

  /**
   * Inheritance seam for a custom score UI. The default keeps the historic
   * imperative facade, which now composes ScorePlayer with @webmusic/ui.
   */
  protected mountScore(score: Score, options: PresetPlayerOptions): PresetPlayerHandle {
    return mountPresetPlayer(score, this.ensureTransportHost(), options);
  }

  /**
   * Inheritance seam for a custom rack UI/controller composition.
   *
   * Mounted into a host of this element's own rather than into the element:
   * the facade calls `replaceChildren()` on whatever container it is handed,
   * and a master's children include the desk it is the transport for.
   */
  protected mountRack(rack: Rack, options: RackPlayerOptions = {}): PresetPlayerHandle {
    return mountRackPlayer(rack, this.ensureTransportHost(), options);
  }

  /** Inheritance seam for a custom UI over a borrowed controller. */
  protected mountController(
    controller: PlayerController,
    options: ControllerPlayerOptions = {},
  ): PresetPlayerHandle {
    return mountControllerPlayer(controller, this.ensureTransportHost(), options);
  }

  /** Reject a mount superseded by application code called while it was created. */
  private commitHandle(candidate: PresetPlayerHandle | undefined, token: number): boolean {
    if (token !== this.loadToken || !this.isConnected) {
      candidate?.destroy();
      return false;
    }
    this.handle = candidate;
    return true;
  }

  /** Swap one mounted transport without ever retaining a destroyed handle. */
  protected replaceHandle(next: PresetPlayerHandle | undefined): void {
    this.unbindPlayback?.();
    this.unbindPlayback = undefined;
    const previous = this.handle;
    this.handle = next;
    if (previous !== next) this.sourceRevision += 1;
    this.activeNotes.clear();
    try {
      this.setResolvedScore(undefined);
    } finally {
      previous?.destroy();
    }
  }

  private publishMountedPlayback(): void {
    this.sourceRevision += 1;
    this.playbackReadiness = this.handle?.player?.playback ? 'ready' : 'unavailable';
    const source = this.handle?.player?.playback;
    const revision = this.sourceRevision;
    const unsubscribe = source?.subscribe(() => this.playbackPublisher.notify());
    if (this.isConnected && revision === this.sourceRevision && source === this.handle?.player?.playback) this.unbindPlayback = unsubscribe;
    else unsubscribe?.();
    if (!source) this.playbackPublisher.notify();
  }

  private cancelLoad(preservePendingSource = false): void {
    this.loadToken += 1;
    const controller = this.loadController;
    this.loadController = undefined;
    controller?.abort();
    if (!preservePendingSource) {
      this.modulePendingSource?.release();
      this.modulePendingSource = undefined;
    }
  }

  /**
   * Dispatch a bubbling DOM event describing the note that just turned on/off,
   * so a sibling view element bound via `player="#id"` can highlight it.
   */
  private emitNote(type: 'webscore:noteon' | 'webscore:noteoff', note: Note, score: Score): void {
    const detail: ScorePlayerNoteEventDetail = {
      midi: noteMidi(note),
      startTime: noteOnsetSeconds(note, score),
    };
    if (type === 'webscore:noteon') this.activeNotes.set(note, detail);
    else this.activeNotes.delete(note);
    this.dispatchEvent(new CustomEvent(type, {detail, bubbles: true}));
  }

  private setResolvedScore(score: Score | undefined): void {
    if (this.mountedScore === score) return;
    this.mountedScore = score;
    this.dispatchEvent(new CustomEvent('webscore:scorechange', {detail: {score}, bubbles: true}));
  }

  private emitState(): void {
    const detail = this.getPlaybackSnapshot();
    if (detail) this.dispatchEvent(new CustomEvent('webscore:statechange', {detail, bubbles: true}));
  }

  protected async resolveScore(signal: AbortSignal): Promise<Score | undefined> {
    if (this.explicitScore) return this.explicitScore;
    const src = this.getAttribute('src');
    if (!src) return undefined;
    const format = (this.getAttribute('format') as ScoreFormat | null) ?? undefined;
    try {
      const io = await import('../../io/load');
      return await io.loadScoreFromUrl(src, {format, signal});
    } catch (error) {
      if (signal.aborted) return undefined;
      console.error(`[WebScore] <${this.localName}> failed to load`, src, error);
      throw error;
    }
  }

  /**
   * Build a soundfont synth when `sound-font` is a URL template containing
   * `{midi}` (one sample per MIDI note), sharing a single `AudioContext` with
   * the player. Otherwise returns empty options so the player lazily creates
   * its own context and the default oscillator synth.
   */
  protected buildSynth(): {
    synth?: HeadlessSynth;
    audioContext?: AudioContext;
  } {
    const template = this.getAttribute('sound-font');
    if (this.explicitSound || !template || !template.includes('{midi}')) {
      this.clearSoundfontSynth();
      return {};
    }
    const externalContext = this.explicitContext ?? (this.explicitDestination?.context as AudioContext | undefined);
    // Reuse the context + synth built for this template — re-rendering (attribute
    // changes, score swaps) must not stack up AudioContexts.
    if (
      this.ownedSynth &&
      this.ownedSynthContext &&
      this.ownedTemplate === template &&
      this.ownedSynthContext === (externalContext ?? this.ownedContext) &&
      this.ownedSynthContext.state !== 'closed'
    ) {
      return {synth: this.ownedSynth, audioContext: this.ownedSynthContext};
    }
    this.clearSoundfontSynth();
    let audioContext = externalContext;
    if (!audioContext) {
      const AudioCtor =
        globalThis.AudioContext ?? (globalThis as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioCtor) return {};
      audioContext = new AudioCtor();
      this.ownedContext = audioContext;
    }
    const synth = createSoundfontSynth(audioContext, {
      resolveSample: (midi) => template.replace('{midi}', String(midi)),
    });
    this.ownedSynth = synth;
    this.ownedSynthContext = audioContext;
    this.ownedTemplate = template;
    return {synth, audioContext};
  }

  /** Dispose the element-owned SoundFont backend and only a context it created. */
  protected clearSoundfontSynth(): void {
    try {
      this.ownedSynth?.dispose?.();
    } catch {
      // Teardown remains best-effort for third-party structural backends.
    }
    const context = this.ownedContext;
    this.ownedSynth = undefined;
    this.ownedSynthContext = undefined;
    this.ownedTemplate = undefined;
    this.ownedContext = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  /** Release one connected lifetime. Borrowed score/rack/audio objects survive. */
  protected teardown(preservePendingSource = false): void {
    this.renderRequest += 1;
    this.cancelLoad(preservePendingSource);
    this.composedRack = undefined;
    this.unbindPlayback?.();
    this.unbindPlayback = undefined;
    const handle = this.handle;
    this.handle = undefined;
    this.activeNotes.clear();
    this.setResolvedScore(undefined);
    this.sourceRevision += 1;
    this.playbackReadiness = 'disposed';
    this.playbackPublisher.notify();
    let cleanupError: unknown;
    try {
      handle?.destroy();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      this.clearSoundfontSynth();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError !== undefined) throw cleanupError;
  }

  private mountModularComposition(): void {
    this.own(() => this.releaseModularComposition());
    this.own(() => this.teardown());
    this.own(() => { this.rackHost?.remove(); this.rackHost = undefined; });
    upgradeProperties(this, ['score', 'sound', 'effect', 'audioContext', 'destination', 'rate', 'volume', 'pan', 'loop']);
    this.syncKnobAttributes();
    this.own(provideModuleContext(this, () => this.moduleContext));
    this.own(observeModuleContext(this, (upstream, state) => {
      if (sameModuleScope(upstream, this.moduleUpstream)) { this.moduleUpstream = upstream; return; }
      if (!upstream && state === 'missing' && this.moduleAudio && this.moduleContext) return;
      this.bindModularContext(upstream, state);
    }));
  }

  private bindModularContext(upstream: ModuleContext | undefined, state: 'ready' | 'pending' | 'missing'): void {
    this.releaseModularComposition();
    if (state === 'pending') {
      notifyModuleContext(this);
      this.publishModuleChange();
      return;
    }
    this.moduleUpstream = upstream;
    if (!upstream) {
      this.moduleAudio = new ModuleAudioEnvironment({context: this.explicitContext ?? this.explicitDestination?.context});
      upstream = new ModuleContext({id: `${this.moduleId}:root`, audio: this.moduleAudio,
        destination: () => this.explicitDestination});
    }
    let session = upstream.session;
    if (!session || this.getAttribute('session') === 'local') {
      const audio = upstream.audio;
      this.ownedSession = new SessionTransport(() => audio.peek()?.currentTime ?? 0, {
        onOperationError: (_operation, error) => this.reportPlaybackError(error),
      });
      session = this.ownedSession;
    }
    this.moduleContext = upstream.derive({id: `${this.moduleId}:context`, session, target: this.moduleFacade});
    this.moduleSessionUnsubscribe = session.subscribe((event) => {
      if (event.type === 'snapshot' || event.type === 'participants' || event.type === 'source-error') this.applyLoop();
    });
    if (this.ownedSession) this.applyRate(false);
    notifyModuleContext(this);
    this.requestRender();
  }

  private async renderModular(): Promise<void> {
    const context = this.moduleContext;
    if (!context?.session) return;
    this.cancelLoad();
    const token = this.loadToken;
    this.replaceHandle(undefined);
    this.releaseModuleSource();
    this.playbackReadiness = 'loading';
    this.playbackPublisher.notify();
    const controller = new AbortController();
    this.loadController = controller;
    const pending = !this.explicitScore && this.getAttribute('src') ? context.session.holdPendingSource() : undefined;
    this.modulePendingSource = pending;
    let score: Score | undefined;
    try { score = await this.resolveScore(controller.signal); }
    catch (error) { pending?.reject(error); throw error; }
    finally { if (this.loadController === controller) this.loadController = undefined; }
    if (token !== this.loadToken || !this.isConnected || context !== this.moduleContext) return;
    try {
      if (!score && pending) throw new Error('The declared score source did not produce a score.');
      if (score) {
      const template = this.getAttribute('sound-font');
      const soundfont = !this.explicitSound && template?.includes('{midi}') ? createModuleSoundfont(context, template) : undefined;
      const source = new ScorePlayerModule(score, {
        id: this.moduleId, context, synth: this.explicitSound ?? soundfont, synthOwnership: soundfont ? 'owned' : 'borrowed', effect: this.explicitEffect,
        audioContext: this.explicitContext, destination: this.explicitDestination,
        onError: (error) => this.reportPlaybackError(error),
      });
      this.moduleSource = source;
      source.player.setVolume(this.volumeValue);
      source.player.setPan(this.panValue);
      const current = () => token === this.loadToken && this.moduleSource === source && this.isConnected;
      const subscriptions = [
        source.subscribe(() => this.publishModuleChange()),
        source.player.on('noteOn', (note) => { if (current()) this.emitNote('webscore:noteon', note, score!); }),
        source.player.on('noteOff', (note) => { if (current()) this.emitNote('webscore:noteoff', note, score!); }),
        source.player.on('timeupdate', (update) => {
          if (!current()) return;
          this.dispatchEvent(new CustomEvent('webscore:timeupdate', {bubbles: true, detail: {
            ...update, seconds: update.nominalSeconds, rate: source.player.rate, playing: source.player.isPlaying(),
          }}));
        }),
        source.player.on('end', () => {
          if (!current()) return;
          this.dispatchEvent(new CustomEvent('webscore:end', {bubbles: true}));
          this.emitState();
        }),
      ];
      this.moduleUnsubscribe = () => { for (const unsubscribe of subscriptions) unsubscribe(); };
      }
      pending?.resolve();
      if (this.modulePendingSource === pending) this.modulePendingSource = undefined;
    } catch (error) {
      pending?.reject(error);
      throw error;
    }
    const handle = mountModuleTransport(this.ensureTransportHost(), context.session, this.moduleSource, {
      visible: this.moduleControlsVisible,
      time: this.timeControl, volume: this.volumeControl, onError: (error) => this.reportPlaybackError(error),
      getVolume: () => this.volumeValue, onVolumeChange: (value) => this.setVolumeValue(value),
    });
    if (!this.commitHandle(handle, token)) return;
    this.setResolvedScore(score);
    this.publishMountedPlayback();
    this.applyLoop();
    this.publishModuleChange();
  }

  private get moduleControlsVisible(): boolean {
    return this.getAttribute('controls') === 'show' || (!!this.ownedSession && this.getAttribute('controls') !== 'hide');
  }

  private publishModuleChange(): void {
    for (const listener of [...this.moduleListeners]) {
      try { listener(); } catch (error) { this.reportPlaybackError(error); }
    }
    notifyModuleChange(this);
  }

  private releaseModuleSource(): void {
    this.moduleUnsubscribe?.();
    this.moduleUnsubscribe = undefined;
    const source = this.moduleSource;
    this.moduleSource = undefined;
    source?.dispose();
    this.publishModuleChange();
  }

  private releaseModularComposition(): void {
    this.renderRequest += 1;
    this.moduleSessionUnsubscribe?.();
    this.moduleSessionUnsubscribe = undefined;
    this.cancelLoad();
    const session = this.ownedSession;
    const audio = this.moduleAudio;
    this.ownedSession = undefined;
    this.moduleAudio = undefined;
    this.moduleContext = undefined;
    this.moduleUpstream = undefined;
    const clean = (callback: () => void) => { try { callback(); } catch (error) { this.reportPlaybackError(error); } };
    clean(() => this.replaceHandle(undefined));
    this.playbackReadiness = this.isConnected ? 'unavailable' : 'disposed';
    this.playbackError = undefined;
    this.playbackPublisher.notify();
    clean(() => this.releaseModuleSource());
    clean(() => session?.dispose());
    clean(() => audio?.dispose());
  }
}


/** Register `<score-player>` without creating a global side effect on import. */
export function defineScorePlayerElement(tag = 'score-player'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, ScorePlayerElement);
  }
}
