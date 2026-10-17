import {afterEach, describe, expect, it, vi} from 'vitest';
import {AudioOutputPort, ModuleAudioEnvironment, ModuleContext, createConnectionLease, type ConnectionLease} from '@webmusic/kernel/module';
import {ScoreRackModule} from '../../src/play/headless/score-rack-module';

class GraphNode {
  readonly connections = new Set<GraphNode>();
  gain = {value: 1};
  constructor(readonly context: GraphContext) {}
  connect(to: GraphNode) { this.connections.add(to); return to; }
  disconnect(to?: GraphNode) { if (to) this.connections.delete(to); else this.connections.clear(); }
}
class GraphContext {
  currentTime = 0;
  destination = new GraphNode(this);
  nodes: GraphNode[] = [];
  close = vi.fn();
  createGain = () => { const node = new GraphNode(this); this.nodes.push(node); return node; };
  get audio() { return this as unknown as AudioContext; }
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.restoreAllMocks(); });
function fixture() {
  const context = new GraphContext();
  const audio = new ModuleAudioEnvironment({context: context.audio});
  cleanups.push(() => audio.dispose());
  const scope = new ModuleContext({id: 'scope', audio});
  const rack = new ScoreRackModule(scope);
  cleanups.push(() => rack.dispose());
  const source = context.createGain();
  const port = new AudioOutputPort(source as unknown as AudioNode, {defaultDestination: context.destination as unknown as AudioNode});
  cleanups.push(() => port.dispose());
  return {context, scope, audio, rack, source, port};
}

describe('ScoreRackModule admission ownership', () => {
  it('preserves a channel admitted by a ready observer during lazy preparation', () => {
    const {context, rack, port} = fixture();
    const member = {id: 'voice'};
    let first: ConnectionLease | undefined;
    let entered = false;
    const cleanup = vi.fn();
    rack.subscribe(() => {
      if (entered) return;
      entered = true;
      first = rack.admit(member, port);
      rack.channelInserts('voice')!.setSlot({id: 'owned', recipe: {createAudioNodes: ctx => {
        const node = ctx.createGain();
        return {input: node, output: node, dispose: cleanup};
      }}});
    });
    expect(() => rack.admit(member, port)).toThrow(/already.*channel/i);
    expect(first?.active).toBe(true);
    expect(rack.channelInserts('voice')!.instances).toHaveLength(1);
    expect(cleanup).not.toHaveBeenCalled();
    first!.release();
    first!.release();
    rack.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(context.nodes.every(node => node.connections.size === 0)).toBe(true);
  });

  it('rejects overlapping construction of the same channel id', () => {
    const {rack, source, port} = fixture();
    rack.prepare();
    const connect = source.connect.bind(source);
    let nestedError: unknown;
    vi.spyOn(source, 'connect').mockImplementation(destination => {
      try { rack.admit({id: 'voice'}, port); } catch (error) { nestedError = error; }
      return connect(destination);
    });
    const lease = rack.admit({id: 'voice'}, port);
    expect(nestedError).toBeInstanceOf(Error);
    expect(rack.list()).toHaveLength(1);
    lease.release();
    expect(port.defaultDestination).toBeUndefined();
    expect(rack.list()).toEqual([]);
  });

  it('cleans a failed candidate while preserving the borrowed original route', () => {
    const {context, rack, source, port} = fixture();
    rack.prepare();
    const existingEdges = context.nodes.reduce((count, node) => count + node.connections.size, 0);
    vi.spyOn(source, 'connect').mockImplementation(() => { throw new Error('connection rejected'); });
    expect(() => rack.admit({id: 'voice'}, port)).toThrow('connection rejected');
    expect(port.defaultDestination).toBe(context.destination);
    expect(rack.list()).toEqual([]);
    expect(context.nodes.reduce((count, node) => count + node.connections.size, 0)).toBe(existingEdges);
  });

  it('does not commit a candidate after routing synchronously disposes the Rack', () => {
    const {context, rack, source, port} = fixture();
    rack.prepare();
    const connect = source.connect.bind(source);
    vi.spyOn(source, 'connect').mockImplementation(destination => { rack.dispose(); return connect(destination); });
    expect(() => rack.admit({id: 'voice'}, port)).toThrow(/disposed/i);
    expect(rack.list()).toEqual([]);
    expect(port.defaultDestination).toBeUndefined();
    expect(port.disposed).toBe(false);
    expect(context.nodes.every(node => node.connections.size === 0)).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('preserves a same-id replacement created while an old channel retires', () => {
    const {rack, port, context} = fixture();
    const old = rack.admit({id: 'voice'}, port);
    const other = new AudioOutputPort(context.createGain() as unknown as AudioNode);
    cleanups.push(() => other.dispose());
    let replacement: ConnectionLease | undefined;
    rack.channelInserts('voice')!.setSlot({id: 'replace', recipe: {createAudioNodes: ctx => {
      const node = ctx.createGain();
      return {input: node, output: node, dispose() { replacement = rack.admit({id: 'voice'}, other); }};
    }}});
    old.release();
    old.release();
    expect(replacement?.active).toBe(true);
    expect(rack.list()).toHaveLength(1);
    expect(port.defaultDestination).toBeUndefined();
    expect(other.defaultDestination).toBeDefined();
    replacement!.release();
  });

  it('rejects initial preparation whose parent revokes admission before it returns', () => {
    const {rack: parent, context} = fixture();
    const child = new ScoreRackModule(parent.context, {id: 'child'});
    cleanups.push(() => child.dispose());
    parent.subscribe(() => { if (parent.list().some(channel => channel.id === 'child')) parent.dispose(); });
    expect(() => child.prepare()).toThrow(/cancelled/i);
    expect(child.getPort('output')).toBeUndefined();
    expect(child.inserts).toBeUndefined();
    expect(child.input).toBeUndefined();
    // The fixture's unrelated source keeps its own original destination.
    expect(context.nodes.filter(node => node.connections.size > 0)).toHaveLength(1);
  });

  it('keeps an already-ready borrowed child alive when its parent is later disposed', () => {
    const {rack: parent, context} = fixture();
    const child = new ScoreRackModule(parent.context, {id: 'child'});
    cleanups.push(() => child.dispose());
    child.prepare();
    const port = child.getPort('output')!;
    const inserts = child.inserts!;
    parent.dispose();
    expect(() => child.prepare()).not.toThrow();
    expect(child.getPort('output')).toBe(port);
    expect(port.disposed).toBe(false);
    expect(port.defaultDestination).toBeUndefined();
    expect(inserts.disposed).toBe(false);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('can explicitly retry a cancelled initial admission after releasing candidate resources', () => {
    const {scope, context} = fixture();
    let cancel = true;
    const child = new ScoreRackModule(scope.derive({id: 'retry-scope', admit: (_module, port) => {
      port.setDefault(context.destination as unknown as AudioNode);
      const lease = createConnectionLease(() => port.setDefault(undefined));
      if (cancel) lease.release();
      return lease;
    }}));
    cleanups.push(() => child.dispose());
    expect(() => child.prepare()).toThrow(/cancelled/i);
    cancel = false;
    expect(() => child.prepare()).not.toThrow();
    expect(child.getPort('output')?.defaultDestination).toBe(context.destination);
  });
});
