// @vitest-environment jsdom
import {gzipSync} from 'node:zlib';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry, parseModuleProject, sourceOrigin} from '@webmusic/kernel/module';
import {
  CLIP_PLUGIN, ComponentSurfaces, KEYS_PLUGIN, LEVEL_PLUGIN, OFFICIAL_COMPONENTS, ROLL_PLUGIN, SCOPE_PLUGIN,
  componentManifestOf, componentModuleSource, componentPageSource, componentResources, configOfArguments, controlSize, defineComponentElement,
  componentContents, componentPorts, componentUsage, findComponentManifest, fitComponentElement, isListener, migrateBufferViews, mountComponent, projectManifest, type ComponentHandle,
  componentSettings, configureComponentElement, createComponentElement, isStyleSetting, settableAttributes, withComponentSetting,
  SAVED_SCORE_ENCODING, SAVED_SCORE_FORMAT, createComponentPlugins, decodeScore, encodeScore,
  keepComponentSessionPreloaded, THEME_TOKENS, applyComponentStyle, componentTheme, ownStyle, styleDeclarations, styleSource, withComponentTheme, withStyleSource,
} from '../src/component';
import {componentPlugin} from '@webmusic/kernel/objects';
import {createAudioClip} from '@webmusic/audio';
import {sharedBuffersFor} from '@webmusic/audio/play/headless';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';

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
  createDelay() { return Object.assign(new Node(this), {delayTime: new Node(this).gain}); }
  createConvolver() { return Object.assign(new Node(this), {buffer: null as unknown}); }
  createWaveShaper() { return Object.assign(new Node(this), {curve: null as unknown, oversample: 'none'}); }
  createStereoPanner() { return Object.assign(new Node(this), {pan: new Node(this).gain}); }
  createBiquadFilter() { const node = new Node(this); return Object.assign(node, {type: 'lowpass', frequency: new Node(this).gain, Q: new Node(this).gain, detune: new Node(this).gain}); }
  createOscillator() { const node = new Node(this); return Object.assign(node, {type: 'sine', frequency: new Node(this).gain, detune: new Node(this).gain}); }
  createDynamicsCompressor() { return new Node(this); }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const channels = Array.from({length: numberOfChannels}, () => new Float32Array(length));
    return {numberOfChannels, length, sampleRate, duration: length / sampleRate, getChannelData: (index: number) => channels[index]!,
      copyFromChannel: (target: Float32Array, index: number) => target.set(channels[index]!.subarray(0, target.length)),
      copyToChannel: (source: Float32Array, index: number) => channels[index]!.set(source)};
  }
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
    // An unsized control has its natural size, and fills it.
    expect((stage.querySelector('.wmc__extent') as HTMLElement).style.width).toBe(`${8 + 48 + 8}px`);
    expect(items[0]!.getAttribute('style')).toContain('left: 8px; top: 8px');
    expect([(items[0] as HTMLElement).style.width, (items[0] as HTMLElement).style.height]).toEqual(['48px', '64px']);
    expect((items[0]!.querySelector('.wui-control') as HTMLElement).dataset.fill).toBe('true');
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

  it('gives each control a natural size from its text', () => {
    expect(controlSize('toggle')).toEqual({width: 32, height: 32});
    expect(controlSize('button', 'button')).toEqual({width: 32, height: 32});
    expect(controlSize('dial', 'dial 200. 4000.')).toEqual({width: 48, height: 64});
    expect(controlSize('slider', 'slider')).toEqual({width: 128, height: 32});
    // A matrix and a preset grid have one cell per column and row; arguments that are not counts fall back.
    expect(controlSize('matrix', 'matrix 3 2')).toEqual({width: 96, height: 64});
    expect(controlSize('matrix', 'matrix')).toEqual({width: 128, height: 128});
    expect(controlSize('preset', 'preset 20')).toEqual({width: 256, height: 96});
    expect(controlSize('preset', 'preset 4')).toEqual({width: 128, height: 32});
    // Text decides how wide a message box and tabs are, within limits.
    expect(controlSize('message', 'message 42').width).toBe(48);
    expect(controlSize('message', 'message loop 2 4').width).toBeGreaterThan(48);
    expect(controlSize('tab', 'tab one two three').width).toBeGreaterThan(controlSize('tab', 'tab one two').width);
    expect(controlSize('message', `message ${'x'.repeat(400)}`).width).toBe(320);
    expect(findComponentManifest('keys')!.width).toBe(320);
    expect(findComponentManifest('meter')!.width).toBeLessThan(findComponentManifest('scope')!.width);
  });

  it('makes a view as tall as its box and follows the box', () => {
    const frames: (() => void)[] = [];
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe(target: Element): void { observed.push(target); } unobserve(): void {} disconnect = disconnect; });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const run = () => { for (const frame of frames.splice(0)) frame(); };
    const sized = (element: HTMLElement, name: 'clientHeight' | 'offsetHeight', read: () => number) => Object.defineProperty(element, name, {configurable: true, get: read});
    try {
      // A scope: readouts and tools take 70 px, whatever the plot's height.
      let height = 300;
      const box = document.createElement('div');
      const scope = document.createElement('div');
      const body = document.createElement('div');
      body.setAttribute('part', 'root surface');
      const plot = document.createElement('canvas');
      plot.setAttribute('part', 'plot');
      body.append(plot);
      scope.append(body);
      box.append(scope);
      document.body.append(box);
      const plotHeight = () => Number.parseFloat(scope.style.getPropertyValue('--wm-oscilloscope-height')) || 176;
      sized(box, 'clientHeight', () => height);
      sized(plot, 'offsetHeight', plotHeight);
      sized(body, 'offsetHeight', () => plotHeight() + 70);
      const release = fitComponentElement(scope, findComponentManifest('scope')!);
      run();
      expect(scope.style.getPropertyValue('--wm-oscilloscope-height')).toBe('230px');
      // Measured again, it has what it needs and writes nothing more.
      run();
      expect(frames).toHaveLength(0);
      // It follows the box, and what it draws: a readout that wraps leaves the plot less room.
      expect(observed).toEqual([box, body]);
      sized(body, 'offsetHeight', () => plotHeight() + 90);
      resized!();
      run();
      expect(scope.style.getPropertyValue('--wm-oscilloscope-height')).toBe('210px');
      sized(body, 'offsetHeight', () => plotHeight() + 70);
      height = 120;
      resized!();
      run();
      expect(scope.style.getPropertyValue('--wm-oscilloscope-height')).toBe('50px');
      // Never shorter than the least the drawing can be.
      height = 40;
      resized!();
      run();
      expect(scope.style.getPropertyValue('--wm-oscilloscope-height')).toBe('32px');
      release();
      expect(scope.style.getPropertyValue('--wm-oscilloscope-height')).toBe('');
      expect(disconnect).toHaveBeenCalledTimes(1);

      // A roll takes its whole height as an attribute, and gets its own back.
      const frame = document.createElement('div');
      const roll = document.createElement('div');
      roll.setAttribute('height', '176');
      frame.append(roll);
      document.body.append(frame);
      sized(frame, 'clientHeight', () => 256);
      const releaseRoll = fitComponentElement(roll, findComponentManifest('roll')!);
      run();
      expect(roll.getAttribute('height')).toBe('256');
      releaseRoll();
      expect(roll.getAttribute('height')).toBe('176');
      // Without a box there is nothing to follow.
      expect(() => fitComponentElement(document.createElement('div'), findComponentManifest('keys')!)()).not.toThrow();
      // A component without a fit keeps its own height.
      const level = document.createElement('div');
      frame.append(level);
      fitComponentElement(level, findComponentManifest('level')!)();
      run();
      expect(level.getAttribute('height')).toBeNull();
    } finally { vi.unstubAllGlobals(); }
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

const request = (id: string, plugin: string, config: Record<string, unknown> = {}) => {
  const registered: unknown[] = [];
  const context = new Context();
  return {
    registered,
    value: {record: {id, contextId: 'root', plugin: {id: plugin, version: '1.0.0'}, config}, signal: new AbortController().signal, asset: () => undefined, context: {
      audio: {prepare: () => context}, registry: {register: (module: unknown) => { registered.push(module); return {release: () => registered.splice(registered.indexOf(module), 1)}; }},
      derive(options: Record<string, unknown>) { return {audio: {prepare: () => context}, ...options}; },
    }} as never,
  };
};

