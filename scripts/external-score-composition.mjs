// Copied into the isolated tarball consumer by check-external-install.mjs.
// Use only installed public entries, never workspace paths or source imports.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const abc = 'X:1\nT:Package composition\nM:4/4\nL:1/4\nK:C\nCDEF|';

for (const format of ['esm', 'cjs']) {
  const load = (specifier) => format === 'esm' ? import(specifier) : require(specifier);
  const core = await load('@webmusic/score');
  for (const specifier of ['@webmusic/score/io', '@webmusic/score/io/formats']) {
    const io = await load(specifier);
    const score = io.parseABC(abc);
    const measure = score.measures[0];
    const note = score.parts[0].notes[0];
    const context = `${format} ${specifier}`;

    assert.ok(score instanceof core.Score, `${context}: parsed Score shares the root class`);
    assert.ok(note instanceof core.Note, `${context}: parsed Note shares the root class`);
    assert.ok(note.pitch instanceof core.Pitch, `${context}: parsed Pitch shares the root class`);
    assert.ok(note.duration instanceof core.Duration, `${context}: parsed Duration shares the root class`);
    assert.equal(core.Rational.from(measure.onsetQuarters), measure.onsetQuarters);
    assert.equal(new core.TimeMap(score).quartersToSeconds(note.duration.quarters), 0.5);
    assert.equal(new core.Note(note).pitch.midi, 60);
    assert.equal(new core.Measure(measure).durationQuarters.toFloat(), 4);
  }
}

console.log('  Score IO results compose with root models in ESM and CommonJS');
