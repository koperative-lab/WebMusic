import {afterEach, describe, expect, it, vi} from 'vitest';
import {type Effect, type EffectNodes} from '../src/effect';
import {TransitionInsertChain} from '../src/transition-insert-chain';

type Event = {kind: 'set' | 'linear'; value: number; time: number};

class Parameter {
  value = 1;
  readonly defaultValue = 1;
  readonly minValue = -100;
  readonly maxValue = 100;
  readonly events: Event[] = [];
  failure?: () => void;
  setValueAtTime(value: number, time: number): this {
    this.failure?.();
    this.events.push({kind: 'set', value, time});
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.failure?.();
    this.events.push({kind: 'linear', value, time});
    return this;
  }
  cancelScheduledValues(time: number): this {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].time >= time) this.events.splice(i, 1);
    return this;
  }
  at(time: number): number {
    let previous: Event = {kind: 'set', value: this.value, time: 0};
    for (const event of this.events) {
      if (event.time > time) {
        return event.kind === 'linear' ? previous.value + (event.value - previous.value) * (time - previous.time) / (event.time - previous.time) : previous.value;
      }
      previous = event;
    }
    return previous.value;
  }
}

class Node {
  readonly gain = new Parameter();
  readonly connections = new Set<Node>();
  afterConnect?: () => void;
  constructor(readonly context: BaseAudioContext) {}
  connect(destination: Node): Node {
    this.connections.add(destination);
    this.afterConnect?.();
    return destination;
  }
  disconnect(destination?: Node): void {
    if (destination) this.connections.delete(destination);
    else this.connections.clear();
  }
}

function fixture() {
  vi.useFakeTimers();
  const nodes: Node[] = [];
  const context = {currentTime: 0, state: 'running', close: vi.fn(), createGain() {
    const node = new Node(context as unknown as BaseAudioContext);
    nodes.push(node);
    return node;
  }};
  const makeEffect = () => {
    const bundles: Array<EffectNodes & {dispose: ReturnType<typeof vi.fn>}> = [];
    const effect: Effect = {createAudioNodes() {
      const node = context.createGain() as unknown as GainNode;
      const bundle = {input: node, output: node, params: {gain: node.gain}, dispose: vi.fn()};
      bundles.push(bundle);
      return bundle;
    }};
    return {effect, bundles};
  };
  const chain = new TransitionInsertChain(context as unknown as BaseAudioContext, {tick: {createWorker: () => null}});
  const gates = (target = chain.current) => {
    const inlet = nodes.find((node) => node.connections.has(target.input as unknown as Node))!;
    const outlet = [...(target.output as unknown as Node).connections][0];
    return {input: inlet.gain, output: outlet.gain};
  };
  return {context, nodes, chain, makeEffect, gates};
}

afterEach(() => { vi.useRealTimers(); });

