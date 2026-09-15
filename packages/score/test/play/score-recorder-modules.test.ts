import {describe, expect, it} from 'vitest';
import {
  prepareScoreRecorderDownload,
} from '../../src/play/element/internal/score-recorder-export';
import {
  recordedNotesToScore,
  SCORE_RECORDER_VOICE,
  ScoreRecorderSession,
} from '../../src/play/headless/recorder';

describe('score-recorder module boundaries', () => {
  it('pairs overlapping same-pitch presses in attack order without losing either onset', () => {
    let time = 0;
    const session = new ScoreRecorderSession(() => time);
    session.start();
    time = 1;
    session.capture(60, 100, true);
    time = 2;
    session.capture(60, 80, true);
    time = 3;
    expect(session.capture(60, 0, false)).toBe(true);
    time = 4;
    expect(session.capture(60, 0, false)).toBe(true);
    expect(session.finish()).toEqual([
      {voice: SCORE_RECORDER_VOICE, midi: 60, velocity: 100, onsetSec: 1, durationSec: 2},
      {voice: SCORE_RECORDER_VOICE, midi: 60, velocity: 80, onsetSec: 2, durationSec: 2},
    ]);
  });

  it('pairs presses with releases using an injected monotonic clock', () => {
    let time = 10;
    const session = new ScoreRecorderSession(() => time);

    expect(session.capture(60, 100, true)).toBe(false);
    session.start();
    time = 10.25;
    session.capture(60, 96, true);
    time = 10.5;
    expect(session.capture(60, 1, false)).toBe(true);

    time = 10.6;
    session.capture(64, 80, true);
    time = 10.601;
    session.capture(64, 0, false);

    expect(session.noteCount).toBe(2);
    const notes = session.finish()!;
    expect(notes[0]).toMatchObject({
      voice: SCORE_RECORDER_VOICE,
      midi: 60,
      velocity: 96,
    });
    expect(notes[0].onsetSec).toBeCloseTo(0.25);
    expect(notes[0].durationSec).toBeCloseTo(0.25);
    expect(notes[1]).toMatchObject({
      voice: SCORE_RECORDER_VOICE,
      midi: 64,
      velocity: 80,
    });
    expect(notes[1].onsetSec).toBeCloseTo(0.6);
    expect(notes[1].durationSec).toBeCloseTo(0.02);
    expect(session.active).toBe(false);
    expect(session.finish()).toBeNull();
  });

  it('drops unmatched held notes when a take finishes or is cancelled', () => {
    let time = 0;
    const session = new ScoreRecorderSession(() => time);
    session.start();
    time = 1;
    session.capture(67, 100, true);
    expect(session.finish()).toEqual([]);

    session.start();
    session.capture(69, 100, true);
    session.cancel();
    expect(session.active).toBe(false);
    expect(session.noteCount).toBe(0);
  });

  it('separates notation from MIDI and MusicXML export descriptions', () => {
    const score = recordedNotesToScore([
      {voice: SCORE_RECORDER_VOICE, midi: 60, velocity: 100, onsetSec: 0, durationSec: 0.5},
    ], {bpm: 120, quantize: 0.25});
    expect(score).toBeDefined();

    const midi = prepareScoreRecorderDownload(score!, 'midi');
    expect(midi.name).toBe('recording.mid');
    expect(midi.mime).toBe('audio/midi');
    expect(String.fromCharCode(...(midi.data as Uint8Array).slice(0, 4))).toBe('MThd');

    const musicXml = prepareScoreRecorderDownload(score!, 'musicxml');
    expect(musicXml.name).toBe('recording.musicxml');
    expect(musicXml.mime).toBe('application/vnd.recordare.musicxml+xml');
    expect(musicXml.data).toContain('<score-partwise');
  });
});
