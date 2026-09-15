import {describe, expect, it} from 'vitest';
import type {Effect as KernelEffect} from '@webmusic/kernel/effect';
import {Effect} from '../../src/play/headless';

/**
 * Guards the kernel Effect contract adoption: every static factory must
 * realise the same graph through `createAudioNodes` (the kernel method) as
 * through the historical `build`, and the stub deliberately exposes only
 * BaseAudioContext members — proving the builders' widened context type.
 */
function mockBaseAudio(): BaseAudioContext {
  let id = 0;
  const node = (kind: string) => {
    const self: any = {
      name: `${kind}#${id++}`,
      gain: {value: 1},
      frequency: {value: 0},
      Q: {value: 0},
      delayTime: {value: 0},
      threshold: {value: 0},
      knee: {value: 0},
      ratio: {value: 0},
      attack: {value: 0},
      release: {value: 0},
      pan: {value: 0},
      fftSize: 0,
      smoothingTimeConstant: 0,
      type: '',
      oversample: '',
      curve: null as Float32Array | null,
      buffer: null as unknown,
      connect: (dest: any) => dest,
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    };
    return self;
  };
  return {
    sampleRate: 44100,
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createDelay: () => node('delay'),
    createConvolver: () => node('convolver'),
    createWaveShaper: () => node('shaper'),
    createDynamicsCompressor: () => node('comp'),
    createStereoPanner: () => node('panner'),
    createAnalyser: () => node('analyser'),
    createOscillator: () => node('osc'),
    createBuffer: (channels: number, length: number) => ({
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
    }),
  } as unknown as BaseAudioContext;
}

const FACTORIES: Array<[string, () => Effect]> = [
  ['gain', () => Effect.gain(0.5)],
  ['panner', () => Effect.panner(-0.3)],
  ['analyser', () => Effect.analyser()],
  ['limiter', () => Effect.limiter()],
  ['bitcrusher', () => Effect.bitcrusher()],
  ['tremolo', () => Effect.tremolo()],
  ['chorus', () => Effect.chorus()],
  ['filter', () => Effect.filter({frequency: 800})],
  ['delay', () => Effect.delay()],
  ['distortion', () => Effect.distortion()],
  ['compressor', () => Effect.compressor()],
  ['reverb', () => Effect.reverb()],
  ['chain', () => Effect.chain(Effect.gain(0.5), Effect.filter())],
];

describe('kernel Effect contract', () => {
  it('every factory realises a graph through createAudioNodes on a BaseAudioContext-only stub', () => {
    for (const [label, make] of FACTORIES) {
      const nodes = make().createAudioNodes(mockBaseAudio());
      expect(nodes.input, label).toBeDefined();
      expect(nodes.output, label).toBeDefined();
    }
  });

  it('createAudioNodes and build produce equivalent graphs', () => {
    for (const [label, make] of FACTORIES) {
      const viaKernel = make().createAudioNodes(mockBaseAudio());
      const viaBuild = make().build(mockBaseAudio() as AudioContext);
      expect(Object.keys(viaKernel).sort(), label).toEqual(Object.keys(viaBuild).sort());
      expect((viaKernel.input as any).name.split('#')[0], label)
        .toBe((viaBuild.input as any).name.split('#')[0]);
      expect((viaKernel.output as any).name.split('#')[0], label)
        .toBe((viaBuild.output as any).name.split('#')[0]);
    }
  });

  it('a score Effect is assignable to the kernel contract at runtime shape level', () => {
    const effect: KernelEffect = Effect.gain(1);
    const nodes = effect.createAudioNodes(mockBaseAudio());
    expect(nodes.input).toBe(nodes.output);
  });
});
