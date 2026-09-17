import {
  createAnalysisPlayhead,
  createAnalysisRoot,
  renderChordTimeline,
  renderHistogram,
  renderSummaryCard,
  type AnalysisPlayheadHandle,
  type AnalysisPlayheadOptions,
} from '@webmusic/ui/analysis';
import {
  mountChipStrip,
  mountFlowLane,
  mountNameplate,
  mountWheel,
  type ChipItem,
  type ChipStripHandle,
  type ChipStripOptions,
  type ChipStripState,
  type ChordNameCandidate,
  type FlowBand,
  type FlowLaneHandle,
  type FlowLaneOptions,
  type FlowLaneState,
  type FrameTick,
  type HarmonyVoice,
  type NameplateHandle,
  type NameplateOptions,
  type NameplateState,
  type Severity,
  type WheelHandle,
  type WheelOptions,
  type WheelState,
} from '@webmusic/ui/harmony';
import {
  mountFretboard,
  mountKeyboard,
  mountStaff,
  type FretboardBarre,
  type FretboardHandle,
  type FretboardOptions,
  type FretboardState,
  type KeyboardHandle,
  type KeyboardOptions,
  type KeyboardState,
  type MotionMode,
  type StaffHandle,
  type StaffState,
} from '@webmusic/ui/pitch';
import {
  mountCanvasStage,
  mountStage,
  mountSurfaceSlider,
  type CanvasStageFrame,
  type CanvasStageHandle,
  type CanvasStageOptions,
  type StageHandle,
  type StageOptions,
  type SurfaceSliderHandle,
  type SurfaceSliderOptions,
  type SurfaceSliderPoint,
  type SurfaceSliderState,
} from '@webmusic/ui/stage';
import {
  mountStatus,
  type StatusHandle,
  type StatusOptions,
  type StatusState,
} from '@webmusic/ui/status';
import {
  mountTrackList,
  type TrackListHandle,
  type TrackListItem,
  type TrackListOptions,
  type TrackListState,
} from '@webmusic/ui/track-list';
import {
  mountWorkbench,
  type WorkbenchBinding,
  type WorkbenchDock,
  type WorkbenchHandle,
  type WorkbenchOptions,
  type WorkbenchPhase,
  type WorkbenchState,
  type WorkbenchView,
} from '@webmusic/ui/workbench';
import type {
  UiPresenterDemoHandle,
  UiPresenterDemoMountResult,
} from './types';

interface DemoNotifier {
  notify(): void;
  subscribe(notify: () => void): () => void;
  clear(): void;
}

function createNotifier(): DemoNotifier {
  const listeners = new Set<() => void>();
  return {
    notify(): void {
      for (const listener of [...listeners]) listener();
    },
    subscribe(notify: () => void): () => void {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    clear(): void {
      listeners.clear();
    },
  };
}

function assignOption(
  values: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  if (value === undefined) delete values[name];
  else values[name] = value;
}

function reportDemoError(host: HTMLElement, error: unknown): void {
  host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
}

function retainedStageOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): StageOptions {
  const options: StageOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.fill === 'boolean') options.fill = values.fill;
  if (typeof values.surfaceMinWidth === 'string') options.surfaceMinWidth = values.surfaceMinWidth;
  if (typeof values.background === 'string') options.background = values.background;
  if (['hidden', 'auto', 'visible', 'clip', 'scroll'].includes(String(values.overflow))) {
    options.overflow = values.overflow as StageOptions['overflow'];
  }
  if (values.classNames === 'demo') {
    options.classNames = {root: 'demo-stage', surface: 'demo-stage-surface'};
  }
  if (values.parts === 'demo') {
    options.parts = {root: 'demo-root', surface: 'demo-surface'};
  }
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function canvasStageOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): CanvasStageOptions {
  const options: CanvasStageOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.animate === 'boolean') options.animate = values.animate;
  if (typeof values.fallbackWidth === 'number') options.fallbackWidth = values.fallbackWidth;
  if (typeof values.fallbackHeight === 'number') options.fallbackHeight = values.fallbackHeight;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-stage',
      canvas: 'demo-stage-canvas',
      status: 'demo-stage-status',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      canvas: 'demo-canvas',
      status: 'demo-status',
    };
  }
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function surfaceSliderOptions(
  host: HTMLElement,
  pointerSurface: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): SurfaceSliderOptions {
  const options: SurfaceSliderOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (values.orientation === 'horizontal' || values.orientation === 'vertical') {
    options.orientation = values.orientation;
  }
  if (values.pointerTarget === 'track') options.pointerTarget = pointerSurface;
  if (typeof values.keyboardStep === 'number') options.keyboardStep = values.keyboardStep;
  if (values.formatValue === 'percent') {
    options.formatValue = (value, state) => {
      const span = state.maximum - state.minimum;
      const fraction = span > 0 ? (value - state.minimum) / span : 0;
      return `${Math.round(fraction * 100)}%`;
    };
  } else if (values.formatValue === 'units') {
    options.formatValue = (value) => `${value.toFixed(1)} units`;
  }
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

const INITIAL_STAGE_STATE: SurfaceSliderState = {
  minimum: 0,
  maximum: 100,
  value: 36,
  disabled: false,
};

function normalizeStageState(state: SurfaceSliderState): Required<SurfaceSliderState> {
  const minimum = Number.isFinite(state.minimum) ? state.minimum : 0;
  const maximum = Math.max(
    minimum,
    Number.isFinite(state.maximum) ? state.maximum : minimum,
  );
  const value = Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(state.value) ? state.value : minimum),
  );
  return {minimum, maximum, value, disabled: state.disabled === true};
}

function createStageDemoRegion(
  document: Document,
  title: string,
): {region: HTMLElement; body: HTMLElement} {
  const region = document.createElement('section');
  region.style.cssText = 'display:grid;gap:.4rem;min-width:0';
  const heading = document.createElement('strong');
  heading.textContent = title;
  heading.style.cssText =
    'font:600 .68rem/1.2 ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase';
  const body = document.createElement('div');
  body.style.cssText = 'position:relative;min-width:0';
  region.append(heading, body);
  return {region, body};
}

function mountStageDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let state: SurfaceSliderState = {...INITIAL_STAGE_STATE};
  let optionValues: Record<string, unknown> = {};
  let retainedPresenter: StageHandle | undefined;
  let canvasPresenter: CanvasStageHandle | undefined;
  let sliderPresenter: SurfaceSliderHandle | undefined;
  let destroyed = false;

  const document = host.ownerDocument;
  const shell = document.createElement('div');
  shell.style.cssText =
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:.6rem;align-items:start';
  const retained = createStageDemoRegion(document, 'Retained DOM stage');
  const canvas = createStageDemoRegion(document, 'Canvas stage');
  const slider = createStageDemoRegion(document, 'Surface slider');
  retained.body.style.height = '7rem';
  canvas.body.style.height = '7rem';

  const sliderElement = document.createElement('div');
  sliderElement.style.cssText =
    'position:relative;box-sizing:border-box;border:1px solid var(--wm-border,#aaa);background:var(--wm-surface,#fff);outline-offset:2px';
  const pointerSurface = document.createElement('div');
  pointerSurface.style.cssText =
    'position:absolute;border:1px solid var(--wm-border,#aaa);background:var(--wm-surface-muted,#eee)';
  const sliderFill = document.createElement('span');
  sliderFill.style.cssText =
    'position:absolute;background:var(--wm-accent,#111);pointer-events:none';
  const sliderThumb = document.createElement('span');
  sliderThumb.style.cssText =
    'position:absolute;width:.8rem;height:.8rem;border-radius:50%;background:var(--wm-accent,#111);transform:translate(-50%,-50%);pointer-events:none';
  const sliderValue = document.createElement('output');
  sliderValue.style.cssText =
    'position:absolute;font:600 .68rem/1.2 ui-monospace,monospace;pointer-events:none';
  pointerSurface.append(sliderFill, sliderThumb);
  sliderElement.append(pointerSurface, sliderValue);
  slider.body.append(sliderElement);
  shell.append(retained.region, canvas.region, slider.region);
  host.append(shell);

  const paintSlider = (): void => {
    const normalized = normalizeStageState(state);
    const span = normalized.maximum - normalized.minimum;
    const fraction = span > 0 ? (normalized.value - normalized.minimum) / span : 0;
    const vertical = optionValues.orientation === 'vertical';
    slider.body.style.display = vertical ? 'grid' : 'block';
    slider.body.style.placeItems = vertical ? 'center' : '';
    slider.body.style.minHeight = vertical ? '8rem' : '3rem';
    sliderElement.style.width = vertical ? '3.25rem' : '100%';
    sliderElement.style.height = vertical ? '8rem' : '3rem';
    sliderElement.style.opacity = normalized.disabled ? '.5' : '1';
    pointerSurface.style.inset = vertical ? '.45rem .8rem 1.7rem' : '.85rem .8rem';
    sliderFill.style.inset = vertical
      ? `${(1 - fraction) * 100}% 0 0`
      : `0 ${Math.max(0, 1 - fraction) * 100}% 0 0`;
    sliderThumb.style.left = vertical ? '50%' : `${fraction * 100}%`;
    sliderThumb.style.top = vertical ? `${(1 - fraction) * 100}%` : '50%';
    sliderValue.style.inset = vertical ? 'auto 0 .25rem' : 'auto .8rem .2rem auto';
    sliderValue.style.textAlign = 'center';
    sliderValue.textContent = String(Math.round(normalized.value * 100) / 100);
  };

  const publish = (): void => {
    paintSlider();
    notifier.notify();
  };

  const retainedBinding = {
    render(surface: HTMLElement): () => void {
      const normalized = normalizeStageState(state);
      const span = normalized.maximum - normalized.minimum;
      const fraction = span > 0 ? (normalized.value - normalized.minimum) / span : 0;
      const content = document.createElement('div');
      content.style.cssText =
        'display:grid;align-content:center;gap:.4rem;box-sizing:border-box;height:100%;min-height:3rem;padding:.55rem;background:var(--wm-surface-muted,#eee)';
      const readout = document.createElement('span');
      readout.textContent = `${normalized.value} in ${normalized.minimum}–${normalized.maximum}`;
      readout.style.cssText = 'font:600 .72rem/1.2 ui-monospace,monospace';
      const track = document.createElement('span');
      track.style.cssText =
        'display:block;height:.45rem;background:var(--wm-surface,#fff);overflow:hidden';
      const fill = document.createElement('span');
      fill.style.cssText = `display:block;width:${fraction * 100}%;height:100%;background:var(--wm-accent,#111)`;
      track.append(fill);
      content.append(readout, track);
      surface.append(content);
      return () => content.remove();
    },
    subscribe: notifier.subscribe,
  };

  const canvasBinding = {
    draw({context, width, height, time}: CanvasStageFrame): void {
      const normalized = normalizeStageState(state);
      const span = normalized.maximum - normalized.minimum;
      const fraction = span > 0 ? (normalized.value - normalized.minimum) / span : 0;
      const styles = getComputedStyle(host);
      const foreground =
        styles.getPropertyValue('--wui-ink').trim() || '#111111';
      const muted = styles.getPropertyValue('--wui-line-strong').trim() || '#d8d8d8';
      const phase = optionValues.animate === true ? time / 900 : 0;

      context.strokeStyle = muted;
      context.lineWidth = 1;
      for (let index = 1; index < 8; index += 1) {
        const x = (width * index) / 8;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      context.strokeStyle = foreground;
      context.lineWidth = 2;
      context.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const position = x / Math.max(1, width);
        const y =
          height / 2 +
          Math.sin(position * Math.PI * 8 + phase) *
            height *
            0.22 *
            Math.sin(position * Math.PI);
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.fillStyle = foreground;
      context.fillRect(fraction * width, 0, 2, height);
    },
    status: (): StatusState =>
      state.disabled === true
        ? {kind: 'loading', message: 'Surface state is disabled'}
        : {kind: 'ready'},
    subscribe: notifier.subscribe,
  };

  const sliderBinding = {
    snapshot: (): SurfaceSliderState => state,
    valueAt(point: SurfaceSliderPoint): number {
      const normalized = normalizeStageState(state);
      const vertical = optionValues.orientation === 'vertical';
      const fraction = vertical
        ? 1 - point.y / Math.max(1, point.rect.height)
        : point.x / Math.max(1, point.rect.width);
      return normalized.minimum +
        Math.max(0, Math.min(1, fraction)) * (normalized.maximum - normalized.minimum);
    },
    commit(value: number): void {
      state = {...state, value};
      publish();
    },
    subscribe: notifier.subscribe,
  };

  const releasePresenters = (): void => {
    sliderPresenter?.destroy();
    sliderPresenter = undefined;
    canvasPresenter?.destroy();
    canvasPresenter = undefined;
    retainedPresenter?.destroy();
    retainedPresenter = undefined;
  };

  const remount = (clearError = false): void => {
    releasePresenters();
    if (clearError) delete host.dataset.presenterDemoError;
    retainedPresenter = mountStage(
      retained.body,
      retainedBinding,
      retainedStageOptions(host, optionValues),
    );
    canvasPresenter = mountCanvasStage(
      canvas.body,
      canvasBinding,
      canvasStageOptions(host, optionValues),
    );
    sliderPresenter = mountSurfaceSlider(
      sliderElement,
      sliderBinding,
      surfaceSliderOptions(host, pointerSurface, optionValues),
    );
    paintSlider();
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (
        (name === 'minimum' || name === 'maximum' || name === 'value') &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        state = {...state, [name]: value};
      } else if (name === 'disabled') {
        state = {...state, disabled: value === true};
      }
      publish();
    },
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      state = {...INITIAL_STAGE_STATE};
      optionValues = {};
      remount(true);
      publish();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      releasePresenters();
      notifier.clear();
      shell.remove();
      delete host.dataset.presenterDemoError;
    },
  };
}

const INITIAL_STATUS_STATE: StatusState = {
  kind: 'loading',
  message: 'Loading analysis frames…',
};

function statusOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): StatusOptions {
  const options: StatusOptions = {};
  if (values.classNames === 'demo') {
    options.classNames = {root: 'demo-status', message: 'demo-status-message'};
  }
  if (values.parts === 'demo') {
    options.parts = {root: 'demo-root', message: 'demo-message'};
  }
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function mountStatusDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let state: StatusState = {...INITIAL_STATUS_STATE};
  let optionValues: Record<string, unknown> = {};
  let presenter: StatusHandle | undefined;
  let destroyed = false;

  const binding = {
    snapshot: (): StatusState => state,
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountStatus(host, binding, statusOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'kind') {
        state = {
          ...state,
          kind:
            value === 'loading' || value === 'empty' || value === 'error'
              ? value
              : 'ready',
        };
      } else if (name === 'message') {
        const next = {...state};
        if (value === undefined) delete next.message;
        else next.message = String(value);
        state = next;
      }
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      delete host.dataset.presenterDemoError;
      state = {...INITIAL_STATUS_STATE};
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      delete host.dataset.presenterDemoError;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
    },
  };
}

type TrackListMode = 'demo' | 'compact' | 'empty';

const DEMO_TRACK_ITEMS: readonly Omit<TrackListItem, 'active'>[] = [
  {id: 'melody', label: 'Melody', detail: '8 bars', color: '#292929'},
  {id: 'harmony', label: 'Harmony', detail: '12 chords', color: '#666666'},
  {id: 'bass', label: 'Bass', detail: '4 bars', color: '#999999'},
  {id: 'reference', label: 'Reference', detail: 'muted', disabled: true},
];

function trackListOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): TrackListOptions {
  const options: TrackListOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.ordered === 'boolean') options.ordered = values.ordered;
  if (typeof values.emptyLabel === 'string') options.emptyLabel = values.emptyLabel;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-track-list',
      list: 'demo-track-items',
      item: 'demo-track-item',
      row: 'demo-track-row',
      swatch: 'demo-track-swatch',
      label: 'demo-track-label',
      detail: 'demo-track-detail',
      empty: 'demo-track-empty',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      list: 'demo-list',
      item: 'demo-item',
      row: 'demo-row',
      swatch: 'demo-swatch',
      label: 'demo-label',
      detail: 'demo-detail',
      empty: 'demo-empty',
    };
  }
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function mountTrackListDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let mode: TrackListMode = 'demo';
  let disabled = false;
  let selected = 'melody';
  let optionValues: Record<string, unknown> = {};
  let presenter: TrackListHandle | undefined;
  let destroyed = false;

  const state = (): TrackListState => {
    const source = mode === 'empty'
      ? []
      : mode === 'compact'
        ? DEMO_TRACK_ITEMS.slice(0, 1)
        : DEMO_TRACK_ITEMS;
    return {
      items: source.map((item) => ({...item, active: item.id === selected})),
      disabled,
    };
  };
  const binding = {
    snapshot: state,
    select(id: string): void {
      selected = id;
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountTrackList(host, binding, trackListOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'items') {
        mode = value === 'compact' || value === 'empty' ? value : 'demo';
        if (mode === 'compact') selected = 'melody';
      } else if (name === 'disabled') {
        disabled = value === true;
      }
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      delete host.dataset.presenterDemoError;
      mode = 'demo';
      disabled = false;
      selected = 'melody';
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({items: mode, disabled}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      delete host.dataset.presenterDemoError;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
    },
  };
}

function analysisPlayheadOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): AnalysisPlayheadOptions {
  const options: AnalysisPlayheadOptions = {};
  if (typeof values.scroll === 'boolean') options.scroll = values.scroll;
  if (typeof values.activeClassName === 'string') {
    options.activeClassName = values.activeClassName;
  }
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function mountAnalysisDemo(host: HTMLElement): UiPresenterDemoHandle {
  const root = createAnalysisRoot(host.ownerDocument);
  root.setAttribute('aria-label', 'Live harmonic analysis');
  host.append(root);

  renderSummaryCard(
    {
      title: 'Harmonic motion',
      subtitle: 'Live presenter output',
      rows: [
        {label: 'Key', value: 'C major'},
        {label: 'Tempo', value: '112 BPM'},
      ],
    },
    root,
  );
  renderHistogram(
    [
      {label: 'C', value: 12},
      {label: 'G', value: 9},
      {label: 'Am', value: 7},
      {label: 'F', value: 10},
    ],
    root,
  );
  renderChordTimeline(
    [
      {chord: 'Cmaj7', startQuarters: 0, endQuarters: 1},
      {chord: 'G7', startQuarters: 1, endQuarters: 2},
      {chord: 'Am7', startQuarters: 2, endQuarters: 3},
      {chord: 'Fmaj7', startQuarters: 3, endQuarters: 4},
    ],
    root,
  );

  let optionValues: Record<string, unknown> = {scroll: false};
  let presenter: AnalysisPlayheadHandle | undefined;
  let quarters = 0;
  let destroyed = false;
  const remount = (): void => {
    presenter?.destroy();
    presenter = createAnalysisPlayhead(root, analysisPlayheadOptions(host, optionValues));
    presenter.update(quarters);
  };
  remount();

  const view = host.ownerDocument.defaultView;
  const timer = view?.setInterval(() => {
    quarters = (quarters + 0.25) % 4;
    presenter?.update(quarters);
  }, 450);

  return {
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      delete host.dataset.presenterDemoError;
      optionValues = {scroll: false};
      quarters = 0;
      remount();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      delete host.dataset.presenterDemoError;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter?.destroy();
      presenter = undefined;
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// @webmusic/ui/pitch — three surfaces reading one progression that plays itself.
//
// Everything musical below is the DEMO's answer, not the kit's. The kit is
// handed MIDI numbers, diatonic steps, string/fret pairs, role names and the
// clef glyph strings; it is never told that this is a ii-V-I-vi in C, and it
// could not work it out.
// ---------------------------------------------------------------------------

/** The four roles this progression uses. A subset of the kit's tone roles. */
type PitchDemoRole = 'root' | 'third' | 'fifth' | 'seventh';

interface PitchDemoTone {
  midi: number;
  /** The diatonic step, C4 = 28 — which follows the SPELLING, not the pitch. */
  diatonic: number;
  label: string;
  role: PitchDemoRole;
}

/** One stopped position on a guitar in standard tuning. String 0 is the top. */
interface PitchDemoStop {
  string: number;
  fret: number;
  label: string;
  role: PitchDemoRole;
}

interface PitchDemoChord {
  name: string;
  /** A close piano voicing: what the keyboard and the staff are given. */
  tones: readonly PitchDemoTone[];
  /** One hand position: what the fretboard is given. */
  grip: readonly PitchDemoStop[];
  barre: FretboardBarre;
  muted: readonly number[];
}

const PITCH_DEMO_PROGRESSION: readonly PitchDemoChord[] = [
  {
    name: 'Dm7',
    tones: [
      {midi: 50, diatonic: 22, label: 'D3', role: 'root'},
      {midi: 53, diatonic: 24, label: 'F3', role: 'third'},
      {midi: 57, diatonic: 26, label: 'A3', role: 'fifth'},
      {midi: 60, diatonic: 28, label: 'C4', role: 'seventh'},
    ],
    grip: [
      {string: 0, fret: 5, label: 'A4', role: 'fifth'},
      {string: 1, fret: 6, label: 'F4', role: 'third'},
      {string: 2, fret: 5, label: 'C4', role: 'seventh'},
      {string: 3, fret: 7, label: 'A3', role: 'fifth'},
      {string: 4, fret: 5, label: 'D3', role: 'root'},
    ],
    barre: {fret: 5, fromString: 0, toString: 4},
    muted: [5],
  },
  {
    name: 'G7',
    tones: [
      {midi: 55, diatonic: 25, label: 'G3', role: 'root'},
      {midi: 59, diatonic: 27, label: 'B3', role: 'third'},
      {midi: 62, diatonic: 29, label: 'D4', role: 'fifth'},
      {midi: 65, diatonic: 31, label: 'F4', role: 'seventh'},
    ],
    grip: [
      {string: 0, fret: 3, label: 'G4', role: 'root'},
      {string: 1, fret: 3, label: 'D4', role: 'fifth'},
      {string: 2, fret: 4, label: 'B3', role: 'third'},
      {string: 3, fret: 3, label: 'F3', role: 'seventh'},
      {string: 4, fret: 5, label: 'D3', role: 'fifth'},
      {string: 5, fret: 3, label: 'G2', role: 'root'},
    ],
    barre: {fret: 3, fromString: 0, toString: 5},
    muted: [],
  },
  {
    name: 'Cmaj7',
    tones: [
      {midi: 60, diatonic: 28, label: 'C4', role: 'root'},
      {midi: 64, diatonic: 30, label: 'E4', role: 'third'},
      {midi: 67, diatonic: 32, label: 'G4', role: 'fifth'},
      {midi: 71, diatonic: 34, label: 'B4', role: 'seventh'},
    ],
    grip: [
      {string: 0, fret: 8, label: 'C5', role: 'root'},
      {string: 1, fret: 8, label: 'G4', role: 'fifth'},
      {string: 2, fret: 9, label: 'E4', role: 'third'},
      {string: 3, fret: 9, label: 'B3', role: 'seventh'},
      {string: 4, fret: 10, label: 'G3', role: 'fifth'},
      {string: 5, fret: 8, label: 'C3', role: 'root'},
    ],
    barre: {fret: 8, fromString: 0, toString: 5},
    muted: [],
  },
  {
    name: 'Am7',
    tones: [
      {midi: 57, diatonic: 26, label: 'A3', role: 'root'},
      {midi: 60, diatonic: 28, label: 'C4', role: 'third'},
      {midi: 64, diatonic: 30, label: 'E4', role: 'fifth'},
      {midi: 67, diatonic: 32, label: 'G4', role: 'seventh'},
    ],
    grip: [
      {string: 0, fret: 5, label: 'A4', role: 'root'},
      {string: 1, fret: 5, label: 'E4', role: 'fifth'},
      {string: 2, fret: 5, label: 'C4', role: 'third'},
      {string: 3, fret: 5, label: 'G3', role: 'seventh'},
      {string: 4, fret: 7, label: 'E3', role: 'fifth'},
      {string: 5, fret: 5, label: 'A2', role: 'root'},
    ],
    barre: {fret: 5, fromString: 0, toString: 5},
    muted: [],
  },
];

/** The pitch classes of C major: in the key, drawn as a wash when not sounding. */
const PITCH_DEMO_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/** Whether middle C is called C4 is a convention, so the caller supplies it. */
const PITCH_DEMO_OCTAVES: ReadonlyMap<number, string> = new Map([
  [48, 'C3'],
  [60, 'C4'],
  [72, 'C5'],
  [84, 'C6'],
]);

/**
 * The clefs, as glyph STRINGS. The kit positions them and knows nothing else
 * about them — pass none and it draws no text node at all.
 */
const PITCH_DEMO_CLEFS = {upper: '\u{1D11E}', lower: '\u{1D122}'} as const;

const PITCH_DEMO_STRINGS: readonly string[] = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];
/**
 * The open pitch of each string. The DEMO owns this — a tuning is theory, and
 * the kit is only told which pitch a stop sounds so its three surfaces can be
 * checked against one another.
 */
const PITCH_DEMO_TUNING: readonly number[] = [64, 59, 55, 50, 45, 40];
const PITCH_DEMO_INLAYS: readonly number[] = [3, 5, 7, 9, 12, 15, 17, 19, 21];

/** How often the demo repaints, and how far its own clock moves each time. */
const PITCH_TICK_MS = 200;
const PITCH_BEAT_PER_TICK = 0.25;
/** How long one chord is held, on the demo's own ruler. */
const PITCH_CHORD_BEATS = 2;

interface PitchDemoState {
  labels: 'none' | 'marked' | 'white' | 'all';
  follow: 'anchor' | 'none';
  firstFret: number | 'auto';
  orientation: 'horizontal' | 'vertical';
}

const PITCH_INITIAL_STATE: PitchDemoState = {
  labels: 'marked',
  follow: 'anchor',
  firstFret: 'auto',
  orientation: 'horizontal',
};

const PITCH_LABEL_MODES: readonly PitchDemoState['labels'][] = ['none', 'marked', 'white', 'all'];
const PITCH_FOLLOW_MODES: readonly PitchDemoState['follow'][] = ['anchor', 'none'];
const PITCH_ORIENTATIONS: readonly PitchDemoState['orientation'][] = ['horizontal', 'vertical'];
/** One motion vocabulary, one parser: the harmony demo below reads it too. */
const DEMO_MOTION_MODES: readonly MotionMode[] = ['auto', 'continuous', 'stepped', 'none'];

function demoMotionMode(value: unknown): MotionMode | undefined {
  return DEMO_MOTION_MODES.find((mode) => mode === value);
}

/** The members all three mounts declare, and the only ones they are all given. */
interface PitchSharedOptions {
  label?: string;
  stylesheet?: boolean;
  motion?: MotionMode;
  ageSpan?: number;
  onError?: (error: unknown) => void;
}

/**
 * The options every one of the three mounts takes — `ageSpan` among them, so
 * one pitch at one instant cannot be half a beat old on the keyboard and a
 * whole one on the staff. The live readout names `mountKeyboard`, and the
 * members below are added to it: a staff takes no `release`, so the demo simply
 * does not offer it one.
 */
function pitchSharedOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): PitchSharedOptions {
  const options: PitchSharedOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  const motion = demoMotionMode(values.motion);
  if (motion) options.motion = motion;
  if (typeof values.ageSpan === 'number') options.ageSpan = values.ageSpan;
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function pitchKeyboardOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): KeyboardOptions {
  const options: KeyboardOptions = {...pitchSharedOptions(host, values)};
  if (values.follow === 'active' || values.follow === 'none') options.follow = values.follow;
  if (typeof values.fitToWidth === 'boolean') options.fitToWidth = values.fitToWidth;
  if (typeof values.release === 'number') options.release = values.release;
  if (typeof values.trail === 'boolean') options.trail = values.trail;
  for (const key of ['whiteKeyWidth', 'blackKeyWidth', 'whiteKeyHeight', 'blackKeyHeight'] as const) {
    if (typeof values[key] === 'number') options[key] = values[key];
  }
  return options;
}

function pitchFretboardOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): FretboardOptions {
  const options: FretboardOptions = {...pitchSharedOptions(host, values)};
  if (typeof values.release === 'number') options.release = values.release;
  for (const key of ['fretWidth', 'stringSpacing', 'stringWidth'] as const) {
    if (typeof values[key] === 'number') options[key] = values[key];
  }
  return options;
}

function pitchSurfaceHost(document: Document, parent: HTMLElement): HTMLElement {
  const surface = document.createElement('div');
  surface.style.minWidth = '0';
  parent.append(surface);
  return surface;
}

