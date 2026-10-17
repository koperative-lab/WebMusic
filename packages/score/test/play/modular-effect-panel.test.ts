// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {InsertChain} from '@webmusic/kernel/effect';
import {ModuleAudioEnvironment, ModuleContext, ParamHandle, ParamSurface, type ModuleHandle} from '@webmusic/kernel/module';
import {notifyModuleContext, provideModuleContext} from '@webmusic/kernel/element';
import type {ParameterRackBinding} from '@webmusic/ui/parameter';
import {Effect} from '../../src/play/headless/effects';
import {Sound} from '../../src/play/headless/sound';
import {ScoreEffectElement} from '../../src/play/element/score-effect';
import {SynthPanelElement} from '../../src/play/element/score-synth-panel';

const captured = vi.hoisted(() => ({bindings: new Map<Element, ParameterRackBinding>()}));
vi.mock('@webmusic/ui/parameter', () => ({
  mountParameterRack: (host: HTMLElement, binding: ParameterRackBinding) => {
    const owner = (host.getRootNode() as ShadowRoot).host;
    captured.bindings.set(owner, binding);
    const element = document.createElement('div');
    host.append(element);
    const update = vi.fn();
    const unsubscribe = binding.subscribe?.(update);
    return {element, update, destroy: () => { unsubscribe?.(); element.remove(); }};
  },
}));

customElements.define('modular-effect-test', ScoreEffectElement);
customElements.define('modular-panel-test', SynthPanelElement);
const cleanups: Array<() => void> = [];

function fixture() {
  const nodes: AudioNode[] = [];
  const context = {
    currentTime: 0,
    createGain: vi.fn(() => {
      const connections = new Set<AudioNode>();
      const node = {
        context,
        gain: {value: 1, defaultValue: 1, minValue: -3.4e38, maxValue: 3.4e38},
        connect: vi.fn((target: AudioNode) => { connections.add(target); return target; }),
        disconnect: vi.fn((target?: AudioNode) => { if (target) connections.delete(target); else connections.clear(); }),
      } as unknown as GainNode;
      nodes.push(node);
      return node;
    }),
    close: vi.fn(),
  } as unknown as AudioContext;
  const chain = new InsertChain(context);
  const target: ModuleHandle = {id: 'instrument', inserts: chain};
  const scope = new ModuleContext({id: 'scope', audio: new ModuleAudioEnvironment({context}), target});
  const host = document.createElement('custom-module-provider');
  host.setAttribute('composition', 'modules');
  cleanups.push(provideModuleContext(host, () => scope), () => chain.dispose());
  document.body.append(host);
  return {chain, context, host, target, nodes};
}

function effect(value = 0.4) {
  const element = document.createElement('modular-effect-test') as ScoreEffectElement;
  element.setAttribute('type', 'gain');
  element.setAttribute('gain', String(value));
  return element;
}

function panel() {
  const element = document.createElement('modular-panel-test') as SynthPanelElement;
  element.sections = ['effects'];
  return element;
}

const binding = (element: Element) => captured.bindings.get(element)!;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

afterEach(async () => {
  document.body.replaceChildren();
  await settle();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  captured.bindings.clear();
});

