// ============================================================================
// Sound — stable timbre facade and lifecycle wrapper. Concrete synthesis,
// sampling, MIDI, Tone and optional SF2 adapters live in focused modules under
// ./sounds; consumers continue importing everything from this file via /headless.
// ============================================================================

import {OscillatorSynth} from './oscillator-synth';
import {SoundfontSynth} from './soundfont-synth';
import {isHeadlessSynth, toneAdapter} from './sounds/adapters';
import type {
  FmOptions,
  HeadlessSynth,
  MidiOutOptions,
  NoiseOptions,
  OscillatorSynthOptions,
  SfzOptions,
  SoundBackend,
  SoundBackendFactory,
  Soundfont2Options,
  SoundfontSample,
  SoundfontSynthOptions,
  SoundOptions,
  ToneInstrumentLike,
  WavetableOptions,
} from './sounds/contracts';
import {MidiOutBackend} from './sounds/midi-out';
import {RangeSampler} from './sounds/range-sampler';
import {SpessaSoundBackend} from './sounds/spessa';
import {FmBackend, NoiseBackend, WavetableBackend} from './sounds/synthesis';
import {
  cancelBinaryResponseBody,
  positiveSafeIntegerOption,
  readBoundedResponse,
} from './resource-loading';

/** One active Sound-to-destination route. Sound has one event-facing backend,
 * so independent concurrent routes cannot be selected correctly by noteOn(). */
interface ActiveSoundRoute {
  backend: SoundBackend;
  gain: GainNode;
  destination: AudioNode;
  backendRoute?: () => void;
  released: boolean;
}

const GLOBAL_TEARDOWN_BEFORE_ROUTE = Symbol('webscore.sound.global-teardown-before-route');
const CONNECT_FAILURE_IS_ROLLED_BACK = Symbol('webscore.sound.connect-failure-rolled-back');
type OrderedTeardownBackend = SoundBackend & {
  [GLOBAL_TEARDOWN_BEFORE_ROUTE]?: boolean;
  [CONNECT_FAILURE_IS_ROLLED_BACK]?: boolean;
};

export {RangeSampler, chooseZone, playbackRateFor} from './sounds/range-sampler';
export type {
  FmOptions,
  MidiOutOptions,
  MidiOutputLike,
  NoiseOptions,
  SampleZone,
  SfzOptions,
  Soundfont2Options,
  SoundOptions,
  ToneInstrumentLike,
  WavetableOptions,
} from './sounds/contracts';

/**
 * Lazy, context-aware wrapper around any HeadlessSynth backend. Every backend
 * is routed through a private gain bus, giving players one consistent timbre
 * contract with live per-voice gain and asynchronous readiness.
 */
export class Sound implements HeadlessSynth {
  private readonly factory: SoundBackendFactory;
  private backend?: SoundBackend;
  private gain?: GainNode;
  private context?: AudioContext;
  private activeRoute?: ActiveSoundRoute;
  /** A raw external backend that supplied no destination-specific cleanup. */
  private reconnectBlockedBackend?: SoundBackend;
  private loaded?: Promise<void>;
  private lastLoadError?: unknown;
  private gainValue: number;
  private setup?: (
    backend: SoundBackend,
    context: AudioContext,
  ) => Promise<void> | void;

  private constructor(factory: SoundBackendFactory, options: SoundOptions = {}) {
    this.factory = factory;
    this.gainValue = options.gain ?? 1;
  }

  /** Built-in oscillator synth — the simplest custom synthesis timbre. */
  static oscillator(
    options: OscillatorSynthOptions = {},
    sound: SoundOptions = {},
  ): Sound {
    return new Sound((context) => new OscillatorSynth(context, options), sound);
  }

  /** One audio sample per exact MIDI note. */
  static samples(
    map: Record<number | string, SoundfontSample>,
    options: Omit<SoundfontSynthOptions, 'samples'> = {},
    sound: SoundOptions = {},
  ): Sound {
    return new Sound(
      (context) => new SoundfontSynth(context, {...options, samples: map}),
      sound,
    );
  }

