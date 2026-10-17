import {compressor, delay, filter, gain, type Effect} from '../headless/effects';
import type {EffectInstance, InsertChain} from '@webmusic/kernel/effect';
import type {ModuleHandle} from '@webmusic/kernel/module';
import {notifyModuleChange, observeModuleContext, observeModuleTarget} from '@webmusic/kernel/element';
import {WebMusicElement, upgradeProperties} from './internal/base';

let declarationSequence = 0;

/** A nonvisual declaration of one insert, owned by its target's live chain. */
export class AudioEffectElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return [...EFFECT_ATTRIBUTES, 'target'];
  }

  /** Stable runtime identity; changing a DOM id never transfers an instance. */
  readonly slotId = `audio-effect-${++declarationSequence}`;
  private explicitEffect?: Effect;
  private recipe?: Effect;
  private explicitModuleTarget?: ModuleHandle | null;
  private target?: ModuleHandle;
  private chain?: InsertChain;
  private instance?: EffectInstance;
  private instanceModule?: ModuleHandle;
  private resolutionRelease?: () => void;
  private targetRelease?: () => void;
  private chainRelease?: () => void;
  private generation = 0;
  private reconciling = false;
  private configurationRevision = 0;
  private bindingGeneration = 0;
  private readonly listeners = new Set<() => void>();

  /** Custom recipe, overriding the built-in `type` and numeric attributes. */
  set effect(effect: Effect | undefined) {
    this.configurationRevision += 1;
    this.explicitEffect = effect;
    this.recipe = undefined;
    if (this.isConnected) this.reconcile();
  }
  get effect(): Effect | undefined { return this.explicitEffect; }

  /** Object target takes precedence over the `target` selector and context. */
  set moduleTarget(target: ModuleHandle | null | undefined) {
    this.configurationRevision += 1;
    this.explicitModuleTarget = target;
    if (this.isConnected) this.bind();
  }
  get moduleTarget(): ModuleHandle | null | undefined { return this.explicitModuleTarget; }

  /** Panels borrow this exact realized instance; no second effect is built. */
  get module(): ModuleHandle | undefined { return this.instanceModule; }

  protected override onMount(): void {
    this.generation += 1;
    this.style.setProperty('display', 'none');
    upgradeProperties(this, ['effect', 'moduleTarget']);
    this.bind();
  }

  protected override onUnmount(): void {
    const generation = ++this.generation;
    try { this.releaseResolution(); } catch (error) { this.reportError(error); }
    // Synchronous layout moves retain their slot/instance/order. A real
    // removal releases this declaration alone at the next microtask.
    queueMicrotask(() => {
      if (this.isConnected || generation !== this.generation) return;
      try { this.detachChain(); } catch (error) { this.reportError(error); }
    });
  }

  attributeChangedCallback(name: string): void {
    this.configurationRevision += 1;
    if (name === 'target') {
      if (this.isConnected) this.bind();
      return;
    }
    this.recipe = undefined;
    if (this.isConnected) this.reconcile();
  }

  private releaseResolution(): void {
    this.bindingGeneration += 1;
    const releases = [this.resolutionRelease, this.targetRelease];
    this.resolutionRelease = this.targetRelease = undefined;
    this.target = undefined;
    let failure: unknown;
    for (const release of releases) {
      try { release?.(); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }

  private bind(): void {
    this.releaseResolution();
    const generation = this.bindingGeneration;
    const bind = (target: ModuleHandle | undefined): void => {
      if (generation !== this.bindingGeneration || !this.isConnected) return;
      this.targetRelease?.();
      this.targetRelease = undefined;
      this.target = target;
      if (target?.subscribe) {
        const release = target.subscribe(() => {
          if (generation === this.bindingGeneration && target === this.target) this.reconcile();
        });
        if (generation === this.bindingGeneration && target === this.target) this.targetRelease = release;
        else release();
      }
      this.reconcile();
    };
    const ownResolution = (release: () => void): void => {
      if (generation === this.bindingGeneration && this.isConnected) this.resolutionRelease = release;
      else release();
    };
    if (this.explicitModuleTarget !== undefined) bind(this.explicitModuleTarget ?? undefined);
    else if (this.hasAttribute('target')) {
      ownResolution(observeModuleTarget(this, this.getAttribute('target') ?? '', bind));
    } else {
      ownResolution(observeModuleContext(this, (context) => bind(context?.target)));
    }
  }

  private reconcile(): void {
    if (!this.isConnected || this.reconciling) return;
    this.reconciling = true;
    const revision = this.configurationRevision;
    const generation = this.bindingGeneration;
    try {
      const next = this.target?.inserts;
      if (next !== this.chain || next?.disposed) this.detachChain();
      if (!next || next.disposed) return;
      const recipe = this.recipe ?? this.explicitEffect ?? declaredEffect(this);
      const existing = next.instances.find((instance) => instance.slotId === this.slotId);
      if (existing?.recipe !== recipe) {
        next.setSlot({id: this.slotId, recipe});
      }
      if (!this.isConnected || generation !== this.bindingGeneration || next !== this.target?.inserts) {
        if (!next.disposed) next.removeSlot(this.slotId);
        if (this.isConnected) queueMicrotask(() => this.reconcile());
        return;
      }
      this.recipe = recipe;
      if (this.chain !== next) {
        this.chain = next;
        this.chainRelease = next.subscribe(() => this.publishInstance());
      }
      this.publishInstance();
    } catch (error) {
      this.reportError(error);
    } finally {
      this.reconciling = false;
      if (this.isConnected && revision !== this.configurationRevision) queueMicrotask(() => this.reconcile());
    }
  }

  private publishInstance(): void {
    const instance = this.chain?.disposed ? undefined : this.chain?.instances.find((entry) => entry.slotId === this.slotId);
    if (instance === this.instance) return;
    this.instance = instance;
    this.instanceModule = instance ? {
      id: instance.id,
      params: instance.params,
      subscribe: (notify) => {
        this.listeners.add(notify);
        return () => { this.listeners.delete(notify); };
      },
    } : undefined;
    for (const listener of [...this.listeners]) {
      if (!this.listeners.has(listener)) continue;
      try { listener(); } catch (error) { this.reportError(error); }
    }
    notifyModuleChange(this);
  }

  private reportError(error: unknown): void {
    this.dispatchEvent(new CustomEvent('webaudio:error', {
      detail: error, bubbles: true, composed: true,
    }));
  }

  private detachChain(): void {
    const chain = this.chain;
    this.chain = undefined;
    this.chainRelease?.();
    this.chainRelease = undefined;
    try {
      if (chain && !chain.disposed) chain.removeSlot(this.slotId);
    } finally {
      this.publishInstance();
    }
  }
}

const EFFECT_ATTRIBUTES = [
  'type', 'gain', 'frequency', 'q', 'filter-type', 'time', 'feedback',
  'wet', 'dry', 'threshold', 'ratio', 'knee', 'attack', 'release',
] as const;

/** Attribute recipes stay lazy: declaration/discovery never creates audio. */
function declaredEffect(host: Element): Effect {
  const number = (name: string): number | undefined => {
    const raw = host.getAttribute(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value)) {
      throw new TypeError(`audio-effect ${name} must be a finite number.`);
    }
    return value;
  };
  switch (host.getAttribute('type') ?? 'gain') {
    case 'gain': return gain({value: number('gain')});
    case 'filter': {
      const type = host.getAttribute('filter-type') ?? 'lowpass';
      if (!['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'].includes(type)) {
        throw new TypeError(`Unknown audio-effect filter-type: ${type}`);
      }
      return filter({type: type as BiquadFilterType, frequency: number('frequency'), Q: number('q'), gain: number('gain')});
    }
    case 'delay': return delay({delaySeconds: number('time'), feedback: number('feedback'), wet: number('wet'), dry: number('dry')});
    case 'compressor': return compressor({threshold: number('threshold'), ratio: number('ratio'), knee: number('knee'), attack: number('attack'), release: number('release')});
    default: throw new TypeError(`Unknown audio-effect type: ${host.getAttribute('type')}`);
  }
}

export function defineAudioEffectElement(tag = 'audio-effect'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, AudioEffectElement);
  }
}
