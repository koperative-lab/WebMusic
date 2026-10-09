import {mountStatus, statusStyle, type StatusState} from './status';
import {installStyle} from './internal/style';
import {claimHost} from './internal/lifecycle';
import {analysisControlStyle, createAnalysisFader, setAnalysisStatus} from './internal/analysis-controls';

/** A sampled window from a caller-owned signal graph, expressed in dBFS. */
export interface LevelAnalyzerSample {
  rmsDbfs: number;
  peakDbfs: number;
}

export interface LevelAnalyzerState {
  sample?: LevelAnalyzerSample;
  heldPeakDbfs?: number;
  history: readonly LevelAnalyzerSample[];
  thresholdDbfs: number;
  frozen: boolean;
  status: string;
  /** Waiting for a source or playback; replaces visible status prose with the shared indicator. */
  waiting?: boolean;
  /** Active source work; takes precedence over passive waiting. */
  loading?: boolean;
}

export interface LevelAnalyzerActions {
  onThresholdChange(value: number): void;
  onFreezeChange(frozen: boolean): void;
  onResetHold(): void;
}

export interface LevelAnalyzerHandle {
  element: HTMLElement;
  update(state: LevelAnalyzerState): void;
  destroy(): void;
}

const MIN_DB = -60;
const MAX_DB = 0;
const COLUMNS = 64;
const mounted = new WeakMap<HTMLElement, LevelAnalyzerHandle>();

const levelAnalyzerStyle = `${statusStyle}
${analysisControlStyle}
.wui-level-analyzer { box-sizing: border-box; display: grid; gap: .75rem; width: 100%; min-width: 0;
  color: var(--wm-level-analyzer-foreground, var(--wm-foreground, #222));
  background: var(--wm-level-analyzer-background, var(--wm-surface, #fff));
  border: 1px solid var(--wm-level-analyzer-border, var(--wm-border, #d8d8d8));
  padding: var(--wm-level-analyzer-padding, .85rem); }
.wui-level-analyzer, .wui-level-analyzer * { box-sizing: border-box; }
.wui-level-analyzer__controls { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem .65rem; }
.wui-level-analyzer__status { font-size: .78rem; color: var(--wm-muted, var(--wm-foreground-muted, #777)); }
.wui-level-analyzer__values { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; margin: 0; }
.wui-level-analyzer__readout { min-width: 0; }
.wui-level-analyzer__readout dt { font-size: .72rem; color: var(--wm-muted, var(--wm-foreground-muted, #777)); }
.wui-level-analyzer__readout dd { margin: .15rem 0 0; font: 600 1.35rem/1.15 ui-monospace, SFMono-Regular, Consolas, monospace;
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.wui-level-analyzer__readout small { font: 400 .68rem/1.2 system-ui, sans-serif; }
.wui-level-analyzer__plot { position: relative; height: 94px; overflow: hidden; display: flex; align-items: end;
  gap: 1px; border: 1px solid var(--wm-border, #d8d8d8); background: var(--wm-surface-muted, #f3f3f3); }
.wui-level-analyzer__column { position: relative; flex: 1 1 0; min-width: 0; height: 100%; }
.wui-level-analyzer__rms, .wui-level-analyzer__peak { position: absolute; bottom: 0; left: 0; right: 0; }
.wui-level-analyzer__rms { background: var(--wm-level-analyzer-rms, #999); }
.wui-level-analyzer__peak { height: 2px; background: var(--wm-level-analyzer-peak, #111); }
.wui-level-analyzer__threshold { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--wm-level-analyzer-threshold, #666); pointer-events: none; }
.wui-level-analyzer__plot[data-over='true'] { outline: 2px solid var(--wm-danger, #111); outline-offset: -2px; }
.wui-level-analyzer__scale { display: flex; justify-content: space-between; margin-top: -.5rem;
  font: .68rem ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--wm-muted, var(--wm-foreground-muted, #777)); }
@media (max-width: 400px) { .wui-level-analyzer__readout dd { font-size: 1.05rem; } }
@media (forced-colors: active) { .wui-level-analyzer__rms { background: Highlight; }
  .wui-level-analyzer__peak, .wui-level-analyzer__threshold { background: CanvasText; } }
`;

