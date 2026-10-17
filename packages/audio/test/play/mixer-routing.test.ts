import {afterEach, describe, expect, it, vi} from 'vitest';
import {AudioOutputPort} from '@webmusic/kernel/module';
import {createAudioClip} from '../../src/core';
import {AudioMixer} from '../../src/play/headless/mixer';
import {AudioClipPlayer} from '../../src/play/headless/player';
import {AudioPlayer, type AudioPlayerTransport} from '../../src/play/headless/audio-player';
import {AudioPlaylist} from '../../src/play/headless/playlist';

class GraphNode {
  readonly connections = new Set<GraphNode>();
  gain = {value: 1};
  pan = {value: 0};
  playbackRate = {value: 1};
  start = vi.fn();
  stop = vi.fn();
  constructor(readonly context: GraphContext) {}
  connect(destination: GraphNode): GraphNode { this.connections.add(destination); return destination; }
  disconnect(destination?: GraphNode): void {
    if (destination) this.connections.delete(destination);
    else this.connections.clear();
  }
}

class GraphContext {
  currentTime = 0;
  state = 'running';
  sampleRate = 1000;
  destination = new GraphNode(this);
  sources: GraphNode[] = [];
  createGain = () => new GraphNode(this);
  createStereoPanner = () => new GraphNode(this);
  createAnalyser = () => new GraphNode(this);
  createBufferSource = () => {
    const source = new GraphNode(this);
    this.sources.push(source);
    return source;
  };
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: () => new Float32Array(length)};
  }
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  get audio(): AudioContext { return this as unknown as AudioContext; }
}

/** Gain of every actual path, independent of the mixer's state/readback. */
function amplitude(node: GraphNode, destination: GraphNode): number {
  if (node === destination) return 1;
  return node.gain.value * [...node.connections].reduce((sum, next) => sum + amplitude(next, destination), 0);
}
const clip = () => createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000).fill(1)]});
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});
function fixture(masterVolume = 1) {
  const context = new GraphContext();
  const mixer = new AudioMixer({audioContext: context.audio, masterVolume});
  cleanups.push(() => mixer.dispose());
  const port = () => {
    const node = new GraphNode(context);
    const output = new AudioOutputPort(node as unknown as AudioNode);
    cleanups.push(() => output.dispose());
    return {node, output};
  };
  return {context, mixer, port};
}

describe('AudioMixer routed gain ownership', () => {
  it('applies member and master gain once after lazy clip preparation', async () => {
    const {context, mixer} = fixture(0.5);
    mixer.add({id: 'clip', clip: clip(), volume: 0.8});
    expect(context.sources).toHaveLength(0);
    await mixer.play();
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.4, 8);
    mixer.setVolume('clip', 0.3);
    mixer.setMasterVolume(1);
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.3, 8);
  });

  it('restores sound after muting a clip before its first play', async () => {
    const {context, mixer} = fixture(0.5);
    mixer.add({id: 'clip', clip: clip(), volume: 0.8});
    mixer.mute('clip');
    await mixer.play();
    expect(amplitude(context.sources[0]!, context.destination)).toBe(0);
    mixer.unmute('clip');
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.4, 8);
  });

  it.each([false, true])('preserves application-owned source gain with a prepared=%s borrowed player', async (prepared) => {
    const {context, mixer} = fixture(0.5);
    const player = new AudioClipPlayer(clip(), {audioContext: context.audio, volume: 0.25});
    cleanups.push(() => player.dispose());
    if (prepared) await player.preload();
    const setVolume = vi.spyOn(player, 'setVolume');
    mixer.add({id: 'clip', player, volume: 0.8});
    mixer.mute('clip');
    await mixer.play();
    mixer.unmute('clip');
    expect(setVolume).not.toHaveBeenCalled();
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.1, 8);
    player.setVolume(0.5);
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.2, 8);
    mixer.remove('clip');
    expect(player.peekOutputPort()?.disposed).toBe(false);
    expect(context.close).not.toHaveBeenCalled();
  });
});

