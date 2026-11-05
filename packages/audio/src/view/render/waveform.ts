// ============================================================================
// renderWaveformVisualizer — Canvas 2D min/max waveform with a separate
// playhead overlay.
//
// Smoothness rules the design:
//
//   • The canvas is the *viewport* size at device resolution and is STATIC — it
//     never moves. Scrolling happens by redrawing its contents at a new offset,
//     so the layer is never composited at a sub-pixel position (which shimmers).
//     A viewport-sized canvas also stays well under the ~16384px backing cap, so
//     a long clip is crisp (a clip-wide canvas would be upscaled = blurry).
//
//   • Columns are painted on integer texels in a bounded offscreen canvas. The
//     completed bitmap is translated once by the fractional `renderOffset`.
//     Separate fractionally aligned rectangles would antialias their shared
//     edges independently, making even a flat waveform pulse in opacity.
//
//   • Native scroll is used ONLY for wheel/trackpad/keyboard panning, on a
//     transparent layer under the canvas whose scrollbar is hidden (Visual
//     design: scrolling surfaces). The render surface is not inside it, so
//     programmatic scroll-syncing never moves (or shimmers) the waveform.
//
//   • Each operation reads layout once, before it writes: the viewport width is
//     measured at the top of every public call, frame and observer callback,
//     and paint() only reads that cached value.
//
// In follow mode the playhead is kept centered: once it passes the middle the
// view scrolls so the line stays put and the waveform slides beneath it (clamped
// at both ends), the way a DAW transport reads.
// ============================================================================

import {peakCount, peaksLevelForResolution, type AudioPeaks, type Region} from '../../core';
import {peaksDuration} from '../headless/peaks';
import {secondsToPixel, pixelToSeconds, clampCanvasBackingSize, MAX_CANVAS_DIMENSION} from '../core/windowing';
import {computeFrameColors, type FrameColors} from '../core/waveform-color';
import type {
  AudioViewport,
  AudioWaveformSource,
  SpectrogramData,
  ViewportAudioVisualizer,
  WaveformRenderOptions,
} from '../core/types';

const DEFAULTS = {
  pixelsPerSecond: 100,
  height: 128,
  amplitude: 1,
  // Direct renderer defaults stay neutral; Elements may supply shared semantic
  // CSS tokens, and callers can override the paint independently of playback.
  waveColor: '#000000',
  progressColor: '#000000',
  playheadColor: '#000000',
} as const;

