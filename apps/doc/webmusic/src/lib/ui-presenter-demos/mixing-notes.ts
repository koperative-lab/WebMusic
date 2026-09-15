import {
  mountMixer,
  type MixerBinding,
  type MixerChannel,
  type MixerHandle,
  type MixerOptions,
  type MixerState,
} from '@webmusic/ui/mixer';
import {
  mountMeter,
  type MeterBinding,
  type MeterHandle,
  type MeterLevelState,
  type MeterOptions,
} from '@webmusic/ui/meter';
import {
  mountRecorder,
  type RecorderBinding,
  type RecorderHandle,
  type RecorderOptions,
  type RecorderState,
} from '@webmusic/ui/recorder';
import {
  mountNoteSurface,
  pianoKeyLayout,
  type NoteChordCell,
  type NoteGridCell,
  type NoteSurfaceBinding,
  type NoteSurfaceHandle,
  type NoteSurfaceLayout,
  type NoteSurfaceOptions,
  type NoteSurfaceState,
} from '@webmusic/ui/note';
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
    subscribe(notify): () => void {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    clear(): void {
      listeners.clear();
    },
  };
}

function clamp(value: unknown, minimum = 0, maximum = 1): number {
  const finite = typeof value === 'number' && Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

function reportOption(host: HTMLElement, value: unknown): ((error: unknown) => void) | undefined {
  if (value !== 'report') return undefined;
  return (error) => {
    host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
  };
}

const MIXER_CHANNELS: Readonly<Record<string, readonly MixerChannel[]>> = {
  studio: [
    {id: 'piano', label: 'Piano', value: 0.74, muted: false, solo: false},
    {id: 'bass', label: 'Bass', value: 0.62, muted: false, solo: false},
    {id: 'drums', label: 'Drums', value: 0.88, muted: false, solo: false},
    {id: 'pad', label: 'Pad', value: 0.48, muted: false, solo: false},
  ],
  compact: [
    {id: 'music', label: 'Music', value: 0.7, muted: false, solo: false},
    {id: 'voice', label: 'Voice', value: 0.82, muted: false, solo: false},
  ],
  disabled: [
    {id: 'lead', label: 'Lead', value: 0.78, muted: false, solo: false},
    {id: 'guide', label: 'Guide', value: 0.56, disabled: true, muted: false, solo: false},
    {id: 'room', label: 'Room', value: 0.42, muted: true, solo: false},
  ],
};

function mixerChannels(preset: unknown): MixerChannel[] {
  const source = MIXER_CHANNELS[typeof preset === 'string' ? preset : 'studio'] ?? MIXER_CHANNELS.studio!;
  return source.map((channel) => ({...channel}));
}

function mixerOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): MixerOptions {
  const options: MixerOptions = {};
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-mixer',
      transport: 'demo-transport',
      board: 'demo-board',
      channels: 'demo-channels',
      strip: 'demo-strip',
      master: 'demo-master',
      fader: 'demo-fader',
      input: 'demo-input',
      label: 'demo-label',
      actions: 'demo-actions',
      button: 'demo-button',
      mute: 'demo-mute',
      solo: 'demo-solo',
      play: 'demo-play',
      pause: 'demo-pause',
      stop: 'demo-stop',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      transport: 'demo-transport',
      board: 'demo-board',
      channels: 'demo-channels',
      strip: 'demo-strip',
      master: 'demo-master',
      fader: 'demo-fader',
      input: 'demo-input',
      label: 'demo-label',
      actions: 'demo-actions',
      button: 'demo-button',
      mute: 'demo-mute',
      solo: 'demo-solo',
      play: 'demo-play',
      pause: 'demo-pause',
      stop: 'demo-stop',
    };
  }
  options.onError = reportOption(host, values.onError);
  return options;
}

function mountMixerDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  const initialControlState = {master: 0.82, channels: 'studio', disabled: false};
  let controlState: Record<string, unknown> = {...initialControlState};
  let state: MixerState = {
    master: initialControlState.master,
    channels: mixerChannels(initialControlState.channels),
    disabled: initialControlState.disabled,
  };
  let optionValues: Record<string, unknown> = {};
  let presenter: MixerHandle | undefined;
  let destroyed = false;

  const publish = (): void => notifier.notify();
  const binding: MixerBinding = {
    snapshot: () => state,
    setMaster(value) {
      state = {...state, master: clamp(value)};
      controlState.master = state.master;
      publish();
    },
    setChannel(id, value) {
      state = {
        ...state,
        channels: state.channels.map((channel) =>
          channel.id === id ? {...channel, value: clamp(value)} : channel,
        ),
      };
      publish();
    },
    setMuted(id, muted) {
      state = {
        ...state,
        channels: state.channels.map((channel) =>
          channel.id === id ? {...channel, muted} : channel,
        ),
      };
      publish();
    },
    setSolo(id) {
      state = {
        ...state,
        channels: state.channels.map((channel) => ({
          ...channel,
          solo: id === channel.id,
        })),
      };
      publish();
    },
    play() {
      state = {...state, disabled: false};
      controlState.disabled = false;
      publish();
    },
    pause() {
      state = {...state, disabled: true};
      controlState.disabled = true;
      publish();
    },
    stop() {
      state = {
        ...state,
        master: 0,
        channels: state.channels.map((channel) => ({...channel, value: 0, solo: false})),
        disabled: false,
      };
      controlState.master = 0;
      controlState.disabled = false;
      publish();
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountMixer(host, binding, mixerOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'master') {
        state = {...state, master: clamp(value)};
        controlState.master = state.master;
      } else if (name === 'channels') {
        const preset = typeof value === 'string' ? value : 'studio';
        controlState.channels = preset;
        state = {...state, channels: mixerChannels(preset)};
      } else if (name === 'disabled') {
        controlState.disabled = value;
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      publish();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      controlState = {...initialControlState};
      state = {
        master: initialControlState.master,
        channels: mixerChannels(initialControlState.channels),
        disabled: initialControlState.disabled,
      };
      optionValues = {};
      delete host.dataset.presenterDemoError;
      remount();
      publish();
    },
    snapshot: () => ({...controlState}),
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

function meterOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): MeterOptions {
  const options: MeterOptions = {};
  if (values.mode === 'level' || values.mode === 'spectrum') options.mode = values.mode;
  if (typeof values.bars === 'number') options.bars = values.bars;
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.animate === 'boolean') options.animate = values.animate;
  if (typeof values.height === 'string' || typeof values.height === 'number') options.height = values.height;
  if (typeof values.color === 'string') options.color = values.color;
  if (typeof values.peakColor === 'string') options.peakColor = values.peakColor;
  if (typeof values.backgroundColor === 'string') options.backgroundColor = values.backgroundColor;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-meter',
      track: 'demo-track',
      fill: 'demo-fill',
      peak: 'demo-peak',
      spectrum: 'demo-spectrum',
      bar: 'demo-bar',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      track: 'demo-track',
      fill: 'demo-fill',
      peak: 'demo-peak',
      spectrum: 'demo-spectrum',
      bar: 'demo-bar',
    };
  }
  options.onError = reportOption(host, values.onError);
  return options;
}

function mountMeterDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  const initialState: MeterLevelState = {level: 0.58, peak: 0.76, peakHold: 0.9};
  let state: MeterLevelState = {...initialState};
  let optionValues: Record<string, unknown> = {};
  let presenter: MeterHandle | undefined;
  let phase = 0;
  let destroyed = false;

  const binding: MeterBinding = {
    readLevel() {
      phase += 0.025;
      const movement = Math.sin(phase) * 0.055;
      return {
        level: clamp(state.level + movement),
        ...(state.peak === undefined ? {} : {peak: clamp(state.peak)}),
        ...(state.peakHold === undefined ? {} : {peakHold: clamp(state.peakHold)}),
      };
    },
    readSpectrum(bars) {
      phase += 0.025;
      const amplitude = clamp(state.level);
      return Array.from({length: bars}, (_, index) => {
        const position = index / Math.max(1, bars - 1);
        const envelope = Math.max(0.08, 1 - position * 0.72);
        return clamp(envelope * amplitude * (0.5 + Math.abs(Math.sin(phase * 2 + index * 0.63))));
      });
    },
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountMeter(host, binding, meterOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed || !['level', 'peak', 'peakHold'].includes(name)) return;
      const next = {...state};
      if (name === 'level') next.level = clamp(value);
      else if (name === 'peak') {
        if (value === undefined) delete next.peak;
        else next.peak = clamp(value);
        delete next.peakHold;
      } else if (value === undefined) delete next.peakHold;
      else next.peakHold = clamp(value);
      state = next;
      presenter?.redraw();
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
      state = {...initialState};
      optionValues = {};
      phase = 0;
      delete host.dataset.presenterDemoError;
      remount();
      notifier.notify();
    },
    snapshot: () => ({...state}),
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

