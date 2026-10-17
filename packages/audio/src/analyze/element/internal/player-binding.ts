import {observeElementTarget, type ElementTargetState} from '@webmusic/kernel/element';
import type {AudioClip} from '../../../core';
import type {ModuleHandle} from '@webmusic/kernel/module';
import {isModularComposition} from '@webmusic/kernel/element';
import {bindModuleAudioInput} from '../../../play/element/internal/module-input';

export interface AnalysisPlayerTarget extends Element {
  readonly clip?: AudioClip;
  readonly currentTime?: number;
  readonly seconds?: number;
  readonly duration?: number;
  readonly playing?: boolean;
  readonly analyser?: AnalyserNode;
  seek?(seconds: number): void | Promise<void>;
}

export interface AnalysisPlayerSnapshot {
  target?: AnalysisPlayerTarget;
  clip?: AudioClip;
  seconds: number;
  duration: number;
  playing: boolean;
  state: ElementTargetState | 'unbound';
}

export type AnalysisPlayerUpdate = 'target' | 'source' | 'time' | 'state' | 'seek' | 'end';

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function snapshot(target: AnalysisPlayerTarget | undefined, state: AnalysisPlayerSnapshot['state']): AnalysisPlayerSnapshot {
  const clip = target?.clip;
  return {
    target,
    clip,
    seconds: Math.max(0, finite(target?.currentTime) ?? finite(target?.seconds) ?? 0),
    duration: Math.max(0, finite(target?.duration) ?? clip?.duration ?? 0),
    playing: target?.playing === true,
    state,
  };
}

/** Borrow one browser player; selection and listeners live only as long as this binding. */
export function bindAnalysisPlayer(
  host: Element,
  onUpdate: (kind: AnalysisPlayerUpdate, snapshot: AnalysisPlayerSnapshot) => void,
  assigned?: ModuleHandle | null,
  isCurrent: () => boolean = () => true,
): () => void {
  if (assigned !== undefined || host.hasAttribute('input') || (!host.hasAttribute('player') && isModularComposition(host))) {
    return bindModuleAudioInput(host, assigned, ({analyser, error}) => {
      const target = analyser ? {analyser, playing: true} as AnalysisPlayerTarget : undefined;
      onUpdate('target', {target, seconds: 0, duration: 0, playing: !!analyser, state: analyser ? 'ready' : 'unbound'});
      if (error !== undefined && isCurrent()) {
        host.dispatchEvent(new CustomEvent('webaudio:error', {
          detail: {error: error instanceof Error ? error : new Error(String(error))},
          bubbles: true, composed: true,
        }));
      }
    }, isCurrent);
  }
  const selector = host.getAttribute('player');
  if (!selector) {
    onUpdate('target', snapshot(undefined, 'unbound'));
    return () => undefined;
  }

  let disposed = false;
  let generation = 0;
  let detach: (() => void) | undefined;
  const attach = (element: Element | undefined, state: ElementTargetState): void => {
    if (disposed || host.getAttribute('player') !== selector) return;
    detach?.();
    detach = undefined;
    const ownGeneration = ++generation;
    const target = element as AnalysisPlayerTarget | undefined;
    const current = () => !disposed && isCurrent() && generation === ownGeneration && host.getAttribute('player') === selector;
    host.setAttribute('data-player-state', state);
    onUpdate('target', snapshot(target, state));
    if (!target || !current()) return;

    const listeners: Array<[string, EventListener]> = [];
    const add = (name: string, kind: AnalysisPlayerUpdate, override?: (event: Event) => Partial<AnalysisPlayerSnapshot>) => {
      const listener: EventListener = (event) => {
        if (event.target !== target || !current()) return;
        const reading = {...snapshot(target, state), ...override?.(event)};
        onUpdate(kind, reading);
      };
      target.addEventListener(name, listener);
      listeners.push([name, listener]);
    };
    add('webaudio:sourcechange', 'source', (event) => {
      const detail = (event as CustomEvent<{clip?: AudioClip}>).detail;
      return detail && 'clip' in detail ? {clip: detail.clip} : {};
    });
    add('webaudio:playerchange', 'source');
    add('webaudio:loaded', 'source');
    add('webaudio:timeupdate', 'time', (event) => {
      const seconds = finite((event as CustomEvent<{seconds?: number}>).detail?.seconds);
      return seconds === undefined ? {} : {seconds: Math.max(0, seconds)};
    });
    add('webaudio:statechange', 'state', (event) => {
      const playing = (event as CustomEvent<{playing?: boolean}>).detail?.playing;
      return typeof playing === 'boolean' ? {playing} : {};
    });
    add('webaudio:seek', 'seek');
    add('webaudio:end', 'end', () => ({playing: false}));
    detach = () => {
      for (const [name, listener] of listeners) target.removeEventListener(name, listener);
    };
  };

  let stopObservation: (() => void) | undefined;
  try {
    stopObservation = observeElementTarget(host, selector, attach);
  } catch (error) {
    detach?.();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    stopObservation?.();
    detach?.();
    detach = undefined;
  };
}