describe('component manifests (DEC-081)', () => {
  it('derives a graph-authored component\'s ports from its edge objects, as the component object names them (LAYER-A1)', async () => {
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'edges', contexts: [{id: 'root'}, {id: 'inner', parentId: 'root'}],
      assets: [{id: 'midi', uri: 'midi/Arabesque%20No.1.mid', mediaType: 'audio/midi'}],
      modules: [
        {id: 'shell', contextId: 'root', plugin: {id: 'webmusic.object.component', version: '1.0.0'}, config: {inlets: ['message', 'audio'], outlets: ['audio']}},
        object('a', 'inlet', '0', 'inner'), object('b', 'inlet~', '1', 'inner'), object('c', 'outlet~', '0', 'inner'),
        // Edge objects at the top describe the exported component itself.
        object('top', 'outlet', '0'),
      ],
      connections: [], layout: {modules: []}});
    const inner = projectManifest(input, 'inner');
    expect(inner.ports).toEqual([
      {id: 'in0', family: 'message', direction: 'input'}, {id: 'in1', family: 'audio', direction: 'input'}, {id: 'out0', family: 'audio', direction: 'output'},
    ]);
    // The component object's own ports for the same config.
    const instance = await componentPlugin().create(request('shell', 'webmusic.object.component', {inlets: ['message', 'audio'], outlets: ['audio']}).value);
    expect((instance.ports ?? []).map(port => ({id: port.id, family: port.kind, direction: port.direction})).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...inner.ports].sort((a, b) => a.id.localeCompare(b.id)));
    instance.dispose?.();
    expect(projectManifest(input).ports).toEqual([{id: 'out0', family: 'message', direction: 'output'}]);
    expect(projectManifest(input).assets.map(asset => asset.uri)).toEqual(['midi/Arabesque%20No.1.mid']);
  });

  it('makes each official component\'s ports from its manifest, with no code for its kind (LAYER-A2)', async () => {
    const surfaces = new ComponentSurfaces();
    const plugins = new Map(surfaces.plugins().map(plugin => [plugin.id, plugin]));
    expect([...plugins.keys()]).toEqual(OFFICIAL_COMPONENTS.map(manifest => manifest.plugin));
    for (const manifest of OFFICIAL_COMPONENTS) {
      const {value} = request(manifest.name, manifest.plugin);
      const instance = await plugins.get(manifest.plugin)!.create(value);
      expect((instance.ports ?? []).map(port => [port.id, port.kind, port.direction])).toEqual(manifest.ports.map(port => [port.id, port.family, port.direction]));
      instance.dispose?.();
    }
    // An audio input reaches the slot's analyser; a release leaves nothing provided.
    const scope = await plugins.get(SCOPE_PLUGIN)!.create(request('s', SCOPE_PLUGIN).value);
    expect(scope.getInput!('input')).toBe(surfaces.slot('s').analyser.current);
    scope.dispose?.();
    expect(surfaces.slot('s').analyser.current).toBeUndefined();
    // A note output is registered while it lives and forwards the Element's notes.
    const keys = request('k', KEYS_PLUGIN);
    const keysInstance = await plugins.get(KEYS_PLUGIN)!.create(keys.value);
    expect(keys.registered).toHaveLength(1);
    expect(typeof surfaces.slot('k').notes.current).toBe('function');
    keysInstance.dispose?.();
    expect(keys.registered).toHaveLength(0);
    expect(surfaces.slot('k').notes.current).toBeUndefined();
    // A source cord hands the upstream module to the roll's slot.
    const upstream = {id: 'score'};
    const lease = surfaces.connect({connection: {id: 'c', kind: 'source', from: {moduleId: 'score', port: 'source'}, to: {moduleId: 'r', port: 'source'}}, from: {module: upstream}} as never);
    expect(surfaces.slot('r').source.current).toBe(upstream);
    (lease as {release(): void}).release();
    expect(surfaces.slot('r').source.current).toBeUndefined();
    expect(componentManifestOf(ROLL_PLUGIN)!.name).toBe('roll');
    expect(isListener(SCOPE_PLUGIN)).toBe(true);
    expect(isListener(KEYS_PLUGIN)).toBe(false);
    expect(isListener(CLIP_PLUGIN)).toBe(false);
  });

  it('loads projects saved with the view objects\' plugin IDs unchanged (LAYER-A4)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const surface = (id: string, config: Record<string, unknown> = {}) => ({id, contextId: 'root', label: id, plugin: {id: `webmusic.surface.${id}`, version: '1.0.0'}, config});
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'views', contexts: [{id: 'root'}], assets: [],
      modules: [surface('keys', {low: 48, high: 72}), surface('roll'), surface('scope', {timebaseMs: 20}), surface('meter'), surface('spectrum')],
      connections: [], layout: {modules: ['keys', 'roll', 'scope', 'meter', 'spectrum'].map((moduleId, index) => ({moduleId, x: 0, y: index * 200}))}});
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    expect(handle.runtime.snapshot().modules.map(module => module.status)).toEqual(['ready', 'ready', 'ready', 'ready', 'ready']);
    expect([...host.querySelectorAll('.wmc__item > *')].map(element => element.localName))
      .toEqual(['score-note-input', 'score-grid-view', 'audio-oscilloscope', 'audio-meter', 'audio-spectrum-analyzer']);
    expect(host.querySelector('audio-oscilloscope')!.getAttribute('timebase-ms')).toBe('20');
    expect([host.querySelector('score-note-input')!.getAttribute('start'), host.querySelector('score-note-input')!.getAttribute('end')]).toEqual(['48', '72']);
  });

  it('places a component outside the five through its manifest alone (LAYER-A3)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'level', contexts: [{id: 'root'}],
      assets: [], modules: [{id: 'level', contextId: 'root', label: 'level -24', plugin: {id: LEVEL_PLUGIN, version: '1.0.0'}, config: {thresholdDbfs: -24}}],
      connections: [], layout: {modules: [{moduleId: 'level', x: 0, y: 0}]}});
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    const element = host.querySelector('audio-level-analyzer') as HTMLElement & {analyser?: AnalyserNode};
    expect(element).not.toBeNull();
    expect(element.getAttribute('threshold-dbfs')).toBe('-24');
    expect(element.parentElement!.style.width).toBe('288px');
    expect(element.analyser).toBeDefined();
    expect(handle.runtime.snapshot().modules[0]!.status).toBe('ready');
  });

  it('reads box arguments by the manifest\'s parameters', () => {
    expect(configOfArguments(findComponentManifest('keys')!, ['36', '84'])).toEqual({config: {low: 36, high: 84}});
    expect(configOfArguments(findComponentManifest('keys')!, ['36', '200'])).toEqual({config: {low: 36, high: 127}, error: 'keys high must be within 0–127.'});
    expect(configOfArguments(findComponentManifest('scope')!, [])).toEqual({config: {timebaseMs: 10}});
    expect(configOfArguments(findComponentManifest('scope')!, ['wide']).error).toMatch(/number/);
    expect(configOfArguments(findComponentManifest('meter')!, ['1']).error).toMatch(/no arguments/);
    expect(configOfArguments(findComponentManifest('clip')!, ['take'])).toEqual({config: {buffer: 'take'}});
    // A clip without a name is a working box that shows nothing until it is named.
    expect(configOfArguments(findComponentManifest('clip')!, [])).toEqual({config: {buffer: ''}});
    expect(componentUsage(findComponentManifest('clip')!)).toBe('clip [name]');
    expect(configOfArguments(findComponentManifest('view')!, ['waterfall'])).toEqual({config: {type: 'waterfall'}});
    expect(configOfArguments(findComponentManifest('view')!, ['grid'])).toEqual({config: {type: 'staff'},
      error: 'view type must be one of staff, piano-roll, waterfall.'});
    expect(componentUsage(findComponentManifest('degrees')!)).toBe('degrees [scale=major] [tonic]');
  });

  it('places every official component with no cords, each drawing its own Element (DEC-081, DEC-082)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const modules = OFFICIAL_COMPONENTS.map((manifest, index) => ({id: `m${index}`, contextId: 'root', label: manifest.name,
      plugin: {id: manifest.plugin, version: '1.0.0'}, config: Object.fromEntries(manifest.parameters.map(parameter => [parameter.name, parameter.fallback]))}));
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'all', contexts: [{id: 'root'}], assets: [], modules,
      connections: [], layout: {modules: modules.map((module, index) => ({moduleId: module.id, x: 0, y: index * 200}))}});
    const errors: unknown[] = [];
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: error => errors.push(error)});
    handles.push(handle);
    await handle.ready;
    expect(errors).toEqual([]);
    for (const manifest of OFFICIAL_COMPONENTS) {
      // Two components can share a tag (`panel` and `eq`): each module's cell holds its own Element, in module order.
      const cell = host.querySelectorAll<HTMLElement>('.wmc__item')[OFFICIAL_COMPONENTS.indexOf(manifest)];
      const element = cell?.querySelector<HTMLElement>(manifest.tag) ?? null;
      expect(element, manifest.name).not.toBeNull();
      expect(cell!.style.width, manifest.name).toBe(`${manifest.width}px`);
      for (const [name, value] of Object.entries(manifest.attributes ?? {})) expect(element!.getAttribute(name), manifest.name).toBe(value);
    }
    expect(handle.runtime.snapshot().modules.every(module => module.status === 'ready')).toBe(true);
  });

  it('splits a buffer from its waveform and migrates a presented buffer (LAYER-A6)', async () => {
    const buffers = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'buffers', contexts: [{id: 'root'}], assets: [],
      modules: [object('take', 'buffer', 'take 1'), object('spare', 'buffer', 'spare 1')],
      connections: [], layout: {modules: [{moduleId: 'take', x: 40, y: 40}, {moduleId: 'spare', x: 40, y: 120}], presentation: [{moduleId: 'take', x: 0, y: 0, width: 300, height: 140}]}});
    const migrated = migrateBufferViews(buffers);
    const clip = migrated.modules.find(record => record.plugin.id === CLIP_PLUGIN)!;
    expect(clip).toMatchObject({id: 'take-clip', label: 'clip take', config: {buffer: 'take'}});
    expect(migrated.layout.presentation).toEqual([{moduleId: 'take-clip', x: 0, y: 0, width: 300, height: 140}]);
    expect(migrated.layout.modules.find(item => item.moduleId === 'take-clip')).toEqual({moduleId: 'take-clip', x: 40, y: 88});
    // Again, nothing changes; a project with no presented buffer is untouched.
    expect(migrateBufferViews(migrated)).toEqual(migrated);
    const unplaced = {...buffers, layout: {modules: buffers.layout.modules}};
    expect(migrateBufferViews(unplaced)).toEqual(parseModuleProject(unplaced));

    // Mounted, the buffer box shows nothing and the clip shows its samples.
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountComponent(host, buffers, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    expect(host.querySelectorAll('.wmc__item')).toHaveLength(1);
    const view = host.querySelector('audio-clip-view')!;
    expect(view.getAttribute('aria-label')).toBe('Buffer take');
    // A buffer that is not shown by a clip stays out of the presentation.
    const plain = mountComponent(document.createElement('div'), unplaced, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {}});
    handles.push(plain);
    await plain.ready;
    expect(plain.runtime.snapshot().modules.every(module => module.status === 'ready')).toBe(true);
  });
});