function mountPitchDemo(host: HTMLElement): UiPresenterDemoHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const notifier = createNotifier();

  const layout = document.createElement('div');
  layout.style.display = 'grid';
  layout.style.gap = '0.85rem';
  layout.style.minWidth = '0';
  host.append(layout);
  const keyboardHost = pitchSurfaceHost(document, layout);
  const staffHost = pitchSurfaceHost(document, layout);
  const fretboardHost = pitchSurfaceHost(document, layout);

  let state: PitchDemoState = {...PITCH_INITIAL_STATE};
  let optionValues: Record<string, unknown> = {};
  let index = 0;
  let now = 0;
  let chordSince = 0;
  let keyboard: KeyboardHandle | undefined;
  let staff: StaffHandle | undefined;
  let fretboard: FretboardHandle | undefined;
  let timer: number | undefined;
  let destroyed = false;

  const chord = (): PitchDemoChord => PITCH_DEMO_PROGRESSION[index];

  const keyboardBinding = {
    snapshot: (): KeyboardState => ({
      marks: chord().tones.map((tone) => ({
        midi: tone.midi,
        label: tone.label,
        role: tone.role,
        since: chordSince,
      })),
      ghostPitchClasses: PITCH_DEMO_SCALE,
      labels: state.labels,
      octaveLabels: PITCH_DEMO_OCTAVES,
      now,
    }),
    subscribe: notifier.subscribe,
  };

  // Every column of the progression is drawn at once and the sounding one is
  // the anchor: that is what makes the material move past a fixed line rather
  // than the line move across static material.
  const staffBinding = {
    snapshot: (): StaffState => ({
      marks: PITCH_DEMO_PROGRESSION.flatMap((entry, column) =>
        entry.tones.map((tone) => ({
          midi: tone.midi,
          diatonic: tone.diatonic,
          label: tone.label,
          role: tone.role,
          column,
          ...(column === index ? {since: chordSince} : {}),
        })),
      ),
      system: 'grand' as const,
      clefs: PITCH_DEMO_CLEFS,
      columns: PITCH_DEMO_PROGRESSION.length,
      activeColumn: index,
      follow: state.follow,
      emptyLabel: 'Nothing is sounding.',
      now,
    }),
    subscribe: notifier.subscribe,
  };

  const fretboardBinding = {
    snapshot: (): FretboardState => ({
      strings: PITCH_DEMO_STRINGS.length,
      firstFret: state.firstFret,
      fretCount: 5,
      marks: chord().grip.map((stop) => ({
        stringIndex: stop.string,
        fret: stop.fret,
        midi: (PITCH_DEMO_TUNING[stop.string] ?? 0) + stop.fret,
        label: stop.label,
        role: stop.role,
        since: chordSince,
      })),
      muted: chord().muted,
      stringLabels: PITCH_DEMO_STRINGS,
      inlays: PITCH_DEMO_INLAYS,
      orientation: state.orientation,
      barre: [chord().barre],
      emptyLabel: 'No shape is sounding.',
      now,
    }),
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    keyboard?.destroy();
    staff?.destroy();
    fretboard?.destroy();
    keyboard = mountKeyboard(keyboardHost, keyboardBinding, pitchKeyboardOptions(host, optionValues));
    staff = mountStaff(staffHost, staffBinding, pitchSharedOptions(host, optionValues));
    fretboard = mountFretboard(
      fretboardHost,
      fretboardBinding,
      pitchFretboardOptions(host, optionValues),
    );
  };

  const tick = (): void => {
    if (destroyed) return;
    now = Math.round((now + PITCH_BEAT_PER_TICK) * 100) / 100;
    if (now - chordSince >= PITCH_CHORD_BEATS) {
      index = (index + 1) % PITCH_DEMO_PROGRESSION.length;
      chordSince = now;
    }
    notifier.notify();
  };

  const stopClock = (): void => {
    if (timer === undefined) return;
    view?.clearInterval(timer);
    timer = undefined;
  };
  const startClock = (): void => {
    if (destroyed || timer !== undefined) return;
    timer = view?.setInterval(tick, PITCH_TICK_MS);
  };

  remount();
  startClock();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'chord') {
        // Picking a chord takes the wheel; Reset hands it back to the clock.
        stopClock();
        const picked = PITCH_DEMO_PROGRESSION.findIndex((entry) => entry.name === value);
        if (picked >= 0) {
          index = picked;
          chordSince = now;
        }
      } else if (name === 'labels') {
        state = {...state, labels: PITCH_LABEL_MODES.find((mode) => mode === value) ?? 'marked'};
      } else if (name === 'follow') {
        state = {...state, follow: PITCH_FOLLOW_MODES.find((mode) => mode === value) ?? 'none'};
      } else if (name === 'firstFret') {
        state = {...state, firstFret: typeof value === 'number' ? value : 'auto'};
      } else if (name === 'orientation') {
        state = {
          ...state,
          orientation: PITCH_ORIENTATIONS.find((mode) => mode === value) ?? 'horizontal',
        };
      }
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      delete host.dataset.presenterDemoError;
      state = {...PITCH_INITIAL_STATE};
      optionValues = {};
      index = 0;
      now = 0;
      chordSince = 0;
      remount();
      startClock();
      notifier.notify();
    },
    snapshot: () => ({chord: chord().name, ...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopClock();
      delete host.dataset.presenterDemoError;
      keyboard?.destroy();
      staff?.destroy();
      fretboard?.destroy();
      keyboard = undefined;
      staff = undefined;
      fretboard = undefined;
      notifier.clear();
      layout.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// @webmusic/ui/harmony — one progression on a conveyor, read four ways at once.
//
// Everything musical below is the DEMO's answer. The kit is handed "from 24.0
// to 26.0, stamped 48 to 52, tone slot 7, labelled 'G7'" and could not work out
// that this is a ii-V-I in C, that its twelve wheel segments are a circle of
// fifths, or that a chord has a root at all.
//
// The lane's axis is SECONDS and the stamp is QUARTERS on purpose. The two are
// related by a tempo nobody here ever tells the kit, which is the entire reason
// `stampStart` / `stampEnd` exist as a second pair of numbers: the conveyor is a
// portrait of real time, so a ritardando has to be visibly wider, while a
// playhead is fed the score's own metrical position.
// ---------------------------------------------------------------------------

interface HarmonyDemoChord {
  symbol: string;
  /** The spoken form. Announced instead of the symbol, which is an abbreviation. */
  full: string;
  roman: string;
  /** What the chord is doing in the key — the demo's word, never the kit's. */
  harmonicFunction: string;
  /** 0…11, the progression slot that colours the block. */
  rootPitchClass: number;
  /** Where the root sits on the demo's own circle of fifths. */
  fifthsIndex: number;
  confidence: number;
  voicing: readonly HarmonyVoice[];
  alternates: readonly {symbol: string; note: string}[];
  /** Siblings that light together when the reader asks for a group. */
  group?: string;
  severity?: Severity;
}

const HARMONY_DEMO_CHORDS: readonly HarmonyDemoChord[] = [
  {
    symbol: 'Dm7',
    full: 'D minor seventh',
    roman: 'iim7',
    harmonicFunction: 'predominant',
    rootPitchClass: 2,
    fifthsIndex: 2,
    confidence: 0.74,
    voicing: [
      {label: 'D3', role: 'root'},
      {label: 'F3', role: 'third'},
      {label: 'A3', role: 'fifth'},
      {label: 'C4', role: 'seventh'},
    ],
    alternates: [
      {symbol: 'F6/D', note: 'inversion'},
      {symbol: 'Dm9', note: 'with the ninth'},
    ],
  },
  {
    symbol: 'G7',
    full: 'G dominant seventh',
    roman: 'V7',
    harmonicFunction: 'dominant',
    rootPitchClass: 7,
    fifthsIndex: 1,
    confidence: 0.86,
    voicing: [
      {label: 'G3', role: 'root'},
      {label: 'B3', role: 'third'},
      {label: 'D4', role: 'fifth'},
      {label: 'F4', role: 'seventh'},
    ],
    alternates: [
      {symbol: 'Bdim', note: 'rootless'},
      {symbol: 'G7sus4', note: 'suspended'},
    ],
  },
  {
    symbol: 'Cmaj7',
    full: 'C major seventh',
    roman: 'Imaj7',
    harmonicFunction: 'tonic',
    rootPitchClass: 0,
    fifthsIndex: 0,
    confidence: 0.93,
    voicing: [
      {label: 'C4', role: 'root'},
      {label: 'E4', role: 'third'},
      {label: 'G4', role: 'fifth'},
      {label: 'B4', role: 'seventh'},
    ],
    alternates: [
      {symbol: 'Em/C', note: 'rootless'},
      {symbol: 'C6/9', note: 'a fuller reading'},
    ],
  },
  {
    symbol: 'Fmaj7',
    full: 'F major seventh',
    roman: 'IVmaj7',
    harmonicFunction: 'subdominant',
    rootPitchClass: 5,
    fifthsIndex: 11,
    confidence: 0.55,
    voicing: [
      {label: 'F3', role: 'root'},
      {label: 'A3', role: 'third'},
      {label: 'C4', role: 'fifth'},
      {label: 'E4', role: 'seventh'},
    ],
    alternates: [
      {symbol: 'Am/F', note: 'rootless'},
      {symbol: 'Dm9/F', note: 'as a predominant'},
    ],
    group: 'subdominant',
    // The one place this demo's own analysis is least sure, and it says so on
    // two channels: a bead on the band, and a dimmer sector on the wheel.
    severity: 'warning',
  },
];

/** Three passes of a six-bar loop. Indices into the chord table above. */
const HARMONY_DEMO_LOOP: readonly number[] = [0, 1, 2, 3, 1, 2];
const HARMONY_DEMO_PASSES = 3;
/** One bar, on each of the two rulers: two seconds of real time, four quarters. */
const HARMONY_BAR_SECONDS = 2;
const HARMONY_BAR_QUARTERS = 4;

interface HarmonyDemoBar {
  id: string;
  chord: HarmonyDemoChord;
  /** Seconds — the LANE axis. */
  start: number;
  end: number;
  /** Quarters — the STAMPING axis, a different ruler on purpose. */
  stampStart: number;
  stampEnd: number;
}

const HARMONY_DEMO_BARS: readonly HarmonyDemoBar[] = Array.from(
  {length: HARMONY_DEMO_LOOP.length * HARMONY_DEMO_PASSES},
  (_unused, at): HarmonyDemoBar => ({
    id: `bar-${at}`,
    chord: HARMONY_DEMO_CHORDS[HARMONY_DEMO_LOOP[at % HARMONY_DEMO_LOOP.length]],
    start: at * HARMONY_BAR_SECONDS,
    end: (at + 1) * HARMONY_BAR_SECONDS,
    stampStart: at * HARMONY_BAR_QUARTERS,
    stampEnd: (at + 1) * HARMONY_BAR_QUARTERS,
  }),
);

const HARMONY_DEMO_SPAN = HARMONY_DEMO_BARS.length * HARMONY_BAR_SECONDS;

const HARMONY_DEMO_TRACKS = [
  {id: 'chords', label: 'Chords'},
  {id: 'numerals', label: 'Numerals', sublabel: 'in C'},
] as const;

/** A tick on every bar line, a label on every fourth. Seconds, like the axis. */
const HARMONY_DEMO_RULER = Array.from(
  {length: HARMONY_DEMO_BARS.length + 1},
  (_unused, at) => ({
    at: at * HARMONY_BAR_SECONDS,
    label: at % 4 === 0 ? `${at * HARMONY_BAR_SECONDS}s` : '',
    major: at % 4 === 0,
  }),
);

/** One flag per pass, on no track: a fact about the moment, not about a row. */
const HARMONY_DEMO_FLAGS = Array.from({length: HARMONY_DEMO_PASSES}, (_unused, pass) => ({
  id: `top-${pass}`,
  at: pass * HARMONY_DEMO_LOOP.length * HARMONY_BAR_SECONDS,
  severity: 'info' as Severity,
  label: 'top of the form',
}));

/** The ii-V of each pass, bracketed across every row the lane is showing. */
const HARMONY_DEMO_BRACKETS = Array.from({length: HARMONY_DEMO_PASSES}, (_unused, pass) => {
  const first = HARMONY_DEMO_BARS[pass * HARMONY_DEMO_LOOP.length];
  const second = HARMONY_DEMO_BARS[pass * HARMONY_DEMO_LOOP.length + 1];
  return {
    id: `ii-v-${pass}`,
    start: first.start,
    end: second.end,
    from: 0,
    to: 1,
    severity: 'info' as Severity,
    label: 'ii-V',
  };
});

/**
 * The demo's circle of fifths, and the relative minor of each position. Both
 * are theory, so both are the caller's: the wheel is handed twelve labelled
 * segments in the order it should draw them clockwise and nothing else.
 */
const HARMONY_DEMO_FIFTHS: readonly string[] = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F',
];
const HARMONY_DEMO_RELATIVES: readonly string[] = [
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm',
];

/** How often the demo re-reads its own data. The frame loop is the kit's. */
const HARMONY_POLL_MS = 90;

interface HarmonyDemoState {
  playing: boolean;
  tracks: number;
  future: boolean;
  focus: string;
  layout: 'flow' | 'ribbon' | 'stack';
  emphasis: 'display' | 'hero';
}

const HARMONY_INITIAL_STATE: HarmonyDemoState = {
  playing: true,
  tracks: 2,
  future: true,
  focus: 'none',
  layout: 'flow',
  emphasis: 'display',
};

const HARMONY_LAYOUTS: readonly HarmonyDemoState['layout'][] = ['flow', 'ribbon', 'stack'];

function harmonyFlowOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): FlowLaneOptions {
  const options: FlowLaneOptions = {
    // The lane prints a bare number because it has never been told the unit.
    formatPosition: (position) => `${position.toFixed(1)} seconds`,
  };
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.anchor === 'number') options.anchor = values.anchor;
  if (typeof values.scale === 'number') options.scale = values.scale;
  if (typeof values.visibleSpan === 'number') options.visibleSpan = values.visibleSpan;
  if (typeof values.spans === 'boolean') options.spans = values.spans;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  const motion = demoMotionMode(values.motion);
  if (motion) options.motion = motion;
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function harmonyNameplateOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): NameplateOptions {
  const options: NameplateOptions = {};
  if (typeof values.popDuration === 'number') options.popDuration = values.popDuration;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  const motion = demoMotionMode(values.motion);
  if (motion) options.motion = motion;
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function harmonyChipOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): ChipStripOptions {
  const options: ChipStripOptions = {};
  if (typeof values.spans === 'boolean') options.spans = values.spans;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function harmonyWheelOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): WheelOptions {
  const options: WheelOptions = {};
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  const motion = demoMotionMode(values.motion);
  if (motion) options.motion = motion;
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function mountHarmonyDemo(host: HTMLElement): UiPresenterDemoHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const notifier = createNotifier();

  // This public root resolves the shared palette for standalone harmony
  // presenters, including severity marks that consume its resolved tokens.
  const layout = createAnalysisRoot(document);
  Object.assign(layout.style, {
    display: 'grid', gap: '.85rem', minWidth: '0',
    border: '0', padding: '0', background: 'transparent',
    fontSize: 'inherit', lineHeight: 'inherit',
  });
  const laneRegion = createStageDemoRegion(document, 'Flow lane');
  const plateRegion = createStageDemoRegion(document, 'Nameplate');
  const chipRegion = createStageDemoRegion(document, 'Chip strip');
  const wheelRegion = createStageDemoRegion(document, 'Wheel');
  const pair = document.createElement('div');
  pair.style.cssText =
    'display:grid;gap:.85rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));min-width:0';
  pair.append(chipRegion.region, wheelRegion.region);
  layout.append(laneRegion.region, plateRegion.region, pair);
  host.append(layout);

  let state: HarmonyDemoState = {...HARMONY_INITIAL_STATE};
  let optionValues: Record<string, unknown> = {};
  // The demo's transport. The position is a pure function of the instant, which
  // is what lets one number answer a frame, a domain poll and a seek alike —
  // and what lets a remount pick up exactly where the last mount left off.
  let origin = 0;
  let held = 0;
  let running = true;
  let bar = 0;
  let reading = 0;
  let flow: FlowLaneHandle | undefined;
  let plate: NameplateHandle | undefined;
  let chips: ChipStripHandle | undefined;
  let wheel: WheelHandle | undefined;
  let timer: number | undefined;
  let destroyed = false;

  const clockNow = (): number => view?.performance?.now?.() ?? Date.now();
  const positionAt = (atMs: number): number => {
    const raw = running ? held + (atMs - origin) / 1000 : held;
    return ((raw % HARMONY_DEMO_SPAN) + HARMONY_DEMO_SPAN) % HARMONY_DEMO_SPAN;
  };
  const barAt = (position: number): number =>
    Math.min(
      HARMONY_DEMO_BARS.length - 1,
      Math.max(0, Math.floor(position / HARMONY_BAR_SECONDS)),
    );

  const seekTo = (position: number, phase: 'drag' | 'commit'): void => {
    held = Math.max(0, Math.min(HARMONY_DEMO_SPAN, position));
    origin = clockNow();
    // A drag holds the material still under the pointer; the clock only takes
    // over again on release, and only if the reader had it running.
    running = phase === 'commit' && state.playing;
    const landed = barAt(held);
    if (landed !== bar) {
      bar = landed;
      reading = 0;
    }
    notifier.notify();
  };

  const setRunning = (playing: boolean): void => {
    held = positionAt(clockNow());
    origin = clockNow();
    running = playing;
  };

  const readingsOf = (chord: HarmonyDemoChord): ChordNameCandidate[] => {
    const all: ChordNameCandidate[] = [
      {symbol: chord.symbol, full: chord.full},
      ...chord.alternates.map((entry) => ({symbol: entry.symbol, note: entry.note})),
    ];
    const rotated = [...all.slice(reading), ...all.slice(0, reading)];
    // The opaque identity. The same symbol one pass later is a NEW reading and
    // has to pop, and the kit is never told why the string did not change.
    return rotated.map((candidate, at) => ({
      ...candidate,
      key: `${HARMONY_DEMO_BARS[bar].id}:${reading}:${at}`,
    }));
  };

  /** Every bar heard so far, which is what makes the strip and the wheel live. */
  const heardBars = (): readonly HarmonyDemoBar[] => HARMONY_DEMO_BARS.slice(0, bar + 1);

  const flowBinding = {
    snapshot: (): FlowLaneState => {
      const rows = state.tracks;
      const bands: FlowBand[] = [];
      for (const entry of HARMONY_DEMO_BARS) {
        bands.push({
          id: entry.id,
          start: entry.start,
          end: entry.end,
          stampStart: entry.stampStart,
          stampEnd: entry.stampEnd,
          track: 0,
          primary: entry.chord.symbol,
          secondary: entry.chord.harmonicFunction,
          tone: entry.chord.rootPitchClass,
          ...(entry.chord.group ? {group: entry.chord.group} : {}),
          ...(entry.chord.severity ? {severity: entry.chord.severity} : {}),
        });
        if (rows < 2) continue;
        bands.push({
          id: `${entry.id}-roman`,
          start: entry.start,
          end: entry.end,
          stampStart: entry.stampStart,
          stampEnd: entry.stampEnd,
          track: 1,
          primary: entry.chord.roman,
          // The other ruler, printed, so the two are visibly not the same number.
          secondary: `q${entry.stampStart}`,
          tone: entry.chord.rootPitchClass,
          ...(entry.chord.group ? {group: entry.chord.group} : {}),
        });
      }
      return {
        bands,
        tracks: HARMONY_DEMO_TRACKS.slice(0, rows),
        ruler: HARMONY_DEMO_RULER,
        flags: HARMONY_DEMO_FLAGS,
        brackets: HARMONY_DEMO_BRACKETS.map((entry) => ({...entry, to: rows - 1})),
        span: {start: 0, end: HARMONY_DEMO_SPAN},
        now: positionAt(clockNow()),
        playing: running,
        future: state.future,
        ...(state.focus === 'none' ? {} : {focusGroup: state.focus}),
        emptyLabel: 'Nothing has been analysed yet.',
      };
    },
    // Pulled once per frame, and the only thing that is. Interpolating between
    // sparse samples is the caller's job because only the caller knows the rate.
    position: (tick: FrameTick): number => positionAt(tick.at),
    seek: (position: number, phase: 'drag' | 'commit'): void => seekTo(position, phase),
    selectBand: (_id: string, band: FlowBand): void => seekTo(band.start, 'commit'),
    subscribe: notifier.subscribe,
  };

  const nameplateBinding = {
    snapshot: (): NameplateState => {
      const entry = HARMONY_DEMO_BARS[bar];
      const readings = readingsOf(entry.chord);
      const next = HARMONY_DEMO_BARS[(bar + 1) % HARMONY_DEMO_BARS.length];
      return {
        primary: readings[0],
        alternates: readings.slice(1),
        voicing: entry.chord.voicing,
        caption: `bar ${bar + 1} of ${HARMONY_DEMO_BARS.length}`,
        history: HARMONY_DEMO_BARS.slice(Math.max(0, bar - 3), bar + 1).map(
          (heard) => heard.chord.symbol,
        ),
        confidence: entry.chord.confidence,
        emphasis: state.emphasis,
        next: {symbol: next.chord.symbol, key: next.id},
        emptyLabel: 'Nothing is sounding.',
      };
    },
    // How near the next chord is, 0…1. Nearness is domain knowledge: it depends
    // on the bar length, which the demo knows and the nameplate does not.
    approach: (tick: FrameTick): number => {
      const at = positionAt(tick.at);
      return (at % HARMONY_BAR_SECONDS) / HARMONY_BAR_SECONDS;
    },
    selectAlternate: (index: number): void => {
      const total = HARMONY_DEMO_BARS[bar].chord.alternates.length + 1;
      reading = (reading + index + 1) % total;
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };

  const chipBinding = {
    snapshot: (): ChipStripState => {
      const heard = heardBars();
      const items: ChipItem[] = HARMONY_DEMO_CHORDS.map((chord) => {
        const every = HARMONY_DEMO_BARS.filter((entry) => entry.chord === chord);
        const soFar = heard.filter((entry) => entry.chord === chord);
        return {
          id: chord.symbol,
          // Chips are stamped on the QUARTERS ruler, like the bands they count.
          start: every[0].stampStart,
          end: every[0].stampEnd,
          primary: chord.symbol,
          roman: chord.roman,
          spans: soFar.map((entry) => ({start: entry.stampStart, end: entry.stampEnd})),
          occurrences: soFar.map((entry) => entry.stampStart),
          meter: soFar.length / Math.max(1, heard.length),
          // The whole-piece answer, drawn as an outline the bar grows towards.
          meterGhost: every.length / HARMONY_DEMO_BARS.length,
          tone: chord.rootPitchClass,
          ...(chord.severity ? {severity: chord.severity} : {}),
        };
      });
      return {
        items,
        layout: state.layout,
        emptyLabel: 'Nothing has been heard yet.',
      };
    },
    selectItem: (_id: string, item: ChipItem): void => {
      const first = HARMONY_DEMO_BARS.find((entry) => entry.stampStart === item.occurrences?.[0]);
      if (first) seekTo(first.start, 'commit');
    },
    subscribe: notifier.subscribe,
  };

  const wheelBinding = {
    snapshot: (): WheelState => {
      const entry = HARMONY_DEMO_BARS[bar];
      const weights = new Map<number, number>();
      for (const heard of heardBars()) {
        weights.set(heard.chord.fifthsIndex, (weights.get(heard.chord.fifthsIndex) ?? 0) + 1);
      }
      const most = Math.max(1, ...weights.values());
      const share = (at: number): number => (weights.get(at) ?? 0) / most;
      return {
        outer: HARMONY_DEMO_FIFTHS.map((label, at) => ({
          id: label,
          label,
          weight: share(at),
          active: at === entry.chord.fifthsIndex,
        })),
        inner: HARMONY_DEMO_RELATIVES.map((label, at) => ({
          id: label,
          label,
          weight: share(at) * 0.6,
        })),
        centre: {
          primary: 'C major',
          secondary: `${Math.round(entry.chord.confidence * 100)}% sure`,
        },
        needle: {
          at: entry.chord.fifthsIndex,
          // An answer held at fifty-five per cent has to LOOK unsure: the wedge
          // widens as the confidence falls, rather than pointing precisely at
          // a guess.
          spread: (1 - entry.chord.confidence) * 3,
          label: `The harmony is sitting on ${HARMONY_DEMO_FIFTHS[entry.chord.fifthsIndex]}`,
        },
        trail: HARMONY_DEMO_BARS.slice(Math.max(0, bar - 3), bar).map((heard) => ({
          at: heard.chord.fifthsIndex,
        })),
        emptyLabel: 'No key estimate yet.',
      };
    },
    subscribe: notifier.subscribe,
  };

  /**
   * One row or two, said in the token the lane reads for its own height. A
   * one-row lane with a two-row box would be half a lane of empty surface.
   */
  const applyDensity = (): void => {
    layout.style.setProperty(
      '--wm-harmony-flow-height',
      state.tracks < 2 ? '48px' : '96px',
    );
  };

  const remount = (): void => {
    flow?.destroy();
    plate?.destroy();
    chips?.destroy();
    wheel?.destroy();
    flow = mountFlowLane(laneRegion.body, flowBinding, harmonyFlowOptions(host, optionValues));
    plate = mountNameplate(
      plateRegion.body,
      nameplateBinding,
      harmonyNameplateOptions(host, optionValues),
    );
    chips = mountChipStrip(chipRegion.body, chipBinding, harmonyChipOptions(host, optionValues));
    wheel = mountWheel(wheelRegion.body, wheelBinding, harmonyWheelOptions(host, optionValues));
  };

  /**
   * The domain tick, at eleven hertz — the layer that says WHAT. The frame loop
   * inside the lane says WHEN, sixty times a second, and the two are separate
   * on purpose: a snapshot per frame would rebuild four read-outs to say the
   * same sentence sixty times.
   *
   * `tick()` is called from here because a reduced-motion mount runs no frame
   * loop at all: `stepped` re-anchors on the band, and this is what tells it a
   * band changed. Under `continuous` it is one redundant placement per poll.
   */
  const poll = (): void => {
    if (destroyed) return;
    flow?.tick();
    plate?.tick();
    const landed = barAt(positionAt(clockNow()));
    if (landed === bar) return;
    bar = landed;
    reading = 0;
    notifier.notify();
  };

  const stopClock = (): void => {
    if (timer === undefined) return;
    view?.clearInterval(timer);
    timer = undefined;
  };
  const startClock = (): void => {
    if (destroyed || timer !== undefined) return;
    timer = view?.setInterval(poll, HARMONY_POLL_MS);
  };

  origin = clockNow();
  applyDensity();
  remount();
  startClock();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'playing') {
        const playing = value !== false;
        state = {...state, playing};
        setRunning(playing);
      } else if (name === 'tracks') {
        state = {...state, tracks: value === 1 ? 1 : 2};
      } else if (name === 'future') {
        state = {...state, future: value !== false};
      } else if (name === 'focus') {
        state = {...state, focus: value === 'subdominant' ? 'subdominant' : 'none'};
      } else if (name === 'layout') {
        state = {...state, layout: HARMONY_LAYOUTS.find((mode) => mode === value) ?? 'flow'};
      } else if (name === 'emphasis') {
        state = {...state, emphasis: value === 'hero' ? 'hero' : 'display'};
      }
      applyDensity();
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      delete host.dataset.presenterDemoError;
      state = {...HARMONY_INITIAL_STATE};
      optionValues = {};
      held = 0;
      origin = clockNow();
      running = true;
      bar = 0;
      reading = 0;
      applyDensity();
      remount();
      startClock();
      notifier.notify();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // The interval is the demo's own loop and nobody else will stop it; the
      // lane's animation frame goes with the lane.
      stopClock();
      delete host.dataset.presenterDemoError;
      flow?.destroy();
      plate?.destroy();
      chips?.destroy();
      wheel?.destroy();
      flow = undefined;
      plate = undefined;
      chips = undefined;
      wheel = undefined;
      notifier.clear();
      layout.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// The workbench — the shell the read-outs above sit inside.
//
// Everything below is a CALLER. The shell is handed `{id, label}` views and
// `{id, label, placement}` docks and never learns that `key` is a key or that
// a keyboard draws pitches; the words are the demo's, and so is every number.
// ---------------------------------------------------------------------------

interface WorkbenchDemoPitch {
  midi: number;
  /** C4 = 28 — a convention, and therefore the caller's to state. */
  diatonic: number;
}

/**
 * Every note name the shared voicings use, on both ladders the pitch surfaces
 * read. Neither ladder is in the kit, because whether middle C is called C4 is
 * a convention rather than a fact.
 */
const WORKBENCH_DEMO_PITCHES: Readonly<Record<string, WorkbenchDemoPitch>> = {
  D3: {midi: 50, diatonic: 22},
  F3: {midi: 53, diatonic: 24},
  G3: {midi: 55, diatonic: 25},
  A3: {midi: 57, diatonic: 26},
  B3: {midi: 59, diatonic: 27},
  C4: {midi: 60, diatonic: 28},
  D4: {midi: 62, diatonic: 29},
  E4: {midi: 64, diatonic: 30},
  F4: {midi: 65, diatonic: 31},
  G4: {midi: 67, diatonic: 32},
  B4: {midi: 71, diatonic: 34},
};

/**
 * The three views, each declaring the docks it wants. A dock a view does not
 * name loses its whole section — head, switch and body — because a switch left
 * standing over nothing is worse than no switch.
 */
const WORKBENCH_DEMO_VIEWS: readonly WorkbenchView[] = [
  {
    id: 'chords',
    label: 'Chords',
    description: 'The progression, as it goes past',
    docks: ['keyboard', 'staff', 'chips'],
  },
  {
    id: 'key',
    label: 'Key',
    description: 'Where the harmony is sitting',
    docks: ['chips'],
  },
  {
    id: 'voicing',
    label: 'Voicing',
    description: 'What the hands are holding',
    docks: ['keyboard', 'chips'],
  },
];

/** `placement` is a position on the grid, not a kind of thing. */
const WORKBENCH_DEMO_DOCKS: readonly WorkbenchDock[] = [
  {id: 'keyboard', label: 'Keyboard', placement: 'rail'},
  {id: 'staff', label: 'Staff', placement: 'rail'},
  {id: 'chips', label: 'Chords heard', placement: 'strip'},
];

/** What the status bar says in each phase. The shell prints it and reads none of it. */
const WORKBENCH_DEMO_SENTENCES: Readonly<Record<WorkbenchPhase, string>> = {
  playing: 'Following the performance.',
  listening: 'Listening for the next chord.',
  idle: 'Parked. Nothing is being read.',
  empty: 'Nothing has been analysed yet.',
  error: 'The analysis stopped answering.',
};

const WORKBENCH_PHASES: readonly WorkbenchPhase[] = [
  'idle',
  'listening',
  'playing',
  'empty',
  'error',
];

interface WorkbenchDemoState {
  view: string;
  phase: WorkbenchPhase;
  density: 'comfortable' | 'compact';
  scheme: 'auto' | 'light' | 'dark';
  keyboard: boolean;
}

const WORKBENCH_INITIAL_STATE: WorkbenchDemoState = {
  view: 'chords',
  phase: 'playing',
  density: 'comfortable',
  scheme: 'auto',
  keyboard: true,
};

/** Which bar of the shared progression a position lands in. */
function workbenchBarAt(position: number): number {
  return Math.min(
    HARMONY_DEMO_BARS.length - 1,
    Math.max(0, Math.floor(position / HARMONY_BAR_SECONDS)),
  );
}

/** A chord's voicing on the two ladders the keyboard and the staff read. */
function workbenchTones(
  chord: HarmonyDemoChord,
): readonly {midi: number; diatonic: number; label: string; role: HarmonyVoice['role']}[] {
  return chord.voicing.flatMap((voice) => {
    const label = voice.label;
    const pitch = label === undefined ? undefined : WORKBENCH_DEMO_PITCHES[label];
    if (label === undefined || pitch === undefined) return [];
    return [{...pitch, label, role: voice.role}];
  });
}

function workbenchOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
  onDockVisibility: (id: string, visible: boolean) => void,
): WorkbenchOptions {
  const options: WorkbenchOptions = {onDockVisibility};
  if (values.chrome === 'bare' || values.chrome === 'full') options.chrome = values.chrome;
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  const motion = demoMotionMode(values.motion);
  if (motion) options.motion = motion;
  if (values.onError === 'report') options.onError = (error) => reportDemoError(host, error);
  return options;
}