describe('AudioMixer facade source routing', () => {
  it.each(['mixer', 'playlist'] as const)('applies gain and pre-play mute/unmute to a facade borrowing a %s', async (kind) => {
    const {context, mixer} = fixture(0.5);
    const backend = kind === 'mixer'
      ? new AudioMixer({audioContext: context.audio}).add({id: 'tone', clip: clip()})
      : new AudioPlaylist({audioContext: context.audio, entries: [{id: 'tone', clip: clip()}]});
    const player = new AudioPlayer(undefined, {audioContext: context.audio, volume: 0.25});
    cleanups.push(() => backend.dispose(), () => player.dispose());
    player.setTransport(backend instanceof AudioMixer ? backend.transport : backend);
    mixer.add({id: 'group', player, volume: 0.8});
    expect(player.peekOutputPort()).toBeUndefined();
    expect(context.sources).toHaveLength(0);
    mixer.mute('group');
    await mixer.play();
    expect(amplitude(context.sources[0]!, context.destination)).toBe(0);
    mixer.unmute('group');
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.4, 8);
    expect(player.volume).toBe(0.25);
    mixer.setMasterVolume(0.25);
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.2, 8);
  });

  it('reconciles an empty facade when a backend arrives and keeps clip source gain independent', async () => {
    const {context, mixer} = fixture(0.5);
    const player = new AudioPlayer(undefined, {audioContext: context.audio, volume: 0.25});
    cleanups.push(() => player.dispose());
    const backend: AudioPlayerTransport = {
      seconds: 0, duration: 1, playing: false,
      play() {}, pause() {}, stop() {}, seek() {}, setVolume: vi.fn(),
    };
    mixer.add({id: 'source', player, volume: 0.8});
    mixer.mute('source');
    player.setTransport(backend);
    expect(backend.setVolume).toHaveBeenLastCalledWith(0);
    mixer.unmute('source');
    expect(backend.setVolume).toHaveBeenLastCalledWith(0.4);
    player.setClip(clip());
    expect(player.volume).toBe(0.25);
    expect(context.sources).toHaveLength(0);
    await mixer.play();
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.1, 8);
  });

  it('revokes a prepared clip channel for a borrowed mix and restores it when the clip returns', async () => {
    const {context, mixer} = fixture(0.5);
    const backend = new AudioMixer({audioContext: context.audio}).add({id: 'tone', clip: clip()});
    const player = new AudioPlayer(clip(), {audioContext: context.audio, volume: 0.25});
    cleanups.push(() => backend.dispose(), () => player.dispose());
    mixer.add({id: 'source', player, volume: 0.8});
    await mixer.play();
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.1, 8);
    const previousInserts = mixer.channelInserts('source')!;
    const dispose = vi.spyOn(previousInserts, 'dispose');
    mixer.mute('source');
    player.setTransport(backend.transport);
    expect(mixer.channelInserts('source')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    expect(backend.snapshot().masterVolume).toBe(0);
    mixer.unmute('source');
    await mixer.play();
    expect(amplitude(context.sources.at(-1)!, context.destination)).toBeCloseTo(0.4, 8);
    player.setClip(clip());
    await mixer.play();
    expect(player.volume).toBe(0.25);
    expect(amplitude(context.sources.at(-1)!, context.destination)).toBeCloseTo(0.1, 8);
    expect(mixer.channelInserts('source')).not.toBe(previousInserts);
  });

  it('stops observing a borrowed facade when the member is removed', () => {
    const {context, mixer} = fixture(0.5);
    const player = new AudioPlayer(undefined, {audioContext: context.audio});
    cleanups.push(() => player.dispose());
    mixer.add({id: 'source', player, volume: 0.8});
    mixer.remove('source');
    const backend: AudioPlayerTransport = {
      seconds: 0, duration: 1, playing: false,
      play() {}, pause() {}, stop() {}, seek() {}, setVolume: vi.fn(),
    };
    player.setTransport(backend);
    expect(backend.setVolume).not.toHaveBeenCalled();
    expect(mixer.ids()).toEqual([]);
  });

  it('keeps the latest facade source selected during channel cleanup', async () => {
    const {context, mixer} = fixture(0.5);
    const player = new AudioPlayer(clip(), {audioContext: context.audio, volume: 0.25});
    cleanups.push(() => player.dispose());
    const backend: AudioPlayerTransport = {
      seconds: 0, duration: 1, playing: false,
      play() {}, pause() {}, stop() {}, seek() {}, setVolume: vi.fn(),
    };
    mixer.add({id: 'source', player, volume: 0.8});
    await mixer.play();
    const replacement = clip();
    mixer.channelInserts('source')!.setSlot({id: 'select-on-cleanup', recipe: {
      createAudioNodes: audio => {
        const node = audio.createGain();
        return {input: node, output: node, dispose() { player.setClip(replacement); }};
      },
    }});
    player.setTransport(backend);
    expect(player.clip).toBe(replacement);
    expect(player.transport).toBeUndefined();
    await mixer.play();
    expect(amplitude(context.sources.at(-1)!, context.destination)).toBeCloseTo(0.1, 8);
  });

  it('leaves volume unsupported when a borrowed transport has no volume capability', () => {
    const {context, mixer} = fixture();
    const player = new AudioPlayer(undefined, {audioContext: context.audio});
    cleanups.push(() => player.dispose());
    player.setTransport({seconds: 0, duration: 1, playing: false, play() {}, pause() {}, stop() {}, seek() {}});
    expect(() => mixer.add({id: 'source', player})).not.toThrow();
    expect(() => mixer.mute('source')).not.toThrow();
    expect(context.sources).toHaveLength(0);
  });
});

