import {InsertChain, type Effect} from '../effect-chain';
import {AudioOutputPort} from './audio-port';
import {createControlPort, type ControlPort} from './control-port';
import type {ModuleContext} from './context';
import {routeModuleOutput} from './context';
import {createConnectionLease, type ConnectionLease} from './lease';
import {ParamHandle, ParamSurface} from './parameter';
import {ModuleRegistry, type ModuleHandle, type ModulePort} from './registry';

let nextRackId = 0;

/** Read-only view of one Rack channel. Its ID is the admitted module's ID. */
export interface RackChannel {
  readonly id: string;
  readonly module: ModuleHandle;
  readonly volume: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

export interface RackModuleOptions {
  id?: string;
  /** Recipe for the master chain's compatibility slot. */
  effect?: Effect;
  onError?: (error: unknown) => void;
}

interface Channel {
  readonly id: string;
  readonly module: ModuleHandle;
  readonly fader: GainNode;
  readonly panner: StereoPannerNode | undefined;
  readonly inserts: InsertChain;
  readonly output: AudioOutputPort;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  lease: ConnectionLease;
}

const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const balance = (value: number) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

/**
 * The neutral mixing desk under every domain Rack (DEC-063, DEC-068). Each
 * admitted module gets one channel keyed by its module ID: fader, pan,
 * post-fader InsertChain and a tappable channel output that sums into a real
 * master bus. The master runs its own InsertChain once on the sum. The Rack
 * borrows admitted modules and never disposes them; it holds no Session.
 */
export class RackModule implements ModuleHandle {
  readonly id: string;
  /** Scope for members: this Rack's registry and admission, the upstream Session. */
  readonly context: ModuleContext;
  readonly #upstream: ModuleContext;
  readonly #registry = new ModuleRegistry();
  readonly #registration: ConnectionLease;
  readonly #channels = new Map<string, Channel>();
  readonly #admitting = new Set<string>();
  readonly #listeners = new Set<() => void>();
  readonly #onError?: (error: unknown) => void;
  readonly #masterLevel: ParamHandle;
  readonly #params: ParamSurface;
  readonly #control: ControlPort;
  #master?: GainNode;
  #chain?: InsertChain;
  #port?: AudioOutputPort;
  #route?: ConnectionLease;
  #recipe?: Effect;
  #ports: readonly ModulePort[] = Object.freeze([]);
  #disposed = false;
  #preparing = false;