describe('a component\'s own settings (DEC-085)', () => {
  const meter = findComponentManifest('meter')!, keys = findComponentManifest('keys')!, roll = findComponentManifest('roll')!;

  it('lets a setting write only what the Element observes and the graph does not own', () => {
    // Nothing is settable until the Element is defined.
    for (const manifest of [meter, keys, roll]) manifest.define();
    expect(settableAttributes(meter)).toEqual(expect.arrayContaining(['type', 'theme', 'size', 'bars']));
    // Sources and connections are the graph's; a box argument's attribute is its text's; a locked one is the host's.
    for (const name of ['input', 'port', 'id', 'style']) expect(settableAttributes(meter)).not.toContain(name);
    for (const name of ['start', 'end', 'layout', 'routing']) expect(settableAttributes(keys)).not.toContain(name);
    expect(settableAttributes(keys)).toContain('velocity');
    // A roll's editing is its author's switch (DEC-086).
    expect(settableAttributes(roll)).toEqual(expect.arrayContaining(['editable', 'tools', 'snap']));
    expect(settableAttributes(meter, {get: () => undefined})).toEqual([]);
    expect(componentSettings(meter, {
      attributes: {type: 'spectrum', bars: '16', input: '#other', onclick: 'steal()', src: 'https://example.org/x.wav', theme: 7},
      style: {'--wm-meter-fill': ' #222 ', '--wm-meter-track': 'url(https://example.org/x.png)', 'background': 'red',
        '--wm-surface': 'red; background: blue', '--wm-border': 'image-set("x.png" 1x)', '--wm-foreground': 'light-dark(#111, #eee)'},
    })).toEqual({attributes: {type: 'spectrum', bars: '16'}, style: {'--wm-meter-fill': '#222', '--wm-foreground': 'light-dark(#111, #eee)'}});
    // Settings that are not a record are no settings.
    expect(componentSettings(meter, {attributes: ['type'], style: 'red'})).toEqual({attributes: {}, style: {}});
    expect([isStyleSetting('--wm-note-height', '96px'), isStyleSetting('--note-height', '96px'), isStyleSetting('--wm-note-height', '')]).toEqual([true, false, false]);
    // A box argument is never also a setting key.
    for (const manifest of OFFICIAL_COMPONENTS) expect(manifest.parameters.map(parameter => parameter.name)).not.toEqual(expect.arrayContaining(['attributes']));
    for (const manifest of OFFICIAL_COMPONENTS) expect(manifest.parameters.map(parameter => parameter.name)).not.toEqual(expect.arrayContaining(['style']));
  });

  it('writes a setting into a config and takes it out again', () => {
    const typed = withComponentSetting({buffer: 'loop'}, 'attributes', 'type', 'spectrum');
    expect(typed).toEqual({buffer: 'loop', attributes: {type: 'spectrum'}});
    const styled = withComponentSetting(withComponentSetting(typed, 'style', '--wm-meter-fill', '#222'), 'attributes', 'bars', '16');
    expect(styled).toEqual({buffer: 'loop', attributes: {type: 'spectrum', bars: '16'}, style: {'--wm-meter-fill': '#222'}});
    // The last setting out leaves the config as it was before any.
    const cleared = withComponentSetting(withComponentSetting(withComponentSetting(styled, 'attributes', 'type', undefined), 'attributes', 'bars', undefined), 'style', '--wm-meter-fill', undefined);
    expect(cleared).toEqual({buffer: 'loop'});
    expect(typed).toEqual({buffer: 'loop', attributes: {type: 'spectrum'}});
  });

  it('applies settings to the Element over the manifest\'s own attributes, and gives them back', () => {
    const element = createComponentElement(roll, {attributes: {'note-height': '10', 'min-pitch': '48'}, style: {'--wm-score-grid-max-height': '20rem'}});
    expect([element.getAttribute('note-height'), element.getAttribute('min-pitch'), element.getAttribute('height')]).toEqual(['10', '48', '176']);
    expect(element.style.getPropertyValue('--wm-score-grid-max-height')).toBe('20rem');
    configureComponentElement(element, roll, {attributes: {'min-pitch': '36'}});
    // A setting that is gone gives the attribute back to the manifest, or removes it.
    expect([element.getAttribute('note-height'), element.getAttribute('min-pitch')]).toEqual(['6', '36']);
    expect(element.style.getPropertyValue('--wm-score-grid-max-height')).toBe('');
    configureComponentElement(element, roll, {});
    expect(element.hasAttribute('min-pitch')).toBe(false);
    // A box argument still writes its attribute, and a setting cannot.
    const keyboard = createComponentElement(keys, {low: 36, high: 60, attributes: {start: '0', layout: 'grid', velocity: '80'}});
    expect([keyboard.getAttribute('start'), keyboard.getAttribute('end'), keyboard.getAttribute('layout'), keyboard.getAttribute('velocity')]).toEqual(['36', '60', 'piano', '80']);
  });

  it('keeps a height setting while a resized box sizes the Element, and gives it back with the natural size', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const run = () => { for (const frame of frames.splice(0)) frame(); };
    try {
      // An attribute: the box's height while resized, then the setting made meanwhile.
      const frame = document.createElement('div');
      const grid = createComponentElement(roll, {});
      frame.append(grid);
      document.body.append(frame);
      Object.defineProperty(frame, 'clientHeight', {configurable: true, get: () => 256});
      const release = fitComponentElement(grid, roll);
      run();
      expect(grid.getAttribute('height')).toBe('256');
      configureComponentElement(grid, roll, {attributes: {height: '300', 'min-pitch': '48'}});
      expect([grid.getAttribute('height'), grid.getAttribute('min-pitch')]).toEqual(['256', '48']);
      release();
      expect(grid.getAttribute('height')).toBe('300');
      // Without the setting the Element has the manifest's height again.
      const again = fitComponentElement(grid, roll);
      run();
      configureComponentElement(grid, roll, {});
      again();
      expect(grid.getAttribute('height')).toBe('176');

      // A token: the same for the custom property a fit writes.
      const box = document.createElement('div');
      const keyboard = createComponentElement(keys, {style: {'--wm-note-height': '96px'}});
      box.append(keyboard);
      document.body.append(box);
      Object.defineProperty(box, 'clientHeight', {configurable: true, get: () => 200});
      expect(keyboard.style.getPropertyValue('--wm-note-height')).toBe('96px');
      const releaseKeys = fitComponentElement(keyboard, keys);
      run();
      expect(keyboard.style.getPropertyValue('--wm-note-height')).toBe('200px');
      releaseKeys();
      expect(keyboard.style.getPropertyValue('--wm-note-height')).toBe('96px');
    } finally { vi.unstubAllGlobals(); }
  });

  it('gives an exported component the settings its project holds', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'meter', contexts: [{id: 'root'}],
      assets: [], modules: [{id: 'meter', contextId: 'root', label: 'meter', plugin: {id: meter.plugin, version: '1.0.0'},
        config: {attributes: {type: 'spectrum', bars: '16'}, style: {'--wm-meter-fill': '#222'}}}],
      connections: [], layout: {modules: [{moduleId: 'meter', x: 0, y: 0}]}});
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    const element = host.querySelector('audio-meter') as HTMLElement;
    expect([element.getAttribute('type'), element.getAttribute('bars'), element.style.getPropertyValue('--wm-meter-fill')]).toEqual(['spectrum', '16', '#222']);
    expect(handle.runtime.snapshot().modules[0]!.status).toBe('ready');
  });
});

