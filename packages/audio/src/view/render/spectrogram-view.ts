// ============================================================================
// renderSpectrogramVisualizer — Canvas 2D spectrogram via per-column ImageData.
//
// Consumes a column-major STFT `SpectrogramData` (declared in ./types, fed by
// @webmusic/audio/analyze without a code dependency). Each frame becomes one image
// column whose pixels are coloured by a colormap over a dB-scaled magnitude,
// restricted to [minFreq, maxFreq]. A separate playhead overlay (moved with
// translateX) avoids repainting the heavy image on every tick.
// ============================================================================

import type {Region} from '../../core';
import {
  clampCanvasBackingSize,
  MAX_CANVAS_DIMENSION,
  secondsToPixel,
  pixelToSeconds,
  visibleTimeRange,
} from '../core/windowing';
import {colormapByName, type Colormap} from '../core/colormaps';
import type {
  AudioViewport,
  SpectrogramData,
  SpectrogramRenderOptions,
  ViewportAudioVisualizer,
} from '../core/types';

const DEFAULTS = {
  pixelsPerSecond: 100,
  height: 256,
  minDb: -100,
  maxDb: 0,
  playheadColor: '#000000',
} as const;

/** Quantization of the colormap lookup table. */
const COLOR_STEPS = 256;

/**
 * Pack the colormap into a lookup table once per renderer. The colormap
 * allocates a fresh RGB triple per call, and the painter calls it once per
 * device pixel — a full-clip paint at 16384x512 backing meant millions of
 * short-lived arrays. 256 steps is below the 8-bit output precision, so the
 * table is lossless for what the canvas can display.
 */
function packColormap(colormap: Colormap): Uint32Array {
  const table = new Uint32Array(COLOR_STEPS);
  const bytes = new Uint8ClampedArray(table.buffer);
  for (let i = 0; i < COLOR_STEPS; i += 1) {
    const [r, g, b] = colormap(i / (COLOR_STEPS - 1));
    const o = i * 4;
    // Written through a byte view so the packing matches ImageData's RGBA
    // order on both endiannesses.
    bytes[o] = r;
    bytes[o + 1] = g;
    bytes[o + 2] = b;
    bytes[o + 3] = 255;
  }
  return table;
}

/** Resolve a colormap option (name or custom function) to a {@link Colormap}. */
function resolveColormap(option: SpectrogramRenderOptions['colorMap']): Colormap {
  if (typeof option === 'function') return option;
  return colormapByName(option);
}

/** Linear value of `arr[i]` whether `arr` is a typed array or number[]. */
function at(arr: Float32Array | number[], i: number): number {
  return arr[i] ?? 0;
}

/** Number of frames in the spectrogram. */
function frameCount(spec: SpectrogramData): number {
  if (spec.binsPerFrame <= 0) return 0;
  return Math.floor(spec.magnitudes.length / spec.binsPerFrame);
}

/**
 * Render a spectrogram into `container` from a column-major
 * {@link SpectrogramData}, returning a {@link ViewportAudioVisualizer} handle.
 */
