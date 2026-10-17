import {describe, expect, it, vi} from 'vitest';
import {InsertChain, type Effect, type EffectNodes} from '../src/effect';

class Node {
  readonly connections = new Set<Node>();
  readonly gain = {value: 1, defaultValue: 1, minValue: 0, maxValue: 4};
  readonly disconnectCalls: Array<Node | undefined> = [];
  afterConnect?: (destination: Node) => void;
  afterDisconnect?: (destination: Node) => void;
  constructor(readonly context: BaseAudioContext) {}
  connect(destination: Node): Node {
    this.connections.add(destination);
    this.afterConnect?.(destination);
    return destination;
  }
  disconnect(destination?: Node): void {
    this.disconnectCalls.push(destination);
    if (!destination) this.connections.clear();
    else this.connections.delete(destination);
    if (destination) this.afterDisconnect?.(destination);
  }
}

function fixture() {
  const nodes: Node[] = [];
  const context = {createGain() {
    const node = new Node(context as unknown as BaseAudioContext);
    nodes.push(node);
    return node;
  }} as unknown as BaseAudioContext;
  const makeEffect = () => {
    const input = context.createGain();
    const output = context.createGain();
    input.connect(output);
    const dispose = vi.fn();
    const bundle: EffectNodes = {input, output, params: {gain: input.gain}, dispose};
    const createAudioNodes = vi.fn(() => bundle);
    const effect: Effect = {createAudioNodes, parameterDescriptors: {
      gain: {unit: 'linear-gain', range: {min: 0, max: 4}, defaultValue: 1},
    }};
    return {effect, bundle, dispose, createAudioNodes, input: input as unknown as Node, output: output as unknown as Node};
  };
  return {context, nodes, makeEffect};
}

function connected(source: AudioNode, destination: AudioNode): boolean {
  return (source as unknown as Node).connections.has(destination as unknown as Node);
}

