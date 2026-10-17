// ============================================================================
// <audio-player> — a full transport UI for one AudioClip. Set `src` (a URL)
// or assign `.clip`/`.player`/`.effect`; the element loads, wires an
// AudioPlayer and paints play/pause, a seekable progress bar and a time
// readout. Mirrors <score-player>. It draws no waveform of its own — bind an
// <audio-view> to it for that.
//
// Attributes: src format controls loop engine preserves-pitch volume rate
//             pan preload
// Properties: .clip .player .effect .audioContext (share one page-wide context)
//   controls        a real boolean, default TRUE: the transport shows unless
//                   `controls="false"` (also `0`/`no`/`off`) opts out. Unlike
//                   <audio>, an absent attribute cannot mean "no UI" — being
//                   the transport is this element's whole job.
//   loop            `loop` (whole clip) or `loop="a,b"` (A–B seconds). Applied
//                   live, so changing it keeps the playhead.
//   preserves-pitch live on the media engine; a documented no-op on the buffer
//                   engine, whose playbackRate transposes by construction —
//                   this package ships no time-stretcher.
//   pan             -1..1, applied live.
//   preload         warm the first-play path on mount (`preload="none"` opts
//                   out, as on <audio>).
// Properties: .clip .player .effect .clock .analyser .currentTime .seconds
//             .duration .playing
// Methods: play(when?) pause() stop() seek(s) seekFraction(f) scrub(ds)
//          preload() load(input)
// Events (webaudio:*, {bubbles, composed}):
//   timeupdate {seconds, duration, progress}   loaded {duration}
//   end AudioClip   regionenter Region   regionleave Region
//   beat {index, seconds}
//   error Error — a failed load, a player failure, or a presenter failure
//   seek {seconds, region?, progress?} — the element's own transport moved the
//     playhead. The shape is the one <audio-view> already dispatches;
//     `progress` is an additive extension, so a listener written for the view
//     keeps working. Programmatic seeks stay silent (see `seek`).
// CSS vars: --wap-bg --wap-fg --wap-accent --wap-track --wap-radius --wap-height
// ============================================================================

import type {AudioClip, Region} from '../../core';
import {AudioPlayer, type AudioPlayerOptions, type AudioPlayerTransport} from '../headless/audio-player';
import type {AudioScratchSession, PlayerEngineKind} from '../headless/player';
import type {Effect} from '../core/effect';
import {loadClip, loadClipFromUrl} from '../api/load';
import {
  WebMusicElement,
  boolAttr,
  defineOnce,
  numAttr,
  upgradeProperties,
} from './internal/base';
import {parseLoopAttr} from '../core/format';
import {browserMediaAdapterFactory} from './internal/browser-media-adapter';
import {getAudioContextConstructor} from '@webmusic/kernel/audio-context';
import type {TransportClockReader} from '@webmusic/kernel/transport';
import {ModuleAudioEnvironment, ModuleContext, createConnectionLease, type ConnectionLease, type ModuleHandle} from '@webmusic/kernel/module';
import {SessionTransport, type SessionParticipantLease, type SessionPendingSourceLease} from '@webmusic/kernel/session';
import {isModularComposition, provideModuleContext, observeModuleContext, notifyModuleContext, notifyModuleChange} from '@webmusic/kernel/element';
import {
  mountTransport,
  type TransportBinding,
  type TransportHandle,
} from '@webmusic/ui/transport';

const PROPS = ['clip', 'player', 'effect', 'audioContext'] as const;
let audioElementSequence = 0;

/** Attributes that reach a live player through a setter — owned or borrowed. */
const LIVE_ATTRIBUTES = ['volume', 'rate', 'pan', 'loop', 'preserves-pitch'] as const;

/**
 * Detail of `webaudio:seek`. `seconds` and `region` are <audio-view>'s
 * established payload; `progress` is this element's additive extension.
 */
export interface AudioPlayerSeekDetail {
  seconds: number;
  region?: Region;
  progress: number;
}

/** Resolved source replacement; independent of lazy audio-graph readiness. */
export interface AudioPlayerElementSourceDetail {
  clip: AudioClip | undefined;
  revision: number;
}

