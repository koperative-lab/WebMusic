// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleCapabilities, ModuleContext, type ModuleHandle} from '@webmusic/kernel/module';
import {notifyModuleChange, notifyModuleContext, provideModuleContext} from '@webmusic/kernel/element';
import {NoteInputElement} from '../../src/play/element/score-note-input';
import {NoteInputController, SCORE_NOTE_INPUT} from '../../src/play/headless/note-input';
import type {NoteInputDetail, NoteInputTarget} from '../../src/play/core/note-input-model';

customElements.define('routing-note-input', NoteInputElement);
const releases: Array<() => void> = [];

afterEach(() => {
  document.body.replaceChildren();
  for (const release of releases.splice(0)) release();
});

function endpoint(prepare = vi.fn(async () => {})) {
  return {prepare, noteOn: vi.fn(), noteOff: vi.fn()};
}

function moduleWith(target: NoteInputTarget, id = 'instrument'): ModuleHandle {
  return {id, capabilities: new ModuleCapabilities().with(SCORE_NOTE_INPUT, target)};
}

function scope(target?: ModuleHandle): HTMLElement {
  const host = document.createElement('div');
  const context = new ModuleContext({id: 'input-scope', audio: new ModuleAudioEnvironment(), target});
  releases.push(provideModuleContext(host, () => context));
  document.body.append(host);
  return host;
}

function input(parent: Element): NoteInputElement {
  const host = document.createElement('routing-note-input') as NoteInputElement;
  host.setAttribute('keyboard', '');
  host.setAttribute('start', '60');
  parent.append(host);
  return host;
}

function key(host: NoteInputElement, on: boolean): void {
  host.shadowRoot!.querySelector('.wui-note')!.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', {
    code: 'KeyA', bubbles: true,
  }));
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

describe('occurrence input controller', () => {
  it('releases repeated same-pitch occurrences by identity without touching another source', async () => {
    const target = endpoint();
    const left = new NoteInputController({target});
    const right = new NoteInputController({target});
    const first = left.press(60);
    const second = left.press(60);
    const third = right.press(60);
    await flush();
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(target.noteOn.mock.calls.map(([note]) => note.id)).toEqual([first.id, second.id, third.id]);
    left.release(first.id);
    left.release(first.id);
    expect(target.noteOff.mock.calls).toEqual([[first.id]]);
    left.dispose();
    expect(target.noteOff.mock.calls).toEqual([[first.id], [second.id]]);
    expect(right.activeOccurrenceCount).toBe(1);
    right.dispose();
    expect(target.noteOff).toHaveBeenLastCalledWith(third.id);
  });

  it('cancels pending attacks on release, retarget, dispose and rejected preparation', async () => {
    let resolve!: () => void;
    const target = endpoint(vi.fn(() => new Promise<void>(ready => { resolve = ready; })));
    const errors: unknown[] = [];
    const controller = new NoteInputController({target, onError: error => errors.push(error)});
    const pending = controller.press(60);
    controller.release(pending.id);
    resolve();
    await flush();
    expect(target.noteOn).not.toHaveBeenCalled();
    controller.press(60);
    controller.setTarget(endpoint());
    resolve();
    await flush();
    expect(target.noteOn).not.toHaveBeenCalled();
    const failure = new Error('instrument unavailable');
    controller.setTarget(endpoint(vi.fn(async () => { throw failure; })));
    controller.press(60);
    await flush();
    expect(errors).toEqual([failure]);
    expect(controller.activeOccurrenceCount).toBe(0);
    controller.setTarget(target);
    controller.press(60);
    controller.dispose();
    resolve();
    await flush();
    expect(target.noteOn).not.toHaveBeenCalled();
  });

  it('releases a late voice if noteOn synchronously disposes its source', async () => {
    const target = endpoint();
    const controller = new NoteInputController({target});
    target.noteOn.mockImplementation(() => controller.dispose());
    const note = controller.press(60);
    await flush();
    expect(controller.activeOccurrenceCount).toBe(0);
    expect(target.noteOff).toHaveBeenLastCalledWith(note.id);
  });
});