const INITIAL_RECORDER_STATE: RecorderState = {
  recording: false,
  busy: false,
  playing: false,
  level: 0.2,
  recordedCount: 0,
  takeCount: 0,
  status: 'Ready — record a demo take',
  canPlay: false,
  canExport: false,
};

function recorderOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): RecorderOptions {
  const options: RecorderOptions = {};
  if (values.exportFormats === 'wav-json') {
    options.exportFormats = [{id: 'wav', label: 'WAV'}, {id: 'json', label: 'JSON'}];
  } else if (values.exportFormats === 'wav-mp3') {
    options.exportFormats = [{id: 'wav', label: 'WAV'}, {id: 'mp3', label: 'MP3'}];
  } else if (values.exportFormats === 'wav') {
    options.exportFormats = [{id: 'wav', label: 'WAV'}];
  }
  options.onError = reportOption(host, values.onError);
  return options;
}

function mountRecorderDemo(host: HTMLElement): UiPresenterDemoHandle {
  const demoWindow = host.ownerDocument.defaultView;
  const notifier = createNotifier();
  let state: RecorderState = {...INITIAL_RECORDER_STATE};
  let optionValues: Record<string, unknown> = {};
  let presenter: RecorderHandle | undefined;
  let captureTimer: number | undefined;
  let tick = 0;
  let destroyed = false;

  const publish = (): void => notifier.notify();
  const stopCaptureTimer = (): void => {
    if (captureTimer === undefined) return;
    demoWindow?.clearInterval(captureTimer);
    captureTimer = undefined;
  };
  const syncCaptureTimer = (): void => {
    if (!state.recording || state.busy || !demoWindow) {
      stopCaptureTimer();
      return;
    }
    if (captureTimer !== undefined) return;
    captureTimer = demoWindow.setInterval(() => {
      if (destroyed || !state.recording) return;
      tick += 1;
      state = {
        ...state,
        recordedCount: (state.recordedCount ?? 0) + 1,
        level: clamp(0.18 + Math.abs(Math.sin(tick * 0.47)) * 0.74),
        status: `Recording… ${(tick / 10).toFixed(1)} s`,
      };
      publish();
    }, 100);
  };
  const settle = (): Promise<void> => new Promise((resolve) => {
    if (!demoWindow) resolve();
    else demoWindow.setTimeout(resolve, 180);
  });

  const binding: RecorderBinding = {
    snapshot: () => state,
    async toggleRecording() {
      state = {...state, busy: true, status: state.recording ? 'Finalizing take…' : 'Starting recorder…'};
      syncCaptureTimer();
      publish();
      await settle();
      if (destroyed) return;
      if (state.recording) {
        const takeCount = (state.takeCount ?? 0) + 1;
        state = {
          ...state,
          busy: false,
          recording: false,
          level: 0,
          takeCount,
          status: `Captured take ${takeCount}`,
          canPlay: true,
          canExport: true,
        };
      } else {
        tick = 0;
        state = {
          ...state,
          busy: false,
          recording: true,
          playing: false,
          level: 0.18,
          recordedCount: 0,
          status: 'Recording… 0.0 s',
        };
      }
      syncCaptureTimer();
      publish();
    },
    async togglePlayback() {
      state = {...state, busy: true, status: 'Preparing take…'};
      syncCaptureTimer();
      publish();
      await settle();
      if (destroyed) return;
      const playing = !state.playing;
      state = {
        ...state,
        busy: false,
        recording: false,
        playing,
        level: 0,
        status: playing ? `Playing take ${state.takeCount ?? 0}` : `Paused take ${state.takeCount ?? 0}`,
      };
      syncCaptureTimer();
      publish();
    },
    async export(format) {
      state = {...state, busy: true, status: `Preparing ${format.toUpperCase()}…`};
      syncCaptureTimer();
      publish();
      await settle();
      if (destroyed) return;
      state = {
        ...state,
        busy: false,
        status: `Prepared take ${state.takeCount ?? 0} as ${format.toUpperCase()}`,
      };
      syncCaptureTimer();
      publish();
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    presenter = mountRecorder(host, binding, recorderOptions(host, optionValues));
  };
  remount();
  syncCaptureTimer();

  return {
    setState(name, value) {
      if (destroyed) return;
      const next = {...state};
      if (name === 'recording') next.recording = value === true;
      else if (name === 'busy' || name === 'playing' || name === 'canPlay' || name === 'canExport') {
        if (value === undefined) delete next[name];
        else next[name] = value === true;
      } else if (name === 'level') {
        if (value === undefined) delete next.level;
        else next.level = clamp(value);
      } else if (name === 'recordedCount' || name === 'takeCount') {
        if (value === undefined) delete next[name];
        else next[name] = Math.max(0, Number(value) || 0);
        delete next.status;
        if (name === 'recordedCount') {
          next.recording = true;
          next.playing = false;
        } else {
          next.recording = false;
          next.playing = false;
          delete next.canPlay;
          delete next.canExport;
        }
      } else if (name === 'status') {
        if (value === undefined) delete next.status;
        else next.status = String(value);
      } else return;
      state = next;
      syncCaptureTimer();
      publish();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      stopCaptureTimer();
      tick = 0;
      state = {...INITIAL_RECORDER_STATE};
      optionValues = {};
      delete host.dataset.presenterDemoError;
      remount();
      syncCaptureTimer();
      publish();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopCaptureTimer();
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

const NOTE_KEYS = [
  ['KeyA', 0, 'A'],
  ['KeyW', 1, 'W'],
  ['KeyS', 2, 'S'],
  ['KeyE', 3, 'E'],
  ['KeyD', 4, 'D'],
  ['KeyF', 5, 'F'],
  ['KeyT', 6, 'T'],
  ['KeyG', 7, 'G'],
  ['KeyY', 8, 'Y'],
  ['KeyH', 9, 'H'],
  ['KeyU', 10, 'U'],
  ['KeyJ', 11, 'J'],
  ['KeyK', 12, 'K'],
] as const;

const NOTE_CHORDS: Readonly<Record<string, readonly Omit<NoteChordCell, 'midis'>[]>> = {
  triads: [
    {label: 'C', index: 0},
    {label: 'Dm', index: 1},
    {label: 'Em', index: 2},
    {label: 'F', index: 3},
  ],
  sevenths: [
    {label: 'Cmaj7', index: 0},
    {label: 'Dm7', index: 1},
    {label: 'G7', index: 2},
    {label: 'Am7', index: 3},
  ],
};

interface NoteControlState extends Record<string, unknown> {
  layout: NoteSurfaceLayout;
  activeMidis?: string;
  keyboard?: boolean;
  mapOnly?: boolean;
  octaveLabel?: string;
  piano?: string;
  grid?: string;
  gridColumns?: number;
  chords?: string;
}

const INITIAL_NOTE_CONTROLS: NoteControlState = {
  layout: 'piano',
  keyboard: true,
  mapOnly: false,
  octaveLabel: 'C4–C5',
  piano: 'one-octave',
  grid: 'qwerty',
  gridColumns: 7,
  chords: 'triads',
};

function noteOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): NoteSurfaceOptions {
  return {onError: reportOption(host, values.onError)};
}

function noteGrid(preset: unknown, base: number): NoteGridCell[] | undefined {
  if (preset === 'qwerty') {
    return NOTE_KEYS.map(([code, offset, ref]) => ({midi: base + offset, code, ref}));
  }
  if (preset === 'drums') {
    return [
      {midi: 36, code: 'KeyA', ref: 'Kick'},
      {midi: 38, code: 'KeyS', ref: 'Snare'},
      {midi: 42, code: 'KeyD', ref: 'Hat'},
      {midi: 46, code: 'KeyF', ref: 'Open'},
      {midi: 41, code: 'KeyG', ref: 'Tom 1'},
      {midi: 43, code: 'KeyH', ref: 'Tom 2'},
      {midi: 49, code: 'KeyJ', ref: 'Crash'},
      {midi: 51, code: 'KeyK', ref: 'Ride'},
    ];
  }
  return undefined;
}

function noteChords(preset: unknown, base: number): NoteChordCell[] | undefined {
  const source = NOTE_CHORDS[typeof preset === 'string' ? preset : ''];
  if (!source) return undefined;
  const intervals = preset === 'sevenths'
    ? [[0, 4, 7, 11], [2, 5, 9, 12], [7, 11, 14, 17], [9, 12, 16, 19]]
    : [[0, 4, 7], [2, 5, 9], [4, 7, 11], [5, 9, 12]];
  return source.map((chord, index) => ({
    ...chord,
    midis: intervals[index]!.map((offset) => base + offset),
  }));
}

function mountNoteDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let controls: NoteControlState = {...INITIAL_NOTE_CONTROLS};
  let optionValues: Record<string, unknown> = {};
  let octave = 4;
  const held = new Set<number>();
  let presenter: NoteSurfaceHandle | undefined;
  let destroyed = false;
  const baseMidi = (): number => (octave + 1) * 12;

  const stateSnapshot = (): NoteSurfaceState => {
    const base = baseMidi();
    const preset = controls.activeMidis;
    const activePreset = preset === 'c-major'
      ? [base, base + 4, base + 7]
      : preset === 'octave'
        ? [base, base + 12]
        : [];
    const activeMidis = [...new Set([...activePreset, ...held])];
    const piano = controls.piano === 'two-octaves'
      ? pianoKeyLayout(base - 12, base + 12)
      : controls.piano === 'one-octave'
        ? pianoKeyLayout(
            base,
            base + 12,
            new Map(NOTE_KEYS.map(([, offset, label]) => [base + offset, label])),
          )
        : undefined;
    return {
      layout: controls.layout,
      ...(activeMidis.length > 0 ? {activeMidis} : {}),
      ...(controls.keyboard === undefined ? {} : {keyboard: controls.keyboard}),
      ...(controls.mapOnly === undefined ? {} : {mapOnly: controls.mapOnly}),
      ...(controls.octaveLabel === undefined ? {} : {octaveLabel: controls.octaveLabel}),
      ...(piano === undefined ? {} : {piano}),
      ...(controls.grid === undefined ? {} : {grid: noteGrid(controls.grid, base)}),
      ...(controls.gridColumns === undefined ? {} : {gridColumns: controls.gridColumns}),
      ...(controls.chords === undefined ? {} : {chords: noteChords(controls.chords, base)}),
    };
  };

  const binding: NoteSurfaceBinding = {
    snapshot: stateSnapshot,
    interaction: {
      setNote(midi, on) {
        if (on) held.add(midi);
        else held.delete(midi);
        notifier.notify();
      },
      midiForKey(code) {
        if (controls.layout === 'grid') {
          return noteGrid(controls.grid, baseMidi())?.find((cell) => cell.code === code)?.midi ?? null;
        }
        const key = NOTE_KEYS.find(([candidate]) => candidate === code);
        return key ? baseMidi() + key[1] : null;
      },
      canShiftOctave(delta) {
        const next = octave + delta;
        return next >= 2 && next <= 6;
      },
      requestOctaveShift(delta) {
        octave = Math.max(2, Math.min(6, octave + delta));
        controls.octaveLabel = `C${octave}–C${octave + 1}`;
        notifier.notify();
      },
    },
    subscribe: notifier.subscribe,
  };

  const remount = (): void => {
    presenter?.destroy();
    held.clear();
    presenter = mountNoteSurface(host, binding, noteOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed || !(name in INITIAL_NOTE_CONTROLS || name === 'activeMidis' || name === 'octaveLabel')) return;
      if (name === 'layout') {
        if (value !== 'piano' && value !== 'grid' && value !== 'chords') return;
        controls.layout = value;
      } else if (value === undefined) {
        delete controls[name];
      } else if (name === 'keyboard' || name === 'mapOnly') {
        controls[name] = value === true;
      } else if (name === 'gridColumns') {
        controls.gridColumns = Math.max(1, Math.floor(Number(value) || 1));
      } else {
        controls[name] = String(value);
      }
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
      controls = {...INITIAL_NOTE_CONTROLS};
      optionValues = {};
      octave = 4;
      held.clear();
      delete host.dataset.presenterDemoError;
      remount();
      notifier.notify();
    },
    snapshot: () => ({...controls}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      presenter?.destroy();
      presenter = undefined;
      held.clear();
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

/** Mount a real first-release UI presenter demo for Mixing & Capture or Notes. */
export function mountMixingNotesDemo(
  presenter: string,
  host: HTMLElement,
): UiPresenterDemoMountResult {
  switch (presenter) {
    case 'mixer':
      return mountMixerDemo(host);
    case 'meter':
      return mountMeterDemo(host);
    case 'recorder':
      return mountRecorderDemo(host);
    case 'note':
      return mountNoteDemo(host);
    default:
      return undefined;
  }
}
