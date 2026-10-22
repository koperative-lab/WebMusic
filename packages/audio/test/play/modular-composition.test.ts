// @vitest-environment jsdom
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {AudioOutputPort, ModuleAudioEnvironment, ModuleContext, type ModuleHandle} from '@webmusic/kernel/module';
import {notifyModuleContext, provideModuleContext} from '@webmusic/kernel/element';
import {SessionTransport} from '@webmusic/kernel/session';
import {createAudioClip, type AudioClip} from '../../src/core';
import {AudioPlayer} from '../../src/play/headless/audio-player';
import {AudioMixer} from '../../src/play/headless/mixer';
import {gain} from '../../src/play/headless/effects';
import {AudioPlayerElement, defineAudioPlayerElement} from '../../src/play/element/audio-player';
import {AudioMixerElement, defineAudioMixerElement} from '../../src/play/element/audio-mixer';
import {AudioEffectElement, defineAudioEffectElement} from '../../src/play/element/audio-effect';
import {bindModuleAudioInput} from '../../src/play/element/internal/module-input';

interface PendingLoad {src: string; signal?: AbortSignal; context?: BaseAudioContext; resolve(clip: AudioClip): void; reject(error: unknown): void}
const loads = vi.hoisted(() => [] as PendingLoad[]);
vi.mock('../../src/play/api/load', () => ({
  loadClipFromUrl: vi.fn((src: string, options?: {signal?: AbortSignal; context?: BaseAudioContext}) => new Promise<AudioClip>((resolve, reject) => {
    loads.push({src, signal: options?.signal, context: options?.context, resolve, reject});
  })),
  loadClip: vi.fn(),
}));

