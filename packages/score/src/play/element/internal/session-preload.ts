import {getAudioContextConstructor} from '@webmusic/kernel/audio-context';
import type {ModuleSession} from '@webmusic/kernel/session';

/**
 * Whether an Element preloads on mount (DEC-069): on by default, opted out by
 * `preload="none"` or another false spelling, as on `<audio>`.
 */
export function preloadEnabled(element: Element): boolean {
  const raw = element.getAttribute('preload');
  if (raw === null) return true;
  return !['none', 'false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
}

/**
 * Keep a Session an Element owns preloaded: prepare every member as soon as
 * it joins — the AudioContext (created suspended; the first play resumes it
 * from its gesture), each engine's graph and samples, its desk channel and
 * the inserts on it — so the Element and its companions show their real
 * surface before the first play. A page without Web Audio skips it, and the
 * playback path still prepares on play. Returns the release.
 */
export function keepSessionPreloaded(
  session: ModuleSession, canAllocate: () => boolean, onError: (error: unknown) => void,
): () => void {
  let released = false;
  let scheduled = false;
  const run = (): void => {
    scheduled = false;
    if (released || !canAllocate()) return;
    let pending: Promise<void>;
    try { pending = session.preload(); } catch (error) { if (!released) onError(error); return; }
    void pending.catch((error: unknown) => { if (!released) onError(error); });
  };
  const schedule = (): void => {
    if (scheduled || released) return;
    scheduled = true;
    queueMicrotask(run);
  };
  const unsubscribe = session.subscribe((event) => { if (event.type === 'participants') schedule(); });
  schedule();
  return () => {
    released = true;
    unsubscribe();
  };
}

/** An environment that can create an AudioContext, or already has one. */
export function audioAvailable(peek: () => BaseAudioContext | undefined): boolean {
  return !!peek() || !!getAudioContextConstructor();
}
