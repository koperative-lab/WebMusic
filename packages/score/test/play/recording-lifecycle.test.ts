// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreRecorderElement} from '../../src/play/element/score-recorder';
import {NoteInputElement} from '../../src/play/element/note-input';

customElements.define('lifecycle-score-recorder', ScoreRecorderElement);
customElements.define('lifecycle-note-input', NoteInputElement);

function noteEvent(target: EventTarget, on: boolean, midi = 60, velocity = 100) {
  target.dispatchEvent(new CustomEvent(on ? 'webscore:noteon' : 'webscore:noteoff', {
    detail: {midi, velocity}, bubbles: true, composed: true,
  }));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('recorder input ownership', () => {
  it('discards old-source pending presses while retaining completed notes and the recording time origin', () => {
    let milliseconds = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => milliseconds);
    const recorder = document.createElement('lifecycle-score-recorder') as ScoreRecorderElement;
    const first = new EventTarget();
    const second = new EventTarget();
    recorder.source = first;
    document.body.append(recorder);
    recorder.record();
    milliseconds = 1000;
    noteEvent(first, true, 64);
    milliseconds = 2000;
    noteEvent(first, false, 64);
    milliseconds = 3000;
    noteEvent(first, true, 60);
    recorder.source = second;
    milliseconds = 4000;
    noteEvent(first, false, 60);
    noteEvent(second, false, 60);
    milliseconds = 5000;
    noteEvent(second, true, 67);
    milliseconds = 6000;
    noteEvent(second, false, 67);
    const take = recorder.stop()!;
    expect(take.notes.map((note) => [note.pitch.midi, note.performed?.onsetSec, note.performed?.durationSec]))
      .toEqual([[64, 1, 1], [67, 5, 1]]);
  });

  it('retains its configured source through disconnect and resumes exactly one subscription on reconnect', () => {
    const recorder = document.createElement('lifecycle-score-recorder') as ScoreRecorderElement;
    const source = new EventTarget();
    const add = vi.spyOn(source, 'addEventListener');
    const remove = vi.spyOn(source, 'removeEventListener');
    recorder.source = source;
    document.body.append(recorder);
    recorder.record();
    noteEvent(source, true);
    recorder.remove();
    expect(recorder.source).toBe(source);
    expect(recorder.recordingActive).toBe(false);
    noteEvent(source, false);
    document.body.append(recorder);
    recorder.record();
    noteEvent(source, true);
    noteEvent(source, false);
    expect(recorder.stop()?.notes).toHaveLength(1);
    recorder.remove();
    expect(add).toHaveBeenCalledTimes(4);
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it.each(['nested', 'ancestor', 'self'])('captures each %s source event once even when it reaches both listeners', (placement) => {
    const recorder = document.createElement('lifecycle-score-recorder') as ScoreRecorderElement;
    const source = placement === 'self' ? recorder : document.createElement('div');
    if (placement === 'nested') recorder.append(source);
    else if (placement === 'ancestor') source.append(recorder);
    document.body.append(placement === 'ancestor' ? source : recorder);
    recorder.source = source;
    recorder.record();
    const target = placement === 'ancestor' ? recorder : source;
    noteEvent(target, true);
    noteEvent(target, true);
    noteEvent(target, false);
    noteEvent(target, false);
    expect(recorder.stop()?.notes).toHaveLength(2);
    recorder.source = undefined;
    recorder.record();
    noteEvent(recorder, true);
    noteEvent(recorder, false);
    expect(recorder.stop()?.notes).toHaveLength(1);
  });
});

describe('note-input callback ordering', () => {
  it('keeps both delivery channels ordered when the onNote callback disconnects and throws', () => {
    const input = document.createElement('lifecycle-note-input') as NoteInputElement;
    input.setAttribute('keyboard', '');
    const calls: string[] = [];
    input.onNote = (_midi, _velocity, on) => {
      calls.push(`callback:${on}`);
      if (on) { input.remove(); throw new Error('callback failed'); }
    };
    input.addEventListener('webscore:noteon', () => calls.push('event:true'));
    input.addEventListener('webscore:noteoff', () => calls.push('event:false'));
    document.body.append(input);
    input.shadowRoot!.querySelector('.wui-note')!.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    expect(calls).toEqual(['event:true', 'callback:true', 'event:false', 'callback:false']);
  });

  it('lets a release callback replace the layout without reviving the superseded presenter', () => {
    const input = document.createElement('lifecycle-note-input') as NoteInputElement;
    input.setAttribute('keyboard', '');
    input.setAttribute('start', '60');
    const calls: boolean[] = [];
    input.onNote = (_midi, _velocity, on) => {
      calls.push(on);
      if (!on) input.layout = 'grid';
    };
    document.body.append(input);
    const previous = input.shadowRoot!.querySelector('.wui-note')!;
    previous.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    input.layout = 'chords';
    expect(calls).toEqual([true, false]);
    expect(previous.isConnected).toBe(false);
    expect(input.shadowRoot!.querySelectorAll('.wui-note')).toHaveLength(1);
    expect(input.shadowRoot!.querySelector('.wui-note__grid')).not.toBeNull();
    expect(input.shadowRoot!.querySelector('.wui-note__chords')).toBeNull();
  });

  it('publishes an attack before the release caused by a synchronous event-listener disconnect', () => {
    const input = document.createElement('lifecycle-note-input') as NoteInputElement;
    input.setAttribute('keyboard', '');
    input.setAttribute('start', '60');
    const events: boolean[] = [];
    const callback: boolean[] = [];
    input.onNote = (_midi, _velocity, on) => callback.push(on);
    input.addEventListener('webscore:noteon', () => { events.push(true); input.remove(); });
    input.addEventListener('webscore:noteoff', () => events.push(false));
    document.body.append(input);
    input.shadowRoot!.querySelector('.wui-note')!.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    expect(events).toEqual([true, false]);
    expect(callback).toEqual([true, false]);
  });
});