describe('players and desks in a graph (DEC-084)', () => {
  // A small deterministic fixture, for tests only.
  const tune = () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Piano'});
    ['C4', 'E4', 'G4'].forEach((pitch, index) => builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch),
      onsetQuarters: new Rational(index), duration: Duration.quarter(), voice: VoiceId('v')}));
    return builder.build();
  };
  const placed = (name: string, id = name) => {
    const manifest = findComponentManifest(name)!;
    const assets = !manifest.asset ? undefined
      : manifest.asset.kind === 'entries' ? {[`${manifest.asset.role}1`]: 'music', [`${manifest.asset.role}2`]: 'music'}
      : {[manifest.asset.role]: 'music'};
    return {id, contextId: 'root', label: name, plugin: {id: manifest.plugin, version: '1.0.0'}, config: {} as Record<string, string>, ...(assets ? {assets} : {})};
  };
  const mount = async (modules: ReturnType<typeof placed>[], connections: unknown[] = [], resolved: unknown = tune()) => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'desk', contexts: [{id: 'root'}],
      assets: [{id: 'music', uri: 'midi/Arabesque%20No.1.mid', mediaType: 'audio/midi'}], modules, connections,
      layout: {modules: modules.map((module, index) => ({moduleId: module.id, x: 0, y: index * 200}))}});
    const errors: unknown[] = [];
    const audio = new Context() as unknown as BaseAudioContext;
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: audio}),
      resolveAsset: () => resolved, onError: error => errors.push(error)});
    handles.push(handle);
    await handle.ready;
    await new Promise(resolve => setTimeout(resolve, 0));
    return {host, handle, errors, context: audio};
  };

  it('lends a player the graph\'s Session and plays its asset there, with the box\'s output as its destination', async () => {
    const {host, handle, errors} = await mount([placed('player')]);
    expect(errors).toEqual([]);
    const player = host.querySelector('score-player') as HTMLElement & {score?: unknown; sessionTransport?: unknown; module?: unknown};
    expect(player.score).toBeDefined();
    // One Session: the player commands the graph's, and owns none of its own.
    expect(player.sessionTransport).toBe(handle.runtime.session);
    expect(handle.runtime.getModule('player')?.getPort?.('output')).toBeDefined();
    expect(player.module).toBeDefined();
  });

  it('hands a player\'s own module to the companion its source cord reaches', async () => {
    const {host} = await mount([placed('player'), placed('roll')],
      [{id: 'c', kind: 'source', from: {moduleId: 'player', port: 'source'}, to: {moduleId: 'roll', port: 'source'}}]);
    const player = host.querySelector('score-player') as HTMLElement & {module?: unknown};
    const roll = host.querySelector('score-grid-view') as HTMLElement & {inputModule?: unknown};
    expect(player.module).toBeDefined();
    expect(roll.inputModule).toBe(player.module);
  });

  it('admits each input of a rack and a mixer as a numbered channel of the Element\'s desk', async () => {
    const {host, errors} = await mount([placed('rack'), placed('mixer')]);
    expect(errors).toEqual([]);
    const rack = host.querySelector('score-rack-control') as HTMLElement & {module?: {list(): {id: string}[]}};
    expect(rack.module!.list().map(channel => channel.id)).toEqual(['1', '2', '3', '4']);
    const mixer = host.querySelector('audio-mixer') as HTMLElement & {mixer?: {snapshot(): {members: {id: string}[]}}};
    expect(mixer.mixer!.snapshot().members.map(member => member.id)).toEqual(['1', '2', '3', '4']);
  });

  it('repeats the notes cabled to a recorder on the module its Element listens to, and plays the recorder into its box', async () => {
    const {host, handle, errors} = await mount([placed('keys'), placed('recorder')],
      [{id: 'c', kind: 'note', from: {moduleId: 'keys', port: 'notes'}, to: {moduleId: 'recorder', port: 'notes'}}]);
    expect(errors).toEqual([]);
    expect(handle.runtime.snapshot().unresolved).toEqual([]);
    const recorder = host.querySelector('score-recorder') as HTMLElement & {inputModule?: {ports(): {id: string; direction: string; subscribe(listener: (event: {gate: string}) => void): () => void}[]} | null};
    const relay = recorder.inputModule!.ports()[0]!;
    expect([relay.id, relay.direction]).toEqual(['notes', 'output']);
    const heard: string[] = [];
    relay.subscribe(event => heard.push(event.gate));
    // Play the keys' note output, as the Element's keyboard does.
    const play = (gate: 'on' | 'off', occurrenceId: string) => (handle.runtime.getModule('keys')!.ports!()[0] as unknown as {emit(event: unknown): void})
      .emit({gate, occurrenceId, sourceId: 'test', pitch: {midi: 60}, velocity: 0.8, axis: 'audio-context-seconds', time: 0, epoch: 0});
    play('on', 'a'); play('off', 'a');
    expect(heard).toEqual(['on', 'off']);
    expect(handle.runtime.getModule('recorder')?.getPort?.('output')).toBeDefined();
  });

  it('attaches a panel to the player its cord comes from, and to nothing without a cord', async () => {
    const {host} = await mount([placed('player'), placed('panel'), placed('panel', 'loose')],
      [{id: 'c', kind: 'source', from: {moduleId: 'player', port: 'source'}, to: {moduleId: 'panel', port: 'target'}}]);
    const player = host.querySelector('score-player') as HTMLElement & {module?: unknown};
    const [panel, loose] = [...host.querySelectorAll('score-synth-panel')] as (HTMLElement & {moduleTarget?: unknown})[];
    expect(player.module).toBeDefined();
    expect(panel!.moduleTarget).toBe(player.module);
    // The host preloads the Session it owns (DEC-069), so the target's parameters are real before any play.
    await new Promise(resolve => setTimeout(resolve, 20));
    const params = (player.module as {params?: {get(id: string): unknown}}).params;
    expect(params?.get('gain')).toBeDefined();
    // Explicitly unbound: it does not borrow a target by containment.
    expect(loose!.moduleTarget).toBeNull();
  });

  it('shows a named buffer in a wave, read-only, and follows the buffer', async () => {
    const {host, context, errors} = await mount([object('take', 'buffer', 'take 1') as never, {...placed('wave'), config: {buffer: 'take'}}, placed('wave', 'unnamed')]);
    expect(errors).toEqual([]);
    const [wave, unnamed] = [...host.querySelectorAll('audio-view')] as (HTMLElement & {clip?: {duration: number}})[] as [HTMLElement & {clip?: {duration: number}}, HTMLElement & {clip?: unknown}];
    expect(wave.getAttribute('type')).toBe('waveform');
    expect(unnamed.clip).toBeUndefined();
    expect(wave.clip?.duration).toBeCloseTo(1);
    const shown = wave.clip;
    sharedBuffersFor(context).set('take', context.createBuffer(1, 24000, 48000));
    expect(wave.clip).not.toBe(shown);
    expect(wave.clip?.duration).toBeCloseTo(0.5);
  });

  it('writes a take to its named buffer and links a take and a playlist to the track cabled to them', async () => {
    const clip = createAudioClip({sampleRate: 48000, channelData: [new Float32Array(4800)]});
    const cord = (id: string, to: string) => ({id, kind: 'source', from: {moduleId: 'track', port: 'source'}, to: {moduleId: to, port: 'player'}});
    const {host, handle, context, errors} = await mount(
      [placed('track'), {...placed('take'), config: {buffer: 'rec'}}, placed('playlist'), {...placed('take', 'loose'), config: {buffer: ''}}],
      [cord('a', 'take'), cord('b', 'playlist')], clip);
    expect(errors).toEqual([]);
    const track = host.querySelector('audio-player') as HTMLElement & {player?: {transport?: unknown}};
    const [take, loose] = [...host.querySelectorAll('audio-recorder')] as (HTMLElement & {player?: unknown})[];
    const playlist = host.querySelector('audio-playlist') as HTMLElement & {player?: unknown; entries: {id: string; label?: string}[]; playlist?: {outputPort: {defaultDestination?: unknown}}};
    expect(track.player).toBeDefined();
    // Both companions play through the track; an uncabled one is linked to no player.
    expect(take!.player).toBe(track.player);
    expect(playlist.player).toBe(track.player);
    expect(loose!.player).toBeUndefined();
    expect(track.player!.transport).toBe(playlist.playlist);
    // The entries are the box's assets, in role order, named by their files.
    expect(playlist.entries.map(entry => [entry.id, entry.label])).toEqual([['entry1', 'Arabesque No.1.mid'], ['entry2', 'Arabesque No.1.mid']]);
    // The queue plays into its own box, inside the graph's AudioContext.
    expect(playlist.playlist!.outputPort.defaultDestination).toBe((handle.runtime.getModule('playlist')!.getPort!('output') as unknown as {node: unknown}).node);
    // A finished take becomes the named buffer.
    take!.dispatchEvent(new CustomEvent('webaudio:recorded', {detail: {clip}}));
    const buffers = sharedBuffersFor(context);
    expect(buffers.get('rec')?.length).toBe(4800);
  });

  it('lets a wave follow the track cabled to it, and draws a spectrogram of what it shows', async () => {
    const clip = createAudioClip({sampleRate: 48000, channelData: [new Float32Array(48000 * 2)]});
    const {host, errors} = await mount([placed('track'), placed('wave'), {...placed('wave', 'spectrum'), config: {type: 'spectrogram'}}, placed('wave', 'loose')],
      [{id: 'a', kind: 'source', from: {moduleId: 'track', port: 'source'}, to: {moduleId: 'wave', port: 'source'}},
        {id: 'b', kind: 'source', from: {moduleId: 'track', port: 'source'}, to: {moduleId: 'spectrum', port: 'source'}}], clip);
    expect(errors).toEqual([]);
    const track = host.querySelector('audio-player') as HTMLElement & {clip?: unknown};
    const [wave, spectrum, loose] = [...host.querySelectorAll('audio-view')] as (HTMLElement & {clip?: unknown; spectrogram?: {times: ArrayLike<number>}})[];
    expect(track.clip).toBe(clip);
    // Contained in the track's scope, the wave draws the track's clip, so it is not waiting; an uncabled one waits.
    // `.clip` reports only a clip given to the view itself.
    expect(wave!.clip).toBeUndefined();
    expect(wave!.querySelector('[part="waiting"]')).toBeNull();
    expect(loose!.querySelector('[part="waiting"]')).not.toBeNull();
    expect(wave!.spectrogram).toBeUndefined();
    expect(spectrum!.getAttribute('type')).toBe('spectrogram');
    expect(spectrum!.spectrogram!.times.length).toBeGreaterThan(1);
    expect(spectrum!.spectrogram!.times.length).toBeLessThanOrEqual(2048);
  });

  it('puts an eq between its box\'s input and output, in the graph\'s AudioContext', async () => {
    const {host, handle, context, errors} = await mount([placed('eq')]);
    expect(errors).toEqual([]);
    const eq = host.querySelector('score-synth-panel') as HTMLElement & {context?: unknown; input?: {connections?: Set<unknown>}; output?: {connections: Set<unknown>}};
    expect(eq.getAttribute('mode')).toBe('insert');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(eq.context).toBe(context);
    expect(eq.input).toBeDefined();
    const boxOut = (handle.runtime.getModule('eq')!.getPort!('output') as unknown as {node: unknown}).node;
    expect(eq.output!.connections.has(boxOut)).toBe(true);
  });

  it('wraps the effect declarations: each is one insert on the player its cord comes from (DEC-089)', async () => {
    const clip = createAudioClip({sampleRate: 48000, channelData: [new Float32Array(4800)]});
    const {host, errors} = await mount([placed('player'), {...placed('effect'), config: {type: 'delay'}}, placed('effect', 'loose')],
      [{id: 'a', kind: 'source', from: {moduleId: 'player', port: 'source'}, to: {moduleId: 'effect', port: 'target'}}]);
    expect(errors).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 20));
    const player = host.querySelector('score-player') as HTMLElement & {module?: {inserts?: {slots: readonly {id: string}[]}}};
    const [effect, loose] = [...host.querySelectorAll('score-effect')] as (HTMLElement & {moduleTarget?: unknown; slotId: string})[];
    expect(effect!.getAttribute('type')).toBe('delay');
    expect(effect!.moduleTarget).toBe(player.module);
    expect(loose!.moduleTarget).toBeNull();
    expect(player.module!.inserts!.slots.map(slot => slot.id)).toEqual([effect!.slotId]);
    void clip;
  });

  it('places a rack part inside a desk of its own, playing its asset in the graph\'s Session (DEC-089)', async () => {
    const {host, handle, errors} = await mount([{...placed('part'), config: {sound: 'sine'}}]);
    expect(errors).toEqual([]);
    const desk = host.querySelector('.wmc__item > score-rack-control') as HTMLElement & {module?: {list(): unknown[]}; sessionTransport?: unknown};
    const part = desk.querySelector(':scope > score-rack-part') as HTMLElement & {score?: unknown; module?: unknown};
    expect(desk.getAttribute('master')).toBe('false');
    expect(part.getAttribute('sound')).toBe('sine');
    expect(part.score).toBeDefined();
    expect(desk.sessionTransport).toBe(handle.runtime.session);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(desk.module!.list()).toHaveLength(1);
    expect(part.module).toBeDefined();
  });

  it('opens an eq to the effects it names, before its EQ, and reports a word it does not know', async () => {
    const {host, errors} = await mount([{...placed('eq'), config: {effects: 'delay,reverb'}}]);
    expect(errors).toEqual([]);
    const eq = host.querySelector('score-synth-panel') as HTMLElement & {effects: {label?: string}[]};
    expect(eq.getAttribute('sections')).toBe('effects,eq');
    expect(eq.effects.map(effect => effect.label)).toEqual(['delay', 'reverb']);
    const manifest = findComponentManifest('eq')!;
    expect(configOfArguments(manifest, ['delay,echo'])).toEqual({config: {effects: ''}, error: expect.stringContaining('must list')});
    expect(configOfArguments(manifest, ['gain, filter'])).toEqual({config: {effects: 'gain,filter'}});
  });

  it('cables official components inside a component of objects through note and source edges (DEC-089)', async () => {
    const clip = createAudioClip({sampleRate: 48000, channelData: [new Float32Array(4800)]});
    const host = document.createElement('div');
    document.body.append(host);
    const inner = (record: ReturnType<typeof placed>) => ({...record, contextId: 'inside'});
    const edge = (id: string, name: string) => ({id, contextId: 'inside', label: `${name} 0`, plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args: '0'}});
    const cord = (id: string, kind: string, from: [string, string], to: [string, string]) => ({id, kind, from: {moduleId: from[0], port: from[1]}, to: {moduleId: to[0], port: to[1]}});
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'nested', contexts: [{id: 'root'}, {id: 'inside', parentId: 'root', ownerModuleId: 'mine'}],
      assets: [{id: 'music', uri: 'midi/Arabesque%20No.1.mid', mediaType: 'audio/midi'}, {id: 'recording', uri: 'wav/Arabesque%20No.1.wav', mediaType: 'audio/wav'}],
      modules: [
        placed('player'), placed('keys'), {...placed('track'), assets: {source: 'recording'}},
        {id: 'mine', contextId: 'root', label: 'component mine', plugin: {id: 'webmusic.object.component', version: '1.0.0'}, config: {inlets: ['source', 'note', 'source'], outlets: ['source'], embed: true}},
        inner(placed('roll')), inner(placed('recorder')), inner(placed('take')),
        {...edge('score-in', 'inlet.source'), config: {args: '0'}}, {...edge('notes-in', 'inlet.note'), config: {args: '1'}}, {...edge('track-in', 'inlet.source'), config: {args: '2'}},
        edge('score-out', 'outlet.source'), placed('sheet'),
      ],
      connections: [
        cord('a', 'source', ['player', 'source'], ['mine', 'in0']), cord('b', 'note', ['keys', 'notes'], ['mine', 'in1']), cord('c', 'source', ['track', 'source'], ['mine', 'in2']),
        cord('d', 'source', ['score-in', 'out0'], ['roll', 'source']), cord('e', 'note', ['notes-in', 'out0'], ['recorder', 'notes']),
        cord('f', 'source', ['track-in', 'out0'], ['take', 'player']), cord('g', 'source', ['score-in', 'out0'], ['score-out', 'in0']),
        cord('h', 'source', ['mine', 'out0'], ['sheet', 'source']),
      ],
      layout: {modules: []}});
    const errors: unknown[] = [];
    const resolved = (asset: {uri: string}) => asset.uri.endsWith('.mid') ? tune() : clip;
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}),
      resolveAsset: asset => resolved(asset), onError: error => errors.push(error)});
    handles.push(handle);
    await handle.ready;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(errors).toEqual([]);
    expect(handle.runtime.snapshot().unresolved).toEqual([]);
    const player = host.querySelector('score-player') as HTMLElement & {module?: {ports?(): {id: string}[]}};
    const track = host.querySelector('audio-player') as HTMLElement & {player?: unknown};
    // A roll inside follows the player outside, and a sheet outside follows it through the outlet too.
    for (const tag of ['score-grid-view', 'score-sheet-view']) {
      const view = host.querySelector(tag) as HTMLElement & {inputModule?: {ports?(): {id: string}[]} | null};
      expect(sourceOrigin((view.inputModule ?? undefined) as never), tag).toBe(player.module);
      expect(view.inputModule!.ports!().map(port => port.id), tag).toEqual(player.module!.ports!().map(port => port.id));
    }
    // The take inside plays through the track outside.
    expect((host.querySelector('audio-recorder') as HTMLElement & {player?: unknown}).player).toBe(track.player);
    // Notes from the keys outside reach the recorder inside.
    const recorder = host.querySelector('score-recorder') as HTMLElement & {inputModule?: {ports(): {subscribe(listener: (event: {gate: string}) => void): () => void}[]}};
    const heard: string[] = [];
    recorder.inputModule!.ports()[0]!.subscribe(event => heard.push(event.gate));
    (handle.runtime.getModule('keys')!.ports!()[0] as unknown as {emit(event: unknown): void})
      .emit({gate: 'on', occurrenceId: 'n', sourceId: 'test', pitch: {midi: 60}, velocity: 0.8, axis: 'audio-context-seconds', time: 0, epoch: 0});
    expect(heard).toEqual(['on']);
    // Set to show what it holds, the nested component is a cell holding its official components (DEC-089).
    const nested = host.querySelector('.wmc__nested')!;
    expect(nested.getAttribute('aria-label')).toBe('component mine');
    expect([...nested.querySelectorAll(':scope > .wmc__item > *')].map(element => element.localName).sort())
      .toEqual(['audio-recorder', 'score-grid-view', 'score-recorder']);
    expect(componentContents(input).map(item => `${item.kind} ${item.record.id}`).sort())
      .toEqual(['component keys', 'component player', 'component sheet', 'component track', 'nested mine']);
    const hidden = parseModuleProject({...input, modules: input.modules.map(record => record.id === 'mine' ? {...record, config: {...record.config, embed: false}} : record)});
    expect(componentContents(hidden).some(item => item.record.id === 'mine')).toBe(false);
    // Its ports read the same way as an official component's (DEC-089): from its config, by family.
    expect(componentPorts(input.modules.find(record => record.id === 'mine')!)!.map(port => `${port.family}/${port.direction}/${port.id}`))
      .toEqual(['source/input/in0', 'note/input/in1', 'source/input/in2', 'source/output/out0']);
    expect(componentPorts(input.modules.find(record => record.id === 'roll')!)!.map(port => port.id)).toEqual(['source']);
    expect(componentPorts(input.modules.find(record => record.id === 'score-in')!)).toBeUndefined();
    // Its manifest lists every family it crosses.
    expect(projectManifest(input, 'inside').ports.map(port => `${port.family}/${port.direction}/${port.id}`))
      .toEqual(['source/input/in0', 'note/input/in1', 'source/input/in2', 'source/output/out0']);
  });

  it('releases the lent Session and every channel when the component is destroyed, starting none of its own', async () => {
    const {host, handle} = await mount([placed('player'), placed('rack')]);
    const player = host.querySelector('score-player') as HTMLElement & {sessionTransport?: unknown};
    const rack = host.querySelector('score-rack-control') as HTMLElement & {module?: {list(): unknown[]}};
    const desk = rack.module!;
    handle.destroy();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(desk.list()).toEqual([]);
    expect(player.isConnected).toBe(false);
    expect(player.sessionTransport).toBeUndefined();
  });
});