describe('TransitionInsertChain whole-generation changes', () => {
  it('crossfades stable ports with native ramps and retains the outgoing handles until its audio deadline', () => {
    const {context, chain, makeEffect, gates} = fixture();
    const {effect, bundles} = makeEffect();
    chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0});
    const first = chain.current;
    const parameter = first.instances[0].params.get('gain')!;
    parameter.setBaseValue(2);
    const firstGates = gates();
    const input = chain.input;
    const output = chain.output;
    chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0.2});
    expect(chain.input).toBe(input);
    expect(chain.output).toBe(output);
    expect(chain.current.instances[0].recipe).toBe(effect);
    expect(chain.current.instances[0].params.get('gain')).not.toBe(parameter);
    expect(chain.current.instances[0].params.get('gain')!.snapshot.baseValue).toBe(1);
    expect(firstGates.input.at(0.1)).toBe(1);
    expect(firstGates.output.at(0.1) + gates().output.at(0.1)).toBeCloseTo(1);
    expect(firstGates.output.at(0.2)).toBe(0);
    expect(firstGates.input.at(0.2)).toBe(0);
    expect(bundles[0].dispose).not.toHaveBeenCalled();
    parameter.setBaseValue(3);
    context.currentTime = 0.2;
    chain.collect();
    expect(bundles[0].dispose).toHaveBeenCalledOnce();
    expect(first.disposed).toBe(true);
    expect(() => parameter.setBaseValue(4)).toThrow();
    chain.dispose();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('fades outgoing excitation then drains a finite tail, and does not consume tail time during context suspension', () => {
    const {context, chain, makeEffect, gates} = fixture();
    const {effect, bundles} = makeEffect();
    chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0});
    const outgoing = gates();
    chain.replace([], {fadeSeconds: 0.1, tailSeconds: 0.4});
    expect(outgoing.input.at(0.05)).toBeCloseTo(0.5);
    expect(outgoing.input.at(0.1)).toBe(0);
    expect(outgoing.output.at(0.1)).toBe(1);
    expect(outgoing.output.at(0.3)).toBeCloseTo(0.5);
    expect(outgoing.output.at(0.5)).toBe(0);
    context.state = 'suspended';
    vi.advanceTimersByTime(10_000);
    expect(bundles[0].dispose).not.toHaveBeenCalled();
    context.state = 'running';
    context.currentTime = 0.5;
    vi.advanceTimersByTime(25);
    expect(bundles[0].dispose).toHaveBeenCalledOnce();
    expect(chain.retiring).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    chain.dispose();
  });

  it('preserves a live generation on construction, connection and parameter-scheduling failure', () => {
    const {context, nodes, chain, makeEffect, gates} = fixture();
    const {effect, bundles} = makeEffect();
    chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0});
    const previous = chain.current;
    const outgoing = gates();
    expect(() => chain.replace([{id: 'fail', recipe: {createAudioNodes() { throw new Error('build'); }}}])).toThrow('build');
    const connectionFailure: Effect = {createAudioNodes() {
      const node = context.createGain();
      node.afterConnect = () => { throw new Error('connect'); };
      return {input: node as unknown as GainNode, output: node as unknown as GainNode};
    }};
    expect(() => chain.replace([{id: 'fail', recipe: connectionFailure}])).toThrow('connect');
    let failEdge = true;
    (chain.input as unknown as Node).afterConnect = () => {
      if (failEdge) { failEdge = false; throw new Error('root connection'); }
    };
    expect(() => chain.replace([])).toThrow('root connection');
    let once = true;
    outgoing.output.failure = () => { if (once) { once = false; throw new Error('automation'); } };
    expect(() => chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0.2})).toThrow('automation');
    expect(chain.current).toBe(previous);
    expect(outgoing.output.at(1)).toBe(1);
    expect(outgoing.input.at(1)).toBe(1);
    expect(chain.retiring).toHaveLength(0);
    expect(bundles[0].dispose).not.toHaveBeenCalled();
    expect(bundles[1].dispose).toHaveBeenCalledOnce();
    expect([...nodes[0].connections]).toHaveLength(1);
    chain.dispose();
  });

  it('rejects cross-generation live-node and AudioParam aliases before either owned graph is disposed', () => {
    const {context, chain, makeEffect} = fixture();
    const {effect, bundles} = makeEffect();
    chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0});
    const old = chain.current;
    expect(() => chain.replace([{id: 'alias', recipe: {createAudioNodes: () => bundles[0]}}])).toThrow('generation');
    expect(() => chain.replace([{id: 'alias', recipe: {createAudioNodes() {
      const node = context.createGain() as unknown as GainNode;
      return {input: node, output: node, params: bundles[0].params, dispose: bundles[0].dispose};
    }}}])).toThrow('generation');
    expect(chain.current).toBe(old);
    expect(bundles[0].dispose).not.toHaveBeenCalled();
    chain.dispose();
    expect(bundles[0].dispose).toHaveBeenCalledOnce();
  });

  it('uses analytic levels for interrupted fades instead of AudioParam.value', () => {
    const {context, chain, gates} = fixture();
    chain.replace([], {fadeSeconds: 1});
    const middle = gates();
    context.currentTime = 0.25;
    expect(middle.output.value).toBe(0);
    chain.replace([], {fadeSeconds: 0.5});
    expect(middle.output.at(0.125)).toBeCloseTo(0.125);
    expect(middle.output.at(0.25)).toBeCloseTo(0.25);
    expect(middle.output.at(0.5)).toBeCloseTo(0.125);
    context.currentTime = 1;
    chain.collect();
    expect(chain.retiring).toHaveLength(0);
    chain.dispose();
  });

  it('preserves the unity signal through repeated interrupted crossfades of different lengths', () => {
    const {context, chain, gates} = fixture();
    const paths = [gates()];
    chain.replace([], {fadeSeconds: 1});
    paths.push(gates());
    context.currentTime = 0.25;
    chain.replace([], {fadeSeconds: 0.5});
    paths.push(gates());
    const amplitude = (time: number) => paths.reduce((sum, path) => sum + path.input.at(time) * path.output.at(time), 0);
    for (const time of [0, 0.125, 0.25, 0.3, 0.4]) expect(amplitude(time)).toBeCloseTo(1);
    context.currentTime = 0.4;
    chain.replace([], {fadeSeconds: 0.8});
    paths.push(gates());
    for (const time of [0.4, 0.5, 0.75, 1, 1.2, 2]) expect(amplitude(time)).toBeCloseTo(1);
    for (const {retireAt} of chain.retiring) expect(retireAt).toBeCloseTo(1.2);
    context.currentTime = 1.21;
    chain.collect();
    expect(chain.retiring).toHaveLength(0);
    chain.dispose();
  });

  it('cuts every unfinished no-tail contribution on an immediate replacement', () => {
    const {context, chain, gates} = fixture();
    const oldest = gates();
    chain.replace([], {fadeSeconds: 1});
    const middle = gates();
    context.currentTime = 0.25;
    chain.replace([], {fadeSeconds: 0});
    expect(oldest.output.at(0.25)).toBe(0);
    expect(middle.output.at(0.25)).toBe(0);
    expect(gates().output.at(0.25)).toBe(1);
    expect(chain.retiring).toHaveLength(0);
    chain.dispose();
  });

  it('retains existing tail ramps and deadlines while later no-tail generations crossfade together', () => {
    const {context, chain, gates} = fixture();
    const tail = gates();
    const retiring = chain.current;
    chain.replace([], {fadeSeconds: 0.1, tailSeconds: 1});
    const first = gates();
    context.currentTime = 0.2;
    chain.replace([], {fadeSeconds: 1});
    const second = gates();
    context.currentTime = 0.3;
    chain.replace([], {fadeSeconds: 0.2});
    const third = gates();
    expect(chain.retiring.find(({chain: item}) => item === retiring)?.retireAt).toBe(1.1);
    expect(tail.output.at(0.6)).toBeCloseTo(0.5);
    expect(tail.output.at(1.1)).toBe(0);
    for (const time of [0.3, 0.4, 0.5, 0.8]) {
      expect(first.output.at(time) + second.output.at(time) + third.output.at(time)).toBeCloseTo(1);
    }
    chain.dispose();
  });

  it('restores all contributing ramps and their deadlines if an interrupted replacement fails', () => {
    const {context, chain, gates} = fixture();
    const first = gates();
    chain.replace([], {fadeSeconds: 1});
    const second = gates();
    const current = chain.current;
    context.currentTime = 0.25;
    let fail = true;
    first.input.failure = () => { if (fail) { fail = false; throw new Error('retiring automation'); } };
    expect(() => chain.replace([], {fadeSeconds: 0.5})).toThrow('retiring automation');
    expect(chain.current).toBe(current);
    expect(chain.retiring).toHaveLength(1);
    expect(chain.retiring[0].retireAt).toBe(1);
    for (const time of [0.25, 0.5, 0.75, 1]) {
      expect(first.output.at(time)).toBeCloseTo(1 - time);
      expect(second.output.at(time)).toBeCloseTo(time);
    }
    chain.dispose();
  });

  it('anchors fades after candidate construction and preserves an existing fade on failed replacement', () => {
    const {context, chain, gates} = fixture();
    const slow: Effect = {createAudioNodes() {
      context.currentTime = 2;
      const node = context.createGain() as unknown as GainNode;
      return {input: node, output: node};
    }};
    chain.replace([{id: 'slow', recipe: slow}], {fadeSeconds: 1});
    expect(chain.retiring[0].retireAt).toBe(3);
    const current = chain.current;
    const running = gates();
    expect(running.output.at(2)).toBe(0);
    expect(running.output.at(2.5)).toBeCloseTo(0.5);
    context.currentTime = 2.25;
    let fail = true;
    running.input.failure = () => { if (fail) { fail = false; throw new Error('input automation'); } };
    expect(() => chain.replace([], {fadeSeconds: 1})).toThrow('input automation');
    expect(chain.current).toBe(current);
    expect(running.output.at(2.5)).toBeCloseTo(0.5);
    expect(running.output.at(3)).toBe(1);
    expect(running.input.at(4)).toBe(1);
    chain.dispose();
  });

  it('releases partially allocated candidate and constructor chains when node allocation fails', () => {
    const {context, chain, nodes} = fixture();
    const original = context.createGain.bind(context);
    const before = nodes.length;
    let calls = 0;
    vi.spyOn(context, 'createGain').mockImplementation(() => {
      if (++calls === 3) throw new Error('allocate inlet');
      return original();
    });
    const current = chain.current;
    expect(() => chain.replace([])).toThrow('allocate inlet');
    expect(chain.current).toBe(current);
    expect(nodes.slice(before).every((node) => node.connections.size === 0)).toBe(true);
    calls = -2; // Root ports plus chain ports succeed; the generation inlet fails.
    const constructorStart = nodes.length;
    expect(() => new TransitionInsertChain(context as unknown as BaseAudioContext)).toThrow('allocate inlet');
    expect(nodes.slice(constructorStart).every((node) => node.connections.size === 0)).toBe(true);
    chain.dispose();
  });

  it('bounds pending generations and rejects borrowed slots, invalid timing, and recipe reentrancy', () => {
    const {context, chain, makeEffect} = fixture();
    const {effect} = makeEffect();
    expect(() => chain.replace([{id: 'borrowed', recipe: effect, ownership: 'borrowed'}])).toThrow('owned');
    expect(() => chain.replace([], {tailSeconds: Infinity})).toThrow('finite');
    expect(() => chain.replace([], {fadeSeconds: -1})).toThrow('nonnegative');
    expect(() => chain.replace([{id: 'recursive', recipe: {createAudioNodes() {
      chain.replace([]);
      throw new Error('unreachable');
    }}}])).toThrow('re-enter');
    for (let index = 0; index < 8; index++) chain.replace([], {tailSeconds: 1});
    expect(() => chain.replace([])).toThrow('limit');
    context.currentTime = 2;
    chain.collect();
    expect(() => chain.replace([], {fadeSeconds: 0})).not.toThrow();
    chain.dispose();
    expect(() => chain.replace([])).toThrow('disposed');
  });

  it('keeps disposal terminal when a recipe disposes its wrapper and continues cleanup after a throwing disposer', () => {
    const {context, chain, makeEffect} = fixture();
    const {effect, bundles} = makeEffect();
    chain.replace([{id: 'fx', recipe: effect}], {fadeSeconds: 0});
    bundles[0].dispose.mockImplementation(() => { throw new Error('dispose'); });
    const candidateDispose = vi.fn();
    expect(() => chain.replace([{id: 'dispose', recipe: {createAudioNodes() {
      chain.dispose();
      const node = context.createGain() as unknown as GainNode;
      return {input: node, output: node, dispose: candidateDispose};
    }}}])).toThrow('disposed');
    expect(chain.disposed).toBe(true);
    expect(bundles[0].dispose).toHaveBeenCalledOnce();
    expect(candidateDispose).toHaveBeenCalledOnce();
    expect((chain.input as unknown as Node).connections.size).toBe(0);
    expect(context.close).not.toHaveBeenCalled();
    chain.dispose();
  });
});