  /** Load a key-ranged, pitch-shifted sampler from an SFZ instrument. */
  static sfz(url: string, options: SfzOptions = {}): Sound {
    return new Sound(
      (context) => new RangeSampler(context, options),
      options,
    ).withAsyncSetup(async (backend, context) => {
      const {parseSfz, resolveSfzZones} = await import('../core/sfz');
      const maxSfzBytes = positiveSafeIntegerOption('Sound.sfz', 'maxSfzBytes', options.maxSfzBytes, 1_000_000);
      const response = await fetch(url);
      if (!response.ok) {
        cancelBinaryResponseBody(response.body, `Sound.sfz request failed for ${url}`);
        throw new Error(`Sound.sfz: failed to load ${url} (${response.status})`);
      }
      const bytes = await readBoundedResponse(response, maxSfzBytes, `Sound.sfz: ${url}`, 'maxSfzBytes');
      const text = new TextDecoder().decode(bytes);
      const zones = resolveSfzZones(
        parseSfz(text, {maxInputCharacters: maxSfzBytes, maxRegions: options.maxZones}),
        url,
        {maxRegions: options.maxZones},
      );
      await (backend as RangeSampler).loadZones(zones, context);
    });
  }

  /** Load an SF2/SF3 SoundFont through the optional spessasynth_lib peer. */
  static soundfont2(
    source: string | ArrayBuffer,
    options: Soundfont2Options = {},
  ): Sound {
    // A worklet synth has one mutable destination. Make it per-route so a
    // sequential reconnect never inherits a stale, detached worklet graph.
    return new Sound(
      () => new SpessaSoundBackend(
        source,
        options.channel ?? 0,
        options.program ?? 0,
        options.workletUrl,
        options.registerWorklet,
        options.maxSoundFontBytes,
      ),
      options,
    );
  }

  /** Adopt a Tone.js-style instrument or an existing HeadlessSynth. */
  static from(
    instrument: HeadlessSynth | ToneInstrumentLike,
    sound: SoundOptions = {},
  ): Sound {
    if (isHeadlessSynth(instrument)) {
      return new Sound(() => instrument as SoundBackend, sound);
    }
    return new Sound(() => toneAdapter(instrument), sound);
  }

  /** Use a backend instance or a context-aware backend factory. */
  static custom(
    implementation: HeadlessSynth | ((context: AudioContext) => HeadlessSynth),
    sound: SoundOptions = {},
  ): Sound {
    const factory = typeof implementation === 'function'
      ? implementation as SoundBackendFactory
      : () => implementation as SoundBackend;
    return new Sound(factory, sound);
  }

