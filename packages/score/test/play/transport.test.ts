import {describe, expect, it} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {InteractivePlayer, type HeadlessSynth} from '../../src/play/headless';
import {notesToScore} from '../../src/play';

function buildScore(pitches: string[]) {
  const b = new ScoreBuilder();
  const part = PartId('p');
  const voice = VoiceId('v');
  const ts = {numerator: 4, denominator: 4};
  b.setMetadata({title: 'T'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: ts});
  b.addPart({id: part, name: 'Part', staves: 1});
  b.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4), timeSignature: ts});
  pitches.forEach((p, i) =>
    b.addNote(part, {id: b.newNoteId(), pitch: Pitch.parse(p), onsetQuarters: new Rational(i), duration: Duration.quarter(), voice}),
  );
  return b.build();
}

function fakeSynth(): HeadlessSynth & {ons: number[]} {
  const ons: number[] = [];
  return {ons, connect() {}, disconnect() {}, noteOn: (m) => ons.push(m), noteOff() {}};
}

describe('notesToScore', () => {
  it('keeps unnamed and explicitly named part voices distinct', () => {
    const score = notesToScore(['', 'part', 'part-1'].map((voice, index) => ({
      voice, midi: 60 + index, velocity: 100, onsetSec: 0, durationSec: 1,
    })));
    expect(score.parts).toHaveLength(3);
    expect(new Set(score.parts.map((part) => part.id)).size).toBe(3);
    expect(score.parts.map((part) => part.notes.map((note) => note.pitch.midi))).toEqual([[60], [61], [62]]);
  });

  it('builds a Score from captured notes, one part per voice, with performed timing', () => {
    const score = notesToScore(
      [
        {voice: 'lead', midi: 60, velocity: 100, onsetSec: 0, durationSec: 0.5},
        {voice: 'lead', midi: 64, velocity: 90, onsetSec: 0.5, durationSec: 0.5},
        {voice: 'bass', midi: 36, velocity: 110, onsetSec: 0, durationSec: 1},
      ],
      {bpm: 120},
    );
    expect(score.parts.length).toBe(2); // lead + bass
    expect(score.notes.length).toBe(3);
    const first = score.notes.find((n) => n.pitch.midi === 60)!;
    expect(first.performed?.velocity).toBe(100);
    // 0.5s at 120bpm = 1 quarter
    expect(first.duration.quarters.toFloat()).toBeCloseTo(1, 3);
  });

  it('quantizes onsets to the grid', () => {
    const score = notesToScore(
      [{voice: 'v', midi: 60, velocity: 100, onsetSec: 0.27, durationSec: 0.25}],
      {bpm: 120, quantizeGrid: 0.5}, // snap to eighth-note (0.5 quarter) grid
    );
    // 0.27s * 2 q/s = 0.54 quarters → snapped to 0.5
    expect(score.notes[0].onsetQuarters.toFloat()).toBeCloseTo(0.5, 3);
  });

  it('handles an empty recording', () => {
    expect(() => notesToScore([])).not.toThrow();
  });
});

describe('InteractivePlayer recording', () => {
  it('captures fired notes and returns them as a Score', () => {
    // Minimal audio mock so fire() runs.
    const node = () => ({gain: {value: 1}, connect: () => node(), disconnect() {}});
    const ctx = {
      get currentTime() {
        return 0;
      },
      state: 'running',
      destination: {},
      createGain: () => node(),
      createConvolver: () => ({buffer: null, connect: () => node(), disconnect() {}}),
      createBuffer: (c: number, l: number) => ({numberOfChannels: c, getChannelData: () => new Float32Array(l)}),
    } as unknown as AudioContext;

    const player = new InteractivePlayer({audioContext: ctx});
    player.addVoice('lead', fakeSynth());
    player.addSource('s', buildScore(['C4', 'E4', 'G4', 'C5']));

    expect(player.isRecording).toBe(false);
    player.record();
    expect(player.isRecording).toBe(true);
    player.advance();
    player.advance();
    const score = player.stopRecording();

    expect(player.isRecording).toBe(false);
    expect(score.notes.length).toBe(2);
    expect(score.notes.map((n) => n.pitch.midi)).toEqual([Pitch.parse('C4').midi, Pitch.parse('E4').midi]);
  });
});