describe('a component\'s theme and an interface object\'s style (DEC-088)', () => {
  const themed = (style: Record<string, string>, dial: Record<string, unknown> = {}) => {
    const base = project();
    return {...base, layout: {...base.layout, style},
      modules: base.modules.map(module => module.id === 'size' ? {...module, config: {...module.config, ...dial}} : module)};
  };
  const environment = () => new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext});

  it('names shared roles a theme may set, each with a value a setting would take', () => {
    const names = THEME_TOKENS.map(token => token.name);
    expect(new Set(names).size).toBe(names.length);
    for (const token of THEME_TOKENS) expect([token.name, isStyleSetting(token.name, token.fallback)]).toEqual([token.name, true]);
    expect(names).toEqual(expect.arrayContaining(['--wm-foreground', '--wm-surface', '--wm-border', '--wm-accent', '--wm-control-radius', '--wm-control-size', '--wm-font-family']));
  });

  it('reads a theme from the layout, taking only what a setting takes', () => {
    const style = {'--wm-foreground': ' #204060 ', '--wm-meter-fill': 'teal', '--wm-surface': 'url(https://example.org/a.png)', '--brand': 'red', '--wm-border': 'red; color: blue'};
    expect(componentTheme({layout: {modules: [], style}})).toEqual({'--wm-foreground': '#204060', '--wm-meter-fill': 'teal'});
    expect(componentTheme(project())).toEqual({});
    expect(styleDeclarations(style)).toBe('--wm-foreground: #204060; --wm-meter-fill: teal;');
    expect(styleDeclarations(undefined)).toBe('');
  });

  it('writes one token of a theme into the project and takes it out again', () => {
    const one = withComponentTheme(project(), '--wm-foreground', ' #204060 ');
    expect(one.layout.style).toEqual({'--wm-foreground': '#204060'});
    const two = withComponentTheme(one, '--wm-control-radius', '6px');
    expect(two.layout.style).toEqual({'--wm-foreground': '#204060', '--wm-control-radius': '6px'});
    // Everything else of the layout stays, and an empty theme leaves no key.
    expect(two.layout.presentation).toEqual(project().layout.presentation);
    const none = withComponentTheme(withComponentTheme(two, '--wm-foreground', undefined), '--wm-control-radius', undefined);
    expect('style' in none.layout).toBe(false);
    expect(() => withComponentTheme(project(), '--wm-surface', 'url(a.png)')).toThrow(/cannot be themed/);
    expect(() => withComponentTheme(project(), 'color', 'red')).toThrow(/cannot be themed/);
  });

  it('writes a style on an element and takes back what it wrote before', () => {
    const element = document.createElement('div');
    element.style.setProperty('--wm-own', 'kept');
    applyComponentStyle(element, {'--wm-foreground': '#204060', '--wm-control-radius': '6px', onclick: 'alert(1)'});
    expect([element.style.getPropertyValue('--wm-foreground'), element.style.getPropertyValue('--wm-control-radius'), element.getAttribute('onclick')]).toEqual(['#204060', '6px', null]);
    applyComponentStyle(element, {'--wm-control-radius': '2px'});
    // Only its own earlier writes go: a property someone else set stays.
    expect([element.style.getPropertyValue('--wm-foreground'), element.style.getPropertyValue('--wm-control-radius'), element.style.getPropertyValue('--wm-own')]).toEqual(['', '2px', 'kept']);
    applyComponentStyle(element, undefined);
    expect(element.style.getPropertyValue('--wm-control-radius')).toBe('');
  });

  it('themes a component mounted in a host on its own root, and styles an interface object on its box', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountComponent(host, themed({'--wm-foreground': '#204060', '--wm-surface': 'url(a.png)'}, {style: {'--wm-knob-size': '3rem', '--wm-knob-fill': 'url(a.png)'}}),
      {audio: environment(), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    const root = host.querySelector('.wmc') as HTMLElement;
    expect([root.style.getPropertyValue('--wm-foreground'), root.style.getPropertyValue('--wm-surface')]).toEqual(['#204060', '']);
    const box = host.querySelector('.wmc__item') as HTMLElement;
    expect([box.style.getPropertyValue('--wm-knob-size'), box.style.getPropertyValue('--wm-knob-fill')]).toEqual(['3rem', '']);
    // The theme and the style are the project's: saving gives them back.
    const saved = await handle.save();
    expect(saved.layout.style).toEqual({'--wm-foreground': '#204060', '--wm-surface': 'url(a.png)'});
    expect(saved.modules.find(module => module.id === 'size')!.config.style).toEqual({'--wm-knob-size': '3rem', '--wm-knob-fill': 'url(a.png)'});
  });

  it('themes a defined element at its host from inside, where a rule of the page wins', async () => {
    defineComponentElement('arabesque-themed', themed({'--wm-foreground': '#204060'}), {audio: environment(), onError: () => {}});
    const element = document.createElement('arabesque-themed') as HTMLElement & {component?: ComponentHandle};
    document.body.append(element);
    await element.component!.ready;
    const sheet = [...element.shadowRoot!.querySelectorAll('style')].map(style => style.textContent).join('');
    expect(sheet).toContain(':host { --wm-foreground: #204060; }');
    // Nothing is written on the root inside: the host's value, whoever sets it, is the one inherited.
    expect((element.shadowRoot!.querySelector('.wmc') as HTMLElement).style.getPropertyValue('--wm-foreground')).toBe('');
    expect(element.style.getPropertyValue('--wm-foreground')).toBe('');
    element.remove();
  });
});

