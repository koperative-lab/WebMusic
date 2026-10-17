import {describe, expect, it, vi} from 'vitest';
import {LiveNotes} from '../../src/play/headless/internal/live-notes';
import type {HeadlessSynth} from '../../src/play/headless/audio-contracts';

function fixture() {
  let sequence = 0;
  const context = {currentTime: 2} as AudioContext;
  const synth: HeadlessSynth = {
    supportsNoteOccurrences: true,
    noteOn: vi.fn(() => ++sequence),
    noteOffById: vi.fn(),
    noteOff: vi.fn(),
    dispose: vi.fn(),
  };
  const input = new LiveNotes(() => ({context, synth}));
  return {context, synth, input};
}

describe('independent live voice ownership', () => {
  it('releases same-pitch sources independently and never uses pitch-wide note off', () => {
    const {input, synth} = fixture();
    input.noteOn({id: 'keyboard-a', midi: 60, velocity: 100});
    input.noteOn({id: 'keyboard-b', midi: 60, velocity: 80});
    expect(synth.noteOn).toHaveBeenNthCalledWith(1, 60, 100, 2, Infinity);
    input.noteOff('keyboard-a');
    input.noteOff('keyboard-a');
    expect(synth.noteOffById).toHaveBeenCalledExactlyOnceWith(1, 2);
    input.dispose();
    expect(synth.noteOffById).toHaveBeenLastCalledWith(2, 2);
    expect(synth.noteOff).not.toHaveBeenCalled();
    expect(synth.dispose).not.toHaveBeenCalled();
  });

  it('retracts a late voice when backend code releases its occurrence during noteOn', () => {
    const {input, synth} = fixture();
    vi.mocked(synth.noteOn).mockImplementation(() => {
      input.noteOff('gesture');
      return 'late-voice';
    });
    input.noteOn({id: 'gesture', midi: 64, velocity: 90});
    expect(synth.noteOffById).toHaveBeenCalledExactlyOnceWith('late-voice', 2);
    input.dispose();
    expect(synth.noteOffById).toHaveBeenCalledTimes(1);
  });

  it('does not emit into a pitch-only backend or start a duplicate occurrence', () => {
    const {input, synth} = fixture();
    Object.assign(synth, {supportsNoteOccurrences: false});
    expect(() => input.noteOn({id: 'a', midi: 60, velocity: 90})).toThrow('independent');
    expect(synth.noteOn).not.toHaveBeenCalled();
    Object.assign(synth, {supportsNoteOccurrences: true});
    input.noteOn({id: 'a', midi: 60, velocity: 90});
    expect(() => input.noteOn({id: 'a', midi: 60, velocity: 90})).toThrow('already exists');
    expect(synth.noteOn).toHaveBeenCalledTimes(1);
    input.dispose();
  });

  it('rejects an advertised occurrence backend without an exact release before emitting', () => {
    const {input, synth} = fixture();
    synth.noteOffById = undefined;
    expect(() => input.noteOn({id: 'a', midi: 60, velocity: 90})).toThrow('independent');
    expect(synth.noteOn).not.toHaveBeenCalled();
    expect(synth.noteOff).not.toHaveBeenCalled();
    input.dispose();
  });

  it('rejects duplicate backend handles without releasing another occurrence by mistake', () => {
    const {input, synth} = fixture();
    vi.mocked(synth.noteOn).mockReturnValue('same-handle');
    input.noteOn({id: 'a', midi: 60, velocity: 90});
    expect(() => input.noteOn({id: 'b', midi: 60, velocity: 90})).toThrow('duplicate voice handle');
    input.noteOff('b');
    expect(synth.noteOffById).not.toHaveBeenCalled();
    input.noteOff('a');
    expect(synth.noteOffById).toHaveBeenCalledExactlyOnceWith('same-handle', 2);
    expect(synth.noteOff).not.toHaveBeenCalled();
  });

  it('finishes other owned cleanup when one borrowed backend release throws', () => {
    const {input, synth} = fixture();
    input.noteOn({id: 'a', midi: 60, velocity: 90});
    input.noteOn({id: 'b', midi: 60, velocity: 90});
    vi.mocked(synth.noteOffById!).mockImplementationOnce(() => { throw new Error('release failed'); });
    expect(() => input.dispose()).toThrow('release failed');
    expect(synth.noteOffById).toHaveBeenCalledTimes(2);
    expect(() => input.dispose()).not.toThrow();
    expect(() => input.noteOn({id: 'c', midi: 60, velocity: 90})).toThrow('disposed');
  });
});
