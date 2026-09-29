import {describe, expect, it} from 'vitest';
import {
  chainEffects,
  compressor,
  customEffect,
  delay,
  filter,
  gain,
  insertEffect,
  type Effect,
} from '../../src/play/headless/effects';

// ---------------------------------------------------------------------------
// A tiny fake of the Web Audio node-construction surface the effect builtins
// touch. Each node records its connections so we can assert graph wiring
// without a real AudioContext.
// ---------------------------------------------------------------------------

interface FakeNode {
  readonly kind: string;
  readonly connectedTo: FakeNode[];
  connect(target: FakeNode): FakeNode;
  disconnect(): void;
  [param: string]: unknown;
}

function fakeParam(value = 0): {value: number} {
  return {value};
}

function makeNode(kind: string, params: Record<string, {value: number}> = {}): FakeNode {
  const node: FakeNode = {
    kind,
    connectedTo: [],
    connect(target: FakeNode) {
      this.connectedTo.push(target);
      return target;
    },
    disconnect() {
      this.connectedTo.length = 0;
    },
    ...params,
  };
  return node;
}

function fakeContext() {
  const created: FakeNode[] = [];
  const track = (n: FakeNode) => (created.push(n), n);
  const ctx = {
    created,
    createGain: () => track(makeNode('gain', {gain: fakeParam(1)})),
    createBiquadFilter: () =>
      track(makeNode('biquad', {frequency: fakeParam(350), Q: fakeParam(1), gain: fakeParam(0), type: '' as never})),
    createDelay: () => track(makeNode('delay', {delayTime: fakeParam(0)})),
    createDynamicsCompressor: () =>
      track(
        makeNode('compressor', {
          threshold: fakeParam(-24),
          knee: fakeParam(30),
          ratio: fakeParam(12),
          attack: fakeParam(0.003),
          release: fakeParam(0.25),
        }),
      ),
  };
  return ctx as unknown as BaseAudioContext & {created: FakeNode[]};
}

describe('effect builtins', () => {
  it('gain() builds a single node with the requested value', () => {
    const ctx = fakeContext();
    const nodes = gain(0.5).createAudioNodes(ctx);
    expect(nodes.input).toBe(nodes.output);
    expect((nodes.input as unknown as FakeNode).kind).toBe('gain');
    expect((nodes.params?.gain as unknown as {value: number}).value).toBe(0.5);
  });

  it('gain() accepts a bare number', () => {
    const ctx = fakeContext();
    const nodes = gain(2).createAudioNodes(ctx);
    expect((nodes.params?.gain as unknown as {value: number}).value).toBe(2);
  });

  it('filter() defaults to a lowpass and exposes live params', () => {
    const ctx = fakeContext();
    const nodes = filter({frequency: 800, Q: 2}).createAudioNodes(ctx);
    const node = nodes.input as unknown as FakeNode;
    expect(node.type).toBe('lowpass');
    expect((node.frequency as {value: number}).value).toBe(800);
    expect((node.Q as {value: number}).value).toBe(2);
    expect(nodes.params).toHaveProperty('frequency');
  });

  it('delay() wires a wet/dry feedback graph (distinct input/output)', () => {
    const ctx = fakeContext();
    const nodes = delay({delaySeconds: 0.2, feedback: 0.4}).createAudioNodes(ctx);
    expect(nodes.input).not.toBe(nodes.output);
    // input fans out to the dry path and the delay line.
    expect((nodes.input as unknown as FakeNode).connectedTo.length).toBeGreaterThanOrEqual(2);
    expect(nodes.params).toHaveProperty('feedback');
  });

  it('compressor() applies only the provided params', () => {
    const ctx = fakeContext();
    const nodes = compressor({ratio: 8, threshold: -18}).createAudioNodes(ctx);
    const node = nodes.input as unknown as FakeNode;
    expect((node.ratio as {value: number}).value).toBe(8);
    expect((node.threshold as {value: number}).value).toBe(-18);
  });

  it('exposes a structural Effect shape (createAudioNodes only)', () => {
    const e: Effect = gain();
    expect(typeof e.createAudioNodes).toBe('function');
  });

  it('customEffect wraps a factory', () => {
    const ctx = fakeContext();
    let built = false;
    const e = customEffect((c) => {
      built = true;
      const g = c.createGain();
      return {input: g, output: g};
    }, 'Custom');
    expect(e.label).toBe('Custom');
    e.createAudioNodes(ctx);
    expect(built).toBe(true);
  });
});

describe('chainEffects', () => {
  it('connects effects in series, exposing first input and last output', () => {
    const ctx = fakeContext();
    const chain = chainEffects(gain(0.5), filter({frequency: 500}), gain(2));
    const nodes = chain.createAudioNodes(ctx);
    expect((nodes.input as unknown as FakeNode).kind).toBe('gain');
    // first gain → filter (its only connection should be the filter input).
    const firstGain = nodes.input as unknown as FakeNode;
    expect(firstGain.connectedTo[0].kind).toBe('biquad');
  });

  it('skips nullish entries', () => {
    const ctx = fakeContext();
    const chain = chainEffects(null, gain(1), undefined);
    const nodes = chain.createAudioNodes(ctx);
    expect((nodes.input as unknown as FakeNode).kind).toBe('gain');
  });

  it('returns a transparent pass-through node when empty', () => {
    const ctx = fakeContext();
    const nodes = chainEffects().createAudioNodes(ctx);
    expect(nodes.input).toBe(nodes.output);
    expect((nodes.input as unknown as FakeNode).kind).toBe('gain');
  });
});

describe('insertEffect', () => {
  it('connects source straight to destination when no effect is given', () => {
    const ctx = fakeContext();
    const source = makeNode('source');
    const dest = makeNode('dest');
    const result = insertEffect(ctx, source as unknown as AudioNode, dest as unknown as AudioNode, undefined);
    expect(source.connectedTo[0]).toBe(dest);
    expect(result.output).toBe(source as unknown as AudioNode);
  });

  it('splices the effect between source and destination', () => {
    const ctx = fakeContext();
    const source = makeNode('source');
    const dest = makeNode('dest');
    const result = insertEffect(ctx, source as unknown as AudioNode, dest as unknown as AudioNode, gain(0.7));
    // source → effect.input (a gain node), effect.output → dest
    expect((source.connectedTo[0] as unknown as FakeNode).kind).toBe('gain');
    expect((result.output as unknown as FakeNode).connectedTo[0]).toBe(dest);
  });
});