function heightFor(db: number): number {
  return Math.max(0, Math.min(100, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
}

function formatDb(db: number | undefined): string {
  if (db === undefined || !Number.isFinite(db)) return '--';
  return `${db.toFixed(1)}`;
}

/** Mount a sampled dynamics inspector. Signal acquisition remains with the caller. */
export function mountLevelAnalyzer(host: HTMLElement, actions: LevelAnalyzerActions): LevelAnalyzerHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'level-analyzer', levelAnalyzerStyle);
  const root = document.createElement('section');
  root.className = 'wui-level-analyzer';
  root.setAttribute('part', 'root surface');
  root.setAttribute('aria-label', 'Level analyzer');

  const status = document.createElement('div');
  status.className = 'wui-level-analyzer__status';
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
  values.className = 'wui-level-analyzer__values';
  function readout(label: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'wui-level-analyzer__readout';
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = '--';
    const unit = document.createElement('small');
    unit.textContent = ' dB';
    value.append(unit);
    container.append(term, value);
    values.append(container);
    return value;
  }
  const rms = readout('RMS');
  const peak = readout('Peak hold');
  const crest = readout('Crest');

  const plot = document.createElement('div');
  plot.className = 'wui-level-analyzer__plot';
  plot.setAttribute('role', 'img');
  plot.setAttribute('aria-label', 'Recent RMS and sample peak');
  const columns = Array.from({length: COLUMNS}, () => {
    const column = document.createElement('div');
    column.className = 'wui-level-analyzer__column';
    const fill = document.createElement('div');
    fill.className = 'wui-level-analyzer__rms';
    const mark = document.createElement('div');
    mark.className = 'wui-level-analyzer__peak';
    column.append(fill, mark);
    plot.append(column);
    return {fill, mark};
  });
  const line = document.createElement('div');
  line.className = 'wui-level-analyzer__threshold';
  plot.append(line);
  const scale = document.createElement('div');
  scale.className = 'wui-level-analyzer__scale';
  for (const text of ['-60 dBFS', '-30', '0']) {
    const label = document.createElement('span');
    label.textContent = text;
    scale.append(label);
  }

  const controls = document.createElement('div');
  controls.className = 'wui-level-analyzer__controls';
  const freeze = document.createElement('button');
  freeze.type = 'button';
  freeze.className = 'wui-level-analyzer__button wui-analysis-button';
  freeze.setAttribute('part', 'freeze');
  freeze.textContent = 'Freeze';
  freeze.setAttribute('aria-pressed', 'false');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'wui-level-analyzer__button wui-analysis-button';
  reset.setAttribute('part', 'reset');
  reset.setAttribute('aria-label', 'Reset hold');
  reset.textContent = 'Reset';
  const threshold = createAnalysisFader(document, {
    label: 'Peak threshold', part: 'threshold', min: MIN_DB, max: MAX_DB, step: 1, value: -12,
    formatValue: (value) => `${value} dBFS`, onInput: (value) => actions.onThresholdChange(value),
  });
  controls.append(freeze, reset, threshold.element);
  root.append(values, plot, scale, controls, status);

  let destroyed = false;
  let frozen = false;
  const onFreeze = () => actions.onFreezeChange(!frozen);
  const onReset = () => actions.onResetHold();

  const handle: LevelAnalyzerHandle = {
    element: root,
    update(state) {
      if (destroyed) return;
      frozen = state.frozen;
      const pending = state.loading || state.waiting;
      setAnalysisStatus(statusMessage, pending ? '' : state.status);
      feedback = {kind: state.loading ? 'loading' : state.waiting ? 'waiting' : 'ready', message: pending ? state.status : ''};
      waiting.update();
      status.hidden = !pending && statusMessage.hidden;
      freeze.setAttribute('aria-pressed', String(frozen));
      threshold.paint(state.thresholdDbfs);
      line.style.bottom = `${heightFor(state.thresholdDbfs)}%`;
      plot.dataset.over = String((state.sample?.peakDbfs ?? -Infinity) >= state.thresholdDbfs);
      rms.firstChild!.textContent = formatDb(state.sample?.rmsDbfs);
      peak.firstChild!.textContent = formatDb(state.heldPeakDbfs);
      const crestDb = state.sample ? state.sample.peakDbfs - state.sample.rmsDbfs : undefined;
      crest.firstChild!.textContent = formatDb(crestDb);
      const start = Math.max(0, state.history.length - COLUMNS);
      for (let i = 0; i < COLUMNS; i += 1) {
        const sample = state.history[start + i];
        columns[i]!.fill.style.height = sample ? `${heightFor(sample.rmsDbfs)}%` : '0';
        columns[i]!.mark.style.bottom = sample ? `${heightFor(sample.peakDbfs)}%` : '0';
        columns[i]!.mark.style.visibility = sample ? 'visible' : 'hidden';
      }
      plot.setAttribute('aria-label', state.sample
        ? `Recent RMS and sample peak; RMS ${formatDb(state.sample.rmsDbfs)} dBFS, sample peak ${formatDb(state.sample.peakDbfs)} dBFS`
        : 'Recent RMS and sample peak; no signal');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      freeze.removeEventListener('click', onFreeze);
      reset.removeEventListener('click', onReset);
      threshold.destroy();
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
    reset.addEventListener('click', onReset);
  } else handle.destroy();
  return handle;
}
