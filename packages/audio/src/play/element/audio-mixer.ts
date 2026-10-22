// ============================================================================
// <audio-mixer> — a mixing desk for an AudioMixer: a row of channel strips
// (volume / mute / solo) plus a master fader and shared transport. Assign
// `.mixer` (an existing AudioMixer) or `.members` (clips or players keyed by
// id); the element wires the desk and reflects member changes. Mirrors
// <score-rack>.
//
// Attributes: master-volume  autoplay  solo
// Properties: .mixer .members .audioContext .destination .masterVolume
// Methods: seek(seconds)  add(spec)  remove(id)
// Events (webaudio:*, {bubbles, composed}):
//   end                 every member has finished
//   memberend  {id}     one member finished
//   error      Error    an engine failure (a seek that could not restart the
//                       stems) or a presenter failure — one channel for both
// CSS vars: --wam-bg --wam-fg --wam-accent --wam-track
// ============================================================================

import type {AudioClip} from '../../core';
import {AudioMixer, type AudioMixerOptions} from '../headless/mixer';
import type {PlayerLike} from '../headless/player';
import type {AudioPlayer} from '../headless/audio-player';
import {AudioPlayerConnection, type AudioPlayerTarget} from './internal/player-connection';
import {
  WebMusicElement,
  boolAttr,
  defineOnce,
  numAttr,
  upgradeProperties,
} from './internal/base';
import {type Effect} from '../core/effect';
import {browserMediaAdapterFactory} from './internal/browser-media-adapter';
import {
  mountMixer,
  type MixerBinding,
  type MixerHandle,
  type MixerState,
} from '@webmusic/ui/mixer';

/**
 * One channel strip's source. `clip` has the desk build a player on its own
 * context; `player` lets an already running PlayerLike (another element's
 * player, a score-side player) join without the desk owning it.
 */
export interface AudioMixerMemberSpec {
  id: string;
  clip?: AudioClip;
  player?: PlayerLike;
  effect?: Effect;
  volume?: number;
}

const PROPS = ['player', 'mixer', 'members', 'audioContext', 'destination', 'masterVolume'] as const;

