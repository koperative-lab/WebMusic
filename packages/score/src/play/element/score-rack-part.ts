import type {Score} from '../../core';
import type {ScoreFormat} from '../../io/load';
import type {HeadlessSynth} from '../headless/audio-contracts';
import {Sound} from '../headless/sound';
import {
  RACK_PART_EVENT,
  isRackDesk,
  type RackPartDeclaration,
  type ModuleRackPartHost,
} from './internal/rack-part';
import {WebMusicElement, upgradeProperties} from './internal/base';
import {isModularComposition, observeModuleContext, requestModuleContext} from '@webmusic/kernel/element';
import type {ModuleHandle} from '@webmusic/kernel/module';
import type {SessionTransport} from '@webmusic/kernel/session';

export interface RackPartErrorDetail {
  operation: 'rack-part';
  error: unknown;
}

/** Oscillator names `sound` accepts, so a part can be voiced from markup. */
const OSCILLATORS = new Set<OscillatorType>(['sine', 'square', 'sawtooth', 'triangle']);

/**
 * One voice of a {@link RackControlElement} desk, declared in markup.
 *
 * ```html
 * <score-rack-control>
 *   <score-rack-part id="lead" src="lead.mid" sound="triangle"></score-rack-part>
 *   <score-rack-part id="bass" src="bass.mid" sound="sawtooth"></score-rack-part>
 * </score-rack-control>
 * ```
 *
 * It is a DECLARATION, not a player: it renders nothing, owns no engine, and
 * has no transport. What it names becomes a member of the desk's `Rack`, and
 * the rack builds the headless `ScorePlayer` that actually plays it — a member
 * was never an element, and this is how one is written down without pretending
 * otherwise. The player wrapping the desk moves every part in lockstep.
 *
 * Outside a `<score-rack-control>` it does nothing at all, quietly. There is no
 * standalone meaning for one voice of a desk that is not there.
 */