  /** Stack several timbres into one voice. */
  static layer(...sounds: Sound[]): Sound {
    if (new Set(sounds).size !== sounds.length) {
      throw new Error(
        'Sound.layer requires distinct Sound instances. Create separate Sounds to double a timbre.',
      );
    }
    return new Sound(() => ({
      // A borrowed layer route only detaches its children. Explicit global
      // disconnect/dispose must reach the child backends while those child
      // Sounds still retain their active-route state, so the Sound wrapper
      // performs this composite backend's global teardown before its stale
      // outer route callback.
      [GLOBAL_TEARDOWN_BEFORE_ROUTE]: true,
      [CONNECT_FAILURE_IS_ROLLED_BACK]: true,
      connect: (destination) => {
        const cleanups: Array<() => void> = [];
        try {
          for (const sound of sounds) cleanups.push(sound.connect(destination));
        } catch (error) {
          // Layer wiring is transactional: do not leave earlier child Sounds
          // attached if a later child rejects its route.
          try {
            releaseRouteCleanups(cleanups);
          } catch {
            // Preserve the original connection failure.
          }
          throw error;
        }
        return () => releaseRouteCleanups(cleanups);
      },
      disconnect: () => runLayerOperations(sounds, (sound) => sound.disconnect()),
      get supportsScheduledCancellation() {
        return sounds.length > 0 && sounds.every((sound) => sound.supportsScheduledCancellation);
      },
      noteOn: (midi, velocity, time, duration) => {
        const handles: unknown[] = [];
        try {
          for (const sound of sounds) {
            handles.push(sound.noteOn(midi, velocity, time, duration));
          }
          return {midi, handles};
        } catch (error) {
          // An attack fan-out is atomic. Release the child that threw as a
          // defensive pitch rollback, then unwind every committed exact voice
          // in reverse order. Rollback faults never replace the attack fault.
          const failedIndex = handles.length;
          try {
            sounds[failedIndex]?.noteOff(midi, time);
          } catch {
            // Preserve the original noteOn failure.
          }
          for (let index = handles.length - 1; index >= 0; index -= 1) {
            try {
              releaseLayerChild(sounds[index], handles[index], midi, time, true);
            } catch {
              // Preserve the original noteOn failure.
            }
          }
          throw error;
        }
      },
      noteOff: (midi, time) => {
        runLayerOperations(sounds, (sound) => sound.noteOff(midi, time));
      },
      cancelScheduledNote: (handle, time) => {
        if (!isLayerVoiceHandle(handle)) return;
        runLayerOperations(sounds, (sound, index) => {
          releaseLayerChild(sound, handle.handles[index], handle.midi, time, true);
        });
      },
      retimeScheduledNote: (handle, time) => {
        if (!isLayerVoiceHandle(handle)) return;
        runLayerOperations(sounds, (sound, index) => {
          const childHandle = handle.handles[index];
          if (childHandle != null) sound.retimeScheduledNote(childHandle, time);
        });
      },
      noteOffById: (handle, time) => {
        if (!isLayerVoiceHandle(handle)) {
          runLayerOperations(sounds, (sound) => sound.noteOffById(handle, time));
          return;
        }
        runLayerOperations(sounds, (sound, index) => {
          releaseLayerChild(sound, handle.handles[index], handle.midi, time, false);
        });
      },
      preload: () => Promise.all(sounds.map((sound) => sound.preload())).then(() => undefined),
      dispose: () => runLayerOperations(sounds, (sound) => sound.dispose()),
    }));
  }

  /** Two-operator frequency-modulation synthesis. */
  static fm(options: FmOptions = {}): Sound {
    return new Sound((context) => new FmBackend(context, options), options);
  }

  /** PeriodicWave wavetable synthesis. */
  static wavetable(options: WavetableOptions = {}): Sound {
    return new Sound((context) => new WavetableBackend(context, options), options);
  }

  /** Filtered white-noise synthesis. */
  static noise(options: NoiseOptions = {}): Sound {
    return new Sound((context) => new NoiseBackend(context, options), options);
  }

  /** Route note events to Web MIDI instead of producing audio. */
  static midiOut(options: MidiOutOptions = {}): Sound {
    return new Sound(() => new MidiOutBackend(options), options);
  }

  connect(destination: AudioNode): () => void {
    if (this.activeRoute) throw soundAlreadyConnectedError();
    if (this.reconnectBlockedBackend) throw soundReconnectBlockedError();
    const context = destination.context as AudioContext;
    const gain = context.createGain();
    let backend: SoundBackend | undefined;
    let backendRoute: (() => void) | undefined;
    try {
      gain.gain.value = this.gainValue;
      gain.connect(destination);
      backend = this.factory(context);
      const connected = backend.connect?.(gain);
      backendRoute = typeof connected === 'function' ? connected : undefined;
      const route: ActiveSoundRoute = {
        backend,
        gain,
        destination,
        backendRoute,
        released: false,
      };
      this.backend = backend;
      this.gain = gain;
      this.context = context;
      this.activeRoute = route;
      this.startLoading(backend, context);
      return () => this.releaseRoute(route);
    } catch (error) {
      // No Sound state commits until the complete backend route and synchronous
      // setup have succeeded. Unwind route-local state first, then the backend
      // itself, and always detach the private gain while preserving the
      // original construction failure.
      try {
        backendRoute?.();
      } catch {
        // Preserve the original setup failure.
      }
      if (!(backend as OrderedTeardownBackend | undefined)?.[CONNECT_FAILURE_IS_ROLLED_BACK]) {
        try {
          if (backend?.dispose) backend.dispose();
          else backend?.disconnect?.();
        } catch {
          // Preserve the original setup failure.
        }
      }
      try {
        gain.disconnect(destination);
      } catch {
        // A failed backend setup must not leave this private gain attached.
      }
      this.clearConnectionState();
      throw error;
    }
  }

