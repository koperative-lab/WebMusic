import {claimHost, createErrorSink, createUpdateLoop, runCleanups} from './internal/lifecycle';
import {formatPercent, formatTime, readText, textValue, type UITextValue, type UIValueFormatters} from './text';
import {installStyle, paint} from './internal/style';
import {addClassNames, clamp01, finite, setParts} from './internal/dom';
import {createFader} from './fader';
import {createKnob} from './knob';
import {mountSurfaceSlider, type SurfaceSliderHandle} from './stage';
import {transportParts, transportStyle, transportTokens} from './styles';

/**
 * The transport's own stylesheet, and the shared fader its volume control is
 * built from. Both live in modules the kit does not publish, which made
 * `stylesheet: false` a promise with no way to keep it: the option says
 * "install the exported transport stylesheet yourself", and until now there was
 * no export to install.
 */
export {transportStyle, transportStateStyle} from './styles';
export {
  createFader,
  faderStyle,
  type FaderClassNames,
  type FaderHandle,
  type FaderOptions,
  type FaderParts,
} from './fader';
export {
  createKnob,
  knobStyle,
  type KnobClassNames,
  type KnobHandle,
  type KnobOptions,
  type KnobParts,
} from './knob';

export interface TransportState {
  playing: boolean;
  /** Normalized position. Omit when this binding has no progress readout. */
  progress?: number;
  seconds?: number;
  duration?: number;
  disabled?: boolean;
  /** Linear volume for the optional volume control. `1` when unreported. */
  volume?: number;
}

/** Structural presenter port. It owns no DOM or UI resource. */
export interface TransportBinding {
  snapshot(): TransportState;
  play(): Promise<void> | void;
  pause(): void;
  /** Omit for a play/pause-only or read-only progress binding. */
  seekFraction?(value: number): Promise<void> | void;
  /** Required by `showVolume`; a binding without it renders no volume control. */
  setVolume?(value: number): Promise<void> | void;
  /** Without a subscription, call the handle’s update() after external changes. */
  subscribe?(notify: () => void): () => void;
}

export interface TransportClassNames {
  root?: string;
  play?: string;
  track?: string;
  seek?: string;
  fill?: string;
  time?: string;
  volume?: string;
}

export interface TransportParts {
  root?: string;
  play?: string;
  track?: string;
  seek?: string;
  fill?: string;
  time?: string;
  volume?: string;
}

/** How much of the clock the readout carries. */
export type TransportTimeDisplay = 'elapsed' | 'full';

/** Which shape the volume control takes. */
export type TransportVolumeControl = 'fader' | 'knob';

export interface TransportPositionTextValues {
  elapsed: string;
  duration: string;
  progress: number;
  seconds?: number;
  durationSeconds?: number;
  seeking: boolean;
}

export interface TransportText {
  play?: string;
  pause?: string;
  label?: string;
  volume?: string;
  seek?: UITextValue<{label: string}>;
  progress?: UITextValue<{label: string}>;
  seekValue?: UITextValue<TransportPositionTextValues>;
  timeTotal?: UITextValue<{duration: string; durationSeconds?: number}>;
}

