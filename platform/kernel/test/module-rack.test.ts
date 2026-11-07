import {describe, expect, it, vi} from 'vitest';
import {AudioOutputPort} from '../src/module/audio-port';
import {checkModuleConformance} from '../src/module/conformance';
import {ModuleAudioEnvironment, ModuleContext} from '../src/module/context';
import {RackModule} from '../src/module/rack';
import {createModuleHandle, type ModuleHandle} from '../src/module/registry';

function fixture() {
  const context = {} as AudioContext;
  const edges = new Map<AudioNode, Set<AudioNode>>();
  const node = () => {
    const parameter = () => ({value: 1});
    const result = {context, gain: parameter(), pan: parameter(),
      connect: vi.fn((to: AudioNode) => { edges.get(result)!.add(to); return to; }),
      disconnect: vi.fn((to?: AudioNode) => { if (to) edges.get(result)!.delete(to); else edges.get(result)!.clear(); }),
    } as unknown as GainNode & StereoPannerNode;
    edges.set(result, new Set());
    return result;
  };
  Object.assign(context, {state: 'running', currentTime: 0, destination: node(),
    createGain: vi.fn(node), createStereoPanner: vi.fn(node)});
  const audio = new ModuleAudioEnvironment({context});
  const scope = new ModuleContext({id: 'root', audio});
  const source = (id: string) => {
    const port = new AudioOutputPort(node(), {id: 'main'});
    const module: ModuleHandle = createModuleHandle({id, getPort: () => port});
    return {port, module};
  };
  const reaches = (from: AudioNode, to: AudioNode): boolean => {
    const pending = [from];
    const seen = new Set<AudioNode>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(edges.get(current) ?? []));
    }
    return false;
  };
  return {context, edges, scope, source, reaches};
}

describe('RackModule', () => {
  it('stays unallocated until prepared, then routes channels by module ID through one master', () => {
    const {context, scope, source, reaches} = fixture();
    const rack = new RackModule(scope, {id: 'desk'});
    expect(context.createGain).not.toHaveBeenCalled();
    expect(scope.registry.get('desk')).toBe(rack);
    const lead = source('lead');
    const bass = source('bass');
    const leadLease = rack.admit(lead.module, lead.port);
    rack.admit(bass.module, bass.port);
    expect(rack.list().map(channel => channel.id)).toEqual(['lead', 'bass']);
    expect(reaches(lead.port.node, context.destination)).toBe(true);
    expect(rack.getPort('channel:lead')?.id).toBe('channel:lead');
    expect(rack.ports().map(port => `${port.family}/${port.id}`)).toEqual(['control/params', 'audio/master', 'audio/channel:lead', 'audio/channel:bass']);
    expect(() => rack.admit(lead.module, lead.port)).toThrow(/already has a Rack channel/);
    leadLease.release();
    expect(rack.list().map(channel => channel.id)).toEqual(['bass']);
    expect(lead.port.defaultDestination).toBeUndefined();
    expect(rack.getPort('channel:lead')).toBeUndefined();
  });

  it('applies volume, pan, mute and solo to channel strips', () => {
    const {scope, source} = fixture();
    const rack = new RackModule(scope);
    const lead = source('lead');
    const bass = source('bass');
    rack.admit(lead.module, lead.port);
    rack.admit(bass.module, bass.port);
    const fader = (port: AudioOutputPort) => (port.defaultDestination as GainNode).gain.value;
    rack.setVolume('lead', 0.5);
    rack.setPan('bass', -2);
    expect(rack.channel('bass')?.pan).toBe(-1);
    expect(fader(lead.port)).toBe(0.5);
    rack.solo('bass', true);
    expect(fader(lead.port)).toBe(0);
    expect(fader(bass.port)).toBe(1);
    rack.solo('bass', false);
    rack.mute('lead', true);
    expect(fader(lead.port)).toBe(0);
    rack.setMasterVolume(0.25);
    expect(rack.masterVolume).toBe(0.25);
    expect(rack.params.get('master-volume')?.snapshot.baseValue).toBe(0.25);
  });

  it('nests: a child Rack is admitted once as a channel of its parent', () => {
    const {context, scope, source, reaches} = fixture();
    const outer = new RackModule(scope, {id: 'outer'});
    const inner = new RackModule(outer.context, {id: 'inner'});
    const voice = source('voice');
    inner.admit(voice.module, voice.port);
    expect(outer.list().map(channel => channel.id)).toEqual(['inner']);
    expect(reaches(voice.port.node, context.destination)).toBe(true);
    expect(outer.context.registry.get('inner')).toBe(inner);
    inner.dispose();
    expect(outer.list()).toEqual([]);
  });

  it('passes the module conformance kit', async () => {
    const {scope, source} = fixture();
    const report = await checkModuleConformance(() => {
      const rack = new RackModule(scope, {id: 'desk'});
      const lead = source('lead');
      rack.admit(lead.module, lead.port);
      return {module: rack, dispose: () => rack.dispose()};
    }, {expectedId: 'desk'});
    expect(report.failures).toEqual([]);
  });
});
