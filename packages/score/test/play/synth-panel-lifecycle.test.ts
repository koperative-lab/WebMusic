// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ParameterRackBinding} from '@webmusic/ui/parameter';
import type {Effect, EffectNode} from '../../src/play/headless/effects';
import {SynthPanelElement} from '../../src/play/element/synth-panel';

const captured = vi.hoisted(() => ({bindings: [] as unknown[]}));
vi.mock('@webmusic/ui/parameter', () => ({
  mountParameterRack: (host: HTMLElement, binding: ParameterRackBinding) => {
    captured.bindings.push(binding);
    const element = document.createElement('div');
    host.append(element);
    return {element, update: vi.fn(), destroy: () => element.remove()};
  },
}));

customElements.define('synth-panel-lifecycle-test', SynthPanelElement);
const panel = () => document.createElement('synth-panel-lifecycle-test') as SynthPanelElement;
const binding = () => captured.bindings.at(-1) as ParameterRackBinding;
const node = () => ({connect: vi.fn(), disconnect: vi.fn()}) as unknown as AudioNode;
const context = () => ({createGain: vi.fn(() => node()), close: vi.fn()}) as unknown as AudioContext;
function effect() {
  const nodes: EffectNode[] = [];
  const descriptor = {build: vi.fn(() => {
    const built = {input: node(), output: node(), dispose: vi.fn()} as EffectNode;
    nodes.push(built);
    return built;
  })} as unknown as Effect;
  return {descriptor, nodes};
}
function deferred() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((_resolve, failure) => { reject = failure; });
  return {promise, reject};
}

afterEach(() => {
  document.body.replaceChildren();
  captured.bindings.length = 0;
});

describe('synth-panel audio and parameter lifecycle', () => {
  it('does not rebuild audio when non-audio sections are reordered, added or hidden', () => {
    const element = panel();
    const voice = effect();
    const audio = context();
    element.sections = ['effects', 'sound'];
    element.context = audio;
    element.effects = [voice.descriptor];
    document.body.append(element);
    const input = element.input;
    const output = element.output;
    element.sections = ['sound', 'effects', 'macros'];
    element.sections = ['effects'];
    expect(voice.descriptor.build).toHaveBeenCalledOnce();
    expect(element.input).toBe(input);
    expect(element.output).toBe(output);
    expect(voice.nodes[0].dispose).not.toHaveBeenCalled();
    element.sections = ['sound'];
    expect(element.input).toBe(input);
    expect(element.output).toBe(output);
    expect(input?.connect).toHaveBeenLastCalledWith(output);
    expect(voice.nodes[0].dispose).toHaveBeenCalledOnce();
    element.sections = ['effects'];
    expect(element.input).toBe(input);
    expect(element.output).toBe(output);
    expect(voice.descriptor.build).toHaveBeenCalledTimes(2);
    element.remove();
    expect(audio.close).not.toHaveBeenCalled();
  });

  it('retains old effect descriptors and usable ports when a replacement build fails', () => {
    const element = panel();
    const voice = effect();
    element.sections = ['effects'];
    element.context = context();
    const original = [voice.descriptor];
    element.effects = original;
    document.body.append(element);
    const input = element.input;
    const failure = {build: () => { throw new Error('build failed'); }} as unknown as Effect;
    expect(() => { element.effects = [failure]; }).toThrow('build failed');
    expect(element.effects).toBe(original);
    expect(element.input).toBe(input);
    expect(voice.nodes[0].dispose).not.toHaveBeenCalled();
    element.sections = ['effects', 'sound'];
    expect(voice.descriptor.build).toHaveBeenCalledOnce();
  });

  it('rolls back the current failed parameter write', async () => {
    const element = panel();
    element.sections = ['sound'];
    element.sound = [{name: 'gain', value: 0.2, min: 0, max: 1, apply: () => Promise.reject(new Error('apply failed'))}];
    document.body.append(element);
    const parameters = binding();
    await expect(parameters.setValue('0', 0.6)).rejects.toThrow('apply failed');
    expect(parameters.snapshot().parameters[0].value).toBe(0.2);
  });

  it('does not let an older rejected apply overwrite a newer successful value', async () => {
    const element = panel();
    const pending = deferred();
    const apply = vi.fn().mockReturnValueOnce(pending.promise).mockReturnValue(undefined);
    element.sections = ['sound'];
    element.sound = [{name: 'gain', value: 0.2, min: 0, max: 1, apply}];
    document.body.append(element);
    const parameters = binding();
    const first = parameters.setValue('0', 0.5);
    await parameters.setValue('0', 0.9);
    pending.reject(new Error('old apply failed'));
    await expect(first).rejects.toThrow('old apply failed');
    expect(parameters.snapshot().parameters[0].value).toBe(0.9);
  });

  it('does not let a rejected apply from replaced descriptors alter the new parameters', async () => {
    const element = panel();
    const pending = deferred();
    element.sections = ['sound'];
    element.sound = [{name: 'old gain', value: 0.1, min: 0, max: 1, apply: () => pending.promise}];
    document.body.append(element);
    const first = binding().setValue('0', 0.5);
    element.sound = [{name: 'new gain', value: 0.3, min: 0, max: 1, apply: vi.fn()}];
    await binding().setValue('0', 0.8);
    pending.reject(new Error('old descriptor failed'));
    await expect(first).rejects.toThrow('old descriptor failed');
    expect(binding().snapshot().parameters[0].value).toBe(0.8);
  });
});
