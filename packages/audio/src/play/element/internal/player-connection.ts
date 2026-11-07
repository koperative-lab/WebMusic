import {observeModuleContext} from '@webmusic/kernel/element';
import type {AudioPlayer} from '../../headless/audio-player';
import {AUDIO_PLAYER_OWNER} from '../../../core/player-owner';

/** Borrow a Headless owner directly, or its canonical browser adapter. */
export type AudioPlayerTarget = AudioPlayer | {readonly player?: AudioPlayer};

/** The element surface a companion commands instead of the Headless owner. */
export interface AudioPlayerAdapter {
  clip?: unknown;
  play(): Promise<void>;
  stop(): void;
}

export {AUDIO_PLAYER_OWNER};

function resolveOwner(value: AudioPlayerTarget | undefined): AudioPlayer | undefined {
  if (!value) return undefined;
  const candidate = 'player' in value ? value.player : value;
  return candidate && 'setTransport' in candidate && 'setClip' in candidate &&
    typeof candidate.setTransport === 'function' &&
    typeof candidate.setClip === 'function' ? candidate : undefined;
}

/** Browser-only discovery; attaching and releasing playback is the companion's job. */
export class AudioPlayerConnection {
  private assigned?: AudioPlayerTarget;
  private owner?: AudioPlayer;
  private target?: AudioPlayerTarget;
  private observer?: MutationObserver;
  private active = false;
  private generation = 0;
  private waitingTag?: string;
  private contextOwner?: AudioPlayerTarget;
  private stopContext?: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly changed: (owner: AudioPlayer | undefined) => void,
    private readonly failed: (error: unknown) => void,
    /** Attach to the enclosing player's scope without an explicit link. */
    private readonly implicit = true,
  ) {}

  /** An `input` attribute (or the retired `player` alias) or an assigned object links explicitly. */
  get explicit(): boolean { return this.assigned !== undefined || this.selector !== null; }

  private get selector(): string | null {
    return this.host.getAttribute('input') ?? this.host.getAttribute('player');
  }

  get player(): AudioPlayer | undefined { return this.owner; }

  /**
   * The linked browser adapter (an `<audio-player>`), when the link resolved
   * through one. Commands sent to it reach its Session; commands sent to the
   * Headless owner directly would bypass it (DEC-068).
   */
  get adapter(): AudioPlayerAdapter | undefined {
    const target = this.target as Partial<AudioPlayerAdapter> | undefined;
    return target && target !== this.owner && typeof target.play === 'function' && typeof target.stop === 'function'
      && 'clip' in target ? target as AudioPlayerAdapter : undefined;
  }
  get requested(): boolean {
    return this.explicit || (this.implicit && this.contextOwner !== undefined);
  }

  set(value: AudioPlayerTarget | undefined): void {
    this.assigned = value;
    this.refresh();
  }

  connect(): void {
    if (this.active) return;
    this.active = true;
    const root = this.host.getRootNode?.();
    if (typeof MutationObserver !== 'undefined' && root && 'querySelectorAll' in root) {
      this.observer = new MutationObserver(() => this.refresh());
      this.observer.observe(root, {childList: true, subtree: true, attributes: true, attributeFilter: ['id']});
    }
    if (this.implicit) {
      this.stopContext = observeModuleContext(this.host, (context) => {
        this.contextOwner = context?.capabilities.get(AUDIO_PLAYER_OWNER) as AudioPlayerTarget | undefined;
        this.refresh();
      });
    }
    this.refresh();
  }

  disconnect(): void {
    this.active = false;
    this.generation++;
    this.waitingTag = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.stopContext?.();
    this.stopContext = undefined;
    this.contextOwner = undefined;
    this.listen(undefined);
    this.commit(undefined);
  }

  refresh(): void {
    if (!this.active) return;
    let target = this.assigned;
    const selector = this.selector;
    if (!target && selector) {
      try {
        const root = this.host.getRootNode?.() as ParentNode | undefined;
        const matches = root?.querySelectorAll(selector) ?? [];
        if (matches.length === 1 && matches[0] !== this.host) target = matches[0] as unknown as AudioPlayerTarget;
      } catch (error) {
        this.listen(undefined);
        this.commit(undefined);
        this.failed(error);
        return;
      }
    } else if (!target && !selector && this.implicit) {
      target = this.contextOwner;
    }
    this.listen(target);
    this.commit(resolveOwner(target));
    const element = target as Partial<Element> | undefined;
    const tag = element?.localName;
    const registry = this.host.ownerDocument?.defaultView?.customElements;
    if (tag?.includes('-') && registry && !registry.get(tag) && this.waitingTag !== tag) {
      const generation = this.generation;
      this.waitingTag = tag;
      void registry.whenDefined(tag).then(() => {
        if (!this.active || generation !== this.generation) return;
        this.waitingTag = undefined;
        this.refresh();
      });
    }
  }

  private readonly targetChanged = (): void => this.refresh();

  private listen(target: AudioPlayerTarget | undefined): void {
    if (target === this.target) return;
    const old = this.target as Partial<EventTarget> | undefined;
    old?.removeEventListener?.('webaudio:playerchange', this.targetChanged);
    this.target = target;
    const next = target as Partial<EventTarget> | undefined;
    next?.addEventListener?.('webaudio:playerchange', this.targetChanged);
  }

  private commit(owner: AudioPlayer | undefined): void {
    if (owner === this.owner) return;
    this.owner = owner;
    this.changed(owner);
  }
}
