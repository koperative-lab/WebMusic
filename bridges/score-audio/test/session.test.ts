import {describe, expect, it} from 'vitest';
import {createAudioClip} from '@webmusic/audio';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';
import {createScoreAudioSession, registerAudioParticipant} from '../src';
import {SessionTransport} from '@webmusic/kernel/session';

function score() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Part'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addMeasure({id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  builder.addNote(part, {id: builder.newNoteId(), voice: VoiceId('v'), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole()});
  return builder.build();
}

describe('createScoreAudioSession', () => {
  it('registers the Score engine and the clip as two participants of one Session without allocating audio', () => {
    const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(2000)]});
    const composition = createScoreAudioSession(score(), clip, {clipOffsetSeconds: 0.5});
    const snapshot = composition.session.snapshot;
    expect(snapshot.participantCount).toBe(2);
    expect(composition.context.audio.peek()).toBeUndefined();
    expect(composition.context.registry.get('score')).toBe(composition.scoreModule);
    expect(snapshot.durationSeconds).toBeGreaterThan(0);
    composition.dispose();
    composition.dispose();
    expect(composition.session.snapshot.disposed).toBe(true);
  });

  it('maps Session seconds onto the clip axis shared with audio-player', () => {
    const session = new SessionTransport(() => 0, {driftCheckIntervalMs: 0});
    const calls: string[] = [];
    const lease = registerAudioParticipant(session, {
      play: () => { calls.push('play'); }, pause: () => calls.push('pause'), stop: () => calls.push('stop'),
      seek: (seconds: number) => calls.push(`seek:${seconds}`), setRate: () => {},
      seconds: 0, playing: false, clock: undefined, duration: 4,
      activateScheduling: async () => {}, attachScheduling: () => ({active: true, release() {}}),
      timingCapabilities: {sharedSessionClock: false},
    } as never, {prepare: () => {}, offsetSeconds: 1});
    expect(session.snapshot.participantCount).toBe(1);
    lease.release();
    session.dispose();
  });
});