class GraphNode {
  readonly connections = new Set<GraphNode>();
  gain = {value: 1}; pan = {value: 0}; playbackRate = {value: 1};
  fftSize = 2048; smoothingTimeConstant = 0.8;
  frequencyBinCount = 1024;
  start = vi.fn(); stop = vi.fn();
  constructor(readonly context: GraphContext) {}
  connect(destination: GraphNode): GraphNode { this.connections.add(destination); return destination; }
  disconnect(destination?: GraphNode): void {
    if (destination) this.connections.delete(destination); else this.connections.clear();
  }
  getFloatTimeDomainData(values: Float32Array): void { values.fill(0); }
  getByteFrequencyData(values: Uint8Array): void { values.fill(0); }
}
class GraphContext {
  currentTime = 0; state = 'running'; sampleRate = 1000;
  destination = new GraphNode(this);
  nodes: GraphNode[] = [];
  close = vi.fn(async () => {}); resume = vi.fn(async () => {});
  createGain = vi.fn(() => this.node());
  createStereoPanner = vi.fn(() => this.node());
  createAnalyser = vi.fn(() => this.node());
  createBufferSource = vi.fn(() => this.node());
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length)};
  }
  private node(): GraphNode { const node = new GraphNode(this); this.nodes.push(node); return node; }
  get audio(): AudioContext { return this as unknown as AudioContext; }
}
const clip = () => createAudioClip({sampleRate: 1000, channelData: [new Float32Array(2000)]});
function paths(node: GraphNode, destination: GraphNode, visited = new Set<GraphNode>()): number {
  if (node === destination) return 1;
  if (visited.has(node)) throw new Error('Unexpected cycle');
  const next = new Set(visited).add(node);
  return [...node.connections].reduce((count, output) => count + paths(output, destination, next), 0);
}
function player(): AudioPlayerElement { return document.createElement('audio-player') as AudioPlayerElement; }
function mixer(): AudioMixerElement { return document.createElement('audio-mixer') as AudioMixerElement; }
beforeAll(() => { defineAudioPlayerElement(); defineAudioMixerElement(); defineAudioEffectElement(); });
afterEach(() => { document.body.replaceChildren(); loads.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('modular Audio composition', () => {
  it('loads late-upgraded legacy src markup once and owns its single context', async () => {
    const contexts: GraphContext[] = [];
    vi.stubGlobal('AudioContext', class extends GraphContext {
      constructor() { super(); contexts.push(this); }
    });
    const host = document.createElement('section');
    host.innerHTML = '<late-legacy-audio src="legacy.wav"></late-legacy-audio>';
    document.body.append(host);
    customElements.define('late-legacy-audio', class extends AudioPlayerElement {});
    const leaf = host.firstElementChild as AudioPlayerElement;
    expect(contexts).toHaveLength(1);
    expect(loads).toHaveLength(1);
    expect(loads[0]!.signal!.aborted).toBe(false);
    loads[0]!.resolve(clip());
    await vi.waitFor(() => expect(leaf.clip).toBeDefined());
    await leaf.play();
    expect(leaf.player!.outputPort!.context).toBe(contexts[0]!.audio);
    host.remove();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
  });

  it('loads existing src markup once on late upgrade using the foreign provider context', async () => {
    const context = new GraphContext();
    const unexpectedContexts: GraphContext[] = [];
    vi.stubGlobal('AudioContext', class extends GraphContext {
      constructor() { super(); unexpectedContexts.push(this); }
    });
    const session = new SessionTransport(() => context.currentTime);
    const desk = new AudioMixer({audioContext: context.audio});
    const scope = new ModuleContext({id: 'foreign-score-rack', audio: new ModuleAudioEnvironment({context: context.audio}), session,
      admit: (module, port) => desk.admitAudio(module.id, port)});
    const host = document.createElement('section'); host.setAttribute('composition', 'modules');
    host.innerHTML = '<late-audio-src src="nested.wav" volume="0.3"></late-audio-src>';
    const release = provideModuleContext(host, () => scope);
    document.body.append(host);
    customElements.define('late-audio-src', class extends AudioPlayerElement {});
    const leaf = host.firstElementChild as AudioPlayerElement;
    expect(loads).toHaveLength(1);
    expect(loads[0]!.context).toBe(context.audio);
    expect(loads[0]!.signal!.aborted).toBe(false);
    expect(unexpectedContexts).toHaveLength(0);
    expect(session.snapshot.pendingSourceCount).toBe(1);
    loads[0]!.resolve(clip());
    await session.play();
    expect(leaf.player!.outputPort!.context).toBe(context.audio);
    expect(desk.ids()).toEqual([leaf.module!.id]);
    expect(paths(leaf.player!.outputPort!.node as unknown as GraphNode, context.destination)).toBe(1);
    host.remove(); release(); desk.dispose(); session.dispose();
  });

  it('waits for an unupgraded foreign boundary before loading src or minting a context', async () => {
    const context = new GraphContext();
    const unexpectedContexts: GraphContext[] = [];
    vi.stubGlobal('AudioContext', class extends GraphContext {
      constructor() { super(); unexpectedContexts.push(this); }
    });
    const session = new SessionTransport(() => context.currentTime);
    const scope = new ModuleContext({id: 'late-foreign-rack', audio: new ModuleAudioEnvironment({context: context.audio}), session});
    const host = document.createElement('section'); host.setAttribute('composition', 'modules');
    host.innerHTML = '<late-foreign-rack><audio-before-rack src="delayed.wav"></audio-before-rack></late-foreign-rack>';
    document.body.append(host);
    customElements.define('audio-before-rack', class extends AudioPlayerElement {});
    const leaf = host.querySelector('audio-before-rack') as AudioPlayerElement;
    expect(leaf.player).toBeUndefined();
    expect(loads).toHaveLength(0);
    expect(unexpectedContexts).toHaveLength(0);
    customElements.define('late-foreign-rack', class extends HTMLElement {
      private release?: () => void;
      connectedCallback() { this.release = provideModuleContext(this, () => scope); }
      disconnectedCallback() { this.release?.(); }
    });
    await vi.waitFor(() => expect(loads).toHaveLength(1));
    expect(loads[0]!.context).toBe(context.audio);
    expect(unexpectedContexts).toHaveLength(0);
    expect(session.snapshot.pendingSourceCount).toBe(1);
    loads[0]!.resolve(clip());
    await session.play();
    expect(leaf.player!.playing).toBe(true);
    expect(leaf.player!.outputPort!.context).toBe(context.audio);
    host.remove(); session.dispose();
  });

  it('upgrades a preassigned clip into the inherited module context without a legacy player', async () => {
    const context = new GraphContext();
    const options: Array<{audioContext?: AudioContext; moduleContext?: ModuleContext}> = [];
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = document.createElement('late-audio-clip') as AudioPlayerElement;
    leaf.clip = clip(); root.append(leaf); document.body.append(root);
    customElements.define('late-audio-clip', class extends AudioPlayerElement {
      protected override createPlayer(source: AudioClip | undefined, configuration: ConstructorParameters<typeof AudioPlayer>[1]) {
        options.push(configuration!);
        return super.createPlayer(source, configuration!);
      }
    });
    expect(options).toHaveLength(1);
    expect(options[0]!.moduleContext).toBeDefined();
    await root.play();
    expect(leaf.player!.outputPort!.context).toBe(context.audio);
  });

  it('keeps pending src duration unknown and waits before starting the complete Session', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const ready = player(); ready.clip = clip();
    const loading = player(); loading.setAttribute('src', 'pending.wav');
    root.append(ready, loading); document.body.append(root);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(1);
    expect(root.sessionTransport!.snapshot.pendingSourceCount).toBe(1);
    expect(root.sessionTransport!.snapshot.durationSeconds).toBeNull();
    let started = false;
    const playing = root.play().then(() => { started = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(started).toBe(false);
    expect(ready.player!.playing).toBe(false);
    loads[0]!.resolve(clip());
    await playing;
    expect(root.sessionTransport!.snapshot.pendingSourceCount).toBe(0);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(2);
    expect(root.sessionTransport!.snapshot.durationSeconds).toBe(2);
    expect(ready.player!.playing).toBe(true);
    expect(loading.player!.playing).toBe(true);
  });

  it('keeps failed src blocking until retry and ignores stale loading generations', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.setAttribute('src', 'broken.wav'); root.append(leaf); document.body.append(root);
    const failure = new Error('download failed');
    loads[0]!.reject(failure);
    await Promise.resolve(); await Promise.resolve();
    await expect(root.preload()).rejects.toBe(failure);
    expect(root.sessionTransport!.snapshot.pendingSourceCount).toBe(1);
    leaf.setAttribute('src', 'slow.wav');
    leaf.setAttribute('src', 'current.wav');
    expect(loads[1]!.signal!.aborted).toBe(true);
    loads[1]!.resolve(clip());
    await Promise.resolve(); await Promise.resolve();
    expect(root.sessionTransport!.snapshot.pendingSourceCount).toBe(1);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
    const preload = root.preload();
    loads[2]!.resolve(clip());
    await preload;
    expect(root.sessionTransport!.snapshot.pendingSourceCount).toBe(0);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(1);
  });

  it('releases pending src on detach without waiting for its request to settle', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.setAttribute('src', 'cancelled.wav'); root.append(leaf); document.body.append(root);
    const preload = root.preload();
    leaf.remove();
    await preload;
    expect(loads[0]!.signal!.aborted).toBe(true);
    expect(root.sessionTransport!.snapshot.pendingSourceCount).toBe(0);
    loads[0]!.resolve(clip());
    await Promise.resolve(); await Promise.resolve();
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
  });

  it('has a source-free Session and one routed leaf, with no graph allocated by discovery', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const desk = mixer(); const leaf = player(); leaf.clip = clip();
    desk.append(leaf); root.append(desk); document.body.append(root);
    expect(root.clip).toBeUndefined();
    expect(root.module?.getPort?.('output')).toBeUndefined();
    expect(context.nodes).toHaveLength(0);
    expect(root.sessionTransport?.snapshot.participantCount).toBe(1);
    expect(leaf.sessionTransport).toBe(root.sessionTransport);
    const runtime = leaf.player!;
    await root.play();
    expect(leaf.player).toBe(runtime);
    expect(runtime.playing).toBe(true);
    expect(desk.mixer!.ids()).toEqual([leaf.module!.id]);
    const output = leaf.module!.getPort!('output')!;
    expect(output.node).not.toBe(desk.module!.getPort!('master')!.node);
    expect((output.node as unknown as GraphNode).connections.has(context.destination)).toBe(false);
    expect(paths(output.node as unknown as GraphNode, context.destination)).toBe(1);
    expect(leaf.getAttribute('data-controls')).toBe('hidden');
    expect(root.getAttribute('data-controls')).toBeNull();
    expect(root.shadowRoot?.querySelector('slot')).not.toBeNull();
    await root.sessionTransport!.pause();
    expect(runtime.playing).toBe(false);
    root.remove();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('sums a nested mixer once and preserves a borrowed player after detach', async () => {
    const context = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: context.audio});
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const outer = mixer(); const inner = mixer(); const leaf = player(); leaf.player = borrowed;
    inner.append(leaf); outer.append(inner); root.append(outer); document.body.append(root);
    await root.play();
    expect(root.sessionTransport!.snapshot.participantCount).toBe(1);
    expect(outer.mixer!.ids()).toEqual([inner.module!.id]);
    expect(inner.mixer!.ids()).toEqual([leaf.module!.id]);
    const output = borrowed.outputPort!;
    expect(paths(output.node as unknown as GraphNode, context.destination)).toBe(1);
    leaf.remove();
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
    expect(output.disposed).toBe(false);
    expect(paths(output.node as unknown as GraphNode, context.destination)).toBe(0);
    expect(borrowed.clip).toBeDefined();
    expect(context.close).not.toHaveBeenCalled();
    borrowed.dispose();
  });

  it('keeps a source-owning root and child master on separate upstream routes', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio; root.clip = clip();
    const desk = mixer(); const leaf = player(); leaf.clip = clip();
    desk.append(leaf); root.append(desk); document.body.append(root);
    await root.play();
    expect(root.sessionTransport!.snapshot.participantCount).toBe(2);
    const rootPort = root.module!.getPort!('output')!;
    const deskPort = desk.module!.getPort!('master')!;
    expect((rootPort.node as unknown as GraphNode).connections.has(context.destination)).toBe(true);
    expect((deskPort.node as unknown as GraphNode).connections.has(context.destination)).toBe(true);
    expect(desk.mixer!.ids()).toEqual([leaf.module!.id]);
  });

  it('rebinds a borrowed leaf when the mounted mixer runtime is replaced', async () => {
    const context = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: context.audio});
    const first = new AudioMixer({audioContext: context.audio});
    const second = new AudioMixer({audioContext: context.audio});
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const desk = mixer(); desk.mixer = first;
    const leaf = player(); leaf.player = borrowed;
    desk.append(leaf); root.append(desk); document.body.append(root);
    await root.play();
    desk.mixer = second;
    await vi.waitFor(() => expect(second.ids()).toEqual([leaf.module!.id]));
    expect(first.ids()).toEqual([]);
    expect(leaf.player).toBe(borrowed);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(1);
    expect(paths(borrowed.outputPort!.node as unknown as GraphNode, context.destination)).toBe(1);
    root.remove(); borrowed.dispose(); first.dispose(); second.dispose();
  });

  it('keeps an explicitly local child Session outside the ancestor participant set', () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.setAttribute('session', 'local'); leaf.clip = clip();
    root.append(leaf); document.body.append(root);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
    expect(leaf.sessionTransport!.snapshot.participantCount).toBe(1);
    expect(leaf.sessionTransport).not.toBe(root.sessionTransport);
  });

  it('rejects foreign contexts without suppressing an existing default output', () => {
    const sourceContext = new GraphContext(); const other = new GraphContext();
    const source = sourceContext.createGain();
    const port = new AudioOutputPort(source as unknown as AudioNode, {defaultDestination: sourceContext.destination as unknown as AudioNode});
    const desk = new AudioMixer({audioContext: other.audio});
    expect(() => desk.admitAudio('foreign', port)).toThrow('AudioContext');
    expect(paths(source, sourceContext.destination)).toBe(1);
    expect(desk.ids()).toEqual([]);
    desk.dispose(); port.dispose();
  });

  it('still rejects an explicitly borrowed player from another context', async () => {
    const scopeContext = new GraphContext(); const foreignContext = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: foreignContext.audio});
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = scopeContext.audio;
    const leaf = player(); leaf.player = borrowed; root.append(leaf); document.body.append(root);
    await expect(root.preload()).rejects.toThrow('must share the module AudioContext');
    expect(leaf.player).toBe(borrowed);
    expect(foreignContext.close).not.toHaveBeenCalled();
    root.remove(); borrowed.dispose();
  });

  it('allows explicit replacement over a normalled channel and leaves it intact on detach', () => {
    const context = new GraphContext(); const source = context.createGain();
    const port = new AudioOutputPort(source as unknown as AudioNode, {defaultDestination: context.destination as unknown as AudioNode});
    const desk = new AudioMixer({audioContext: context.audio});
    const admission = desk.admitAudio('voice', port);
    const channelInserts = desk.channelInserts('voice')!;
    channelInserts.replace([{id: 'channel-gain', recipe: gain(0.25)}]);
    const channelFader = port.defaultDestination as unknown as GraphNode;
    expect(channelFader.connections.has(channelInserts.input as unknown as GraphNode)).toBe(true);
    expect(paths(source, channelInserts.instances[0]!.nodes.input as unknown as GraphNode)).toBe(1);
    expect(paths(channelInserts.output as unknown as GraphNode, desk.insertChain.input as unknown as GraphNode)).toBe(1);
    const explicit = context.createGain(); explicit.connect(context.destination);
    const patch = port.replace(explicit as unknown as AudioNode);
    expect(paths(source, context.destination)).toBe(1);
    expect(paths(source, channelFader)).toBe(0);
    admission.release();
    expect(channelInserts.disposed).toBe(true);
    expect(desk.channelInserts('voice')).toBeUndefined();
    expect(paths(source, context.destination)).toBe(1);
    patch.release();
    expect(paths(source, context.destination)).toBe(0);
    desk.dispose(); port.dispose();
  });

  it('keeps a newer default intact when an old channel lease is released', () => {
    const context = new GraphContext(); const source = context.createGain();
    const port = new AudioOutputPort(source as unknown as AudioNode);
    const oldDesk = new AudioMixer({audioContext: context.audio});
    const newDesk = new AudioMixer({audioContext: context.audio});
    const oldAdmission = oldDesk.admitAudio('voice', port);
    const newAdmission = newDesk.admitAudio('voice', port);
    const current = port.defaultDestination;
    oldAdmission.release();
    expect(port.defaultDestination).toBe(current);
    expect(paths(source, context.destination)).toBe(1);
    newAdmission.release();
    expect(paths(source, context.destination)).toBe(0);
    oldDesk.dispose(); newDesk.dispose(); port.dispose();
  });

  it('withdraws default routes from borrowed root players and mixers on detach', async () => {
    const context = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: context.audio});
    const root = player(); root.setAttribute('composition', 'modules'); root.player = borrowed;
    document.body.append(root); await root.play();
    const source = borrowed.outputPort!;
    root.remove();
    expect(source.disposed).toBe(false);
    expect(paths(source.node as unknown as GraphNode, context.destination)).toBe(0);
    const borrowedMixer = new AudioMixer({audioContext: context.audio});
    const desk = mixer(); desk.setAttribute('composition', 'modules'); desk.mixer = borrowedMixer;
    document.body.append(desk); await desk.module!.prepare!();
    const master = borrowedMixer.outputPort;
    expect(paths(master.node as unknown as GraphNode, context.destination)).toBe(1);
    desk.remove();
    expect(master.disposed).toBe(false);
    expect(paths(master.node as unknown as GraphNode, context.destination)).toBe(0);
    expect(context.close).not.toHaveBeenCalled();
    borrowed.dispose(); borrowedMixer.dispose();
  });

  it('changes a mounted borrowed leaf to a local Session and back', async () => {
    const context = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: context.audio});
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.player = borrowed; root.append(leaf); document.body.append(root);
    await root.play();
    leaf.setAttribute('session', 'local');
    await vi.waitFor(() => expect(leaf.sessionTransport!.snapshot.participantCount).toBe(1));
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
    expect(leaf.sessionTransport).not.toBe(root.sessionTransport);
    expect(leaf.player).toBe(borrowed);
    await leaf.play();
    leaf.removeAttribute('session');
    await vi.waitFor(() => expect(root.sessionTransport!.snapshot.participantCount).toBe(1));
    expect(leaf.sessionTransport).toBe(root.sessionTransport);
    expect(leaf.player).toBe(borrowed);
    root.remove(); borrowed.dispose();
  });

  it('withdraws routes and can retry a failed legacy borrowed participant cancellation', async () => {
    const context = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: context.audio});
    // Exercise fallback transport cancellation independently of native Session
    // attachment, whose lease never calls the participant's local pause().
    vi.spyOn(borrowed, 'timingCapabilities', 'get').mockReturnValue({engine: 'external', sharedSessionClock: false, futureStart: false, nativeLoop: false});
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.player = borrowed; root.append(leaf); document.body.append(root);
    await root.play();
    const output = borrowed.outputPort!;
    const pause = vi.spyOn(borrowed, 'pause').mockImplementation(() => { throw new Error('cannot pause'); });
    const errors = vi.fn(); leaf.addEventListener('webaudio:error', errors);
    leaf.remove();
    expect(errors).toHaveBeenCalled();
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
    expect(paths(output.node as unknown as GraphNode, context.destination)).toBe(0);
    expect(leaf.module).toBeUndefined();
    pause.mockRestore();
    root.append(leaf);
    await vi.waitFor(() => expect(root.sessionTransport!.snapshot.participantCount).toBe(1));
    await root.play();
    expect(paths(output.node as unknown as GraphNode, context.destination)).toBe(1);
    root.remove(); borrowed.dispose();
  });

  it('detaches a shared-clock borrowed leaf by lease without calling local transport commands', async () => {
    const context = new GraphContext();
    const borrowed = new AudioPlayer(clip(), {audioContext: context.audio});
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.player = borrowed; root.append(leaf); document.body.append(root);
    await root.play();
    const output = borrowed.outputPort!;
    const pause = vi.spyOn(borrowed, 'pause').mockImplementation(() => { throw new Error('local authority is forbidden'); });
    const state = root.sessionTransport!.clock.state;
    const errors = vi.fn(); leaf.addEventListener('webaudio:error', errors);
    leaf.remove();
    expect(pause).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(borrowed.followsSession).toBe(false);
    expect(borrowed.playing).toBe(false);
    expect(root.sessionTransport!.clock.state).toEqual(state);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(0);
    expect(paths(output.node as unknown as GraphNode, context.destination)).toBe(0);
    expect(context.close).not.toHaveBeenCalled();
    pause.mockRestore(); root.remove(); borrowed.dispose();
  });

  it('realizes local and master declarations on the existing chains, with shared live parameters', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const desk = mixer(); const leaf = player(); leaf.clip = clip();
    const local = document.createElement('audio-effect') as AudioEffectElement;
    const master = document.createElement('audio-effect') as AudioEffectElement;
    local.setAttribute('type', 'gain'); master.setAttribute('type', 'gain'); master.slot = 'master';
    leaf.append(local); desk.append(leaf, master); root.append(desk); document.body.append(root);
    expect(local.module).toBeUndefined();
    await root.play();
    expect(local.module).toBeDefined(); expect(master.module).toBeDefined();
    expect(leaf.player!.insertChain!.instances).toHaveLength(1);
    expect(desk.mixer!.insertChain.instances).toHaveLength(1);
    expect(local.module!.id).toBe(leaf.player!.insertChain!.instances[0]!.id);
    const parameter = local.module!.params!.get('gain')!;
    const starts = context.createBufferSource.mock.results.length;
    parameter.setBaseValue(0.4);
    expect(leaf.player!.insertChain!.instances[0]!.params.get('gain')).toBe(parameter);
    expect(parameter.snapshot.baseValue).toBe(0.4);
    expect(context.createBufferSource.mock.results).toHaveLength(starts);
    expect(paths(leaf.player!.outputPort!.node as unknown as GraphNode, context.destination)).toBe(1);
  });
});

