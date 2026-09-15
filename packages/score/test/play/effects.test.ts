import {describe, expect, it, vi} from 'vitest';
import {Effect, insertEffect, resolveEffect} from '../../src/play/headless';

/** A mock AudioContext that records connect() edges between fake nodes. */
function mockAudio() {
  let id = 0;
  const edges: Array<[string, string]> = [];
  const node = (kind: string) => {
    const name = `${kind}#${id++}`;
    const self: any = {
      name,
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
      connect: (dest: any) => {
        edges.push([name, dest.name]);
        return dest;
      },
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    };
    return self;
  };
  const ctx = {
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
  } as unknown as AudioContext;
  return {ctx, edges, node};
}

describe('Effect factories', () => {
  it('build single-node effects with input === output', () => {
    const {ctx} = mockAudio();
    for (const eff of [Effect.gain(0.5), Effect.filter({frequency: 800}), Effect.distortion(), Effect.compressor()]) {
      const n = eff.build(ctx);
      expect(n.input).toBe(n.output);
    }
  });

  it('filter applies its options', () => {
    const {ctx} = mockAudio();
    const n: any = Effect.filter({type: 'highpass', frequency: 2000, Q: 3}).build(ctx);
    expect(n.input.type).toBe('highpass');
    expect(n.input.frequency.value).toBe(2000);
    expect(n.input.Q.value).toBe(3);
  });

  it('delay and reverb expose distinct input/output (wet+dry mix)', () => {
    const {ctx} = mockAudio();
    for (const eff of [Effect.delay(), Effect.reverb()]) {
      const n = eff.build(ctx);
      expect(n.input).not.toBe(n.output);
    }
  });

  it('panner clamps and sets pan', () => {
    const {ctx} = mockAudio();
    const n: any = Effect.panner(2).build(ctx);
    expect(n.input).toBe(n.output);
    expect(n.input.pan.value).toBe(1); // clamped to [-1, 1]
  });

  it('analyser passes through and hands back the node via onReady', () => {
    const {ctx} = mockAudio();
    let captured: any;
    const n: any = Effect.analyser({ fftSize: 2048, onReady: (node) => (captured = node) }).build(ctx);
    expect(n.input).toBe(n.output);
    expect(captured).toBe(n.input);
    expect(n.input.fftSize).toBe(2048);
  });

  it('limiter configures a hard-ratio compressor', () => {
    const {ctx} = mockAudio();
    const n: any = Effect.limiter({ threshold: -6 }).build(ctx);
    expect(n.input.threshold.value).toBe(-6);
    expect(n.input.ratio.value).toBe(20);
  });

  it('bitcrusher builds a stepped waveshaper curve', () => {
    const {ctx} = mockAudio();
    const n: any = Effect.bitcrusher({ bits: 4 }).build(ctx);
    expect(n.input).toBe(n.output);
    expect(n.input.curve).toBeInstanceOf(Float32Array);
  });

  it('tremolo and chorus build modulated graphs with a disposer', () => {
    const {ctx} = mockAudio();
    for (const eff of [Effect.tremolo({ frequency: 6 }), Effect.chorus({ wet: 0.4 })]) {
      const n = eff.build(ctx);
      expect(typeof n.dispose).toBe('function');
      expect(() => n.dispose && n.dispose()).not.toThrow();
    }
  });

  it('exposes live params for real-time control', () => {
    const {ctx} = mockAudio();
    const filter: any = Effect.filter().build(ctx);
    expect(Object.keys(filter.params)).toEqual(expect.arrayContaining(['frequency', 'Q']));
    // params are settable AudioParams (mock uses {value})
    filter.params.frequency.value = 800;
    expect(filter.params.frequency.value).toBe(800);

    const delay: any = Effect.delay().build(ctx);
    expect(Object.keys(delay.params)).toEqual(expect.arrayContaining(['time', 'feedback', 'wet']));

    const reverb: any = Effect.reverb().build(ctx);
    expect(Object.keys(reverb.params)).toEqual(expect.arrayContaining(['wet', 'dry']));
  });

  it('custom adopts a provided node pair', () => {
    const {ctx, node} = mockAudio();
    const input = node('x');
    const output = node('y');
    const n = Effect.custom({input, output}).build(ctx);
    expect(n.input).toBe(input);
    expect(n.output).toBe(output);
  });
});

