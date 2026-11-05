import {mountStatus, statusStyle, type StatusState} from './status';
import {claimHost} from './internal/lifecycle';
import {installStyle} from './internal/style';
import {
  analysisControlStyle, analysisLine, analysisMono, analysisMuted, createAnalysisFader, setAnalysisStatusRegion,
} from './internal/analysis-controls';
import {ICON_PATHS, setIconButton, visuallyHiddenCss} from './internal/icons';
import {neutralColor} from './internal/palette';

export interface TransientAnalyzerSample {
  strength: number;
  hit: boolean;
}

export interface TransientAnalyzerState {
  sample?: TransientAnalyzerSample;
  history: readonly TransientAnalyzerSample[];
  sensitivity: number;
  threshold: number;
  frozen: boolean;
  hitCount: number;
  lastIntervalMs?: number;
  status: string;
  /** Waiting for a source or playback; replaces visible status prose with the shared indicator. */
  waiting?: boolean;
  /** Active source work; takes precedence over passive waiting. */
  loading?: boolean;
}

export interface TransientAnalyzerActions {
  onSensitivityChange(value: number): void;
  onFreezeChange(frozen: boolean): void;
  onClear(): void;
}

export interface TransientAnalyzerHandle {
  element: HTMLElement;
  update(state: TransientAnalyzerState): void;
  destroy(): void;
}

const COLUMNS = 64;
const mounted = new WeakMap<HTMLElement, TransientAnalyzerHandle>();