describe('neutral module audio taps', () => {
  it('observes readiness without preparing the source or allocating audio on discovery', () => {
    const context = new GraphContext();
    const state: {port?: AudioOutputPort} = {};
    let changed: (() => void) | undefined;
    const prepare = vi.fn(); const unsubscribe = vi.fn();
    const module: ModuleHandle = {
      id: 'late-master', prepare,
      getPort: () => state.port,
      subscribe: (listener) => { changed = listener; return unsubscribe; },
    };
    const host = document.createElement('div');
    let analyser: AnalyserNode | undefined;
    const release = bindModuleAudioInput(host, module, (input) => { analyser = input.analyser; });
    expect(prepare).not.toHaveBeenCalled();
    expect(context.nodes).toHaveLength(0);
    expect(analyser).toBeUndefined();
    const source = context.createGain();
    state.port = new AudioOutputPort(source as unknown as AudioNode);
    changed!();
    expect(analyser).toBeDefined();
    expect(prepare).not.toHaveBeenCalled();
    release();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(source.connections.size).toBe(0);
    state.port.dispose();
  });

  it('taps a named port without taking the main route or disposing the source', async () => {
    const context = new GraphContext(); const source = context.createGain();
    const port = new AudioOutputPort(source as unknown as AudioNode, {defaultDestination: context.destination as unknown as AudioNode});
    const module: ModuleHandle = {id: 'score-rack-master', getPort: (name) => name === 'master' ? port : undefined};
    const host = document.createElement('div'); host.setAttribute('port', 'master'); document.body.append(host);
    let analyser: AnalyserNode | undefined;
    const release = bindModuleAudioInput(host, module, (input) => { analyser = input.analyser; });
    await vi.waitFor(() => expect(analyser).toBeDefined());
    expect(source.connections.size).toBe(2);
    expect(source.connections.has(context.destination)).toBe(true);
    release(); release();
    expect(source.connections.size).toBe(1);
    expect(port.disposed).toBe(false);
    expect(context.close).not.toHaveBeenCalled();
    port.dispose();
  });

  it('keeps an explicitly missing selector unresolved instead of borrowing another module', async () => {
    const host = document.createElement('div'); host.setAttribute('input', '#absent'); document.body.append(host);
    const observed = vi.fn();
    const release = bindModuleAudioInput(host, undefined, observed);
    await Promise.resolve();
    expect(observed).toHaveBeenCalledWith({module: undefined});
    release();
  });
});

