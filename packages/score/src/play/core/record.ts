// ============================================================================
// Recording — capture a live performance (the notes a player fires) and turn it
// back into a Score. Closes the improvise → notate → export-MIDI loop: play an
// InteractivePlayer by hand, `stopRecording()` to get a Score, then
// `serializeMIDI(score)` to save it.
// ============================================================================

import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../core';

/** A single captured note: exact performed timing plus its voice. */
export interface RecordedNote {
  midi: number;
  velocity: number;
  voice: string;
  /** Onset in seconds from the start of the recording. */
  onsetSec: number;
  /** Sounding duration in seconds. */
  durationSec: number;
}

export interface RecordToScoreOptions {
  /** Tempo to notate against (BPM, quarter note). Default 120. */
  bpm?: number;
  /** Positive safe integer rational resolution (ticks per quarter). Default 480. */
  ppq?: number;
  /** Snap onsets/durations to this fraction of a quarter (e.g. 0.25 = sixteenths). */
  quantizeGrid?: number;
  title?: string;
}

/**
 * Build a Score from captured notes. Each note keeps its exact `performed`
 * timing (so playback is faithful) and gets notated quarters derived from `bpm`
 * (optionally quantized), so the result both renders and round-trips to MIDI.
 * One part is created per distinct voice.
 */
export function notesToScore(notes: ReadonlyArray<RecordedNote>, options: RecordToScoreOptions = {}): Score {
  const bpm = options.bpm ?? 120;
  const ppq = options.ppq ?? 480;
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('Recording bpm must be finite and positive.');
  if (!Number.isSafeInteger(ppq) || ppq <= 0) throw new RangeError('Recording ppq must be a positive safe integer.');
  if (options.quantizeGrid !== undefined && !Number.isFinite(options.quantizeGrid)) {
    throw new RangeError('Recording quantizeGrid must be finite.');
  }
  for (const note of notes) {
    if (!Number.isFinite(note.onsetSec) || note.onsetSec < 0
      || !Number.isFinite(note.durationSec) || note.durationSec < 0) {
      throw new RangeError('Recorded note onsetSec and durationSec must be finite and non-negative.');
    }
  }
  const grid = options.quantizeGrid && options.quantizeGrid > 0 ? options.quantizeGrid : 0;
  const quartersPerSecond = bpm / 60;
  const timeSignature = {numerator: 4, denominator: 4};

  const toQuarters = (sec: number): number => {
    const q = sec * quartersPerSecond;
    return grid ? Math.round(q / grid) * grid : q;
  };
  const toRational = (quarters: number): Rational => new Rational(Math.round(quarters * ppq), ppq);

  const endQuarters = notes.reduce(
    (max, n) => Math.max(max, toQuarters(n.onsetSec) + Math.max(toQuarters(n.durationSec), 1 / ppq)),
    0,
  );
  const measureCount = Math.max(1, Math.ceil((endQuarters || 1) / 4));
  if (!Number.isFinite(endQuarters) || !Number.isSafeInteger(measureCount)) {
    throw new RangeError('Recorded note timing exceeds the supported measure range.');
  }
  const builder = new ScoreBuilder();
  builder
    .setMetadata({title: options.title ?? 'Recording'})
    .addTempo({atQuarters: Rational.ZERO, bpm})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  for (let i = 0; i < measureCount; i += 1) {
    builder.addMeasure({
      id: MeasureId(`m${i + 1}`),
      number: i + 1,
      onsetQuarters: new Rational(i * 4),
      durationQuarters: new Rational(4),
      ...(i === 0 ? {timeSignature} : {}),
    });
  }

  const voices = [...new Set(notes.map((n) => n.voice))];
  let unnamedPart = 'part';
  let unnamedSuffix = 1;
  const namedVoices = new Set(voices);
  while (namedVoices.has(unnamedPart)) unnamedPart = `part-${unnamedSuffix++}`;
  for (const voiceName of voices) {
    const partId = PartId(voiceName || unnamedPart);
    builder.addPart({id: partId, name: voiceName || 'Part', staves: 1});
    const voiceId = VoiceId(`${voiceName}-v1`);
    for (const note of notes) {
      if (note.voice !== voiceName) continue;
      const durQuarters = Math.max(1 / ppq, toQuarters(note.durationSec));
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.fromMidi(note.midi),
        onsetQuarters: toRational(toQuarters(note.onsetSec)),
        duration: new Duration({base: toRational(durQuarters)}),
        performed: {onsetSec: note.onsetSec, durationSec: note.durationSec, velocity: note.velocity},
        voice: voiceId,
      });
    }
  }

  return builder.build();
}
