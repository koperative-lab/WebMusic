import {
  createTransportIcon,
  mountTransport,
  transportStateStyle,
  type MountedTransportHandle,
  type TransportBinding,
  type TransportHandle,
} from '@webmusic/ui/transport';
import {type Note, type Score, type TimePosition} from '../../../core';
import type {HeadlessSynth} from '../../headless/audio-contracts';
import type {PlayerController} from '../../headless/controller';
import type {Effect} from '../../headless/effects';
import {reportPlaybackOperationFailure} from '../../headless/playback-events';
import type {Rack} from '../../headless/rack';
import {RackTransportController} from '../../headless/rack-transport';
import {ScorePlayer} from '../../headless/score-player';

/**
 * How much of the clock the chrome shows. `simple` is the elapsed time on its
 * own; `full` adds the total. The kit calls the first of those `elapsed` — the
 * word here is the one the `time-control` attribute uses.
 */
export type TimeControl = 'off' | 'simple' | 'full';

/** Which shape the volume control takes, or `off` for none. */
export type VolumeControl = 'off' | 'fader' | 'knob';

export interface PresetPlayerOptions {
  className?: string;
  playLabel?: string;
  pauseLabel?: string;
  /** How much of the clock to show. Defaults to `off`. */
  timeControl?: TimeControl;
  /** Which volume control to render, if any. Defaults to `off`. */
  volumeControl?: VolumeControl;
  /** Volume the slider starts at, and the value the engine already has. */
  volume?: number;
  /** Called when the slider moves, so the owner can keep its own value in step. */
  onVolumeChange?: (volume: number) => void;
  audioContext?: AudioContext;
  /** Custom synth backend (timbre). Defaults to the built-in oscillator synth. */
  synth?: HeadlessSynth;
  /** Post-processing effect chain. */
  effect?: Effect;
  /** Route the player's output into this node (e.g. an effect chain's input). */
  destination?: AudioNode;
  onCursor?: (position: TimePosition) => void;
  onNoteOn?: (note: Note) => void;
  onNoteOff?: (note: Note) => void;
  onPlay?: () => void;
  onPause?: () => void;
  /** Called after the built-in seek control moves the cursor, before any async playback restart settles. */
  onSeek?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}

export interface PresetPlayerHandle {
  element: HTMLDivElement;
  button: HTMLButtonElement;
  progress: HTMLDivElement;
  progressFill: HTMLSpanElement;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  destroy(): void;
  isPlaying(): boolean;
  /** Live transport seconds; optional for custom legacy handles. */
  readonly currentTime?: number;
  /** Live transport duration; Rack follows its longest built timeline member. */
  readonly duration?: number;
  /** The same fraction-seek command used by the mounted transport. */
  seekFraction?(fraction: number): void | Promise<void>;
  /**
   * Show or hide optional chrome in place. Rebuilding the transport for a
   * display flag would restart the piece, so the nodes are mounted once and
   * only their visibility moves. A part the mount did not create is ignored.
   */
  setChrome(chrome: {time?: TimeControl; volume?: VolumeControl}): void;
  /** The underlying engine (score path only; undefined for a rack-driven handle). */
  player?: ScorePlayer;
  /** Optional for compatibility with existing custom mount handles. */
  seek?(seconds: number): void | Promise<void>;
}

export interface RackPlayerOptions {
  className?: string;
  playLabel?: string;
  pauseLabel?: string;
  /** How much of the clock to show. Defaults to `off`. */
  timeControl?: TimeControl;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}

export interface ControllerPlayerOptions {
  className?: string;
  playLabel?: string;
  pauseLabel?: string;
  /** How much of the clock to show. Defaults to `off`. */
  timeControl?: TimeControl;
  onError?: (error: unknown) => void;
}

