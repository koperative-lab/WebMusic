// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, parseModuleProject} from '@webmusic/kernel/module';
import {componentModuleSource, componentPageSource, componentResources, defineComponentElement, mountComponent, type ComponentHandle} from '../src/component';

class Node {
  readonly connections = new Set<Node>();
  gain = {value: 1, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn()};
  offset = this.gain;
  fftSize = 2048; frequencyBinCount = 1024;
  constructor(readonly context: Context) {}
  connect(destination: Node) { this.connections.add(destination); return destination; }
  disconnect() { this.connections.clear(); }
  start() {} stop() {}
  getFloatTimeDomainData(values: Float32Array) { values.fill(0); }
  getByteFrequencyData(values: Uint8Array) { values.fill(0); }
  getFloatFrequencyData(values: Float32Array) { values.fill(-100); }
}
class Context {
  currentTime = 0; state = 'running'; sampleRate = 48000;
  destination = new Node(this);
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createGain() { return new Node(this); }
  createAnalyser() { return new Node(this); }
  createConstantSource() { return new Node(this); }
}

const object = (id: string, name: string, args = '', contextId = 'root') => ({id, contextId, label: `${name} ${args}`.trim(), plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args}});
const project = () => parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'arabesque-controls', contexts: [{id: 'root'}],
  assets: [{id: 'midi', uri: 'midi/Arabesque%20No.1.mid', mediaType: 'audio/midi'}],
  modules: [object('on', 'toggle'), object('size', 'dial', '0 100'), object('log', 'print'), object('hidden', 'metro', '4n'),
    {id: 'synth', contextId: 'root', plugin: {id: 'webmusic.reference.poly-synth', version: '1.0.0'}, config: {}}],
  connections: [{id: 'c', kind: 'message', from: {moduleId: 'size', port: 'out0'}, to: {moduleId: 'log', port: 'in0'}}],
  layout: {modules: [{moduleId: 'on', x: 40, y: 40}, {moduleId: 'size', x: 120, y: 40}], presentation: [{moduleId: 'size', x: 0, y: 0}]}});

const handles: ComponentHandle[] = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.destroy(); document.body.replaceChildren(); });

describe('component export', () => {
  it('lists what a project needs beyond the packages', () => {
    expect(componentResources(project())).toEqual({assets: ['midi/Arabesque%20No.1.mid'], plugins: ['webmusic.reference.poly-synth']});
    expect(componentResources(project(), ['webmusic.reference.poly-synth']).plugins).toEqual([]);
  });

  it('writes a module and a standalone page that define the element', () => {
    const module = componentModuleSource(project(), {tag: 'arabesque-controls'});
    expect(module).toContain(`import {defineComponentElement} from '@webmusic/bridge/component';`);
    expect(module).toContain(`export default defineComponentElement("arabesque-controls", project);`);
    expect(module).toContain('//   webmusic.reference.poly-synth');
    const page = componentPageSource({...project(), id: 'x</script><b>'}, {tag: 'arabesque-controls', title: 'A <b>', assetBase: 'https://example.org/'});
    expect(page).toContain('<arabesque-controls></arabesque-controls>');
    expect(page).toContain('https://cdn.jsdelivr.net/npm/@webmusic/bridge@0.3.0/component/+esm');
    expect(page).toContain('<title>A &lt;b></title>');
    expect(page).not.toContain('</script><b>');
    expect(page).toContain('{base: "https://example.org/"}');
    expect(() => componentModuleSource(project(), {tag: 'NoHyphen'})).toThrow(/custom element name/);
  });
});

describe('mountComponent', () => {
  it('runs the project and shows its presentation with UI Kit controls', async () => {
    const printed: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountComponent(host, project(), {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}),
      objects: {print: (_name, text) => printed.push(text)}, onError: () => {}});
    handles.push(handle);
    await handle.ready;
    const items = host.querySelectorAll('.wmc__item');
    // Only the placed dial: a presentation shows what was placed.
    expect(items).toHaveLength(1);
    expect(host.querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('arabesque-controls');
    expect(handle.runtime.snapshot().modules.find(module => module.record.id === 'synth')!.status).toBe('unresolved');
    // The dial drives its object, whose output reaches print.
    const slider = items[0]!.querySelector('[role="slider"]') as HTMLElement;
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(printed).toHaveLength(1);
    expect(Number(printed[0])).toBeGreaterThan(0);
    // The stage takes the size of what it holds, never a width wider than its host.
    const stage = host.querySelector('.wmc__stage') as HTMLElement;
    expect(stage.style.minWidth).toBe('');
    expect((stage.querySelector('.wmc__extent') as HTMLElement).style.width).toBe(`${8 + 160 + 8}px`);
    expect(items[0]!.getAttribute('style')).toContain('left: 8px; top: 8px');
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('gives a resized box its saved size', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = {...project(), layout: {...project().layout, presentation: [{moduleId: 'size', x: 0, y: 0, width: 240, height: 96}]}};
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    const item = host.querySelector('.wmc__item') as HTMLElement;
    expect(item.style.width).toBe('240px');
    expect(item.style.height).toBe('96px');
    expect((host.querySelector('.wmc__extent') as HTMLElement).style.width).toBe(`${8 + 240 + 8}px`);
  });

  it('defines an element that mounts while connected', async () => {
    const audio = new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext});
    const Element = defineComponentElement('arabesque-test', project(), {audio, onError: () => {}});
    expect(defineComponentElement('arabesque-test', project())).toBe(Element);
    const element = document.createElement('arabesque-test') as HTMLElement & {component?: ComponentHandle};
    document.body.append(element);
    await element.component!.ready;
    expect(element.shadowRoot!.querySelectorAll('.wmc__item')).toHaveLength(1);
    element.remove();
    expect(element.component).toBeUndefined();
  });
});
