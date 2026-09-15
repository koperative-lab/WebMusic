// Sample scores / racks shared by the ready-made demo elements. Kept in the
// package so a doc site (or any consumer) can drop a demo element with zero
// wiring; nothing here is needed for production use.

import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../core';
import {Rack} from '../headless/rack';
import {Sound} from '../headless/sound';
import {Effect} from '../headless/effects';

export interface SampleScoreOptions {
  title?: string;
  bpm?: number;
  /** Scientific-pitch note names, played in order. */
  pitches?: string[];
  /** Quarters between successive notes (1 = quarters, 2 = halves). Default 1. */
  every?: number;
}

/** Build a small single-voice sample score for the demo elements. */
export function sampleScore(options: SampleScoreOptions = {}): Score {
  const title = options.title ?? 'Sample';
  const bpm = options.bpm ?? 96;
  const pitches = options.pitches ?? ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'C4'];
  const every = options.every ?? 1;

  const b = new ScoreBuilder();
  const part = PartId('sample');
  const voice = VoiceId('sample-v');
  const ts = {numerator: 4, denominator: 4};

  b.setMetadata({title})
    .addTempo({atQuarters: Rational.ZERO, bpm})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: ts});
  b.addPart({id: part, name: title, staves: 1});

  const measures = Math.max(1, Math.ceil((pitches.length * every) / 4));
  for (let m = 0; m < measures; m++) {
    b.addMeasure({
      id: MeasureId('m' + (m + 1)),
      number: m + 1,
      onsetQuarters: new Rational(m * 4),
      durationQuarters: new Rational(4),
      ...(m === 0 ? {timeSignature: ts} : {}),
    });
  }

  pitches.forEach((p, i) =>
    b.addNote(part, {
      id: b.newNoteId(),
      pitch: Pitch.parse(p),
      onsetQuarters: new Rational(i * every),
      duration: every === 1 ? Duration.quarter() : Duration.half(),
      voice,
    }),
  );

  return b.build();
}

/** Build a multi-instrument rack sharing a reverb, for the mixer demo. */
export function sampleRack(): Rack {
  const rack = new Rack({effect: Effect.reverb({wet: 0.25})});
  const bpm = 100;
  const members: Array<{id: string; pitches: string[]; every?: number; type: OscillatorType; gain: number}> = [
    {id: 'lead', pitches: ['C5', 'E5', 'G5', 'C6', 'B5', 'G5', 'E5', 'C5'], type: 'triangle', gain: 0.2},
    {id: 'bass', pitches: ['C3', 'G3', 'A2', 'G3'], every: 2, type: 'sawtooth', gain: 0.16},
    {id: 'pad', pitches: ['C4', 'G4'], every: 4, type: 'sine', gain: 0.14},
    {id: 'arp', pitches: ['C5', 'E5', 'G5', 'E5', 'C5', 'E5', 'G5', 'E5'], type: 'square', gain: 0.1},
    {id: 'bell', pitches: ['C6', 'E6', 'G6', 'E6'], every: 2, type: 'triangle', gain: 0.12},
  ];
  for (const m of members) {
    rack.add({
      id: m.id,
      score: sampleScore({title: m.id, bpm, pitches: m.pitches, every: m.every ?? 1}),
      sound: Sound.oscillator({type: m.type, gain: m.gain}),
    });
  }
  return rack;
}
