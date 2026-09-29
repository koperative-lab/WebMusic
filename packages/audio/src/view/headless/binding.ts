import type {ViewPlayerBinding} from '../core/types';

export interface PlayheadTarget {
  setPlayhead(seconds: number): void;
  followPlayhead?(anchor?: number): void;
}

export interface BindAudioTimelineOptions {
  followPlayhead?: boolean;
  followAnchor?: number;
  resetOnEnd?: boolean;
}

export interface AudioTimelineBinding {
  unsubscribe(): void;
}

/** Bind player events to a code-level playhead model; no input surface involved. */
export function bindPlayerToAudioTimeline(
  player: ViewPlayerBinding,
  target: PlayheadTarget,
  options: BindAudioTimelineOptions = {},
): AudioTimelineBinding {
  const update = (payload: unknown): void => {
    const seconds = readSeconds(payload, player.seconds);
    target.setPlayhead(seconds);
    if (options.followPlayhead) target.followPlayhead?.(options.followAnchor);
  };
  const cleanups: Array<() => void> = [];
  try {
    cleanups.push(player.on('timeupdate', update));
    if (options.resetOnEnd ?? true) {
      cleanups.push(player.on('end', () => {
        target.setPlayhead(0);
        if (options.followPlayhead) target.followPlayhead?.(options.followAnchor);
      }));
    }
  } catch (error) {
    runCleanups(cleanups);
    throw error;
  }
  let active = true;
  return {
    unsubscribe(): void {
      if (!active) return;
      active = false;
      const failure = runCleanups(cleanups);
      if (failure.failed) throw failure.error;
    },
  };
}

interface CleanupResult {
  failed: boolean;
  error: unknown;
}

function runCleanups(cleanups: readonly (() => void)[]): CleanupResult {
  let failed = false;
  let firstError: unknown;
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  return {failed, error: firstError};
}

function readSeconds(payload: unknown, fallback: number): number {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const seconds = (payload as {seconds?: unknown}).seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : fallback;
}
