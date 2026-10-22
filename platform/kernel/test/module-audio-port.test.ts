import {describe, expect, it, vi} from 'vitest';
import {AudioOutputPort} from '../src/module/audio-port';
import {createConnectionLease, type ConnectionLease} from '../src/module/lease';
import {ModuleAudioEnvironment, ModuleContext, moduleScopeChange, routeModuleOutput, sameModuleScope} from '../src/module/context';
import {ModuleRegistry} from '../src/module/registry';

class TestAudioNode {
  readonly connections = new Set<TestAudioNode>();
  readonly connectCalls: TestAudioNode[] = [];
  readonly disconnectCalls: TestAudioNode[] = [];
  onConnect?: (destination: TestAudioNode) => void;
  failConnect?: TestAudioNode;
  failAfterConnect?: TestAudioNode;

  constructor(readonly context: BaseAudioContext) {}

  connect(destination: TestAudioNode): TestAudioNode {
    this.connectCalls.push(destination);
    if (destination === this.failConnect) throw new Error('candidate connect failed');
    this.connections.add(destination);
    this.onConnect?.(destination);
    if (destination === this.failAfterConnect) throw new Error('connected then failed');
    return destination;
  }

  disconnect(destination: TestAudioNode): void {
    if (!destination) throw new Error('global disconnect is forbidden');
    this.disconnectCalls.push(destination);
    this.connections.delete(destination);
  }
}

const audioNode = (node: TestAudioNode): AudioNode => node as unknown as AudioNode;

function graph() {
  const context = {state: 'running'} as BaseAudioContext;
  return {
    context,
    source: new TestAudioNode(context),
    normal: new TestAudioNode(context),
    replacement: new TestAudioNode(context),
    meter: new TestAudioNode(context),
  };
}

