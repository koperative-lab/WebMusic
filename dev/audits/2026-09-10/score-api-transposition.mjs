// Reproduce ANALYZE-02 after npm run build:packages, from the repository root:
// node dev/audits/2026-09-10/score-api-transposition.mjs
// This records a known limitation, not a passing acceptance of the written case.
import assert from 'node:assert/strict';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, soundingPitch} from '@webmusic/score';
import {distributions, segmentChords, voiceLeading} from '@webmusic/score/analyze';
import {createAnalysisSession} from '@webmusic/score/analyze/headless';

const builder = new ScoreBuilder();
builder.addPart({id: PartId('piano'), name: 'Piano'});
builder.addPart({id: PartId('clarinet'), name: 'Bb clarinet', transpose: {chromatic: -2, diatonic: -1}});
for (const [part, voice, pitches] of [
  ['piano', 'bass', ['C4', 'D4']],
  ['piano', 'third', ['E4', 'F#4']],
  ['clarinet', 'upper', ['A4', 'B4']],
]) {
  for (const [index, pitch] of pitches.entries()) builder.addNote(PartId(part), {
    id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index),
    duration: Duration.quarter(), voice: VoiceId(voice),
  });
}
const written = builder.build();
const concertBuilder = new ScoreBuilder();
for (const part of written.parts) {
  concertBuilder.addPart({id: part.id, name: part.name});
  for (const note of part.notes) concertBuilder.addNote(part.id, {
    id: note.id, pitch: soundingPitch(note, part), onsetQuarters: note.onsetQuarters,
    duration: note.duration, voice: note.voice,
  });
}
const concert = concertBuilder.build();
// Independently known concert voicings, not an importer/exporter round trip.
assert.deepEqual(concert.parts[1].notes.map((note) => note.pitch.midi), [67, 69]);
assert.deepEqual(segmentChords(concert).map((segment) => segment.chord), ['CM', 'DM']);
assert.ok(voiceLeading(concert).some((issue) => issue.type === 'parallel-fifth'));

const describe = (score) => ({
  chords: segmentChords(score).map((segment) => segment.chord),
  pitchWeights: distributions(score).pitchClasses.filter((bin) => bin.value),
  issues: voiceLeading(score),
  sessionChords: createAnalysisSession(score).result.chords.map((segment) => segment.chord),
});
console.log(JSON.stringify({writtenInput: describe(written), concertReference: describe(concert)}, null, 2));
