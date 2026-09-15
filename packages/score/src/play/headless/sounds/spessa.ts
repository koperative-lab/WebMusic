import type {HeadlessSynth} from '../audio-contracts';
import {
  DEFAULT_MAX_SOUNDFONT_BYTES,
  cancelBinaryResponseBody,
  positiveSafeIntegerOption,
  readBoundedResponse,
} from '../resource-loading';

interface SpessaLike {
  noteOn(channel: number, midi: number, velocity: number): void;
  noteOff(channel: number, midi: number): void;
  programChange(channel: number, program: number): void;
  connect(destination: AudioNode): AudioNode;
  destroy?(): void;
}

interface WorkletSynthesizerLike extends SpessaLike {
  isReady: Promise<void>;
  soundBankManager: {
    addSoundBank(buffer: ArrayBuffer, id: string): Promise<void>;
  };
}

const workletRegistered = new WeakSet<BaseAudioContext>();

/** Optional spessasynth_lib adapter used exclusively by `Sound.soundfont2()`. */
export class SpessaSoundBackend implements HeadlessSynth {
  private synth?: SpessaLike;
  private context?: AudioContext;
  private ready?: Promise<void>;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private loadController?: AbortController;
  private readonly maxSoundFontBytes: number;
  private activeRouteId?: number;
  private nextRouteId = 1;

  constructor(
    private readonly source: string | ArrayBuffer,
    private readonly channel: number,
    private readonly program: number,
    private readonly workletUrl?: string | URL,
    private readonly registerWorklet?: (context: BaseAudioContext) => Promise<void> | void,
    maxSoundFontBytes?: number,
  ) {
    this.maxSoundFontBytes = positiveSafeIntegerOption(
      'Sound.soundfont2',
      'maxSoundFontBytes',
      maxSoundFontBytes,
      DEFAULT_MAX_SOUNDFONT_BYTES,
    );
    if (source instanceof ArrayBuffer && source.byteLength > this.maxSoundFontBytes) {
      throw new RangeError(
        `Sound.soundfont2 source exceeds maxSoundFontBytes (${this.maxSoundFontBytes.toLocaleString()} bytes)`,
      );
    }
  }

  connect(destination: AudioNode): () => void {
    if (this.activeRouteId != null) this.releaseRoute(this.activeRouteId);
    const routeId = this.nextRouteId++;
    const context = destination.context as AudioContext;
    this.activeRouteId = routeId;
    this.context = context;
    this.ready = this.initialize(context, destination, routeId);
    // Sound.soundfont2 constructs this backend per route. Destroying this
    // private worklet is therefore exact route cleanup, not global teardown of
    // a caller-owned synth.
    return () => this.releaseRoute(routeId);
  }

  preload(): Promise<void> {
    return this.ready ?? Promise.resolve();
  }

  noteOn(midi: number, velocity: number, time: number): void {
    this.schedule(time, () => this.synth?.noteOn(this.channel, midi, velocity));
  }

  noteOff(midi: number, time: number): void {
    this.schedule(time, () => this.synth?.noteOff(this.channel, midi), true);
  }

  dispose(): void {
    if (this.activeRouteId != null) this.releaseRoute(this.activeRouteId);
    else {
      this.abortLoad();
      this.clearTimers();
      this.destroySynth();
      this.context = undefined;
      this.ready = undefined;
    }
  }

  private async initialize(
    context: AudioContext,
    destination: AudioNode,
    routeId: number,
  ): Promise<void> {
    let synth: WorkletSynthesizerLike | undefined;
    let module: {WorkletSynthesizer?: unknown};
    try {
      // Keep this lazy import statically resolvable: consumer bundlers must
      // emit the peer's module instead of leaving a bare browser specifier.
      module = await import('spessasynth_lib');
    } catch {
      if (!this.isRouteActive(routeId)) return;
      throw new Error(
        'Sound.soundfont2 requires the optional peer dependency "spessasynth_lib". ' +
        'Install it with `npm i spessasynth_lib@^4`.',
      );
    }
    try {
      if (!this.isRouteActive(routeId)) return;
      const WorkletSynthesizer = module.WorkletSynthesizer as
        | (new (context: AudioContext) => WorkletSynthesizerLike)
        | undefined;
      if (!WorkletSynthesizer) {
        throw new Error(
          'Sound.soundfont2 requires spessasynth_lib 4.x with WorkletSynthesizer. ' +
          'Install it with `npm i spessasynth_lib@^4`.',
        );
      }

      await ensureSpessasynthWorklet(context, this.workletUrl, this.registerWorklet);
      if (!this.isRouteActive(routeId)) return;
      synth = new WorkletSynthesizer(context);
      await synth.isReady;
      if (!this.isRouteActive(routeId)) {
        this.destroySynth(synth);
        return;
      }
      const buffer = typeof this.source === 'string'
        ? await this.loadSoundFontSource(this.source)
        : this.source;
      if (!this.isRouteActive(routeId)) {
        this.destroySynth(synth);
        return;
      }
      await synth.soundBankManager.addSoundBank(buffer, 'main');
      if (!this.isRouteActive(routeId)) {
        this.destroySynth(synth);
        return;
      }
      synth.programChange(this.channel, this.program);
      synth.connect(destination);
      if (!this.isRouteActive(routeId)) {
        this.destroySynth(synth);
        return;
      }
      this.synth = synth;
    } catch (error) {
      if (!this.isRouteActive(routeId)) {
        this.destroySynth(synth);
        return;
      }
      this.destroySynth(synth);
      throw error;
    }
  }

