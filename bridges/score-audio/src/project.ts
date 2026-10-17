import {Score} from '@webmusic/score';
import {Effect, ScorePlayerModule, ScoreRackModule, Sound} from '@webmusic/score/play/headless';
import {AudioClip} from '@webmusic/audio';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';
import {InsertChain} from '@webmusic/kernel/effect';
import {
  AudioOutputPort, ParamHandle, ParamSurface, createConnectionLease,
  type ConnectionLease, type ModuleContext, type ModuleHandle, type ProjectFactoryRequest,
  type ProjectJsonObject, type ProjectModuleInstance, type ProjectPluginFactory,
} from '@webmusic/kernel/module';
import {SessionLFO} from '@webmusic/kernel/session';

const version = '1.0.0';
const audioOutput = Object.freeze([{id: 'output', direction: 'output' as const, kind: 'audio' as const}]);
const audioInsert = Object.freeze([{id: 'input', direction: 'input' as const, kind: 'audio' as const}, ...audioOutput]);

/** Trusted, explicit factories; asset resolution and storage remain application responsibilities. */
export function createWebMusicProjectPlugins(): readonly ProjectPluginFactory[] {
  return Object.freeze([
    {id: 'webmusic.score-player', version, create: createScore},
    {id: 'webmusic.audio-player', version, create: createAudio},
    {id: 'webmusic.score-rack', version, create: createRack},
    {id: 'webmusic.audio-bus', version, create: (request: ProjectFactoryRequest) => createInsert(request, Effect.gain(number(request.record.config, 'gain', 1)))},
    {id: 'webmusic.effect', version, create: (request: ProjectFactoryRequest) => createInsert(request, effectRecipe(request.record.config))},
    {id: 'webmusic.lfo', version, create: createLfo},
  ]);
}

async function createScore(request: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
  const score = await request.resolveAsset('source');
  request.signal.throwIfAborted();
  if (!(score instanceof Score)) throw new TypeError('The score-player source asset must resolve to a Score.');
  const config = request.record.config;
  const sound = Sound.oscillator({type: waveform(config.waveform)});
  let module: ScorePlayerModule;
  try {
    module = new ScorePlayerModule(score, {
      context: request.context, id: request.record.id, synth: sound, synthOwnership: 'owned', reverb: false,
      offsetSeconds: number(config, 'offsetSeconds', 0), positionScale: number(config, 'positionScale', 1),
    });
  } catch (error) { sound.dispose(); throw error; }
  return {module, ports: audioOutput, childContext: child => child.derive({id: child.id, target: module}),
    exportConfig: () => config, dispose: () => module.dispose()};
}

async function createAudio(request: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
  const clip = await request.resolveAsset('source');
  request.signal.throwIfAborted();
  if (!(clip instanceof AudioClip)) throw new TypeError('The audio-player source asset must resolve to an AudioClip.');
  const {context, record} = request;
  const player = new AudioClipPlayer(clip, {moduleContext: context});
  const volume = new ParamHandle({id: 'volume', unit: 'ratio', range: {min: 0, max: 1}, defaultValue: 1, modulation: 'none'}, {apply: value => player.setVolume(value)});
  const pan = new ParamHandle({id: 'pan', unit: 'ratio', range: {min: -1, max: 1}, defaultValue: 0, modulation: 'none'}, {apply: value => player.setPan(value)});
  const params = new ParamSurface([volume, pan]);
  let route: ConnectionLease | undefined;
  let registration: ConnectionLease | undefined;
  let participant: {release(): void} | undefined;
  let disposed = false;
  const module: ModuleHandle = {
    id: record.id, params,
    get inserts() { return player.insertChain; },
    getPort: name => name === 'output' ? player.peekOutputPort() : undefined,
    prepare: async () => {
      if (disposed) throw new Error('Project audio player has been disposed.');
      await player.preload();
      if (disposed) throw new Error('Project audio player preparation was cancelled.');
      if (!route) {
        const candidate = normalRoute(context, module, player.outputPort);
        if (disposed || !candidate.active) { candidate.release(); throw new Error('Project audio player admission was cancelled.'); }
        route = candidate;
      }
    },
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clean([() => participant?.release(), () => route?.release(), () => registration?.release(),
      () => volume.dispose(), () => pan.dispose(), () => player.dispose()]);
  };
  try {
    registration = context.registry.register(module);
    participant = context.session?.register({
      play: when => player.play(when), pause: () => player.pause(), stop: () => player.stop(),
      seek: seconds => player.seek(seconds), setRate: rate => player.setRate(rate),
      get position() { return player.seconds; }, get running() { return player.playing; },
      get clock() { return player.clock; },
    }, {
      axis: 'audio-clip-seconds', identity: player, durationSeconds: clip.duration, endPolicy: 'position',
      offsetSeconds: number(record.config, 'offsetSeconds', 0), positionScale: number(record.config, 'positionScale', 1),
      prepare: () => module.prepare!(), activate: () => player.activateScheduling(),
      ...(player.timingCapabilities.sharedSessionClock && {attachScheduling: binding => player.attachScheduling(binding)}),
    });
  } catch (error) { try { dispose(); } catch { /* Preserve creation failure. */ } throw error; }
  return {module, ports: audioOutput, childContext: child => child.derive({id: child.id, target: module}),
    exportConfig: () => record.config, dispose};
}

