import {mountTransport, type TransportBinding} from '@webmusic/ui/transport';
import type {ModuleSession} from '@webmusic/kernel/session';
import type {ScorePlayerModule} from '../../headless/score-module';
import type {PresetPlayerHandle, TimeControl, VolumeControl} from './preset-player';

/** The inline `display` a node had before it was first hidden here. */
const shownDisplay = new WeakMap<HTMLElement, string>();

/**
 * Author layout rules can override the user-agent [hidden] declaration, so a
 * hidden node also gets `display: none`. Showing it restores the inline value
 * it had before: an inline-painted presenter keeps its own `display: flex`.
 */
export function setModuleTransportVisibility(element: HTMLElement, visible: boolean): void {
  if (!shownDisplay.has(element)) shownDisplay.set(element, element.style.display === 'none' ? '' : element.style.display);
  element.hidden = !visible;
  element.style.display = visible ? shownDisplay.get(element)! : 'none';
}

function requestFrame(callback: () => void): number {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(() => callback());
  return globalThis.setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

/**
 * Session events mark state changes only; its position advances between them.
 * Redraw on every event, and once per frame while the Session runs.
 */
function followSession(session: ModuleSession, notify: () => void): () => void {
  let frame: number | undefined;
  let closed = false;
  const schedule = () => {
    if (closed || frame !== undefined) return;
    const state = session.snapshot;
    if (state.paused || state.disposed) return;
    frame = requestFrame(() => {
      frame = undefined;
      if (closed) return;
      notify();
      schedule();
    });
  };
  const unsubscribe = session.subscribe(() => {
    if (closed) return;
    notify();
    schedule();
  });
  schedule();
  return () => {
    closed = true;
    unsubscribe();
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
  };
}

/** A control view of Session authority; participant engines are never commanded here. */
export function mountModuleTransport(
  container: HTMLElement,
  session: ModuleSession,
  module: ScorePlayerModule | undefined,
  options: {visible: boolean; time: TimeControl; volume: VolumeControl; getVolume(): number; onVolumeChange(value: number): void; onError(error: unknown): void},
): PresetPlayerHandle {
  const play = async () => { await session.play(); };
  const seek = async (seconds: number) => { await session.seek(seconds); };
  const seekFraction = async (value: number) => {
    const duration = session.snapshot.durationSeconds;
    if (duration === null) throw new Error('Session duration is not available.');
    await seek(Math.max(0, Math.min(1, value)) * duration);
  };
  const binding: TransportBinding = {
    snapshot: () => {
      const state = session.snapshot;
      const duration = state.durationSeconds ?? 0;
      return {
        playing: !state.paused,
        seconds: state.position,
        duration,
        progress: duration > 0 ? Math.max(0, Math.min(1, state.position / duration)) : 0,
        disabled: state.disposed,
        volume: module ? options.getVolume() : undefined,
      };
    },
    play,
    pause: () => { void session.pause().catch(options.onError); },
    seekFraction,
    ...(module ? {setVolume: (value: number) => options.onVolumeChange(value)} : {}),
    subscribe: (notify) => followSession(session, notify),
  };
  const ui = mountTransport(container, binding, {
    label: 'Score session', showTime: true, seekControl: 'surface', onError: options.onError,
  });
  setModuleTransportVisibility(ui.element, options.visible);
  const setChrome: PresetPlayerHandle['setChrome'] = (chrome) => {
    if (chrome.time !== undefined && ui.controls.time) setModuleTransportVisibility(ui.controls.time, chrome.time !== 'off');
    if (chrome.time !== undefined && ui.controls.timeTotal) setModuleTransportVisibility(ui.controls.timeTotal, chrome.time === 'full');
    if (chrome.volume !== undefined) ui.setVolumeControl(chrome.volume === 'off' ? false : chrome.volume);
  };
  setChrome({time: options.time, volume: options.volume});
  return {
    element: ui.element as HTMLDivElement,
    button: ui.controls.play,
    progress: ui.controls.track as HTMLDivElement,
    progressFill: ui.controls.fill!,
    player: module?.player,
    play,
    pause: binding.pause,
    stop: () => { void session.stop().catch(options.onError); },
    seek,
    seekFraction,
    get currentTime() { return session.snapshot.position; },
    get duration() { return session.snapshot.durationSeconds ?? 0; },
    isPlaying: () => !session.snapshot.paused,
    setChrome,
    destroy: () => ui.destroy(),
  };
}