describe('Effect.chain', () => {
  it('wires sub-effects in series, exposing first input and last output', () => {
    const {ctx, edges} = mockAudio();
    const a = Effect.gain(1);
    const b = Effect.filter();
    const c = Effect.gain(0.5);
    const n: any = Effect.chain(a, b, c).build(ctx);
    // first input is a gain, last output is a gain; the filter sits between
    expect(n.input.name).toMatch(/^gain/);
    expect(n.output.name).toMatch(/^gain/);
    // there is an edge gain->filter and filter->gain
    expect(edges.some(([from, to]) => from.startsWith('gain') && to.startsWith('filter'))).toBe(true);
    expect(edges.some(([from, to]) => from.startsWith('filter') && to.startsWith('gain'))).toBe(true);
  });

  it('skips nullish entries and degrades to a passthrough when empty', () => {
    const {ctx} = mockAudio();
    const n = Effect.chain(null, undefined).build(ctx);
    expect(n.input).toBe(n.output); // single passthrough gain
  });

  it('rolls back every prior node when a later factory fails and preserves the build error', () => {
    const {ctx, node} = mockAudio();
    const buildError = new Error('factory failed');
    const disposeError = new Error('cleanup failed');
    const disposeA = vi.fn();
    const disposeB = vi.fn(() => {
      throw disposeError;
    });
    const a = Effect.custom({input: node('a-in'), output: node('a-out'), dispose: disposeA});
    const b = Effect.custom({input: node('b-in'), output: node('b-out'), dispose: disposeB});
    const broken = Effect.custom(() => {
      throw buildError;
    });

    expect(() => Effect.chain(a, b, broken).build(ctx)).toThrow(buildError);
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
  });

  it('unwinds committed and attempted edges when series wiring fails', () => {
    const {ctx, node} = mockAudio();
    const connectError = new Error('edge failed');
    const cleanupError = new Error('edge cleanup failed');
    const aOut = node('a-out');
    const bIn = node('b-in');
    const bOut = node('b-out');
    const cIn = node('c-in');
    const disconnectA = vi.fn();
    const disconnectB = vi.fn(() => {
      throw cleanupError;
    });
    aOut.disconnect = disconnectA;
    bOut.connect = () => {
      throw connectError;
    };
    bOut.disconnect = disconnectB;
    const disposers = [vi.fn(), vi.fn(), vi.fn()];
    const chain = Effect.chain(
      Effect.custom({input: node('a-in'), output: aOut, dispose: disposers[0]}),
      Effect.custom({input: bIn, output: bOut, dispose: disposers[1]}),
      Effect.custom({input: cIn, output: node('c-out'), dispose: disposers[2]}),
    );

    expect(() => chain.build(ctx)).toThrow(connectError);
    expect(disconnectA).toHaveBeenCalledWith(bIn);
    expect(disconnectB).toHaveBeenCalledWith(cIn);
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it('attempts every disposer once and rethrows the first disposal error', () => {
    const {ctx, node} = mockAudio();
    const firstError = new Error('first dispose failed');
    const secondError = new Error('second dispose failed');
    const disposers = [
      vi.fn(() => {
        throw firstError;
      }),
      vi.fn(() => {
        throw secondError;
      }),
      vi.fn(),
    ];
    const built = Effect.chain(...disposers.map((dispose, index) => Effect.custom({
      input: node(`in-${index}`),
      output: node(`out-${index}`),
      dispose,
    }))).build(ctx);

    expect(() => built.dispose?.()).toThrow(firstError);
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(() => built.dispose?.()).not.toThrow();
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});

describe('insertEffect / resolveEffect', () => {
  it('connects source straight to destination when no effect', () => {
    const {ctx, node, edges} = mockAudio();
    const src = node('src');
    const dst = node('dst');
    insertEffect(ctx, src, dst, undefined);
    expect(edges).toContainEqual(['src#0', 'dst#1']);
  });

  it('rolls back a direct route whose connect commits and then throws', () => {
    const {ctx, node, edges} = mockAudio();
    const source = node('source');
    const destination = node('destination');
    const failure = new Error('direct connect failed after commit');
    const disconnect = vi.fn();
    source.disconnect = disconnect;
    source.connect = (target: {name: string}) => {
      edges.push([source.name, target.name]);
      throw failure;
    };

    expect(() => insertEffect(ctx, source, destination, undefined)).toThrow(failure);

    expect(disconnect).toHaveBeenCalledWith(destination);
  });

  it('inserts the effect between source and destination', () => {
    const {ctx, node, edges} = mockAudio();
    const src = node('src');
    const dst = node('dst');
    insertEffect(ctx, src, dst, Effect.gain(0.7));
    // src -> effect.input, and effect.output -> dst (no direct src->dst)
    expect(edges.some(([from, to]) => from === src.name && to === dst.name)).toBe(false);
    expect(edges.some(([from]) => from === src.name)).toBe(true);
    expect(edges.some(([, to]) => to === dst.name)).toBe(true);
  });

  it('rolls back an effect output whose connect commits and then throws', () => {
    const {ctx, node, edges} = mockAudio();
    const source = node('source');
    const destination = node('destination');
    const input = node('effect-input');
    const output = node('effect-output');
    const failure = new Error('output connect failed after commit');
    const disconnectSource = vi.fn();
    const disconnectOutput = vi.fn();
    const dispose = vi.fn();
    source.disconnect = disconnectSource;
    output.disconnect = disconnectOutput;
    output.connect = (target: {name: string}) => {
      edges.push([output.name, target.name]);
      throw failure;
    };

    expect(() => insertEffect(
      ctx,
      source,
      destination,
      Effect.custom({input, output, dispose}),
    )).toThrow(failure);

    expect(disconnectSource).toHaveBeenCalledWith(input);
    expect(disconnectOutput).toHaveBeenCalledWith(destination);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('resolveEffect prefers an explicit effect, else builds reverb from the legacy option', () => {
    const e = Effect.gain(1);
    expect(resolveEffect(e, {wet: 0.3})).toBe(e);
    expect(resolveEffect(undefined, {wet: 0.3})).toBeInstanceOf(Effect);
    expect(resolveEffect(undefined, false)).toBeUndefined();
    expect(resolveEffect(undefined, undefined)).toBeUndefined();
  });
});