describe('AudioMixer lazy admission ownership', () => {
  it.each(['remove', 'dispose', 'replace-lazy', 'replace-prepared'] as const)(
    'releases the original channel when an admission observer requests %s', async (operation) => {
      const {context, mixer} = fixture(0.5);
      const original = new AudioClipPlayer(clip(), {audioContext: context.audio});
      const replacement = new AudioClipPlayer(clip(), {audioContext: context.audio});
      cleanups.push(() => original.dispose(), () => replacement.dispose());
      if (operation === 'replace-prepared') await replacement.preload();
      mixer.add({id: 'source', player: original, volume: 0.8});
      let handled = false;
      mixer.on('change', () => {
        if (handled || !mixer.channelInserts('source')) return;
        handled = true;
        if (operation === 'remove') mixer.remove('source');
        else if (operation === 'dispose') mixer.dispose();
        else mixer.add({id: 'source', player: replacement, volume: 0.3});
      });
      await mixer.play();
      expect(handled).toBe(true);
      expect(original.peekOutputPort()?.defaultDestination).toBeUndefined();
      expect(original.playing).toBe(false);
      if (operation === 'remove' || operation === 'dispose') {
        expect(mixer.ids()).toEqual([]);
        expect(mixer.channelInserts('source')).toBeUndefined();
      } else {
        expect(mixer.ids()).toEqual(['source']);
        await mixer.play();
        expect(amplitude(context.sources.at(-1)!, context.destination)).toBeCloseTo(0.15, 8);
      }
      expect(original.peekOutputPort()?.disposed).toBe(false);
      expect(context.close).not.toHaveBeenCalled();
    },
  );
});

