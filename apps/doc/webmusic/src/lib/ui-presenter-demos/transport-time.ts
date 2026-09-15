import {
  mountMinimap,
  type MinimapBinding,
  type MinimapHandle,
  type MinimapOptions,
  type MinimapState,
} from '@webmusic/ui/minimap';
import {
  mountPlaylist,
  type PlaylistBinding,
  type PlaylistHandle,
  type PlaylistOptions,
  type PlaylistState,
} from '@webmusic/ui/playlist';
import {
  mountTimeline,
  type TimelineBinding,
  type TimelineHandle,
  type TimelineOptions,
  type TimelineState,
} from '@webmusic/ui/timeline';
import {
  mountTransport,
  type MountedTransportHandle,
  type TransportOptions,
  type TransportState,
} from '@webmusic/ui/transport';
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const INITIAL_TRANSPORT_STATE: TransportState = {
  playing: false,
  progress: 0.18,
  seconds: 13,
  duration: 72,
  disabled: false,
};

function transportOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): TransportOptions {
  const options: TransportOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.showTime === 'boolean') options.showTime = values.showTime;
  if (
    values.seekControl === 'native' ||
    values.seekControl === 'surface' ||
    values.seekControl === false
  ) {
    options.seekControl = values.seekControl;
  }
  if (typeof values.seek === 'boolean') options.seek = values.seek;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  if (typeof values.playLabel === 'string') options.playLabel = values.playLabel;
  if (typeof values.pauseLabel === 'string') options.pauseLabel = values.pauseLabel;
  if (values.icon === 'custom') {
    options.icon = (playing) => host.ownerDocument.createTextNode(playing ? 'Ⅱ' : '▶');
  }
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-transport',
      play: 'demo-play',
      track: 'demo-track',
      seek: 'demo-seek',
      fill: 'demo-fill',
      time: 'demo-time',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      play: 'demo-play',
      track: 'demo-track',
      seek: 'demo-seek',
      fill: 'demo-fill',
      time: 'demo-time',
    };
  }
  if (values.onError === 'report') {
    options.onError = (error) => {
      host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
    };
  }
  return options;
}

function mountTransportDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let state: TransportState = {...INITIAL_TRANSPORT_STATE};
  let optionValues: Record<string, unknown> = {};
  let presenter: MountedTransportHandle | undefined;
  let destroyed = false;

  const binding = {
    snapshot: () => state,
    play: () => {
      state = state.progress >= 1
        ? {...state, playing: true, progress: 0, seconds: 0}
        : {...state, playing: true};
      notifier.notify();
    },
    pause: () => {
      state = {...state, playing: false};
      notifier.notify();
    },
    seekFraction: (progress: number) => {
      const normalized = clamp(progress, 0, 1);
      const duration = Math.max(0, Number(state.duration) || 0);
      state = {...state, progress: normalized, seconds: normalized * duration};
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountTransport(host, binding, transportOptions(host, optionValues));
  };
  remount();

  const view = host.ownerDocument.defaultView;
  const timer = view?.setInterval(() => {
    if (!state.playing || state.disabled) return;
    const duration = Math.max(0, Number(state.duration) || 0);
    const fallbackSeconds = clamp(Number(state.progress) || 0, 0, 1) * duration;
    const currentSeconds = typeof state.seconds === 'number' && Number.isFinite(state.seconds)
      ? Math.max(0, state.seconds)
      : fallbackSeconds;
    const seconds = Math.min(duration, currentSeconds + 0.1);
    state = {
      ...state,
      playing: duration > 0 && seconds < duration,
      seconds,
      progress: duration > 0 ? seconds / duration : 0,
    };
    notifier.notify();
  }, 100);

  const handle: UiPresenterDemoHandle = {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'playing') state = {...state, playing: value === true};
      else if (name === 'progress') {
        state = {...state, progress: clamp(Number(value) || 0, 0, 1)};
      } else if (name === 'seconds' || name === 'duration') {
        const next = {...state};
        if (value === undefined) delete next[name];
        else next[name] = Math.max(0, Number(value) || 0);
        state = next;
      } else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      state = {...INITIAL_TRANSPORT_STATE};
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
  return handle;
}

