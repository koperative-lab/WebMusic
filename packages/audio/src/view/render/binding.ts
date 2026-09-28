// ============================================================================
// bindPlayerToWaveform — wire a structural player to a rendered visualizer.
//
// The player is a structural `ViewPlayerBinding` ({on, seek, seconds, duration}) — a
// subset of AudioClipPlayer — so this renderer never imports @webmusic/audio/play.
// Active players with live state are observed on display frames; legacy sources
// move on `timeupdate`. Both borrow player seconds without another clock. When
// `seekOnClick` is on, pointer clicks on the surface hit-test to a time and
// call `player.seek`. `draggableRegions` lets a drag create a region and emits
// the new region list back to the caller via `onRegionChange`.
//
// Returns `{ unsubscribe() }` mirroring WebScore's binding shape.
// ============================================================================

import {createRegion, type Region} from '../../core';
import type {RenderedAudioVisualizer, ViewPlayerBinding} from '../core/types';

/** Detail shape of an AudioClipPlayer `timeupdate` event. */
interface TimeUpdatePayload {
  seconds?: number;
  duration?: number;
  progress?: number;
}

/** Options for {@link bindPlayerToWaveform}. */
export interface BindWaveformOptions {
  /** Auto-scroll the playhead into view as it advances. Default false. */
  followPlayhead?: boolean;
  /** Clicking the surface seeks the player. Default true. */
  seekOnClick?: boolean;
  /** Drag on the surface to create a region. Default false. */
  draggableRegions?: boolean;
  /**
   * The DOM surface to attach pointer listeners to. No default: pass the same
   * `container` you gave the renderer to enable pointer interactions.
   */
  surface?: HTMLElement;
  /** Called with the updated region list after a drag creates one. */
  onRegionChange?: (regions: readonly Region[]) => void;
}

/** The handle returned by {@link bindPlayerToWaveform}. */
export interface WaveformBinding {
  /** Detach all listeners. Idempotent. */
  unsubscribe(): void;
}

/**
 * Bind a `ViewPlayerBinding` to a {@link RenderedAudioVisualizer}: observe live
 * playback on display frames (or legacy `timeupdate`), seek on click, and
 * optionally drag out regions.
 */