export function renderSpectrogramVisualizer(
  container: HTMLElement,
  spectrogram: SpectrogramData,
  options: SpectrogramRenderOptions = {},
): ViewportAudioVisualizer {
  let pixelsPerSecond = options.pixelsPerSecond ?? DEFAULTS.pixelsPerSecond;
  const height = options.height ?? DEFAULTS.height;
  const minDb = options.minDb ?? DEFAULTS.minDb;
  const maxDb = options.maxDb ?? DEFAULTS.maxDb;
  const playheadColor = options.playheadColor ?? DEFAULTS.playheadColor;
  const colormap = resolveColormap(options.colorMap);
  const colorTable = packColormap(colormap);
  const virtualization = options.virtualization ?? true;
  const requestedBuffer =
    typeof virtualization === 'object' ? (virtualization.bufferScreens ?? 1) : 1;
  const bufferScreens = Number.isFinite(requestedBuffer) ? Math.max(0, requestedBuffer) : 1;
  const scrollable = options.scrollable ?? true;
  let playheadMode = options.playheadMode ?? 'position';

  const frames = frameCount(spectrogram);
  const bins = spectrogram.binsPerFrame;
  const nyquist = bins > 0 ? at(spectrogram.frequencies, bins - 1) : 0;
  const minFreq = options.minFreq ?? 0;
  const maxFreq = options.maxFreq ?? nyquist;

  const lastTime = frames > 0 ? at(spectrogram.times, frames - 1) : 0;
  const duration = options.durationSeconds ?? Math.max(lastTime, 0);

  let regions: Region[] = [...(options.regions ?? [])];
  let playheadSeconds = 0;
  let renderOffset = 0;
  let disposed = false;
  // Pan and zoom listeners let external controls follow the window this
  // renderer paints without reaching into its DOM.
  const viewportListeners = new Set<(viewport: AudioViewport) => void>();

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.overflow = 'hidden';
  wrapper.style.width = '100%';
  wrapper.style.height = `${height}px`;

  // Native scrolling owns input/scrollbar state only. Keep raster layers out
  // of its independently composited coordinate system: otherwise following
  // moves their pixels before the main-thread cursor/stripe update is ready.
  const scroller = document.createElement('div');
  scroller.style.width = '100%';
  scroller.style.height = '100%';
  scroller.style.overflowX = scrollable && playheadMode === 'position' ? 'auto' : 'hidden';
  scroller.style.overflowY = 'hidden';

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.display = 'block';
  canvas.style.maxWidth = 'none';
  canvas.style.height = `${height}px`;
  canvas.style.pointerEvents = 'none';

  // The scroll extent is independent of the raster allocation: a long clip
  // still pans natively while only a buffered viewport owns canvas pixels.
  const spacer = document.createElement('div');
  spacer.style.height = '1px';

  // Region outlines paint here, above the image and below the playhead, so a
  // region edit never touches the rasterized spectrogram.
  const regionLayer = document.createElement('canvas');
  regionLayer.style.position = 'absolute';
  regionLayer.style.top = '0';
  regionLayer.style.left = '0';
  regionLayer.style.display = 'block';
  regionLayer.style.maxWidth = 'none';
  regionLayer.style.height = `${height}px`;
  regionLayer.style.pointerEvents = 'none';

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

  wrapper.appendChild(canvas);
  wrapper.appendChild(regionLayer);
  wrapper.appendChild(overlay);
  scroller.appendChild(spacer);
  wrapper.appendChild(scroller);
  container.appendChild(wrapper);

  const fullWidth = (): number => Math.max(1, Math.ceil(duration * pixelsPerSecond));
  const measuredViewportWidth = (): number => Math.max(0, wrapper.clientWidth);
  const maxOffset = (): number => Math.max(0, fullWidth() - measuredViewportWidth());
  const clampOffset = (offset: number): number => Math.max(0, Math.min(maxOffset(), offset));
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
  const syncScrollbar = (): void => {
    const offset = renderOffset + centerPadding();
    if (Math.abs(scroller.scrollLeft - offset) > (playheadMode === 'center' ? 0 : 0.5)) {
      scroller.scrollLeft = offset;
    }
  };

  /** Map a magnitude to a normalized [0,1] intensity via dB scaling. */
  const intensity = (magnitude: number): number => {
    const db = 20 * Math.log10(Math.max(magnitude, 1e-9));
    const t = (db - minDb) / (maxDb - minDb || 1);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };

  /** Frame index nearest a given time (frames may be non-uniformly spaced). */
  const frameAtSeconds = (seconds: number): number =>
    nearestIndex(spectrogram.times, frames, seconds);

  interface RasterWindow {
    /** Clip-relative CSS pixel bounds, independent of the backing resolution. */
    start: number;
    end: number;
    scale: number;
    dpr: number;
    /** Stable clip-wide device-pixel grid; stripe replacement cannot change phase. */
    rasterScale: number;
    firstPixel: number;
    width: number;
  }
  let paintedWindow: RasterWindow | null = null;
  let paintedViewportWidth = -1;
  const pixelRatio = (): number => {
    const requested = options.devicePixelRatio ??
      (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    return Number.isFinite(requested) && requested > 0 ? requested : 1;
  };

  const rasterWindow = (): RasterWindow | null => {
    const contentWidth = fullWidth();
    const viewport = measuredViewportWidth();
    // Hidden/unlaid-out views must not turn virtualization into a full-clip
    // allocation. ResizeObserver (or an explicit redraw) paints after layout.
    if (virtualization !== false && !(viewport > 0)) return null;
    const range = virtualization === false
      ? {startSeconds: 0, endSeconds: pixelToSeconds(contentWidth, pixelsPerSecond)}
      : visibleTimeRange(renderOffset, viewport, pixelsPerSecond, duration, bufferScreens);
    const start = Math.max(0, secondsToPixel(range.startSeconds, pixelsPerSecond));
    const end = Math.min(contentWidth, secondsToPixel(range.endSeconds, pixelsPerSecond));
    const dpr = pixelRatio();
    const maxWidth = virtualization === false
      ? contentWidth
      : Math.min(contentWidth, viewport * (1 + 2 * bufferScreens));
    // Reserve rounding room at both ends. The scale depends on the maximum
    // stripe, not its edge-clipped width, so a replacement preserves existing
    // samples even at fractional DPR or under the browser canvas size limit.
    const rasterScale = Math.min(dpr, (MAX_CANVAS_DIMENSION - 2) / Math.max(1, maxWidth));
    const firstPixel = Math.floor(start * rasterScale);
    const lastPixel = Math.max(firstPixel + 1, Math.ceil(end * rasterScale));
    return {
      start: firstPixel / rasterScale,
      end: lastPixel / rasterScale,
      scale: pixelsPerSecond,
      dpr,
      rasterScale,
      firstPixel,
      width: lastPixel - firstPixel,
    };
  };

  /** Repaint one buffered stripe. Region outlines use the same bounded window. */
  const paint = (): void => {
    spacer.style.width = `${fullWidth() + centerPadding() * 2}px`;
    paintedViewportWidth = measuredViewportWidth();
    const next = rasterWindow();
    paintedWindow = null;
    if (!next) {
      // Release an old visible allocation when its host becomes hidden.
      canvas.width = canvas.height = 1;
      canvas.style.width = '0px';
      return;
    }
    const cssWidth = next.end - next.start;
    const backing = {
      ...clampCanvasBackingSize(cssWidth, height, next.dpr),
      width: next.width,
      scaleX: next.rasterScale,
    };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const commitSurface = (): void => {
      canvas.style.left = `${next.start - renderOffset}px`;
      canvas.style.width = `${cssWidth}px`;
      if (canvas.width !== backing.width) canvas.width = backing.width;
      if (canvas.height !== backing.height) canvas.height = backing.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    if (frames === 0 || bins === 0) {
      commitSurface();
      ctx.clearRect(0, 0, backing.width, backing.height);
      paintedWindow = next;
      return;
    }

    const colH = backing.height;
    const stripeWidth = backing.width;
    const image = ctx.createImageData(stripeWidth, colH);
    const pixels = new Uint32Array(image.data.buffer);
    const freqSpan = maxFreq - minFreq || 1;
    const lastY = colH - 1 || 1;
    const lastStep = COLOR_STEPS - 1;

    // The frequency-to-bin map depends only on y, not on every image pixel.
    const binForRow = new Int32Array(colH);
    for (let y = 0; y < colH; y += 1) {
      const freq = maxFreq - (y / lastY) * freqSpan;
      binForRow[y] = nearestIndex(spectrogram.frequencies, bins, freq);
    }

    for (let px = 0; px < stripeWidth; px += 1) {
      const seconds = pixelToSeconds((next.firstPixel + px) / next.rasterScale, pixelsPerSecond);
      if (playheadMode === 'center' && seconds >= duration) continue;
      const base = frameAtSeconds(seconds) * bins;
      let o = px;
      for (let y = 0; y < colH; y += 1) {
        const t = intensity(spectrogram.magnitudes[base + binForRow[y]] ?? 0);
        let step = (t * lastStep) | 0;
        if (step < 0) step = 0;
        else if (step > lastStep) step = lastStep;
        pixels[o] = colorTable[step];
        o += stripeWidth;
      }
    }
    // Keep the prior raster visible throughout CPU sampling. A single complete
    // upload replaces it; clearing/resizing before the loop exposed blank pixels
    // when the compositor presented while a large stripe was being prepared.
    commitSurface();
    ctx.putImageData(image, 0, 0);
    paintedWindow = next;
  };

  /** Region edits never touch the spectrogram's rasterized pixels. */
  const paintRegions = (): void => {
    if (!paintedWindow) {
      regionLayer.width = regionLayer.height = 1;
      regionLayer.style.width = '0px';
      return;
    }
    const {start, end, dpr, width, rasterScale} = paintedWindow;
    const cssWidth = end - start;
    regionLayer.style.left = `${start - renderOffset}px`;
    regionLayer.style.width = `${cssWidth}px`;
    const backing = {...clampCanvasBackingSize(cssWidth, height, dpr), width, scaleX: rasterScale};
    if (regionLayer.width !== backing.width) regionLayer.width = backing.width;
    if (regionLayer.height !== backing.height) regionLayer.height = backing.height;
    const ctx = regionLayer.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backing.width, backing.height);
    ctx.setTransform(backing.scaleX, 0, 0, backing.scaleY, 0, 0);
    for (const region of regions) {
      const x0 = secondsToPixel(region.startSeconds, pixelsPerSecond) - start;
      const x1 = secondsToPixel(region.endSeconds ?? region.startSeconds, pixelsPerSecond) - start;
      if (x1 < 0 || x0 > cssWidth) continue;
      ctx.strokeStyle = region.color ?? 'rgba(0,0,0,0.7)';
      ctx.strokeRect(x0, 0.5, Math.max(1, x1 - x0), height - 1);
    }
  };

  /** Reuse the buffer while the actual visible viewport stays inside it. */
  const ensurePaintedViewport = (): void => {
    const visibleStart = Math.max(0, renderOffset);
    const visibleEnd = Math.min(fullWidth(), renderOffset + measuredViewportWidth());
    if (
      paintedWindow &&
      paintedWindow.scale === pixelsPerSecond && paintedWindow.dpr === pixelRatio() &&
      visibleStart >= paintedWindow.start && visibleEnd <= paintedWindow.end
    ) return;
    paint();
    paintRegions();
  };

  /** Commit every visual position from the same fractional render offset. */
  const moveLayers = (): void => {
    if (paintedWindow) {
      const x = paintedWindow.start - renderOffset;
      canvas.style.left = `${x}px`;
      regionLayer.style.left = `${x}px`;
    }
    const x = playheadMode === 'center'
      ? measuredViewportWidth() / 2
      : secondsToPixel(playheadSeconds, pixelsPerSecond) - renderOffset;
    overlay.style.transform = `translateX(${x}px)`;
  };

  /** Centre the native viewport on the playhead, clamped at both ends. */
  const followPlayhead = (): void => {
    renderOffset = clampOffset(
      secondsToPixel(playheadSeconds, pixelsPerSecond) - measuredViewportWidth() / 2,
    );
  };

  /** Repaint when scrolling brings unpainted columns into view. */
  const onScroll = (): void => {
    if (disposed) return;
    if (playheadMode === 'center') {
      syncScrollbar();
      moveLayers();
      return;
    }
    if (Math.abs(scroller.scrollLeft - renderOffset) <= 0.5) return;
    renderOffset = clampOffset(scroller.scrollLeft);
    syncScrollbar();
    ensurePaintedViewport();
    moveLayers();
    notifyViewport();
  };
  scroller.addEventListener('scroll', onScroll);

  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      const width = measuredViewportWidth();
      if (
        width === paintedViewportWidth &&
        (paintedWindow?.dpr === pixelRatio() || (virtualization !== false && width === 0))
      ) return;
      alignOffset();
      paint();
      paintRegions();
      syncScrollbar();
      moveLayers();
      notifyViewport();
    });
    resizeObserver.observe(wrapper);
  }

  alignOffset();
  paint();
  paintRegions();
  syncScrollbar();
  moveLayers();

  const findRegionAt = (seconds: number): Region | undefined => {
    for (const region of regions) {
      if (region.endSeconds === undefined) continue;
      if (seconds >= region.startSeconds && seconds <= region.endSeconds) return region;
    }
    return undefined;
  };

  return {
    redraw(nextPlayhead?: number, scrollIntoView?: boolean): void {
      if (disposed) return;
      if (nextPlayhead === undefined) {
        alignOffset();
        paint();
        paintRegions();
        syncScrollbar();
        moveLayers();
        notifyViewport();
        return;
      }
      if (!Number.isFinite(nextPlayhead)) return;
      playheadSeconds = playheadMode === 'center' ? clampSeconds(nextPlayhead) : nextPlayhead;
      if (playheadMode === 'center') alignOffset();
      else if (scrollIntoView) followPlayhead();
      if (scrollIntoView || playheadMode === 'center') {
        ensurePaintedViewport();
        syncScrollbar();
        moveLayers();
        notifyViewport();
      } else {
        moveLayers();
      }
    },
    setPlayheadMode(mode: 'position' | 'center'): void {
      if (disposed || mode === playheadMode || (mode !== 'position' && mode !== 'center')) return;
      playheadMode = mode;
      scroller.style.overflowX = scrollable && mode === 'position' ? 'auto' : 'hidden';
      alignOffset();
      paint();
      paintRegions();
      syncScrollbar();
      moveLayers();
      notifyViewport();
    },
    setZoom(nextPxPerSec: number): void {
      if (disposed) return;
      if (Number.isFinite(nextPxPerSec) && nextPxPerSec > 0) {
        pixelsPerSecond = nextPxPerSec;
        alignOffset();
        paint();
        paintRegions();
        syncScrollbar();
        moveLayers();
        notifyViewport();
      }
    },
    setOffset(startSeconds: number): void {
      if (disposed || playheadMode === 'center' || !Number.isFinite(startSeconds)) return;
      renderOffset = clampOffset(secondsToPixel(Math.max(0, startSeconds), pixelsPerSecond));
      ensurePaintedViewport();
      moveLayers();
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
      regions = [...next];
      // Only the region layer changes — the spectrogram image is untouched,
      // so a region drag no longer re-rasterizes the whole clip.
      paintRegions();
    },
    hitTest(x: number): {seconds: number; region?: Region} {
      const rawSeconds = pixelToSeconds(x + renderOffset, pixelsPerSecond);
      const seconds = playheadMode === 'center' ? clampSeconds(rawSeconds) : rawSeconds;
      const region = findRegionAt(seconds);
      return region ? {seconds, region} : {seconds};
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      viewportDispatchRevision += 1;
      viewportListeners.clear();
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
      wrapper.remove();
    },
  };
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

/** Nearest coordinate on a caller-supplied sorted axis; ties choose the later sample. */
function nearestIndex(axis: Float32Array | number[], count: number, target: number): number {
  if (count <= 1) return 0;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (axis[middle] < target) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low >= count) return count - 1;
  return target - axis[low - 1] < axis[low] - target ? low - 1 : low;
}