const TIMELINE_TICKS = Array.from({length: 9}, (_, index) => ({
  id: `bar-${index + 1}`,
  position: index * 4,
  label: String(index + 1),
  level: 'major' as const,
}));

function timelineRegions(mode: string): TimelineState['regions'] {
  if (mode === 'markers') {
    return [
      {id: 'cue-a', label: 'Cue A', start: 4, color: '#5274d9'},
      {id: 'section', label: 'Section', start: 10, end: 22, color: '#8a63d2'},
      {id: 'cue-b', label: 'Cue B', start: 28, color: '#2f9272', disabled: true},
    ];
  }
  return [
    {id: 'intro', label: 'Intro', start: 0, end: 8, color: '#5274d9'},
    {id: 'verse', label: 'Verse', start: 8, end: 20, color: '#8a63d2'},
    {id: 'bridge', label: 'Bridge', start: 20, end: 26, color: '#2f9272'},
    {id: 'outro', label: 'Outro', start: 26, end: 32, color: '#c46a3a'},
  ];
}

function initialTimelineState(): TimelineState {
  return {
    duration: 32,
    playhead: 3,
    ticks: TIMELINE_TICKS,
    selection: {start: 10, end: 14},
    loop: {start: 8, end: 24},
    regions: timelineRegions('arrangement'),
    disabled: false,
  };
}

function timelineOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): TimelineOptions {
  const options: TimelineOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.majorStep === 'number') options.majorStep = values.majorStep;
  if (typeof values.keyboardStep === 'number') options.keyboardStep = values.keyboardStep;
  if (values.formatPosition === 'beats') {
    options.formatPosition = (position) => `Beat ${position.toFixed(1).replace(/\.0$/, '')}`;
  }
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-timeline',
      ruler: 'demo-ruler',
      tick: 'demo-tick',
      tickLabel: 'demo-tick-label',
      lane: 'demo-lane',
      region: 'demo-region',
      marker: 'demo-marker',
      label: 'demo-label',
      selection: 'demo-selection',
      loop: 'demo-loop',
      playhead: 'demo-playhead',
      seek: 'demo-seek',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      ruler: 'demo-ruler',
      tick: 'demo-tick',
      tickLabel: 'demo-tick-label',
      lane: 'demo-lane',
      region: 'demo-region',
      marker: 'demo-marker',
      label: 'demo-label',
      selection: 'demo-selection',
      loop: 'demo-loop',
      playhead: 'demo-playhead',
      seek: 'demo-seek',
    };
  }
  if (values.onError === 'report') {
    options.onError = (error) => {
      host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
    };
  }
  return options;
}

function mountTimelineDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let state = initialTimelineState();
  let viewportMode: string | undefined;
  let ticksMode: string | undefined = 'bars';
  let selectionMode: string | undefined = '10-14';
  let loopMode: string | undefined = '8-24';
  let regionMode = 'arrangement';
  let optionValues: Record<string, unknown> = {};
  let presenter: TimelineHandle | undefined;
  let destroyed = false;

  const binding: TimelineBinding = {
    snapshot: () => state,
    seek: (position) => {
      state = {...state, playhead: clamp(position, 0, Math.max(0, state.duration))};
      notifier.notify();
    },
    selectRegion: (id, options) => {
      state = {
        ...state,
        regions: state.regions.map((region) => ({
          ...region,
          selected: options.additive
            ? region.id === id
              ? !region.selected
              : region.selected
            : region.id === id,
        })),
      };
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountTimeline(host, binding, timelineOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'duration') state = {...state, duration: Math.max(0, Number(value) || 0)};
      else if (name === 'viewport') {
        viewportMode = typeof value === 'string' ? value : undefined;
        const next = {...state};
        if (viewportMode === 'middle') next.viewport = {start: 8, end: 24};
        else delete next.viewport;
        state = next;
      } else if (name === 'playhead') {
        const next = {...state};
        if (value === undefined) delete next.playhead;
        else next.playhead = Math.max(0, Number(value) || 0);
        state = next;
      } else if (name === 'ticks') {
        ticksMode = typeof value === 'string' ? value : undefined;
        const next = {...state};
        if (ticksMode === 'bars') next.ticks = TIMELINE_TICKS;
        else delete next.ticks;
        state = next;
      } else if (name === 'selection') {
        selectionMode = typeof value === 'string' ? value : undefined;
        const next = {...state};
        if (selectionMode === '10-14') next.selection = {start: 10, end: 14};
        else delete next.selection;
        state = next;
      } else if (name === 'loop') {
        loopMode = typeof value === 'string' ? value : undefined;
        const next = {...state};
        if (loopMode === '8-24') next.loop = {start: 8, end: 24};
        else delete next.loop;
        state = next;
      } else if (name === 'regions' && typeof value === 'string') {
        regionMode = value;
        state = {...state, regions: timelineRegions(regionMode)};
      } else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      state = initialTimelineState();
      viewportMode = undefined;
      ticksMode = 'bars';
      selectionMode = '10-14';
      loopMode = '8-24';
      regionMode = 'arrangement';
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({
      duration: state.duration,
      viewport: viewportMode,
      playhead: state.playhead,
      ticks: ticksMode,
      selection: selectionMode,
      loop: loopMode,
      regions: regionMode,
      disabled: state.disabled,
    }),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

function minimapOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): MinimapOptions {
  const options: MinimapOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.fallbackWidth === 'number') options.fallbackWidth = values.fallbackWidth;
  if (typeof values.fallbackHeight === 'number') options.fallbackHeight = values.fallbackHeight;
  if (typeof values.edgeSize === 'number') options.edgeSize = values.edgeSize;
  if (typeof values.keyboardStep === 'number') options.keyboardStep = values.keyboardStep;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-minimap',
      canvas: 'demo-canvas',
      brush: 'demo-brush',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {root: 'demo-root', canvas: 'demo-canvas', brush: 'demo-brush'};
  }
  if (values.onError === 'report') {
    options.onError = (error) => {
      host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
    };
  }
  return options;
}

function mountMinimapDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let state: MinimapState = {minimum: 0, maximum: 120, start: 24, end: 64};
  let playhead = 36;
  let optionValues: Record<string, unknown> = {};
  let presenter: MinimapHandle | undefined;
  let destroyed = false;

  const binding: MinimapBinding = {
    snapshot: () => state,
    draw: ({context, width, height}) => {
      const middle = height / 2;
      context.save();
      context.lineWidth = 1.5;
      context.strokeStyle = '#5274d9';
      context.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const phase = (x / Math.max(1, width)) * Math.PI * 18;
        const envelope = 0.35 + 0.65 * Math.sin((x / Math.max(1, width)) * Math.PI) ** 2;
        const y = middle + Math.sin(phase) * middle * 0.68 * envelope;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();

      const minimum = Math.min(state.minimum, state.maximum);
      const maximum = Math.max(state.minimum, state.maximum);
      const span = Math.max(1, maximum - minimum);
      const cursorX = ((playhead - minimum) / span) * width;
      context.strokeStyle = '#c0392b';
      context.beginPath();
      context.moveTo(cursorX, 0);
      context.lineTo(cursorX, height);
      context.stroke();
      context.restore();
    },
    setRange: (start, end) => {
      state = {...state, start, end};
      notifier.notify();
    },
    seek: (value) => {
      playhead = clamp(
        value,
        Math.min(state.minimum, state.maximum),
        Math.max(state.minimum, state.maximum),
      );
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountMinimap(host, binding, minimapOptions(host, optionValues));
  };
  remount();

  const view = host.ownerDocument.defaultView;
  const timer = view?.setInterval(() => {
    const minimum = Math.min(state.minimum, state.maximum);
    const maximum = Math.max(state.minimum, state.maximum);
    if (playhead < minimum || playhead > maximum) playhead = minimum;
    else {
      playhead += 0.6;
      if (playhead > maximum) playhead = minimum;
    }
    notifier.notify();
  }, 120);

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'minimum' || name === 'maximum') {
        state = {...state, [name]: Number(value) || 0};
      } else if (name === 'start' || name === 'end') {
        const next = {...state};
        if (value === undefined) delete next[name];
        else next[name] = Number(value) || 0;
        state = next;
      } else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      state = {minimum: 0, maximum: 120, start: 24, end: 64};
      playhead = 36;
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

const PLAYLIST_ITEMS = [
  {id: 'prelude', label: 'Glass Prelude', duration: '0:42'},
  {id: 'signal', label: 'Night Signal', duration: '1:08'},
  {id: 'motion', label: 'Slow Motion', duration: '0:56'},
  {id: 'afterglow', label: 'Afterglow', duration: '0:38'},
] as const;