export class AudioMixerElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['player', 'master-volume', 'autoplay', 'solo'];
  }

  protected root?: ShadowRoot;
  private _mixer?: AudioMixer;
  private owner?: AudioPlayer;
  private readonly connection = new AudioPlayerConnection(
    this, (player) => this.attachPlayer(player), (error) => this.onMixerError(error),
  );
  private ownsMixer = false;
  private memberSpecs?: AudioMixerMemberSpec[];
  private offFns: Array<() => void> = [];
  private mixerHandle?: MixerHandle;
  /** Created once and re-appended; a per-render node would accumulate. */
  private compatibilityStyle?: HTMLStyleElement;
  /** Construction input only; a mounted mixer's snapshot owns live values. */
  private initialMasterVolume = 1;
  private contextRef?: AudioContext;
  private destinationRef?: AudioNode;
  private readonly subscribers = new Set<() => void>();

  protected override onMount(): void {
    // Register rollback before lazy-property setters can rebuild resources.
    this.own(() => { this.connection.disconnect(); this.teardown(); });
    upgradeProperties(this, PROPS);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    if (!this._mixer && this.memberSpecs?.length) this.buildOwnedMixer();
    this.attach();
    this.connection.connect();
    if (boolAttr(this, 'autoplay')) this.startAutoplay();
  }

  /**
   * The three attributes are live knobs, applied in place: rebuilding here
   * would restart the very stems this desk exists to keep aligned.
   */
  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === 'player') { this.connection.refresh(); this.render(); return; }
    if (name === 'master-volume') {
      this.applyMasterVolume(numAttr(this, 'master-volume', 1, 0));
    } else if (name === 'solo') {
      // Removing the attribute clears the solo rather than freezing it.
      this.applySolo(this.getAttribute('solo') || null);
    } else if (name === 'autoplay' && boolAttr(this, 'autoplay')) {
      this.startAutoplay();
    }
  }

  // --- properties ---

  /** Borrow the central owner; the desk supplies its existing mixer backend. */
  set player(player: AudioPlayerTarget | undefined) {
    this.connection.set(player);
    if (this.isConnected) this.render();
  }
  get player(): AudioPlayer | undefined { return this.connection.player; }

  /** Borrow an existing mixer; the element never disposes what it borrows. */
  set mixer(mixer: AudioMixer | undefined) {
    if (mixer && mixer === this._mixer) return;
    this.detach();
    this._mixer = mixer;
    this.memberSpecs = undefined;
    this.ownsMixer = false;
    if (this.isConnected) this.attach();
  }
  get mixer(): AudioMixer | undefined {
    return this._mixer;
  }

  /** Declare the membership and let the element build (and own) the mixer. */
  set members(specs: readonly AudioMixerMemberSpec[] | undefined) {
    this.detach();
    this._mixer = undefined;
    this.memberSpecs = specs?.length ? [...specs] : undefined;
    if (!this.memberSpecs) {
      if (this.isConnected) this.render();
      return;
    }
    if (this.isConnected) {
      this.buildOwnedMixer();
      this.attach();
    }
  }

  /**
   * The specs currently on the desk. Frozen, because what is sounding lives in
   * the mixer: a mutated array here would silently disagree with it — use
   * `add`/`remove` or reassign `members` instead.
   */
  get members(): readonly AudioMixerMemberSpec[] {
    return Object.freeze([...(this.memberSpecs ?? [])]);
  }

  /**
   * Share ONE page-wide AudioContext instead of letting the owned mixer mint
   * its own — separate contexts have separate clocks, which is exactly what
   * stem playback cannot tolerate. A borrowed mixer keeps the context it was
   * built with.
   */
  set audioContext(context: AudioContext | undefined) {
    if (context === this.contextRef) return;
    this.contextRef = context;
    this.rebuildOwnedMixer();
  }
  get audioContext(): AudioContext | undefined {
    return this.contextRef;
  }

  /** Route the desk into an effects chain or a recording node. */
  set destination(destination: AudioNode | undefined) {
    if (destination === this.destinationRef) return;
    this.destinationRef = destination;
    this.rebuildOwnedMixer();
  }
  get destination(): AudioNode | undefined {
    return this.destinationRef;
  }

  /** Master fader position, applied in place on the live mixer. */
  set masterVolume(volume: number) {
    this.applyMasterVolume(volume);
  }
  get masterVolume(): number {
    return this._mixer?.snapshot().masterVolume ?? this.initialMasterVolume;
  }

  // --- engine passthroughs ---

  /** Seek every member to the same position; the mixer re-aligns them. */
  seek(seconds: number): void {
    if (this.owner) this.owner.seek(seconds);
    else if (!this.connection.requested) this._mixer?.seek(seconds);
    this.notifyUI();
  }

  /** Add one member to the live desk, owned mixer or borrowed. */
  add(spec: AudioMixerMemberSpec): void {
    // A borrowed mixer's membership belongs to whoever owns it; only the owned
    // membership is remembered, for `members` and for the next connect.
    if (this.ownsMixer || !this._mixer) this.rememberSpec(spec);
    if (this._mixer) {
      this.addMember(this._mixer, spec);
      this.notifyUI();
      return;
    }
    // Nothing to add to yet: the spec materialises when the desk builds.
    if (this.isConnected) {
      this.buildOwnedMixer();
      this.attach();
    }
  }

  /**
   * Remove one member, dropping its channel-strip state with it. Called with
   * no id it stays `ChildNode.remove()` — an element that could not detach
   * itself would break every host that treats it as an ordinary node.
   */
  remove(id?: string): void {
    if (id === undefined) {
      super.remove();
      return;
    }
    this._mixer?.remove(id);
    if (this.memberSpecs) this.memberSpecs = this.memberSpecs.filter((spec) => spec.id !== id);
    this.notifyUI();
  }

  // --- subclass hooks ---

  /** Replace this hook to change engine options or the mixer type. */
  protected createMixer(options: AudioMixerOptions): AudioMixer {
    return new AudioMixer(options);
  }

  /**
   * Structural UI contract for subclasses that want to retain the stock desk
   * DOM while changing where its values come from.
   */
  protected createMixerBinding(mixer: AudioMixer | undefined): MixerBinding {
    return {
      snapshot: () => this.snapshot(mixer),
      setMaster: (value) => this.applyMasterVolume(value),
      setChannel: (id, value) => {
        mixer?.setVolume(id, value);
        this.notifyUI();
      },
      setMuted: (id, value) => {
        if (value) mixer?.mute(id);
        else mixer?.unmute(id);
        this.notifyUI();
      },
      setSolo: (id) => this.applySolo(id),
      ...(!this.connection.requested ? {
        play: async () => { await mixer?.play(); this.notifyUI(); },
        pause: () => { mixer?.pause(); this.notifyUI(); },
        stop: () => { mixer?.stop(); this.notifyUI(); },
      } : {}),
      // Without a subscription the desk repaints only on its own command
      // round-trip, so an external volume change or a member ending would
      // leave the strips showing yesterday's state.
      subscribe: (notify) => {
        this.subscribers.add(notify);
        return () => this.subscribers.delete(notify);
      },
    };
  }

  /** Replace this hook to provide a completely custom desk. */
  protected mountMixerUI(root: ShadowRoot, mixer: AudioMixer | undefined): MixerHandle {
    return mountMixer(root, this.createMixerBinding(mixer), {
      onError: (error) => this.onMixerError(error),
    });
  }

  /**
   * The desk's one observable failure channel. It deliberately does NOT notify
   * the presenter: this also handles a snapshot that threw, and repainting
   * from here would loop that failure forever.
   */
  protected onMixerError(error: unknown): void {
    this.dispatch('error', error instanceof Error ? error : new Error(String(error)));
  }

  // --- wiring ---

  private attach(): void {
    if (this.owner && this._mixer) this.owner.setTransport(this._mixer.transport);
    this.applyAttributes();
    this.subscribeMixer();
    this.render();
  }

  private attachPlayer(player: AudioPlayer | undefined): void {
    const previous = this.owner;
    this.owner = player;
    if (previous?.transport === this._mixer?.transport) previous?.setTransport(undefined);
    if (player && this._mixer) player.setTransport(this._mixer.transport);
    this.render();
  }

  private subscribeMixer(): void {
    const mixer = this._mixer;
    if (!mixer) return;
    this.offFns.push(
      mixer.on('change', () => this.notifyUI()),
      mixer.on('end', () => {
        this.notifyUI();
        this.dispatch('end', undefined);
      }),
      mixer.on('memberEnd', (detail) => {
        this.notifyUI();
        this.dispatch('memberend', detail);
      }),
      // The engine emits `error` for failures no command round-trip can see
      // (a seek whose restart never lands); unsubscribed, they died here.
      mixer.on('error', (error) => {
        this.notifyUI();
        this.onMixerError(error);
      }),
    );
  }

  private detach(): void {
    if (this.owner?.transport === this._mixer?.transport) this.owner?.setTransport(undefined);
    const subscriptions = this.offFns;
    const owned = this.ownsMixer ? this._mixer : undefined;
    this.offFns = [];
    this.ownsMixer = false;
    if (owned) {
      this.initialMasterVolume = owned.snapshot().masterVolume;
      this._mixer = undefined;
    }
    for (const off of subscriptions) {
      try { off(); } catch (error) { this.onMixerError(error); }
    }
    try { owned?.dispose(); } catch (error) { this.onMixerError(error); }
  }

  private teardown(): void {
    this.detach();
    this.mixerHandle?.destroy();
    this.mixerHandle = undefined;
  }

  private buildOwnedMixer(): void {
    const specs = this.memberSpecs;
    if (!specs?.length) return;
    const mixer = this.createMixer({
      mediaAdapterFactory: browserMediaAdapterFactory,
      masterVolume: this.initialMasterVolume,
      ...(this.contextRef ? {audioContext: this.contextRef} : {}),
      ...(this.destinationRef ? {destination: this.destinationRef} : {}),
    });
    for (const spec of specs) this.addMember(mixer, spec);
    this._mixer = mixer;
    this.ownsMixer = true;
  }

  /** Re-mint only what this element owns: a borrowed graph is not ours to rebuild. */
  private rebuildOwnedMixer(): void {
    if (!this.ownsMixer) return;
    this.detach();
    this.buildOwnedMixer();
    if (this.isConnected) this.attach();
  }

  private addMember(mixer: AudioMixer, spec: AudioMixerMemberSpec): void {
    try {
      mixer.add({
        id: spec.id,
        ...(spec.clip ? {clip: spec.clip} : {}),
        ...(spec.player ? {player: spec.player} : {}),
        ...(spec.effect ? {effect: spec.effect} : {}),
        ...(spec.volume !== undefined ? {volume: spec.volume} : {}),
      });
    } catch (error) {
      // A spec carrying neither clip nor player costs its own strip, not the
      // whole desk.
      this.onMixerError(error);
    }
  }

  /** Same id replaces, mirroring the engine's own add(). */
  private rememberSpec(spec: AudioMixerMemberSpec): void {
    const kept = (this.memberSpecs ?? []).filter((existing) => existing.id !== spec.id);
    kept.push(spec);
    this.memberSpecs = kept;
  }

  private applyMasterVolume(volume: number): void {
    const level = Math.max(0, Number.isFinite(volume) ? volume : 1);
    if (this._mixer) this._mixer.setMasterVolume(level);
    else this.initialMasterVolume = level;
    this.notifyUI();
  }

  private applySolo(id: string | null): void {
    this._mixer?.solo(id);
    this.notifyUI();
  }

  /** A present attribute wins; an absent one leaves the property value alone. */
  private applyAttributes(): void {
    if (this.getAttribute('master-volume') !== null) {
      this.applyMasterVolume(numAttr(this, 'master-volume', this.masterVolume, 0));
    }
    const solo = this.getAttribute('solo');
    if (solo) this.applySolo(solo);
  }

  private startAutoplay(): void {
    const mixer = this._mixer;
    if (!mixer || (!this.owner && this.connection.requested)) return;
    void (this.owner ? this.owner.play() : mixer.play()).then(
      () => this.notifyUI(),
      (error: unknown) => this.onMixerError(error),
    );
  }

  // --- rendering ---

  private render(): void {
    if (!this.root) return;
    if (!this.root.ownerDocument) return;
    this.mixerHandle?.destroy();
    this.mixerHandle = this.mountMixerUI(this.root, this._mixer);
    this.appendCompatibilityStyle();
  }

  private snapshot(mixer: AudioMixer | undefined): MixerState {
    const state = mixer?.snapshot();
    return {
      master: state?.masterVolume ?? this.initialMasterVolume,
      disabled: !mixer || (this.connection.requested && !this.owner),
      status: !mixer || (this.connection.requested && !this.owner) || !state?.members.length
        ? {kind: 'waiting', message: 'Waiting for mixer sources.'}
        : {kind: 'ready'},
      channels: (state?.members ?? []).map((member) => ({
        id: member.id,
        label: member.id,
        value: member.volume,
        muted: member.muted,
        solo: member.solo,
      })),
    };
  }

  /**
   * Re-append the ONE compatibility style node. The presenter handle's
   * destroy() only removes the presenter's own nodes, so creating a fresh
   * style per render grew the shadow root without bound — render() runs again
   * on every `.mixer`/`.members` assignment.
   */
  private appendCompatibilityStyle(): void {
    if (!this.root?.ownerDocument) return;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = this.root.ownerDocument.createElement('style');
      this.compatibilityStyle.textContent =
        ':host{display:block;box-sizing:border-box;inline-size:100%;min-inline-size:0;max-inline-size:100%}:host([hidden]){display:none}.wui-mixer{' +
        'box-sizing:border-box;' +
        'background:var(--wm-audio-mixer-surface-background,var(--wm-mixer-surface-background,var(--wm-component-background,var(--wam-bg,var(--wm-mixer-background,var(--wm-surface,#fff))))));' +
        'border:var(--wm-audio-mixer-surface-border,var(--wm-mixer-surface-border,var(--wm-component-border,1px solid var(--wm-border,#d8d8d8))));' +
        'padding:var(--wm-audio-mixer-surface-padding,var(--wm-mixer-surface-padding,var(--wm-component-padding,.6rem)));' +
        'border-radius:var(--wm-audio-mixer-surface-radius,var(--wm-mixer-surface-radius,var(--wm-component-radius,var(--wm-control-radius,0))));' +
        'color:var(--wam-fg,var(--wm-mixer-text,var(--wm-component-foreground,var(--wm-foreground,#444))));' +
        '--wui-mixer-text:var(--wam-fg,var(--wm-mixer-text,var(--wm-component-foreground,var(--wm-foreground,#444))));' +
        '--wui-mixer-fill:var(--wam-accent,var(--wm-mixer-fill,var(--wm-accent,#999)));' +
        '--wui-mixer-active-background:var(--wam-accent,var(--wm-mixer-fill,var(--wm-accent,#111)));' +
        '--wui-mixer-track:var(--wam-track,var(--wm-mixer-track,var(--wm-surface-muted,#f3f3f3)));' +
        '--wui-mixer-track-border:var(--wam-track-border,var(--wm-mixer-track-border,var(--wm-control-border,var(--wm-border,#d8d8d8))))}';
    }
    this.root.append(this.compatibilityStyle);
  }

  private notifyUI(): void {
    for (const notify of this.subscribers) notify();
  }

  private dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(`webaudio:${type}`, {detail, bubbles: true, composed: true}));
  }
}

/** Register `<audio-mixer>` (or a custom tag). Idempotent, SSR-safe. */
export function defineAudioMixerElement(tag = 'audio-mixer'): void {
  defineOnce(tag, AudioMixerElement);
}
