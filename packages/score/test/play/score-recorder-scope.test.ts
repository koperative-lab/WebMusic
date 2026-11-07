// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  getModulePort, ModuleAudioEnvironment, ModuleContext, NoteOutputPort,
  type ModuleHandle, type NoteEvent,
} from '@webmusic/kernel/module';
import {provideModuleContext} from '@webmusic/kernel/element';
import {NoteInputElement} from '../../src/play/element/score-note-input';
import {ScoreRecorderElement} from '../../src/play/element/score-recorder';

customElements.define('scope-note-input', NoteInputElement);
customElements.define('scope-score-recorder', ScoreRecorderElement);
const releases: Array<() => void> = [];
afterEach(() => {
  document.body.replaceChildren();
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
});

function keys(id: string): NoteInputElement {
  const host = document.createElement('scope-note-input') as NoteInputElement;
  host.id = id;
  host.setAttribute('keyboard', '');
  host.setAttribute('start', '60');
  host.setAttribute('routing', 'manual');
  return host;
}

function key(host: NoteInputElement, on: boolean): void {
  host.shadowRoot!.querySelector('.wui-note')!.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', {code: 'KeyA', bubbles: true}));
}

function recorder(): ScoreRecorderElement {
  return document.createElement('scope-score-recorder') as ScoreRecorderElement;
}

function event(occurrenceId: string, gate: NoteEvent['gate'], midi = 64): NoteEvent {
  return {occurrenceId, sourceId: 'src', pitch: {midi}, velocity: 0.8, gate, axis: 'performance-seconds', time: 0, epoch: 0};
}

describe('score-note-input as a note Source module', () => {
  it('publishes every press and release on its notes output port', () => {
    const input = keys('keys');
    document.body.append(input);
    const port = getModulePort(input.module, 'notes', 'note', 'output')!;
    const seen: NoteEvent[] = [];
    releases.push(port.subscribe((value) => seen.push(value)));
    key(input, true);
    key(input, false);
    expect(seen.map((value) => [value.gate, value.pitch.midi, value.sourceId])).toEqual([['on', 60, 'keys'], ['off', 60, 'keys']]);
    expect(seen[0]!.occurrenceId).toBe(seen[1]!.occurrenceId);
  });
});

describe('score-recorder in a module scope (DEC-068)', () => {
  it('records a selected note output port and stops when the input goes away', () => {
    const input = keys('keys');
    const take = recorder();
    take.setAttribute('input', '#keys');
    document.body.append(input, take);
    take.record();
    key(input, true);
    key(input, false);
    const score = take.stop()!;
    expect(score.parts[0]!.notes.map((note) => note.pitch.midi)).toEqual([60]);

    take.removeAttribute('input');
    take.record();
    key(input, true);
    key(input, false);
    expect(take.stop()).toBeUndefined();
  });

  it('records an explicit .inputModule and discards a press whose input is replaced', () => {
    const notes = new NoteOutputPort({id: 'notes'});
    const source: ModuleHandle = {id: 'source', ports: () => [notes]};
    const take = recorder();
    take.inputModule = source;
    document.body.append(take);
    take.record();
    notes.emit(event('a', 'on'));
    notes.emit(event('a', 'off'));
    notes.emit(event('b', 'on', 67));
    take.inputModule = null;
    notes.emit(event('b', 'off', 67));
    expect(take.stop()!.parts[0]!.notes.map((note) => note.pitch.midi)).toEqual([64]);
  });

  it('is a note Sink whose input port captures delivered events while armed', () => {
    const take = recorder();
    document.body.append(take);
    const port = getModulePort(take.module, 'notes', 'note', 'input')!;
    const notes = new NoteOutputPort({id: 'notes'});
    const lease = port.connect(notes);
    notes.emit(event('idle', 'on'));
    notes.emit(event('idle', 'off'));
    take.record();
    notes.emit(event('armed', 'on', 72));
    notes.emit(event('armed', 'off', 72));
    lease.release();
    expect(take.stop()!.parts[0]!.notes.map((note) => note.pitch.midi)).toEqual([72]);
  });

  it('auditions a take on the enclosing scope route without a Session', async () => {
    const prepare = vi.fn();
    const audio = new ModuleAudioEnvironment({create() { prepare(); throw new Error('no audio in jsdom'); }});
    const scope = document.createElement('section');
    const context = new ModuleContext({id: 'scope', audio});
    releases.push(provideModuleContext(scope, () => context));
    const take = recorder();
    scope.append(take);
    document.body.append(scope);
    const notes = new NoteOutputPort({id: 'notes'});
    take.inputModule = {id: 'source', ports: () => [notes]};
    take.record();
    notes.emit(event('a', 'on'));
    notes.emit(event('a', 'off'));
    take.stop();
    const failed = new Promise<CustomEvent>((resolve) => take.addEventListener('webscore:error', (value) => resolve(value as CustomEvent), {once: true}));
    take.shadowRoot!.querySelector<HTMLButtonElement>('[part~="play"]')!.click();
    expect((await failed).detail.error.message).toBe('no audio in jsdom');
    expect(prepare).toHaveBeenCalled();
    expect(context.registry.snapshot()).toHaveLength(0);
  });
});