describe('attached synth panels and declarative effect identity', () => {
  it('uses generic display ranges while retaining legal values outside their suggested sweep', () => {
    const control = new ParamHandle({
      id: 'custom-control', unit: 'ratio', defaultValue: 0.5,
      range: {min: 0, max: 10}, displayRange: {min: 0.2, max: 0.8},
    });
    const element = panel();
    element.moduleTarget = {id: 'custom-module', params: new ParamSurface([control])};
    document.body.append(element);
    expect(binding(element).snapshot().parameters[0]).toMatchObject({min: 0.2, max: 0.8, value: 0.5});
    control.setBaseValue(2);
    expect(binding(element).snapshot().parameters[0]).toMatchObject({min: 0.2, max: 2, value: 2});
    control.setBaseValue(0.1);
    expect(binding(element).snapshot().parameters[0]).toMatchObject({min: 0.1, max: 0.8, value: 0.1});
    element.remove();
    control.dispose();
  });

  it('shares instrument handles across panels and exposes all four per-note ADSR stages', () => {
    const {chain, host, context} = fixture();
    const sound = Sound.oscillator();
    const target: ModuleHandle = {id: 'shared-instrument', params: sound.params, inserts: chain};
    const first = panel();
    const second = panel();
    const envelope = panel();
    first.sections = second.sections = ['sound'];
    envelope.sections = ['envelope'];
    for (const element of [first, second, envelope]) element.moduleTarget = target;
    host.append(first, second, envelope);
    const cutoff = binding(first).snapshot().parameters.find((entry) => entry.id.endsWith('/cutoff'))!;
    binding(first).setValue(cutoff.id, 1900);
    expect(binding(second).snapshot().parameters.find((entry) => entry.id.endsWith('/cutoff'))?.value).toBe(1900);
    expect(sound.params.get('cutoff')?.snapshot.baseValue).toBe(1900);
    expect(binding(first).snapshot().parameters.some((entry) => entry.id.endsWith('/attackSeconds'))).toBe(false);
    const stages = binding(envelope).snapshot().parameters;
    expect(stages.map((entry) => entry.id.split('/').at(-1))).toEqual(['attackSeconds', 'decaySeconds', 'sustainLevel', 'releaseSeconds']);
    binding(envelope).setValue(stages[0].id, 0.25);
    expect(sound.params.get('attackSeconds')?.snapshot.baseValue).toBe(0.25);
    expect(envelope.shadowRoot?.textContent).toContain('Envelope settings apply to new notes');
    binding(envelope).setValue(stages[1].id, 0.3);
    binding(envelope).setValue(stages[2].id, 0.45);
    expect(sound.params.get('decaySeconds')?.snapshot.baseValue).toBe(0.3);
    expect(sound.params.get('sustainLevel')?.snapshot.baseValue).toBe(0.45);
    envelope.remove();
    first.remove();
    expect(sound.params.get('attackSeconds')?.snapshot.disposed).toBe(false);
    expect(context.createGain).toHaveBeenCalledTimes(2);
  });

  it('lets three panels edit one instance without building or owning another graph', async () => {
    const {chain, context, host} = fixture();
    const declaration = effect();
    declaration.id = 'shared-effect';
    const inline = panel();
    const inspector = panel();
    const external = panel();
    external.setAttribute('target', '#shared-effect');
    host.append(declaration, inline, inspector);
    document.body.append(external);
    await settle();

    expect(chain.instances).toHaveLength(1);
    const instance = chain.instances[0];
    expect(declaration.module?.params).toBe(instance.params);
    const allocations = vi.mocked(context.createGain).mock.calls.length;
    const command = binding(external);
    command.setValue(command.snapshot().parameters[0].id, 0.7);
    for (const element of [inline, inspector, external]) {
      expect(binding(element).snapshot().parameters[0].value).toBe(0.7);
      expect(element.input).toBeUndefined();
    }
    inline.sections = ['sound', 'envelope'];
    inspector.remove();
    external.remove();
    expect(chain.instances[0]).toBe(instance);
    expect(instance.params.get('gain')?.snapshot.baseValue).toBe(0.7);
    expect(context.createGain).toHaveBeenCalledTimes(allocations);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('preserves sound order for layout moves and removes only the declared slot', async () => {
    const {chain, host} = fixture();
    const first = effect(0.2);
    const second = effect(0.5);
    host.append(first, second);
    const instances = [...chain.instances];
    host.prepend(second);
    await settle();
    expect(chain.instances).toEqual(instances);
    first.id = 'renamed-dom-id';
    expect(chain.instances[0]).toBe(instances[0]);
    first.remove();
    await settle();
    expect(chain.instances).toEqual([instances[1]]);
    expect(instances[0].params.get('gain')?.snapshot.disposed).toBe(true);
    expect(instances[1].params.get('gain')?.snapshot.disposed).toBe(false);
  });

  it('keeps an unresolved explicit target silent and does not borrow the enclosing module', async () => {
    const {chain, context, host, target} = fixture();
    const declaration = effect();
    declaration.setAttribute('target', '#missing-effect-owner');
    const attached = panel();
    attached.setAttribute('target', '#missing-effect-owner');
    attached.context = context;
    attached.effects = [Effect.gain(0.8)];
    host.append(declaration, attached);
    await settle();
    expect(chain.instances).toHaveLength(0);
    expect(attached.bindingState).toBe('unresolved');
    expect(attached.input).toBeUndefined();
    expect(context.createGain).toHaveBeenCalledTimes(2);

    declaration.moduleTarget = target;
    attached.moduleTarget = target;
    expect(chain.instances).toHaveLength(1);
    expect(attached.bindingState).toBe('ready');
    attached.moduleTarget = null;
    expect(attached.bindingState).toBe('unresolved');
    expect(binding(attached).snapshot().parameters).toHaveLength(0);
  });

  it('waits for target readiness without preparing audio during discovery', async () => {
    const {chain, host, context} = fixture();
    let prepared = false;
    const prepare = vi.fn();
    const listeners = new Set<() => void>();
    const target: ModuleHandle = {
      id: 'pending', prepare,
      get inserts() { return prepared ? chain : undefined; },
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const declaration = effect();
    declaration.moduleTarget = target;
    const attached = panel();
    attached.moduleTarget = target;
    host.append(declaration, attached);
    expect(chain.instances).toHaveLength(0);
    expect(prepare).not.toHaveBeenCalled();
    prepared = true;
    for (const listener of [...listeners]) listener();
    await settle();
    expect(chain.instances).toHaveLength(1);
    expect(binding(attached).snapshot().parameters[0].value).toBe(0.4);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('preserves the working slot when replacement construction fails', () => {
    const {chain, host} = fixture();
    const declaration = effect();
    host.append(declaration);
    const instance = chain.instances[0];
    const errors = vi.fn();
    declaration.addEventListener('webscore:error', errors);
    declaration.effect = Effect.custom(() => { throw new Error('candidate failed'); });
    expect(chain.instances[0]).toBe(instance);
    expect(declaration.module?.params).toBe(instance.params);
    expect(errors).toHaveBeenCalledOnce();
  });

  it('does not install a late candidate into a scope left during construction', async () => {
    const first = fixture();
    const second = fixture();
    const declaration = effect();
    let moved = false;
    declaration.effect = Effect.custom((context) => {
      const node = context.createGain();
      if (!moved) {
        moved = true;
        second.host.append(declaration);
      }
      return {input: node, output: node};
    });
    first.host.append(declaration);
    await settle();
    expect(first.chain.instances).toHaveLength(0);
    expect(second.chain.instances).toHaveLength(1);
    expect(declaration.module?.params).toBe(second.chain.instances[0].params);
  });

  it('binds a selector replacement to its new identity and releases old subscriptions', async () => {
    const {host, chain} = fixture();
    const first = effect(0.2);
    first.id = 'replaceable-effect';
    host.append(first);
    const external = panel();
    external.setAttribute('target', '#replaceable-effect');
    document.body.append(external);
    await settle();
    const previous = binding(external);
    const oldInstance = chain.instances[0];
    const second = effect(0.8);
    second.id = first.id;
    first.replaceWith(second);
    await settle();
    expect(binding(external).snapshot().parameters[0].value).toBe(0.8);
    expect(external.module?.id).not.toBe(oldInstance.id);
    expect(() => previous.setValue(previous.snapshot().parameters[0].id, 0.5)).toThrow('disposed');
    expect(binding(external).snapshot().parameters[0].value).toBe(0.8);
  });

  it('keeps standalone insertion explicit even inside a module scope', () => {
    const {host, context, chain} = fixture();
    const standalone = panel();
    standalone.setAttribute('mode', 'insert');
    standalone.context = context;
    standalone.effects = [Effect.gain(0.5)];
    host.append(standalone);
    expect(standalone.bindingState).toBe('standalone');
    expect(standalone.input).toBeDefined();
    expect(chain.instances).toHaveLength(0);
    notifyModuleContext(host);
    expect(standalone.bindingState).toBe('standalone');
  });
});