interface ResolvedRegion {
  region: Region;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Render a waveform into `container` from a precomputed {@link AudioPeaks}
 * pyramid, returning a {@link ViewportAudioVisualizer} handle.
 */
export function renderWaveformVisualizer(
  container: HTMLElement,
  peaks: AudioPeaks | AudioWaveformSource,
  options: WaveformRenderOptions = {},
): ViewportAudioVisualizer {
  let pixelsPerSecond = options.pixelsPerSecond ?? DEFAULTS.pixelsPerSecond;
  const height = options.height ?? DEFAULTS.height;
  const amplitude = options.amplitude ?? DEFAULTS.amplitude;
  const waveColor = options.waveColor ?? DEFAULTS.waveColor;
  const progressColor = options.progressColor ?? DEFAULTS.progressColor;
  const playheadColor = options.playheadColor ?? DEFAULTS.playheadColor;
  const backgroundColor = options.backgroundColor;
  const scrollable = options.scrollable ?? true;
  let playheadMode = options.playheadMode ?? 'position';
  const sequenceSource = 'readPeaks' in peaks ? peaks : undefined;
  const pyramid = 'levels' in peaks ? peaks : undefined;
  const duration = options.durationSeconds ?? (sequenceSource ? sequenceSource.frameCount / sequenceSource.sampleRate : peaksDuration(pyramid!));

  // Frequency-based colouring (miniMeter-style multi-band / colormap). Computed
  // once per frame here — the per-column paint loop only does an array lookup.
  // One entry per channel so a `split` stereo display can colour each half.
  const colorMode = options.colorMode ?? 'static';
  const channelLayout = options.channelLayout ?? 'merge';
  const freqArray = !options.frequencyData
    ? []
    : Array.isArray(options.frequencyData)
      ? options.frequencyData
      : [options.frequencyData as SpectrogramData];
  const colorMapName = typeof options.colorMap === 'string' ? options.colorMap : undefined;
  const historyTrail = Math.max(0, options.historyTrail ?? 0);
  const HISTORY_DIM = 0.32;
  const frameColorsByChannel: Array<FrameColors | undefined> =
    colorMode === 'static'
      ? []
      : freqArray.map((spec) =>
          spec && spec.binsPerFrame > 0
            ? computeFrameColors(spec, colorMode, {bands: options.bands, colorMap: colorMapName})
            : undefined,
        );

  let regions: ResolvedRegion[] = [];
  let playheadSeconds = 0;
  let playheadVisible = true;
  // CSS px of clip scrolled past the left edge — the single, fractional source of
  // truth the waveform and the playhead are both drawn from.
  let renderOffset = 0;
  let disposed = false;
  // Pan and zoom listeners let external controls follow the window this
  // renderer paints; they cannot read it off the DOM because the
  // scroller's `scrollLeft` and the painted offset are deliberately allowed to
  // drift by up to half a pixel.
  const viewportListeners = new Set<(viewport: AudioViewport) => void>();

  // --- DOM scaffold ---
  // outer ─┬─ canvas   (static render surface; redrawn, never moved)
  //        ├─ scroller (transparent; native scrollbar + wheel/drag panning)
  //        │    └─ spacer (full clip width; drives the scroll range)
  //        └─ overlay  (playhead line; positioned by transform)
  const outer = document.createElement('div');
  outer.style.position = 'relative';
  outer.style.width = '100%';
  outer.style.height = `${height}px`;
  outer.style.overflow = 'hidden';

  // The scroller is in-flow (sizes predictably to the box) and owns native
  // wheel/trackpad/keyboard panning. The canvas is absolutely positioned ON TOP
  // of it as a static render surface, so panning the scroller never moves the
  // canvas layer (which is what would shimmer).
  const scroller = document.createElement('div');
  scroller.style.width = '100%';
  scroller.style.height = '100%';
  // `auto` = user can pan; `hidden` locks the surface (follow can still move it).
  scroller.style.overflowX = scrollable && playheadMode === 'position' ? 'auto' : 'hidden';
  scroller.style.overflowY = 'hidden';
  hideScrollbar(scroller);

  const spacer = document.createElement('div');
  spacer.style.height = '1px';
  spacer.style.width = '1px';

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.display = 'block';
  canvas.style.maxWidth = 'none';
  canvas.style.pointerEvents = 'none';
  // One CSS-column texel horizontally, device resolution vertically. This is
  // never attached to the DOM and never widens to the full clip.
  const raster = document.createElement('canvas');

  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '2px';
  overlay.style.height = `${height}px`;
  overlay.style.background = playheadColor;
  overlay.style.pointerEvents = 'none';
  overlay.style.willChange = 'transform';
  overlay.style.transform = 'translateX(0)';

  scroller.appendChild(spacer);
  outer.appendChild(scroller);
  outer.appendChild(canvas);
  outer.appendChild(overlay);
  container.appendChild(outer);

  // Canvas does not resolve CSS custom properties. Resolve each paint through
  // one hidden DOM node in the same inheritance scope, once per redraw rather
  // than once per column. Named/rgb colours and currentColor remain valid too.
  const colorProbe = container.ownerDocument.createElement('span');
  colorProbe.hidden = true;
  colorProbe.setAttribute('aria-hidden', 'true');
  outer.appendChild(colorProbe);
  outer.appendChild(hiddenScrollbarStyle(container.ownerDocument));
  const resolvePaint = (value: string): string => {
    colorProbe.style.color = '';
    colorProbe.style.color = value;
    const computed = container.ownerDocument.defaultView?.getComputedStyle(colorProbe).color;
    return computed && !computed.includes('var(') ? computed : value;
  };
  /**
   * One paint's colour lookups. Every distinct paint string (wave, progress,
   * background, each region colour) costs one style resolution per paint, not
   * one per region; a theme change is picked up by the next paint.
   */
  let paintCache: Map<string, string> | undefined;
  const paintColor = (value: string): string => {
    if (!paintCache) return resolvePaint(value);
    let resolved = paintCache.get(value);
    if (resolved === undefined) {
      resolved = resolvePaint(value);
      paintCache.set(value, resolved);
    }
    return resolved;
  };

  const setRegions = (next: readonly Region[]): void => {
    regions = next.map((region) => ({
      region,
      startSeconds: region.startSeconds,
      endSeconds: region.endSeconds ?? region.startSeconds,
    }));
  };
  setRegions(options.regions ?? []);

  /** Width of the full waveform in CSS px at the current zoom. */
  const fullWidth = (): number => Math.max(1, Math.ceil(duration * pixelsPerSecond));
  // The visible width, read once per operation before any DOM write (see
  // measure()). Reading `clientWidth` after writing the spacer or canvas style
  // would force a synchronous layout in the middle of the paint.
  let viewportWidth = 0;
  let viewportHeight = 0;
  const measure = (): void => {
    viewportWidth = Math.max(0, outer.clientWidth);
    viewportHeight = Math.max(0, scroller.clientHeight);
  };
  /** Measured visible width; zero while hidden or not laid out. */
  const measuredViewportWidth = (): number => viewportWidth;
  /** Canvas operations still require at least one drawable CSS pixel. */
  const drawableViewportWidth = (): number => Math.max(1, measuredViewportWidth());
  /**
   * Drawable height in CSS px, measured with the width. The scroller's
   * scrollbar is hidden, so no gutter is taken from the drawing any more.
   */
  const drawHeight = (): number => Math.max(1, viewportHeight);
  /** Largest valid scroll offset. */
  const maxOffset = (): number => Math.max(0, fullWidth() - measuredViewportWidth());
  const clampOffset = (o: number): number => Math.max(0, Math.min(maxOffset(), o));
  const centerPadding = (): number => playheadMode === 'center' ? measuredViewportWidth() / 2 : 0;
  const clampSeconds = (seconds: number): number => Math.max(0, Math.min(duration, seconds));
  const alignOffset = (): void => {
    renderOffset = playheadMode === 'center'
      ? secondsToPixel(clampSeconds(playheadSeconds), pixelsPerSecond) - centerPadding()
      : clampOffset(renderOffset);
  };

  /** The window currently painted, in seconds. */
  const currentViewport = (): AudioViewport => {
    const start = pixelToSeconds(renderOffset, pixelsPerSecond);
    const end = pixelToSeconds(renderOffset + measuredViewportWidth(), pixelsPerSecond);
    return {startSeconds: Math.max(0, start), endSeconds: Math.min(end, duration)};
  };

  let viewportDispatchRevision = 0;
  const notifyViewport = (): void => {
    if (disposed || viewportListeners.size === 0) return;
    const next = currentViewport();
    const revision = ++viewportDispatchRevision;
    for (const listener of [...viewportListeners]) {
      // A listener may synchronously pan/zoom again. That nested dispatch
      // publishes the new authoritative window; the superseded outer round
      // must not deliver its older geometry to any remaining observer.
      if (disposed || revision !== viewportDispatchRevision) return;
      if (!viewportListeners.has(listener)) continue;
      try {
        const result = (listener as (viewport: AudioViewport) => unknown)(next);
        if (isPromiseLike(result)) {
          // The public callback returns void, but TypeScript permits callers to
          // provide async functions. Contain their borrowed settlement.
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        // One faulty observer must not stop the others, or the paint.
      }
      // A nested renderer operation may commit geometry before its own paint
      // fails and therefore never reach notifyViewport(). Recover publication
      // here instead of letting this outer round continue with stale geometry.
      if (
        !disposed &&
        revision === viewportDispatchRevision &&
        !sameViewport(next, currentViewport())
      ) {
        notifyViewport();
        return;
      }
    }
  };

  // The spacer is as wide as the whole clip so the native scrollbar spans it.
  const sizeContent = (): void => {
    spacer.style.width = `${fullWidth() + centerPadding() * 2}px`;
  };

  /** Push `renderOffset` onto the scrollbar thumb without moving the canvas. */
  const syncScrollbar = (): void => {
    const offset = renderOffset + centerPadding();
    if (Math.abs(scroller.scrollLeft - offset) > (playheadMode === 'center' ? 0 : 0.5)) {
      scroller.scrollLeft = offset;
    }
  };

  /** Memoized fillStyle for the column loop; reset per paint. */
  let lastColorKey = -1;
  let lastColorCss = '';

  /**
   * Coalesce ordinary redraw requests onto the next animation frame. Bursts
   * from event-driven sources can otherwise paint work the browser never shows.
   * A display-frame observer uses redrawFrame() to paint its fresh position
   * directly instead. The latest state wins; there is nothing to queue.
   */
  let frameHandle: number | null = null;
  const requestFrame: ((callback: () => void) => number) | null =
    typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : null;

  const schedulePaint = (): void => {
    if (disposed) return;
    if (!requestFrame) {
      paint();
      return;
    }
    if (frameHandle !== null) return;
    frameHandle = requestFrame(() => {
      frameHandle = null;
      measure();
      paint();
    });
  };

  const cancelScheduledPaint = (): void => {
    if (frameHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameHandle);
    }
    frameHandle = null;
  };

  /** Redraw the visible window + playhead from `renderOffset` (always crisp). */
  const paint = (): void => {
    if (disposed) return;
    paintCache = new Map();
    try {
      paintColumns();
    } finally {
      paintCache = undefined;
    }
  };

  const paintColumns = (): void => {
    lastColorKey = -1;
    const viewport = drawableViewportWidth();
    const drawH = drawHeight();
    const dpr =
      options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const backing = clampCanvasBackingSize(viewport, drawH, dpr);
    // Horizontal texels must have integer edges regardless of DPR. Reducing
    // this scale only for exceptionally wide hosts preserves the canvas cap.
    const rasterScaleX = Math.min(1, (MAX_CANVAS_DIMENSION - 1) / viewport);
    const columns = Math.min(MAX_CANVAS_DIMENSION, Math.ceil(viewport * rasterScaleX) + 1);
    if (raster.width !== columns) raster.width = columns;
    if (raster.height !== backing.height) raster.height = backing.height;
    const ctx = raster.getContext('2d');
    const surface = canvas.getContext('2d');
    if (!ctx || !surface) return;
    ctx.setTransform(1, 0, 0, backing.scaleY, 0, 0);
    ctx.clearRect(0, 0, columns, drawH);
    const wavePaint = paintColor(waveColor);
    const progressPaint = paintColor(progressColor);
    if (backgroundColor) {
      ctx.fillStyle = paintColor(backgroundColor);
      ctx.fillRect(0, 0, columns, drawH);
    }

    // The clip-anchored grid chooses exactly the same peaks at neighboring
    // offsets. Only the final bitmap composite receives the fractional shift.
    const gridOffset = renderOffset * rasterScaleX;
    const intOff = Math.floor(gridOffset);
    const frac = gridOffset - intOff;

    // Region tints behind the wave, in column space (content px = intOff + x).
    for (const r of regions) {
      const x0 = secondsToPixel(r.startSeconds, pixelsPerSecond) * rasterScaleX - intOff;
      const x1 = secondsToPixel(r.endSeconds, pixelsPerSecond) * rasterScaleX - intOff;
      if (x1 < 0 || x0 > columns) continue;
      const left = Math.max(0, x0);
      const wWidth = Math.max(1, Math.min(columns, x1) - left);
      ctx.fillStyle = paintColor(r.region.color ?? 'rgba(0, 0, 0, 0.12)');
      ctx.fillRect(left, 0, wWidth, drawH);
    }

    // Choose the coarsest pyramid level that is still at least one peak per
    // column; a column then folds every peak it covers (never just the first),
    // so narrow transients survive and panning cannot make them flicker.
    const samplesPerPixel = peaks.sampleRate / (pixelsPerSecond * rasterScaleX);
    const level = pyramid ? peaksLevelForResolution(pyramid, samplesPerPixel) : undefined;
    const total = level ? peakCount(level, peaks.channels) : sequenceSource!.frameCount;
    const samplesPerPeak = level ? level.samplesPerPeak : 1;
    const channels = peaks.channels;
    const peakData = level?.data;
    // A sequence source is read in whole power-of-two bins aligned to the clip,
    // so neighbouring columns, pans and zoom steps reuse the same cached ranges
    // instead of asking for a new unaligned range per column per zoom.
    const binFrames = sequenceSource && samplesPerPixel > 2 ? 2 ** Math.floor(Math.log2(samplesPerPixel)) : 0;
    const columnMin = new Float64Array(channels);
    const columnMax = new Float64Array(channels);
    /** Fold `[first, last)` pyramid peaks or source frames into columnMin/Max. */
    const readColumn = (pixel: number): boolean => {
      columnMin.fill(Infinity);
      columnMax.fill(-Infinity);
      const startSample = pixel * samplesPerPixel;
      const endSample = (pixel + 1) * samplesPerPixel;
      if (peakData) {
        const first = Math.floor(startSample / samplesPerPeak);
        if (first < 0 || first >= total) return false;
        const last = Math.min(total, Math.max(first + 1, Math.ceil(endSample / samplesPerPeak)));
        for (let peak = first; peak < last; peak += 1) {
          for (let c = 0; c < channels; c += 1) {
            const base = (peak * channels + c) * 2;
            const min = peakData[base] / 128;
            const max = peakData[base + 1] / 128;
            if (min < columnMin[c]) columnMin[c] = min;
            if (max > columnMax[c]) columnMax[c] = max;
          }
        }
        return true;
      }
      const source = sequenceSource!;
      const a = Math.max(0, Math.floor(startSample));
      if (pixel < 0 || a >= total) return false;
      const b = Math.min(total, Math.max(a + 1, Math.ceil(endSample)));
      const fold = (values: readonly {readonly min: number; readonly max: number}[]): void => {
        for (let c = 0; c < channels; c += 1) {
          const value = values[c];
          if (!value) continue;
          if (value.min < columnMin[c]) columnMin[c] = value.min;
          if (value.max > columnMax[c]) columnMax[c] = value.max;
        }
      };
      if (binFrames) {
        for (let start = Math.floor(a / binFrames) * binFrames; start < b; start += binFrames) {
          fold(source.readPeaks(start, Math.min(total, start + binFrames)));
        }
      } else fold(source.readPeaks(a, b));
      return true;
    };
    const playheadCol = secondsToPixel(playheadSeconds, pixelsPerSecond) * rasterScaleX - intOff;

    // Lanes: one centred waveform in `merge`, or a stacked stereo pair in
    // `split`. `channel < 0` means "fold every channel together"; otherwise the
    // lane draws that single channel. Each lane carries its own frequency colours.
    const split = channelLayout === 'split' && channels >= 2;
    const lanes = split
      ? [
          {
            channel: 0,
            center: drawH * 0.25,
            half: drawH * 0.25 * amplitude,
            colors: frameColorsByChannel[0],
          },
          {
            channel: 1,
            center: drawH * 0.75,
            half: drawH * 0.25 * amplitude,
            colors: frameColorsByChannel[1],
          },
        ]
      : [
          {
            channel: -1,
            center: drawH / 2,
            half: drawH / 2 * amplitude,
            colors: frameColorsByChannel[0],
          },
        ];

    // Recent-history glow: full brightness within `historyTrail` seconds behind
    // the playhead, dimmed elsewhere — a trailing window that follows playback.
    const historyFactor = (seconds: number): number => {
      if (!playheadVisible || historyTrail <= 0) return 1;
      const behind = playheadSeconds - seconds;
      return behind >= 0 && behind <= historyTrail ? 1 : HISTORY_DIM;
    };

    const columnColor = (
      colors: FrameColors | undefined,
      seconds: number,
      x: number,
      factor: number,
    ): string => {
      if (!colors) return playheadVisible && x <= playheadCol ? progressPaint : wavePaint;
      let fi = colors.frameStep > 0 ? Math.round((seconds - colors.startTime) / colors.frameStep) : 0;
      if (fi < 0) fi = 0;
      else if (fi >= colors.frames) fi = colors.frames - 1;
      const o = fi * 3;
      let r = colors.colors[o];
      let g = colors.colors[o + 1];
      let b = colors.colors[o + 2];
      if (factor < 1) {
        r *= factor;
        g *= factor;
        b *= factor;
      }
      // Adjacent columns overwhelmingly repeat a colour (a solid waveform has
      // exactly two, and frequency tinting changes only every few columns), so
      // memoize the last string instead of rebuilding it per column per lane.
      const key = ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
      if (key !== lastColorKey) {
        lastColorKey = key;
        lastColorCss = `rgb(${r | 0},${g | 0},${b | 0})`;
      }
      return lastColorCss;
    };

    if (total > 0) {
      // Adjacent integer texels share no antialiased horizontal edge. The extra
      // column covers the right edge exposed by the final fractional shift.
      for (let x = 0; x < columns; x += 1) {
        const seconds = (intOff + x) / (pixelsPerSecond * rasterScaleX);
        if (playheadMode === 'center' && (seconds < 0 || seconds >= duration)) continue;
        if (!readColumn(intOff + x)) continue;
        const factor = historyFactor(seconds);
        for (const lane of lanes) {
          let lo = Infinity;
          let hi = -Infinity;
          if (lane.channel < 0) {
            for (let c = 0; c < channels; c += 1) {
              if (columnMin[c] < lo) lo = columnMin[c];
              if (columnMax[c] > hi) hi = columnMax[c];
            }
          } else {
            lo = columnMin[lane.channel];
            hi = columnMax[lane.channel];
          }
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
          const yTop = Math.max(0, lane.center - hi * lane.half);
          const yBot = Math.min(drawH, lane.center - lo * lane.half);
          // Opacity preserves the caller's static CSS colour (including alpha)
          // and keeps the history distinction readable on light or dark hosts.
          ctx.globalAlpha = lane.colors ? 1 : factor;
          ctx.fillStyle = columnColor(lane.colors, seconds, x, factor);
          ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
        }
      }
    }

    ctx.globalAlpha = 1;

    // Publish one completed bitmap. Clearing the visible canvas happens only
    // after sampling, theme reads and column painting have finished.
    if (canvas.width !== backing.width) canvas.width = backing.width;
    if (canvas.height !== backing.height) canvas.height = backing.height;
    canvas.style.width = `${viewport}px`;
    canvas.style.height = `${drawH}px`;
    overlay.style.height = `${drawH}px`;
    surface.setTransform(backing.scaleX, 0, 0, backing.scaleY, 0, 0);
    surface.globalAlpha = 1;
    surface.imageSmoothingEnabled = true;
    surface.clearRect(0, 0, viewport, drawH);
    surface.drawImage(raster, 0, 0, columns, backing.height,
      -frac / rasterScaleX, 0, columns / rasterScaleX, drawH);

    // Place the playhead at its on-screen position; hide it when out of view.
    const playheadX = playheadMode === 'center'
      ? measuredViewportWidth() / 2
      : secondsToPixel(playheadSeconds, pixelsPerSecond) - renderOffset;
    overlay.style.transform = `translateX(${playheadX}px)`;
    overlay.style.opacity = !playheadVisible || playheadX < -1 || playheadX > viewport + 1 ? '0' : '1';
  };

  /** Center the viewport on the playhead, clamped at both ends. */
  const followPlayhead = (): void => {
    renderOffset = clampOffset(
      secondsToPixel(playheadSeconds, pixelsPerSecond) - measuredViewportWidth() / 2,
    );
  };

  // Manual pan: the user wheeled, swiped or used the keyboard. Our own scroll
  // syncs leave `scrollLeft` within half a px of `renderOffset`, so the echo of
  // a paint that already covered this position is skipped.
  const onScroll = (): void => {
    if (disposed) return;
    measure();
    if (playheadMode === 'center') {
      syncScrollbar();
      return;
    }
    if (Math.abs(scroller.scrollLeft - renderOffset) <= 0.5) return;
    renderOffset = clampOffset(scroller.scrollLeft);
    syncScrollbar();
    paint();
    notifyViewport();
  };
  scroller.addEventListener('scroll', onScroll, {passive: true});

  // Re-fit on resize. The scroller fills the fixed-height box and its
  // scrollbar is hidden, so only container-width changes reach here.
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      measure();
      sizeContent();
      alignOffset();
      paint();
      syncScrollbar();
      notifyViewport();
    });
    resizeObserver.observe(scroller);
  }

  // Theme changes repaint pixels without replacing the view, moving its
  // viewport or emitting transport/viewport commands. Observe only ancestors:
  // this renderer's own style updates must never cause a repaint loop.
  const colorObserver = typeof MutationObserver === 'undefined'
    ? undefined
    : new MutationObserver(() => { if (!disposed) schedulePaint(); });
  let ancestor: Element | null = container;
  while (ancestor && colorObserver) {
    colorObserver.observe(ancestor, {attributes: true, attributeFilter: ['class', 'style', 'data-theme']});
    const root = ancestor.getRootNode();
    ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  const colorScheme = container.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  colorScheme?.addEventListener('change', schedulePaint);

  measure();
  sizeContent();
  alignOffset();
  paint();
  syncScrollbar();

  const findRegionAt = (seconds: number): Region | undefined => {
    for (const r of regions) {
      if (r.region.isMarker) continue;
      if (seconds >= r.startSeconds && seconds <= r.endSeconds) return r.region;
    }
    return undefined;
  };

  const updatePlayhead = (nextPlayhead: number, scrollIntoView: boolean | undefined): boolean => {
    if (disposed || !Number.isFinite(nextPlayhead)) return false;
    playheadSeconds = playheadMode === 'center' ? clampSeconds(nextPlayhead) : nextPlayhead;
    if (scrollIntoView || playheadMode === 'center') {
      if (playheadMode === 'center') alignOffset();
      else followPlayhead();
      syncScrollbar();
      notifyViewport();
    }
    return !disposed;
  };

  return {
    setPlayheadVisible(visible: boolean): void {
      if (disposed || playheadVisible === visible) return;
      playheadVisible = visible;
      schedulePaint();
    },
    redraw(nextPlayhead?: number, scrollIntoView?: boolean): void {
      if (disposed) return;
      measure();
      if (nextPlayhead === undefined) {
        sizeContent();
        alignOffset();
        cancelScheduledPaint();
        paint();
        syncScrollbar();
        notifyViewport();
        return;
      }
      if (updatePlayhead(nextPlayhead, scrollIntoView)) schedulePaint();
    },
    redrawFrame(nextPlayhead: number, scrollIntoView?: boolean): void {
      if (disposed) return;
      measure();
      if (!updatePlayhead(nextPlayhead, scrollIntoView)) return;
      // A borrowed player clock has already been sampled inside this display
      // frame. Publish it now, cancelling any older event/theme repaint.
      cancelScheduledPaint();
      paint();
    },
    setPlayheadMode(mode: 'position' | 'center'): void {
      if (disposed || mode === playheadMode || (mode !== 'position' && mode !== 'center')) return;
      measure();
      playheadMode = mode;
      scroller.style.overflowX = scrollable && mode === 'position' ? 'auto' : 'hidden';
      sizeContent();
      alignOffset();
      paint();
      syncScrollbar();
      notifyViewport();
    },
    /**
     * Re-scale in place. `startSeconds`, when given, is the window start the
     * caller anchored (for example around the point under the pointer); it is
     * applied before the one paint, so the surface never shows the old pixel
     * offset at the new scale. Without it the pixel offset is kept.
     */
    setZoom(nextPxPerSec: number, startSeconds?: number): void {
      if (disposed) return;
      if (Number.isFinite(nextPxPerSec) && nextPxPerSec > 0) {
        measure();
        pixelsPerSecond = nextPxPerSec;
        if (startSeconds !== undefined && Number.isFinite(startSeconds)) {
          renderOffset = secondsToPixel(Math.max(0, startSeconds), pixelsPerSecond);
        }
        sizeContent();
        alignOffset();
        paint();
        syncScrollbar();
        notifyViewport();
      }
    },
    setOffset(startSeconds: number): void {
      if (disposed || playheadMode === 'center' || !Number.isFinite(startSeconds)) return;
      measure();
      renderOffset = clampOffset(secondsToPixel(Math.max(0, startSeconds), pixelsPerSecond));
      paint();
      syncScrollbar();
      notifyViewport();
    },
    viewport(): AudioViewport {
      return currentViewport();
    },
    onViewportChange(listener: (viewport: AudioViewport) => void): () => void {
      if (disposed) return () => {};
      viewportListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        viewportListeners.delete(listener);
      };
    },
    setRegions(next: readonly Region[]): void {
      if (disposed) return;
      setRegions(next);
      measure();
      paint();
    },
    hitTest(x: number, y?: number): {seconds: number; region?: Region; channel?: number} {
      const rawSeconds = pixelToSeconds(renderOffset + x, pixelsPerSecond);
      const seconds = playheadMode === 'center' ? clampSeconds(rawSeconds) : rawSeconds;
      const region = findRegionAt(seconds);
      // `y` was accepted and ignored, so a split-stereo display could not tell
      // which lane was clicked. Resolve it here rather than making every
      // caller re-derive the lane geometry.
      const lanes = channelLayout === 'split' && peaks.channels >= 2 ? 2 : 1;
      const channel =
        lanes > 1 && typeof y === 'number' && Number.isFinite(y)
          ? Math.max(0, Math.min(lanes - 1, Math.floor((y / Math.max(1, drawHeight())) * lanes)))
          : undefined;
      return {
        seconds,
        ...(region ? {region} : {}),
        ...(channel !== undefined ? {channel} : {}),
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      viewportDispatchRevision += 1;
      cancelScheduledPaint();
      viewportListeners.clear();
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
      colorObserver?.disconnect();
      colorScheme?.removeEventListener('change', schedulePaint);
      raster.width = raster.height = 1;
      outer.remove();
    },
  };
}