export interface TransportOptions {
  /** Application-supplied final text; call update() after external text changes. */
  getText?: () => TransportText;
  /** Borrowed pure formatters; UI does not own language selection. */
  formatters?: UIValueFormatters;
  /** Prefix used by the seek control's accessible name. */
  label?: string;
  /**
   * Show the clock when seconds or duration are reported. `'full'` (and `true`) reads `elapsed / total`; `'elapsed'`
   * drops the total, for a row with no space for it. Defaults to true.
   */
  showTime?: boolean | TransportTimeDisplay;
  /**
   * Render a volume control. `'fader'` (and `true`) is the horizontal fader;
   * `'knob'` is the rotary, for a row that has height but no width. Defaults to
   * false, because a transport over a binding with no `setVolume` has nothing
   * to move, and is ignored when the binding does not implement it.
   */
  showVolume?: boolean | TransportVolumeControl;
  /** Accessible name of the volume slider. Defaults to 'Volume'. */
  volumeLabel?: string;
  /**
   * Select the seek UI owned by the presenter. `native` renders an input
   * range, `surface` renders an ARIA slider with a fill element, and `false`
   * leaves the track empty. Defaults to `native` when seekFraction exists;
   * a binding without it always has a read-only track.
   */
  seekControl?: 'native' | 'surface' | false;
  /**
   * Render the native range seek input inside the track. Defaults to true.
   * With `seek: false` the presenter paints its progress custom properties on
   * the track instead and leaves the track empty, so a caller that owns its
   * own seeking UX may render it there.
   */
  seek?: boolean;
  /** Install the exported transport stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  /** Accessible name and title of the toggle while stopped. Defaults to 'Play'. */
  playLabel?: string;
  /** Accessible name and title of the toggle while playing. Defaults to 'Pause'. */
  pauseLabel?: string;
  /** Supplies the toggle's icon per state; defaults to the built-in glyphs. */
  icon?: (playing: boolean) => Node;
  /** Compatibility classes added alongside canonical `wui-*` classes. */
  classNames?: TransportClassNames;
  /** Additional CSS part tokens added alongside canonical part names. */
  parts?: TransportParts;
  /** Receives play, pause, seek, subscription and snapshot failures. */
  onError?: (error: unknown) => void;
}

/**
 * Named references to the nodes a mounted transport renders. This is the
 * stable public contract for reaching presenter DOM: consumers must use these
 * members instead of indexing into `element`'s children, whose order and
 * nesting may change in any release.
 */
export interface TransportControls {
  /** The play/pause toggle. */
  play: HTMLButtonElement;
  /** Progress track; hidden without timing data, read-only without seekFraction, empty with seek off. */
  track: HTMLDivElement;
  /** The native range seek input; defined only in `seekControl: 'native'` mode. */
  seek?: HTMLInputElement;
  /** Fill for surface seeking or a binding without seekFraction. */
  fill?: HTMLSpanElement;
  /** The clock readout; undefined when mounted with `showTime: false`. */
  time?: HTMLSpanElement;
  /** The elapsed half of the clock. */
  timeElapsed?: HTMLSpanElement;
  /**
   * The ` / total` half. Hide this node for an elapsed-only readout — that is
   * all `showTime: 'elapsed'` does, so a caller can switch between the two
   * without remounting.
   */
  timeTotal?: HTMLSpanElement;
  /**
   * The volume control — the kit's shared fader or knob, drawn from plain
   * nodes and carrying `.wui-transport__volume`. Defined only when
   * `showVolume` mounted one, and replaced in place by
   * {@link MountedTransportHandle.setVolumeControl}, so read it again after
   * calling that rather than holding on to the node.
   */
  volume?: HTMLDivElement;
}

export interface TransportHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

/** The handle `mountTransport` returns: the base lifecycle plus named nodes. */
export interface MountedTransportHandle extends TransportHandle {
  controls: TransportControls;
  /**
   * Swap the volume control, or take it away with `false`, without rebuilding
   * the rest of the row. A no-op when the control is already that shape, and
   * when the binding has no `setVolume` to move.
   */
  setVolumeControl(kind: false | TransportVolumeControl): void;
}

type TransportHost = HTMLElement | ShadowRoot;

/** One presenter per host; remounting disposes the previous binding first. */
const mountedTransports = new WeakMap<TransportHost, TransportHandle>();

const SVG_NS = 'http://www.w3.org/2000/svg';