interface CompatibilityTransport {
  presenter: TransportHandle;
  element: HTMLDivElement;
  button: HTMLButtonElement;
  progress: HTMLDivElement;
  progressFill: HTMLSpanElement;
  setChrome(chrome: {time?: TimeControl; volume?: VolumeControl}): void;
  update(): void;
  destroy(): void;
}

function notifyPlayError(source: string, callback: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    callback?.(error);
  } catch (callbackError) {
    reportPlaybackOperationFailure(source, 'onError callback', callbackError);
  }
}

/**
 * Mount the shared UI Kit transport while retaining every historic imperative
 * DOM hook and CSS token exposed by mountPresetPlayer/mountRackPlayer.
 */
function mountCompatibilityTransport(
  container: HTMLElement,
  binding: TransportBinding,
  options: {
    className?: string;
    label: string;
    playLabel: string;
    pauseLabel: string;
    timeControl?: TimeControl;
    volumeControl?: VolumeControl;
    source: 'PresetPlayer' | 'RackPlayer' | 'ControllerPlayer';
  },
): CompatibilityTransport {
  const previousChildren = Array.from(container.childNodes);
  let presenter: MountedTransportHandle | undefined;
  let stateStyle: HTMLStyleElement | undefined;
  let destroyed = false;

  try {
    // The public facade historically owned the container contents. Keep that
    // behavior even though mountTransport itself intentionally preserves peers.
    container.replaceChildren();
    presenter = mountTransport(container, binding, {
      label: options.label,
      // The clock is mounted whatever the caller asked for: the facade moves
      // `display` instead, so revealing a readout cannot restart the piece.
      // The volume control is built on demand — swapping one control does not
      // touch the rest of the row, and an unasked-for one would just be
      // destroyed a line later.
      showTime: true,
      showVolume: false,
      seekControl: 'surface',
      stylesheet: false,
      playLabel: options.playLabel,
      pauseLabel: options.pauseLabel,
      icon: (playing) => createPlayerIconIn(container.ownerDocument, playing ? 'pause' : 'play'),
      classNames: {
        root: ['webscore-play-preset', options.className].filter(Boolean).join(' '),
        play: 'webscore-play-preset__button',
        track: 'webscore-play-preset__progress',
        fill: 'webscore-play-preset__progress-fill',
        time: 'webscore-play-preset__time',
        volume: 'webscore-play-preset__volume',
      },
      onError: (error) => reportPlaybackOperationFailure(options.source, 'transport presenter', error),
    });

    const element = presenter.element as HTMLDivElement;
    // Named accessors are the presenter's stable node contract — never reach
    // into `element`'s children by index.
    // `volume` is deliberately not destructured: the control is built on
    // demand and replaced on a swap, so it is read back through the handle.
    const {play: button, track: progress, fill: progressFill, time} = presenter.controls;
    if (!progressFill) {
      throw new Error('The UI Kit surface transport did not provide its progress fill control.');
    }

    element.dataset.webscorePlayPreset = '';
    // Geometry stays with the inline presenter; pseudo-class feedback comes
    // from the same UIKit stylesheet used by its normal mounts.
    stateStyle = container.ownerDocument.createElement('style');
    stateStyle.dataset.webmusicUi = 'transport-state';
    stateStyle.textContent = transportStateStyle;
    element.append(stateStyle);

    // The ONLY thing this facade owns about the transport's appearance: which
    // of its own `--webscore-play-*` variables feed which of the kit's `--cp-*`
    // compatibility tokens. Every property those tokens end up painting is
    // declared once, in @webmusic/ui's `transportParts`, and painted by the
    // presenter itself — this element mounts with `stylesheet: false`, so the
    // kit writes the box inline. Only its focus/disabled stylesheet is mounted
    // alongside it. Re-declaring geometry here is what put a border on
    // the seek bar in two packages at once.
    const bridge: Record<string, string> = {
      '--cp-gap': 'var(--webscore-play-gap, var(--wm-control-gap, 0.75rem))',
      '--cp-height':
        'var(--webscore-play-height, var(--wm-transport-height, var(--wm-control-size, 2rem)))',
      '--cp-button-width': 'var(--webscore-play-button-width, var(--cp-height))',
      '--cp-button-height': 'var(--webscore-play-button-height, var(--cp-height))',
      '--cp-track-height': 'var(--webscore-play-progress-height, var(--cp-height))',
      '--cp-button-bg':
        'var(--webscore-play-button-bg, var(--wm-transport-button-background, var(--wm-accent, #111)))',
      '--cp-button-color':
        'var(--webscore-play-button-color, var(--wm-transport-button-foreground, var(--wm-accent-foreground, #fff)))',
      '--cp-button-border':
        'var(--webscore-play-button-border, var(--wm-transport-border, var(--wm-border, #111)))',
      '--cp-track':
        'var(--webscore-play-progress-bg, var(--wm-transport-track, var(--wm-surface-muted, #f3f3f3)))',
      '--cp-fill':
        'var(--webscore-play-progress-fill, var(--wm-transport-fill, var(--wm-accent, #999)))',
      '--cp-text':
        'var(--webscore-play-time-color, var(--wm-transport-foreground, var(--wm-foreground-muted, var(--wm-foreground, #444))))',
      '--cp-time-font':
        'var(--webscore-play-time-font, 0.85rem/1.2 var(--wm-font-family, system-ui, sans-serif))',
      '--cp-volume-width': 'var(--webscore-play-volume-width, var(--wm-transport-volume-width, 4.5rem))',
      '--cp-volume-height': 'var(--webscore-play-volume-height, var(--cp-track-height))',
      '--cp-volume-size': 'var(--webscore-play-volume-size, var(--cp-track-height))',
      '--cp-volume-thumb':
        'var(--webscore-play-volume-thumb, var(--wm-transport-thumb, var(--wm-foreground, #111)))',
    };
    for (const [name, value] of Object.entries(bridge)) {
      element.style.setProperty(name, value);
    }

    const mounted = presenter;
    const {timeTotal} = mounted.controls;
    const timeDisplay = time?.style.display ?? '';
    const totalDisplay = timeTotal?.style.display ?? '';
    const setChrome = (chrome: {time?: TimeControl; volume?: VolumeControl}): void => {
      if (time && chrome.time !== undefined) {
        time.style.display = chrome.time === 'off' ? 'none' : timeDisplay;
        // `simple` and `full` differ by one node, so the switch is a style
        // change on a mounted readout rather than a remount that would
        // restart the piece.
        if (timeTotal) timeTotal.style.display = chrome.time === 'simple' ? 'none' : totalDisplay;
      }
      if (chrome.volume !== undefined) {
        // The presenter feeds a swapped-in control its own token block, so
        // there is nothing for this facade to re-apply afterwards.
        mounted.setVolumeControl(chrome.volume === 'off' ? false : chrome.volume);
      }
    };
    // Everything starts hidden unless asked for, so the historic chrome is
    // unchanged for a caller that sets neither.
    setChrome({time: options.timeControl ?? 'off', volume: options.volumeControl ?? 'off'});

    // The fill is painted by the presenter from `--cp-fill`, which the bridge
    // above already points at `--webscore-play-progress-fill`.
    const mountedPresenter = presenter;
    mountedPresenter.update();

    const handle: CompatibilityTransport = {
      presenter: mountedPresenter,
      element,
      button,
      progress,
      progressFill,
      setChrome,
      // A facade-driven refresh repaints the presenter (labels, icon, disabled
      // state); its snapshot read syncs the compatibility slider in one pass.
      update: () => mountedPresenter.update(),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        try { presenter?.destroy(); }
        finally { stateStyle?.remove(); }
      },
    };
    return handle;
  } catch (error) {
    destroyed = true;
    stateStyle?.remove();
    try {
      presenter?.destroy();
    } catch (cleanupError) {
      reportPlaybackOperationFailure(options.source, 'failed presenter mount rollback', cleanupError);
    }
    try {
      container.replaceChildren(...previousChildren);
    } catch (cleanupError) {
      reportPlaybackOperationFailure(options.source, 'failed container mount rollback', cleanupError);
    }
    throw error;
  }
}

