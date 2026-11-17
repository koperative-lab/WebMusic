import {AudioOutputPort} from './audio-port';
import {routeModuleOutput} from './context';
import {createConnectionLease, type ConnectionLease} from './lease';
import {ModuleRegistry, type ModuleHandle} from './registry';
import {
  ProjectModuleUnavailableError,
  type ProjectFactoryRequest, type ProjectJsonObject, type ProjectModuleInstance, type ProjectPluginFactory,
} from './project-types';

// ============================================================================
// Multichannel (DEC-077), as Max's MC: one cord carries N channels, and an
// `mc.` object runs one instance of an audio plugin per channel. Web Audio
// connections already carry several channels; this splits them, runs each
// channel through its own instance and merges them again.
// ============================================================================

export const MAX_MC_CHANNELS = 32;

function channelCount(value: unknown): number {
  const channels = Math.trunc(Number(value ?? 2));
  if (!(channels >= 1 && channels <= MAX_MC_CHANNELS)) throw new ProjectModuleUnavailableError(`Multichannel objects take 1 to ${MAX_MC_CHANNELS} channels.`);
  return channels;
}

/**
 * Wrap an audio plugin with one `input` and one `output` as `mc.<id>`: the
 * record's `config.channels` instances, each given `config.config`, process
 * one channel each between a splitter and a merger. The first instance's
 * parameters are the module's; setting one sets it on every channel.
 */
export function multichannelPlugin(inner: ProjectPluginFactory, id = `${inner.id.replace(/^(.*\.)?/, '$1mc.')}`): ProjectPluginFactory {
  return Object.freeze({
    id,
    version: inner.version,
    async create(request: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
      const {record, context} = request;
      const channels = channelCount(record.config.channels);
      const audio = context.audio.prepare();
      const splitter = audio.createChannelSplitter(channels);
      const merger = audio.createChannelMerger(channels);
      const taps = Array.from({length: channels}, () => audio.createGain());
      taps.forEach((tap, channel) => tap.connect(merger, 0, channel));
      const instances: ProjectModuleInstance[] = [];
      const registries: ModuleRegistry[] = [];
      const leases: ConnectionLease[] = [];
      const cleanup = () => {
        for (const lease of leases.splice(0)) { try { lease.release(); } catch { /* Keep releasing. */ } }
        for (const instance of instances.splice(0)) { try { instance.dispose(); } catch { /* Keep releasing. */ } }
        for (const registry of registries.splice(0)) { try { registry.dispose(); } catch { /* Keep releasing. */ } }
        for (const node of [splitter, merger, ...taps]) node.disconnect();
      };
      try {
        for (let channel = 0; channel < channels; channel++) {
          const registry = new ModuleRegistry();
          registries.push(registry);
          // Each instance's output goes to its channel of the merger, not to the context's route.
          const scoped = context.derive({id: `${context.id}/${record.id}.${channel}`, registry, admit: null, destination: () => taps[channel]});
          const config = (record.config.config ?? {}) as ProjectJsonObject;
          instances.push(await inner.create({...request, context: scoped, record: {...record, id: `${record.id}.${channel}`, config}}));
        }
      } catch (error) { cleanup(); throw error; }
      const port = new AudioOutputPort(merger, {id: 'output'});
      const first = instances[0]!.module;
      let disposed = false;
      let mirroring = false;
      const module: ModuleHandle = {
        id: record.id,
        get params() { return first.params; },
        getPort: name => name === 'output' ? port : undefined,
        prepare: async () => {
          if (disposed) return;
          for (const instance of instances) await instance.module.prepare?.();
          instances.forEach((instance, channel) => {
            const input = instance.getInput?.('input');
            if (input) { splitter.connect(input, channel, 0); leases.push(createConnectionLease(() => { try { splitter.disconnect(input); } catch { /* Gone. */ } })); }
          });
          // One parameter, every channel.
          for (const handle of first.params ?? []) {
            leases.push(createConnectionLease(handle.subscribe(snapshot => {
              if (mirroring || snapshot.disposed) return;
              mirroring = true;
              try { for (const instance of instances.slice(1)) instance.module.params?.get(handle.descriptor.id)?.setBaseValue(snapshot.baseValue); }
              finally { mirroring = false; }
            })));
          }
          leases.push(routeModuleOutput(context, module, port));
        },
      };
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'input', label: `${channels} channels in`, kind: 'audio', direction: 'input'}, {id: 'output', label: `${channels} channels out`, kind: 'audio', direction: 'output'}],
        getInput: name => name === 'input' ? splitter : undefined,
        exportConfig: () => record.config,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          registration.release();
          port.dispose();
          cleanup();
        },
      };
    },
  });
}

/**
 * `mc.pack` and `mc.unpack`: N single-channel inlets into one N-channel
 * outlet, and back. Neither follows the default route: a cord sends them on.
 */
export function multichannelPackPlugins(prefix = 'webmusic.object.'): readonly ProjectPluginFactory[] {
  const pack: ProjectPluginFactory = {
    id: `${prefix}mc.pack`, version: '1.0.0',
    create({record, context}) {
      const channels = channelCount(record.config.channels);
      const audio = context.audio.prepare();
      const merger = audio.createChannelMerger(channels);
      const inputs = Array.from({length: channels}, (_, channel) => { const gain = audio.createGain(); gain.channelCount = 1; gain.channelCountMode = 'explicit'; gain.connect(merger, 0, channel); return gain; });
      const port = new AudioOutputPort(merger, {id: 'out0'});
      const module: ModuleHandle = {id: record.id, getPort: name => name === 'out0' ? port : undefined};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [...inputs.map((_, channel) => ({id: `in${channel}`, label: `channel ${channel + 1}`, kind: 'audio' as const, direction: 'input' as const})),
          {id: 'out0', label: `${channels} channels`, kind: 'audio', direction: 'output'}],
        getInput: name => inputs[Number(name.slice(2))],
        exportConfig: () => record.config,
        dispose: () => { registration.release(); port.dispose(); for (const node of [merger, ...inputs]) node.disconnect(); },
      };
    },
  };
  const unpack: ProjectPluginFactory = {
    id: `${prefix}mc.unpack`, version: '1.0.0',
    create({record, context}) {
      const channels = channelCount(record.config.channels);
      const audio = context.audio.prepare();
      const splitter = audio.createChannelSplitter(channels);
      const outputs = Array.from({length: channels}, (_, channel) => { const gain = audio.createGain(); splitter.connect(gain, channel, 0); return gain; });
      const ports = outputs.map((gain, channel) => new AudioOutputPort(gain, {id: `out${channel}`}));
      const module: ModuleHandle = {id: record.id, getPort: name => ports.find(port => port.id === name)};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'in0', label: `${channels} channels`, kind: 'audio', direction: 'input'},
          ...ports.map((_, channel) => ({id: `out${channel}`, label: `channel ${channel + 1}`, kind: 'audio' as const, direction: 'output' as const}))],
        getInput: name => name === 'in0' ? splitter : undefined,
        exportConfig: () => record.config,
        dispose: () => { registration.release(); for (const port of ports) port.dispose(); for (const node of [splitter, ...outputs]) node.disconnect(); },
      };
    },
  };
  return Object.freeze([pack, unpack]);
}