function formatClock(value: unknown): string {
  const seconds = Math.max(0, finite(value));
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Create the canonical transport glyph for compatibility wrappers and custom controls. */
export function createTransportIcon(document: Document, playing: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // A presentation attribute, so `.wui-transport__play svg` still wins where the
  // stylesheet is installed. Mounts that opt out of it (`stylesheet: false`)
  // otherwise keep the SVG default fill — black glyph on a black button.
  svg.setAttribute('fill', 'currentColor');
  if (playing) {
    const left = document.createElementNS(SVG_NS, 'rect');
    left.setAttribute('x', '6');
    left.setAttribute('y', '4');
    left.setAttribute('width', '4');
    left.setAttribute('height', '16');
    const right = document.createElementNS(SVG_NS, 'rect');
    right.setAttribute('x', '14');
    right.setAttribute('y', '4');
    right.setAttribute('width', '4');
    right.setAttribute('height', '16');
    svg.append(left, right);
  } else {
    const play = document.createElementNS(SVG_NS, 'path');
    play.setAttribute('d', 'M7 4v16l13-8z');
    svg.append(play);
  }
  return svg;
}

/**
 * Mount the canonical accessible transport presenter.
 *
 * The function creates and owns only DOM/listener resources. The supplied
 * binding and its underlying player remain owned by the caller. The returned
 * handle's `controls` member is the stable way to reach the rendered nodes;
 * the tree between and around them is presenter-internal. Controls wrap to
 * their available container width in both stylesheet and inline modes.
 */
export function mountTransport(
  host: TransportHost,
  binding: TransportBinding,
  options: TransportOptions = {},
): MountedTransportHandle {

  const document = host.ownerDocument;
  const formatters = options.formatters;
  const canSeek = typeof binding.seekFraction === 'function';
  const seekControl = canSeek
    ? options.seekControl ?? (options.seek === false ? false : 'native')
    : false;
  const style = installStyle(document, 'transport', transportStyle, options.stylesheet);

  // A host that opts out of the stylesheet gets the same declarations written
  // onto its nodes: one source, two ways of wearing it. Painting only in this
  // mode keeps inline styles from overriding the rules of a host that DID
  // install the sheet.
  const inline = options.stylesheet === false;

  const root = document.createElement('div');
  root.className = 'wui-transport';
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'wui-transport__play';
  addClassNames(play, options.classNames?.play);
  setParts(play, 'play', options.parts?.play);

  const track = document.createElement('div');
  track.className = 'wui-transport__track';
  addClassNames(track, options.classNames?.track);
  setParts(track, 'track', options.parts?.track);

  const seek = seekControl === 'native' ? document.createElement('input') : undefined;
  if (seek) {
    seek.type = 'range';
    seek.min = '0';
    seek.max = '1000';
    seek.step = '1';
    seek.value = '0';
    seek.className = 'wui-transport__seek';
    seek.setAttribute('aria-label', `${options.label ?? 'Transport'} seek`);
    addClassNames(seek, options.classNames?.seek);
    setParts(seek, 'seek', options.parts?.seek);
    track.append(seek);
  }

  let fill: HTMLSpanElement | undefined;
  if (seekControl === 'surface') {
    track.classList.add('wui-transport__surface');
    addClassNames(track, options.classNames?.seek);
    setParts(
      track,
      'track seek',
      [options.parts?.track, options.parts?.seek].filter(Boolean).join(' '),
    );
  }
  if (seekControl === 'surface' || !canSeek) {
    fill = document.createElement('span');
    fill.className = 'wui-transport__fill';
    addClassNames(fill, options.classNames?.fill);
    setParts(fill, 'fill', options.parts?.fill);
    track.append(fill);
  }

  let time: HTMLSpanElement | undefined;
  let timeElapsed: HTMLSpanElement | undefined;
  let timeTotal: HTMLSpanElement | undefined;
  if (options.showTime !== false) {
    time = document.createElement('span');
    time.className = 'wui-transport__time';
    time.setAttribute('aria-live', 'off');
    addClassNames(time, options.classNames?.time);
    setParts(time, 'time', options.parts?.time);
    // Two nodes, not one string: `elapsed` and `full` differ only in whether
    // the second is visible, so switching between them is a style change
    // rather than a re-render. `textContent` still reads `0:00 / 3:20`.
    timeElapsed = document.createElement('span');
    timeElapsed.className = 'wui-transport__time-elapsed';
    setParts(timeElapsed, 'time-elapsed');
    timeTotal = document.createElement('span');
    timeTotal.className = 'wui-transport__time-total';
    setParts(timeTotal, 'time-total');
    if (options.showTime === 'elapsed') timeTotal.style.display = 'none';
    time.append(timeElapsed, timeTotal);
  }

  // A volume control is only honest over a binding that can act on it. Both
  // shapes are kit primitives with the same surface, so the transport holds
  // whichever one it built through this shared shape.
  interface VolumeControl {
    element: HTMLDivElement;
    readonly value: number;
    paint: (value: number, disabled?: boolean) => void;
    updateLabel: (label: string) => void;
    destroy: () => void;
  }
  let volumeFader: VolumeControl | undefined;
  const initialVolumeKind = options.showVolume === true ? 'fader' : (options.showVolume ?? false);
  let volumeKind: TransportVolumeControl | false = false;

  const buildVolume = (kind: TransportVolumeControl): VolumeControl | undefined => {
    if (!binding.setVolume) return undefined;
    const setVolume = binding.setVolume.bind(binding);
    const shared = {
      label: options.volumeLabel ?? 'Volume',
      formatValue: (value: number) => formatPercent(formatters, value, undefined, reportError),
      classNames: {root: ['wui-transport__volume', options.classNames?.volume].filter(Boolean).join(' ')},
      parts: {root: ['volume', options.parts?.volume].filter(Boolean).join(' ')},
      onError: (error: unknown) => reportError(error),
      onInput: (level: number) => {
        if (destroyed || readState().disabled || destroyed) return;
        try {
          void Promise.resolve(setVolume(level)).then(update).catch(reportError);
        } catch (error) {
          reportError(error);
        }
      },
    };
    const control =
      kind === 'knob'
        ? createKnob(document, shared)
        : createFader(document, {...shared, orientation: 'horizontal'});
    // The token feeds live in the `.wui-transport__volume` rule; a host with no
    // stylesheet needs them written onto the node instead. Painted here so a
    // swapped-in control is fed the same way the first one was.
    if (inline) paint(control.element, transportParts.volume);
    return control;
  };

  if (inline) {
    paint(root, transportTokens, transportParts.root);
    paint(play, transportParts.play);
    paint(track, transportParts.track);
    if (seekControl === 'surface') paint(track, transportParts.surface);
    if (seek) paint(seek, transportParts.seek);
    if (fill) paint(fill, transportParts.fill);
    if (time) paint(time, transportParts.time);
    if (timeElapsed) paint(timeElapsed, transportParts.timeSegment);
    if (timeTotal) paint(timeTotal, transportParts.timeSegment);
  }

  if (!canSeek) {
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
  }
  root.append(play, track);
  if (time) root.append(time);

  const listeners: Array<() => void> = [];
  let destroyed = false;
  let dragging = false;
  let draggingVolume = false;
  let surfaceSlider: SurfaceSliderHandle | undefined;
  let surfaceProgress = 0;
  let lastPlaying: boolean | undefined;

  const reportError = createErrorSink(options.onError);
  const progressOf = (state: TransportState): number => clamp01(
    state.progress ?? (finite(state.duration) > 0 ? finite(state.seconds) / finite(state.duration) : 0),
  );
  const clock = (seconds: number): string => formatTime(formatters, seconds, formatClock(seconds), reportError);
  const positionText = (copy: TransportText | undefined, progress: number, seconds: number | undefined, duration: number | undefined, seeking: boolean): string => {
    const elapsed = clock(seconds ?? 0);
    const total = clock(duration ?? 0);
    const fallback = (duration ?? 0) > 0 && !seeking ? `${elapsed} of ${total}` : formatPercent(formatters, progress, undefined, reportError);
    return textValue(copy?.seekValue, fallback, {
      elapsed, duration: total, progress, seconds, durationSeconds: duration, seeking,
    }, reportError);
  };

  const readState = (): TransportState => {
    try {
      return binding.snapshot();
    } catch (error) {
      reportError(error);
      return {playing: false, progress: 0, disabled: true};
    }
  };

  const renderIcon = (playing: boolean): Node => {
    if (options.icon) {
      try {
        return options.icon(playing);
      } catch (error) {
        reportError(error);
      }
    }
    return createTransportIcon(document, playing);
  };

  const paintProgress = (progress: number) => {
    const normalized = clamp01(progress);
    const percent = `${(normalized * 100).toFixed(1)}%`;
    // Without the native seek input the fill lands on the track instead.
    const target = seek ?? track;
    target.style.setProperty('--wui-progress', percent);
    // Compatibility with the first migrated Score element.
    target.style.setProperty('--cp-fill-pct', percent);
    if (fill) fill.style.width = `${Number((normalized * 100).toFixed(1))}%`;
  };

  // Capability-driven hiding must not take over the caller's display choices.
  // Score facades use the named nodes to toggle clock chrome without remounting.
  const visibilityForData = (node: HTMLElement | undefined): ((available: boolean) => void) => {
    let previous: {display: string; hidden: boolean} | undefined;
    return (available) => {
      if (!node) return;
      if (!available && !previous) {
        previous = {display: node.style.display, hidden: node.hidden};
        node.hidden = true;
        node.style.display = 'none';
      } else if (available && previous) {
        node.hidden = previous.hidden;
        node.style.display = previous.display;
        previous = undefined;
      }
    };
  };
  const showTrackForData = visibilityForData(track);
  const showTimeForData = visibilityForData(time);

  const updateLoop = createUpdateLoop({
    name: 'Transport',
    isCurrent: () => !destroyed,
    report: reportError,
    pass: () => {
      if (destroyed) return;
      const state = readState();
      if (destroyed) return;
      const copy = readText(options.getText, reportError);
      if (destroyed) return;
      const progress = progressOf(state);
      const playing = state.playing === true;
      const disabled = state.disabled === true;
      const duration = Math.max(0, finite(state.duration));
      const seconds = Math.max(0, finite(state.seconds, progress * duration));
      const displayedProgress = dragging
        ? seek ? Number(seek.value) / 1000 : surfaceProgress
        : progress;
      const action = playing
        ? options.pauseLabel ?? textValue(copy?.pause, 'Pause', {}, reportError)
        : options.playLabel ?? textValue(copy?.play, 'Play', {}, reportError);
      const label = options.label ?? textValue(copy?.label, 'Transport', {}, reportError);
      const accessibleSeekName = canSeek
        ? textValue(copy?.seek, `${label} seek`, {label}, reportError)
        : textValue(copy?.progress, `${label} progress`, {label}, reportError);
      const describedDuration = state.duration === undefined ? undefined : duration;
      const describedSeconds = dragging
        ? describedDuration === undefined ? undefined : displayedProgress * duration
        : state.seconds !== undefined || (state.progress !== undefined && describedDuration !== undefined) ? seconds : undefined;
      const accessibleSeekValue = positionText(copy, displayedProgress, describedSeconds, describedDuration, dragging);
      const elapsed = clock(seconds);
      const formattedDuration = clock(duration);
      const total = textValue(copy?.timeTotal, ` / ${formattedDuration}`, {duration: formattedDuration, durationSeconds: describedDuration}, reportError);
      const volumeLabel = options.volumeLabel ?? textValue(copy?.volume, 'Volume', {}, reportError);
      const icon = lastPlaying !== playing ? renderIcon(playing) : undefined;
      // Text/icon callbacks may destroy or replace this mount.
      if (destroyed) return;

      const hasPosition = state.progress !== undefined || state.seconds !== undefined || state.duration !== undefined;
      showTrackForData(hasPosition);
      showTimeForData(state.seconds !== undefined || state.duration !== undefined);
      if (seek && !dragging) seek.value = String(Math.round(progress * 1000));
      paintProgress(displayedProgress);
      play.disabled = disabled;
      if (seek) {
        seek.disabled = disabled;
        seek.setAttribute('aria-label', accessibleSeekName);
        seek.setAttribute('aria-valuetext', accessibleSeekValue);
      }
      if (seekControl === 'surface' || !canSeek) track.setAttribute('aria-label', accessibleSeekName);
      if (!canSeek) {
        track.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
        track.setAttribute('aria-valuetext', accessibleSeekValue);
      }
      play.setAttribute('aria-label', action);
      play.setAttribute('aria-pressed', String(playing));
      play.title = action;
      if (icon) {
        play.replaceChildren(icon);
        lastPlaying = playing;
      }
      if (timeElapsed) timeElapsed.textContent = elapsed;
      if (timeTotal) timeTotal.textContent = total;
      surfaceSlider?.update();
      if (destroyed) return;
      // Keep a drag authoritative until it ends, including across locale updates.
      if (volumeFader) {
        volumeFader.updateLabel(volumeLabel);
        volumeFader.paint(draggingVolume ? volumeFader.value : finite(state.volume, 1), disabled);
      }
    },
  });
  const update = (): void => {
    try { updateLoop.run(); } catch (error) { reportError(error); }
  };

  const listen = <T extends EventTarget>(target: T, type: string, listener: EventListener) => {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  };

  listen(play, 'click', (() => {
    if (destroyed) return;
    const state = readState();
    if (state.disabled || destroyed) return;
    try {
      if (state.playing) {
        binding.pause();
        update();
      } else {
        const pending = binding.play();
        update();
        void Promise.resolve(pending).then(update).catch(reportError);
      }
    } catch (error) {
      reportError(error);
    }
  }) as EventListener);

  if (seek) {
    listen(seek, 'pointerdown', (() => { dragging = true; }) as EventListener);
    const finishDragging = () => {
      dragging = false;
      update();
    };
    listen(seek, 'pointerup', finishDragging as EventListener);
    listen(seek, 'pointercancel', finishDragging as EventListener);
    listen(seek, 'change', finishDragging as EventListener);
    listen(seek, 'input', (() => {
      if (destroyed || readState().disabled || destroyed) return;
      const fraction = clamp01(Number(seek.value) / 1000);
      paintProgress(fraction);
      const state = readState();
      const duration = Math.max(0, finite(state.duration));
      const valueText = positionText(readText(options.getText, reportError), fraction, state.duration === undefined ? undefined : fraction * duration, state.duration === undefined ? undefined : duration, true);
      if (destroyed) return;
      seek.setAttribute('aria-valuetext', valueText);
      try {
        const pending = binding.seekFraction?.(fraction);
        void Promise.resolve(pending).then(update).catch(reportError);
      } catch (error) {
        reportError(error);
      }
    }) as EventListener);
  }

  const mountSeekSurface = (): void => {
    if (seekControl !== 'surface') return;
    // Pointer capture, keyboard and the whole ARIA value contract come from the
    // kit's own slider lifecycle. The domain is 0…100 so `aria-valuemax` stays
    // '100' and `aria-valuenow` stays a rounded percentage, exactly as before;
    // `commitOn: 'release'` keeps one seek per scrub rather than one per move.
    const slider = mountSurfaceSlider(
      track,
      {
        snapshot: () => {
          const state = readState();
          return {
            minimum: 0,
            maximum: 100,
            value: (dragging ? surfaceProgress : progressOf(state)) * 100,
            disabled: state.disabled === true,
          };
        },
        valueAt: (point) => (point.x / (point.rect.width || track.clientWidth || 1)) * 100,
        preview: (value) => {
          dragging = true;
          surfaceProgress = clamp01(value / 100);
          paintProgress(surfaceProgress);
        },
        commit: (value) => {
          if (destroyed || readState().disabled || destroyed) return;
          dragging = false;
          const fraction = clamp01(value / 100);
          surfaceProgress = fraction;
          paintProgress(fraction);
          try {
            const pending = binding.seekFraction?.(fraction);
            void Promise.resolve(pending).then(update).catch(reportError);
          } catch (error) {
            reportError(error);
          }
        },
      },
      {
        label: `${options.label ?? 'Transport'} seek`,
        commitOn: 'release',
        // Shift selects the coarse step the hand-rolled handler had.
        keyboardStep: (_state, event) => (event.shiftKey ? 10 : 5),
        formatValue: () => {
          const state = readState();
          const duration = Math.max(0, finite(state.duration));
          const progress = progressOf(state);
          const seconds = Math.max(0, finite(state.seconds, progress * duration));
          const describedDuration = state.duration === undefined ? undefined : duration;
          const describedSeconds = dragging
            ? describedDuration === undefined ? undefined : surfaceProgress * duration
            : state.seconds !== undefined || (state.progress !== undefined && describedDuration !== undefined) ? seconds : undefined;
          return positionText(readText(options.getText, reportError), dragging ? surfaceProgress : progress, describedSeconds, describedDuration, dragging);
        },
        onError: (error) => reportError(error),
      },
    );
    if (destroyed) {
      runCleanups([() => slider.destroy()], reportError);
      return;
    }
    surfaceSlider = slider;
    // The slider owns the drag; the presenter only needs to know when one ends,
    // so a snapshot repaint cannot fight a pointer that is still down.
    const endDrag = () => {
      dragging = false;
      update();
    };
    listen(track, 'pointerup', endDrag as EventListener);
    listen(track, 'pointercancel', endDrag as EventListener);
  };

  // Tracked apart from `listeners`, because swapping the control has to drop
  // exactly these three and nothing else.
  let volumeListeners: Array<() => void> = [];
  const wireVolume = (control: VolumeControl): void => {
    // The control owns the move itself; the presenter only has to know when a
    // drag is in flight, so a snapshot repaint cannot fight the pointer.
    const node = control.element;
    const start = (): void => {
      draggingVolume = true;
    };
    const finish = (): void => {
      draggingVolume = false;
      update();
    };
    node.addEventListener('pointerdown', start);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
    volumeListeners = [
      () => node.removeEventListener('pointerdown', start),
      () => node.removeEventListener('pointerup', finish),
      () => node.removeEventListener('pointercancel', finish),
    ];
  };
  const releaseVolume = (): void => {
    for (const remove of volumeListeners.splice(0)) remove();
    draggingVolume = false;
    volumeFader?.destroy();
    volumeFader?.element.remove();
    volumeFader = undefined;
  };

  let unsubscribe: (() => void) | undefined;

  const handle: MountedTransportHandle = {
    element: root,
    // `volume` is a getter: `setVolumeControl` replaces the node, and a plain
    // property would hand every later reader the one that was thrown away.
    controls: {
      play,
      track,
      seek,
      fill,
      time,
      timeElapsed,
      timeTotal,
      get volume() {
        return volumeFader?.element;
      },
    },
    setVolumeControl(kind: false | TransportVolumeControl): void {
      if (destroyed || kind === volumeKind) return;
      releaseVolume();
      if (destroyed) return;
      volumeKind = kind;
      if (kind) {
        const control = buildVolume(kind);
        if (destroyed) {
          runCleanups([() => control?.destroy()], reportError);
          return;
        }
        volumeFader = control;
      }
      if (!volumeFader) {
        volumeKind = false;
        return;
      }
      root.append(volumeFader.element);
      wireVolume(volumeFader);
      update();
    },
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      updateLoop.cancel();
      const releaseBinding = unsubscribe;
      unsubscribe = undefined;
      runCleanups([
        ...listeners.splice(0),
        ...volumeListeners.splice(0),
        () => surfaceSlider?.destroy(),
        () => volumeFader?.destroy(),
        releaseBinding,
        () => root.remove(),
        () => style?.remove(),
        () => claim.release(),
      ], reportError);
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mountedTransports, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) {
    handle.destroy();
    return handle;
  }

  if (style) host.append(style, root);
  else host.append(root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    handle.destroy();
    return handle;
  }

  // Subscribe and paint only once this mount owns the host, so the previous
  // transport's unsubscribe always runs before this one subscribes.
  mountSeekSurface();
  if (destroyed) return handle;
  if (initialVolumeKind) handle.setVolumeControl(initialVolumeKind);
  if (destroyed) return handle;
  try {
    const release = binding.subscribe?.(update);
    if (destroyed) runCleanups([release], reportError);
    else unsubscribe = release;
  } catch (error) {
    reportError(error);
  }
  update();
  return handle;
}