function playlistItems(mode: string, activeId = 'prelude'): PlaylistState['items'] {
  const source = mode === 'single' ? PLAYLIST_ITEMS.slice(0, 1) : PLAYLIST_ITEMS;
  return source.map((item, index) => ({
    ...item,
    active: source.some((candidate) => candidate.id === activeId)
      ? item.id === activeId
      : index === 0,
    ...(mode === 'mixed' && item.id === 'signal' ? {status: 'loading' as const} : {}),
    ...(mode === 'mixed' && item.id === 'afterglow' ? {status: 'error' as const} : {}),
  }));
}

function playlistOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): PlaylistOptions {
  const options: PlaylistOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.stylesheet === 'boolean') options.stylesheet = values.stylesheet;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-playlist',
      bar: 'demo-bar',
      button: 'demo-button',
      seek: 'demo-seek',
      list: 'demo-list',
      item: 'demo-item',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      bar: 'demo-bar',
      button: 'demo-button',
      seek: 'demo-seek',
      list: 'demo-list',
      item: 'demo-item',
    };
  }
  if (values.onError === 'report') {
    options.onError = (error) => {
      host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
    };
  }
  return options;
}

function mountPlaylistDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let itemMode = 'ready';
  let state: PlaylistState = {
    playing: false,
    progress: 0.12,
    disabled: false,
    items: playlistItems(itemMode),
  };
  let optionValues: Record<string, unknown> = {};
  let presenter: PlaylistHandle | undefined;
  let destroyed = false;

  const activateIndex = (index: number): void => {
    const items = state.items;
    if (items.length === 0) return;
    const nextIndex = (index + items.length) % items.length;
    if (items[nextIndex]?.status === 'error') return;
    state = {
      ...state,
      progress: 0,
      items: items.map((item, itemIndex) => ({...item, active: itemIndex === nextIndex})),
    };
    notifier.notify();
  };

  const activeIndex = (): number => Math.max(0, state.items.findIndex((item) => item.active));
  const move = (direction: -1 | 1): void => {
    const items = state.items;
    const current = activeIndex();
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate = (current + direction * offset + items.length) % items.length;
      if (items[candidate]?.status !== 'error') {
        activateIndex(candidate);
        return;
      }
    }
  };
  const binding: PlaylistBinding = {
    snapshot: () => state,
    toggle: () => {
      state = {...state, playing: !state.playing};
      notifier.notify();
    },
    previous: () => move(-1),
    next: () => move(1),
    seek: (progress) => {
      state = {...state, progress: clamp(progress, 0, 1)};
      notifier.notify();
    },
    select: (id) => {
      const index = state.items.findIndex((item) => item.id === id && item.status !== 'error');
      if (index >= 0) activateIndex(index);
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountPlaylist(host, binding, playlistOptions(host, optionValues));
  };
  remount();

  const view = host.ownerDocument.defaultView;
  const timer = view?.setInterval(() => {
    if (!state.playing) return;
    const progress = state.progress + 0.005;
    if (progress >= 1) move(1);
    else {
      state = {...state, progress};
      notifier.notify();
    }
  }, 100);

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'playing') state = {...state, playing: value === true};
      else if (name === 'progress') state = {...state, progress: clamp(Number(value) || 0, 0, 1)};
      else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else if (name === 'items' && typeof value === 'string') {
        itemMode = value;
        const activeId = state.items.find((item) => item.active)?.id;
        state = {...state, items: playlistItems(itemMode, activeId)};
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      itemMode = 'ready';
      state = {
        playing: false,
        progress: 0.12,
        disabled: false,
        items: playlistItems(itemMode),
      };
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({...state, items: itemMode}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

export function mountTransportTimeDemo(
  presenter: string,
  host: HTMLElement,
): UiPresenterDemoMountResult {
  switch (presenter) {
    case 'transport':
      return mountTransportDemo(host);
    case 'timeline':
      return mountTimelineDemo(host);
    case 'minimap':
      return mountMinimapDemo(host);
    case 'playlist':
      return mountPlaylistDemo(host);
    default:
      return undefined;
  }
}