describe('AudioOutputPort managed route leases', () => {
  it('replaces one default route while keeping independent tap and send branches', () => {
    const {source, normal, replacement, meter} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    const tap = port.tap(audioNode(meter));
    const send = port.send(audioNode(meter));
    const patch = port.replace(audioNode(replacement));

    expect(source.connections).toEqual(new Set([replacement, meter]));
    expect(source.connectCalls.filter(node => node === meter)).toHaveLength(1);
    tap.release();
    expect(source.connections.has(meter)).toBe(true);
    patch.release();
    expect(source.connections).toEqual(new Set([normal, meter]));
    send.release();
    expect(source.connections).toEqual(new Set([normal]));
    port.dispose();
    expect(source.connections.size).toBe(0);
  });

  it('rejects a second replacement claimant and restores the current default on unpatch', () => {
    const {source, normal, replacement, meter} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    const patch = port.replace(audioNode(replacement));

    expect(() => port.replace(audioNode(meter))).toThrow(/claimant|replacement/i);
    expect(source.connections).toEqual(new Set([replacement]));
    port.setDefault(audioNode(meter));
    expect(source.connections).toEqual(new Set([replacement]));
    patch.release();
    expect(source.connections).toEqual(new Set([meter]));
    port.dispose();
  });

  it('coalesces identical physical edges across ports without stealing another lease', () => {
    const {source, normal} = graph();
    const first = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    const second = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});

    expect(source.connectCalls).toEqual([normal]);
    first.dispose();
    expect(source.connections.has(normal)).toBe(true);
    expect(source.disconnectCalls).toEqual([]);
    second.dispose();
    expect(source.connections.size).toBe(0);
    expect(source.disconnectCalls).toEqual([normal]);
  });

  it('keeps shared edge ownership coherent when another port reenters connect', () => {
    const {source, meter} = graph();
    const first = new AudioOutputPort(audioNode(source));
    const second = new AudioOutputPort(audioNode(source));
    let nested: ConnectionLease | undefined;
    let nestedError: unknown;
    source.onConnect = () => {
      source.onConnect = undefined;
      try { nested = second.send(audioNode(meter)); } catch (error) { nestedError = error; }
    };

    const outer = first.send(audioNode(meter));
    expect(source.connections.has(meter)).toBe(true);
    outer.release();
    // Either reject the nested mutation or retain its independently leased edge.
    // The remaining active lease must never point at an already disconnected edge.
    if (nested?.active) expect(source.connections.has(meter)).toBe(true);
    else {
      expect(nestedError).toBeInstanceOf(Error);
      expect(source.connections.has(meter)).toBe(false);
    }
    nested?.release();
    expect(source.connections.size).toBe(0);
    first.dispose();
    second.dispose();
  });

  it('keeps a separately leased branch when the main route changes from the same destination', () => {
    const {source, normal, replacement} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    const send = port.send(audioNode(normal));
    const patch = port.replace(audioNode(replacement));

    expect(source.connections).toEqual(new Set([normal, replacement]));
    send.release();
    expect(source.connections).toEqual(new Set([replacement]));
    patch.release();
    expect(source.connections).toEqual(new Set([normal]));
    port.dispose();
  });

  it('rejects cross-context and direct self routes before changing the live default', () => {
    const {source, normal} = graph();
    const foreign = new TestAudioNode({state: 'running'} as BaseAudioContext);
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});

    expect(() => port.replace(audioNode(foreign))).toThrow(/context/i);
    expect(() => port.setDefault(audioNode(foreign))).toThrow(/context/i);
    expect(() => port.tap(audioNode(foreign))).toThrow(/context/i);
    expect(() => port.send(audioNode(source))).toThrow(/itself|self/i);
    expect(source.connections).toEqual(new Set([normal]));
    expect(port.replaced).toBe(false);
    port.dispose();
  });

  it('preserves the old default and permits retry after a candidate connect failure', () => {
    const {source, normal, replacement} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    source.failConnect = replacement;

    expect(() => port.replace(audioNode(replacement))).toThrow('candidate connect failed');
    expect(source.connections).toEqual(new Set([normal]));
    expect(port.replaced).toBe(false);
    source.failConnect = undefined;
    const patch = port.replace(audioNode(replacement));
    expect(source.connections).toEqual(new Set([replacement]));
    patch.release();
    expect(source.connections).toEqual(new Set([normal]));
    port.dispose();
  });

  it('removes a failed candidate even when connect throws after creating its edge', () => {
    const {source, normal, replacement} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    source.failAfterConnect = replacement;

    expect(() => port.replace(audioNode(replacement))).toThrow('connected then failed');
    expect(source.connections).toEqual(new Set([normal]));
    expect(port.replaced).toBe(false);
    source.failAfterConnect = undefined;
    port.dispose();
  });

  it('does not restore a former speaker route after scope exit clears the default', () => {
    const {source, normal, replacement, meter} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    const tap = port.tap(audioNode(meter));
    const admission = port.replace(audioNode(replacement));

    port.setDefault(undefined);
    admission.release();
    admission.release();
    expect(source.connections).toEqual(new Set([meter]));
    expect(port.defaultDestination).toBeUndefined();
    expect(admission.active).toBe(false);
    expect(tap.active).toBe(true);
    port.dispose();
    expect(tap.active).toBe(false);
    expect(source.connections.size).toBe(0);
  });

  it('cannot retain both default and replacement routes through a reentrant unpatch', () => {
    const {source, normal, replacement, meter} = graph();
    const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
    const patch = port.replace(audioNode(replacement));
    let nested: ConnectionLease | undefined;
    let nestedError: unknown;
    source.onConnect = (destination) => {
      if (destination !== normal) return;
      source.onConnect = undefined;
      try { nested = port.replace(audioNode(meter)); } catch (error) { nestedError = error; }
    };

    patch.release();
    if (nested?.active) expect(source.connections).toEqual(new Set([meter]));
    else {
      expect(nestedError).toBeInstanceOf(Error);
      expect(source.connections).toEqual(new Set([normal]));
    }
    port.dispose();
    expect(source.connections.size).toBe(0);
  });

  it.each(['send', 'tap', 'replace', 'setDefault'] as const)(
    'does not resurrect routing when %s is disposed by a connect callback',
    (operation) => {
      const {source, normal, replacement} = graph();
      const port = new AudioOutputPort(audioNode(source), {defaultDestination: audioNode(normal)});
      source.onConnect = (destination) => {
        if (destination === replacement) port.dispose();
      };

      expect(() => port[operation](audioNode(replacement))).toThrow(/disposed|cancel/i);
      expect(port.disposed).toBe(true);
      expect(source.connections.size).toBe(0);
      expect(() => port.send(audioNode(normal))).toThrow(/disposed/i);
      port.dispose();
    },
  );

  it('disposes all managed leases once without disconnecting unmanaged branches', () => {
    const {source, normal, replacement, meter, context} = graph();
    const external = new TestAudioNode(context);
    source.connect(external);
    const onCleanupError = vi.fn();
    const port = new AudioOutputPort(audioNode(source), {
      defaultDestination: audioNode(normal), onCleanupError,
    });
    const patch = port.replace(audioNode(replacement));
    const tap = port.tap(audioNode(meter));

    port.dispose();
    port.dispose();
    patch.release();
    tap.release();
    expect(patch.active).toBe(false);
    expect(tap.active).toBe(false);
    expect(source.connections).toEqual(new Set([external]));
    expect(onCleanupError).not.toHaveBeenCalled();
  });
});

