import {claimHost, createErrorSink, createUpdateLoop, runCleanups} from './internal/lifecycle';
import {formatPercent, readText, textValue, type UITextValue, type UIValueFormatters} from './text';
import {installStyle} from './internal/style';
import {addClassNames, clamp01, finite, setParts} from './internal/dom';
import {componentSurfaceCss} from './internal/surface';
// ============================================================================
// Domain-neutral level / spectrum meter presenter.
//
// It owns DOM, styling, ARIA and animation-frame scheduling. The caller owns
// the binding and any audio graph behind it.
// ============================================================================

export interface MeterLevelState {
  /** Current normalized fill in [0, 1]. */
  level: number;
  /** Optional normalized instantaneous peak. */
  peak?: number;
  /** Optional normalized decaying peak marker. */
  peakHold?: number;
}

export interface LevelMeterBinding {
  readLevel(): MeterLevelState;
}

export interface SpectrumMeterBinding {
  readSpectrum(bars: number): ArrayLike<number>;
}

/** Full port retained for callers whose mode is selected at runtime. */
export interface MeterBinding extends LevelMeterBinding, SpectrumMeterBinding {}

export interface MeterClassNames {
  root?: string;
  track?: string;
  fill?: string;
  peak?: string;
  spectrum?: string;
  bar?: string;
}

export interface MeterParts {
  root?: string;
  track?: string;
  fill?: string;
  peak?: string;
  spectrum?: string;
  bar?: string;
}

export interface MeterText {
  level?: string;
  spectrum?: string;
  levelValue?: UITextValue<{value: string; level: number; peak?: number; peakHold?: number}>;
  spectrumValue?: UITextValue<{value: string; maximum: number}>;
}