export class AudioPlayerElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return [
      'src',
      'format',
      'controls',
      'loop',
      'engine',
      'preserves-pitch',
      'volume',
      'rate',
      'pan',
      'preload',
      'composition',
      'session',
    ];
  }

  protected root?: ShadowRoot;
  private _clip?: AudioClip;
  private _player?: AudioPlayer;
  private _effect?: Effect;
  private ownsPlayer = false;
  private clipOrigin: 'src' | 'property' | 'input' | null = null;
  /** The URL the current clip was loaded from; a src changed while disconnected reloads on mount. */
  private loadedSrc?: string;
  private offFns: Array<() => void> = [];
  private rafScheduled = false;
  private renderRafId: number | null = null;
  /** Latest-wins generation for async loads (see score-source.ts precedent). */
  private loadToken = 0;
  private loadController: AbortController | null = null;
  private loadingSrc?: string;
  private pendingLoad?: SessionPendingSourceLease;
  private pendingLoadCommitted = false;
  private pendingLoadRequested = false;
  private pendingLoadFailure?: {error: unknown};
  /** Created lazily, shared by decoding and playback, closed on unmount. */
  private ownedContext?: AudioContext;
  /** A context handed in by the page. Never closed here — it is not ours. */
  private suppliedContext?: AudioContext;
  private mounted = false;
  private sourceRevision = 0;
  private announcedClip?: AudioClip;
  private announcedPlayer?: AudioPlayer;
  private playerEngine?: PlayerEngineKind;
  private selectedTransport?: AudioPlayerTransport;
  private sourceCommit?: {clip: AudioClip | undefined};

  private transportHandle?: TransportHandle;
  private compatibilityStyle?: HTMLStyleElement;
  private readonly uiSubscribers = new Set<() => void>();
  private modular = false;
  private moduleContext?: ModuleContext;
  private parentModuleContext?: ModuleContext;
  private moduleEnvironment?: ModuleAudioEnvironment;
  private ownedSession?: SessionTransport;
  private moduleReleases: Array<() => void> = [];
  private participant?: SessionParticipantLease;
  private readonly retiringParticipants = new Set<SessionParticipantLease>();
  private registration?: ConnectionLease;
  private moduleRoute?: ConnectionLease;
  private moduleSource?: AudioClip;
  private moduleSourcePlayer?: AudioPlayer;
  private moduleGeneration = 0;
  private moduleHandle?: ModuleHandle;
  private releaseSessionObservation?: () => void;
  private moduleLoopKey?: string;

  get module(): ModuleHandle | undefined { return this.modular ? this.moduleHandle : undefined; }
  get sessionTransport(): SessionTransport | undefined { return this.moduleContext?.session; }

  protected override onMount(): void {
    // Register rollback before lazy-property setters can rebuild resources.
    this.own(() => this.teardown());
    this.mounted = true;
    this.modular = isModularComposition(this);
    upgradeProperties(this, PROPS);
    if (this.modular) this.mountModules();
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.render();
    if (!this._player && (!this.modular || this.moduleContext)) this.rebuildPlayer();
    this.applySource();
    this.applyAttributes();
  }

  protected override onUnmount(): void {
    this.mounted = false;
  }

  /**
   * A `.clip` or `.player` assigned before the element was ever connected
   * builds outside every mount scope, so the base class has nothing owned to
   * release for it. Teardown is idempotent, so the mounted path is unaffected.
   */
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (!this.mounted) this.teardown();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    // Nothing is lost while disconnected: applySource() and applyAttributes()
    // reconcile every attribute on the next mount.
    // During custom-element upgrade, existing attributes are delivered before
    // connectedCallback even though isConnected is already true. Wait until
    // onMount resolves the composition scope before loading or allocating.
    if (!this.isConnected || !this.mounted) return;
    if (name === 'composition' || name === 'session') {
      if (_old === value) return;
      super.disconnectedCallback();
      super.connectedCallback();
      notifyModuleContext(this);
      return;
    }
    if (name === 'src') {
      if (value) {
        void this.loadFromSrc(value);
        return;
      }
      this.cancelLoad();
      if (this.clipOrigin === 'src') {
        this.clearLoadedClip();
        this.paint();
      }
      return;
    }
    if (name === 'format' || name === 'engine') {
      // Both decide how bytes become a clip, so they can only land via a reload.
      const src = this.getAttribute('src');
      if (src) void this.loadFromSrc(src);
      return;
    }
    if (name === 'controls') {
      this.applyControls();
      return;
    }
    if (name === 'preload') {
      this.applyPreload();
      return;
    }
    this.applyPlayerAttribute(name);
  }

  // --- public properties ---

  set clip(clip: AudioClip | undefined) {
    this.cancelLoad();
    this._clip = clip;
    this.clipOrigin = clip ? 'property' : null;
    this.loadedSrc = undefined;
    if (this._player) { this._player.setClip(clip); this.applyPreload(); }
    else if (this.isConnected) this.rebuildPlayer();
    this.announceSource();
    this.syncModuleSource();
  }
  get clip(): AudioClip | undefined {
    return this._player ? this._player.clip : this._clip;
  }

  setClip(clip: AudioClip | undefined): void { this.clip = clip; }

  /** Connect a borrowed queue or mix without transferring its lifecycle. */
  setTransport(transport: AudioPlayerTransport | undefined): void {
    this.cancelLoad();
    if (!this._player) this.rebuildPlayer();
    this._clip = undefined;
    this.clipOrigin = null;
    this.loadedSrc = undefined;
    this._player?.setTransport(transport);
    this.announceSource();
  }
  get transport(): AudioPlayerTransport | undefined { return this._player?.transport; }

  set player(player: AudioPlayer | undefined) {
    if (player === this._player && (player !== undefined || this._clip === undefined)) return;
    this.cancelLoad();
    this.releasePlayer();
    this._player = player;
    this._clip = player?.clip;
    this.clipOrigin = player ? 'property' : null;
    this.loadedSrc = undefined;
    this.ownsPlayer = false;
    if (this.isConnected && player) {
      this.attachPlayer();
      // A borrowed player never saw the constructor options an owned one gets.
      this.applyAttributes();
    }
    this.paint();
    this.notifyUI();
    this.announceSource();
    this.dispatch('playerchange', {player: this._player});
    this.syncModuleSource();
  }
  get player(): AudioPlayer | undefined {
    return this._player;
  }

  set effect(effect: Effect | undefined) {
    if (this._player && (this.ownsPlayer || !this._player.transport)) this._player.setEffect(effect);
    this._effect = effect;
  }
  get effect(): Effect | undefined {
    return this._effect;
  }

  // --- transport passthroughs ---

  /**
   * Start playback. `when` is an absolute `AudioContext.currentTime`: the
   * buffer engine starts sample-accurately at it, which is how several players
   * (or a player and a score) line up on one downbeat. Omitted starts now.
   */
  async play(when?: number): Promise<void> {
    if (this.modular) await this.moduleContext?.session?.play();
    else await this._player?.play(when);
    this.notifyUI();
  }

  pause(): void {
    if (this.modular) void this.moduleContext?.session?.pause();
    else this._player?.pause();
    this.notifyUI();
  }

  stop(): void {
    if (this.modular) void this.moduleContext?.session?.stop();
    else this._player?.stop();
    this.notifyUI();
  }

  /**
   * PlayerLike-compatible transport forwarding for bindings such as
   * <audio-view>. Deliberately silent: the view dispatches its own
   * `webaudio:seek` and then drives us through here, and announcing it a
   * second time would echo the view's own event back at it.
   */
  seek(seconds: number): void {
    if (this.modular) void this.moduleContext?.session?.seek(seconds);
    else this._player?.seek(seconds);
    this.notifyUI();
  }

  seekFraction(fraction: number): void {
    if (this.modular) this.seek(Math.max(0, Math.min(1, fraction)) * this.duration);
    else this._player?.seekFraction(fraction);
    this.notifyUI();
  }

  /** Begin audible scrubbing when the current player owns decoded PCM. */
  beginScratch(): AudioScratchSession | undefined {
    if (this.modular) return undefined;
    return this._player?.beginScratch();
  }

  scrub(deltaSeconds: number): void {
    if (this.modular) this.seek(this.seconds + deltaSeconds);
    else this._player?.scrub(deltaSeconds);
    this.notifyUI();
  }

  /** Warm the context, the graph and the decoded buffer / media element. */
  async preload(): Promise<void> {
    if (this.modular) await this.moduleContext?.session?.preload();
    else await this._player?.preload();
  }

  /** Allow imperative `el.load(buffer)` for non-URL inputs. */
  async load(input: ArrayBuffer | Blob): Promise<void> {
    const {token, controller} = this.beginLoad();
    try {
      const context = this.decodeContext();
      const clip = await loadClip(input, {
        ...(context ? {context} : {}),
        signal: controller.signal,
      });
      if (token !== this.loadToken) return; // superseded by a newer load
      this.loadController = null;
      this._clip = clip;
      this.clipOrigin = 'input';
      this.loadedSrc = undefined;
      this.rebuildPlayer();
      this.pendingLoadCommitted = true;
      this.resolvePendingLoad();
    } catch (err) {
      if (token !== this.loadToken) return;
      this.loadController = null;
      this.pendingLoadFailure = {error: err};
      this.pendingLoad?.reject(err);
      this.onPlayerError(err);
    }
  }

  // --- getters ---

  get currentTime(): number {
    return this.modular ? this.moduleContext?.session?.snapshot.position ?? 0 : this._player?.seconds ?? 0;
  }

  get seconds(): number {
    return this.currentTime;
  }

  get duration(): number {
    if (this.modular) return this.moduleContext?.session?.snapshot.durationSeconds ?? 0;
    return this._player?.duration ?? this._clip?.duration ?? 0;
  }

  get scratching(): boolean {
    return this._player?.scratching ?? false;
  }

  get playing(): boolean {
    return this.modular ? this.moduleContext?.session?.snapshot.paused === false : this._player?.playing ?? false;
  }

  /**
   * The active engine's transport clock — the position axis a sync bridge or a
   * view anchors against. `undefined` until the engine exists (it is built on
   * first play) and on the media engine, which owns no clock.
   */
  get clock(): TransportClockReader | undefined {
    return this.modular ? this.moduleContext?.session?.clock : this._player?.clock;
  }

  /** The player's analyser, for `<audio-meter>`. Reading it builds the graph. */
  get analyser(): AnalyserNode | undefined {
    return this._player?.analyser;
  }

  // --- subclass hooks ---

  /** Replace this hook to change engine options or the player type. */
  protected createPlayer(clip: AudioClip | undefined, options: AudioPlayerOptions): AudioPlayer {
    return new AudioPlayer(clip, options);
  }

  /**
   * Structural UI contract for subclasses that want to retain the stock
   * transport DOM while changing where its values come from.
   */
  protected createTransportBinding(): TransportBinding {
    return {
      snapshot: () => ({
        playing: this.playing,
        progress: this.duration > 0 && Number.isFinite(this.duration) ? this.seconds / this.duration : 0,
        seconds: this.seconds,
        duration: Number.isFinite(this.duration) ? this.duration : 0,
        disabled: this.modular ? !this.moduleContext?.session || this.moduleContext.session.snapshot.participantCount === 0 : !this._player || (!this._player.clip && !this._player.transport),
      }),
      play: () => this.play(),
      pause: () => this.pause(),
      seekFraction: (value) => this.commitUserSeek(value),
      subscribe: (notify) => {
        this.uiSubscribers.add(notify);
        return () => this.uiSubscribers.delete(notify);
      },
    };
  }

  /** Replace this hook to provide a completely custom UI while retaining ownership. */
  protected mountTransportUI(root: ShadowRoot): TransportHandle {
    return mountTransport(root, this.createTransportBinding(), {
      label: this.getAttribute('aria-label') ?? undefined,
      classNames: {root: 'wrap', play: 'play', track: 'bar', seek: 'fill', time: 'time'},
      parts: {root: 'wrap', play: 'play', track: 'bar', seek: 'fill', time: 'time'},
      onError: (error) => this.onPlayerError(error),
    });
  }

  /**
   * The element's one observable failure channel: a failed load, an engine
   * error and a presenter read/scheduling failure all arrive here.
   */
  protected onPlayerError(error: unknown): void {
    this.dispatch('error', error instanceof Error ? error : new Error(String(error)));
  }

  private mountModules(): void {
    this.moduleReleases.push(provideModuleContext(this, () => this.moduleContext));
    this.moduleReleases.push(observeModuleContext(this, (parent, state) => {
      if (!this.isConnected || parent === this.parentModuleContext && this.moduleContext) return;
      if (parent && this.parentModuleContext && this.moduleContext &&
        parent.audio === this.parentModuleContext.audio && parent.session === this.parentModuleContext.session &&
        parent.admit === this.parentModuleContext.admit && parent.registry === this.parentModuleContext.registry) {
        this.parentModuleContext = parent;
        return;
      }
      this.detachModuleSource();
      const clean = (release: (() => void) | undefined) => {
        try { release?.(); } catch (error) { this.onPlayerError(error); }
      };
      clean(this.releaseSessionObservation);
      this.releaseSessionObservation = undefined;
      this.pendingLoad?.release(); this.pendingLoad = undefined;
      clean(() => this.ownedSession?.dispose());
      this.ownedSession = undefined;
      clean(() => this.moduleEnvironment?.dispose());
      this.moduleEnvironment = undefined;
      this.moduleContext = undefined;
      this.parentModuleContext = parent;
      if (state === 'pending') { notifyModuleContext(this); return; }
      const borrowed = !this.ownsPlayer ? this._player : undefined;
      const audio = parent?.audio ?? (this.moduleEnvironment = new ModuleAudioEnvironment({
        context: this.suppliedContext ?? borrowed?.peekAudioContext(),
        ...(borrowed ? {create: () => borrowed.audioContext, owned: false} : {}),
      }));
      const session = parent?.session && this.getAttribute('session') !== 'local'
        ? parent.session
        : (this.ownedSession = new SessionTransport(() => audio.peek()?.currentTime ?? 0));
      if (this.pendingLoadRequested) {
        this.pendingLoad = session.holdPendingSource();
        if (this.pendingLoadFailure) this.pendingLoad.reject(this.pendingLoadFailure.error);
      }
      this.moduleContext = parent
        ? parent.derive({id: `audio-element-${++audioElementSequence}`, session, target: null})
        : new ModuleContext({id: `audio-element-${++audioElementSequence}`, audio, session});
      this.moduleLoopKey = undefined;
      this.releaseSessionObservation = session.subscribe(() => {
        if (this.hasAttribute('loop')) this.applyModuleLoop();
        this.notifyUI(); this.scheduleRender();
      });
      if (this._player && this.ownsPlayer) this.rebuildPlayer(true);
      else if (!this._player) this.rebuildPlayer();
      this.syncModuleSource();
      this.applyControls();
      this.applySource();
      notifyModuleContext(this);
    }));
  }

  private syncModuleSource(): void {
    if (!this.modular || !this.moduleContext || !this.isConnected) return;
    const player = this._player;
    const clip = player?.clip;
    if (player === this.moduleSourcePlayer && clip === this.moduleSource) return;
    const pending = this.detachModuleSource();
    const generation = this.moduleGeneration;
    this.moduleSource = clip;
    this.moduleSourcePlayer = player;
    const context = this.moduleContext;
    if (!player) return;
    const module: ModuleHandle = {
      id: player.module.id,
      get inserts() { return player.module.inserts; },
      getPort: (name) => player.module.getPort?.(name),
      prepare: () => this.prepareModuleSource(player, context, generation),
      subscribe: (listener) => player.module.subscribe?.(listener) ?? (() => {}),
    };
    this.moduleHandle = module;
    this.registration = context.registry.register(module);
    this.moduleContext = context.derive({id: context.id, target: module});
    const register = () => {
      if (generation !== this.moduleGeneration || !this.isConnected || !clip || !context.session) return;
      const transport = {
        play: (when?: number) => player.play(when),
        pause: () => player.pause(), stop: () => player.stop(), seek: (seconds: number) => player.seek(seconds),
        setRate: (rate: number) => player.setRate(rate),
        get position() { return player.seconds; }, get running() { return player.playing; },
        get clock() { return player.clock; },
      };
      try {
        this.participant = context.session.register(transport, {
          axis: 'clip-seconds', identity: player,
          durationSeconds: () => player.clip ? player.duration : null,
          endPolicy: 'position',
          prepare: () => this.prepareModuleSource(player, context, generation),
          ...(player.timingCapabilities.sharedSessionClock ? {
            activate: () => player.activateScheduling(),
            attachScheduling: (binding) => player.attachScheduling(binding),
          } : {}),
        });
        void this.participant.ready.catch((error: unknown) => {
          if (generation === this.moduleGeneration) this.onPlayerError(error);
        });
        this.resolvePendingLoad();
      } catch (error) { this.pendingLoad?.reject(error); this.onPlayerError(error); }
    };
    if (pending) void pending.then(register); else register();
    notifyModuleChange(this);
    notifyModuleContext(this);
    this.notifyUI();
  }

  private async prepareModuleSource(player: AudioPlayer, context: ModuleContext, generation: number): Promise<void> {
    await player.preload();
    if (generation !== this.moduleGeneration || !this.isConnected) return;
    const port = player.outputPort;
    if (!port) return;
    if (port.context && port.context !== context.audio.prepare()) throw new Error('A borrowed player must share the module AudioContext');
    if (!this.moduleRoute?.active) {
      if (context.admit) this.moduleRoute = context.admit(this.moduleHandle!, port);
      else {
        const destination = context.destination?.() ?? context.audio.prepare().destination;
        port.setDefault(destination);
        this.moduleRoute = createConnectionLease(() => {
          if (!port.disposed && port.defaultDestination === destination) port.setDefault(undefined);
        });
      }
    }
    notifyModuleChange(this);
  }

  private detachModuleSource(): Promise<void> | undefined {
    this.moduleGeneration++;
    const participant = this.participant;
    this.participant = undefined;
    if (participant) {
      this.retiringParticipants.add(participant);
      void participant.settled.then(() => this.retiringParticipants.delete(participant));
    }
    // A borrowed engine may fail to cancel. Keep its lease for a later retry,
    // while always withdrawing this scope's route and registration now.
    const retiring = [...this.retiringParticipants];
    for (const lease of retiring) {
      try { lease.release(); } catch (error) { this.onPlayerError(error); }
    }
    try { this.moduleRoute?.release(); } catch (error) { this.onPlayerError(error); }
    this.moduleRoute = undefined;
    try { this.registration?.release(); } catch (error) { this.onPlayerError(error); }
    this.registration = undefined;
    this.moduleHandle = undefined;
    this.moduleSource = undefined;
    this.moduleSourcePlayer = undefined;
    return retiring.length ? Promise.all(retiring.map((lease) => lease.settled)).then(() => {}) : undefined;
  }

  private unmountModules(): void {
    this.detachModuleSource();
    const clean = (release: (() => void) | undefined) => {
      try { release?.(); } catch (error) { this.onPlayerError(error); }
    };
    for (const release of this.moduleReleases.splice(0).reverse()) clean(release);
    clean(this.releaseSessionObservation);
    this.releaseSessionObservation = undefined;
    clean(() => this.ownedSession?.dispose());
    this.ownedSession = undefined;
    clean(() => this.moduleEnvironment?.dispose());
    this.moduleEnvironment = undefined;
    this.moduleContext = undefined;
    this.parentModuleContext = undefined;
    this.modular = false;
  }

  protected teardown(): void {
    this.unmountModules();
    this.cancelLoad();
    this.cancelScheduledRender();
    this.releasePlayer();
    this.transportHandle?.destroy();
    this.transportHandle = undefined;
    this.closeOwnedContext();
    this.announceSource();
    this.dispatch('playerchange', {player: this._player});
  }

  // --- loading ---

  private async loadFromSrc(src: string): Promise<void> {
    if (this.modular && !this.moduleContext) return;
    // Latest-wins: rapid src changes fire one load each; only the newest
    // generation may commit its clip (or report its failure).
    const {token, controller} = this.beginLoad();
    this.loadingSrc = src;
    try {
      const format = this.getAttribute('format') || undefined;
      const streaming = (this.getAttribute('engine') as PlayerEngineKind | null) === 'media';
      // A streaming load decodes nothing, so it must not mint a context the
      // media engine will never use.
      const context = streaming ? undefined : this.decodeContext();
      const clip = await loadClipFromUrl(src, {
        ...(format ? {format: format as never} : {}),
        ...(context ? {context} : {}),
        streaming,
        signal: controller.signal,
      });
      if (token !== this.loadToken) return; // superseded by a newer load
      this.loadController = null;
      this.loadingSrc = undefined;
      this._clip = clip;
      this.clipOrigin = 'src';
      this.loadedSrc = src;
      this.rebuildPlayer();
      this.pendingLoadCommitted = true;
      this.resolvePendingLoad();
    } catch (err) {
      if (token !== this.loadToken) return; // a stale failure is not ours to report
      this.loadController = null;
      this.loadingSrc = undefined;
      this.pendingLoadFailure = {error: err};
      this.pendingLoad?.reject(err);
      this.onPlayerError(err);
    }
  }

  private beginLoad(): {token: number; controller: AbortController} {
    this.loadController?.abort();
    this.pendingLoad?.release();
    this.pendingLoad = this.moduleContext?.session?.holdPendingSource();
    this.pendingLoadCommitted = false;
    this.pendingLoadRequested = true;
    this.pendingLoadFailure = undefined;
    const controller = new AbortController();
    this.loadController = controller;
    this.loadingSrc = undefined;
    return {token: ++this.loadToken, controller};
  }

  private cancelLoad(): void {
    this.loadToken++;
    this.loadController?.abort();
    this.loadController = null;
    this.loadingSrc = undefined;
    this.pendingLoad?.release();
    this.pendingLoad = undefined;
    this.pendingLoadCommitted = false;
    this.pendingLoadRequested = false;
    this.pendingLoadFailure = undefined;
  }

  private resolvePendingLoad(): void {
    if (!this.pendingLoadCommitted || this.modular && !this.participant?.active) return;
    this.pendingLoad?.resolve();
    this.pendingLoad = undefined;
    this.pendingLoadRequested = false;
    this.pendingLoadFailure = undefined;
  }

  private clearLoadedClip(): void {
    this._clip = undefined;
    this.clipOrigin = null;
    this.loadedSrc = undefined;
    this._player?.setClip(undefined);
    this.announceSource();
  }

  // --- audio context ---

  /**
   * The context decoding runs on. Native `decodeAudioData` is the only path
   * decode.ts can take without a WASM peer, and it is reached solely by being
   * handed a context — without one, an mp3 the browser decodes natively
   * demanded a decoder package instead. A borrowed player's context is
   * preferred over minting a second one: a page is allowed only a handful.
   */
  private decodeContext(): BaseAudioContext | undefined {
    if (this.modular) return this.moduleContext?.audio.prepare();
    return (
      this.suppliedContext ??
      this.ownedContext ??
      this.borrowedContext() ??
      this.ensureAudioContext()
    );
  }

  /**
   * An externally supplied player's context. It outlives this element, so it
   * is never closed here. Reading it builds that player's graph, which its
   * first play would do anyway.
   */
  private borrowedContext(): BaseAudioContext | undefined {
    if (!this._player || this.ownsPlayer) return undefined;
    try {
      return this._player.audioContext;
    } catch {
      return undefined; // disposed player, or no Web Audio at all
    }
  }

  /**
   * Share the page's context instead of letting this element mint its own.
   * Browsers cap contexts at roughly six, so a page with several elements
   * wants one — `<audio-mixer>` and `<audio-playlist>` take the same handle.
   * Assigning it rebuilds only a player this element owns.
   */
  set audioContext(context: AudioContext | undefined) {
    if (context === this.suppliedContext) return;
    this.suppliedContext = context;
    if (context) this.closeOwnedContext();
    if (this.isConnected && this.ownsPlayer) this.rebuildPlayer(true);
  }

  get audioContext(): AudioContext | undefined {
    return this.suppliedContext ?? this.ownedContext ?? this.moduleContext?.audio.peek() as AudioContext | undefined;
  }

  /**
   * The context every player and decode gets: the one a host supplied, else
   * this element's own, created on first need — never at construction, where
   * there may be no Web Audio (SSR) and where a context created before a user
   * gesture would only sit suspended.
   */
  private ensureAudioContext(): AudioContext | undefined {
    if (this.modular) return this.moduleContext?.audio.prepare() as AudioContext | undefined;
    if (this.suppliedContext) return this.suppliedContext;
    if (this.ownedContext) return this.ownedContext;
    if (this._player) return this._player.audioContext;
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return undefined; // SSR / Node: the WASM path still works
    try {
      this.ownedContext = new AudioContextCtor();
    } catch {
      // A browser that refuses another context costs the native decode path
      // (the WASM fall-back still runs), not the element.
      return undefined;
    }
    return this.ownedContext;
  }

  private closeOwnedContext(): void {
    const context = this.ownedContext;
    this.ownedContext = undefined;
    if (!context) return;
    try {
      // Already-closed contexts reject; a close failure must not block unmount.
      void context.close().catch(() => {});
    } catch {
      /* a context that never opened */
    }
  }

  // --- player wiring ---

  private rebuildPlayer(force = false): void {
    if (this.modular && !this.moduleContext) return;
    const engine = (this.getAttribute('engine') as PlayerEngineKind | null) ?? 'auto';
    force ||= this.ownsPlayer && engine !== this.playerEngine;
    if (!force && this._player) {
      const previousCommit = this.sourceCommit;
      this.sourceCommit = {clip: this._clip};
      try { this._player.setClip(this._clip); }
      finally { this.sourceCommit = previousCommit; }
      this.applyPreload();
      this.paint();
      this.notifyUI();
      this.announceSource();
      this.syncModuleSource();
      return;
    }
    this.releasePlayer();
    const clip = this._clip;
    // An empty core is immediately connectable without allocating audio resources.
    const context = this.suppliedContext ?? this.ownedContext;
    const options: AudioPlayerOptions = {
      engine,
      mediaAdapterFactory: browserMediaAdapterFactory,
      ...(!this.modular && this.hasAttribute('loop') ? {loop: parseLoopAttr(this.getAttribute('loop'))} : {}),
      ...(this.hasAttribute('preserves-pitch') ? {preservesPitch: boolAttr(this, 'preserves-pitch')} : {}),
      ...(this.hasAttribute('volume') ? {volume: numAttr(this, 'volume', 1, 0, 4)} : {}),
      ...(!this.modular && this.hasAttribute('rate') ? {rate: numAttr(this, 'rate', 1, 0.25, 4)} : {}),
      ...(this.hasAttribute('pan') ? {pan: numAttr(this, 'pan', 0, -1, 1)} : {}),
      ...(context ? {audioContext: context} : {}),
      ...(this.modular && this.moduleContext ? {moduleContext: this.moduleContext} : {}),
      ...(this._effect ? {effect: this._effect} : {}),
    };
    this._player = this.createPlayer(clip, options);
    this.playerEngine = engine;
    this.ownsPlayer = true;
    this.attachPlayer();
    this.announceSource();
    this.dispatch('playerchange', {player: this._player});
    this.syncModuleSource();
  }

  private attachPlayer(): void {
    const player = this._player;
    if (!player) return;
    // Never subscribe twice: a property assignment can wire the same player
    // before the mount pass reaches it.
    this.releaseListeners();
    this.selectedTransport = player.transport;
    this.offFns.push(player.on('sourcechange', () => {
      if (this._player !== player) return;
      const transport = player.transport;
      const internalCommit = this.sourceCommit !== undefined &&
        this.sourceCommit.clip === player.clip && transport === undefined;
      // A companion can select directly through the Headless owner. That
      // explicit choice supersedes any older browser fetch/decode. Automatic
      // track changes within the same queue do not cancel a newer user load.
      if (!internalCommit && (transport !== this.selectedTransport || !transport)) {
        this.cancelLoad();
        this.clipOrigin = player.clip ? 'property' : null;
        this.loadedSrc = undefined;
      }
      this.selectedTransport = transport;
      this._clip = player.clip;
      this.announceSource();
      this.syncModuleSource();
      this.paint();
      this.notifyUI();
    }));
    this.offFns.push(player.on('statechange', (detail) => {
      this.dispatch('statechange', detail);
      this.notifyUI();
    }));
    this.offFns.push(
      player.on('timeupdate', (d) => {
        this.dispatch('timeupdate', d);
        this.notifyUI();
        this.scheduleRender();
      }),
    );
    this.offFns.push(
      player.on('end', (clip) => {
        this.dispatch('end', clip);
        this.notifyUI();
      }),
    );
    this.offFns.push(player.on('regionenter', (r: Region) => this.dispatch('regionenter', r)));
    this.offFns.push(player.on('regionleave', (r: Region) => this.dispatch('regionleave', r)));
    this.offFns.push(player.on('beat', (b) => this.dispatch('beat', b)));
    this.offFns.push(
      player.on('load', (info) => {
        this.dispatch('loaded', info);
        this.paint();
      }),
    );
    this.offFns.push(player.on('error', (err) => this.onPlayerError(err)));
    this.applyPreload();
    this.paint();
  }

  private releaseListeners(): void {
    for (const off of this.offFns) off();
    this.offFns = [];
  }

  private releasePlayer(): void {
    if (this.modular) this.detachModuleSource();
    this.releaseListeners();
    if (this.ownsPlayer) {
      this._player?.dispose();
      this._player = undefined;
    }
    this.ownsPlayer = false;
  }

  // --- attribute reconciliation ---

  /**
   * Reconcile the source with the `src` attribute. attributeChangedCallback
   * ignores changes made while disconnected, so mounting has to notice both a
   * src that changed and one that was removed.
   */
  private applySource(): void {
    if (this.modular && !this.moduleContext) return;
    const src = this.getAttribute('src');
    if (src) {
      if (this.loadController && this.loadingSrc === src) return;
      const stale = this.clipOrigin === 'src' && this.loadedSrc !== src;
      if (stale || (!this._clip && !this._player?.transport)) {
        void this.loadFromSrc(src);
        return;
      }
    } else if (this.clipOrigin === 'src') {
      this.cancelLoad();
      this.clearLoadedClip();
    }
    if (!this._player) this.rebuildPlayer();
    else this.attachPlayer();
  }

  /**
   * The one reconciliation pass over the live knobs. Nothing else replays a
   * change made while disconnected, and a borrowed player never saw the
   * constructor options an owned one gets.
   */
  private applyAttributes(): void {
    this.applyControls();
    // A present attribute wins; an absent one leaves a borrowed player's own
    // value alone.
    for (const name of LIVE_ATTRIBUTES) {
      if (this.hasAttribute(name)) this.applyPlayerAttribute(name);
    }
  }

  /** One live knob, applied to whatever player is current — owned or borrowed. */
  private applyPlayerAttribute(name: string): void {
    if (this.modular && name === 'rate') {
      void this.moduleContext?.session?.setRate(numAttr(this, 'rate', 1, 0.25, 4)).catch((error: unknown) => this.onPlayerError(error));
      return;
    }
    if (this.modular && name === 'loop') { this.applyModuleLoop(); return; }
    const player = this._player;
    if (!player) return;
    try {
      if (name === 'volume') player.setVolume(numAttr(this, 'volume', 1, 0, 4));
      else if (name === 'rate') player.setRate(numAttr(this, 'rate', 1, 0.25, 4));
      else if (name === 'pan') player.setPan(numAttr(this, 'pan', 0, -1, 1));
      else if (name === 'loop') player.setLoop(parseLoopAttr(this.getAttribute('loop')));
      else if (name === 'preserves-pitch') player.setPreservesPitch(boolAttr(this, 'preserves-pitch'));
    } catch (error) {
      this.onPlayerError(error);
    }
  }

  private applyModuleLoop(): void {
    const session = this.moduleContext?.session;
    if (!session) return;
    const loop = parseLoopAttr(this.getAttribute('loop'));
    const duration = session.snapshot.durationSeconds;
    if (loop === true && !(duration !== null && Number.isFinite(duration) && duration > 0)) return;
    const region = !loop ? null : loop === true
      ? {startSeconds: 0, endSeconds: duration!}
      : {startSeconds: loop.start, endSeconds: loop.end};
    const key = JSON.stringify(region);
    if (this.moduleLoopKey === key) return;
    this.moduleLoopKey = key;
    void session.setLoop(region).catch((error: unknown) => this.onPlayerError(error));
  }

  /**
   * `controls` gates visibility only: the transport stays mounted and
   * subscribed, so hiding it costs neither the playhead nor a re-subscription.
   * It is reflected as a host attribute the shadow stylesheet keys on.
   *
   * The default is VISIBLE, unlike `<audio controls>`. This element exists to
   * be a transport, so an absent attribute cannot mean "no UI" without
   * silently blanking every tag already on a page; `controls="false"` is the
   * documented opt-out, and it is what the attribute has always meant here.
   */
  private applyControls(): void {
    // Without a mounted transport there is nothing to show or hide (SSR, or a
    // DOM-free lifecycle harness).
    if (!this.transportHandle) return;
    const controls = this.getAttribute('controls');
    const visible = this.modular
      ? controls === 'show' || (controls !== 'hide' && controls !== 'false' && (!this.parentModuleContext?.session || this.getAttribute('session') === 'local'))
      : boolAttr(this, 'controls', true);
    if (visible) this.removeAttribute('data-controls');
    else this.setAttribute('data-controls', 'hidden');
  }

  /**
   * `preload` warms the whole first-play path — context, graph and the decoded
   * buffer or the media element — so the first play does not hitch. It follows
   * <audio>: `preload="none"` (like the other false spellings) opts out.
   */
  private applyPreload(): void {
    const raw = this.getAttribute('preload');
    if (raw === null || raw.trim().toLowerCase() === 'none') return;
    if (!boolAttr(this, 'preload')) return;
    void this.preload().catch((error: unknown) => this.onPlayerError(error));
  }

  // --- rendering ---

  private scheduleRender(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    const run = () => {
      this.rafScheduled = false;
      this.renderRafId = null;
      if (!this.isConnected) return;
      this.paint();
      if (this.modular && this.playing && this.getAttribute('data-controls') !== 'hidden' && typeof requestAnimationFrame !== 'undefined') this.scheduleRender();
    };
    if (typeof requestAnimationFrame !== 'undefined') this.renderRafId = requestAnimationFrame(run);
    else run();
  }

  private cancelScheduledRender(): void {
    if (this.renderRafId != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.renderRafId);
    this.renderRafId = null;
    this.rafScheduled = false;
  }

  /**
   * Mount the transport once per connected lifetime. Everything an attribute
   * can change afterwards is a repaint or a host-attribute toggle, so no
   * attribute costs the presenter its listeners or its drag state.
   */
  private render(): void {
    if (!this.root) return;
    if (!this.root.ownerDocument) return;
    this.transportHandle?.destroy();
    this.transportHandle = this.mountTransportUI(this.root);
    this.appendCompatibilityStyle();
    if (this.modular && !this.root.querySelector('slot')) this.root.append(this.ownerDocument.createElement('slot'));
    this.applyControls();
  }

  private paint(): void {
    this.transportHandle?.update();
  }

  /**
   * A seek the element's own transport performed, announced for hosts that
   * mirror the playhead (a bound <audio-view>, an analytics listener).
   */
  private commitUserSeek(fraction: number): void {
    const player = this._player;
    if (!player) return;
    this.seekFraction(fraction);
    this.notifyUI();
    const seconds = this.seconds;
    const region = this.regionAt(seconds);
    const detail: AudioPlayerSeekDetail = {
      seconds,
      ...(region ? {region} : {}),
      progress: fraction,
    };
    this.dispatch('seek', detail);
  }

  /** The region the playhead landed in, matching <audio-view>'s seek detail. */
  private regionAt(seconds: number): Region | undefined {
    for (const region of this.clip?.regions ?? []) {
      const end = region.endSeconds ?? region.startSeconds;
      if (seconds >= region.startSeconds && seconds <= end) return region;
    }
    return undefined;
  }

  private announceSource(): void {
    const clip = this.clip;
    const player = this._player;
    if (clip === this.announcedClip && player === this.announcedPlayer) return;
    // Commit before notifying: a listener can select a newer source immediately.
    this.announcedClip = clip;
    this.announcedPlayer = player;
    const detail: AudioPlayerElementSourceDetail = {clip, revision: ++this.sourceRevision};
    this.dispatch('sourcechange', detail);
  }

  private notifyUI(): void {
    for (const notify of this.uiSubscribers) notify();
  }

  /**
   * Re-append the ONE compatibility style node — the presenter's destroy()
   * removes only its own nodes, so a per-render style would accumulate.
   */
  private appendCompatibilityStyle(): void {
    if (!this.root?.ownerDocument) return;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = this.root.ownerDocument.createElement('style');
      this.compatibilityStyle.textContent =
        ':host{display:block;box-sizing:border-box;inline-size:100%;min-inline-size:0;max-inline-size:100%}:host([hidden]){display:none}.wui-transport.wrap{' +
        'min-height:var(--wap-height,44px);height:auto;box-sizing:border-box;' +
        '--cp-gap:var(--wm-transport-gap,var(--wm-control-gap,.75rem));' +
        'background:var(--wm-audio-player-surface-background,var(--wm-transport-surface-background,var(--wm-component-background,var(--wap-bg,var(--wm-surface,#fff)))));' +
        'border:var(--wm-audio-player-surface-border,var(--wm-transport-surface-border,var(--wm-component-border,1px solid var(--wm-border,#d8d8d8))));' +
        'padding:var(--wm-audio-player-surface-padding,var(--wm-transport-surface-padding,var(--wm-component-padding,.6rem)));' +
        'border-radius:var(--wm-audio-player-surface-radius,var(--wm-transport-surface-radius,var(--wm-component-radius,var(--wap-radius,var(--wm-control-radius,0)))));' +
        // A bridge has to feed the presenter's TOKENS. `color` alone reaches
        // only the root: the kit gives the clock and the button glyph their own
        // colour rules, and `--wm-transport-accent` has no reader at all — the
        // fill token is `--wm-transport-fill`. Feed the private compatibility
        // seam so inherited public tokens still work when no legacy alias is set.
        '--cp-text:var(--wap-fg,var(--wm-transport-foreground,var(--wm-component-foreground,var(--wm-foreground-muted,#444))));' +
        '--cp-button-color:var(--wap-fg,var(--wm-transport-button-foreground,var(--wm-accent-foreground,#fff)));' +
        '--cp-fill:var(--wap-accent,var(--wm-transport-fill,var(--wm-accent,#999)));' +
        '--cp-track:var(--wap-track,var(--wm-transport-track,var(--wm-surface-muted,#f3f3f3)))}' +
        ':host([data-controls="hidden"]) .wui-transport{display:none}';
    }
    this.root.append(this.compatibilityStyle);
  }

  private dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(`webaudio:${type}`, {detail, bubbles: true, composed: true}));
  }
}

/** Register `<audio-player>` (or a custom tag). Idempotent, SSR-safe. */
export function defineAudioPlayerElement(tag = 'audio-player'): void {
  defineOnce(tag, AudioPlayerElement);
}