/** Marks a renderer's native scroller; its scrollbar is hidden by {@link hiddenScrollbarStyle}. */
const HIDDEN_SCROLLBAR_ATTRIBUTE = 'data-wm-hidden-scrollbar';

/**
 * Hide a scrolling layer's scrollbar while keeping wheel, trackpad and keyboard
 * scrolling (Visual design: scrolling surfaces). The standard property is
 * inline; the WebKit pseudo-element needs the scoped rule below.
 */
function hideScrollbar(scroller: HTMLElement): void {
  scroller.setAttribute(HIDDEN_SCROLLBAR_ATTRIBUTE, '');
  scroller.style.setProperty('scrollbar-width', 'none');
}

/** The scoped stylesheet behind {@link hideScrollbar}, mounted inside the renderer's own box. */
function hiddenScrollbarStyle(document: Document): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent =
    `:where([${HIDDEN_SCROLLBAR_ATTRIBUTE}]) { scrollbar-width: none; }\n` +
    `:where([${HIDDEN_SCROLLBAR_ATTRIBUTE}])::-webkit-scrollbar { display: none; }`;
  return style;
}

function sameViewport(left: AudioViewport, right: AudioViewport): boolean {
  return left.startSeconds === right.startSeconds && left.endSeconds === right.endSeconds;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) ||
      typeof value === 'function') &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}