describe('modular note input routing', () => {
  it('sends once to its nearest instrument and observes each event/callback once', async () => {
    const target = endpoint();
    const host = input(scope(moduleWith(target)));
    const events: NoteInputDetail[] = [];
    const callback = vi.fn();
    host.onNote = callback;
    host.addEventListener('webscore:noteon', event => events.push((event as CustomEvent<NoteInputDetail>).detail));
    host.addEventListener('webscore:noteoff', event => events.push((event as CustomEvent<NoteInputDetail>).detail));
    expect(target.prepare).not.toHaveBeenCalled();
    key(host, true);
    await flush();
    key(host, false);
    expect(target.noteOn).toHaveBeenCalledOnce();
    expect(target.noteOff).toHaveBeenCalledOnce();
    expect(events).toEqual([
      {id: expect.any(String), midi: 60, velocity: 100, routed: true},
      {id: events[0].id, midi: 60, velocity: 100, routed: true},
    ]);
    expect(target.noteOn).toHaveBeenCalledWith({id: events[0].id, midi: 60, velocity: 100});
    expect(target.noteOff).toHaveBeenCalledWith(events[0].id);
    expect(callback.mock.calls).toEqual([[60, 100, true], [60, 100, false]]);
  });

  it('disconnecting one same-pitch surface releases only its own held occurrence', async () => {
    const target = endpoint();
    const parent = scope(moduleWith(target));
    const left = input(parent);
    const right = input(parent);
    key(left, true);
    key(right, true);
    await flush();
    const ids = target.noteOn.mock.calls.map(([note]) => note.id);
    expect(ids[0]).not.toBe(ids[1]);
    left.remove();
    expect(target.noteOff.mock.calls).toEqual([[ids[0]]]);
    key(right, false);
    expect(target.noteOff.mock.calls).toEqual([[ids[0]], [ids[1]]]);
  });

  it('does not let an event consumer change the owned occurrence identity', async () => {
    const target = endpoint();
    const host = input(scope(moduleWith(target)));
    host.addEventListener('webscore:noteon', event => {
      (event as CustomEvent<NoteInputDetail>).detail.id = 'consumer-local-id';
    });
    key(host, true);
    await flush();
    const id = target.noteOn.mock.calls[0][0].id;
    key(host, false);
    expect(target.noteOff).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('keeps manual routes event-only and explicit missing targets unresolved', async () => {
    const target = endpoint();
    const host = input(scope(moduleWith(target)));
    host.routing = 'manual';
    const events: NoteInputDetail[] = [];
    host.addEventListener('webscore:noteon', event => events.push((event as CustomEvent<NoteInputDetail>).detail));
    key(host, true);
    key(host, false);
    host.routing = 'auto';
    host.setAttribute('target', '#absent-instrument');
    key(host, true);
    key(host, false);
    await flush();
    expect(target.prepare).not.toHaveBeenCalled();
    expect(events.map(event => event.routed)).toEqual([false, false]);
    host.moduleTarget = moduleWith(target);
    key(host, true);
    await flush();
    expect(target.noteOn).toHaveBeenCalledOnce();
    host.moduleTarget = null;
    expect(target.noteOff).toHaveBeenCalledOnce();
  });

  it('uses an explicit late module without preparing during discovery and cancels stale loading', async () => {
    let resolve!: () => void;
    const target = endpoint(vi.fn(() => new Promise<void>(ready => { resolve = ready; })));
    const moduleHost = document.createElement('div') as HTMLElement & {module?: ModuleHandle};
    moduleHost.id = 'late-note-module';
    document.body.append(moduleHost);
    const host = input(document.body);
    host.setAttribute('target', '#late-note-module');
    moduleHost.module = moduleWith(target);
    notifyModuleChange(moduleHost);
    expect(target.prepare).not.toHaveBeenCalled();
    key(host, true);
    expect(target.prepare).toHaveBeenCalledOnce();
    host.remove();
    resolve();
    await flush();
    expect(target.noteOn).not.toHaveBeenCalled();
    document.body.append(host);
    key(host, true);
    resolve();
    await flush();
    expect(target.noteOn).toHaveBeenCalledOnce();
  });

  it('reparents a held input by releasing the old gate before the next attack', async () => {
    const first = endpoint();
    const second = endpoint();
    const left = scope(moduleWith(first, 'left'));
    const right = scope(moduleWith(second, 'right'));
    const host = input(left);
    key(host, true);
    await flush();
    right.append(host);
    expect(first.noteOff).toHaveBeenCalledOnce();
    expect(second.noteOn).not.toHaveBeenCalled();
    key(host, true);
    await flush();
    expect(second.noteOn).toHaveBeenCalledOnce();
    expect(first.noteOn).toHaveBeenCalledOnce();
  });

  it('does not borrow an outer instrument through a pending or instrument-less inner scope', async () => {
    const outer = endpoint();
    const parent = scope(moduleWith(outer));
    const boundary = document.createElement('div');
    parent.append(boundary);
    const provider: {context?: ModuleContext} = {};
    releases.push(provideModuleContext(boundary, () => provider.context));
    const host = input(boundary);
    key(host, true);
    key(host, false);
    provider.context = new ModuleContext({id: 'empty-inner', audio: new ModuleAudioEnvironment(), target: {id: 'empty'}});
    notifyModuleContext(boundary);
    key(host, true);
    key(host, false);
    await flush();
    expect(outer.prepare).not.toHaveBeenCalled();
  });

  it('does not retain a phantom key when preparation synchronously disconnects the surface', async () => {
    const target = endpoint();
    const parent = scope(moduleWith(target));
    const host = input(parent);
    const events: boolean[] = [];
    host.onNote = (_midi, _velocity, on) => events.push(on);
    target.prepare.mockImplementationOnce(async () => { host.remove(); });
    key(host, true);
    await flush();
    expect(events).toEqual([true, false]);
    expect(target.noteOn).not.toHaveBeenCalled();
    parent.append(host);
    key(host, true);
    await flush();
    expect(target.noteOn).toHaveBeenCalledOnce();
  });
});
