// Browser-only transport adapters. These deliberately live outside
// `@webmusic/score/play/headless`: they bind playback state to caller-owned DOM and
// device input, while the headless entry remains a code-only playback layer.

/**
 * The minimal structural transport the browser drivers need. `ScorePlayer`
 * satisfies it directly.
 *
 * All values live in real (wall-clock) seconds at the current rate, so
 * `scrub`/`seekFraction` behave consistently at any rate.
 */
export interface PlaybackTransport {
  /** Current position in real seconds at the current rate. */
  readonly seconds: number;
  /** Total duration in real seconds at the current rate. */
  readonly duration: number;
  scrub(deltaSeconds: number): void;
  seekFraction(fraction: number): void;
  pause(): void;
  play(): void | Promise<void>;
  /** Used by autoplay / drag-resume drivers. */
  isPlaying(): boolean;
  /** Used by rate-mode drivers (bindOrientation / bindValue). */
  setRate(rate: number): void;
}

export interface ScrollDriverOptions {
  container?: Element | Window;
  mode?: 'position' | 'delta';
  pixelsPerSecond?: number;
  autoplay?: boolean;
}

export function bindScroll(transport: PlaybackTransport, options: ScrollDriverOptions = {}): () => void {
  const {container = window, mode = 'position', pixelsPerSecond = 200, autoplay = false} = options;
  const isWindow = container === window || container instanceof Window;
  const getScrollY = () => (isWindow ? (container as Window).scrollY : (container as Element).scrollTop);
  const getMaxScroll = () =>
    isWindow
      ? document.documentElement.scrollHeight - window.innerHeight
      : (container as Element).scrollHeight - (container as Element).clientHeight;
  let lastScrollY = getScrollY();
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  const onScroll = () => {
    const scrollY = getScrollY();
    const delta = scrollY - lastScrollY;
    if (mode === 'position') {
      const max = getMaxScroll();
      if (max > 0) transport.seekFraction(scrollY / max);
    } else {
      if (delta !== 0) transport.scrub(delta / pixelsPerSecond);
      if (autoplay && delta > 0 && !transport.isPlaying() && transport.duration > 0) void transport.play();
      if (autoplay) {
        if (stopTimer != null) clearTimeout(stopTimer);
        stopTimer = setTimeout(() => {
          if (transport.isPlaying()) transport.pause();
        }, 200);
      }
    }
    lastScrollY = scrollY;
  };

  const target = isWindow ? window : (container as Element);
  target.addEventListener('scroll', onScroll as EventListener, {passive: true});
  return () => {
    target.removeEventListener('scroll', onScroll as EventListener);
    if (stopTimer != null) clearTimeout(stopTimer);
  };
}

export interface PointerDriverOptions {
  axis?: 'x' | 'y';
  pixelsPerSecond?: number;
  cursor?: string;
}

export function bindPointer(transport: PlaybackTransport, element: Element, options: PointerDriverOptions = {}): () => void {
  const {axis = 'x', pixelsPerSecond = 150, cursor = axis === 'x' ? 'ew-resize' : 'ns-resize'} = options;
  let dragging = false;
  let lastPos = 0;
  let wasPlaying = false;
  const el = element as HTMLElement;

  const onDown = (event: PointerEvent) => {
    dragging = true;
    lastPos = axis === 'x' ? event.clientX : event.clientY;
    wasPlaying = transport.isPlaying();
    if (wasPlaying) transport.pause();
    el.setPointerCapture?.(event.pointerId);
    el.style.cursor = cursor;
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const pos = axis === 'x' ? event.clientX : event.clientY;
    transport.scrub((pos - lastPos) / pixelsPerSecond);
    lastPos = pos;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = '';
    if (wasPlaying) void transport.play();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}

export interface OrientationDriverOptions {
  axis?: 'alpha' | 'beta' | 'gamma';
  range?: [number, number];
  mode?: 'seek' | 'rate';
}

export function bindOrientation(transport: PlaybackTransport, options: OrientationDriverOptions = {}): () => void {
  const {axis = 'gamma', range = [-45, 45], mode = 'seek'} = options;
  const [minAngle, maxAngle] = range;
  const span = maxAngle - minAngle;
  const onOrientation = (event: DeviceOrientationEvent) => {
    const raw = (event[axis as keyof DeviceOrientationEvent] as number | null) ?? 0;
    const fraction = Math.max(0, Math.min(1, (raw - minAngle) / span));
    if (mode === 'seek') {
      transport.seekFraction(fraction);
    } else {
      transport.setRate(0.25 * Math.pow(16, fraction));
    }
  };
  window.addEventListener('deviceorientation', onOrientation);
  return () => window.removeEventListener('deviceorientation', onOrientation);
}

export interface ValueDriverOptions {
  getValue: () => number;
  interval?: number;
  mode?: 'seek' | 'rate';
}

export function bindValue(transport: PlaybackTransport, options: ValueDriverOptions): () => void {
  const {getValue, interval = 50, mode = 'seek'} = options;
  const id = setInterval(() => {
    const value = getValue();
    if (mode === 'seek') {
      transport.seekFraction(Math.max(0, Math.min(1, value)));
    } else {
      transport.setRate(Math.max(0.1, value));
    }
  }, interval);
  return () => clearInterval(id);
}
