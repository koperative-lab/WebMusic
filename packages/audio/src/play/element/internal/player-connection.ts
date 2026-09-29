import type {AudioPlayer} from '../../headless/audio-player';

/** Borrow a Headless owner directly, or its canonical browser adapter. */
export type AudioPlayerTarget = AudioPlayer | {readonly player?: AudioPlayer};

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

  constructor(
    private readonly host: HTMLElement,
    private readonly changed: (owner: AudioPlayer | undefined) => void,
    private readonly failed: (error: unknown) => void,
  ) {}

  get player(): AudioPlayer | undefined { return this.owner; }
  get requested(): boolean {
    return this.assigned !== undefined || this.host.hasAttribute('player') ||
      !!this.host.parentElement?.closest('audio-player');
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
    this.refresh();
  }

  disconnect(): void {
    this.active = false;
    this.generation++;
    this.waitingTag = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.listen(undefined);
    this.commit(undefined);
  }

  refresh(): void {
    if (!this.active) return;
    let target = this.assigned;
    const selector = this.host.getAttribute('player');
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
    } else if (!target && !selector) {
      target = this.host.parentElement?.closest('audio-player') as unknown as AudioPlayerTarget | undefined;
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