export function bindPlayerToWaveform(
  player: ViewPlayerBinding,
  viz: RenderedAudioVisualizer,
  options: BindWaveformOptions = {},
): WaveformBinding {
  const followPlayhead = options.followPlayhead ?? false;
  const seekOnClick = options.seekOnClick ?? true;
  const draggableRegions = options.draggableRegions ?? false;
  const surface = options.surface;

  const cleanups: Array<() => void> = [];
  let unsubscribed = false;
  const unsubscribe = (): void => {
    if (unsubscribed) return;
    unsubscribed = true;
    let failed = false;
    let firstError: unknown;
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        if (!failed) { failed = true; firstError = error; }
      }
    }
    if (failed) throw firstError;
  };

  const ownerDocument = surface?.ownerDocument ?? (typeof document === 'undefined' ? undefined : document);
  const view = ownerDocument?.defaultView;
  const requestFrame = view?.requestAnimationFrame?.bind(view);
  const cancelFrame = view?.cancelAnimationFrame?.bind(view);
  const observesFrames = !!requestFrame &&
    (typeof player.playing === 'boolean' || typeof player.scratching === 'boolean');
  const active = (): boolean => player.playing === true || player.scratching === true;
  const visible = (): boolean => ownerDocument?.visibilityState !== 'hidden';
  let frame: number | undefined;
  let frameRevision = 0;
  let lastSeconds: number | undefined;
  let ended = false;
  const stopFrame = (): void => {
    frameRevision++;
    if (frame !== undefined) cancelFrame?.(frame);
    frame = undefined;
  };
  cleanups.push(stopFrame);

  const paint = (seconds: number, follow: boolean, currentFrame: boolean, force = false): void => {
    if (unsubscribed || !Number.isFinite(seconds) || (!force && seconds === lastSeconds)) return;
    lastSeconds = seconds;
    if (currentFrame && viz.redrawFrame) viz.redrawFrame(seconds, follow);
    else viz.redraw(seconds, follow);
  };
  const observePosition = (currentFrame: boolean): void => {
    const seconds = player.seconds;
    if (!unsubscribed) paint(seconds, followPlayhead, currentFrame);
  };
  const startFrame = (): void => {
    if (!observesFrames || unsubscribed || ended || frame !== undefined || !visible() || !active()) return;
    const revision = frameRevision;
    frame = requestFrame!(() => {
      if (unsubscribed || revision !== frameRevision) return;
      frame = undefined;
      if (!visible()) return;
      // Also read the final paused position before retiring this observation.
      // The player may pause between frames without emitting a timeupdate.
      observePosition(true);
      if (revision === frameRevision) startFrame();
    });
  };
  const onVisibility = (): void => {
    stopFrame();
    if (unsubscribed || ended || !visible()) return;
    const revision = frameRevision;
    observePosition(true);
    if (revision === frameRevision) startFrame();
  };

  try {
    cleanups.push(player.on('timeupdate', (payload: unknown) => {
      if (unsubscribed) return;
      ended = false;
      if (observesFrames) {
        if (!visible()) { stopFrame(); return; }
        if (active()) {
          // The next display frame reads the latest authority. Do not queue an
          // extra event-driven paint alongside the existing frame observer.
          startFrame();
        } else {
          stopFrame();
          observePosition(false);
        }
        return;
      }
      const detail = (payload ?? {}) as TimeUpdatePayload;
      const seconds = typeof detail.seconds === 'number' ? detail.seconds : player.seconds;
      paint(seconds, followPlayhead, false, true);
    }));
    cleanups.push(player.on('end', () => {
      ended = true;
      stopFrame();
      // Preserve the binding's terminal reset while updating the same display
      // projection used by ordinary frames (including Element timeline/ARIA).
      paint(0, false, false, true);
    }));
    if (observesFrames) {
      ownerDocument?.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => ownerDocument?.removeEventListener('visibilitychange', onVisibility));
      if (visible()) {
        const revision = frameRevision;
        observePosition(true);
        if (revision === frameRevision) startFrame();
      }
    }

    if (surface && (seekOnClick || draggableRegions)) {
      let dragStartSeconds: number | null = null;
      let activePointer: number | undefined;
      let regions: Region[] = [];

      const secondsFor = (event: PointerEvent): number => {
        const rect = surface.getBoundingClientRect();
        return viz.hitTest(event.clientX - rect.left, event.clientY - rect.top).seconds;
      };
      const clearDrag = (): void => {
        const pointer = activePointer;
        dragStartSeconds = null;
        activePointer = undefined;
        if (pointer !== undefined) {
          try {
            if (surface.hasPointerCapture?.(pointer)) surface.releasePointerCapture(pointer);
          } catch {
            // A detached/retired surface may no longer own the pointer.
          }
        }
      };
      const onPointerDown = (event: PointerEvent): void => {
        if (unsubscribed || event.button !== 0 || event.isPrimary === false) return;
        const seconds = secondsFor(event);
        if (draggableRegions) {
          clearDrag();
          dragStartSeconds = seconds;
          activePointer = event.pointerId;
          try {
            if (activePointer !== undefined) surface.setPointerCapture?.(activePointer);
          } catch {
            // Synthetic events and detached hosts may not support capture.
          }
        } else if (seekOnClick) {
          // Ordinary seeking commits on press exactly once; release is only
          // an annotation gesture's commit boundary.
          player.seek(seconds);
        }
      };
      const onPointerUp = (event: PointerEvent): void => {
        if (
          unsubscribed || event.button !== 0 || event.isPrimary === false ||
          !draggableRegions || dragStartSeconds === null ||
          event.pointerId !== activePointer
        ) return;
        const seconds = secondsFor(event);
        const start = Math.min(dragStartSeconds, seconds);
        const end = Math.max(dragStartSeconds, seconds);
        clearDrag();
        if (end - start > 1e-3) {
          const region = createRegion({label: '', startSeconds: start, endSeconds: end});
          regions = [...regions, region];
          viz.setRegions(regions);
          options.onRegionChange?.(regions);
        } else if (seekOnClick) {
          player.seek(seconds);
        }
      };
      const onPointerCancel = (event: PointerEvent): void => {
        if (event.pointerId === activePointer) clearDrag();
      };
      cleanups.push(() => {
        surface.removeEventListener('pointerdown', onPointerDown as EventListener);
        surface.removeEventListener('pointerup', onPointerUp as EventListener);
        surface.removeEventListener('pointercancel', onPointerCancel as EventListener);
        surface.removeEventListener('lostpointercapture', onPointerCancel as EventListener);
        clearDrag();
      });
      surface.addEventListener('pointerdown', onPointerDown as EventListener);
      surface.addEventListener('pointerup', onPointerUp as EventListener);
      surface.addEventListener('pointercancel', onPointerCancel as EventListener);
      surface.addEventListener('lostpointercapture', onPointerCancel as EventListener);
    }
  } catch (error) {
    try { unsubscribe(); } catch { /* Preserve the setup failure. */ }
    throw error;
  }
  return {unsubscribe};
}
