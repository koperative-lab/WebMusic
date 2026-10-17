// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {InsertChain} from '@webmusic/kernel/effect';
import {ModuleAudioEnvironment, ModuleContext, type ModuleHandle} from '@webmusic/kernel/module';
import {provideModuleContext} from '@webmusic/kernel/element';
import {AudioEffectElement, defineAudioEffectElement} from '../../src/play/element/audio-effect';
import {customEffect, gain} from '../../src/play/headless/effects';

defineAudioEffectElement();
const cleanups: Array<() => void> = [];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture() {
  const context = {
    currentTime: 0,
    createGain: vi.fn(() => {
      const connections = new Set<AudioNode>();
      return {
        context,
        gain: {value: 1, defaultValue: 1, minValue: -3.4e38, maxValue: 3.4e38},
        connect: vi.fn((target: AudioNode) => { connections.add(target); return target; }),
        disconnect: vi.fn((target?: AudioNode) => { if (target) connections.delete(target); else connections.clear(); }),
      } as unknown as GainNode;
    }),
    close: vi.fn(),
  } as unknown as AudioContext;
  const chain = new InsertChain(context);
  const target: ModuleHandle = {id: 'audio-owner', inserts: chain};
  const scope = new ModuleContext({id: 'audio-scope', audio: new ModuleAudioEnvironment({context}), target});
  const host = document.createElement('audio-test-provider');
  host.setAttribute('composition', 'modules');
  cleanups.push(provideModuleContext(host, () => scope), () => chain.dispose());
  document.body.append(host);
  return {context, chain, host, target};
}

function effect(value = 0.4): AudioEffectElement {
  const element = document.createElement('audio-effect') as AudioEffectElement;
  element.setAttribute('gain', String(value));
  return element;
}

afterEach(async () => {
  document.body.replaceChildren();
  await settle();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('Audio effect declarations', () => {
  it('publishes the exact shared instance and parameter handles without owning its target', () => {
    const {host, chain, context} = fixture();
    const declaration = effect();
    host.append(declaration);
    const instance = chain.instances[0];
    expect(declaration.module?.id).toBe(instance.id);
    expect(declaration.module?.params).toBe(instance.params);
    const handle = declaration.module!.params!.get('gain')!;
    const firstPanel = vi.fn();
    const secondPanel = vi.fn();
    const detach = handle.subscribe(firstPanel);
    handle.subscribe(secondPanel);
    handle.setBaseValue(0.7);
    expect(instance.nodes.params!.gain.value).toBe(0.7);
    expect(firstPanel).toHaveBeenCalledOnce();
    expect(secondPanel).toHaveBeenCalledOnce();
    detach();
    handle.setBaseValue(0.8);
    expect(chain.instances[0]).toBe(instance);
    expect(context.close).not.toHaveBeenCalled();
    expect(declaration.style.display).toBe('none');
  });

  it('preserves order for layout moves and releases only its own declaration on removal', async () => {
    const {host, chain} = fixture();
    chain.setCompatibility(gain(0.9));
    const first = effect(0.2);
    const second = effect(0.5);
    host.append(first, second);
    const instances = [...chain.instances];
    host.prepend(second);
    first.id = 'renamed';
    await settle();
    expect(chain.instances).toEqual(instances);
    first.remove();
    await settle();
    expect(chain.instances).toEqual([instances[0], instances[2]]);
    expect(instances[1].params.get('gain')!.snapshot.disposed).toBe(true);
    expect(instances[2].params.get('gain')!.snapshot.disposed).toBe(false);
  });

  it('resolves an explicit target before context and never falls back for an invalid selector', async () => {
    const {host, chain, target, context} = fixture();
    const declaration = effect();
    declaration.setAttribute('target', '#missing');
    host.append(declaration);
    await settle();
    expect(chain.instances).toHaveLength(0);
    expect(context.createGain).toHaveBeenCalledTimes(2);
    declaration.moduleTarget = target;
    expect(chain.instances).toHaveLength(1);
    declaration.moduleTarget = null;
    expect(chain.instances).toHaveLength(0);
    expect(declaration.module).toBeUndefined();
  });

  it('waits for audio readiness without preparing or closing the borrowed environment', async () => {
    const {host, chain, context} = fixture();
    let ready = false;
    const listeners = new Set<() => void>();
    const prepare = vi.fn();
    const target: ModuleHandle = {
      id: 'pending', prepare,
      get inserts() { return ready ? chain : undefined; },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const declaration = effect();
    declaration.moduleTarget = target;
    host.append(declaration);
    expect(prepare).not.toHaveBeenCalled();
    expect(chain.instances).toHaveLength(0);
    ready = true;
    for (const listener of [...listeners]) listener();
    await settle();
    expect(chain.instances).toHaveLength(1);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('keeps a valid working instance after invalid configuration or factory failure', () => {
    const {host, chain} = fixture();
    const declaration = effect();
    host.append(declaration);
    const instance = chain.instances[0];
    const errors: unknown[] = [];
    declaration.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    declaration.setAttribute('gain', 'NaN');
    expect(chain.instances[0]).toBe(instance);
    expect(errors[0]).toBeInstanceOf(TypeError);
    declaration.effect = customEffect(() => { throw new Error('candidate failed'); });
    expect(chain.instances[0]).toBe(instance);
    expect(declaration.module?.params).toBe(instance.params);
    expect(errors).toHaveLength(2);
  });

  it('does not leave a late candidate in a scope left during construction', async () => {
    const first = fixture();
    const second = fixture();
    const declaration = effect();
    let moved = false;
    declaration.effect = customEffect((context) => {
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
    expect(declaration.module?.id).toBe(second.chain.instances[0].id);
  });

  it('removes its slot even if a borrowed target unsubscribe throws during unmount', async () => {
    const {host, chain} = fixture();
    const declaration = effect();
    const failure = new Error('unsubscribe failed');
    declaration.moduleTarget = {id: 'throwing-target', inserts: chain, subscribe: () => () => { throw failure; }};
    const errors: unknown[] = [];
    declaration.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    host.append(declaration);
    const instance = chain.instances[0];
    declaration.remove();
    await settle();
    expect(errors).toEqual([failure]);
    expect(chain.instances).toHaveLength(0);
    expect(instance.params.get('gain')!.snapshot.disposed).toBe(true);
  });
});
