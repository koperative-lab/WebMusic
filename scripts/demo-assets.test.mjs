import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {XMLParser} from 'fast-xml-parser';
import {unzipSync} from 'fflate';
import {createRequire} from 'node:module';
import {processDemoAssets} from './demo-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = path.join(root, 'apps/doc/webmusic/public');

test('standalone original downloads retain the complete license in format metadata', async () => {
  const license = (await readFile(path.join(root, 'LICENSE'), 'utf8')).trim();
  const parser = new XMLParser();
  const xml = await readFile(path.join(publicDirectory, 'xml/demo.xml'), 'utf8');
  const entries = unzipSync(await readFile(path.join(publicDirectory, 'mxl/demo.mxl')));
  const containerWithPaths = new XMLParser({ignoreAttributes: false}).parse(Buffer.from(entries['META-INF/container.xml']).toString());
  const scorePath = containerWithPaths.container.rootfiles.rootfile['@_full-path'];
  const mxl = Buffer.from(entries[scorePath]).toString();
  const chords = await readFile(path.join(publicDirectory, 'xml/chord-progression.musicxml'), 'utf8');
  for (const notation of [xml, mxl, chords]) {
    assert.equal(parser.parse(notation)['score-partwise'].identification.rights, license);
  }
  const svg = parser.parse(await readFile(path.join(publicDirectory, 'favicon.svg'), 'utf8'));
  assert.equal(svg.svg.metadata, license);
  // Use Tone MIDI's own parser dependency to inspect the standard copyright event.
  const require = createRequire(import.meta.url);
  const {parseMidi} = createRequire(require.resolve('@tonejs/midi'))('midi-file');
  const midi = parseMidi(await readFile(path.join(publicDirectory, 'midi/demo.mid')));
  assert.equal(midi.tracks.flat().find((event) => event.type === 'copyrightNotice')?.text, license);
});

test('public asset checks reject unreviewed files, altered content and missing license texts', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'webmusic-assets-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const copied = path.join(temporary, 'apps/doc/webmusic/public');
  await mkdir(path.dirname(copied), {recursive: true});
  await cp(publicDirectory, copied, {recursive: true});
  await cp(path.join(root, 'LICENSE'), path.join(temporary, 'LICENSE'));
  await cp(path.join(root, 'apps/doc/webmusic/assets.json'), path.join(temporary, 'apps/doc/webmusic/assets.json'));
  const options = {repositoryDirectory: temporary};
  await processDemoAssets({...options, check: true});
  const unexpected = path.join(copied, 'unreviewed.mid');
  await writeFile(unexpected, 'unknown resource');
  await assert.rejects(processDemoAssets({...options, check: true}), /no reviewed provenance/);
  await rm(unexpected);
  await writeFile(path.join(copied, 'xml/demo.xml'), 'modified music');
  await assert.rejects(processDemoAssets({...options, check: true}), /Stale original demo/);
  await processDemoAssets(options);
  await writeFile(path.join(copied, 'favicon.svg'), 'different icon');
  await assert.rejects(processDemoAssets({...options, check: true}), /provenance hash mismatch/);
  await cp(path.join(publicDirectory, 'favicon.svg'), path.join(copied, 'favicon.svg'));
  const manifestFile = path.join(temporary, 'apps/doc/webmusic/assets.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.assets[0].sourceLicenseFile = '../outside';
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(processDemoAssets({...options, check: true}), /inside the source repository/);
  await cp(path.join(root, 'apps/doc/webmusic/assets.json'), manifestFile);
  await rm(path.join(temporary, 'LICENSE'));
  await assert.rejects(processDemoAssets({...options, check: true}), /ENOENT/);
});

test('XML, MXL and MIDI describe the same original pitches and musical timing', async () => {
  // Use public installed exports, so this checks the actual downloadable formats.
  const {parseMusicXML, parseMXL, parseMIDI} = await import('@webmusic/score/io');
  const xml = parseMusicXML(await readFile(path.join(publicDirectory, 'xml/demo.xml'), 'utf8'));
  const mxl = await parseMXL(await readFile(path.join(publicDirectory, 'mxl/demo.mxl')));
  const midi = parseMIDI(await readFile(path.join(publicDirectory, 'midi/demo.mid')));
  // Import assigns fresh runtime IDs; all authored notation must still agree.
  const notation = (score) => JSON.parse(JSON.stringify(score.toJSON(), (key, value) => key === 'id' ? undefined : value));
  assert.deepEqual(notation(mxl), notation(xml));
  assert.equal(xml.measures.length, 16);
  assert.equal(xml.durationSeconds, 32);
  const music = (score) => [...score.allNotes()].filter((note) => note.pitch).map((note) => ({
    pitch: note.pitch.midi,
    onset: note.onsetQuarters.toString(),
    duration: note.duration.quarters.toString(),
  })).sort((a, b) => a.onset.localeCompare(b.onset) || a.pitch - b.pitch);
  assert.equal(music(xml).length, 381);
  const midiNotes = music(midi);
  const xmlNotes = music(xml);
  assert.equal(midiNotes.length, xmlNotes.length);
  xmlNotes.forEach((note, index) => assert.deepEqual(midiNotes[index], note, `Pitched event ${index}`));
  assert.equal(midi.durationSeconds, xml.durationSeconds);
});