interface ProjectRackChannelState { volume?: number; muted?: boolean; solo?: boolean }

function rackChannels(config: ProjectJsonObject): Record<string, ProjectRackChannelState> {
  const channels = config.channels ?? {};
  if (channels === null || typeof channels !== 'object' || Array.isArray(channels)) throw new TypeError('Rack channels must be an object keyed by stable module ID.');
  const result: Record<string, ProjectRackChannelState> = Object.create(null);
  for (const [id, value] of Object.entries(channels)) {
    if (!id.trim() || value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Rack channel state requires a module ID and an object.');
    const fields = value as ProjectJsonObject;
    const state: ProjectRackChannelState = {};
    if (fields.volume !== undefined) {
      const volume = number(fields, 'volume', 1);
      if (volume < 0 || volume > 1) throw new RangeError('Rack channel volume must be in [0, 1].');
      state.volume = volume;
    }
    for (const key of ['muted', 'solo'] as const) {
      if (fields[key] !== undefined) {
        if (typeof fields[key] !== 'boolean') throw new TypeError(`Rack channel ${key} must be boolean.`);
        state[key] = fields[key];
      }
    }
    result[id] = state;
  }
  return result;
}

function createRack({context, record}: ProjectFactoryRequest): ProjectModuleInstance {
  const channels = rackChannels(record.config);
  const masterVolume = number(record.config, 'masterVolume', 1);
  if (masterVolume < 0 || masterVolume > 1) throw new RangeError('Rack masterVolume must be in [0, 1].');
  const rack = new ScoreRackModule(context, {id: record.id});
  try { rack.setMasterVolume(masterVolume); }
  catch (error) { rack.dispose(); throw error; }
  return {
    module: rack, ports: audioInsert, getInput: name => name === 'input' ? rack.input : undefined,
    childContext: child => child.derive({id: child.id, target: rack, admit: (module, port) => {
      const lease = rack.admit(module, port);
      try {
        const state = channels[module.id];
        if (state?.volume !== undefined) rack.setVolume(module.id, state.volume);
        if (state?.muted !== undefined) rack.mute(module.id, state.muted);
        if (state?.solo !== undefined) rack.solo(module.id, state.solo);
        if (!lease.active) throw new Error('Rack channel admission was cancelled.');
        return lease;
      } catch (error) { try { lease.release(); } catch { /* Preserve admission failure. */ } throw error; }
    }}),
    exportConfig: () => ({...record.config, masterVolume: rack.masterVolume,
      channels: {...Object.fromEntries(Object.entries(channels).map(([id, state]) => [id, {...state}])), ...Object.fromEntries(rack.list().map(channel => [channel.id, {volume: channel.volume, muted: channel.muted, solo: channel.solo}]))}}),
    dispose: () => rack.dispose(),
  };
}

function createInsert({context, record}: ProjectFactoryRequest, recipe: Effect): ProjectModuleInstance {
  let chain: InsertChain | undefined;
  let port: AudioOutputPort | undefined;
  let route: ConnectionLease | undefined;
  let disposed = false;
  let preparing = false;
  const module: ModuleHandle = {
    id: record.id,
    get params() { return chain?.instances[0]?.params; },
    get inserts() { return chain; },
    getPort: name => name === 'output' ? port : undefined,
    prepare: () => {
      if (disposed) throw new Error('Project insert has been disposed.');
      if (chain) return;
      if (preparing) throw new Error('Project insert preparation cannot re-enter.');
      preparing = true;
      let candidate: InsertChain | undefined;
      let candidateRoute: ConnectionLease | undefined;
      let candidatePort: AudioOutputPort | undefined;
      try {
        candidate = new InsertChain(context.audio.prepare());
        candidate.setSlot({id: 'effect', recipe});
        candidatePort = new AudioOutputPort(candidate.output, {id: `${record.id}:output`});
        candidateRoute = normalRoute(context, module, candidatePort);
        if (disposed || !candidateRoute.active) throw new Error('Project insert admission was cancelled.');
        chain = candidate; port = candidatePort; route = candidateRoute;
      } catch (error) {
        try { candidateRoute?.release(); } catch { /* Preserve preparation failure. */ }
        try { candidatePort?.dispose(); } catch { /* Preserve preparation failure. */ }
        try { candidate?.dispose(); } catch { /* Preserve preparation failure. */ }
        throw error;
      } finally { preparing = false; }
    },
  };
  const registration = context.registry.register(module);
  return {
    module, ports: audioInsert, getInput: name => name === 'input' ? chain?.input : undefined,
    childContext: child => child.derive({id: child.id, target: module, admit: null, destination: () => chain?.input}),
    exportConfig: () => record.config,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clean([() => route?.release(), () => registration?.release(), () => port?.dispose(), () => chain?.dispose()]);
    },
  };
}

