import {
  AudioOutputPort,
  ModuleRegistry,
  createConnectionLease,
  type ConnectionLease,
  type ModuleContext,
  type ModuleHandle,
} from '@webmusic/kernel/module';
import {InsertChain} from '@webmusic/kernel/effect';
import type {Effect} from './effects';

let nextRackId = 0;

export interface ScoreRackModuleChannel {
  readonly id: string;
  readonly module: ModuleHandle;
  readonly volume: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

interface Channel extends ScoreRackModuleChannel {
  gain: GainNode;
  inserts: InsertChain;
  port: AudioOutputPort;
  volume: number;
  muted: boolean;
  solo: boolean;
  lease: ConnectionLease;
}

/** A hierarchical audio bus; borrowing a module never transfers its lifetime. */
export class ScoreRackModule implements ModuleHandle {
  readonly id: string;
  readonly context: ModuleContext;
  private readonly upstream: ModuleContext;
  private readonly registry = new ModuleRegistry();
  private readonly registration: ConnectionLease;
  private readonly channels = new Map<string, Channel>();
  private readonly admitting = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private master?: GainNode;
  private chain?: InsertChain;
  private port?: AudioOutputPort;
  private route?: ConnectionLease;
  private level = 1;
  private recipe?: Effect;
  private disposed = false;
  private preparing = false;
  private readonly onError?: (error: unknown) => void;

  constructor(upstream: ModuleContext, options: {id?: string; effect?: Effect; onError?: (error: unknown) => void} = {}) {
    this.id = options.id ?? `score-rack-module-${++nextRackId}`;
    this.upstream = upstream;
    this.recipe = options.effect;
    this.onError = options.onError;
    this.context = upstream.derive({
      id: `${this.id}:scope`, registry: this.registry, target: this,
      admit: (module, port) => this.admit(module, port),
    });
    this.registration = upstream.registry.register(this);
  }

  get inserts(): InsertChain | undefined { return this.chain; }
  /** Prepared master input for explicit audio patching; ownership stays with the Rack. */
  get input(): GainNode | undefined { return this.master; }
  get effect(): Effect | undefined { return this.recipe; }
  setEffect(effect: Effect | undefined): void {
    this.assertActive();
    if (this.preparing) throw new Error('Effects cannot change during Rack construction.');
    this.chain?.setCompatibility(effect);
    this.recipe = effect;
    this.notify();
  }
  get masterVolume(): number { return this.level; }
  setMasterVolume(value: number): void {
    this.level = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    if (this.master) this.master.gain.value = this.level;
    this.notify();
  }
  list(): readonly ScoreRackModuleChannel[] {
    return [...this.channels.values()].map(({id, module, volume, muted, solo}) => ({id, module, volume, muted, solo}));
  }
  /** Stable post-fader inserts owned by this Rack channel. */
  channelInserts(id: string): InsertChain | undefined { return this.channels.get(id)?.inserts; }
  setVolume(id: string, value: number): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    this.applyMix();
  }
  mute(id: string, muted: boolean): void {
    const channel = this.channels.get(id);
    if (channel) { channel.muted = muted; this.applyMix(); }
  }
  solo(id: string, solo: boolean): void {
    const channel = this.channels.get(id);
    if (channel) { channel.solo = solo; this.applyMix(); }
  }
  getPort(name: string): AudioOutputPort | undefined {
    return name === 'master' || name === 'output' || name === 'main' ? this.port : undefined;
  }

  prepare(): void {
    this.assertActive();
    if (this.chain) return;
    if (this.preparing) throw new Error('Rack preparation cannot reenter audio graph construction.');
    const audio = this.upstream.audio.prepare();
    const master = audio.createGain();
    this.preparing = true;
    let chain: InsertChain | undefined;
    let port: AudioOutputPort | undefined;
    let route: ConnectionLease | undefined;
    try {
      master.gain.value = this.level;
      chain = new InsertChain(audio);
      chain.setCompatibility(this.recipe);
      master.connect(chain.input);
      port = new AudioOutputPort(chain.output);
      if (this.upstream.admit) route = this.upstream.admit(this, port);
      else {
        const destination = this.upstream.destination?.() ?? audio.destination;
        port.setDefault(destination);
        const routed = port;
        route = createConnectionLease(() => {
          if (!routed.disposed && routed.defaultDestination === destination) routed.setDefault(undefined);
        });
      }
      this.assertActive();
      if (!route.active) throw new Error('Score Rack admission was cancelled.');
      this.master = master;
      this.chain = chain;
      this.port = port;
      this.route = route;
      this.notify();
    } catch (error) {
      try { route?.release(); } catch { /* Preserve construction error. */ }
      try { port?.dispose(); } catch { /* Preserve construction error. */ }
      try { chain?.dispose(); } catch { /* Preserve construction error. */ }
      try { master.disconnect(); } catch { /* Preserve construction error. */ }
      throw error;
    } finally {
      this.preparing = false;
    }
  }