describe('InsertChain transactional ownership', () => {
  it('retains stable live/offline-compatible boundaries, slots and parameter identities', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const input = chain.input;
    const output = chain.output;
    const first = makeEffect();
    const second = makeEffect();
    chain.setSlot({id: 'first', recipe: first.effect});
    const instance = chain.instances[0];
    const gain = instance.params.get('gain')!;
    gain.setBaseValue(2);
    expect(first.bundle.params!.gain.value).toBe(2);
    expect(gain.descriptor.unit).toBe('linear-gain');
    chain.setSlot({id: 'second', recipe: second.effect});
    expect(chain.instances[0]).toBe(instance);
    expect(chain.instances[0].params.get('gain')).toBe(gain);
    expect(chain.input).toBe(input);
    expect(chain.output).toBe(output);
    expect(connected(input, first.bundle.input)).toBe(true);
    expect(connected(first.bundle.output, second.bundle.input)).toBe(true);
    expect(connected(second.bundle.output, output)).toBe(true);
    const revision = chain.revision;
    chain.replace(chain.slots);
    expect(chain.revision).toBe(revision);
    expect(first.createAudioNodes).toHaveBeenCalledExactlyOnceWith(context);
  });

  it('changes compatibility before explicit slots without changing their instances', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const local = makeEffect();
    const compatibility = makeEffect();
    chain.setSlot({id: 'local', recipe: local.effect});
    const localInstance = chain.instances[0];
    chain.setCompatibility(compatibility.effect);
    expect(chain.instances.map((instance) => instance.slotId)).toEqual(['$compat', 'local']);
    expect(chain.instances[1]).toBe(localInstance);
    chain.replace([]);
    expect(chain.instances.map((instance) => instance.slotId)).toEqual(['$compat']);
    chain.setCompatibility(undefined);
    expect(connected(chain.input, chain.output)).toBe(true);
    expect(local.dispose).toHaveBeenCalledOnce();
    expect(compatibility.dispose).toHaveBeenCalledOnce();
    expect(() => chain.setSlot({id: '$compat', recipe: local.effect})).toThrow('compatibility');
  });

  it('rolls back a connection that commits and then throws, preserving the running graph', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const running = makeEffect();
    chain.setSlot({id: 'effect', recipe: running.effect});
    const before = chain.instances;
    const revision = chain.revision;
    const candidate = makeEffect();
    candidate.output.afterConnect = () => { throw new Error('candidate connect'); };
    expect(() => chain.setSlot({id: 'effect', recipe: candidate.effect})).toThrow('candidate connect');
    expect(chain.instances).toBe(before);
    expect(chain.revision).toBe(revision);
    expect(connected(chain.input, running.bundle.input)).toBe(true);
    expect(connected(running.bundle.output, chain.output)).toBe(true);
    expect(connected(chain.input, candidate.bundle.input)).toBe(false);
    expect(candidate.output.connections.size).toBe(0);
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(running.dispose).not.toHaveBeenCalled();
  });

  it('restores a previous route when disconnect mutates then throws', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const running = makeEffect();
    const candidate = makeEffect();
    chain.setSlot({id: 'effect', recipe: running.effect});
    running.output.afterDisconnect = () => { throw new Error('retire edge'); };
    expect(() => chain.setSlot({id: 'effect', recipe: candidate.effect})).toThrow('retire edge');
    expect(connected(chain.input, running.bundle.input)).toBe(true);
    expect(connected(running.bundle.output, chain.output)).toBe(true);
    expect(chain.instances[0].recipe).toBe(running.effect);
    expect(running.dispose).not.toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('protects borrowed nodes and other output branches with precise cleanup', () => {
    const {context, makeEffect, nodes} = fixture();
    const chain = new InsertChain(context);
    const borrowed = makeEffect();
    const external = context.createGain();
    borrowed.bundle.output.connect(external);
    chain.setSlot({id: 'borrowed', recipe: borrowed.effect, ownership: 'borrowed'});
    const params = chain.instances[0].params;
    chain.removeSlot('borrowed');
    chain.dispose();
    expect(borrowed.dispose).not.toHaveBeenCalled();
    expect(connected(borrowed.bundle.output, external)).toBe(true);
    expect(params.get('gain')!.snapshot.disposed).toBe(true);
    expect(nodes.flatMap((node) => node.disconnectCalls)).not.toContain(undefined);
  });

  it('rejects partial live overlap without running an unsafe candidate disposer', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const running = makeEffect();
    chain.setSlot({id: 'effect', recipe: running.effect});
    const dispose = vi.fn();
    const unsafe = {createAudioNodes: () => ({input: running.bundle.input, output: context.createGain(), dispose})};
    expect(() => chain.setSlot({id: 'effect', recipe: unsafe})).toThrow('fresh');
    expect(dispose).not.toHaveBeenCalled();
    expect(running.dispose).not.toHaveBeenCalled();
    expect(connected(chain.input, running.bundle.input)).toBe(true);
    chain.setSlot({id: 'effect', recipe: {createAudioNodes: () => running.bundle}});
    expect(running.dispose).not.toHaveBeenCalled();
    chain.dispose();
    expect(running.dispose).toHaveBeenCalledOnce();
  });

  it('rejects duplicate slots and foreign-context candidates before changing a route', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const local = makeEffect();
    expect(() => chain.replace([{id: 'a', recipe: local.effect}, {id: 'a', recipe: local.effect}])).toThrow('duplicate');
    expect(local.createAudioNodes).not.toHaveBeenCalled();
    const foreign = fixture().makeEffect();
    expect(() => chain.setSlot({id: 'foreign', recipe: foreign.effect})).toThrow('another audio context');
    expect(foreign.dispose).toHaveBeenCalledOnce();
    expect(connected(chain.input, chain.output)).toBe(true);
  });

  it('rejects metadata changes on an exact active bundle alias without changing handles or declarations', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const active = makeEffect();
    chain.setSlot({id: 'effect', recipe: active.effect});
    const instance = chain.instances[0];
    const slots = chain.slots;
    const revision = chain.revision;
    expect(() => chain.setSlot({
      id: 'effect', recipe: active.effect,
      parameterDescriptors: {gain: {range: {min: 0, max: 2}}},
    })).toThrow('cannot change parameter metadata');
    expect(() => chain.setSlot({id: 'effect', recipe: {
      createAudioNodes: () => active.bundle,
      parameterDescriptors: {gain: {unit: 'dB'}},
    }})).toThrow('cannot change parameter metadata');
    expect(chain.instances[0]).toBe(instance);
    expect(chain.slots).toBe(slots);
    expect(chain.revision).toBe(revision);
    expect(instance.params.get('gain')!.descriptor.range.max).toBe(4);
    expect(active.dispose).not.toHaveBeenCalled();
  });

  it('fits recipe display suggestions to actual backend bounds without changing legal writes', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const effect = makeEffect();
    effect.effect.parameterDescriptors = {gain: {unit: 'linear-gain', displayRange: {min: -1, max: 10}}};
    chain.setSlot({id: 'effect', recipe: effect.effect});
    const handle = chain.instances[0].params.get('gain')!;
    expect(handle.descriptor.range).toEqual({min: 0, max: 4});
    expect(handle.descriptor.displayRange).toEqual({min: 0, max: 4});
    chain.setSlot({id: 'effect', recipe: {...effect.effect, createAudioNodes: () => effect.bundle}});
    expect(chain.instances[0].params.get('gain')).toBe(handle);
    handle.setBaseValue(3);
    expect(effect.bundle.params!.gain.value).toBe(3);
    const outside = makeEffect();
    outside.effect.parameterDescriptors = {gain: {displayRange: {min: 10, max: 20}}};
    chain.setSlot({id: 'effect', recipe: outside.effect});
    expect(chain.instances[0].params.get('gain')!.descriptor.displayRange).toBeUndefined();
    expect(chain.instances[0].params.get('gain')!.descriptor.range).toEqual({min: 0, max: 4});
  });

  it('continues cleanup after failure, commits replacement, and disposes idempotently', () => {
    const {context, makeEffect} = fixture();
    const report = vi.fn();
    const chain = new InsertChain(context, {onCleanupError: report});
    const first = makeEffect();
    const second = makeEffect();
    first.dispose.mockImplementation(() => { throw new Error('cleanup failed'); });
    chain.replace([{id: 'one', recipe: first.effect}, {id: 'two', recipe: second.effect}]);
    chain.replace([]);
    expect(report).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(chain.instances).toEqual([]);
    chain.dispose();
    chain.dispose();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(() => chain.setCompatibility(undefined)).toThrow('disposed');
  });

  it('does not resurrect routing after a recipe disposes the chain while building', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const candidate = makeEffect();
    const recipe = {createAudioNodes() { chain.dispose(); return candidate.bundle; }};
    expect(() => chain.setSlot({id: 'candidate', recipe})).toThrow('disposed');
    expect(chain.disposed).toBe(true);
    expect(chain.instances).toEqual([]);
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect((chain.input as unknown as Node).connections.size).toBe(0);
  });

  it('blocks reentrant builds and does not publish stale revisions after observer edits', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const rejected = {createAudioNodes() { chain.replace([]); return makeEffect().bundle; }};
    expect(() => chain.setSlot({id: 'bad', recipe: rejected})).toThrow('re-enter');
    const seen: number[] = [];
    const effect = makeEffect();
    chain.subscribe((value) => { if (value.instances.length) value.replace([]); });
    chain.subscribe((value) => seen.push(value.instances.length));
    chain.subscribe(() => { throw new Error('observer failed'); });
    expect(() => chain.setSlot({id: 'good', recipe: effect.effect})).not.toThrow();
    expect(seen).toEqual([0]);
    expect(effect.dispose).toHaveBeenCalledOnce();
  });

  it('snapshots caller declarations before invoking recipes', () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const built = makeEffect();
    const slots = [{id: 'original', recipe: built.effect}];
    built.createAudioNodes.mockImplementation(() => {
      slots[0].id = 'mutated';
      slots.push({id: 'unexpected', recipe: makeEffect().effect});
      return built.bundle;
    });
    chain.replace(slots);
    expect(chain.slots.map((slot) => slot.id)).toEqual(['original']);
    expect(chain.instances.map((instance) => instance.slotId)).toEqual(['original']);
  });

  it('reorders retained graphs without temporarily creating feedback or losing handles', () => {
    const {context, makeEffect, nodes} = fixture();
    const chain = new InsertChain(context);
    const first = makeEffect();
    const second = makeEffect();
    chain.replace([{id: 'a', recipe: first.effect}, {id: 'b', recipe: second.effect}]);
    const [a, b] = chain.instances;
    for (const node of nodes) node.afterConnect = (destination) => {
      const pending = [destination];
      const visited = new Set<Node>();
      while (pending.length) {
        const current = pending.pop()!;
        if (current === node) throw new Error('Transient feedback cycle');
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...current.connections);
      }
    };
    expect(() => chain.replace([...chain.slots].reverse())).not.toThrow();
    expect(chain.instances).toEqual([b, a]);
    expect(connected(second.bundle.output, first.bundle.input)).toBe(true);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('keeps duplicate observer registrations independent and contains async failures', async () => {
    const {context, makeEffect} = fixture();
    const chain = new InsertChain(context);
    const listener = vi.fn();
    const oldOff = chain.subscribe(listener);
    chain.subscribe(listener);
    oldOff();
    oldOff();
    chain.subscribe(async () => { throw new Error('async observer'); });
    chain.setSlot({id: 'effect', recipe: makeEffect().effect});
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
  });
});