describe('AudioMixer modular channel membership', () => {
  it.each([false, true])('rejects an occupied direct channel for a prepared=%s facade and removes its route completely', async (prepared) => {
    const {context, mixer, port} = fixture();
    const direct = port();
    const admission = mixer.admitAudio('voice', direct.output);
    const player = new AudioPlayer(clip(), {audioContext: context.audio});
    cleanups.push(() => player.dispose());
    if (prepared) await player.preload();
    expect(() => mixer.add({id: 'voice', player})).toThrow('Audio channel already exists: voice');
    expect(mixer.ids()).toEqual(['voice']);
    expect(admission.active).toBe(true);
    expect(amplitude(direct.node, context.destination)).toBe(1);
    mixer.remove('voice');
    expect(mixer.ids()).toEqual([]);
    expect(admission.active).toBe(false);
    expect(amplitude(direct.node, context.destination)).toBe(0);
    expect(direct.output.disposed).toBe(false);
    await player.play();
    expect(player.playing).toBe(true);
  });

  it.each([false, true])('retains legitimate member replacement by a prepared=%s facade', async (prepared) => {
    const {context, mixer} = fixture();
    const previous = new AudioClipPlayer(clip(), {audioContext: context.audio});
    const replacement = new AudioPlayer(clip(), {audioContext: context.audio});
    cleanups.push(() => previous.dispose(), () => replacement.dispose());
    await previous.preload();
    mixer.add({id: 'voice', player: previous});
    if (prepared) await replacement.preload();
    expect(() => mixer.add({id: 'voice', player: replacement})).not.toThrow();
    await mixer.play();
    expect(mixer.ids()).toEqual(['voice']);
    expect(previous.peekOutputPort()?.defaultDestination).toBeUndefined();
    expect(replacement.playing).toBe(true);
    mixer.remove('voice');
    expect(mixer.ids()).toEqual([]);
    expect(replacement.peekOutputPort()?.defaultDestination).toBeUndefined();
    expect(replacement.peekOutputPort()?.disposed).toBe(false);
  });

  it.each([
    ['add', 'admit'], ['admit', 'add'], ['add', 'add'],
  ] as const)('preserves %s → %s readiness ownership and fully removes the winner', async (outer, nested) => {
    const {context, mixer, port} = fixture();
    const candidate = new AudioClipPlayer(clip(), {audioContext: context.audio});
    const replacement = new AudioClipPlayer(clip(), {audioContext: context.audio});
    cleanups.push(() => candidate.dispose(), () => replacement.dispose());
    await candidate.preload();
    await replacement.preload();
    const direct = port();
    const released = vi.fn();
    let handled = false;
    let admission: ReturnType<AudioMixer['admitAudio']> | undefined;
    mixer.module.subscribe!(() => {
      if (handled || !mixer.module.getPort!('master')) return;
      handled = true;
      if (nested === 'admit') admission = mixer.admitAudio('voice', direct.output);
      else mixer.add({id: 'voice', player: replacement});
      mixer.channelInserts('voice')!.setSlot({id: 'owned', recipe: {createAudioNodes: audio => {
        const node = audio.createGain();
        return {input: node, output: node, dispose: released};
      }}});
    });
    const attempt = () => outer === 'add'
      ? mixer.add({id: 'voice', player: candidate})
      : mixer.admitAudio('voice', candidate.outputPort);
    expect(attempt).toThrow('Audio channel already exists: voice');
    expect(mixer.ids()).toEqual(['voice']);
    if (nested === 'admit') expect(admission!.active).toBe(true);
    const winner = nested === 'admit' ? direct.output : replacement.outputPort;
    expect(amplitude(winner.node as unknown as GraphNode, context.destination)).toBe(1);
    mixer.remove('voice');
    if (admission) expect(admission.active).toBe(false);
    expect(released).toHaveBeenCalledOnce();
    expect(amplitude(winner.node as unknown as GraphNode, context.destination)).toBe(0);
    mixer.dispose();
    expect(released).toHaveBeenCalledOnce();
    expect(winner.disposed).toBe(false);
  });

  it('preserves a same-id admission made by a master readiness observer', () => {
    const {context, mixer, port} = fixture();
    const outer = port(), replacement = port();
    const released = vi.fn();
    let notified = false;
    let replacementAdmission: ReturnType<AudioMixer['admitAudio']> | undefined;
    mixer.module.subscribe!(() => {
      if (notified || !mixer.module.getPort!('master')) return;
      notified = true;
      replacementAdmission = mixer.admitAudio('voice', replacement.output);
      mixer.channelInserts('voice')!.setSlot({id: 'owned', recipe: {createAudioNodes: audio => {
        const node = audio.createGain();
        return {input: node, output: node, dispose: released};
      }}});
    });
    expect(() => mixer.admitAudio('voice', outer.output)).toThrow('Audio channel already exists: voice');
    expect(mixer.ids()).toEqual(['voice']);
    expect(amplitude(outer.node, context.destination)).toBe(0);
    expect(amplitude(replacement.node, context.destination)).toBe(1);
    expect(replacementAdmission!.active).toBe(true);
    mixer.remove('voice');
    replacementAdmission!.release();
    expect(mixer.ids()).toEqual([]);
    expect(amplitude(replacement.node, context.destination)).toBe(0);
    expect(released).toHaveBeenCalledOnce();
  });

  it('rolls back an acquired candidate route when its source callback admits the same id', () => {
    const {context, mixer, port} = fixture();
    const outer = port(), replacement = port();
    void mixer.outputPort;
    let candidateGain: GraphNode | undefined;
    let replacementAdmission: ReturnType<AudioMixer['admitAudio']> | undefined;
    const connect = outer.node.connect.bind(outer.node);
    vi.spyOn(outer.node, 'connect').mockImplementationOnce(destination => {
      candidateGain = destination;
      replacementAdmission = mixer.admitAudio('voice', replacement.output);
      return connect(destination);
    });
    expect(() => mixer.admitAudio('voice', outer.output)).toThrow('Audio channel already exists: voice');
    expect(outer.output.defaultDestination).toBeUndefined();
    expect(outer.node.connections.size).toBe(0);
    expect(candidateGain!.connections.size).toBe(0);
    expect(amplitude(replacement.node, context.destination)).toBe(1);
    mixer.remove('voice');
    expect(replacementAdmission!.active).toBe(false);
    expect(amplitude(replacement.node, context.destination)).toBe(0);
  });

  it('does not admit a channel after a master readiness observer disposes the mixer', () => {
    const {mixer, port} = fixture();
    const source = port();
    mixer.module.subscribe!(() => { if (mixer.module.getPort!('master')) mixer.dispose(); });
    expect(() => mixer.admitAudio('voice', source.output)).toThrow('AudioMixer is disposed');
    expect(mixer.ids()).toEqual([]);
    expect(source.output.defaultDestination).toBeUndefined();
    expect(source.node.connections.size).toBe(0);
  });

  it('releases an uncommitted master exactly once when its effect factory disposes the mixer', () => {
    const context = new GraphContext();
    const released = vi.fn();
    const mixer = new AudioMixer({audioContext: context.audio, effect: {createAudioNodes: audio => {
      const effect = audio.createGain();
      mixer.dispose();
      return {input: effect, output: effect, dispose: released};
    }}});
    cleanups.push(() => mixer.dispose());
    expect(() => mixer.outputPort).toThrow('AudioMixer is disposed');
    expect(released).toHaveBeenCalledOnce();
    mixer.dispose();
    expect(released).toHaveBeenCalledOnce();
  });

  it('rejects recursive master acquisition without replacing the outer candidate', () => {
    const context = new GraphContext();
    const released = vi.fn();
    const create = vi.fn(() => {
      expect(() => mixer.outputPort).toThrow('AudioMixer master preparation cannot re-enter');
      const effect = context.audio.createGain();
      return {input: effect, output: effect, dispose: released};
    });
    const mixer = new AudioMixer({audioContext: context.audio, effect: {createAudioNodes: create}});
    cleanups.push(() => mixer.dispose());
    expect(mixer.outputPort.disposed).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    mixer.dispose();
    expect(released).toHaveBeenCalledOnce();
  });

  it('silences a new channel before routing when another channel is soloed', () => {
    const {context, mixer, port} = fixture();
    const a = port(), b = port();
    mixer.admitAudio('a', a.output);
    mixer.solo('a');
    const connect = b.node.connect.bind(b.node);
    vi.spyOn(b.node, 'connect').mockImplementation(destination => {
      expect(destination.gain.value).toBe(0);
      return connect(destination);
    });
    mixer.admitAudio('b', b.output);
    expect(amplitude(b.node, context.destination)).toBe(0);
    expect(mixer.snapshot().members.find(member => member.id === 'b')?.effectiveVolume).toBe(0);
    mixer.solo(null);
    expect(amplitude(b.node, context.destination)).toBe(1);
  });

  it.each(['remove', 'release'] as const)('restores non-muted channels when the soloed channel leaves through %s', (method) => {
    const {context, mixer, port} = fixture(0.5);
    const a = port(), b = port(), c = port();
    const attachment = mixer.admitAudio('a', a.output);
    mixer.admitAudio('b', b.output);
    mixer.admitAudio('c', c.output);
    mixer.setVolume('b', 0.4);
    mixer.mute('c');
    mixer.solo('a');
    if (method === 'remove') mixer.remove('a');
    else attachment.release();
    expect(mixer.snapshot().soloId).toBeNull();
    expect(amplitude(b.node, context.destination)).toBeCloseTo(0.2, 8);
    expect(amplitude(c.node, context.destination)).toBe(0);
    attachment.release();
    expect(mixer.ids()).toEqual(['b', 'c']);
  });

  it('restores surviving gains even if the removed channel effect fails to dispose', () => {
    const {context, mixer, port} = fixture();
    const a = port(), b = port();
    const attachment = mixer.admitAudio('a', a.output);
    mixer.admitAudio('b', b.output);
    mixer.channelInserts('a')!.setSlot({id: 'broken-cleanup', recipe: {
      createAudioNodes: audio => {
        const node = audio.createGain();
        return {input: node, output: node, dispose() { throw new Error('effect cleanup failed'); }};
      },
    }});
    mixer.solo('a');
    expect(() => attachment.release()).toThrow('effect cleanup failed');
    expect(mixer.snapshot().soloId).toBeNull();
    expect(amplitude(a.node, context.destination)).toBe(0);
    expect(amplitude(b.node, context.destination)).toBe(1);
    expect(() => attachment.release()).not.toThrow();
  });

  it('preserves a reentrant same-id replacement and its new solo selection', () => {
    const {context, mixer, port} = fixture();
    const a = port(), b = port(), replacement = port();
    const attachment = mixer.admitAudio('a', a.output);
    mixer.admitAudio('b', b.output);
    mixer.channelInserts('a')!.setSlot({id: 'replace-on-cleanup', recipe: {
      createAudioNodes: audio => {
        const node = audio.createGain();
        return {input: node, output: node, dispose() {
          mixer.admitAudio('a', replacement.output);
          mixer.setVolume('a', 0.3);
          mixer.solo('a');
        }};
      },
    }});
    mixer.solo('a');
    attachment.release();
    attachment.release();
    expect(mixer.snapshot().soloId).toBe('a');
    expect(amplitude(a.node, context.destination)).toBe(0);
    expect(amplitude(replacement.node, context.destination)).toBeCloseTo(0.3, 8);
    expect(amplitude(b.node, context.destination)).toBe(0);
  });

  it.each([false, true])('retains solo while replacing a member with a prepared=%s output', async (prepared) => {
    const {context, mixer} = fixture();
    const first = new AudioClipPlayer(clip(), {audioContext: context.audio});
    const replacement = new AudioClipPlayer(clip(), {audioContext: context.audio});
    cleanups.push(() => first.dispose(), () => replacement.dispose());
    await first.preload();
    if (prepared) await replacement.preload();
    mixer.add({id: 'a', player: first});
    mixer.add({id: 'b', clip: clip()});
    mixer.solo('a');
    mixer.add({id: 'a', player: replacement, volume: 0.3});
    expect(mixer.snapshot().soloId).toBe('a');
    await mixer.play();
    expect(amplitude(context.sources[0]!, context.destination)).toBeCloseTo(0.3, 8);
    expect(amplitude(context.sources[1]!, context.destination)).toBe(0);
    expect(first.outputPort.defaultDestination).toBeUndefined();
  });
});