function mountWorkbenchDemo(host: HTMLElement): UiPresenterDemoHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const notifier = createNotifier();

  const shellHost = document.createElement('div');
  shellHost.style.cssText = 'min-width:0;min-height:22rem';
  host.append(shellHost);

  let state: WorkbenchDemoState = {...WORKBENCH_INITIAL_STATE};
  let optionValues: Record<string, unknown> = {};
  // The demo's transport, and the only clock in this file that owns a number:
  // the position is a pure function of the instant, so parking the shell and
  // starting it again loses nothing and needs no accumulator.
  let origin = 0;
  let held = 0;
  let running = true;
  let epoch = 0;
  let bar = 0;
  let folded: Record<string, boolean> = {};

  let shell: WorkbenchHandle | undefined;
  let stageTenant: {destroy(): void} | undefined;
  let stageKind: string | undefined;
  let indexKind: string | undefined;
  const dockTenants = new Map<string, {destroy(): void}>();
  let timer: number | undefined;
  let destroyed = false;

  const clockNow = (): number => view?.performance?.now?.() ?? Date.now();
  const live = (): boolean => state.phase === 'playing' || state.phase === 'listening';
  const positionAt = (atMs: number): number => {
    const raw = running ? held + (atMs - origin) / 1000 : held;
    return ((raw % HARMONY_DEMO_SPAN) + HARMONY_DEMO_SPAN) % HARMONY_DEMO_SPAN;
  };
  const soundingChord = (): HarmonyDemoChord => HARMONY_DEMO_BARS[bar].chord;
  /** Every bar heard so far, which is what makes the strip live rather than fixed. */
  const heardBars = (): readonly HarmonyDemoBar[] => HARMONY_DEMO_BARS.slice(0, bar + 1);

  const setRunning = (next: boolean): void => {
    held = positionAt(clockNow());
    origin = clockNow();
    running = next;
  };

  const seekTo = (position: number, phase: 'drag' | 'commit'): void => {
    held = Math.max(0, Math.min(HARMONY_DEMO_SPAN, position));
    origin = clockNow();
    running = phase === 'commit' && live();
    // The discontinuity counter the shell passes straight through to every
    // slot: a presenter snaps when it changes and interpolates when it does
    // not, which is what stops a backwards seek being tweened across material
    // nobody heard.
    epoch += 1;
    bar = workbenchBarAt(held);
    republish();
  };

  // -------------------------------------------------------------------------
  // The shell's own binding. Content on domain events; ONE number per frame.
  // -------------------------------------------------------------------------

  const shellBinding: WorkbenchBinding = {
    snapshot: (): WorkbenchState => {
      const blank = state.phase === 'empty' || state.phase === 'error';
      const active = WORKBENCH_DEMO_VIEWS.find((entry) => entry.id === state.view);
      return {
        views: WORKBENCH_DEMO_VIEWS,
        activeViewId: state.view,
        docks: WORKBENCH_DEMO_DOCKS,
        dockVisibility: {...folded, keyboard: state.keyboard},
        title: 'Analysis',
        subtitle: active?.description,
        density: state.density,
        ...(state.scheme === 'auto' ? {} : {scheme: state.scheme}),
        phase: state.phase,
        status: {
          message: WORKBENCH_DEMO_SENTENCES[state.phase],
          // Deliberately NOT the live region: a caller is expected to put a
          // position here, and a polite region changing at that rate would read
          // the piece out loud for as long as it lasts.
          ...(blank
            ? {}
            : {
                detail: `bar ${bar + 1} of ${HARMONY_DEMO_BARS.length}, ${soundingChord().symbol}`,
              }),
        },
      };
    },
    // The one reading. Every slot in this shell is handed this same number on
    // the same frame, because a shared axis is only shared when the READING is.
    now: (frame): number => positionAt(frame.time),
    epoch: (): number => epoch,
    activateView: (id: string): void => {
      state = {...state, view: id};
      republish();
    },
    toggleDock: (id: string, next: boolean): void => {
      if (id === 'keyboard') state = {...state, keyboard: next};
      else folded = {...folded, [id]: next};
      republish();
    },
    subscribe: notifier.subscribe,
  };

  // -------------------------------------------------------------------------
  // The tenants. None of them is the shell's business, and the lane does not
  // read the clock itself: it is handed `shell.clock` and becomes a passenger.
  // -------------------------------------------------------------------------

  const laneBinding = {
    snapshot: (): FlowLaneState => ({
      bands: HARMONY_DEMO_BARS.flatMap((entry): FlowBand[] => [
        {
          id: entry.id,
          start: entry.start,
          end: entry.end,
          stampStart: entry.stampStart,
          stampEnd: entry.stampEnd,
          track: 0,
          primary: entry.chord.symbol,
          secondary: entry.chord.harmonicFunction,
          tone: entry.chord.rootPitchClass,
          ...(entry.chord.severity ? {severity: entry.chord.severity} : {}),
        },
        {
          id: `${entry.id}-roman`,
          start: entry.start,
          end: entry.end,
          stampStart: entry.stampStart,
          stampEnd: entry.stampEnd,
          track: 1,
          primary: entry.chord.roman,
          tone: entry.chord.rootPitchClass,
        },
      ]),
      tracks: HARMONY_DEMO_TRACKS,
      ruler: HARMONY_DEMO_RULER,
      flags: HARMONY_DEMO_FLAGS,
      span: {start: 0, end: HARMONY_DEMO_SPAN},
      now: positionAt(clockNow()),
      playing: running,
      emptyLabel: 'Nothing has been analysed yet.',
    }),
    // The shell already asked. Taking `tick.now` rather than re-reading the
    // transport is the difference between docks that bite together and docks
    // that drift apart by a frame.
    position: (tick: FrameTick): number => tick.now,
    seek: (position: number, phase: 'drag' | 'commit'): void => seekTo(position, phase),
    selectBand: (_id: string, band: FlowBand): void => seekTo(band.start, 'commit'),
    subscribe: notifier.subscribe,
  };

  const wheelBinding = {
    snapshot: (): WheelState => {
      const chord = soundingChord();
      const weights = new Map<number, number>();
      for (const entry of heardBars()) {
        weights.set(entry.chord.fifthsIndex, (weights.get(entry.chord.fifthsIndex) ?? 0) + 1);
      }
      const most = Math.max(1, ...weights.values());
      return {
        outer: HARMONY_DEMO_FIFTHS.map((label, at) => ({
          id: label,
          label,
          weight: (weights.get(at) ?? 0) / most,
          active: at === chord.fifthsIndex,
        })),
        centre: {primary: 'C major', secondary: `${Math.round(chord.confidence * 100)}% sure`},
        needle: {
          at: chord.fifthsIndex,
          spread: (1 - chord.confidence) * 3,
          label: `The harmony is sitting on ${HARMONY_DEMO_FIFTHS[chord.fifthsIndex]}`,
        },
        emptyLabel: 'No key estimate yet.',
      };
    },
    subscribe: notifier.subscribe,
  };

  const keyboardBinding = {
    snapshot: (): KeyboardState => ({
      // A rail is narrower than a page, so the demo asks for two octaves and a
      // half rather than the default three: the range is a caller's answer.
      low: 48,
      high: 76,
      marks: workbenchTones(soundingChord()).map((tone) => ({
        midi: tone.midi,
        label: tone.label,
        role: tone.role,
        since: HARMONY_DEMO_BARS[bar].start,
      })),
      ghostPitchClasses: PITCH_DEMO_SCALE,
      octaveLabels: PITCH_DEMO_OCTAVES,
      now: positionAt(clockNow()),
    }),
    subscribe: notifier.subscribe,
  };

  const staffBinding = {
    snapshot: (): StaffState => ({
      marks: HARMONY_DEMO_BARS.flatMap((entry, column) =>
        workbenchTones(entry.chord).map((tone) => ({
          midi: tone.midi,
          diatonic: tone.diatonic,
          label: tone.label,
          role: tone.role,
          column,
          ...(column === bar ? {since: entry.start} : {}),
        })),
      ),
      system: 'grand' as const,
      clefs: PITCH_DEMO_CLEFS,
      columns: HARMONY_DEMO_BARS.length,
      activeColumn: bar,
      follow: 'anchor' as const,
      emptyLabel: 'Nothing is sounding.',
      now: positionAt(clockNow()),
    }),
    subscribe: notifier.subscribe,
  };

  const chipBinding = {
    snapshot: (): ChipStripState => {
      const heard = heardBars();
      return {
        items: HARMONY_DEMO_CHORDS.map((chord): ChipItem => {
          const every = HARMONY_DEMO_BARS.filter((entry) => entry.chord === chord);
          const soFar = heard.filter((entry) => entry.chord === chord);
          return {
            id: chord.symbol,
            start: every[0].stampStart,
            end: every[0].stampEnd,
            primary: chord.symbol,
            roman: chord.roman,
            occurrences: soFar.map((entry) => entry.stampStart),
            meter: soFar.length / Math.max(1, heard.length),
            meterGhost: every.length / HARMONY_DEMO_BARS.length,
            tone: chord.rootPitchClass,
            ...(chord.severity ? {severity: chord.severity} : {}),
          };
        }),
        layout: 'flow' as const,
        emptyLabel: 'Nothing has been heard yet.',
      };
    },
    selectItem: (_id: string, item: ChipItem): void => {
      const first = HARMONY_DEMO_BARS.find((entry) => entry.stampStart === item.occurrences?.[0]);
      if (first) seekTo(first.start, 'commit');
    },
    subscribe: notifier.subscribe,
  };

  // -------------------------------------------------------------------------
  // Following the shell into its slots.
  // -------------------------------------------------------------------------

  /** The rows of `handle.index`: the readable twin of whatever the stage draws. */
  const indexRows = (): readonly {id: string; text: string}[] => {
    if (state.view === 'key') {
      return HARMONY_DEMO_FIFTHS.map((label) => ({id: label, text: label}));
    }
    return HARMONY_DEMO_BARS.map((entry) => ({
      id: entry.id,
      text: `${entry.chord.symbol} (${entry.chord.roman})`,
    }));
  };

  const currentRow = (): string =>
    state.view === 'key'
      ? HARMONY_DEMO_FIFTHS[soundingChord().fifthsIndex]
      : HARMONY_DEMO_BARS[bar].id;

  /**
   * The list is the CALLER'S, filled and emptied by nobody else — the shell
   * hands out an `<ol>` and never looks inside it, which is the only way one
   * shell can carry the readable twin of a stage whose contents it does not
   * know.
   */
  const paintIndex = (): void => {
    if (!shell) return;
    if (indexKind !== state.view) {
      indexKind = state.view;
      shell.index.replaceChildren(
        ...indexRows().map((row) => {
          const item = document.createElement('li');
          item.dataset.row = row.id;
          item.textContent = row.text;
          return item;
        }),
      );
    }
    const current = currentRow();
    for (const node of shell.index.children) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.dataset.row === current) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    }
  };

  /**
   * The other half of the protocol, and the half the shell has to push.
   *
   * `dock(id)` refusing covers what has not been mounted yet; a presenter
   * ALREADY in a dock that folds keeps its clock subscription and goes on
   * painting into a box nobody can see, and the shell does not own it. So the
   * shell says the slot closed and the caller takes its tenant down.
   */
  const evict = (id: string): void => {
    dockTenants.get(id)?.destroy();
    dockTenants.delete(id);
  };

  /**
   * `dock(id)` IS the protocol on the way in: a host means "mount here", and
   * `undefined` means the section is folded away or this view never asked for
   * it, so the tenant comes down. That is the shell refusing to let a presenter
   * run, take a clock subscription and paint into a box nobody can see.
   */
  const syncTenants = (): void => {
    if (destroyed || !shell) return;
    // Read the shell only once it has reconciled. `update()` is idempotent and
    // rebuilds no slot node, so asking twice in one turn costs nothing.
    shell.update();

    const stageWants = state.phase === 'empty' || state.phase === 'error' ? undefined : state.view;
    if (stageWants !== stageKind) {
      stageTenant?.destroy();
      stageTenant = undefined;
      stageKind = stageWants;
      if (stageWants === 'chords') {
        stageTenant = mountFlowLane(shell.stage, laneBinding, {
          clock: shell.clock,
          formatPosition: (position) => `${position.toFixed(1)} seconds`,
        });
      } else if (stageWants === 'key') {
        stageTenant = mountWheel(shell.stage, wheelBinding);
      } else if (stageWants === 'voicing') {
        stageTenant = mountStaff(shell.stage, staffBinding, {anchor: 0.35, density: state.density});
      }
    }

    for (const dock of WORKBENCH_DEMO_DOCKS) {
      const slot = shell.dock(dock.id);
      const tenant = dockTenants.get(dock.id);
      if (!slot) {
        evict(dock.id);
        continue;
      }
      if (tenant) continue;
      if (dock.id === 'keyboard') {
        dockTenants.set(dock.id, mountKeyboard(slot, keyboardBinding, {density: state.density}));
      } else if (dock.id === 'staff') {
        dockTenants.set(dock.id, mountStaff(slot, staffBinding, {density: state.density}));
      } else if (dock.id === 'chips') {
        dockTenants.set(dock.id, mountChipStrip(slot, chipBinding));
      }
    }

    paintIndex();
  };

  /** The one place a demo state change reaches the shell, the slots and the strip. */
  function republish(): void {
    notifier.notify();
    syncTenants();
  }

  const remount = (): void => {
    for (const tenant of dockTenants.values()) tenant.destroy();
    dockTenants.clear();
    stageTenant?.destroy();
    stageTenant = undefined;
    stageKind = undefined;
    indexKind = undefined;
    shell?.destroy();
    shell = mountWorkbench(
      shellHost,
      shellBinding,
      workbenchOptions(host, optionValues, (id, visible) => {
        if (!visible) evict(id);
      }),
    );
    syncTenants();
  };

  /**
   * The domain tick, at eleven hertz — the layer that says WHAT. The shell's
   * frame loop says WHEN, sixty times a second, and the two are separate on
   * purpose: a snapshot per frame would rebuild every read-out in every dock in
   * order to say the same sentence sixty times over.
   */
  const poll = (): void => {
    if (destroyed) return;
    const landed = workbenchBarAt(positionAt(clockNow()));
    if (landed === bar) return;
    bar = landed;
    republish();
  };

  const stopClock = (): void => {
    if (timer === undefined) return;
    view?.clearInterval(timer);
    timer = undefined;
  };
  const startClock = (): void => {
    if (destroyed || timer !== undefined) return;
    timer = view?.setInterval(poll, HARMONY_POLL_MS);
  };

  origin = clockNow();
  remount();
  startClock();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'view') {
        const picked = WORKBENCH_DEMO_VIEWS.find((entry) => entry.id === value);
        state = {...state, view: picked?.id ?? WORKBENCH_INITIAL_STATE.view};
      } else if (name === 'phase') {
        state = {...state, phase: WORKBENCH_PHASES.find((entry) => entry === value) ?? 'playing'};
        setRunning(live());
      } else if (name === 'density') {
        const density = value === 'compact' ? 'compact' : 'comfortable';
        if (density !== state.density) {
          state = {...state, density};
          // Pitch presenters own their density tokens. Recreate the tenants
          // with the new option; updating only the shell leaves them unchanged.
          remount();
        }
      } else if (name === 'scheme') {
        state = {...state, scheme: value === 'light' || value === 'dark' ? value : 'auto'};
      } else if (name === 'keyboard') {
        state = {...state, keyboard: value !== false};
      }
      republish();
    },
    setOption(name, value) {
      if (destroyed) return;
      assignOption(optionValues, name, value);
      remount();
    },
    reset() {
      if (destroyed) return;
      delete host.dataset.presenterDemoError;
      state = {...WORKBENCH_INITIAL_STATE};
      optionValues = {};
      folded = {};
      held = 0;
      origin = clockNow();
      running = true;
      epoch = 0;
      bar = 0;
      remount();
      startClock();
      notifier.notify();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // The interval is the demo's own and nobody else will stop it; the
      // shell's animation frame goes with the shell, and the lane's
      // subscription to that clock goes with the lane.
      stopClock();
      delete host.dataset.presenterDemoError;
      for (const tenant of dockTenants.values()) tenant.destroy();
      dockTenants.clear();
      stageTenant?.destroy();
      stageTenant = undefined;
      shell?.destroy();
      shell = undefined;
      notifier.clear();
      shellHost.remove();
    },
  };
}

export function mountViewsAnalysisDemo(
  presenter: string,
  host: HTMLElement,
): UiPresenterDemoMountResult {
  if (presenter === 'stage') return mountStageDemo(host);
  if (presenter === 'status') return mountStatusDemo(host);
  if (presenter === 'track-list') return mountTrackListDemo(host);
  if (presenter === 'analysis') return mountAnalysisDemo(host);
  if (presenter === 'pitch') return mountPitchDemo(host);
  if (presenter === 'harmony') return mountHarmonyDemo(host);
  if (presenter === 'workbench') return mountWorkbenchDemo(host);
  return undefined;
}