describe('placing a component\'s boxes in a page the host lays out (DEC-092)', () => {
  it('puts each box where the host says, draws no frame of its own and themes the host', async () => {
    const base = project();
    const meter = findComponentManifest('meter')!;
    const placed = parseModuleProject({...base,
      modules: [...base.modules, {id: 'meter', contextId: 'root', label: 'meter', plugin: {id: meter.plugin, version: '1.0.0'}, config: {style: {'--wm-meter-fill': 'teal'}}}],
      // Nothing is placed in a presentation: every box that shows something is offered a place.
      layout: {modules: base.layout.modules, style: {'--wm-foreground': '#204060'}}});
    const page = document.createElement('main');
    page.innerHTML = '<section id="top"></section><section id="side"></section>';
    document.body.append(page);
    const asked: string[] = [];
    const handle = mountComponent(page, placed, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}), onError: () => {},
      place: record => { asked.push(record.id); return record.id === 'meter' ? page.querySelector<HTMLElement>('#top') : record.id === 'size' ? page.querySelector<HTMLElement>('#side') : undefined; }});
    handles.push(handle);
    await handle.ready;
    // No frame, transport or stage: only what was placed, where it was placed.
    expect([page.querySelector('.wmc'), page.querySelector('.wmc__item')]).toEqual([null, null]);
    const top = page.querySelector('#top > .wmc__placed') as HTMLElement, side = page.querySelector('#side > .wmc__placed') as HTMLElement;
    expect([top.dataset.kind, top.firstElementChild!.localName, side.dataset.kind, side.querySelector('.wui-control') !== null]).toEqual(['component', 'audio-meter', 'control', true]);
    // The toggle was shown too, and given no place: it is not on the page.
    expect(asked).toEqual(expect.arrayContaining(['on', 'size', 'meter']));
    expect(page.querySelectorAll('.wmc__placed')).toHaveLength(2);
    // The theme is the page's; a box's own style is still its own.
    expect([page.style.getPropertyValue('--wm-foreground'), (top.firstElementChild as HTMLElement).style.getPropertyValue('--wm-meter-fill'), top.style.left]).toEqual(['#204060', 'teal', '']);
    handle.destroy();
    expect(page.querySelectorAll('.wmc__placed')).toHaveLength(0);
  });
});

describe('preloading a component\'s Session', () => {
  it('asks again while a member\'s document is still being applied, and reports any other failure', async () => {
    vi.useFakeTimers();
    try {
      const notReady = Object.assign(new Error('The requested document revision is not ready for playback.'), {name: 'ScoreDocumentApplicationError', code: 'not-ready'});
      const answers: (Error | undefined)[] = [notReady, notReady, undefined, new Error('No audio device.')];
      const preload = vi.fn(async () => { const answer = answers.shift(); if (answer) throw answer; });
      const listeners = new Set<(event: {type: string}) => void>();
      const session = {preload, subscribe: (listener: (event: {type: string}) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }};
      const errors: unknown[] = [];
      const stop = keepComponentSessionPreloaded({session, subscribe: () => () => {}} as never, error => errors.push(error));
      await vi.advanceTimersByTimeAsync(0);
      // Not ready twice: asked again each time, and nothing is reported.
      await vi.advanceTimersByTimeAsync(250);
      expect([preload.mock.calls.length, errors]).toEqual([3, []]);
      // A member joins: preloaded again, and a real failure is reported.
      for (const listener of listeners) listener({type: 'participants'});
      await vi.advanceTimersByTimeAsync(0);
      expect([preload.mock.calls.length, errors.map(error => (error as Error).message)]).toEqual([4, ['No audio device.']]);
      stop();
    } finally { vi.useRealTimers(); }
  });
});

describe('choosing whose style is shown (DEC-090)', () => {
  const environment = () => new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext});
  /** A dial and a meter, each with a style of its own, in a themed component. */
  const styledProject = (dial: Record<string, unknown> = {}) => {
    const base = project();
    const meter = findComponentManifest('meter')!;
    return parseModuleProject({...base,
      modules: [...base.modules.map(module => module.id === 'size' ? {...module, config: {...module.config, style: {'--wm-knob-size': '3rem'}, ...dial}} : module),
        {id: 'meter', contextId: 'root', label: 'meter', plugin: {id: meter.plugin, version: '1.0.0'}, config: {attributes: {type: 'spectrum'}, style: {'--wm-meter-fill': 'teal'}}}],
      layout: {...base.layout, style: {'--wm-foreground': '#204060'}, presentation: [{moduleId: 'size', x: 0, y: 0}, {moduleId: 'meter', x: 0, y: 120}]}});
  };
  const read = (host: ParentNode) => {
    const root = host.querySelector('.wmc') as HTMLElement;
    const dial = host.querySelector('.wmc__item') as HTMLElement;
    const meter = host.querySelector('audio-meter') as HTMLElement;
    return {theme: root.style.getPropertyValue('--wm-foreground'), dial: dial.style.getPropertyValue('--wm-knob-size'),
      meter: meter.style.getPropertyValue('--wm-meter-fill'), type: meter.getAttribute('type')};
  };

  it('reads and writes a box\'s choice, and sets its own style aside while it inherits', () => {
    expect([styleSource({}), styleSource({styling: 'inherit'}), styleSource({styling: 'own'}), styleSource({styling: 3})]).toEqual(['own', 'inherit', 'own', 'own']);
    const config = {low: 48, style: {'--wm-note-height': '96px'}};
    const inheriting = withStyleSource(config, 'inherit');
    expect(inheriting).toEqual({...config, styling: 'inherit'});
    // The style is kept, so choosing its own again brings it back; `own` leaves no key.
    expect(withStyleSource(inheriting, 'own')).toEqual(config);
    expect([ownStyle(config), ownStyle(inheriting)]).toEqual([{'--wm-note-height': '96px'}, {}]);
    const meter = findComponentManifest('meter')!;
    meter.define();
    const settings = {attributes: {type: 'spectrum'}, style: {'--wm-meter-fill': 'teal'}};
    expect(componentSettings(meter, settings)).toEqual(settings);
    // What the box does stays; only how it looks is set aside.
    expect(componentSettings(meter, {...settings, styling: 'inherit'})).toEqual({attributes: {type: 'spectrum'}, style: {}});
  });

  it('lets one box follow the component\'s theme while the others keep their own', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountComponent(host, styledProject({styling: 'inherit'}), {audio: environment(), onError: () => {}});
    handles.push(handle);
    await handle.ready;
    expect(read(host)).toEqual({theme: '#204060', dial: '', meter: 'teal', type: 'spectrum'});
    // Saved as it was chosen, with the style it set aside.
    const config = (await handle.save()).modules.find(module => module.id === 'size')!.config;
    expect([config.styling, config.style]).toEqual(['inherit', {'--wm-knob-size': '3rem'}]);
  });

  it('lets a whole component follow what holds it, and take its own style back, in place', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountComponent(host, styledProject(), {audio: environment(), styling: 'inherit', onError: () => {}});
    handles.push(handle);
    await handle.ready;
    const meter = host.querySelector('audio-meter');
    // Neither the theme nor any box's own style: the page's tokens are all that reach it. What a box does stays.
    expect(read(host)).toEqual({theme: '', dial: '', meter: '', type: 'spectrum'});
    handle.setStyling('own');
    expect(read(host)).toEqual({theme: '#204060', dial: '3rem', meter: 'teal', type: 'spectrum'});
    handle.setStyling('inherit');
    expect(read(host)).toEqual({theme: '', dial: '', meter: '', type: 'spectrum'});
    // The same elements throughout: nothing was rebuilt.
    expect(host.querySelector('audio-meter')).toBe(meter);
    // The project is the author's: inheriting changes what is shown, not what is saved.
    const saved = await handle.save();
    expect(saved.layout.style).toEqual({'--wm-foreground': '#204060'});
    expect(saved.modules.find(module => module.id === 'meter')!.config).toEqual({attributes: {type: 'spectrum'}, style: {'--wm-meter-fill': 'teal'}});
  });

  it('follows the styling attribute of a defined element', async () => {
    defineComponentElement('arabesque-styling', styledProject(), {audio: environment(), onError: () => {}});
    const element = document.createElement('arabesque-styling') as HTMLElement & {component?: ComponentHandle};
    element.setAttribute('styling', 'inherit');
    document.body.append(element);
    await element.component!.ready;
    const sheet = () => [...element.shadowRoot!.querySelectorAll('style')].map(style => style.textContent).join('');
    const dial = () => (element.shadowRoot!.querySelector('.wmc__item') as HTMLElement).style.getPropertyValue('--wm-knob-size');
    expect([sheet().includes(':host { --wm-foreground'), dial()]).toEqual([false, '']);
    element.removeAttribute('styling');
    expect([sheet().includes(':host { --wm-foreground: #204060; }'), dial()]).toEqual([true, '3rem']);
    element.setAttribute('styling', 'inherit');
    expect([sheet().includes(':host { --wm-foreground'), dial()]).toEqual([false, '']);
    element.remove();
  });
});