  admit(module: ModuleHandle, port: AudioOutputPort): ConnectionLease {
    this.assertActive();
    if (module === this) throw new Error('A Rack cannot admit its own output.');
    const assertAvailable = () => {
      if (this.channels.has(module.id) || this.admitting.has(module.id)) throw new Error(`Module ${module.id} already has a Rack channel.`);
    };
    assertAvailable();
    this.prepare();
    this.assertActive();
    // Preparing the master publishes readiness. A subscriber may have admitted
    // this id before the original call resumes.
    assertAvailable();
    if (port.context !== this.master!.context) throw new Error('Rack admission requires the same AudioContext.');
    const master = this.master!;
    const previousDestination = port.defaultDestination;
    this.admitting.add(module.id);
    let gain: GainNode | undefined;
    let inserts: InsertChain | undefined;
    let channel: Channel;
    try {
      gain = master.context.createGain();
      inserts = new InsertChain(master.context, {onCleanupError: this.onError});
      gain.connect(inserts.input);
      inserts.output.connect(master);
      port.setDefault(gain);
      this.assertActive();
      const channelGain = gain;
      const channelInserts = inserts;
      channel = {
        id: module.id, module, gain, inserts, port, volume: 1, muted: false, solo: false,
        lease: createConnectionLease(() => {
          if (this.channels.get(module.id) === channel) this.channels.delete(module.id);
          // Retire only this channel, even if cleanup installs a replacement.
          let failure: unknown;
          try { if (!port.disposed && port.defaultDestination === channelGain) port.setDefault(undefined); } catch (error) { failure = error; }
          try { channelGain.disconnect(channelInserts.input); } catch (error) { failure ??= error; }
          try { channelInserts.output.disconnect(master); } catch (error) { failure ??= error; }
          try { channelInserts.dispose(); } catch (error) { failure ??= error; }
          this.applyMix();
          if (failure !== undefined) throw failure;
        }),
      };
      this.channels.set(module.id, channel);
    } catch (error) {
      try {
        if (gain && !port.disposed && port.defaultDestination === gain) {
          port.setDefault(this.disposed ? undefined : previousDestination);
        }
      } catch { /* Preserve admission error. */ }
      try { inserts?.output.disconnect(master); } catch { /* Preserve admission error. */ }
      try { inserts?.dispose(); } catch { /* Preserve admission error. */ }
      try { gain?.disconnect(); } catch { /* Preserve admission error. */ }
      throw error;
    } finally {
      this.admitting.delete(module.id);
    }
    this.applyMix();
    return channel.lease;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private applyMix(): void {
    const solo = [...this.channels.values()].some((channel) => channel.solo);
    for (const channel of this.channels.values()) channel.gain.gain.value = channel.muted || (solo && !channel.solo) ? 0 : channel.volume;
    this.notify();
  }
  private notify(): void {
    for (const listener of [...this.listeners]) {
      if (this.disposed) break;
      try { listener(); } catch (error) {
        try { this.onError?.(error); } catch { /* Observers cannot undo a committed graph. */ }
      }
    }
  }
  private assertActive(): void { if (this.disposed) throw new Error('Score Rack module has been disposed.'); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    const clean = (callback: () => void) => { try { callback(); } catch (error) { failure ??= error; } };
    for (const channel of [...this.channels.values()]) clean(() => channel.lease.release());
    clean(() => this.route?.release());
    clean(() => this.port?.dispose());
    clean(() => this.chain?.dispose());
    clean(() => this.master?.disconnect());
    clean(() => this.registration.release());
    clean(() => this.registry.dispose());
    this.listeners.clear();
    if (failure !== undefined) throw failure;
  }
}
