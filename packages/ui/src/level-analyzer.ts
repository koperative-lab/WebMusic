import {mountStatus, statusStyle, type StatusState} from './status';
import {installStyle} from './internal/style';
import {claimHost} from './internal/lifecycle';

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

.wui-level-analyzer { box-sizing: border-box; display: grid; gap: .75rem; width: 100%; min-width: 0;
  color: var(--wm-level-analyzer-foreground, var(--wm-foreground, #262b2a));
  background: var(--wm-level-analyzer-background, var(--wm-surface, #fff));
  border: 1px solid var(--wm-level-analyzer-border, var(--wm-border, #d5d9d7));
  padding: var(--wm-level-analyzer-padding, .85rem); }
.wui-level-analyzer, .wui-level-analyzer * { box-sizing: border-box; }
.wui-level-analyzer__head, .wui-level-analyzer__controls { display: flex; align-items: center; flex-wrap: wrap; gap: .55rem 1rem; }
.wui-level-analyzer__head { justify-content: space-between; }
.wui-level-analyzer__title { font-size: .82rem; font-weight: 700; text-transform: uppercase; }
.wui-level-analyzer__status { font-size: .78rem; color: var(--wm-muted, #68716e); }
.wui-level-analyzer__values { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; }
.wui-level-analyzer__readout { min-width: 0; }
.wui-level-analyzer__readout dt { font-size: .72rem; color: var(--wm-muted, #68716e); }
.wui-level-analyzer__readout dd { margin: .15rem 0 0; font: 600 1.35rem/1.15 ui-monospace, SFMono-Regular, Consolas, monospace;
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.wui-level-analyzer__readout small { font: 400 .68rem/1.2 system-ui, sans-serif; }
.wui-level-analyzer__plot { position: relative; height: 94px; overflow: hidden; display: flex; align-items: end;
  gap: 1px; border: 1px solid var(--wm-border, #d5d9d7); background: var(--wm-surface-muted, #f6f8f7); }
.wui-level-analyzer__column { position: relative; flex: 1 1 0; min-width: 0; height: 100%; }
.wui-level-analyzer__rms, .wui-level-analyzer__peak { position: absolute; bottom: 0; left: 0; right: 0; }
.wui-level-analyzer__rms { background: var(--wm-level-analyzer-rms, #247a70); }
.wui-level-analyzer__peak { height: 2px; background: var(--wm-level-analyzer-peak, #293f58); }
.wui-level-analyzer__threshold { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--wm-level-analyzer-threshold, #bd653f); pointer-events: none; }
.wui-level-analyzer__plot[data-over='true'] { outline: 2px solid var(--wm-danger, #bb453d); outline-offset: -2px; }
.wui-level-analyzer__scale { display: flex; justify-content: space-between; margin-top: -.5rem;
  font: .68rem ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--wm-muted, #68716e); }
.wui-level-analyzer__button { color: inherit; background: var(--wm-surface, #fff); border: 1px solid var(--wm-border, #bfc7c4);
  border-radius: var(--wm-control-radius, 4px); padding: .3rem .65rem; font: inherit; cursor: pointer; min-height: 32px; }
.wui-level-analyzer__button[aria-pressed='true'] { background: var(--wm-accent, #247a70); color: #fff; }
.wui-level-analyzer__threshold-label { display: inline-flex; align-items: center; gap: .5rem; margin-left: auto; font-size: .78rem; }
.wui-level-analyzer__threshold-input { width: min(155px, 31vw); accent-color: var(--wm-level-analyzer-threshold, #bd653f); }
.wui-level-analyzer__threshold-value { min-width: 5ch; font-variant-numeric: tabular-nums; text-align: right; }
@media (max-width: 400px) { .wui-level-analyzer__readout dd { font-size: 1.05rem; }
  .wui-level-analyzer__threshold-label { width: 100%; margin-left: 0; }
  .wui-level-analyzer__threshold-input { flex: 1; width: auto; } }
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

  const head = document.createElement('header');
  head.className = 'wui-level-analyzer__head';
  const title = document.createElement('strong');
  title.className = 'wui-level-analyzer__title';
  title.textContent = 'Level analyzer';
  const status = document.createElement('div');
  status.className = 'wui-level-analyzer__status';
  const statusMessage = document.createElement('span');
  statusMessage.setAttribute('role', 'status');
  const waitingHost = document.createElement('div');
  let feedback: StatusState = {kind: 'ready'};
  const waiting = mountStatus(waitingHost, {snapshot: () => feedback}, {
    stylesheet: false, classNames: {root: 'wui-status--embedded'},
  });
  status.append(statusMessage, waitingHost);
  head.append(title, status);

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
  freeze.className = 'wui-level-analyzer__button';
  freeze.textContent = 'Freeze';
  freeze.setAttribute('aria-pressed', 'false');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'wui-level-analyzer__button';
  reset.textContent = 'Reset hold';
  const thresholdLabel = document.createElement('label');
  thresholdLabel.className = 'wui-level-analyzer__threshold-label';
  thresholdLabel.textContent = 'Peak threshold';
  const thresholdInput = document.createElement('input');
  thresholdInput.className = 'wui-level-analyzer__threshold-input';
  thresholdInput.type = 'range';
  thresholdInput.min = String(MIN_DB);
  thresholdInput.max = String(MAX_DB);
  thresholdInput.step = '1';
  const thresholdValue = document.createElement('span');
  thresholdValue.className = 'wui-level-analyzer__threshold-value';
  thresholdLabel.append(thresholdInput, thresholdValue);
  controls.append(freeze, reset, thresholdLabel);
  root.append(head, values, plot, scale, controls);

  let destroyed = false;
  let frozen = false;
  const onFreeze = () => actions.onFreezeChange(!frozen);
  const onReset = () => actions.onResetHold();
  const onThreshold = () => actions.onThresholdChange(Number(thresholdInput.value));

  const handle: LevelAnalyzerHandle = {
    element: root,
    update(state) {
      if (destroyed) return;
      frozen = state.frozen;
      const pending = state.loading || state.waiting;
      if (statusMessage.textContent !== (pending ? '' : state.status)) statusMessage.textContent = pending ? '' : state.status;
      statusMessage.hidden = pending === true;
      feedback = {kind: state.loading ? 'loading' : state.waiting ? 'waiting' : 'ready', message: pending ? state.status : ''};
      waiting.update();
      freeze.setAttribute('aria-pressed', String(frozen));
      freeze.textContent = frozen ? 'Unfreeze' : 'Freeze';
      thresholdInput.value = String(state.thresholdDbfs);
      thresholdValue.textContent = `${state.thresholdDbfs} dBFS`;
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
      thresholdInput.removeEventListener('input', onThreshold);
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
    thresholdInput.addEventListener('input', onThreshold);
  } else handle.destroy();
  return handle;
}