  constructor(upstream: ModuleContext, options: RackModuleOptions = {}) {
    this.id = options.id ?? `rack-${++nextRackId}`;
    this.#upstream = upstream;
    this.#recipe = options.effect;
    this.#onError = options.onError;
    this.#masterLevel = new ParamHandle({id: 'master-volume', label: 'Master volume', unit: 'gain', range: {min: 0, max: 1}, defaultValue: 1},
      {apply: (value) => { if (this.#master) this.#master.gain.value = value; }});
    this.#params = new ParamSurface([this.#masterLevel]);
    this.#control = createControlPort(this.#params);
    this.context = upstream.derive({
      id: `${this.id}:scope`, registry: this.#registry, target: this,
      admit: (module, port) => this.admit(module, port),
    });
    this.#refreshPorts();
    this.#registration = upstream.registry.register(this);
  }

  get disposed(): boolean { return this.#disposed; }
  get params(): ParamSurface { return this.#params; }
  get inserts(): InsertChain | undefined { return this.#chain; }
  /** Prepared master input for explicit audio patching; ownership stays with the Rack. */
  get input(): GainNode | undefined { return this.#master; }
  get effect(): Effect | undefined { return this.#recipe; }
  get masterVolume(): number { return this.#masterLevel.snapshot.baseValue; }

  setEffect(effect: Effect | undefined): void {
    this.#assertActive();
    if (this.#preparing) throw new Error('Effects cannot change during Rack construction.');
    this.#chain?.setCompatibility(effect);
    this.#recipe = effect;
    this.#notify();
  }
  setMasterVolume(value: number): void {
    this.#masterLevel.setBaseValue(unit(value));
    this.#notify();
  }

  list(): readonly RackChannel[] {
    return Object.freeze([...this.#channels.values()].map(({id, module, volume, pan, muted, solo}) =>
      Object.freeze({id, module, volume, pan, muted, solo})));
  }
  channel(id: string): RackChannel | undefined { return this.list().find(channel => channel.id === id); }
  /** Stable post-fader inserts owned by this Rack channel. */
  channelInserts(id: string): InsertChain | undefined { return this.#channels.get(id)?.inserts; }
  setVolume(id: string, value: number): void { this.#edit(id, channel => { channel.volume = unit(value); }); }
  setPan(id: string, value: number): void {
    this.#edit(id, channel => {
      channel.pan = balance(value);
      if (channel.panner) channel.panner.pan.value = channel.pan;
    });
  }
  mute(id: string, muted: boolean): void { this.#edit(id, channel => { channel.muted = muted; }); }
  solo(id: string, solo: boolean): void { this.#edit(id, channel => { channel.solo = solo; }); }

  /** `master` (aliases `output`, `main`) or `channel:<module id>` for a post-insert channel tap. */
  getPort(name: string): AudioOutputPort | undefined {
    if (name === 'master' || name === 'output' || name === 'main') return this.#port;
    return name.startsWith('channel:') ? this.#channels.get(name.slice('channel:'.length))?.output : undefined;
  }
  ports(): readonly ModulePort[] { return this.#ports; }

  prepare(): void {
    this.#assertActive();
    if (this.#chain) return;
    if (this.#preparing) throw new Error('Rack preparation cannot reenter audio graph construction.');
    const audio = this.#upstream.audio.prepare();
    const master = audio.createGain();
    this.#preparing = true;
    let chain: InsertChain | undefined;
    let port: AudioOutputPort | undefined;
    let route: ConnectionLease | undefined;
    try {
      master.gain.value = this.masterVolume;
      chain = new InsertChain(audio);
      chain.setCompatibility(this.#recipe);
      master.connect(chain.input);
      port = new AudioOutputPort(chain.output, {id: 'master'});
      route = routeModuleOutput(this.#upstream, this, port);
      this.#assertActive();
      if (!route.active) throw new Error('Rack admission was cancelled.');
      this.#master = master;
      this.#chain = chain;
      this.#port = port;
      this.#route = route;
      this.#refreshPorts();
      this.#notify();
    } catch (error) {
      try { route?.release(); } catch { /* Preserve construction error. */ }
      try { port?.dispose(); } catch { /* Preserve construction error. */ }
      try { chain?.dispose(); } catch { /* Preserve construction error. */ }
      try { master.disconnect(); } catch { /* Preserve construction error. */ }
      throw error;
    } finally {
      this.#preparing = false;
    }
  }

  /** Give a module's output its own channel. The lease removes only that channel. */
  admit(module: ModuleHandle, port: AudioOutputPort): ConnectionLease {
    this.#assertActive();
    if (module === this) throw new Error('A Rack cannot admit its own output.');
    const assertAvailable = () => {
      if (this.#channels.has(module.id) || this.#admitting.has(module.id)) throw new Error(`Module ${module.id} already has a Rack channel.`);
    };
    assertAvailable();
    this.prepare();
    this.#assertActive();
    // Preparing the master publishes readiness. A subscriber may have admitted
    // this id before the original call resumes.
    assertAvailable();
    const master = this.#master!;
    if (port.context !== master.context) throw new Error('Rack admission requires the same AudioContext.');
    const previousDestination = port.defaultDestination;
    this.#admitting.add(module.id);
    let fader: GainNode | undefined;
    let panner: StereoPannerNode | undefined;
    let inserts: InsertChain | undefined;
    let output: AudioOutputPort | undefined;
    let channel: Channel;
    try {
      const context = master.context;
      fader = context.createGain();
      panner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : undefined;
      inserts = new InsertChain(context, {onCleanupError: this.#onError});
      if (panner) { fader.connect(panner); panner.connect(inserts.input); } else fader.connect(inserts.input);
      output = new AudioOutputPort(inserts.output, {id: `channel:${module.id}`, defaultDestination: master, onCleanupError: this.#onError});
      port.setDefault(fader);
      this.#assertActive();
      const channelFader = fader;
      const channelPanner = panner;
      const channelInserts = inserts;
      const channelOutput = output;
      channel = {
        id: module.id, module, fader, panner, inserts, output, volume: 1, pan: 0, muted: false, solo: false,
        lease: createConnectionLease(() => {
          if (this.#channels.get(module.id) === channel) this.#channels.delete(module.id);
          // Retire only this channel, even if cleanup installs a replacement.
          let failure: unknown;
          const clean = (callback: () => void) => { try { callback(); } catch (error) { failure ??= error; } };
          clean(() => { if (!port.disposed && port.defaultDestination === channelFader) port.setDefault(undefined); });
          clean(() => channelOutput.dispose());
          clean(() => channelFader.disconnect(channelPanner ?? channelInserts.input));
          clean(() => channelPanner?.disconnect(channelInserts.input));
          clean(() => channelInserts.dispose());
          this.#refreshPorts();
          this.#applyMix();
          if (failure !== undefined) throw failure;
        }),
      };
      this.#channels.set(module.id, channel);
    } catch (error) {
      try {
        if (fader && !port.disposed && port.defaultDestination === fader) {
          port.setDefault(this.#disposed ? undefined : previousDestination);
        }
      } catch { /* Preserve admission error. */ }
      try { output?.dispose(); } catch { /* Preserve admission error. */ }
      try { inserts?.dispose(); } catch { /* Preserve admission error. */ }
      try { if (panner && inserts) panner.disconnect(inserts.input); } catch { /* Preserve admission error. */ }
      try { if (fader && inserts) fader.disconnect(panner ?? inserts.input); } catch { /* Preserve admission error. */ }
      throw error;
    } finally {
      this.#admitting.delete(module.id);
    }
    this.#refreshPorts();
    this.#applyMix();
    return channel.lease;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    const clean = (callback: () => void) => { try { callback(); } catch (error) { failure ??= error; } };
    for (const channel of [...this.#channels.values()]) clean(() => channel.lease.release());
    clean(() => this.#route?.release());
    clean(() => this.#port?.dispose());
    clean(() => this.#chain?.dispose());
    clean(() => this.#master?.disconnect());
    clean(() => this.#masterLevel.dispose());
    clean(() => this.#registration.release());
    clean(() => this.#registry.dispose());
    this.#listeners.clear();
    if (failure !== undefined) throw failure;
  }

  #edit(id: string, change: (channel: Channel) => void): void {
    const channel = this.#channels.get(id);
    if (!channel) return;
    change(channel);
    this.#applyMix();
  }
  #applyMix(): void {
    const solo = [...this.#channels.values()].some(channel => channel.solo);
    for (const channel of this.#channels.values()) {
      channel.fader.gain.value = channel.muted || (solo && !channel.solo) ? 0 : channel.volume;
    }
    this.#notify();
  }
  #refreshPorts(): void {
    const ports: ModulePort[] = [this.#control];
    if (this.#port) ports.push(this.#port);
    for (const channel of this.#channels.values()) ports.push(channel.output);
    this.#ports = Object.freeze(ports);
  }
  #notify(): void {
    for (const listener of [...this.#listeners]) {
      if (this.#disposed) break;
      try { listener(); } catch (error) {
        try { this.#onError?.(error); } catch { /* Observers cannot undo a committed graph. */ }
      }
    }
  }
  #assertActive(): void { if (this.#disposed) throw new Error('Rack module has been disposed.'); }
}