export interface MeterOptions {
  /** Application-supplied final text; call redraw() after external text changes. */
  getText?: () => MeterText;
  formatters?: UIValueFormatters;
  mode?: 'level' | 'spectrum';
  bars?: number;
  label?: string;
  /** Start the animation loop. Defaults to true. */
  animate?: boolean;
  height?: number | string;
  color?: string;
  peakColor?: string;
  backgroundColor?: string;
  classNames?: MeterClassNames;
  parts?: MeterParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface MeterHandle {
  element: HTMLElement;
  redraw(): void;
  /** Update the accessible name in place; `undefined` restores the mode default. */
  updateLabel(label?: string): void;
  destroy(): void;
}

type MeterHost = HTMLElement | ShadowRoot;

const mountedMeters = new WeakMap<MeterHost, MeterHandle>();

/** Semantic tokens first; legacy `--wameter-*` aliases remain supported. */
export const meterStyle = `
.wui-meter {
${componentSurfaceCss('meter', {
  padding: 'var(--wm-meter-padding, .6rem)',
  radius: 'var(--wm-meter-radius, var(--wm-control-radius, 0))',
  background: 'var(--wui-meter-background, var(--wameter-bg, var(--wm-meter-background, var(--wm-surface, #fff))))',
})}
  display: block;
  width: 100%;
  min-width: 0;
  height: var(--wui-meter-height, var(--wameter-height, var(--wm-meter-height, 48px)));
  overflow: hidden;
  color: var(--wui-meter-fill, var(--wameter-fill, var(--wm-meter-fill, var(--wm-accent, #4ea1ff))));
}
.wui-meter, .wui-meter * { box-sizing: border-box; }
.wui-meter__track {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: max(0px, calc(var(--wm-meter-radius, var(--wm-control-radius, 0)) - 2px));
  background: var(--wameter-track, var(--wm-meter-track, var(--wm-surface-muted, #1d1d1d)));
}
.wui-meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  background: currentColor;
}
.wui-meter__peak {
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  transform: translateX(-100%);
  background: var(--wui-meter-peak, var(--wameter-peak, var(--wm-meter-peak, var(--wm-danger, #e0445b))));
}
.wui-meter__spectrum {
  display: flex;
  align-items: flex-end;
  gap: var(--wm-meter-gap, 2px);
  width: 100%;
  height: 100%;
}
.wui-meter__bar {
  flex: 1 1 0;
  min-width: 0;
  height: 1%;
  background: currentColor;
  transform-origin: bottom;
}
@media (forced-colors: active) {
  .wui-meter { border: 1px solid CanvasText; color: Highlight; }
  .wui-meter__peak { background: CanvasText; }
}
`;

function countBars(value: unknown): number {
  return Math.max(4, Math.floor(finite(value, 28)));
}

function cssLength(value: string | number): string {
  return typeof value === 'number' ? `${Math.max(0, value)}px` : value;
}

/** Mount a live, accessible meter into an element or open shadow root. */
export function mountMeter(
  host: MeterHost,
  binding: LevelMeterBinding,
  options?: MeterOptions & {mode?: 'level'},
): MeterHandle;
export function mountMeter(
  host: MeterHost,
  binding: SpectrumMeterBinding,
  options: MeterOptions & {mode: 'spectrum'},
): MeterHandle;
export function mountMeter(host: MeterHost, binding: MeterBinding, options?: MeterOptions): MeterHandle;
export function mountMeter(
  host: MeterHost,
  binding: LevelMeterBinding | SpectrumMeterBinding,
  options: MeterOptions = {},
): MeterHandle {

  const document = host.ownerDocument;
  const mode = options.mode === 'spectrum' ? 'spectrum' : 'level';
  const formatters = options.formatters;
  let labelOverride = options.label;
  const defaultLabel = mode === 'spectrum' ? 'Spectrum' : 'Audio level';
  const barCount = countBars(options.bars);
  const style = installStyle(document, 'meter', meterStyle, options.stylesheet);

  const root = document.createElement('div');
  root.className = 'wui-meter';
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', options.label ?? defaultLabel);
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  root.setAttribute('aria-valuenow', '0');
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  if (options.height !== undefined) root.style.setProperty('--wui-meter-height', cssLength(options.height));
  if (options.color !== undefined) root.style.setProperty('--wui-meter-fill', options.color);
  if (options.peakColor !== undefined) root.style.setProperty('--wui-meter-peak', options.peakColor);
  if (options.backgroundColor !== undefined) {
    root.style.setProperty('--wui-meter-background', options.backgroundColor);
  }

  let fill: HTMLElement | undefined;
  let peak: HTMLElement | undefined;
  let bars: HTMLElement[] = [];

  if (mode === 'spectrum') {
    const spectrum = document.createElement('div');
    spectrum.className = 'wui-meter__spectrum';
    addClassNames(spectrum, options.classNames?.spectrum);
    setParts(spectrum, 'spectrum', options.parts?.spectrum);
    bars = Array.from({length: barCount}, () => {
      const bar = document.createElement('div');
      bar.className = 'wui-meter__bar';
      addClassNames(bar, options.classNames?.bar);
      setParts(bar, 'bar', options.parts?.bar);
      spectrum.append(bar);
      return bar;
    });
    root.append(spectrum);
  } else {
    const track = document.createElement('div');
    track.className = 'wui-meter__track';
    addClassNames(track, options.classNames?.track);
    setParts(track, 'track', options.parts?.track);
    fill = document.createElement('div');
    fill.className = 'wui-meter__fill';
    addClassNames(fill, options.classNames?.fill);
    setParts(fill, 'fill', options.parts?.fill);
    peak = document.createElement('div');
    peak.className = 'wui-meter__peak';
    addClassNames(peak, options.classNames?.peak);
    setParts(peak, 'peak', options.parts?.peak);
    track.append(fill, peak);
    root.append(track);
  }


  let destroyed = false;
  let rafId: number | null = null;
  const reportError = createErrorSink(options.onError);
  const textLabel = (copy: MeterText | undefined): string => labelOverride ?? textValue(
    mode === 'spectrum' ? copy?.spectrum : copy?.level, defaultLabel, {}, reportError,
  );
  const updateLabel = (label?: string): void => {
    if (destroyed) return;
    labelOverride = label;
    try {
      const text = textLabel(readText(options.getText, reportError));
      if (!destroyed) root.setAttribute('aria-label', text);
    } catch (error) {
      reportError(error);
    }
  };

  const redrawLoop = createUpdateLoop({
    name: 'Meter',
    isCurrent: () => !destroyed,
    report: reportError,
    pass: () => {
      if (destroyed) return;
      try {
        const copy = readText(options.getText, reportError);
        const label = textLabel(copy);
        if (destroyed) return;
        if (mode === 'spectrum') {
          if (!('readSpectrum' in binding) || typeof binding.readSpectrum !== 'function') {
            throw new TypeError('Spectrum meter requires readSpectrum(bars)');
          }
          const samples = binding.readSpectrum(barCount);
          if (destroyed) return;
          const values = bars.map((_bar, index) => clamp01(samples[index]));
          const maximum = values.reduce((largest, value) => Math.max(largest, value), 0);
          const value = formatPercent(formatters, maximum, undefined, reportError);
          const text = textValue(copy?.spectrumValue, `${value} spectrum peak`, {value, maximum}, reportError);
          if (destroyed) return;
          bars.forEach((bar, index) => { bar.style.height = `${Math.max(1, values[index]! * 100)}%`; });
          root.setAttribute('aria-valuenow', String(Math.round(maximum * 100)));
          root.setAttribute('aria-valuetext', text);
        } else {
          if (!('readLevel' in binding) || typeof binding.readLevel !== 'function') {
            throw new TypeError('Level meter requires readLevel()');
          }
          const state = binding.readLevel();
          if (destroyed) return;
          const level = clamp01(state.level);
          const held = clamp01(state.peakHold ?? state.peak ?? level);
          const value = formatPercent(formatters, level, undefined, reportError);
          const text = textValue(copy?.levelValue, `${value} level`, {value, level, peak: state.peak, peakHold: state.peakHold}, reportError);
          if (destroyed) return;
          fill!.style.width = `${level * 100}%`;
          peak!.style.left = `${held * 100}%`;
          root.setAttribute('aria-valuenow', String(Math.round(level * 100)));
          root.setAttribute('aria-valuetext', text);
        }
        root.setAttribute('aria-label', label);
      } catch (error) {
        reportError(error);
      }
    },
  });
  const redraw = redrawLoop.run;

  const requestFrame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame.bind(globalThis)
      : undefined;
  const cancelFrame =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame.bind(globalThis)
      : undefined;
  const tick = (): void => {
    if (destroyed) return;
    redraw();
    if (destroyed) return;
    rafId = requestFrame?.(tick) ?? null;
  };

  const handle: MeterHandle = {
    element: root,
    redraw,
    updateLabel,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      redrawLoop.cancel();
      const frame = rafId;
      rafId = null;
      bars = [];
      fill = undefined;
      peak = undefined;
      runCleanups([
        () => { if (frame != null) cancelFrame?.(frame); },
        () => root.remove(),
        () => style?.remove(),
        () => claim.release(),
      ], reportError);
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mountedMeters, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) {
    handle.destroy();
    return handle;
  }

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    handle.destroy();
    return handle;
  }
  updateLabel(labelOverride);
  if (destroyed) return handle;
  if (options.animate === false) redraw();
  else if (requestFrame) rafId = requestFrame(tick);
  return handle;
}
