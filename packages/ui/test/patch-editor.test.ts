// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountPatchEditor, type PatchEditorBinding, type PatchEditorConnectRequest, type PatchEditorHandle, type PatchEditorPosition, type PatchEditorState} from '../src/patch-editor';

const output = {moduleId: 'source', port: 'out'};
const input = {moduleId: 'sink', port: 'in'};
const key = (endpoint: typeof output): string => JSON.stringify([endpoint.moduleId, endpoint.port]);
const settle = async (): Promise<void> => {await Promise.resolve(); await Promise.resolve();};
function deferred(): {promise: Promise<void>; resolve(): void; reject(error?: unknown): void} {
  let resolve!: () => void, reject!: (error?: unknown) => void;
  const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
class ProjectView implements PatchEditorBinding {
  state: PatchEditorState = {
    modules: [
      {id: 'source', label: 'Source', position: {x: 24, y: 24}, ports: [{id: 'out', label: 'Output', direction: 'output', kind: 'audio'}]},
      {id: 'sink', label: 'Sink', position: {x: 340, y: 24}, ports: [{id: 'in', label: 'Input', direction: 'input', kind: 'audio'}, {id: 'notes', direction: 'input', kind: 'note'}]},
    ],
    connections: [{id: 'normal', from: output, to: input, mode: 'default'}],
  };
  listeners = new Set<() => void>();
  connections: PatchEditorConnectRequest[] = [];
  moves: Array<[string, PatchEditorPosition]> = [];
  disconnects: string[] = [];
  dispose = vi.fn();
  snapshot(): PatchEditorState {return this.state;}
  subscribe(notify: () => void): () => void {this.listeners.add(notify); return () => this.listeners.delete(notify);}
  emit(): void {for (const notify of this.listeners) notify();}
  connect(request: PatchEditorConnectRequest): void {
    this.connections.push(request);
    this.state = {...this.state, connections: [...this.state.connections, {id: `patch-${this.connections.length}`, ...request}]};
    this.emit();
  }
  disconnect(id: string): void {
    this.disconnects.push(id); this.state = {...this.state, connections: this.state.connections.filter((entry) => entry.id !== id)}; this.emit();
  }
  moveModule(id: string, position: PatchEditorPosition): void {
    this.moves.push([id, position]); this.state = {...this.state, modules: this.state.modules.map((module) => module.id === id ? {...module, position} : module)}; this.emit();
  }
}
const handles: PatchEditorHandle[] = [];
function mount(binding = new ProjectView(), options: Parameters<typeof mountPatchEditor>[2] = {}): {binding: ProjectView; handle: PatchEditorHandle; host: HTMLElement} {
  const host = document.createElement('div'); document.body.append(host);
  const handle = mountPatchEditor(host, binding, options); handles.push(handle);
  return {binding, handle, host};
}
function select(control: HTMLSelectElement, value: string): void {control.value = value; control.dispatchEvent(new Event('change', {bubbles: true}));}
function choose(handle: PatchEditorHandle): void {select(handle.controls.source, key(output)); select(handle.controls.destination, key(input));}
function pendingCommand(kind: 'connect' | 'move' | 'disconnect', binding: ProjectView, handle: PatchEditorHandle) {
  const pending = deferred();
  let control: HTMLButtonElement;
  if (kind === 'connect') {
    vi.spyOn(binding, 'connect').mockImplementation(() => pending.promise);
    choose(handle); control = handle.controls.connect;
  } else if (kind === 'move') {
    vi.spyOn(binding, 'moveModule').mockImplementation(() => pending.promise);
    control = handle.moduleElement('source')!.querySelector('button')!;
  } else {
    binding.connect({from: output, to: input, mode: 'tap'});
    vi.spyOn(binding, 'disconnect').mockImplementation(() => pending.promise);
    control = handle.connectionElement('patch-1')!.querySelector('button')!;
  }
  control.focus();
  if (kind === 'move') control.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
  else control.click();
  return {pending, control};
}
function pointer(node: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, {bubbles: true, button: 0, clientX: x, clientY: y});
  Object.defineProperty(event, 'pointerId', {value: 1}); node.dispatchEvent(event);
}
afterEach(() => {for (const handle of handles.splice(0)) handle.destroy(); document.body.replaceChildren(); vi.restoreAllMocks();});