  private releaseRoute(routeId: number): void {
    if (this.activeRouteId !== routeId) return;
    this.activeRouteId = undefined;
    this.abortLoad();
    this.context = undefined;
    this.ready = undefined;
    this.clearTimers();
    this.destroySynth();
  }

  private isRouteActive(routeId: number): boolean {
    return this.activeRouteId === routeId;
  }

  private async loadSoundFontSource(source: string): Promise<ArrayBuffer> {
    const controller = new AbortController();
    this.abortLoad();
    this.loadController = controller;
    try {
      const response = await fetch(source, {signal: controller.signal});
      if (!response.ok) {
        cancelBinaryResponseBody(response.body, `Sound.soundfont2 request failed for ${source}`);
        throw new Error(`Sound.soundfont2: failed to load ${source} (${response.status})`);
      }
      return await readBoundedResponse(
        response,
        this.maxSoundFontBytes,
        `Sound.soundfont2 source ${source}`,
        'maxSoundFontBytes',
        controller.signal,
      );
    } finally {
      if (this.loadController === controller) this.loadController = undefined;
    }
  }

  private abortLoad(): void {
    this.loadController?.abort();
    this.loadController = undefined;
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private destroySynth(synth: SpessaLike | undefined = this.synth): void {
    if (!synth) return;
    if (this.synth === synth) this.synth = undefined;
    try {
      synth.destroy?.();
    } catch {
      // The optional backend may already have torn itself down.
    }
  }

  private schedule(time: number, callback: () => void, release = false): void {
    const context = this.context;
    const routeId = this.activeRouteId;
    if (!context || routeId == null) return;
    const delay = !(release && time <= context.currentTime) && context.state && context.state !== 'running'
      ? 50
      : Math.max(0, (time - context.currentTime) * 1000);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.isRouteActive(routeId) || (!release && context.state === 'closed')) return;
      if (context.currentTime < time || (!release && context.state && context.state !== 'running')) {
        this.schedule(time, callback, release);
        return;
      }
      callback();
    }, delay);
    this.timers.add(timer);
  }
}

async function ensureSpessasynthWorklet(
  context: BaseAudioContext,
  workletUrl?: string | URL,
  registerWorklet?: (context: BaseAudioContext) => Promise<void> | void,
): Promise<void> {
  if (workletRegistered.has(context)) return;
  if (registerWorklet) {
    await registerWorklet(context);
    workletRegistered.add(context);
    return;
  }
  const audioWorklet = context.audioWorklet;
  if (!audioWorklet?.addModule) {
    throw new Error(
      'Sound.soundfont2 requires AudioWorklet support in the destination AudioContext.',
    );
  }
  await audioWorklet.addModule(await spessasynthWorkletUrl(workletUrl));
  workletRegistered.add(context);
}

async function spessasynthWorkletUrl(configured?: string | URL): Promise<string> {
  if (configured) return String(configured);
  // No bundler-magic fallback on purpose: a literal `...?url` dynamic import
  // resolves only under Vite and breaks webpack/esbuild consumers at build
  // time, so the worklet URL must come from the caller.
  throw new Error(
    'Sound.soundfont2: could not resolve the spessasynth AudioWorklet module. ' +
    'Pass Soundfont2Options.workletUrl (Vite: import workletUrl from ' +
    "'spessasynth_lib/dist/spessasynth_processor.min.js?url') or provide " +
    'Soundfont2Options.registerWorklet.',
  );
}
