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
import {
  mountTransport,
  type TransportBinding,
  type TransportHandle,
} from '@webmusic/ui/transport';

const PROPS = ['clip', 'player', 'effect', 'audioContext'] as const;

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

  protected override onMount(): void {
    // Register rollback before lazy-property setters can rebuild resources.
    this.own(() => this.teardown());
    this.mounted = true;
    upgradeProperties(this, PROPS);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.render();
    if (!this._player) this.rebuildPlayer();
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
    if (!this.isConnected) return;
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
  }
  get player(): AudioPlayer | undefined {
    return this._player;
  }

  set effect(effect: Effect | undefined) {
    this._effect = effect;
    if (this.isConnected && (this.ownsPlayer || !this._player)) this.rebuildPlayer(true);
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
    await this._player?.play(when);
    this.notifyUI();
  }

  pause(): void {
    this._player?.pause();
    this.notifyUI();
  }

  stop(): void {
    this._player?.stop();
    this.notifyUI();
  }

  /**
   * PlayerLike-compatible transport forwarding for bindings such as
   * <audio-view>. Deliberately silent: the view dispatches its own
   * `webaudio:seek` and then drives us through here, and announcing it a
   * second time would echo the view's own event back at it.
   */
  seek(seconds: number): void {
    this._player?.seek(seconds);
    this.notifyUI();
  }

  seekFraction(fraction: number): void {
    this._player?.seekFraction(fraction);
    this.notifyUI();
  }

  /** Begin audible scrubbing when the current player owns decoded PCM. */
  beginScratch(): AudioScratchSession | undefined {
    return this._player?.beginScratch();
  }

  scrub(deltaSeconds: number): void {
    this._player?.scrub(deltaSeconds);
    this.notifyUI();
  }

  /** Warm the context, the graph and the decoded buffer / media element. */
  async preload(): Promise<void> {
    await this._player?.preload();
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
    } catch (err) {
      if (token !== this.loadToken) return;
      this.loadController = null;
      this.onPlayerError(err);
    }
  }

  // --- getters ---

  get currentTime(): number {
    return this._player?.seconds ?? 0;
  }

  get seconds(): number {
    return this.currentTime;
  }

  get duration(): number {
    return this._player?.duration ?? this._clip?.duration ?? 0;
  }

  get scratching(): boolean {
    return this._player?.scratching ?? false;
  }

  get playing(): boolean {
    return this._player?.playing ?? false;
  }

  /**
   * The active engine's transport clock — the position axis a sync bridge or a
   * view anchors against. `undefined` until the engine exists (it is built on
   * first play) and on the media engine, which owns no clock.
   */
  get clock(): TransportClockReader | undefined {
    return this._player?.clock;
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
        playing: this._player?.playing ?? false,
        progress: this._player?.progress ?? 0,
        seconds: this._player?.seconds ?? 0,
        duration: this._player?.duration ?? this._clip?.duration ?? 0,
        disabled: !this._player || (!this._player.clip && !this._player.transport),
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

  protected teardown(): void {
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
    // Latest-wins: rapid src changes fire one load each; only the newest
    // generation may commit its clip (or report its failure).
    const {token, controller} = this.beginLoad();
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
      this._clip = clip;
      this.clipOrigin = 'src';
      this.loadedSrc = src;
      this.rebuildPlayer();
    } catch (err) {
      if (token !== this.loadToken) return; // a stale failure is not ours to report
      this.loadController = null;
      this.onPlayerError(err);
    }
  }

  private beginLoad(): {token: number; controller: AbortController} {
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    return {token: ++this.loadToken, controller};
  }

  private cancelLoad(): void {
    this.loadToken++;
    this.loadController?.abort();
    this.loadController = null;
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
    return this.suppliedContext ?? this.ownedContext;
  }

  /**
   * The context every player and decode gets: the one a host supplied, else
   * this element's own, created on first need — never at construction, where
   * there may be no Web Audio (SSR) and where a context created before a user
   * gesture would only sit suspended.
   */
  private ensureAudioContext(): AudioContext | undefined {
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
      return;
    }
    this.releasePlayer();
    const clip = this._clip;
    // An empty core is immediately connectable without allocating audio resources.
    const context = this.suppliedContext ?? this.ownedContext;
    const options: AudioPlayerOptions = {
      engine,
      mediaAdapterFactory: browserMediaAdapterFactory,
      ...(this.hasAttribute('loop') ? {loop: parseLoopAttr(this.getAttribute('loop'))} : {}),
      ...(this.hasAttribute('preserves-pitch') ? {preservesPitch: boolAttr(this, 'preserves-pitch')} : {}),
      ...(this.hasAttribute('volume') ? {volume: numAttr(this, 'volume', 1, 0, 4)} : {}),
      ...(this.hasAttribute('rate') ? {rate: numAttr(this, 'rate', 1, 0.25, 4)} : {}),
      ...(this.hasAttribute('pan') ? {pan: numAttr(this, 'pan', 0, -1, 1)} : {}),
      ...(context ? {audioContext: context} : {}),
      ...(this._effect ? {effect: this._effect} : {}),
    };
    this._player = this.createPlayer(clip, options);
    this.playerEngine = engine;
    this.ownsPlayer = true;
    this.attachPlayer();
    this.announceSource();
    this.dispatch('playerchange', {player: this._player});
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
    const src = this.getAttribute('src');
    if (src) {
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
    if (boolAttr(this, 'controls', true)) this.removeAttribute('data-controls');
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
    player.seekFraction(fraction);
    this.notifyUI();
    const seconds = player.seconds;
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