describe('editing a score from a view in a graph (DEC-086)', () => {
  // A small deterministic fixture, for tests only.
  const tune = () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Piano'});
    ['C4', 'E4', 'G4'].forEach((pitch, index) => builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse(pitch),
      onsetQuarters: new Rational(index), duration: Duration.quarter(), voice: VoiceId('v')}));
    return builder.build();
  };
  const cord = (id: string, from: string, to: string) => ({id, kind: 'source', from: {moduleId: from, port: 'source'}, to: {moduleId: to, port: 'source'}});
  const view = (name: string, id: string, editable?: string) => {
    const manifest = findComponentManifest(name)!;
    return {id, contextId: 'root', label: name, plugin: {id: manifest.plugin, version: '1.0.0'}, config: editable === undefined ? {} : {attributes: {editable}}};
  };
  const mount = async (modules: unknown[], connections: unknown[], music = tune()) => {
    const host = document.createElement('div');
    document.body.append(host);
    const input = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'editing', contexts: [{id: 'root'}],
      assets: [{id: 'music', uri: 'midi/Arabesque%20No.1.mid', mediaType: 'audio/midi'}], modules, connections,
      layout: {modules: (modules as {id: string}[]).map((module, index) => ({moduleId: module.id, x: 0, y: index * 200})),
        presentation: (modules as {id: string}[]).map((module, index) => ({moduleId: module.id, x: 0, y: index * 200}))}});
    const errors: unknown[] = [];
    const handle = mountComponent(host, input, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}),
      resolveAsset: () => music, onError: error => errors.push(error)});
    handles.push(handle);
    await handle.ready;
    await new Promise(resolve => setTimeout(resolve, 0));
    return {host, handle, errors, music};
  };
  type Editing = HTMLElement & {editor?: {score: unknown; getSnapshot(): {content: unknown}}; inputModule?: unknown; score?: unknown};
  const source = {id: 'score', contextId: 'root', label: 'score', plugin: {id: 'webmusic.score-player', version: '1.0.0'}, config: {waveform: 'sine'}, assets: {source: 'music'}};
  const player = () => { const manifest = findComponentManifest('player')!; return {id: 'player', contextId: 'root', label: 'player', plugin: {id: manifest.plugin, version: '1.0.0'}, config: {}, assets: {source: 'music'}}; };

  it('makes a source\'s score a document when a view asks, and keeps it', () => {
    const surfaces = new ComponentSurfaces();
    const lease = surfaces.connect({connection: cord('c', 's', 'r'), from: {module: {id: 's'}}} as never) as {release(): void};
    // Nothing to lend while the source has no score, and asking makes nothing.
    expect(surfaces.slot('r').lender.current!()).toBeUndefined();
    expect(surfaces.document('s', true)).toBeUndefined();
    const music = tune();
    const lenders: unknown[] = [];
    surfaces.slot('r').lender.subscribe(() => lenders.push(surfaces.slot('r').lender.current));
    const release = surfaces.slot('s').score.provide(music);
    // The offer is made again when the score arrives, so a view waiting for it asks again.
    expect(lenders.length).toBeGreaterThan(0);
    // Looking makes nothing: a source nobody edits keeps playing its score.
    expect(surfaces.document('s', true)).toBeUndefined();
    expect(surfaces.slot('s').document.current).toBeUndefined();
    const editor = surfaces.slot('r').lender.current!()!;
    expect(editor.score).toBe(music);
    expect(surfaces.slot('r').lender.current!()).toBe(editor);
    expect(surfaces.slot('s').document.current).toBe(editor);
    // The document outlives the cord and the module behind the box.
    lease.release();
    release();
    expect(surfaces.slot('r').lender.current).toBeUndefined();
    expect(surfaces.document('s')).toBe(editor);
    expect(surfaces.slot('s').document.current).toBe(editor);
  });

  it('lends an editing roll the document of the score object it follows, which then plays it', async () => {
    const {host, errors, music} = await mount([source, view('roll', 'edit', ''), view('roll', 'watch')], [cord('a', 'score', 'edit'), cord('b', 'score', 'watch')]);
    expect(errors).toEqual([]);
    const [edit, watch] = [...host.querySelectorAll('score-grid-view')] as Editing[];
    const module = edit!.inputModule as {player: {documentSource?: unknown}};
    expect(edit!.getAttribute('editable')).toBe('');
    expect(edit!.editor!.getSnapshot().content).toBe(music);
    // The source plays the document the view edits; a view that does not edit borrows none and follows the same source.
    expect(module.player.documentSource).toBe(edit!.editor);
    expect(watch!.editor).toBeUndefined();
    expect(watch!.inputModule).toBe(edit!.inputModule);
  });

  it('gives a player Element its document in place of its score', async () => {
    const {host, errors} = await mount([player(), view('sheet', 'sheet', '')], [cord('a', 'player', 'sheet')]);
    expect(errors).toEqual([]);
    const element = host.querySelector('score-player') as Editing;
    const sheet = host.querySelector('score-sheet-view') as Editing;
    expect(sheet.editor).toBeDefined();
    expect(element.editor).toBe(sheet.editor);
    expect(element.score).toBeUndefined();
  });

  it('follows the view\'s editable attribute: off borrows nothing, on borrows the document', async () => {
    const {host, errors} = await mount([source, view('roll', 'roll')], [cord('a', 'score', 'roll')]);
    const roll = host.querySelector('score-grid-view') as Editing;
    const module = roll.inputModule as {player: {documentSource?: unknown}};
    // No view edits: the source plays its score, untouched.
    expect([roll.editor, module.player.documentSource]).toEqual([undefined, undefined]);
    configureComponentElement(roll, findComponentManifest('roll')!, {attributes: {editable: ''}});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(roll.editor).toBeDefined();
    expect(module.player.documentSource).toBe(roll.editor);
    const document = roll.editor;
    configureComponentElement(roll, findComponentManifest('roll')!, {attributes: {editable: 'false'}});
    await new Promise(resolve => setTimeout(resolve, 0));
    // The view lets go; the source keeps playing what was edited.
    expect(roll.editor).toBeUndefined();
    expect(module.player.documentSource).toBe(document);
    expect(errors).toEqual([]);
  });

  describe('saved with its box (DEC-087)', () => {
    type Editor = {score: {parts: {notes: {id: string; pitch: {midi: number}}[]}[]}; getSnapshot(): {content: unknown; contentId: string};
      transaction(label: string, build: (transaction: {add(operation: unknown): void}) => void): {status: string}; undo(): unknown};
    const midis = (editor: {score: unknown}) => (editor as Editor).score.parts[0]!.notes.map(note => note.pitch.midi);
    /** One edit: every note up a tone. */
    const raise = (editor: unknown) => {
      const target = editor as Editor;
      const result = target.transaction('Raise', transaction => transaction.add({type: 'transpose-notes', noteIds: target.score.parts[0]!.notes.map(note => note.id), semitones: 2}));
      expect(result.status).toBe('committed');
    };
    const configOf = (project: {modules: readonly {id: string; config: Record<string, unknown>}[]}, id: string) => project.modules.find(module => module.id === id)!.config;
    const remount = async (project: unknown) => {
      const host = document.createElement('div');
      document.body.append(host);
      const errors: unknown[] = [];
      const handle = mountComponent(host, project, {audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}),
        resolveAsset: () => tune(), onError: error => errors.push(error)});
      handles.push(handle);
      await handle.ready;
      await new Promise(resolve => setTimeout(resolve, 0));
      return {host, handle, errors};
    };

    it('writes a score as compressed text a project can hold, and reads it back', async () => {
      const music = tune();
      const saved = await encodeScore(music) as {format: string; encoding: string; data: string[]};
      expect([saved.format, saved.encoding]).toEqual([SAVED_SCORE_FORMAT, SAVED_SCORE_ENCODING]);
      expect(saved.data.every(part => typeof part === 'string' && part.length <= 32768)).toBe(true);
      // The project schema takes it as a box's config.
      const project = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'saved', contexts: [{id: 'root'}], assets: [], connections: [],
        modules: [{id: 'score', contextId: 'root', plugin: {id: 'webmusic.score-player', version: '1.0.0'}, config: {document: saved}}]});
      const back = await decodeScore(configOf(project as never, 'score').document);
      // The same notes with the same IDs: an edit made after a reload names the notes the views show.
      expect(back.parts[0]!.notes.map(note => [note.id, note.pitch.midi])).toEqual(music.parts[0]!.notes.map(note => [note.id, note.pitch.midi]));
      expect(back.id).toBe(music.id);
    });

    it('refuses a saved score that is not one, without inflating it', async () => {
      const saved = await encodeScore(tune()) as {format: string; encoding: string; data: string[]};
      await expect(decodeScore('text')).rejects.toThrow(/must be an object/);
      await expect(decodeScore({...saved, format: 'midi'})).rejects.toThrow(/format/);
      await expect(decodeScore({...saved, encoding: 'base64'})).rejects.toThrow(/encoded/);
      await expect(decodeScore({...saved, data: [1]})).rejects.toThrow(/strings/);
      await expect(decodeScore({...saved, data: ['!!!']})).rejects.toThrow(/base64/);
      await expect(decodeScore({...saved, data: [btoa('not gzip')]})).rejects.toThrow(/inflate/);
      await expect(decodeScore({...saved, data: Array.from({length: 40}, () => 'A'.repeat(32768))})).rejects.toThrow(/size limit/);
      // Valid gzip of something that is not a Score.
      await expect(decodeScore({...saved, data: [gzipSync(JSON.stringify({parts: 3})).toString('base64')]})).rejects.toThrow(/scoreFromJSON/);
    });

    it('holds an edited score in the box\'s config, and none once the edit is undone', async () => {
      const surfaces = new ComponentSurfaces();
      expect(surfaces.documentState('s')).toBeUndefined();
      surfaces.slot('s').score.provide(tune());
      expect(surfaces.documentState('s')).toBe('original');
      const config = {waveform: 'sine'};
      // A box nobody edits keeps the config it has, whatever that holds.
      expect(surfaces.withDocument('s', config)).toBe(config);
      const editor = surfaces.document('s')!;
      const heard = vi.fn();
      surfaces.subscribe(heard);
      // A document nobody changed is still the asset.
      expect(surfaces.withDocument('s', config)).toEqual(config);
      expect(heard).not.toHaveBeenCalled();
      raise(editor);
      expect(surfaces.documentState('s')).toBe('edited');
      await surfaces.settled();
      // Told at the edit and again when its saved form is ready.
      expect(heard.mock.calls.length).toBeGreaterThanOrEqual(2);
      const saved = surfaces.withDocument('s', config);
      expect(saved.waveform).toBe('sine');
      expect(midis({score: await decodeScore(saved.document)})).toEqual([62, 66, 69]);
      (editor as unknown as Editor).undo();
      await surfaces.settled();
      expect(surfaces.documentState('s')).toBe('original');
      expect(surfaces.withDocument('s', saved)).toEqual(config);
    });

    it('saves the edit with the score object and plays it again from the saved project', async () => {
      const {host, handle} = await mount([source, view('roll', 'edit', '')], [cord('a', 'score', 'edit')]);
      const roll = host.querySelector('score-grid-view') as Editing;
      raise(roll.editor);
      const project = await handle.save();
      const config = configOf(project as never, 'score');
      expect(config.waveform).toBe('sine');
      expect((config.document as {format: string}).format).toBe(SAVED_SCORE_FORMAT);
      // The asset is not touched: the project still names the file it started from.
      expect(project.assets.map(asset => asset.uri)).toEqual(['midi/Arabesque%20No.1.mid']);
      handle.destroy();
      const again = await remount(project);
      expect(again.errors).toEqual([]);
      const edit = again.host.querySelector('score-grid-view') as Editing;
      const module = edit.inputModule as {player: {documentSource?: {score: unknown}}};
      // The box plays the saved score before anyone edits, and the view that edits borrows it.
      expect(midis(module.player.documentSource!)).toEqual([62, 66, 69]);
      expect(edit.editor).toBe(module.player.documentSource);
      // Saved again it is the same text: nothing is encoded twice.
      expect(configOf(await again.handle.save() as never, 'score').document).toEqual(config.document);
      // A further edit replaces it.
      raise(edit.editor);
      const later = configOf(await again.handle.save() as never, 'score').document;
      expect(midis({score: await decodeScore(later)})).toEqual([64, 68, 71]);
    });

    it('plays a saved score in a graph where no view edits', async () => {
      const first = await mount([source, view('roll', 'edit', '')], [cord('a', 'score', 'edit')]);
      raise((first.host.querySelector('score-grid-view') as Editing).editor);
      const project = await first.handle.save();
      first.handle.destroy();
      const following = {...project, modules: project.modules.map(module => module.id === 'edit' ? {...module, config: {}} : module)};
      const {host, errors} = await remount(following);
      expect(errors).toEqual([]);
      const roll = host.querySelector('score-grid-view') as Editing;
      expect(roll.editor).toBeUndefined();
      expect(midis((roll.inputModule as {player: {documentSource: {score: unknown}}}).player.documentSource)).toEqual([62, 66, 69]);
    });

    it('saves the edit with a player component', async () => {
      const {host, handle} = await mount([player(), view('sheet', 'sheet', '')], [cord('a', 'player', 'sheet')]);
      raise((host.querySelector('score-sheet-view') as Editing).editor);
      const project = await handle.save();
      expect((configOf(project as never, 'player').document as {format: string}).format).toBe(SAVED_SCORE_FORMAT);
      handle.destroy();
      const again = await remount({...project, modules: project.modules.filter(module => module.id === 'player'), connections: [],
        layout: {...project.layout, modules: project.layout.modules.filter(item => item.moduleId === 'player'), presentation: project.layout.presentation?.filter(item => item.moduleId === 'player')}});
      expect(again.errors).toEqual([]);
      const element = again.host.querySelector('score-player') as Editing;
      // Alone on a page, the player plays what was saved.
      expect(midis(element.editor!)).toEqual([62, 66, 69]);
      expect(element.score).toBeUndefined();
    });

    it('leaves a box whose saved score cannot be read unresolved, with its config', async () => {
      const broken = {format: SAVED_SCORE_FORMAT, encoding: SAVED_SCORE_ENCODING, data: [btoa('not gzip')]};
      const {handle} = await mount([{...source, config: {waveform: 'sine', document: broken}}], []);
      const snapshot = handle.runtime.snapshot();
      expect(snapshot.unresolved.map(item => item.id)).toEqual(['score']);
      expect(snapshot.unresolved[0]!.reason).toMatch(/saved score of score cannot be read/);
      expect(configOf(await handle.save() as never, 'score').document).toEqual(broken);
    });

    it('reverts a box to its asset in place, and drops the document with the box', async () => {
      const surfaces = new ComponentSurfaces();
      const registry = new ProjectPluginRegistry();
      for (const plugin of createComponentPlugins({surfaces})) registry.register(plugin);
      const music = tune();
      const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: new Context() as unknown as BaseAudioContext}),
        plugins: registry, connect: surfaces.connect, resolveAsset: () => music});
      const project = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'revert', contexts: [{id: 'root'}],
        assets: [{id: 'music', uri: 'midi/Arabesque%20No.1.mid', mediaType: 'audio/midi'}], modules: [source, view('roll', 'edit')], connections: [cord('a', 'score', 'edit')]});
      await runtime.restore(project);
      const module = surfaces.slot('edit').source.current as unknown as {player: {documentSource?: unknown; playback: {snapshot(): {score: unknown}}}};
      const editor = surfaces.slot('edit').lender.current!()!;
      raise(editor);
      await surfaces.settled();
      expect(module.player.documentSource).toBe(editor);
      expect(configOf(runtime.exportProject() as never, 'score').document).toBeDefined();
      surfaces.revert('score');
      // A new document of the asset: the box plays it, and it is what a view now edits.
      const again = surfaces.slot('edit').lender.current!()!;
      expect(again).not.toBe(editor);
      expect(again.score).toBe(music);
      expect(module.player.documentSource).toBe(again);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(module.player.playback.snapshot().score).toBe(music);
      expect(surfaces.documentState('score')).toBe('original');
      expect(configOf(runtime.exportProject() as never, 'score')).toEqual({waveform: 'sine'});
      // Deleting the box drops its document; the box that takes its ID has none.
      raise(again);
      await runtime.restore(parseModuleProject({...project, modules: [], connections: []}));
      expect(surfaces.document('score', true)).toBeUndefined();
      runtime.dispose();
    });

    it('offers a reverted document to the views, and gives an untouched one up to a saved score', async () => {
      const surfaces = new ComponentSurfaces();
      const music = tune();
      surfaces.slot('s').score.provide(music);
      const lease = surfaces.connect({connection: cord('c', 's', 'r'), from: {module: {id: 's'}}} as never) as {release(): void};
      const lend = () => surfaces.slot('r').lender.current!()!;
      const first = lend();
      raise(first);
      await surfaces.settled();
      const saved = surfaces.withDocument('s', {}).document;
      const offers = vi.fn();
      surfaces.slot('r').lender.subscribe(offers);
      surfaces.revert('s');
      // The view is offered the document again, and the one it gets is the asset.
      expect(offers).toHaveBeenCalled();
      expect(surfaces.documentState('s')).toBe('original');
      const second = lend();
      expect(second).not.toBe(first);
      expect(second.score).toBe(music);
      expect(surfaces.slot('s').document.current).toBe(second);
      expect(surfaces.withDocument('s', {document: saved})).toEqual({});
      // Undoing the revert: the config holds the saved score again and nothing newer would be lost.
      await surfaces.revive('s', {document: saved});
      const third = lend();
      expect(third).not.toBe(second);
      expect(midis(third)).toEqual([62, 66, 69]);
      expect(surfaces.documentState('s')).toBe('edited');
      expect(surfaces.withDocument('s', {}).document).toBe(saved);
      // An edited document is newer than any config: it stays.
      raise(third);
      await surfaces.revive('s', {document: saved});
      expect(lend()).toBe(third);
      // Another project is about to be shown: nothing is kept, and nothing is made.
      surfaces.forget();
      expect(surfaces.document('s', true)).toBeUndefined();
      expect(surfaces.slot('s').document.current).toBeUndefined();
      lease.release();
    });

    it('keeps a document while its box is in the graph and drops it with the box', () => {
      const surfaces = new ComponentSurfaces();
      surfaces.slot('s').score.provide(tune());
      const old = surfaces.enter('s');
      const editor = surfaces.document('s')!;
      // A rebuild makes the new module before it disposes the old one.
      const rebuilt = surfaces.enter('s');
      old();
      old();
      expect(surfaces.document('s', true)).toBe(editor);
      // The box is deleted: a new box given its ID starts from its own score.
      rebuilt();
      expect(surfaces.document('s', true)).toBeUndefined();
      expect(surfaces.slot('s').document.current).toBeUndefined();
    });
  });
});
