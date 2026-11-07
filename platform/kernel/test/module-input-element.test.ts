// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createCapabilityKey, createModuleHandle, ModuleAudioEnvironment, ModuleCapabilities, ModuleContext, SOURCE_SCHEMAS, SourcePublisher,
  type ModuleHandle, type ModulePort,
} from '../src/module';
import {
  notifyModuleChange, observeCompanionInput, observeModuleInput, provideModuleContext,
  type CompanionInput, type ModuleInputState,
} from '../src/elements';

const cleanups: Array<() => void> = [];
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
});

function sourceModule(id: string) {
  let ports: ModulePort[] = [new SourcePublisher(SOURCE_SCHEMAS.score, {id: 'source'})];
  const listeners = new Set<() => void>();
  const module = createModuleHandle({
    id,
    ports: () => ports,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  return {
    module,
    replace(next: ModulePort[]) { ports = next; for (const listener of [...listeners]) listener(); },
    get listeners() { return listeners.size; },
  };
}

describe('observeModuleInput', () => {
  it('follows the input selector, the port attribute and port replacement, and releases its subscription', async () => {
    const host = document.createElement('div');
    host.setAttribute('input', '#lead');
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'lead';
    document.body.append(host, target);
    const lead = sourceModule('lead');
    const states: Array<ModuleInputState<'source'>> = [];
    const stop = observeModuleInput(host, {family: 'source', port: 'source'}, state => states.push(state));
    expect(states.at(-1)).toEqual({});
    target.module = lead.module;
    notifyModuleChange(target);
    const first = states.at(-1)!.port!;
    expect(first.schemaId).toBe(SOURCE_SCHEMAS.score);
    const count = states.length;
    lead.replace(lead.module.ports!() as ModulePort[]);
    expect(states).toHaveLength(count);
    const second = new SourcePublisher(SOURCE_SCHEMAS.score, {id: 'source'});
    lead.replace([second]);
    expect(states.at(-1)!.port).toBe(second);
    second.dispose();
    lead.replace([second]);
    expect(states.at(-1)).toEqual({module: lead.module});
    stop(); stop();
    expect(lead.listeners).toBe(0);
    await flush();
  });

  it('reads the provider target by containment and honors an explicit null', () => {
    const provider = document.createElement('section');
    const host = document.createElement('div');
    host.setAttribute('port', 'alt');
    provider.append(host);
    document.body.append(provider);
    const lead = sourceModule('lead');
    const alt = new SourcePublisher(SOURCE_SCHEMAS.audioClip, {id: 'alt'});
    lead.replace([alt]);
    const audio = new ModuleAudioEnvironment({create() { throw new Error('Discovery must not allocate audio'); }});
    cleanups.push(provideModuleContext(provider, () => new ModuleContext({id: 'root', audio, target: lead.module})));
    const update = vi.fn();
    cleanups.push(observeModuleInput(host, {family: 'source', port: 'source'}, update));
    expect(update).toHaveBeenLastCalledWith({module: lead.module, port: alt});
    const unbound = vi.fn();
    cleanups.push(observeModuleInput(host, {family: 'source', port: 'source', assigned: null}, unbound));
    expect(unbound).toHaveBeenCalledExactlyOnceWith({});
  });

  it('reports a failing port lookup as an error state', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const failure = new Error('ports failed');
    const module = createModuleHandle({id: 'broken', ports: () => { throw failure; }});
    const update = vi.fn();
    cleanups.push(observeModuleInput(host, {family: 'audio', port: 'output', assigned: module}, update));
    expect(update).toHaveBeenLastCalledWith({module, error: failure});
  });
});

describe('observeCompanionInput', () => {
  const OWNER = createCapabilityKey<object>('test.owner');

  it('follows an explicit module source port and rejects another schema', () => {
    const host = document.createElement('div');
    host.setAttribute('input', '#ignored');
    document.body.append(host);
    const lead = sourceModule('lead');
    const states: CompanionInput[] = [];
    cleanups.push(observeCompanionInput(host, {capability: OWNER, assigned: lead.module, schemaId: SOURCE_SCHEMAS.score}, (input) => states.push(input)));
    expect(states.at(-1)).toMatchObject({module: lead.module, state: 'ready'});
    expect(states.at(-1)!.port!.schemaId).toBe(SOURCE_SCHEMAS.score);
    lead.replace([new SourcePublisher(SOURCE_SCHEMAS.audioClip, {id: 'source'})]);
    expect(states.at(-1)).toMatchObject({module: lead.module, state: 'invalid'});
    expect(String(states.at(-1)!.error)).toContain(SOURCE_SCHEMAS.audioClip);
    lead.replace([]);
    expect(states.at(-1)).toEqual({module: lead.module, state: 'pending'});
  });

  it('resolves the input selector to its element and containment to the lent owner', async () => {
    const provider = document.createElement('section');
    const contained = document.createElement('div');
    provider.append(contained);
    const selected = document.createElement('div');
    selected.setAttribute('input', '#owner');
    const owner = document.createElement('div');
    owner.id = 'owner';
    document.body.append(provider, selected, owner);
    const audio = new ModuleAudioEnvironment({create() { throw new Error('Discovery must not allocate audio'); }});
    const lent = {name: 'lent'};
    cleanups.push(provideModuleContext(provider, () => new ModuleContext({id: 'root', audio,
      capabilities: new ModuleCapabilities().with(OWNER, lent)})));
    const byContainment = vi.fn();
    cleanups.push(observeCompanionInput(contained, {capability: OWNER}, byContainment));
    expect(byContainment).toHaveBeenLastCalledWith({element: lent, state: 'ready'});
    const bySelector = vi.fn();
    cleanups.push(observeCompanionInput(selected, {capability: OWNER}, bySelector));
    expect(bySelector).toHaveBeenLastCalledWith({element: owner, state: 'ready'});
    owner.remove();
    await flush();
    expect(bySelector).toHaveBeenLastCalledWith({state: 'missing'});
  });

  it('takes the module path for a port attribute unless the caller opts out', () => {
    const provider = document.createElement('section');
    const host = document.createElement('div');
    host.setAttribute('port', 'source');
    provider.append(host);
    document.body.append(provider);
    const lead = sourceModule('lead');
    const audio = new ModuleAudioEnvironment({create() { throw new Error('Discovery must not allocate audio'); }});
    const lent = {name: 'lent'};
    cleanups.push(provideModuleContext(provider, () => new ModuleContext({id: 'root', audio, target: lead.module,
      capabilities: new ModuleCapabilities().with(OWNER, lent)})));
    const viaPort = vi.fn();
    cleanups.push(observeCompanionInput(host, {capability: OWNER}, viaPort));
    expect(viaPort.mock.lastCall![0]).toMatchObject({module: lead.module, state: 'ready'});
    const viaOwner = vi.fn();
    cleanups.push(observeCompanionInput(host, {capability: OWNER, portAttribute: false}, viaOwner));
    expect(viaOwner).toHaveBeenLastCalledWith({element: lent, state: 'ready'});
  });
});