const transientAnalyzerStyle = `${statusStyle}
${analysisControlStyle}
:where(.wui-transient-analyzer) { box-sizing: border-box; display: grid; gap: .75rem; width: 100%; min-width: 0;
  color: var(--wm-transient-analyzer-foreground, var(--wm-foreground, ${neutralColor('foreground')}));
  background: var(--wm-transient-analyzer-background, var(--wm-surface, light-dark(#fff, #111)));
  border: 1px solid var(--wm-transient-analyzer-border, var(--wm-border, ${neutralColor('border')}));
  padding: var(--wm-transient-analyzer-padding, .85rem); }
:where(.wui-transient-analyzer, .wui-transient-analyzer *) { box-sizing: border-box; }
:where(.wui-transient-analyzer__controls) { border-color: var(--wm-transient-analyzer-border, ${analysisLine}); }
:where(.wui-transient-analyzer__controls > * + *) { border-left-color: var(--wm-transient-analyzer-border, ${analysisLine}); }
:where(.wui-transient-analyzer__status) { font: 400 .6875rem/1.4 ${analysisMono}; color: var(--wm-muted, ${analysisMuted}); }
:where(.wui-transient-analyzer__values) { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; margin: 0; }
:where(.wui-transient-analyzer__values > div) { min-width: 0; }
:where(.wui-transient-analyzer__values dt) { font: 400 .625rem/1.2 ${analysisMono}; text-transform: uppercase; letter-spacing: .06em;
  color: var(--wm-muted, ${analysisMuted}); }
:where(.wui-transient-analyzer__values dd) { margin: .15rem 0 0; font: 600 1.25rem/1.15 ${analysisMono};
  font-variant-numeric: tabular-nums; white-space: nowrap; }
:where(.wui-transient-analyzer__values small) { font: 400 .6875rem/1.2 ${analysisMono}; color: var(--wm-muted, ${analysisMuted}); }
:where(.wui-transient-analyzer__plot) { position: relative; height: 96px; display: flex; align-items: end; gap: 1px;
  border: 0; background: var(--wm-surface-muted, light-dark(#f3f3f3, #1c1c1c)); overflow: hidden; }
:where(.wui-transient-analyzer__column) { position: relative; flex: 1 1 0; min-width: 0; height: 100%; }
:where(.wui-transient-analyzer__bar) { position: absolute; bottom: 0; left: 0; right: 0;
  background: var(--wm-transient-analyzer-strength, light-dark(#999, #666)); }
:where(.wui-transient-analyzer__column[data-hit='true'] .wui-transient-analyzer__bar) {
  background: var(--wm-transient-analyzer-hit, var(--wm-foreground, ${neutralColor('foreground')})); }
:where(.wui-transient-analyzer__threshold) { position: absolute; left: 0; right: 0; pointer-events: none;
  border-top: 1px dashed var(--wm-transient-analyzer-threshold, var(--wm-foreground-muted, ${neutralColor('muted')})); }
:where(.wui-transient-analyzer__scale) { ${visuallyHiddenCss} }
@media (max-width: 400px) { :where(.wui-transient-analyzer__values dd) { font-size: 1rem; } }
@media (forced-colors: active) { :where(.wui-transient-analyzer__bar) { background: Highlight; }
  :where(.wui-transient-analyzer__threshold) { border-color: CanvasText; } }
`;

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/** Present streaming attack evidence; the caller owns sampling and detection. */
export function mountTransientAnalyzer(host: HTMLElement, actions: TransientAnalyzerActions): TransientAnalyzerHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'transient-analyzer', transientAnalyzerStyle);
  const root = document.createElement('section');
  root.className = 'wui-transient-analyzer';
  root.setAttribute('part', 'root surface');
  root.setAttribute('aria-label', 'Transient analyzer');

  const status = document.createElement('div');
  status.className = 'wui-transient-analyzer__status';
  status.hidden = true;
  const statusMessage = document.createElement('span');
  statusMessage.setAttribute('role', 'status');
  statusMessage.hidden = true;
  const waitingHost = document.createElement('div');
  let feedback: StatusState = {kind: 'ready'};
  const waiting = mountStatus(waitingHost, {snapshot: () => feedback}, {
    stylesheet: false, classNames: {root: 'wui-status--embedded'},
  });
  status.append(statusMessage, waitingHost);

  const values = document.createElement('dl');
  values.className = 'wui-transient-analyzer__values';
  const readout = (label: string, unit = ''): HTMLElement => {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = '--';
    if (unit) {
      const small = document.createElement('small');
      small.textContent = ` ${unit}`;
      value.append(small);
    }
    item.append(term, value);
    values.append(item);
    return value;
  };
  const strength = readout('Strength');
  const hits = readout('Hits');
  const interval = readout('Last interval', 'ms');

  const plot = document.createElement('div');
  plot.className = 'wui-transient-analyzer__plot';
  plot.setAttribute('part', 'plot');
  plot.setAttribute('role', 'img');
  const columns = Array.from({length: COLUMNS}, () => {
    const column = document.createElement('div');
    column.className = 'wui-transient-analyzer__column';
    const bar = document.createElement('div');
    bar.className = 'wui-transient-analyzer__bar';
    column.append(bar);
    plot.append(column);
    return {column, bar};
  });
  const thresholdLine = document.createElement('div');
  thresholdLine.className = 'wui-transient-analyzer__threshold';
  plot.append(thresholdLine);
  const scale = document.createElement('div');
  scale.className = 'wui-transient-analyzer__scale';
  for (const label of ['Recent frames', 'Attack strength', 'Now']) {
    const mark = document.createElement('span');
    mark.textContent = label;
    scale.append(mark);
  }

  const controls = document.createElement('div');
  controls.className = 'wui-transient-analyzer__controls wui-analysis-row';
  const buttons = document.createElement('div');
  buttons.className = 'wui-analysis-group';
  const freeze = document.createElement('button');
  freeze.type = 'button';
  freeze.className = 'wui-transient-analyzer__button wui-analysis-button';
  freeze.setAttribute('part', 'freeze');
  setIconButton(freeze, ICON_PATHS.freeze, 'Freeze');
  freeze.setAttribute('aria-pressed', 'false');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'wui-transient-analyzer__button wui-analysis-button';
  clear.setAttribute('part', 'clear');
  setIconButton(clear, ICON_PATHS.clear, 'Clear');
  const sensitivity = createAnalysisFader(document, {
    label: 'Sensitivity', part: 'sensitivity', min: 0, max: 100, step: 1, value: 55,
    formatValue: (value) => `${Math.round(value)}%`, onInput: (value) => actions.onSensitivityChange(value / 100),
  });
  buttons.append(freeze, clear);
  controls.append(buttons, sensitivity.element);
  root.append(values, plot, scale, controls, status);

  let destroyed = false;
  let frozen = false;
  const onFreeze = () => actions.onFreezeChange(!frozen);
  const onClear = () => actions.onClear();
  const handle: TransientAnalyzerHandle = {
    element: root,
    update(state) {
      if (destroyed) return;
      frozen = state.frozen;
      const pending = state.loading || state.waiting;
      setAnalysisStatusRegion(status, statusMessage, state.status, Boolean(pending));
      feedback = {kind: state.loading ? 'loading' : state.waiting ? 'waiting' : 'ready', message: pending ? state.status : ''};
      waiting.update();
      freeze.setAttribute('aria-pressed', String(frozen));
      sensitivity.paint(Math.round(state.sensitivity * 100));
      strength.firstChild!.textContent = state.sample ? percent(state.sample.strength) : '--';
      hits.firstChild!.textContent = String(state.hitCount);
      interval.firstChild!.textContent = state.lastIntervalMs === undefined ? '--' : String(Math.round(state.lastIntervalMs));
      thresholdLine.style.bottom = percent(state.threshold);
      const visible = state.history.slice(-COLUMNS);
      const pad = COLUMNS - visible.length;
      for (let index = 0; index < COLUMNS; index += 1) {
        const sample = visible[index - pad];
        columns[index]!.bar.style.height = sample ? percent(sample.strength) : '0';
        columns[index]!.column.dataset.hit = String(sample?.hit === true);
      }
      plot.setAttribute('aria-label', state.sample
        ? `Recent attack strength ${percent(state.sample.strength)}; threshold ${percent(state.threshold)}; ${state.hitCount} hits`
        : 'Recent attack strength; no live input');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      freeze.removeEventListener('click', onFreeze);
      clear.removeEventListener('click', onClear);
      sensitivity.destroy();
      waiting.destroy();
      root.remove();
      style?.remove();
      ownership.release();
    },
  };
  const ownership = claimHost(mounted, host, handle);
  ownership.destroyPrevious();
  if (ownership.isCurrent()) {
    if (style) host.append(style, root);
    else host.append(root);
    freeze.addEventListener('click', onFreeze);
    clear.addEventListener('click', onClear);
  } else handle.destroy();
  return handle;
}