export class RackPartElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['id', 'src', 'format', 'sound'];
  }

  private explicitScore?: Score;
  private explicitSound?: HeadlessSynth;
  private resolved?: Score;
  private voiced?: {name: string; synth: HeadlessSynth};
  private loadToken = 0;
  private loadController?: AbortController;
  private pendingSource?: ReturnType<SessionTransport['holdPendingSource']>;
  private pendingSession?: SessionTransport;
  private sourceLoadFailed = false;
  private sourceLoadError?: unknown;
  private modular = false;
  private modularDesk?: Element;

  override disconnectedCallback(): void {
    if (!this.modular) { super.disconnectedCallback(); return; }
    queueMicrotask(() => { if (!this.isConnected) super.disconnectedCallback(); });
  }

  /** Borrow the desk-owned runtime without creating another source or route. */
  get module(): ModuleHandle | undefined {
    const desk = this.parentElement as Partial<ModuleRackPartHost> | null;
    return desk?.rackPartModule?.(this);
  }

  protected override onMount(): void {
    this.modular = isModularComposition(this);
    this.modularDesk = this.parentElement ?? undefined;
    // This tag is a declaration, not a visual control. Keep that contract in
    // the component itself so a page never needs a docs-only `display:none`.
    (this as unknown as HTMLElement).style?.setProperty('display', 'none');
    upgradeProperties(this, ['score', 'sound']);
    this.own(() => this.cancelLoad());
    if (this.modular) {
      let firstReady = true;
      this.own(observeModuleContext(this, (context, state) => {
        this.reservePendingSource(context?.session);
        if (state !== 'ready') return;
        if (this.modularDesk !== this.parentElement) {
          const previous = this.modularDesk;
          this.modularDesk = this.parentElement ?? undefined;
          // Retire the previous owned declaration before a running new desk
          // can prepare the same borrowed Sound backend.
          previous?.dispatchEvent(new CustomEvent(RACK_PART_EVENT));
        }
        const needsResolution = firstReady || (!this.resolved && !this.loadController);
        firstReady = false;
        if (needsResolution && !this.sourceLoadFailed) {
          void this.resolve();
        }
        else this.announce();
      }));
    } else void this.resolve();
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected) return;
    // Only the score source has to be fetched again. Re-resolving for an
    // identity or voice change would refetch the file AND hand the desk a new
    // Score identity, which it reads as a redeclaration — and `Rack.add` on an
    // existing id disposes the live player. Renaming or changing an oscillator
    // should only ask the desk to reconcile the declaration it already has.
    if (name === 'id' || name === 'sound') this.announce();
    else void this.resolve();
  }

  /** A score assigned directly, which wins over `src`. */
  set score(score: Score | undefined) {
    this.explicitScore = score;
    if (this.isConnected) void this.resolve();
  }

  get score(): Score | undefined {
    return this.explicitScore;
  }

  /** A synth assigned directly, which wins over the `sound` attribute. */
  set sound(sound: HeadlessSynth | undefined) {
    this.explicitSound = sound;
    if (this.isConnected) this.announce();
  }

  get sound(): HeadlessSynth | undefined {
    return this.explicitSound;
  }

  /**
   * What this part contributes, or undefined until it has a score.
   *
   * Read by the desk rather than pushed to it: the desk may upgrade after this
   * element does — custom-element upgrade is grouped by tag, not by tree
   * position — so a declaration that could only be delivered by event would be
   * lost whenever `rack-part` happened to be defined first.
   */
  rackPartDeclaration(): RackPartDeclaration | undefined {
    if (!this.resolved) return undefined;
    const sound = this.explicitSound ?? this.declaredSound();
    return {
      id: this.id || `part-${this.position()}`,
      score: this.resolved,
      ...(sound ? {sound} : {}),
    };
  }

  /**
   * The synth this part's `sound` names, built once per value.
   *
   * Memoized because the desk decides whether to redeclare a member by
   * comparing what it was declared WITH. A fresh `Sound.oscillator()` on every
   * read is never equal to the last one, so every reconcile would look like a
   * change — and a redeclaration disposes the member's live player.
   */
  private declaredSound(): HeadlessSynth | undefined {
    const named = this.getAttribute('sound');
    if (!named) {
      this.voiced = undefined;
      return undefined;
    }
    if (this.voiced?.name === named) return this.voiced.synth;
    if (!OSCILLATORS.has(named as OscillatorType)) {
      this.reportError(new Error(`<score-rack-part sound="${named}"> is not an oscillator type.`));
      return undefined;
    }
    this.voiced = {name: named, synth: Sound.oscillator({type: named as OscillatorType})};
    return this.voiced.synth;
  }

  /** Position among the desk's parts, for a part nobody named. */
  private position(): number {
    const desk = this.parentElement;
    if (!desk) return 1;
    return Array.from(desk.children).indexOf(this) + 1;
  }

  private async resolve(): Promise<void> {
    this.cancelLoad();
    const token = this.loadToken;
    if (this.explicitScore) {
      this.resolved = this.explicitScore;
      this.announce();
      return;
    }
    const src = this.getAttribute('src');
    if (!src) {
      this.resolved = undefined;
      this.announce();
      return;
    }
    if (!this.parentElement || !isRackDesk(this.parentElement)) return;
    const controller = new AbortController();
    this.loadController = controller;
    this.reservePendingSource(isModularComposition(this) ? requestModuleContext(this)?.session : undefined);
    try {
      const {loadScoreFromUrl} = await import('../../io/load');
      if (controller.signal.aborted) return;
      const format = this.getAttribute('format') as ScoreFormat | null;
      const score = await loadScoreFromUrl(src, {...(format ? {format} : {}), signal: controller.signal});
      if (token !== this.loadToken || !this.isConnected) return;
      this.resolved = score;
      this.announce();
      if (token !== this.loadToken || !this.isConnected) return;
      if (this.pendingSource && !this.module) throw new Error('The Rack did not accept the loaded score declaration.');
      this.pendingSource?.resolve();
      this.pendingSource = undefined;
      this.pendingSession = undefined;
    } catch (error) {
      if (token !== this.loadToken || controller.signal.aborted) return;
      this.sourceLoadFailed = true;
      this.sourceLoadError = error;
      this.pendingSource?.reject(error);
      this.reportError(error);
    } finally {
      if (this.loadController === controller) this.loadController = undefined;
    }
  }

  private cancelLoad(): void {
    this.loadToken += 1;
    const controller = this.loadController;
    this.loadController = undefined;
    controller?.abort();
    this.pendingSource?.release();
    this.pendingSource = undefined;
    this.pendingSession = undefined;
    this.sourceLoadFailed = false;
    this.sourceLoadError = undefined;
  }

  /** A fetch can survive a layout move, but its readiness belongs to the current Session. */
  private reservePendingSource(session: SessionTransport | undefined): void {
    if (session === this.pendingSession && this.pendingSource?.active) return;
    this.pendingSource?.release();
    this.pendingSource = undefined;
    this.pendingSession = undefined;
    if (!session || (!this.loadController && !this.sourceLoadFailed)) return;
    const pending = session.holdPendingSource();
    this.pendingSession = session;
    this.pendingSource = pending;
    if (this.sourceLoadFailed) pending.reject(this.sourceLoadError);
  }

  /** Nudge the desk to pull again. It reconciles; this only says "now". */
  private announce(): void {
    if (!this.parentElement || !isRackDesk(this.parentElement)) return;
    this.dispatchEvent(new CustomEvent(RACK_PART_EVENT, {bubbles: true, composed: true}));
  }

  protected reportError(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent<RackPartErrorDetail>('webscore:error', {
        detail: {operation: 'rack-part', error},
        bubbles: true,
        composed: true,
      }),
    );
  }
}

export function defineRackPartElement(tag = 'score-rack-part'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, RackPartElement);
  }
}
