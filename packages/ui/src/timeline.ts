import {readText, textValue, type UITextValue, formatNumber, type UIValueFormatters} from './text';
import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {addClassNames, clamp, finite, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {surfaceHeight} from './internal/control';
export interface TimelineRange {
  start: number;
  end: number;
}

export interface TimelineTick {
  id: string;
  position: number;
  label?: string;
  level?: 'major' | 'minor';
}

export interface TimelineRegion {
  id: string;
  start: number;
  /** Omit `end` to render a point marker instead of a ranged region. */
  end?: number;
  label?: string;
  color?: string;
  selected?: boolean;
  disabled?: boolean;
}

export interface TimelineState {
  duration: number;
  viewport?: TimelineRange;
  playhead?: number;
  /** Domain-provided non-uniform ticks. Falls back to an even numeric ruler. */
  ticks?: readonly TimelineTick[];
  selection?: TimelineRange;
  loop?: TimelineRange;
  regions: readonly TimelineRegion[];
  disabled?: boolean;
}

export interface TimelineSelectOptions {
  additive: boolean;
}

/** Structural, domain-neutral state and commands consumed by the presenter. */
export interface TimelineBinding {
  snapshot(): TimelineState;
  seek?(position: number): Promise<void> | void;
  selectRegion?(
    id: string,
    options: TimelineSelectOptions,
  ): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface TimelineClassNames {
  root?: string;
  ruler?: string;
  tick?: string;
  tickLabel?: string;
  lane?: string;
  region?: string;
  marker?: string;
  label?: string;
  selection?: string;
  loop?: string;
  playhead?: string;
  seek?: string;
}

export interface TimelineParts {
  root?: string;
  ruler?: string;
  tick?: string;
  tickLabel?: string;
  lane?: string;
  region?: string;
  marker?: string;
  label?: string;
  selection?: string;
  loop?: string;
  playhead?: string;
  seek?: string;
}

export interface TimelineText {
  label?: UITextValue;
  playhead?: UITextValue<{label: string}>;
  region?: UITextValue<{id: string; start: number; end?: number}>;
  marker?: UITextValue<{id: string; start: number; end?: number}>;
}

export interface TimelineOptions {
  /** Read application-resolved text once per paint; call update() after external changes. */
  getText?: () => TimelineText;
  formatters?: UIValueFormatters;
  label?: string;
  /** Fixed major-tick interval. By default a readable interval is derived. */
  majorStep?: number;
  /** Keyboard seek interval. Defaults to one quarter of the major interval. */
  keyboardStep?: number;
  formatPosition?: (position: number) => string;
  classNames?: TimelineClassNames;
  parts?: TimelineParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface TimelineHandle {
  readonly element: HTMLElement;
  readonly ruler: HTMLElement;
  readonly lane: HTMLElement;
  readonly seek: HTMLInputElement;
  regionElement(id: string): HTMLButtonElement | undefined;
  update(): void;
  destroy(): void;
}

export type TimelineHost = HTMLElement | ShadowRoot;

export const timelineStyle = String.raw`
:host { display: block; }

.wui-timeline {
${componentSurfaceCss('timeline')}
  position: relative;
  display: grid;
  grid-template-rows: var(--wm-timeline-ruler-height, 1.65rem) minmax(${surfaceHeight('timeline-lane', 'sm')}, auto);
  min-width: 0;
  color: var(--wm-timeline-foreground, var(--wm-foreground, #222));
  font: .75rem/1.2 var(--wm-font-family, var(--wm-font, system-ui, sans-serif));
}

.wui-timeline__ruler {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--wm-timeline-border, ${controlBorderFallback});
  border-bottom: 0;
  border-radius: var(--wm-timeline-radius, var(--wm-control-radius, 0)) var(--wm-timeline-radius, var(--wm-control-radius, 0)) 0 0;
  background: var(--wm-timeline-ruler-background, var(--wm-surface-muted, #f3f3f3));
  color: var(--wm-timeline-muted, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  user-select: none;
}

.wui-timeline__tick {
  position: absolute;
  inset-block: 0;
  width: 0;
  border-inline-start: 1px solid var(--wm-grid-major, #c8c8c8);
}

.wui-timeline__tick[data-level="minor"] {
  border-inline-start-color: transparent;
}

.wui-timeline__tick[data-level="minor"]::before {
  content: '';
  position: absolute;
  inset-block: 50% 0;
  border-inline-start: 1px solid var(--wm-grid-minor, #dedede);
}

.wui-timeline__tick-label {
  position: absolute;
  inset-block-start: .25rem;
  left: .3rem;
  font-family: var(--wm-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  background: var(--wm-timeline-ruler-background, var(--wm-surface-muted, #f3f3f3));
}

.wui-timeline__lane {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--wm-timeline-border, ${controlBorderFallback});
  border-radius: 0 0 var(--wm-timeline-radius, var(--wm-control-radius, 0)) var(--wm-timeline-radius, var(--wm-control-radius, 0));
  background-color: var(--wm-timeline-background, var(--wm-surface, #fff));
  background-image: linear-gradient(90deg, var(--wm-grid-minor, rgba(0, 0, 0, .06)) 1px, transparent 1px);
  background-size: var(--wm-timeline-grid-size, 2rem) 100%;
  touch-action: manipulation;
}

.wui-timeline__lane:focus-visible,
.wui-timeline:has(.wui-timeline__seek:focus-visible) .wui-timeline__lane,
.wui-timeline__region:focus-visible {
  z-index: 4;
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: -2px;
}

.wui-timeline__region {
  appearance: none;
  position: absolute;
  inset-block: .55rem;
  box-sizing: border-box;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--wm-timeline-region-border, color-mix(in srgb, var(--wui-timeline-region-color, var(--wm-accent, #4869d8)) 70%, #000));
  border-radius: var(--wm-timeline-region-radius, var(--wm-control-radius, 0));
  background: var(--wui-timeline-region-color, var(--wm-timeline-region, var(--wm-accent, #4869d8)));
  color: var(--wm-timeline-region-foreground, var(--wm-accent-foreground, #fff));
  cursor: pointer;
}

.wui-timeline__marker {
  min-width: 2px;
}

.wui-timeline__region[aria-pressed="true"] {
  box-shadow: inset 0 0 0 2px var(--wm-selection, var(--wm-foreground, #111));
}

.wui-timeline__region:disabled {
  cursor: default;
  opacity: .5;
}

.wui-timeline__region-label {
  display: block;
  overflow: hidden;
  padding: .3rem .45rem;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wui-timeline__selection {
  position: absolute;
  z-index: 2;
  inset-block: 0;
  border-inline: 1px solid var(--wm-selection, #4869d8);
  background: var(--wm-selection-fill, rgba(72, 105, 216, .18));
  pointer-events: none;
}

.wui-timeline__loop {
  position: absolute;
  z-index: 1;
  inset-block: 0;
  border-inline: 2px solid var(--wm-loop, #2f8f5b);
  background: color-mix(in srgb, var(--wm-loop, #2f8f5b) 12%, transparent);
  pointer-events: none;
}

.wui-timeline__playhead {
  position: absolute;
  z-index: 3;
  inset-block: 0;
  width: var(--wm-timeline-playhead-width, 2px);
  background: var(--wm-playhead, #c0392b);
  pointer-events: none;
  transform: translateX(-50%);
}

.wui-timeline__seek {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (forced-colors: active) {
  .wui-timeline__region {
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }

  .wui-timeline__region[aria-pressed="true"],
  .wui-timeline__region:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }

  .wui-timeline__region,
  .wui-timeline__selection,
  .wui-timeline__loop,
  .wui-timeline__playhead {
    forced-color-adjust: auto;
  }
}
`;

const mountedTimelines = new WeakMap<TimelineHost, TimelineHandle>();

function niceStep(span: number): number {
  const rough = Math.max(Number.EPSILON, span / 8);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function defaultFormatPosition(position: number): string {
  const absolute = Math.abs(position);
  if (absolute >= 100) return position.toFixed(0);
  if (absolute >= 10) return position.toFixed(1).replace(/\.0$/, '');
  return position.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

function normalizeRange(
  range: TimelineRange | undefined,
  minimum: number,
  maximum: number,
): TimelineRange | undefined {
  if (!range) return undefined;
  const start = clamp(finite(range.start, minimum), minimum, maximum);
  const end = clamp(finite(range.end, start), minimum, maximum);
  return end > start ? {start, end} : undefined;
}

/**
 * Mount a domain-neutral ruler, region lane, selection and playhead.
 *
 * The presenter borrows `binding`. It owns only its DOM, listeners and
 * subscription, and never owns timeline models, players or renderers.
 */
export function mountTimeline(
  host: TimelineHost,
  binding: TimelineBinding,
  options: TimelineOptions = {},
): TimelineHandle {

  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'timeline', timelineStyle, options.stylesheet);

  const root = document.createElement('div');
  root.className = 'wui-timeline';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', options.label ?? 'Timeline');
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);

  const ruler = document.createElement('div');
  ruler.className = 'wui-timeline__ruler';
  ruler.setAttribute('aria-hidden', 'true');
  addClassNames(ruler, options.classNames?.ruler);
  setParts(ruler, 'ruler', options.parts?.ruler);

  const lane = document.createElement('div');
  lane.className = 'wui-timeline__lane';
  addClassNames(lane, options.classNames?.lane);
  setParts(lane, 'lane', options.parts?.lane);

  const selection = document.createElement('div');
  selection.className = 'wui-timeline__selection';
  selection.setAttribute('aria-hidden', 'true');
  addClassNames(selection, options.classNames?.selection);
  setParts(selection, 'selection', options.parts?.selection);

  const loop = document.createElement('div');
  loop.className = 'wui-timeline__loop';
  loop.setAttribute('aria-hidden', 'true');
  addClassNames(loop, options.classNames?.loop);
  setParts(loop, 'loop', options.parts?.loop);

  const playhead = document.createElement('div');
  playhead.className = 'wui-timeline__playhead';
  playhead.setAttribute('aria-hidden', 'true');
  addClassNames(playhead, options.classNames?.playhead);
  setParts(playhead, 'playhead', options.parts?.playhead);

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'wui-timeline__seek';
  seek.setAttribute('aria-label', `${options.label ?? 'Timeline'} playhead`);
  addClassNames(seek, options.classNames?.seek);
  setParts(seek, 'seek', options.parts?.seek);

  root.append(ruler, seek, lane);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let animationFrame: number | undefined;
  let viewport: TimelineRange = {start: 0, end: 1};
  let duration = 1;
  let majorStep = 1;
  let rulerSignature = '';
  let resizeObserver: ResizeObserver | undefined;
  let rulerLabels: Array<{tick: HTMLElement; label: HTMLElement; fraction: number; major: boolean}> = [];
  const regionElements = new Map<string, HTMLButtonElement>();

  const reportError = createErrorSink(options.onError);

  const positionPercent = (position: number): number =>
    ((clamp(position, viewport.start, viewport.end) - viewport.start) /
      (viewport.end - viewport.start)) * 100;

  let scheduleUpdate = (): void => {};

  const runCommand = (command: () => Promise<void> | void): void => {
    try {
      void Promise.resolve(command()).then(scheduleUpdate).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  };

  const layoutRulerLabels = (): void => {
    if (destroyed) return;
    const width = ruler.clientWidth;
    const inset = 4;
    const gap = 8;
    // Read all widths before changing placement. Visibility keeps hidden
    // labels measurable, so widening a container can restore the full ruler.
    const candidates = rulerLabels.map((entry) => {
      const measured = entry.label.getBoundingClientRect().width;
      const labelWidth = measured || (entry.label.textContent?.length ?? 0) * 7;
      const x = entry.fraction * width;
      const left = Math.max(inset, Math.min(x + inset, width - inset - labelWidth));
      return {...entry, x, left, right: left + labelWidth, labelWidth};
    }).sort((a, b) => a.fraction - b.fraction);
    const major = candidates.filter((entry) => entry.major);
    const minor = candidates.filter((entry) => !entry.major);
    // Preserve the major endpoints first, then pack other major labels before
    // minor ones. All tick lines and original label strings remain in the DOM.
    const endpointsFirst = <T>(items: T[]): T[] => items.length < 2
      ? items : [items[0]!, items[items.length - 1]!, ...items.slice(1, -1)];
    const selected = new Set<HTMLElement>();
    const occupied: Array<{left: number; right: number}> = [];
    for (const entry of [...endpointsFirst(major), ...endpointsFirst(minor)]) {
      if (!entry.label.textContent || width <= inset * 2 || entry.labelWidth > width - inset * 2) continue;
      if (occupied.some((other) => entry.left < other.right + gap && entry.right + gap > other.left)) continue;
      selected.add(entry.label);
      occupied.push(entry);
    }
    for (const entry of candidates) {
      const shown = selected.has(entry.label);
      entry.label.style.visibility = shown ? 'visible' : 'hidden';
      entry.label.style.left = `${entry.left - entry.x}px`;
      entry.tick.dataset.labelVisible = String(shown);
    }
  };

  const observeRuler = (): void => {
    resizeObserver?.observe(ruler);
    for (const entry of rulerLabels) resizeObserver?.observe(entry.label);
  };

  const renderRuler = (state: TimelineState): void => {
    const tickNodes: HTMLElement[] = [];
    const formatPosition = options.formatPosition ?? ((position: number) => formatNumber(options.formatters, position, defaultFormatPosition(position), options.onError));
    const tickState: TimelineTick[] = [];

    if (state.ticks !== undefined) {
      const ids = new Set<string>();
      for (const candidate of state.ticks) {
        if (!candidate.id || ids.has(candidate.id)) continue;
        const position = finite(candidate.position, Number.NaN);
        if (!Number.isFinite(position)) continue;
        if (position < viewport.start || position > viewport.end) continue;
        ids.add(candidate.id);
        tickState.push({...candidate, position});
      }
    } else {
      const first = Math.ceil(viewport.start / majorStep) * majorStep;
      const epsilon = majorStep / 1000;
      for (
        let position = first, count = 0;
        position <= viewport.end + epsilon && count < 200;
        position += majorStep, count += 1
      ) {
        tickState.push({
          id: `auto-${count}`,
          position,
          level: 'major',
        });
      }
    }

    // Text callbacks may read external settings even when geometry is unchanged.
    const resolved = tickState.map(item => ({...item, label: item.label ?? formatPosition(item.position)}));
    if (destroyed || !claim.isCurrent()) return;
    const signature = JSON.stringify([viewport, resolved]);
    if (signature === rulerSignature) return;
    rulerSignature = signature;
    resizeObserver?.disconnect();
    rulerLabels = [];
    for (const item of resolved) {
      const tick = document.createElement('span');
      tick.className = 'wui-timeline__tick';
      tick.dataset.tickId = item.id;
      tick.dataset.level = item.level ?? 'major';
      tick.style.left = `${positionPercent(item.position)}%`;
      addClassNames(tick, options.classNames?.tick);
      setParts(tick, 'tick', options.parts?.tick);

      const label = document.createElement('span');
      label.className = 'wui-timeline__tick-label';
      label.textContent = item.label;
      tick.title = label.textContent;
      addClassNames(label, options.classNames?.tickLabel);
      setParts(label, 'tick-label', options.parts?.tickLabel);
      tick.append(label);
      tickNodes.push(tick);
      rulerLabels.push({tick, label, fraction: positionPercent(item.position) / 100, major: item.level !== 'minor'});
    }

    ruler.replaceChildren(...tickNodes);
    layoutRulerLabels();
    observeRuler();
  };

  const renderRegions = (state: TimelineState, text: TimelineText | undefined): void => {
    const nodes: HTMLElement[] = [];
    const ids = new Set<string>();

    for (const region of state.regions ?? []) {
      if (!region.id || ids.has(region.id)) continue;
      ids.add(region.id);

      const start = clamp(finite(region.start), 0, duration);
      const marker = region.end === undefined;
      const end = marker
        ? start
        : clamp(finite(region.end, start), 0, duration);
      const visibleStart = Math.max(start, viewport.start);
      const visibleEnd = Math.min(end, viewport.end);
      if (marker) {
        if (start < viewport.start || start > viewport.end) continue;
      } else if (visibleEnd <= visibleStart) {
        continue;
      }

      let button = regionElements.get(region.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        const id = region.id;
        const ownButton = button;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          if (!binding.selectRegion || ownButton.disabled || regionElements.get(id) !== ownButton) return;
          const pointer = event as MouseEvent;
          runCommand(() => binding.selectRegion!(id, {additive: pointer.metaKey || pointer.ctrlKey}));
        });
      }
      button.className = `wui-timeline__region${marker ? ' wui-timeline__marker' : ''}`;
      button.dataset.regionId = region.id;
      button.dataset.kind = marker ? 'marker' : 'region';
      button.style.left = `${positionPercent(visibleStart)}%`;
      button.style.width = marker
        ? 'var(--wm-timeline-marker-width, 2px)'
        : `${positionPercent(visibleEnd) - positionPercent(visibleStart)}%`;
      if (region.color) {
        button.style.setProperty('--wui-timeline-region-color', region.color);
      } else button.style.removeProperty('--wui-timeline-region-color');
      button.disabled =
        state.disabled === true ||
        region.disabled === true ||
        binding.selectRegion === undefined;
      button.setAttribute('aria-pressed', String(region.selected === true));
      button.setAttribute(
        'aria-label',
        region.label ?? textValue(marker ? text?.marker : text?.region, `${marker ? 'Marker' : 'Region'} ${region.id}`, {
          id: region.id, start: region.start, end: region.end,
        }, options.onError),
      );
      addClassNames(button, options.classNames?.region);
      if (marker) addClassNames(button, options.classNames?.marker);
      setParts(
        button,
        marker ? 'region marker' : 'region',
        [
          options.parts?.region,
          marker ? options.parts?.marker : undefined,
        ].filter(Boolean).join(' '),
      );

      const label = button.firstElementChild ?? document.createElement('span');
      label.className = 'wui-timeline__region-label';
      label.textContent = region.label ?? region.id;
      addClassNames(label, options.classNames?.label);
      setParts(label, 'label', options.parts?.label);
      if (!label.parentNode) button.append(label);
      nodes.push(button);
      regionElements.set(region.id, button);
    }

    const visible = new Set(nodes);
    for (const [id, node] of regionElements) {
      if (visible.has(node)) continue;
      node.remove();
      regionElements.delete(id);
    }
    // Do not detach unchanged controls: language and value updates retain focus.
    for (const [index, node] of nodes.entries()) {
      const before = lane.children[index];
      if (before !== node) lane.insertBefore(node, before ?? null);
    }
  };

  const update = (): void => {
    if (destroyed) return;

    try {
      const state = binding.snapshot();
      const text = readText(options.getText, options.onError);
      if (destroyed || !claim.isCurrent()) return;
      const label = options.label ?? textValue(text?.label, 'Timeline', {}, options.onError);
      root.setAttribute('aria-label', label);
      seek.setAttribute('aria-label', textValue(text?.playhead, `${label} playhead`, {label}, options.onError));
      duration = Math.max(Number.EPSILON, finite(state.duration, 1));
      viewport = normalizeRange(state.viewport, 0, duration) ?? {
        start: 0,
        end: duration,
      };
      const derivedStep = niceStep(viewport.end - viewport.start);
      majorStep =
        typeof options.majorStep === 'number' &&
        Number.isFinite(options.majorStep) &&
        options.majorStep > 0
          ? options.majorStep
          : derivedStep;

      renderRuler(state);
      if (destroyed || !claim.isCurrent()) return;
      renderRegions(state, text);

      const normalizedLoop = normalizeRange(
        state.loop,
        viewport.start,
        viewport.end,
      );
      if (normalizedLoop) {
        loop.hidden = false;
        loop.style.left = `${positionPercent(normalizedLoop.start)}%`;
        loop.style.width = `${positionPercent(normalizedLoop.end) - positionPercent(normalizedLoop.start)}%`;
        lane.append(loop);
      } else {
        loop.hidden = true;
        loop.remove();
      }

      const normalizedSelection = normalizeRange(
        state.selection,
        viewport.start,
        viewport.end,
      );
      if (normalizedSelection) {
        selection.hidden = false;
        selection.style.left = `${positionPercent(normalizedSelection.start)}%`;
        selection.style.width = `${positionPercent(normalizedSelection.end) - positionPercent(normalizedSelection.start)}%`;
        lane.append(selection);
      } else {
        selection.hidden = true;
        selection.remove();
      }

      const rawPlayhead = finite(state.playhead, 0);
      const playheadVisible =
        rawPlayhead >= viewport.start && rawPlayhead <= viewport.end;
      playhead.hidden = !playheadVisible;
      if (playheadVisible) {
        playhead.style.left = `${positionPercent(rawPlayhead)}%`;
        lane.append(playhead);
      } else {
        playhead.remove();
      }

      if (binding.seek) {
        const position = clamp(rawPlayhead, viewport.start, viewport.end);
        const keyboardStep =
          typeof options.keyboardStep === 'number' &&
          Number.isFinite(options.keyboardStep) &&
          options.keyboardStep > 0
            ? options.keyboardStep
            : majorStep / 4;
        seek.hidden = false;
        seek.disabled = state.disabled === true;
        seek.min = String(viewport.start);
        seek.max = String(viewport.end);
        seek.step = String(keyboardStep);
        seek.value = String(position);
        seek.setAttribute(
          'aria-valuetext',
          options.formatPosition?.(position) ?? formatNumber(options.formatters, position, defaultFormatPosition(position), options.onError),
        );
      } else {
        seek.hidden = true;
        seek.disabled = true;
        seek.removeAttribute('aria-valuetext');
      }
    } catch (error) {
      reportError(error);
    }
  };

  scheduleUpdate = (): void => {
    if (destroyed || animationFrame !== undefined) return;
    const view = document.defaultView;
    if (!view?.requestAnimationFrame) {
      update();
      return;
    }
    animationFrame = view.requestAnimationFrame(() => {
      animationFrame = undefined;
      update();
    });
  };

  lane.addEventListener('click', (event) => {
    if (!binding.seek || seek.disabled) return;
    const bounds = lane.getBoundingClientRect();
    const width = bounds.width || lane.clientWidth;
    if (!(width > 0)) return;
    const fraction = clamp((event.clientX - bounds.left) / width, 0, 1);
    runCommand(() =>
      binding.seek!(viewport.start + fraction * (viewport.end - viewport.start)),
    );
  });

  seek.addEventListener('input', () => {
    if (!binding.seek || seek.disabled) return;
    runCommand(() => binding.seek!(finite(seek.valueAsNumber, viewport.start)));
  });

  const handle: TimelineHandle = {
    element: root,
    ruler,
    lane,
    seek,
    regionElement(id: string): HTMLButtonElement | undefined {
      return regionElements.get(id);
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      view?.removeEventListener('resize', layoutRulerLabels);
      try {
        unsubscribe?.();
      } catch (error) {
        reportError(error);
      }
      if (animationFrame !== undefined) {
        document.defaultView?.cancelAnimationFrame?.(animationFrame);
        animationFrame = undefined;
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  // Claim the host before destroying the previous timeline: its cleanup may
  // mount a replacement, and that replacement must win.
  const claim = claimHost(mountedTimelines, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }
  update();
  if (destroyed || !claim.isCurrent()) return handle;
  const ResizeObserverClass = view?.ResizeObserver;
  if (ResizeObserverClass) {
    try {
      resizeObserver = new ResizeObserverClass(layoutRulerLabels);
      observeRuler();
    } catch (error) {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      reportError(error);
    }
  }
  if (!resizeObserver) view?.addEventListener('resize', layoutRulerLabels);
  if (binding.subscribe) {
    try {
      const stop = binding.subscribe(scheduleUpdate);
      if (destroyed) stop();
      else unsubscribe = stop;
    } catch (error) {
      reportError(error);
    }
  }
  return handle;
}