/**
 * Compatibility facade for a score transport. Scheduling remains in the
 * DOM-free ScorePlayer; DOM, accessibility and input behavior come from
 * @webmusic/ui's shared transport presenter.
 */
export function mountPresetPlayer(
  score: Score,
  container: HTMLElement,
  options: PresetPlayerOptions = {},
): PresetPlayerHandle {
  const player = new ScorePlayer(score, {
    audioContext: options.audioContext,
    synth: options.synth,
    effect: options.effect,
    destination: options.destination,
  });
  const subscribers = new Set<() => void>();
  const playerUnsubscribes: Array<() => void> = [];
  let starting = false;
  let startingErrors: Set<unknown> | undefined;
  let playGeneration = 0;
  let destroyed = false;
  let displayProgress: number | undefined;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  // The engine has no volume read-back, so the chrome's slider position is
  // tracked here and seeded from whatever the owner already applied.
  let volumeState = Math.max(0, options.volume ?? 1);

  const notify = () => {
    for (const subscriber of [...subscribers]) {
      try {
        subscriber();
      } catch (error) {
        reportPlaybackOperationFailure('PresetPlayer', 'transport subscriber', error);
      }
    }
  };
  const clearReset = () => {
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    resetTimer = undefined;
  };

  playerUnsubscribes.push(
    player.on('operationError', ({error}) => {
      if (destroyed) return;
      startingErrors?.add(error);
      notifyPlayError('PresetPlayer', options.onError, error);
    }),
    player.on('cursor', (position) => options.onCursor?.(position)),
    player.on('timeupdate', () => {
      displayProgress = undefined;
      notify();
    }),
    player.on('noteOn', (note) => options.onNoteOn?.(note)),
    player.on('noteOff', (note) => options.onNoteOff?.(note)),
    player.on('end', () => {
      const generation = ++playGeneration;
      starting = false;
      clearReset();
      notify();
      try {
        options.onEnd?.();
      } finally {
        // An end callback may synchronously replay or destroy the facade. Never
        // let the old pass arm a reset timer against that newer generation.
        if (!destroyed && generation === playGeneration) {
          resetTimer = setTimeout(() => {
            resetTimer = undefined;
            if (destroyed || generation !== playGeneration) return;
            displayProgress = 0;
            notify();
          }, 180);
        }
      }
    }),
  );

  const play = async () => {
    if (destroyed || starting || player.isPlaying()) return;
    clearReset();
    displayProgress = undefined;
    const generation = ++playGeneration;
    const reportedErrors = new Set<unknown>();
    startingErrors = reportedErrors;
    starting = true;
    notify();
    try {
      options.onPlay?.();
      // onPlay is application code and may synchronously pause, stop or destroy
      // this facade. Do not start a fresh backend after that newer command.
      if (generation !== playGeneration || destroyed || !starting) return;
      // ScorePlayer resumes the context before awaiting sample preparation,
      // preserving user activation from a presenter click.
      await player.play();
      if (generation !== playGeneration || destroyed) return;
    } catch (error) {
      if (generation !== playGeneration || destroyed) return;
      // Graph rollback can report the same failure through operationError
      // before play() rejects. Keep the facade notification singular.
      if (!reportedErrors.has(error)) notifyPlayError('PresetPlayer', options.onError, error);
      throw error;
    } finally {
      if (startingErrors === reportedErrors) startingErrors = undefined;
      if (generation === playGeneration) {
        starting = false;
        notify();
      }
    }
  };
  const pause = () => {
    if (!starting && !player.isPlaying()) return;
    playGeneration += 1;
    starting = false;
    player.pause();
    notify();
    options.onPause?.();
  };
  const stop = () => {
    playGeneration += 1;
    starting = false;
    clearReset();
    displayProgress = 0;
    player.stop();
    notify();
  };
  const seekFraction = async (fraction: number): Promise<void> => {
    if (destroyed) return;
    clearReset();
    displayProgress = undefined;
    const pending = player.seekFraction(fraction);
    try {
      // Seeking publishes a cursor synchronously, and a cursor listener can
      // replace this facade before the command returns.
      if (!destroyed) options.onSeek?.();
    } catch (error) {
      reportPlaybackOperationFailure('PresetPlayer', 'onSeek callback', error);
    }
    // A callback failure must not abandon the pending engine operation. The
    // transport presenter owns rejection reporting for this UI command.
    await pending;
  };
  const seek = (seconds: number) => {
    if (destroyed) return;
    clearReset();
    displayProgress = undefined;
    return player.seek(seconds);
  };

  const binding: TransportBinding = {
    snapshot: () => ({
      playing: starting || player.isPlaying(),
      progress: displayProgress ?? player.progress,
      seconds: player.seconds,
      duration: player.durationSeconds,
      volume: volumeState,
    }),
    play,
    pause,
    seekFraction,
    setVolume: (level) => {
      volumeState = Math.max(0, level);
      player.setVolume(volumeState);
      notify();
      try {
        options.onVolumeChange?.(volumeState);
      } catch (error) {
        reportPlaybackOperationFailure('PresetPlayer', 'onVolumeChange callback', error);
      }
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
  let transport: CompatibilityTransport;
  try {
    transport = mountCompatibilityTransport(container, binding, {
      className: options.className,
      label: 'Score player',
      playLabel: options.playLabel ?? 'Play',
      pauseLabel: options.pauseLabel ?? 'Pause',
      timeControl: options.timeControl,
      volumeControl: options.volumeControl,
      source: 'PresetPlayer',
    });
  } catch (error) {
    destroyed = true;
    playGeneration += 1;
    starting = false;
    clearReset();
    for (const unsubscribe of playerUnsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch (cleanupError) {
        reportPlaybackOperationFailure('PresetPlayer', 'failed mount unsubscribe', cleanupError);
      }
    }
    subscribers.clear();
    try {
      player.dispose();
    } catch (cleanupError) {
      reportPlaybackOperationFailure('PresetPlayer', 'failed mount player.dispose', cleanupError);
    }
    throw error;
  }

  return {
    element: transport.element,
    button: transport.button,
    progress: transport.progress,
    progressFill: transport.progressFill,
    setChrome: (chrome) => transport.setChrome(chrome),
    player,
    get currentTime() { return player.seconds; },
    get duration() { return player.durationSeconds; },
    seek,
    seekFraction,
    play,
    pause,
    stop,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      playGeneration += 1;
      starting = false;
      clearReset();
      let cleanupError: unknown;
      try {
        transport.destroy();
      } catch (error) {
        cleanupError ??= error;
      }
      for (const unsubscribe of playerUnsubscribes.splice(0)) {
        try {
          unsubscribe();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      subscribers.clear();
      try {
        player.dispose();
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError !== undefined) throw cleanupError;
    },
    isPlaying() {
      return player.isPlaying();
    },
  };
}

/**
 * Compatibility facade for a borrowed Rack. All transport policy lives in the
 * DOM-free RackTransportController; this function only connects it to UI Kit.
 */
export function mountRackPlayer(
  rack: Rack,
  container: HTMLElement,
  options: RackPlayerOptions = {},
): PresetPlayerHandle {
  const controller = new RackTransportController(rack);
  const controllerUnsubscribes: Array<() => void> = [];
  let destroyed = false;
  let starting = false;
  let playGeneration = 0;
  let displayProgress: number | undefined;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let lastControllerError: unknown;
  let transport!: CompatibilityTransport;

  const clearReset = () => {
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    resetTimer = undefined;
  };

  controllerUnsubscribes.push(
    controller.on('end', () => {
      const generation = ++playGeneration;
      starting = false;
      clearReset();
      try {
        options.onEnd?.();
      } finally {
        if (!destroyed && generation === playGeneration) {
          resetTimer = setTimeout(() => {
            resetTimer = undefined;
            if (destroyed || generation !== playGeneration) return;
            displayProgress = 0;
            transport.update();
          }, 180);
        }
      }
    }),
    controller.on('error', (error) => {
      lastControllerError = error;
      notifyPlayError('RackPlayer', options.onError, error);
    }),
  );

  const play = async () => {
    if (destroyed || starting || controller.playing) return;
    clearReset();
    displayProgress = undefined;
    lastControllerError = undefined;
    const generation = ++playGeneration;
    starting = true;
    try {
      options.onPlay?.();
      if (generation !== playGeneration || destroyed || !starting) return;
      await controller.play();
    } catch (error) {
      if (generation !== playGeneration || destroyed) return;
      if (error !== lastControllerError) notifyPlayError('RackPlayer', options.onError, error);
      throw error;
    } finally {
      if (generation === playGeneration) {
        starting = false;
        transport?.update();
      }
    }
  };
  const pause = () => {
    if (!starting && !controller.playing) return;
    playGeneration += 1;
    starting = false;
    controller.pause();
    transport?.update();
    options.onPause?.();
  };
  const stop = () => {
    playGeneration += 1;
    starting = false;
    clearReset();
    displayProgress = 0;
    controller.stop();
  };

  const binding: TransportBinding = {
    snapshot: () => {
      const state = controller.snapshot;
      return {
        playing: starting || state.playing,
        progress: displayProgress ?? state.progress,
        seconds: state.currentTime,
        duration: state.duration,
      };
    },
    play,
    pause,
    seekFraction: (fraction) => {
      clearReset();
      displayProgress = undefined;
      controller.seekFraction(fraction);
    },
    subscribe: (notify) => {
      const unsubscribes = [controller.on('timeupdate', notify), controller.on('transportchange', notify)];
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
  };
  try {
    transport = mountCompatibilityTransport(container, binding, {
      className: options.className,
      label: 'Rack player',
      playLabel: options.playLabel ?? 'Play',
      pauseLabel: options.pauseLabel ?? 'Pause',
      timeControl: options.timeControl,
      source: 'RackPlayer',
    });
  } catch (error) {
    destroyed = true;
    playGeneration += 1;
    starting = false;
    clearReset();
    for (const unsubscribe of controllerUnsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch (cleanupError) {
        reportPlaybackOperationFailure('RackPlayer', 'failed mount unsubscribe', cleanupError);
      }
    }
    try {
      controller.destroy();
    } catch (cleanupError) {
      reportPlaybackOperationFailure('RackPlayer', 'failed mount controller.destroy', cleanupError);
    }
    throw error;
  }

  return {
    element: transport.element,
    button: transport.button,
    progress: transport.progress,
    progressFill: transport.progressFill,
    setChrome: (chrome) => transport.setChrome(chrome),
    get currentTime() { return controller.snapshot.currentTime; },
    get duration() { return controller.snapshot.duration; },
    seek(seconds) {
      if (destroyed) return;
      clearReset();
      displayProgress = undefined;
      controller.seek(seconds);
    },
    seekFraction(fraction) {
      if (destroyed) return;
      clearReset();
      displayProgress = undefined;
      controller.seekFraction(fraction);
    },
    play,
    pause,
    stop,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      playGeneration += 1;
      starting = false;
      clearReset();
      let cleanupError: unknown;
      // The historic compatibility facade always stopped its transport on a
      // successful destroy. Keep that promise here; the headless controller's
      // own destroy remains conservative for failed mounts and other borrowers.
      try {
        controller.stop();
      } catch (error) {
        cleanupError ??= error;
      }
      try {
        transport.destroy();
      } catch (error) {
        cleanupError ??= error;
      }
      for (const unsubscribe of controllerUnsubscribes.splice(0)) {
        try {
          unsubscribe();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      try {
        controller.destroy();
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError !== undefined) throw cleanupError;
    },
    isPlaying() {
      return starting || controller.playing;
    },
  };
}

/**
 * Compatibility facade over a borrowed {@link PlayerController}: the same
 * preset transport chrome, with no engine ownership. The caller keeps the
 * controller (and its player) alive — `destroy()` only unmounts the UI and
 * releases the subscriptions, and playback state is never pushed onto the
 * controller at mount time.
 */
export function mountControllerPlayer(
  controller: PlayerController,
  container: HTMLElement,
  options: ControllerPlayerOptions = {},
): PresetPlayerHandle {
  const controllerUnsubscribes: Array<() => void> = [];
  let destroyed = false;

  controllerUnsubscribes.push(
    controller.on('error', (error) => notifyPlayError('ControllerPlayer', options.onError, error)),
  );

  const binding: TransportBinding = {
    snapshot: () => ({
      playing: controller.playing,
      progress: controller.progress,
      seconds: controller.currentTime,
      duration: controller.duration,
    }),
    play: () => controller.play(),
    pause: () => controller.pause(),
    seekFraction: (fraction) => controller.seekFraction(fraction),
    subscribe: (notify) => {
      const unsubscribes = [
        controller.on('timeupdate', notify),
        controller.on('transportchange', notify),
        controller.on('error', () => notify()),
      ];
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
  };
  let transport: CompatibilityTransport;
  try {
    transport = mountCompatibilityTransport(container, binding, {
      className: options.className,
      label: 'Controller player',
      playLabel: options.playLabel ?? 'Play',
      pauseLabel: options.pauseLabel ?? 'Pause',
      timeControl: options.timeControl,
      source: 'ControllerPlayer',
    });
  } catch (error) {
    destroyed = true;
    for (const unsubscribe of controllerUnsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch (cleanupError) {
        reportPlaybackOperationFailure('ControllerPlayer', 'failed mount unsubscribe', cleanupError);
      }
    }
    throw error;
  }

  return {
    element: transport.element,
    button: transport.button,
    progress: transport.progress,
    progressFill: transport.progressFill,
    setChrome: (chrome) => transport.setChrome(chrome),
    get currentTime() { return controller.currentTime; },
    get duration() { return controller.duration; },
    seekFraction: (fraction) => { if (!destroyed) controller.seekFraction(fraction); },
    seek: (seconds) => { if (!destroyed) controller.seek(seconds); },
    // Failures surface through the controller's own 'error' channel, so the
    // returned promise resolves like every other controller-initiated play.
    play: async () => controller.play(),
    pause: () => controller.pause(),
    stop: () => controller.stop(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      let cleanupError: unknown;
      try {
        transport.destroy();
      } catch (error) {
        cleanupError ??= error;
      }
      for (const unsubscribe of controllerUnsubscribes.splice(0)) {
        try {
          unsubscribe();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError !== undefined) throw cleanupError;
    },
    isPlaying() {
      return controller.playing;
    },
  };
}

function createPlayerIconIn(document: Document, state: 'play' | 'pause'): SVGSVGElement {
  const svg = createTransportIcon(document, state === 'pause');
  svg.setAttribute('class', 'webscore-play-preset__icon');
  svg.setAttribute('width', 'var(--webscore-play-icon-size, 1.25rem)');
  svg.setAttribute('height', 'var(--webscore-play-icon-size, 1.25rem)');
  return svg;
}

/** Historic standalone icon helper retained for source compatibility. */
export function createPlayerIcon(state: 'play' | 'pause'): SVGSVGElement {
  return createPlayerIconIn(document, state);
}
