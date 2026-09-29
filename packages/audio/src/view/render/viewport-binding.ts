import type {AudioViewportHandle, AudioViewportSnapshot} from '../core/types';
import type {AudioTimeline} from '../headless/timeline';

/** Borrowed viewport synchronization returned by {@link bindAudioTimelineViewport}. */
export interface AudioTimelineViewportBinding {
  /** Detach both subscriptions without disposing the timeline or viewport. */
  unsubscribe(): void;
}

/**
 * Keep a headless AudioTimeline and a rendered waveform viewport in sync.
 *
 * The timeline owns logical zoom/offset. The DOM viewport owns its measured
 * width and manual-scroll input. Updates are guarded in both directions so
 * synchronous subscribers converge without feedback loops.
 */
export function bindAudioTimelineViewport(
  timeline: AudioTimeline,
  viewport: AudioViewportHandle,
): AudioTimelineViewportBinding {
  assertMatchingDuration(timeline.snapshot.durationSeconds, viewport.snapshot.durationSeconds);
  let synchronizing = false;
  let unsubscribed = false;
  const cleanups: Array<() => void> = [];

  const pushTimeline = (): void => {
    if (synchronizing || unsubscribed) return;
    synchronizing = true;
    try {
      pushTimelineWhileGuarded(timeline, viewport);
    } finally {
      synchronizing = false;
    }
  };

  const pullViewport = (snapshot: AudioViewportSnapshot): void => {
    if (synchronizing || unsubscribed) return;
    synchronizing = true;
    try {
      pullViewportWhileGuarded(timeline, viewport, snapshot);
    } finally {
      synchronizing = false;
    }
  };

  try {
    cleanups.push(timeline.subscribe(pushTimeline));
    cleanups.push(viewport.subscribe(pullViewport));

    // Initial ownership is deliberate: the measured DOM width enters the
    // model first, then the model's clamped zoom/offset are applied atomically.
    synchronizing = true;
    try {
      const measured = viewport.snapshot;
      if (timeline.snapshot.viewportWidth !== measured.viewportWidth) {
        timeline.setGeometry({viewportWidth: measured.viewportWidth});
      }
      pushTimelineWhileGuarded(timeline, viewport);
    } finally {
      synchronizing = false;
    }
  } catch (error) {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // Preserve the subscription/setup failure as the actionable cause.
      }
    }
    throw error;
  }

  return {
    unsubscribe(): void {
      if (unsubscribed) return;
      unsubscribed = true;
      let failed = false;
      let firstError: unknown;
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      }
      if (failed) throw firstError;
    },
  };
}

function pushTimelineWhileGuarded(
  timeline: AudioTimeline,
  viewport: AudioViewportHandle,
): void {
  const model = timeline.snapshot;
  const surface = viewport.snapshot;
  if (
    model.pixelsPerSecond !== surface.pixelsPerSecond ||
    model.offsetPixels !== surface.offsetPixels
  ) {
    // One transaction matters: the requested offset may only become valid at
    // the requested zoom, so it must not be clamped against the old scale.
    viewport.setViewport({
      pixelsPerSecond: model.pixelsPerSecond,
      offsetPixels: model.offsetPixels,
    });
  }

  // Read back measured/clamped DOM geometry. Width always belongs to the
  // surface; offset can differ when its duration or layout constrained it.
  const applied = viewport.snapshot;
  const current = timeline.snapshot;
  if (
    current.viewportWidth !== applied.viewportWidth ||
    current.offsetPixels !== applied.offsetPixels
  ) {
    timeline.setGeometry({
      viewportWidth: applied.viewportWidth,
      offsetPixels: applied.offsetPixels,
    });
  }
}

function pullViewportWhileGuarded(
  timeline: AudioTimeline,
  viewport: AudioViewportHandle,
  surface: AudioViewportSnapshot,
): void {
  const before = timeline.snapshot;
  if (
    before.viewportWidth !== surface.viewportWidth ||
    before.pixelsPerSecond !== surface.pixelsPerSecond ||
    before.offsetPixels !== surface.offsetPixels
  ) {
    timeline.setGeometry({
      viewportWidth: surface.viewportWidth,
      pixelsPerSecond: surface.pixelsPerSecond,
      offsetPixels: surface.offsetPixels,
    });
  }

  // The model may clamp an external scroll/zoom. Push that canonical result
  // back once so both sides finish on the same geometry.
  const model = timeline.snapshot;
  const current = viewport.snapshot;
  if (
    current.pixelsPerSecond !== model.pixelsPerSecond ||
    current.offsetPixels !== model.offsetPixels
  ) {
    viewport.setViewport({
      pixelsPerSecond: model.pixelsPerSecond,
      offsetPixels: model.offsetPixels,
    });
  }
}

function assertMatchingDuration(timelineDuration: number, viewportDuration: number): void {
  const tolerance = Math.max(1, timelineDuration, viewportDuration) * 1e-6;
  if (Math.abs(timelineDuration - viewportDuration) <= tolerance) return;
  throw new RangeError(
    'AudioTimeline and waveform viewport must represent the same duration before binding.',
  );
}