describe('mountPatchEditor', () => {
  it('renders borrowed cards, typed ports, default routes and public customization', () => {
    const {handle, host} = mount(undefined, {label: 'Studio', classNames: {module: 'custom-module', wire: 'custom-wire'}, parts: {moduleHeader: 'drag-handle'}});
    expect(handle.element.getAttribute('aria-label')).toBe('Studio');
    expect(host.querySelectorAll('.custom-module')).toHaveLength(2);
    expect(handle.portElement(output)?.getAttribute('aria-label')).toBe('Source, Output, output, audio');
    expect(handle.moduleElement('source')?.querySelector('[part~=drag-handle]')).not.toBeNull();
    expect(host.querySelectorAll('svg[aria-hidden=true] path.custom-wire')).toHaveLength(1);
    const row = handle.connectionElement('normal')!;
    expect(row.textContent).toContain('Default route');
    expect(row.querySelector('button')?.hidden).toBe(true);
    expect(handle.controls.connect.disabled).toBe(true);
  });

  it('offers compatible native form controls with explicit audio modes and preserves unavailable options', async () => {
    const {handle, binding} = mount();
    choose(handle);
    expect([...handle.controls.mode.options].map((option) => option.value)).toEqual(['replace', 'send', 'tap']);
    const incompatible = [...handle.controls.destination.options].find((option) => option.value === key({moduleId: 'sink', port: 'notes'}))!;
    expect(incompatible.disabled).toBe(true); expect(incompatible.textContent).toContain('incompatible');
    select(handle.controls.mode, 'tap'); handle.controls.connect.click();
    expect(binding.connections).toEqual([{from: output, to: input, mode: 'tap'}]);
    await settle();
    expect(handle.controls.status.textContent).toContain('Connected Source');
    expect(document.activeElement).toBe(handle.controls.source);
    expect(handle.controls.source.value).toBe('');
  });

  it('port buttons issue the same command and nonaudio outputs only offer connect', async () => {
    const {handle, binding} = mount();
    handle.portElement(output)!.click(); handle.portElement(input)!.click(); await settle();
    expect(binding.connections[0]).toEqual({from: output, to: input, mode: 'replace'});
    binding.state = {...binding.state, modules: [{id: 'keys', label: 'Keys', ports: [{id: 'events', direction: 'output', kind: 'note'}]}, binding.state.modules[1]]}; binding.emit();
    select(handle.controls.source, key({moduleId: 'keys', port: 'events'}));
    expect([...handle.controls.mode.options].map((option) => option.value)).toEqual(['connect']);
    expect(handle.portElement(input)!.disabled).toBe(true);
    handle.portElement({moduleId: 'sink', port: 'notes'})!.click(); await settle();
    expect(binding.connections[1].mode).toBe('connect');
  });

  it('waits for command settlement and rejects duplicate interactions without optimistic routing', async () => {
    const binding = new ProjectView(), pending = deferred();
    const connect = vi.spyOn(binding, 'connect').mockImplementation(() => pending.promise);
    const {handle} = mount(binding); choose(handle); handle.controls.connect.click();
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    expect(handle.controls.source.disabled).toBe(true);
    handle.portElement(output)!.click(); handle.controls.connect.click();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(handle.connectionElement('patch-1')).toBeUndefined();
    pending.resolve(); await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
  });

  it('honors outputs with no available commands through both form and port buttons', () => {
    const {handle, binding} = mount();
    handle.portElement(output)!.click();
    binding.state = {...binding.state, modules: binding.state.modules.map(module => module.id === 'source' ? {...module, ports: module.ports.map(port => ({...port, modes: []}))} : module)};
    binding.emit();
    expect(handle.portElement(output)!.disabled).toBe(true);
    expect(handle.portElement(input)!.disabled).toBe(true);
    expect(handle.controls.source.selectedOptions[0].disabled).toBe(true);
    expect(handle.controls.mode.disabled).toBe(true);
    handle.portElement(input)!.click();
    select(handle.controls.destination, key(input));
    handle.element.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(binding.connections).toEqual([]);
    expect(handle.controls.connect.disabled).toBe(true);
    expect(handle.controls.status.dataset.error).toBe('true');
  });

  it.each([new Error('Different contexts require a bridge.'), undefined])('reports failed commands and retains the selected route for correction (%s)', async (error) => {
    const binding = new ProjectView(), pending = deferred(), onError = vi.fn();
    vi.spyOn(binding, 'connect').mockImplementation(() => pending.promise);
    const {handle} = mount(binding, {onError}); choose(handle); handle.controls.connect.click();
    pending.reject(error); await settle();
    expect(onError).toHaveBeenCalledWith(error);
    expect(handle.controls.status.dataset.error).toBe('true');
    expect(handle.controls.status.textContent).toBe(error?.message ?? 'The change could not be applied.');
    expect(handle.controls.source.value).toBe(key(output));
    expect(handle.controls.destination.value).toBe(key(input));
    expect(handle.controls.connect.disabled).toBe(false);
    expect(handle.connectionElement('normal')).toBeDefined();
  });

  it.each(['connect', 'move', 'disconnect'] as const)('restores the initiating control after a rejected %s blurs it', async (kind) => {
    const {handle, binding} = mount();
    const {pending, control} = pendingCommand(kind, binding, handle);
    expect(control.disabled).toBe(true);
    // jsdom neither blurs on disable nor allows blur() on a disabled control.
    control.disabled = false; control.blur(); control.disabled = true;
    expect(document.activeElement).toBe(document.body);
    pending.reject(new Error('Change rejected')); await settle();
    expect(document.activeElement).toBe(control);
    expect(control.disabled).toBe(false);
    expect(handle.controls.status.textContent).toBe('Change rejected');
  });

  it.each(['connect', 'move', 'disconnect'] as const)('does not steal focus after a pending %s succeeds or fails', async (kind) => {
    for (const failed of [false, true]) {
      const {handle, binding} = mount();
      const {pending} = pendingCommand(kind, binding, handle);
      const outside = document.createElement('button'); document.body.append(outside); outside.focus();
      if (failed) pending.reject(new Error('Change rejected')); else pending.resolve();
      await settle();
      expect(document.activeElement).toBe(outside);
      expect(handle.element.getAttribute('aria-busy')).toBe('false');
      if (kind === 'connect' && !failed) expect(handle.controls.source.value).toBe('');
      handle.destroy(); outside.remove();
    }
  });

  it('retains a later focus choice even if that control loses focus before settlement', async () => {
    const {handle, binding} = mount();
    const {pending} = pendingCommand('connect', binding, handle);
    handle.controls.viewport.focus(); handle.controls.viewport.blur();
    pending.resolve(); await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('observes focus changes to a sibling inside the same shadow root', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const shadow = host.attachShadow({mode: 'open'}), binding = new ProjectView();
    const handle = mountPatchEditor(shadow, binding); handles.push(handle);
    const {pending} = pendingCommand('connect', binding, handle);
    const sibling = document.createElement('button'); shadow.append(sibling); sibling.focus();
    pending.resolve(); await settle();
    expect(shadow.activeElement).toBe(sibling);
  });

  it.each(['connect', 'move', 'disconnect'] as const)('releases busy controls and distinguishes a completed %s from a failed settlement snapshot', async (kind) => {
    const onError = vi.fn(), {handle, binding} = mount(undefined, {onError});
    const {pending} = pendingCommand(kind, binding, handle);
    // The asynchronous command commits without notifying before its promise settles.
    if (kind === 'connect') binding.state = {...binding.state, connections: [...binding.state.connections, {id: 'committed', from: output, to: input, mode: 'tap'}]};
    else if (kind === 'disconnect') binding.state = {...binding.state, connections: binding.state.connections.filter(connection => connection.id !== 'patch-1')};
    else binding.state = {...binding.state, modules: binding.state.modules.map(module => module.id === 'source' ? {...module, position: {x: 40, y: 24}} : module)};
    const readError = new Error('Snapshot unavailable');
    vi.spyOn(binding, 'snapshot').mockImplementationOnce(() => {throw readError;});
    pending.resolve(); await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(handle.controls.source.disabled).toBe(false);
    expect(handle.moduleElement('source')!.querySelector('button')!.disabled).toBe(false);
    expect(handle.controls.status.dataset.error).toBe('true');
    expect(handle.controls.status.textContent).toContain('View refresh failed: Snapshot unavailable');
    expect(handle.controls.status.textContent).toContain(kind === 'move' ? 'Source moved to 40, 24.' : kind === 'connect' ? 'Connected Source' : 'Connection removed.');
    expect(onError).toHaveBeenCalledExactlyOnceWith(readError);
    // A stable form control, rather than a possibly removed route, owns recovery focus.
    expect(document.activeElement).toBe(handle.controls.source);
    handle.update();
    if (kind === 'connect') expect(handle.connectionElement('committed')).toBeDefined();
    else if (kind === 'disconnect') expect(handle.connectionElement('patch-1')).toBeUndefined();
    else expect(handle.moduleElement('source')!.style.left).toBe('40px');
    expect(document.activeElement).toBe(handle.controls.source);
  });

  it('reports command rejection and snapshot failure separately while restoring usable controls', async () => {
    const onError = vi.fn(), {handle, binding} = mount(undefined, {onError});
    const {pending, control} = pendingCommand('connect', binding, handle);
    control.disabled = false; control.blur(); control.disabled = true;
    const commandError = new Error('Route rejected'), readError = new Error('Snapshot unavailable');
    vi.spyOn(binding, 'snapshot').mockImplementationOnce(() => {throw readError;});
    pending.reject(commandError); await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(handle.controls.connect.disabled).toBe(false);
    expect(handle.controls.source.value).toBe(key(output));
    expect(handle.controls.destination.value).toBe(key(input));
    expect(handle.controls.status.textContent).toBe('Change failed: Route rejected. View refresh failed: Snapshot unavailable');
    expect(onError.mock.calls.map(call => call[0])).toEqual([readError, commandError]);
    expect(document.activeElement).toBe(control);
    handle.update(); expect(handle.controls.connect.disabled).toBe(false);
  });

  it.each([
    {firstFailed: false, nextFailed: false},
    {firstFailed: false, nextFailed: true},
    {firstFailed: true, nextFailed: false},
    {firstFailed: true, nextFailed: true},
  ])('keeps a command started by snapshot-error recovery authoritative ($firstFailed / $nextFailed)', async ({firstFailed, nextFailed}) => {
    const binding = new ProjectView(), first = deferred(), next = deferred();
    const readError = new Error('Transient snapshot failure'), firstError = new Error('First route rejected'), nextError = new Error('Next route rejected');
    const connect = vi.spyOn(binding, 'connect').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => next.promise);
    const onError = vi.fn((error: unknown) => {
      if (error === readError) handle.controls.connect.click();
    });
    const {handle} = mount(binding, {onError});
    choose(handle); handle.controls.connect.focus(); handle.controls.connect.click();
    // Native disabling blurs the first Connect before its error callback can
    // start the retry. jsdom needs that browser ordering modeled explicitly.
    handle.controls.connect.disabled = false; handle.controls.connect.blur(); handle.controls.connect.disabled = true;
    expect(document.activeElement).toBe(document.body);
    vi.spyOn(binding, 'snapshot').mockImplementationOnce(() => {throw readError;});
    if (firstFailed) first.reject(firstError);
    else {
      binding.state = {...binding.state, connections: [...binding.state.connections, {id: 'first', from: output, to: input, mode: 'replace'}]};
      first.resolve();
    }
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls.map(([request]) => request)).toEqual([
      {from: output, to: input, mode: 'replace'}, {from: output, to: input, mode: 'replace'},
    ]);
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    expect(handle.controls.source.disabled).toBe(true);
    expect(handle.controls.source.value).toBe(key(output));
    expect(handle.controls.destination.value).toBe(key(input));
    expect(handle.controls.status.textContent).toBe('Applying change…');
    expect(onError.mock.calls.map(([error]) => error)).toEqual(firstFailed ? [readError, firstError] : [readError]);
    expect(document.activeElement).toBe(document.body);
    if (nextFailed) next.reject(nextError);
    else {
      binding.state = {...binding.state, connections: [...binding.state.connections, {id: 'next', from: output, to: input, mode: 'replace'}]};
      next.resolve();
    }
    await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(handle.controls.source.disabled).toBe(false);
    expect(Boolean(handle.connectionElement('first'))).toBe(!firstFailed);
    expect(Boolean(handle.connectionElement('next'))).toBe(!nextFailed);
    expect(handle.controls.source.value).toBe(nextFailed ? key(output) : '');
    expect(handle.controls.destination.value).toBe(nextFailed ? key(input) : '');
    expect(handle.controls.status.textContent).toBe(nextFailed ? 'Next route rejected' : 'Connected Source · Output to Sink · Input.');
    expect(handle.controls.status.dataset.error).toBe(String(nextFailed));
    expect(document.activeElement).toBe(nextFailed ? handle.controls.connect : handle.controls.source);
    expect(onError.mock.calls.map(([error]) => error)).toEqual([
      readError, ...(firstFailed ? [firstError] : []), ...(nextFailed ? [nextError] : []),
    ]);
  });

  it('preserves a synchronous retry rejection started by snapshot-error recovery', async () => {
    const binding = new ProjectView(), pending = deferred();
    const readError = new Error('Transient snapshot failure'), nextError = new Error('Synchronous retry rejection');
    const connect = vi.spyOn(binding, 'connect').mockImplementationOnce(() => pending.promise).mockImplementationOnce(() => {throw nextError;});
    const onError = vi.fn((error: unknown) => {if (error === readError) handle.controls.connect.click();});
    const {handle} = mount(binding, {onError});
    choose(handle); handle.controls.connect.focus(); handle.controls.connect.click();
    handle.controls.connect.disabled = false; handle.controls.connect.blur(); handle.controls.connect.disabled = true;
    vi.spyOn(binding, 'snapshot').mockImplementationOnce(() => {throw readError;});
    pending.resolve(); await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(handle.controls.connect.disabled).toBe(false);
    expect(handle.controls.source.value).toBe(key(output));
    expect(handle.controls.destination.value).toBe(key(input));
    expect(handle.controls.status.textContent).toContain('Synchronous retry rejection');
    expect(document.activeElement).toBe(handle.controls.connect);
    expect(onError.mock.calls.map(([error]) => error)).toEqual([readError, nextError]);
  });

  it.each([false, true])('leaves a new command started by the original rejection callback in control (retry failed: %s)', async (nextFailed) => {
    const binding = new ProjectView(), pending = deferred(), next = deferred();
    const error = new Error('Original route rejected'), nextError = new Error('Retry rejected');
    vi.spyOn(binding, 'connect').mockImplementationOnce(() => pending.promise).mockImplementationOnce(() => next.promise);
    const onError = vi.fn((failure: unknown) => {if (failure === error) handle.controls.connect.click();});
    const {handle} = mount(binding, {onError});
    choose(handle); handle.controls.connect.focus(); handle.controls.connect.click();
    handle.controls.connect.disabled = false; handle.controls.connect.blur(); handle.controls.connect.disabled = true;
    pending.reject(error); await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    expect(handle.controls.source.value).toBe(key(output));
    expect(handle.controls.destination.value).toBe(key(input));
    expect(handle.controls.status.textContent).toBe('Applying change…');
    if (nextFailed) next.reject(nextError); else next.resolve();
    await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(handle.controls.source.value).toBe(nextFailed ? key(output) : '');
    expect(handle.controls.destination.value).toBe(nextFailed ? key(input) : '');
    expect(document.activeElement).toBe(nextFailed ? handle.controls.connect : handle.controls.source);
    expect(onError.mock.calls.map(([failure]) => failure)).toEqual(nextFailed ? [error, nextError] : [error]);
  });

  it.each([
    {blurOutside: false, nextFailed: false},
    {blurOutside: false, nextFailed: true},
    {blurOutside: true, nextFailed: false},
    {blurOutside: true, nextFailed: true},
  ])('preserves a later user focus choice through automatic retry ($blurOutside / $nextFailed)', async ({blurOutside, nextFailed}) => {
    const binding = new ProjectView(), pending = deferred(), next = deferred();
    const readError = new Error('Transient snapshot failure');
    vi.spyOn(binding, 'connect').mockImplementationOnce(() => pending.promise).mockImplementationOnce(() => next.promise);
    const {handle} = mount(binding, {onError: error => {if (error === readError) handle.controls.connect.click();}});
    choose(handle); handle.controls.connect.focus(); handle.controls.connect.click();
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    if (blurOutside) outside.blur();
    vi.spyOn(binding, 'snapshot').mockImplementationOnce(() => {throw readError;});
    pending.resolve(); await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(blurOutside ? document.body : outside);
    if (nextFailed) next.reject(new Error('Retry rejected')); else next.resolve();
    await settle();
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(blurOutside ? document.body : outside);
  });

  it('does not steal later focus when command settlement also fails to refresh', async () => {
    const {handle, binding} = mount(), {pending} = pendingCommand('move', binding, handle);
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    vi.spyOn(binding, 'snapshot').mockImplementationOnce(() => {throw new Error('Snapshot unavailable');});
    pending.resolve(); await settle();
    expect(document.activeElement).toBe(outside);
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    expect(handle.controls.status.dataset.error).toBe('true');
  });

  it('retains unresolved modules and removable missing-endpoint connections with readable diagnostics', async () => {
    const binding = new ProjectView();
    binding.state = {...binding.state, modules: [...binding.state.modules, {id: 'missing', label: 'External effect', status: 'unresolved', ports: [], diagnostic: 'Plugin example.delay@2 is unavailable.'}], connections: [...binding.state.connections, {id: 'lost', from: output, to: {moduleId: 'missing', port: 'input'}, status: 'unresolved', diagnostic: 'Restore the effect plugin to reconnect.'}]};
    const {handle} = mount(binding);
    expect(handle.moduleElement('missing')?.textContent).toContain('Plugin example.delay@2');
    expect(handle.connectionElement('lost')?.textContent).toContain('missing · input (unavailable)');
    expect(handle.connectionElement('lost')?.textContent).toContain('Restore the effect plugin');
    handle.connectionElement('lost')!.querySelector('button')!.click(); await settle();
    expect(binding.disconnects).toEqual(['lost']);
    expect(handle.connectionElement('lost')).toBeUndefined();
    expect(document.activeElement).toBe(handle.controls.source);
  });

  it('moves only focused headers with keyboard and preserves ids, nodes and focus across labels and layouts', async () => {
    const {handle, binding} = mount();
    const card = handle.moduleElement('source')!, header = card.querySelector('button')!;
    header.focus(); header.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})); await settle();
    expect(binding.moves).toEqual([['source', {x: 40, y: 24}]]);
    header.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', shiftKey: true, bubbles: true})); await settle();
    expect(binding.moves[1]).toEqual(['source', {x: 40, y: 88}]);
    binding.state = {...binding.state, modules: binding.state.modules.map((module) => module.id === 'source' ? {...module, label: 'Renamed'} : module)}; binding.emit();
    expect(handle.moduleElement('source')).toBe(card); expect(document.activeElement).toBe(header);
    expect(header.getAttribute('aria-label')).toBe('Move Renamed');
    handle.controls.source.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(binding.moves).toHaveLength(2); expect(binding.connections).toEqual([]);
  });

  it('displays signed project coordinates without rewriting them and preserves signed keyboard moves', async () => {
    const binding = new ProjectView();
    binding.state = {...binding.state, modules: binding.state.modules.map(module => module.id === 'source' ? {...module, position: {x: -40, y: -10}} : module)};
    const {handle} = mount(binding), card = handle.moduleElement('source')!, header = card.querySelector('button')!;
    expect(card.style.left).toBe('24px'); expect(card.style.top).toBe('24px'); expect(binding.moves).toEqual([]);
    header.focus(); header.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true})); await settle();
    expect(binding.moves).toEqual([['source', {x: -56, y: -10}]]);
    expect(handle.controls.status.textContent).toContain('-56, -10');
    expect(handle.moduleElement('sink')!.style.left).toBe('420px');
  });

  it('retains focused port and connection controls when their stable records reorder', () => {
    const {handle, binding} = mount();
    binding.connect({from: output, to: input, mode: 'tap'}); binding.connect({from: output, to: input, mode: 'send'});
    const button = handle.connectionElement('patch-1')!.querySelector('button')!; button.focus();
    binding.state = {...binding.state, connections: [...binding.state.connections].reverse()}; binding.emit();
    expect(document.activeElement).toBe(button);
    expect([...handle.element.querySelectorAll('[data-connection-id]')].map((node) => (node as HTMLElement).dataset.connectionId)).toEqual(['patch-2', 'patch-1', 'normal']);
    const port = handle.portElement(input)!; port.focus();
    binding.state = {...binding.state, modules: binding.state.modules.map((module) => module.id === 'sink' ? {...module, ports: [...module.ports].reverse()} : module)}; binding.emit();
    expect(handle.portElement(input)).toBe(port); expect(document.activeElement).toBe(port);
    binding.state = {...binding.state, modules: [...binding.state.modules].reverse()}; binding.emit();
    expect([...handle.element.querySelectorAll('[data-module-id]')].map((node) => (node as HTMLElement).dataset.moduleId)).toEqual(['sink', 'source']);
    expect(document.activeElement).toBe(port);
  });

  it('preserves focus when reordering ports inside a shadow host', () => {
    const binding = new ProjectView(), container = document.createElement('div'); document.body.append(container);
    const shadow = container.attachShadow({mode: 'open'}), handle = mountPatchEditor(shadow, binding); handles.push(handle);
    const port = handle.portElement(input)!; port.focus(); expect(shadow.activeElement).toBe(port);
    binding.state = {...binding.state, modules: binding.state.modules.map((module) => module.id === 'sink' ? {...module, ports: [...module.ports].reverse()} : module)}; binding.emit();
    expect(shadow.activeElement).toBe(port);
  });

  it('draws wires from actual port geometry and cancels pending drawing on destroy', () => {
    let callback: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => {callback = next; return 42;});
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const {handle} = mount();
    const rectangle = (x: number, y: number, width: number, height: number): DOMRect => ({x, y, width, height, top: y, left: x, bottom: y + height, right: x + width, toJSON() {return {};}});
    vi.spyOn(handle.element.querySelector('[part=canvas]')!, 'getBoundingClientRect').mockReturnValue(rectangle(100, 100, 800, 400));
    vi.spyOn(handle.portElement(output)!, 'getBoundingClientRect').mockReturnValue(rectangle(150, 150, 80, 32));
    vi.spyOn(handle.portElement(input)!, 'getBoundingClientRect').mockReturnValue(rectangle(450, 190, 80, 32));
    callback!(0);
    expect(handle.element.querySelector('path')?.getAttribute('d')).toBe('M 122 66 C 240 66, 240 106, 358 106');
    handle.update(); handle.destroy(); expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(() => callback!(0)).not.toThrow();
  });

  it('keeps layout read-only when the application does not provide a movement command', () => {
    const binding = new ProjectView();
    Object.defineProperty(binding, 'moveModule', {value: undefined});
    const {handle} = mount(binding), header = handle.moduleElement('source')!.querySelector('button')!;
    expect(header.disabled).toBe(true);
    header.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    pointer(header, 'pointerdown', 0, 0); pointer(window, 'pointerup', 100, 100);
    expect(binding.moves).toEqual([]);
    expect(handle.portElement(output)!.disabled).toBe(false);
  });

  it('commits pointer layout once at release, cancels with Escape, and removes stale drag listeners', async () => {
    const {handle, binding} = mount(), header = handle.moduleElement('source')!.querySelector('button')!;
    pointer(header, 'pointerdown', 50, 50); pointer(window, 'pointermove', 90, 110);
    expect(binding.moves).toEqual([]); expect(handle.moduleElement('source')!.style.left).toBe('64px');
    pointer(window, 'pointerup', 90, 110); await settle();
    expect(binding.moves).toEqual([['source', {x: 64, y: 84}]]);
    pointer(header, 'pointerdown', 90, 110); pointer(window, 'pointermove', 110, 140);
    header.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    pointer(window, 'pointerup', 110, 140);
    expect(binding.moves).toHaveLength(1); expect(handle.moduleElement('source')!.style.left).toBe('64px');
    handle.destroy(); pointer(window, 'pointermove', 200, 200); pointer(window, 'pointerup', 200, 200);
    expect(binding.moves).toHaveLength(1);
  });

  it('cancels a live drag when its module disappears or the caller disables editing', () => {
    const {handle, binding} = mount(), header = handle.moduleElement('source')!.querySelector('button')!;
    pointer(header, 'pointerdown', 10, 10); pointer(window, 'pointermove', 30, 30);
    binding.state = {...binding.state, disabled: true}; binding.emit(); pointer(window, 'pointerup', 30, 30);
    expect(binding.moves).toEqual([]); expect(handle.moduleElement('source')!.style.left).toBe('24px');
    binding.state = {...binding.state, disabled: false}; binding.emit(); pointer(header, 'pointerdown', 10, 10);
    binding.state = {...binding.state, modules: binding.state.modules.filter((module) => module.id !== 'source')}; binding.emit();
    pointer(window, 'pointerup', 80, 80); expect(binding.moves).toEqual([]);
  });

  it('destroy and remount only release presenter resources and ignore late command settlement', async () => {
    const binding = new ProjectView(), pending = deferred(), onError = vi.fn();
    vi.spyOn(binding, 'connect').mockImplementation(() => pending.promise);
    const {handle, host} = mount(binding, {onError}); choose(handle); handle.controls.connect.click();
    const replacement = mountPatchEditor(host, binding); handles.push(replacement);
    expect(binding.listeners.size).toBe(1); expect(handle.moduleElement('source')).toBeUndefined();
    pending.reject(new Error('Late failure')); await settle();
    expect(onError).not.toHaveBeenCalled(); expect(host.querySelectorAll('.wui-patch-editor')).toHaveLength(1);
    replacement.destroy(); replacement.destroy();
    expect(binding.listeners.size).toBe(0); expect(binding.dispose).not.toHaveBeenCalled();
  });

  it('keeps a reentrant subscription mount authoritative and releases the superseded subscription', () => {
    const binding = new ProjectView(), host = document.createElement('div'), release = vi.fn(); document.body.append(host);
    let replacement: PatchEditorHandle | undefined;
    vi.spyOn(binding, 'subscribe').mockImplementationOnce(() => {replacement = mountPatchEditor(host, new ProjectView()); handles.push(replacement); return release;});
    const old = mountPatchEditor(host, binding); handles.push(old);
    expect(host.querySelector('.wui-patch-editor')).toBe(replacement?.element);
    expect(release).toHaveBeenCalledTimes(1); old.destroy(); expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports invalid snapshots without replacing the last valid graph', () => {
    const onError = vi.fn(), {handle, binding} = mount(undefined, {onError});
    const card = handle.moduleElement('source');
    binding.state = {...binding.state, modules: [...binding.state.modules, binding.state.modules[0]]}; binding.emit();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: expect.stringContaining('unique')}));
    expect(handle.moduleElement('source')).toBe(card);
    expect(handle.controls.status.dataset.error).toBe('true');
  });
});
