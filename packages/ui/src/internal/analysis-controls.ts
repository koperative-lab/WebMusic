import {createFader} from '../fader';
import {mountSurfaceSlider} from '../stage';
import {controlHeight} from './control';
import {hiddenScrollbarCss, iconButtonCss, visuallyHiddenCss} from './icons';
import {neutralColor} from './palette';

const SIZE = controlHeight('analysis-control');
const LINE = `var(--wm-control-border, var(--wm-border, ${neutralColor('border')}))`;
const MUTED = `var(--wm-foreground-muted, ${neutralColor('muted')})`;
const MONO = 'var(--wm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/** Line colour shared by analysis plots and control rows. */
export const analysisLine = LINE;
/** Muted caption colour shared by analysis readouts. */
export const analysisMuted = MUTED;
/** Mono font chain shared by analysis readouts. */
export const analysisMono = MONO;

/**
 * Shared controls for signal inspectors (Visual design → Controls, Toolbars):
 * one non-wrapping row of control height that scrolls sideways without a
 * visible scrollbar, square icon buttons edge to edge inside a group, groups
 * and faders separated by full-height hairlines, and quiet status text that
 * stays in the live region but is visually hidden. Rules use `:where()`.
 */
export const analysisControlStyle = `
:where(.wui-analysis-row) {
  display: flex; flex-wrap: nowrap; align-items: stretch; min-width: 0; max-width: 100%;
  overflow-x: auto; overflow-y: hidden; border-block: 1px solid ${LINE};
}
${hiddenScrollbarCss('.wui-analysis-row')}:where(.wui-analysis-row > * + *) { border-left: 1px solid ${LINE}; }
:where(.wui-analysis-group) { display: flex; flex: none; align-items: stretch; }
${iconButtonCss('.wui-analysis-button', 'analysis-control')}
:where(.wui-analysis-fader) {
  display: grid; grid-template-columns: max-content minmax(4rem, 1fr) max-content; align-items: center; gap: .5rem;
  flex: 1 0 14rem; min-width: 14rem; height: ${SIZE}; padding: 0 0 0 .5rem;
}
:where(.wui-analysis-fader__label) {
  white-space: nowrap; color: ${MUTED};
  font: 400 .625rem/1 ${MONO}; text-transform: uppercase; letter-spacing: .06em;
}
:where(.wui-analysis-fader > [role='slider']) {
  --wm-fader-length: 100%; --wm-fader-thickness: ${SIZE}; --wm-fader-handle: .4rem;
}
:where(.wui-analysis-fader > [role='slider']:focus-visible) {
  outline: var(--wm-focus-ring, 2px solid var(--wm-foreground, ${neutralColor('foreground')})); outline-offset: -2px;
}
:where(.wui-analysis-fader > [role='slider'][aria-disabled='true']) { opacity: .3; cursor: default; }
:where(.wui-analysis-fader__value) {
  min-width: calc(8ch + .5rem); padding-right: .5rem; text-align: right; white-space: nowrap;
  font: 400 .6875rem/1 ${MONO}; font-variant-numeric: tabular-nums;
}
:where([data-analysis-quiet]) { ${visuallyHiddenCss} }
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
  label.className = 'wui-analysis-fader__label';
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

/** How a status line is presented: absent, announced only, or shown. */
export type AnalysisStatusKind = 'none' | 'quiet' | 'error';

/** Transport and pressed controls already expose ordinary operating state. */
const ROUTINE = /^(?:live|paused|frozen|playback paused|live spectrum|spectrum frozen|waveform frozen)$/i;
/** Informational states: announced to assistive technology, never drawn. */
const QUIET = /^(?:no signal|listening|no matching edge|waiting for (?:playback|input|a source|source)|loading(?: audio)?)$/i;

/**
 * Write a status line. Routine transport state is cleared; informational
 * state stays in the `role="status"` region but is visually hidden
 * (`data-analysis-quiet`); anything else — a failure or a configuration
 * problem — is shown.
 */
export function setAnalysisStatus(element: HTMLElement, status: string): AnalysisStatusKind {
  const trimmed = status.trim();
  const kind: AnalysisStatusKind = !trimmed || ROUTINE.test(trimmed) ? 'none' : QUIET.test(trimmed) ? 'quiet' : 'error';
  const text = kind === 'none' ? '' : status;
  if (element.textContent !== text) element.textContent = text;
  element.hidden = kind === 'none';
  element.toggleAttribute('data-analysis-quiet', kind === 'quiet');
  return kind;
}

/**
 * Write the status region that holds a status line beside the shared pending
 * indicator. While pending the indicator speaks; otherwise the region is
 * removed when empty and visually hidden when only informational.
 */
export function setAnalysisStatusRegion(region: HTMLElement, message: HTMLElement, status: string, pending: boolean): void {
  const kind = setAnalysisStatus(message, pending ? '' : status);
  region.hidden = !pending && kind === 'none';
  region.toggleAttribute('data-analysis-quiet', !pending && kind === 'quiet');
}