describe('modular Audio Session and route ownership', () => {
  it('keeps an inherited leaf from rewriting its provider Session rate or loop', async () => {
    const context = new GraphContext();
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    root.setAttribute('rate', '1.5');
    const leaf = player(); leaf.clip = clip();
    leaf.setAttribute('rate', '0.5'); leaf.setAttribute('loop', '');
    root.append(leaf); document.body.append(root);
    const session = root.sessionTransport!;
    expect(leaf.sessionTransport).toBe(session);
    await vi.waitFor(() => expect(session.snapshot.rate).toBe(1.5));
    leaf.setAttribute('rate', '2');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.snapshot.rate).toBe(1.5);
    expect(session.snapshot.loop).toBeNull();
    root.setAttribute('rate', '0.75');
    root.setAttribute('loop', '');
    await vi.waitFor(() => expect(session.snapshot.rate).toBe(0.75));
    await vi.waitFor(() => expect(session.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 2}));
  });

  it('re-routes an inherited leaf when its provider publishes a new destination', async () => {
    const context = new GraphContext();
    const session = new SessionTransport(() => context.currentTime);
    const first = context.createGain();
    const second = context.createGain();
    const audio = new ModuleAudioEnvironment({context: context.audio});
    let scope = new ModuleContext({id: 'routed-scope', audio, session, destination: () => first as unknown as AudioNode});
    const host = document.createElement('section'); host.setAttribute('composition', 'modules');
    const leaf = player(); leaf.clip = clip(); host.append(leaf);
    const release = provideModuleContext(host, () => scope);
    document.body.append(host);
    await session.play();
    const engine = leaf.player!;
    const output = engine.outputPort!;
    expect(output.defaultDestination).toBe(first);
    scope = scope.derive({id: 'rerouted-scope', destination: () => second as unknown as AudioNode});
    notifyModuleContext(host);
    // Re-routed in place: same engine, port and Session membership, still playing.
    expect(leaf.player).toBe(engine);
    expect(output.defaultDestination).toBe(second);
    expect(paths(output.node as unknown as GraphNode, first)).toBe(0);
    expect(session.snapshot.participantCount).toBe(1);
    expect(engine.playing).toBe(true);
    host.remove(); release(); session.dispose();
  });

  it('keeps a desk and its channel mix when the provider changes only its destination', async () => {
    const context = new GraphContext();
    const session = new SessionTransport(() => context.currentTime);
    const first = context.createGain();
    const second = context.createGain();
    let scope = new ModuleContext({id: 'desk-scope', audio: new ModuleAudioEnvironment({context: context.audio}), session,
      destination: () => first as unknown as AudioNode});
    const host = document.createElement('section'); host.setAttribute('composition', 'modules');
    const desk = mixer(); const leaf = player(); leaf.clip = clip();
    desk.append(leaf); host.append(desk);
    const release = provideModuleContext(host, () => scope);
    document.body.append(host);
    await session.play();
    const engine = desk.mixer!;
    const channel = leaf.module!.id;
    engine.setVolume(channel, 0.25);
    expect(engine.outputPort.defaultDestination).toBe(first);
    scope = scope.derive({id: 'desk-rerouted', destination: () => second as unknown as AudioNode});
    notifyModuleContext(host);
    expect(desk.mixer).toBe(engine);
    expect(engine.outputPort.defaultDestination).toBe(second);
    expect(paths(engine.outputPort.node as unknown as GraphNode, first)).toBe(0);
    expect(engine.snapshot().members.find((member) => member.id === channel)?.volume).toBe(0.25);
    expect(leaf.player!.playing).toBe(true);
    host.remove(); release(); session.dispose();
  });

  it('reports every failed activation attempt of an inherited leaf', async () => {
    const context = new GraphContext();
    context.state = 'suspended';
    context.resume = vi.fn(async () => { throw new Error('gesture required'); });
    const root = player(); root.setAttribute('composition', 'modules'); root.audioContext = context.audio;
    const leaf = player(); leaf.clip = clip();
    root.append(leaf); document.body.append(root);
    const errors: unknown[] = [];
    leaf.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    await expect(root.play()).rejects.toThrow('gesture required');
    await expect(root.play()).rejects.toThrow('gesture required');
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error instanceof Error && error.message === 'gesture required')).toBe(true);
  });

  it('keeps an effect assigned while the owned player drives a borrowed mix', async () => {
    const context = new GraphContext();
    const element = player(); element.audioContext = context.audio; element.clip = clip();
    document.body.append(element);
    const desk = new AudioMixer({audioContext: context.audio});
    element.setTransport(desk.transport);
    const recipe = gain({value: 0.5});
    expect(() => { element.effect = recipe; }).not.toThrow();
    expect(element.effect).toBe(recipe);
    element.setTransport(undefined);
    element.clip = clip();
    await element.preload();
    expect(element.player!.insertChain!.instances.map((instance) => instance.recipe)).toEqual([recipe]);
    desk.dispose();
  });

  it('reports a failed module-mode command on the error channel instead of throwing', () => {
    const context = new GraphContext();
    const session = new SessionTransport(() => context.currentTime);
    const scope = new ModuleContext({id: 'closing-scope', audio: new ModuleAudioEnvironment({context: context.audio}), session});
    const host = document.createElement('section'); host.setAttribute('composition', 'modules');
    const leaf = player(); host.append(leaf);
    const release = provideModuleContext(host, () => scope);
    document.body.append(host);
    const errors: unknown[] = [];
    leaf.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    session.dispose();
    expect(() => { leaf.pause(); leaf.stop(); leaf.seek(1); }).not.toThrow();
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBeInstanceOf(Error);
    host.remove(); release();
  });
});
