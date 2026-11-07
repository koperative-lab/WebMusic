import {observeModuleContext, type ElementTargetState} from '@webmusic/kernel/element';
import type {AudioClip} from '../../../core';
import {getModulePort, type ModuleHandle, type TransportPort, type TransportPortSnapshot} from '@webmusic/kernel/module';
import {bindModuleAudioInput} from '../../../play/element/internal/module-input';
import {observeCompanionTarget} from '../../../play/element/internal/companion-target';

export interface AnalysisPlayerTarget extends Element {
  readonly clip?: AudioClip;
  readonly transport?: unknown;
  readonly currentTime?: number;
  readonly seconds?: number;
  readonly duration?: number;
  readonly playing?: boolean;
  readonly loading?: boolean;
  readonly loadError?: Error;
  readonly analyser?: AnalyserNode;
  seek?(seconds: number): void | Promise<void>;
}

export interface AnalysisPlayerSnapshot {
  target?: AnalysisPlayerTarget;
  clip?: AudioClip;
  seconds: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  /** Only an owner explicitly exposing clip data can establish an empty source. */
  empty: boolean;
  loadError?: Error;
  state: ElementTargetState | 'unbound';
}

export type AnalysisPlayerUpdate = 'target' | 'source' | 'time' | 'state' | 'seek' | 'end';

/** Tap one module audio input (explicit or by containment) and follow its Session transport; listeners live only as long as this binding. */
export function bindAnalysisPlayer(
  host: Element,
  onUpdate: (kind: AnalysisPlayerUpdate, snapshot: AnalysisPlayerSnapshot) => void,
  assigned?: ModuleHandle | null,
  isCurrent: () => boolean = () => true,
): () => void {
  // A tap follows the scope's Session transport so seek, pause and end
  // reset history as they do for a linked player (DEC-068).
  let tapped: AnalysisPlayerTarget | undefined;
  let transport: TransportPort | undefined;
  let last: TransportPortSnapshot | undefined;
  let stopTransport: (() => void) | undefined;
  // The owning player element (the `input` target, or the enclosing player by
  // containment) supplies source readiness: loading, failure and an empty clip.
  let owner: AnalysisPlayerTarget | undefined;
  let ownerState: AnalysisPlayerSnapshot['state'] = 'unbound';
  const reading = (state: TransportPortSnapshot | undefined): AnalysisPlayerSnapshot => {
    const clip = owner?.clip;
    return {
      target: tapped ?? owner, clip, seconds: state?.position ?? 0,
      duration: state?.durationSeconds ?? clip?.duration ?? 0,
      playing: tapped ? state?.playing ?? true : false,
      loading: owner?.loading === true, loadError: owner?.loadError,
      empty: !!owner && 'clip' in owner && !clip && !owner.transport,
      state: tapped ? 'ready' : ownerState,
    };
  };
  const follow = (next: TransportPort | undefined): void => {
    if (next === transport) return;
    stopTransport?.(); stopTransport = undefined;
    transport = next; last = next?.snapshot();
    stopTransport = next?.subscribe((state) => {
      if (!isCurrent() || !tapped) { last = state; return; }
      const previous = last;
      last = state;
      if (state.ended && !previous?.ended) { onUpdate('end', reading(state)); return; }
      const expected = previous ? previous.position + (previous.playing ? (state.referenceTime - previous.referenceTime) * previous.rate : 0) : state.position;
      if (!previous || state.playing !== previous.playing || Math.abs(state.position - expected) > 0.05) onUpdate('seek', reading(state));
    });
  };
  // An explicitly linked module lends its own Session transport; otherwise
  // follow the enclosing scope's.
  let scopeTransport: TransportPort | undefined;
  let linkedTransport: TransportPort | undefined;
  const stopContext = observeModuleContext(host, (context) => {
    scopeTransport = context?.transport;
    follow(linkedTransport ?? scopeTransport);
  });
  // Resolve the owner before tapping so its first reading selects the target
  // and the tap that follows does not count as a second source change.
  let detachOwner: (() => void) | undefined;
  const stopOwner = assigned !== undefined ? () => undefined : observeCompanionTarget(host, (element, state) => {
    detachOwner?.(); detachOwner = undefined;
    owner = element as AnalysisPlayerTarget | undefined;
    ownerState = owner ? state : host.hasAttribute('input') ? state : 'unbound';
    host.setAttribute('data-player-state', ownerState);
    if (!isCurrent()) return;
    // Once tapped, an owner change is a source change; before, it selects the target.
    onUpdate(tapped ? 'source' : 'target', reading(last));
    const target = owner;
    if (!target) return;
    // Owner events report readiness only; a replaced audio source arrives as a
    // re-tap of the module port, so an unchanged readiness emits nothing.
    const readiness = () => `${target.loading === true}|${String(target.loadError ?? '')}|${target.clip === undefined}`;
    let seen = readiness();
    const refresh: EventListener = (event) => {
      if (event.target !== target || owner !== target || !isCurrent()) return;
      const next = readiness();
      if (next === seen && tapped) return;
      seen = next;
      onUpdate('source', reading(last));
    };
    const names = ['webaudio:sourcechange', 'webaudio:playerchange', 'webaudio:loadstatechange', 'webaudio:loaded'];
    for (const name of names) target.addEventListener(name, refresh);
    detachOwner = () => { for (const name of names) target.removeEventListener(name, refresh); };
  });
  const stopInput = bindModuleAudioInput(host, assigned, ({analyser, module, error}) => {
    linkedTransport = module ? getModulePort(module, 'transport', 'transport') : undefined;
    follow(linkedTransport ?? scopeTransport);
    tapped = analyser ? {analyser, playing: true} as AnalysisPlayerTarget : undefined;
    onUpdate('target', reading(last));
    if (error !== undefined && isCurrent()) {
      host.dispatchEvent(new CustomEvent('webaudio:error', {
        detail: {error: error instanceof Error ? error : new Error(String(error))},
        bubbles: true, composed: true,
      }));
    }
  }, isCurrent);
  return () => {
    try { stopInput(); } finally {
      stopContext(); stopTransport?.(); stopTransport = undefined;
      stopOwner(); detachOwner?.(); detachOwner = undefined; owner = undefined;
    }
  };
}
