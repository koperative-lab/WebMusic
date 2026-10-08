import {createFader, faderStyle} from '../fader';
import {mountSurfaceSlider} from '../stage';

/** Shared compact controls for signal inspectors. */
export const analysisControlStyle = `
${faderStyle}
.wui-analysis-button, .wui-analysis-select {
  box-sizing: border-box; min-height: var(--wm-analysis-control-size, 1.5rem);
  border: 1px solid var(--wm-control-border, var(--wm-border, #d8d8d8));
  border-radius: var(--wm-control-radius, 0); padding: .15rem .4rem;
  background: var(--wm-surface, #fff); color: inherit;
  font: 400 .72rem/1.2 var(--wm-font-family, system-ui, sans-serif);
}
.wui-analysis-button { cursor: pointer; }
.wui-analysis-button[aria-pressed='true'] {
  background: var(--wm-accent, #444); color: var(--wm-accent-foreground, #fff);
}
.wui-analysis-button:disabled { opacity: .45; cursor: default; }
.wui-analysis-button:focus-visible, .wui-analysis-select:focus-visible {
  outline: 2px solid var(--wm-focus, var(--wm-foreground, #444)); outline-offset: 2px;
}
.wui-analysis-fader {
  display: grid; grid-template-columns: max-content minmax(3rem, 1fr) 8ch;
  align-items: center; gap: .4rem; flex: 1 1 15rem; min-width: 0; max-width: 100%;
  font: 400 .72rem/1.2 var(--wm-font-family, system-ui, sans-serif);
}
.wui-analysis-fader > [role='slider'] {
  --wm-fader-length: 100%; --wm-fader-thickness: var(--wm-analysis-control-size, 1.5rem);
  --wm-fader-handle: .4rem;
}
.wui-analysis-fader__value {
  min-width: 0; text-align: right; white-space: nowrap;
  font: 400 .72rem/1.2 var(--wm-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
`;

interface AnalysisFaderOptions {
  label: string;
  part: string;
  min: number;
  max: number;
  step: number;
  value: number;
  formatValue(value: number): string;
  onInput(value: number): void;
  onError?(error: unknown): void;
}

interface AnalysisFaderRange {
  min?: number;
  max?: number;
  disabled?: boolean;
}

/** The standard fader geometry, with slider semantics in the inspector's units. */
export function createAnalysisFader(document: Document, options: AnalysisFaderOptions) {
  const element = document.createElement('div');
  element.className = 'wui-analysis-fader';
  const label = document.createElement('span');
  label.textContent = options.label;
  const value = document.createElement('output');
  value.className = 'wui-analysis-fader__value';
  value.setAttribute('aria-live', 'off');
  const fader = createFader(document, {
    label: options.label, orientation: 'horizontal', parts: {root: options.part},
  });
  // Keep the reusable fill/handle, replacing its normalized interaction with
  // the same slider primitive in dBFS, milliseconds or the caller's own units.
  fader.destroy();
  const control = fader.element;
  element.append(label, control, value);
  let min = options.min;
  let max = options.max;
  let current = options.value;
  let disabled = false;
  let destroyed = false;
  const clamp = (next: number): number => Math.max(min, Math.min(max, Number.isFinite(next) ? next : min));
  const paintValue = (): void => {
    current = clamp(current);
    fader.paint(max > min ? (current - min) / (max - min) : 0, disabled || max <= min);
    value.textContent = options.formatValue(current);
  };
  const slider = mountSurfaceSlider(control, {
    snapshot: () => ({minimum: min, maximum: max, value: current, disabled: disabled || max <= min}),
    valueAt: ({x, rect}) => min + x / Math.max(1, rect.width) * (max - min),
    commit: (next) => {
      const step = options.step;
      current = next <= min ? min : next >= max ? max
        : clamp(step > 0 ? Number((min + Math.round((next - min) / step) * step).toFixed(9)) : next);
      paintValue();
      slider.update();
      options.onInput(current);
    },
  }, {
    label: options.label, orientation: 'horizontal', keyboardStep: options.step,
    formatValue: options.formatValue, onError: options.onError,
  });
  paintValue();
  slider.update();
  return {
    element, control, value,
    paint(next: number, range: AnalysisFaderRange = {}): void {
      if (destroyed) return;
      if (range.min !== undefined) min = range.min;
      if (range.max !== undefined) max = range.max;
      if (range.disabled !== undefined) disabled = range.disabled;
      current = next;
      paintValue();
      slider.update();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      slider.destroy();
      fader.destroy();
    },
  };
}

/** Transport and pressed controls already expose ordinary operating state. */
export function setAnalysisStatus(element: HTMLElement, status: string): void {
  const routine = /^(?:live|paused|frozen|playback paused|live spectrum|spectrum frozen|waveform frozen)$/i.test(status.trim());
  const text = routine ? '' : status;
  if (element.textContent !== text) element.textContent = text;
  element.hidden = !text;
}
