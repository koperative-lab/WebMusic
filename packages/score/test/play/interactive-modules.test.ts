import {describe, expect, it, vi} from 'vitest';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
} from '../../src/core';
import {InteractivePerformanceRecorder} from '../../src/play/headless/interactive/performance-recorder';
import {
  createInteractiveSource,
  InteractiveSourceIndex,
} from '../../src/play/headless/interactive/source-index';
import {InteractiveVoiceMixer} from '../../src/play/headless/interactive/voice-mixer';

function buildScore(noteCount: number) {
  const builder = new ScoreBuilder();
  const part = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: part, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(Math.max(4, noteCount)),
    timeSignature,
  });
  for (let index = 0; index < noteCount; index += 1) {
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.fromMidi(60 + index),
      onsetQuarters: new Rational(index),
      duration: Duration.quarter(),
      voice,
    });
  }
  return builder.build();
}

describe('InteractivePlayer internal modules', () => {
  it('indexes score beats once and carries proportional source position', () => {
    const first = createInteractiveSource('first', buildScore(4), 1, {Piano: 'lead'});
    const second = createInteractiveSource('second', buildScore(8), 1);
    expect(first.beats[0][0]).toMatchObject({midi: 60, voice: 'lead'});
    expect(first.secondsPerBeat).toBeCloseTo(0.5);

    const index = new InteractiveSourceIndex();
    index.add(first);
    index.add(second);
    first.cursor = 2;
    expect(index.select('second')?.cursor).toBe(4);
    expect(index.list()).toEqual(['first', 'second']);
  });

  it('uses the common sounding projection for ties, grace notes, transpose and performed ends', () => {
    const builder = new ScoreBuilder();
    const part = PartId('clarinet');
    const voice = VoiceId('v');
    const timeSignature = {numerator: 4, denominator: 4};
    builder
      .addTempo({atQuarters: Rational.ZERO, bpm: 120})
      .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
    builder.addPart({
      id: part,
      name: 'Clarinet',
      staves: 1,
      transpose: {chromatic: -2, diatonic: -1},
    });
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      timeSignature,
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('B4'),
      onsetQuarters: Rational.ZERO,
      duration: new Duration({base: 0}),
      grace: true,
      voice,
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('D4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      tie: 'start',
      voice,
      performed: {onsetSec: 0.1, durationSec: 0.2, velocity: 91},
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('D4'),
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      tie: 'stop',
      voice,
      performed: {onsetSec: 0.8, durationSec: 0.7, velocity: 100},
    });

    const source = createInteractiveSource('clarinet', builder.build(), 1);

    expect(source.beats[0]).toEqual([
      expect.objectContaining({
        // Written D4 sounds as C4 in a B-flat clarinet part.
        midi: Pitch.parse('C4').midi,
        velocity: 91,
        durationBeats: 2,
        // The tie preserves its furthest performed endpoint: 1.5 - 0.1.
        durationSeconds: 1.4,
        onsetInBeat: 0,
      }),
    ]);
    expect(source.beats.flat()).toHaveLength(1);
  });

  it('keeps trailing empty beats through a performed tail before wrapping', () => {
    const builder = new ScoreBuilder();
    const part = PartId('tail');
    const voice = VoiceId('v');
    const timeSignature = {numerator: 1, denominator: 4};
    builder
      // 120 half notes/minute means 0.25 seconds per written quarter. This
      // verifies that a source-grid quarter accounts for TempoEntry.unit.
      .addTempo({atQuarters: Rational.ZERO, bpm: 120, unit: 2})
      .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
    builder.addPart({id: part, name: 'Tail', staves: 1});
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: Rational.ONE,
      timeSignature,
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
      // At 120 half-notes/minute, 2.1 source seconds span 8.4 written
      // quarter-beats. The source must retain the ninth beat rather than
      // wrapping after its one notated quarter and replaying C4 while this
      // voice still rings.
      performed: {onsetSec: 0, durationSec: 2.1, velocity: 100},
    });

    const source = createInteractiveSource('tail', builder.build(), 1);

    expect(source.secondsPerBeat).toBeCloseTo(0.25);
    expect(source.totalBeats).toBe(9);
    expect(source.beats[0]).toHaveLength(1);
    expect(source.beats.slice(1)).toEqual([[], [], [], [], [], [], [], []]);
  });

  it('records fired notes relative to the first captured audio time', () => {
    const recorder = new InteractivePerformanceRecorder();
    recorder.start();
    recorder.capture('lead', 60, 100, 10, 0.5);
    recorder.capture('lead', 64, 90, 10.5, 0.25);
    const score = recorder.stop({bpm: 120});

    expect(recorder.active).toBe(false);
    expect(score.notes.map((note) => note.pitch.midi)).toEqual([60, 64]);
    expect(score.notes[1].onsetQuarters.toFloat()).toBeCloseTo(1);
  });

  it('owns voice wiring, note events and active-note release', () => {
    const context = {state: 'running', currentTime: 0} as unknown as AudioContext;
    const node = () => ({
      context,
      gain: {value: 1},
      connect: vi.fn(() => node()),
      disconnect: vi.fn(),
    });
    Object.assign(context, {
      destination: node(),
      createGain: vi.fn(() => node()),
    });
    const synth = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
      noteOn: vi.fn(),
      noteOff: vi.fn(),
    };
    const onNoteOn = vi.fn();
    const onNoteOff = vi.fn();
    const onCapture = vi.fn();
    const mixer = new InteractiveVoiceMixer(
      {audioContext: context},
      {onNoteOn, onNoteOff, onCapture},
    );

    mixer.addVoice('lead', synth);
    mixer.ensureForPlayback();
    mixer.fire('lead', 60, 100, 0.03, 0.5);

    expect(synth.connect).toHaveBeenCalledTimes(1);
    expect(synth.noteOn).toHaveBeenCalledWith(60, 100, 0.03, 0.5);
    expect(onNoteOn).toHaveBeenCalledWith({voice: 'lead', midi: 60, velocity: 100, time: 0.03});
    expect(onCapture).toHaveBeenCalledTimes(1);

    mixer.allNotesOff();
    expect(synth.noteOff).toHaveBeenCalledWith(60, 0);
    mixer.dispose();
  });

  it('compensates a note-on that commits before throwing without losing the original error', () => {
    const context = {state: 'running', currentTime: 0} as unknown as AudioContext;
    const node = () => ({
      context,
      gain: {value: 1},
      connect: vi.fn(() => node()),
      disconnect: vi.fn(),
    });
    Object.assign(context, {destination: node(), createGain: vi.fn(() => node())});
    const noteOnError = new Error('synth failed after attack');
    let sounding = false;
    const synth = {
      connect: vi.fn(),
      noteOn: vi.fn(() => {
        sounding = true;
        throw noteOnError;
      }),
      noteOff: vi.fn(() => {
        sounding = false;
      }),
    };
    const operations: string[] = [];
    const mixer = new InteractiveVoiceMixer(
      {audioContext: context},
      {
        onNoteOn: vi.fn(),
        onNoteOff: vi.fn(),
        onCapture: vi.fn(),
        onOperationError: (operation) => operations.push(operation),
      },
    );
    mixer.addVoice('lead', synth);
    mixer.ensureForPlayback();

    expect(() => mixer.fire('lead', 60, 100, 0, 1)).toThrow(noteOnError);

    expect(synth.noteOff).toHaveBeenCalledWith(60, 0);
    expect(sounding).toBe(false);
    expect((mixer as unknown as {activeNotes: Map<number, unknown>}).activeNotes.size).toBe(0);
    expect(operations).toEqual([]);
    mixer.dispose();
  });

  it('retains failed release ownership for allNotesOff and dispose retries', () => {
    const context = {state: 'running', currentTime: 0} as unknown as AudioContext;
    const node = () => ({
      context,
      gain: {value: 1},
      connect: vi.fn(() => node()),
      disconnect: vi.fn(),
    });
    Object.assign(context, {destination: node(), createGain: vi.fn(() => node())});
    let releases = 0;
    const releaseError = new Error('exact release failed');
    const synth = {
      connect: vi.fn(),
      noteOn: vi.fn(() => 'voice-1'),
      noteOffById: vi.fn(() => {
        releases += 1;
        if (releases === 1) throw releaseError;
      }),
    };
    const operations: Array<{operation: string; error: unknown}> = [];
    const mixer = new InteractiveVoiceMixer(
      {audioContext: context},
      {
        onNoteOn: vi.fn(),
        onNoteOff: vi.fn(),
        onCapture: vi.fn(),
        onOperationError: (operation, error) => operations.push({operation, error}),
      },
    );
    mixer.addVoice('lead', synth);
    mixer.ensureForPlayback();
    mixer.fire('lead', 60, 100, 0, 60);
    const activeNotes = (mixer as unknown as {activeNotes: Map<number, unknown>}).activeNotes;

    mixer.allNotesOff();
    expect(activeNotes.size).toBe(1);
    expect(operations).toEqual([{operation: 'noteOffById', error: releaseError}]);

    mixer.dispose();
    expect(synth.noteOffById).toHaveBeenCalledTimes(2);
    expect(activeNotes.size).toBe(0);
  });
});