  disconnect(): void {
    const route = this.activeRoute;
    const backend = route?.backend ?? this.backend ?? this.reconnectBlockedBackend;
    const globallyDisconnected = typeof backend?.disconnect === 'function';
    const teardownFirst = (backend as OrderedTeardownBackend | undefined)?.[
      GLOBAL_TEARDOWN_BEFORE_ROUTE
    ] === true;
    let firstError: unknown;
    if (teardownFirst) {
      try {
        backend?.disconnect?.();
      } catch (error) {
        firstError = error;
      }
    }
    try {
      if (route) this.releaseRoute(route);
      else this.clearConnectionState();
    } catch (error) {
      firstError ??= error;
    }
    if (!teardownFirst) {
      try {
        backend?.disconnect?.();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (globallyDisconnected) this.reconnectBlockedBackend = undefined;
    if (firstError !== undefined) throw firstError;
  }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): unknown {
    const handle = this.backend?.noteOn(midi, velocity, time, durationSeconds);
    // Do not advertise a handle to the scheduler unless this backend can
    // release that precise instance. Otherwise it will use the normal MIDI
    // fallback path rather than silently skipping noteOff().
    return this.backend?.noteOffById ? handle : undefined;
  }

  noteOff(midi: number, time: number): void {
    this.backend?.noteOff?.(midi, time);
  }

  /** Forward an exact backend voice handle when the backend supports it. */
  noteOffById(handle: unknown, time: number): void {
    this.backend?.noteOffById?.(handle, time);
  }

  /** Propagate exact AudioContext-clock lookahead only from capable backends. */
  get supportsScheduledCancellation(): boolean {
    return this.backend?.supportsScheduledCancellation === true &&
      typeof this.backend.cancelScheduledNote === 'function' &&
      typeof this.backend.noteOffById === 'function';
  }

  cancelScheduledNote(handle: unknown, time: number): void {
    this.backend?.cancelScheduledNote?.(handle, time);
  }

  retimeScheduledNote(handle: unknown, time: number): void {
    this.backend?.retimeScheduledNote?.(handle, time);
  }

  async preload(): Promise<void> {
    const backend = this.backend;
    const context = this.context;
    if (!backend || !context) throw soundNotConnectedError();
    // A failed setup/preload clears `loaded`, so a later explicit preload can
    // retry transient fetch/worklet failures without reconnecting the Sound.
    const loaded = this.loaded ?? this.startLoading(backend, context);
    await loaded;
  }

  dispose(): void {
    const route = this.activeRoute;
    const backend = route?.backend ?? this.backend ?? this.reconnectBlockedBackend;
    const globallyDisposed = typeof backend?.dispose === 'function';
    const globallyDisconnected = typeof backend?.disconnect === 'function';
    const teardownFirst = (backend as OrderedTeardownBackend | undefined)?.[
      GLOBAL_TEARDOWN_BEFORE_ROUTE
    ] === true;
    let firstError: unknown;
    if (teardownFirst) {
      try {
        if (globallyDisposed) backend?.dispose?.();
        else backend?.disconnect?.();
      } catch (error) {
        firstError = error;
      }
    }
    try {
      if (route) this.releaseRoute(route);
      else this.clearConnectionState();
    } catch (error) {
      firstError ??= error;
    }
    if (!teardownFirst) {
      try {
        if (globallyDisposed) backend?.dispose?.();
        else backend?.disconnect?.();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (globallyDisposed || globallyDisconnected) this.reconnectBlockedBackend = undefined;
    if (firstError !== undefined) throw firstError;
  }

  /** Set this sound's bus gain, live when already connected. */
  setGain(value: number): this {
    this.gainValue = Math.max(0, value);
    if (this.gain) this.gain.gain.value = this.gainValue;
    return this;
  }

  /**
   * Resolves when this connected sound's asynchronous loading has completed.
   * Accessing readiness before `connect()` rejects instead of falsely claiming
   * that samples or worklets are ready.
   */
  get ready(): Promise<void> {
    if (this.loaded) return this.loaded;
    if (this.backend && this.context && this.lastLoadError !== undefined) {
      return Promise.reject(this.lastLoadError);
    }
    return Promise.reject(soundNotConnectedError());
  }

  private startLoading(backend: SoundBackend, context: AudioContext): Promise<void> {
    this.lastLoadError = undefined;
    const pending = Promise.resolve(this.setup?.(backend, context))
      .then(() => backend.preload?.())
      .then(() => undefined);
    this.loaded = pending;
    void pending.catch((error: unknown) => {
      if (this.loaded !== pending) return;
      this.loaded = undefined;
      this.lastLoadError = error;
    });
    return pending;
  }

  /** Release only the connection made by one Sound.connect() call. */
  private releaseRoute(route: ActiveSoundRoute): void {
    if (route.released) return;
    route.released = true;
    let cleanupError: unknown;
    try {
      route.backendRoute?.();
    } catch (error) {
      // Still detach our own bus and clear state before surfacing a custom
      // backend cleanup failure to the caller.
      cleanupError = error;
    }
    try {
      route.gain.disconnect(route.destination);
    } catch {
      // The owning graph may already have removed this exact route.
    }
    if (this.activeRoute === route) {
      this.clearConnectionState();
      // A generic external backend may have connected itself directly to our
      // old gain. Without an explicit route disposer, reconnecting it would
      // accumulate an orphan route. Require a caller-chosen global teardown
      // (disconnect/dispose) before another attachment instead of guessing.
      if (!route.backendRoute || cleanupError !== undefined) {
        this.reconnectBlockedBackend = route.backend;
      }
    }
    if (cleanupError !== undefined) throw cleanupError;
  }

  private clearConnectionState(): void {
    this.activeRoute = undefined;
    this.backend = undefined;
    this.gain = undefined;
    this.context = undefined;
    this.loaded = undefined;
    this.lastLoadError = undefined;
  }

  private withAsyncSetup(
    setup: (backend: SoundBackend, context: AudioContext) => Promise<void>,
  ): this {
    this.setup = setup;
    return this;
  }
}

function soundNotConnectedError(): Error {
  return new Error('Sound is not connected; attach it to a player or call connect() before waiting for readiness.');
}

function soundAlreadyConnectedError(): Error {
  return new Error(
    'Sound is already connected. One Sound instance supports one active player or voice route; ' +
    'create a separate Sound for each concurrent route.',
  );
}

function soundReconnectBlockedError(): Error {
  return new Error(
    'Sound cannot reconnect because its previous backend did not provide a route cleanup. ' +
    'Create a new Sound or call disconnect()/dispose() only when you own that backend globally.',
  );
}

function releaseRouteCleanups(cleanups: ReadonlyArray<() => void>): void {
  let firstError: unknown;
  for (const cleanup of [...cleanups].reverse()) {
    try {
      cleanup();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

/** Run every child cleanup/release even when an earlier child throws. */
function runLayerOperations(
  sounds: readonly Sound[],
  operation: (sound: Sound, index: number) => void,
): void {
  let firstError: unknown;
  sounds.forEach((sound, index) => {
    try {
      operation(sound, index);
    } catch (error) {
      firstError ??= error;
    }
  });
  if (firstError !== undefined) throw firstError;
}

function releaseLayerChild(
  sound: Sound,
  handle: unknown,
  midi: number,
  time: number,
  preferCancellation: boolean,
): void {
  if (handle == null) {
    sound.noteOff(midi, time);
    return;
  }
  if (preferCancellation && sound.supportsScheduledCancellation) {
    sound.cancelScheduledNote(handle, time);
    return;
  }
  sound.noteOffById(handle, time);
}

function isLayerVoiceHandle(value: unknown): value is {midi: number; handles: unknown[]} {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as {midi?: unknown; handles?: unknown};
  return typeof candidate.midi === 'number' && Array.isArray(candidate.handles);
}