function createLfo({context, record}: ProjectFactoryRequest): ProjectModuleInstance {
  let lfo: SessionLFO | undefined;
  let params: ParamSurface | undefined;
  let disposed = false;
  let preparing = false;
  const module: ModuleHandle = {
    id: record.id,
    get params() { return params; },
    prepare: () => {
      if (disposed) throw new Error('Project LFO has been disposed.');
      if (lfo) return;
      if (preparing) throw new Error('Project LFO preparation cannot re-enter.');
      if (!context.session) throw new Error('A project LFO requires a Session.');
      const loop = record.config.loop ?? 'repeat';
      if (loop !== 'repeat' && loop !== 'once') throw new TypeError('LFO loop must be repeat or once.');
      preparing = true;
      try {
        const candidate = new SessionLFO(context.audio.prepare(), context.session.scheduling, {
          frequency: number(record.config, 'frequency', 1), phase: number(record.config, 'phase', 0),
          waveform: waveform(record.config.waveform), loop,
        });
        if (disposed) { candidate.dispose(); throw new Error('Project LFO preparation was cancelled.'); }
        lfo = candidate;
        params = new ParamSurface([lfo.frequency, lfo.phase]);
      } finally { preparing = false; }
    },
  };
  const registration = context.registry.register(module);
  return {
    module, ports: [{id: 'output', direction: 'output', kind: 'control'}],
    getControl: name => name === 'output' ? lfo?.signal : undefined,
    exportConfig: () => ({...record.config, waveform: lfo?.waveform ?? waveform(record.config.waveform)}),
    dispose: () => { if (disposed) return; disposed = true; clean([() => registration.release(), () => lfo?.dispose()]); },
  };
}

function normalRoute(context: ModuleContext, module: ModuleHandle, port: AudioOutputPort): ConnectionLease {
  if (context.admit) return context.admit(module, port);
  const destination = context.destination?.() ?? context.audio.prepare().destination;
  port.setDefault(destination);
  return createConnectionLease(() => {
    if (!port.disposed && port.defaultDestination === destination) port.setDefault(undefined);
  });
}

function effectRecipe(config: ProjectJsonObject): Effect {
  const options = config.options ?? {};
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Effect options must be an object.');
  const values = options as ProjectJsonObject;
  const numeric = (keys: readonly string[]) => Object.fromEntries(keys.filter(key => values[key] !== undefined).map(key => [key, number(values, key, 0)]));
  switch (config.type) {
    case 'gain': return Effect.gain(number(values, 'gain', 1));
    case 'delay': return Effect.delay(numeric(['delaySeconds', 'feedback', 'wet', 'dry']));
    case 'compressor': return Effect.compressor(numeric(['threshold', 'knee', 'ratio', 'attack', 'release']));
    case 'reverb': return Effect.reverb(numeric(['seconds', 'decay', 'wet', 'dry']));
    case 'filter': {
      const type = values.type ?? 'lowpass';
      if (!['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'].includes(String(type))) throw new TypeError('Unsupported filter type.');
      return Effect.filter({...numeric(['frequency', 'Q', 'gain']), type: type as BiquadFilterType});
    }
    default: throw new TypeError('Unsupported project effect type.');
  }
}

function number(config: ProjectJsonObject, key: string, fallback: number): number {
  const value = config[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number.`);
  return value;
}

function waveform(value: unknown): Exclude<OscillatorType, 'custom'> {
  const accepted = value ?? 'sine';
  if (!['sine', 'square', 'sawtooth', 'triangle'].includes(String(accepted))) throw new TypeError('Unsupported oscillator waveform.');
  return accepted as Exclude<OscillatorType, 'custom'>;
}

function clean(callbacks: readonly (() => void)[]): void {
  let failure: unknown;
  for (const callback of callbacks) { try { callback(); } catch (error) { failure ??= error; } }
  if (failure !== undefined) throw failure;
}