describe('module scope routing helpers', () => {
  it('routes through admission or the scope default and retracts only its own default', () => {
    const {context, source, normal, replacement} = graph();
    const speakers = new TestAudioNode(context);
    Object.assign(context, {destination: audioNode(speakers)});
    const scope = new ModuleContext({id: 'scope', audio: new ModuleAudioEnvironment({context})});
    const module = {id: 'voice'};
    const port = new AudioOutputPort(audioNode(source));
    const speakerRoute = routeModuleOutput(scope, module, port);
    expect(port.defaultDestination).toBe(audioNode(speakers));
    speakerRoute.release();
    expect(port.defaultDestination).toBeUndefined();
    const routed = routeModuleOutput(scope.derive({id: 'routed', destination: () => audioNode(normal)}), module, port);
    expect(port.defaultDestination).toBe(audioNode(normal));
    // A later owner of the default keeps it when this route retires.
    port.setDefault(audioNode(replacement));
    routed.release();
    expect(port.defaultDestination).toBe(audioNode(replacement));
    const admitted = createConnectionLease(() => {});
    const admit = vi.fn(() => admitted);
    expect(routeModuleOutput(scope.derive({id: 'rack', admit}), module, port)).toBe(admitted);
    expect(admit).toHaveBeenCalledWith(module, port);
  });

  it('keeps a scope for a republished target but not for a new destination resolver', () => {
    const scope = new ModuleContext({id: 'scope', audio: new ModuleAudioEnvironment({context: graph().context}), destination: () => undefined});
    expect(sameModuleScope(scope, scope.derive({id: 'retargeted', target: {id: 'panel-target'}}))).toBe(true);
    expect(sameModuleScope(scope, scope.derive({id: 'rerouted', destination: () => undefined}))).toBe(false);
    expect(sameModuleScope(scope, scope.derive({id: 'admitted', admit: () => createConnectionLease(() => {})}))).toBe(false);
    expect(sameModuleScope(scope, undefined)).toBe(false);
    expect(sameModuleScope(undefined, undefined)).toBe(false);
  });

  it('distinguishes an in-place destination change from a new scope', () => {
    const scope = new ModuleContext({id: 'scope', audio: new ModuleAudioEnvironment({context: graph().context})});
    expect(moduleScopeChange(scope, scope.derive({id: 'retargeted', target: {id: 'panel-target'}}))).toBe('none');
    expect(moduleScopeChange(scope, scope.derive({id: 'rerouted', destination: () => undefined}))).toBe('destination');
    expect(moduleScopeChange(scope, scope.derive({id: 'registry', registry: new ModuleRegistry()}))).toBe('scope');
    expect(moduleScopeChange(scope, scope.derive({id: 'admitted', admit: () => createConnectionLease(() => {})}))).toBe('scope');
    expect(moduleScopeChange(scope, new ModuleContext({id: 'other', audio: new ModuleAudioEnvironment()}))).toBe('scope');
    expect(moduleScopeChange(undefined, scope)).toBe('scope');
  });
});
