import {observeElementTarget, type ElementTargetState} from '@webmusic/kernel/element';
import type {AudioClip} from '../../../core';

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
): () => void {
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
    const current = () => !disposed && generation === ownGeneration && host.getAttribute('player') === selector;
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
