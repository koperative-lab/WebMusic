import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {XMLParser} from 'fast-xml-parser';
import {unzipSync} from 'fflate';
import {loadScore} from '@webmusic/score/io';
import {author, originalNotes, originalWAV, processDemoAssets, title} from './demo-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'apps/doc/webmusic/public');
const name = 'webmusic-study-no-1';
const license = (await readFile(path.join(root, 'LICENSE'), 'utf8')).trim();

function chunks(bytes, from = 12, end = bytes.length) {
  const result = new Map();
  for (let offset = from; offset + 8 <= end;) {
    const size = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= end, 'RIFF chunks stay inside their container');
    result.set(bytes.toString('ascii', offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + size % 2;
  }
  return result;
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webmusic-original-assets-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await cp(publicRoot, path.join(directory, 'apps/doc/webmusic/public'), {recursive: true});
  await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  await cp(path.join(root, 'apps/doc/webmusic/assets.json'), path.join(directory, 'apps/doc/webmusic/assets.json'));
  return {directory, publicDirectory: path.join(directory, 'apps/doc/webmusic/public')};
}

test('the checked-in public tree is exactly the reproducible original asset inventory', async () => {
  assert.deepEqual(await processDemoAssets({check: true}), {generated: 4, assets: 6, publicFiles: 7});
  const source = await readFile(path.join(root, 'apps/doc/webmusic/assets.json'), 'utf8');
  assert.equal(await readFile(path.join(publicRoot, 'licenses/DEMO_ASSETS.json'), 'utf8'), source);
  const manifest = JSON.parse(source);
  assert.equal(manifest.title, title);
  assert.equal(manifest.author, author);
  assert.ok(manifest.assets.every((entry) => entry.license === 'MIT'
    && entry.author === author && /^[a-f0-9]{64}$/.test(entry.sha256)));
});

test('standalone MXL, MIDI, WAV, MP3 and icon retain the complete project license', async () => {
  const parser = new XMLParser();
  const zipped = unzipSync(await readFile(path.join(publicRoot, `mxl/${name}.mxl`)));
  const xml = Buffer.from(zipped['score.xml']).toString();
  const score = parser.parse(xml)['score-partwise'];
  assert.equal(score.work['work-title'], title);
  assert.equal(score.identification.creator, author);
  assert.equal(score.identification.rights, license);
  const midi = await readFile(path.join(publicRoot, `midi/${name}.mid`));
  assert.ok(midi.includes(Buffer.from(license)), 'MIDI copyright meta event retains MIT text');
  const wave = chunks(await readFile(path.join(publicRoot, `wav/${name}.wav`)));
  const info = chunks(wave.get('LIST'), 4);
  assert.equal(info.get('ICOP').toString().replace(/\0$/, ''), license);
  assert.equal(info.get('INAM').toString().replace(/\0$/, ''), title);
  assert.equal(info.get('IART').toString().replace(/\0$/, ''), author);
  const mp3 = await readFile(path.join(publicRoot, `mp3/${name}.mp3`));
  assert.equal(mp3.subarray(0, 3).toString(), 'ID3');
  assert.ok(mp3.includes(Buffer.from(license)), 'MP3 ID3 copyright retains MIT text');
  assert.equal(parser.parse(await readFile(path.join(publicRoot, 'favicon.svg'), 'utf8')).svg.metadata, license);
  assert.equal((await readFile(path.join(publicRoot, 'licenses/DEMO_ASSETS_MIT.txt'), 'utf8')).trim(), license);
});

test('MIDI exposes two independent musical parts with exactly the MXL notes and timing', async () => {
  const midi = await loadScore(await readFile(path.join(publicRoot, `midi/${name}.mid`)), {format: 'midi'});
  const mxl = await loadScore(await readFile(path.join(publicRoot, `mxl/${name}.mxl`)), {format: 'mxl'});
  assert.deepEqual(midi.parts.map((part) => part.name), ['Upper', 'Lower']);
  assert.deepEqual(midi.parts.map((part) => part.notes.length), [189, 192]);
  assert.equal(mxl.parts.length, 1);
  assert.equal(mxl.measures.length, 16);
  assert.equal(midi.durationSeconds, 32);
  assert.equal(mxl.durationSeconds, 32);
  const music = (score) => score.notes.map((note) => ({pitch: note.pitch.midi,
    onset: note.onsetQuarters.toString(), duration: note.duration.quarters.toString()}))
    .sort((a, b) => a.onset.localeCompare(b.onset) || a.pitch - b.pitch);
  assert.deepEqual(music(midi), music(mxl));
  assert.equal(music(midi).length, originalNotes().filter((note) => !note.rest).length);
});

test('PCM is bounded, non-silent stereo with exact score duration and aligned triplet attacks', async () => {
  const bytes = await readFile(path.join(publicRoot, `wav/${name}.wav`));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  const wave = chunks(bytes);
  const format = wave.get('fmt ');
  assert.equal(format.readUInt16LE(0), 1);
  assert.equal(format.readUInt16LE(2), 2);
  assert.equal(format.readUInt32LE(4), 44100);
  assert.equal(format.readUInt16LE(14), 16);
  const pcm = wave.get('data');
  assert.equal(pcm.length, 32 * 44100 * 4);
  let peak = 0;
  let difference = 0;
  for (let frame = 0; frame < pcm.length / 4; frame += 1) {
    const left = pcm.readInt16LE(frame * 4);
    const right = pcm.readInt16LE(frame * 4 + 2);
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    difference += Math.abs(left - right);
    if (frame % 7350 === 0 || frame % 7350 === 7349) {
      assert.equal(left, 0, 'each notated triplet gate begins and ends at zero');
      assert.equal(right, 0);
    }
  }
  assert.ok(peak > 1000 && peak < 32767, 'audible bounded output without clipping');
  assert.ok(difference > 0, 'the two hands are panned differently');
  assert.deepEqual(bytes, originalWAV(`${license}\n`), 'PCM and metadata regenerate byte for byte');
});

test('checks reject unreviewed public files and symbolic links', async (t) => {
  const {directory, publicDirectory} = await fixture(t);
  const unknown = path.join(publicDirectory, 'unreviewed.mid');
  await writeFile(unknown, 'unknown resource');
  await assert.rejects(processDemoAssets({check: true, repositoryDirectory: directory}), /no reviewed provenance/);
  await rm(unknown);
  const alias = path.join(publicDirectory, 'linked-license.txt');
  await symlink(path.join(directory, 'LICENSE'), alias);
  await assert.rejects(processDemoAssets({check: true, repositoryDirectory: directory}), /no reviewed provenance/);
});

test('checks reject changed generated media, changed MP3 bytes and stale distributed manifests', async (t) => {
  const {directory, publicDirectory} = await fixture(t);
  const options = {check: true, repositoryDirectory: directory};
  const midi = `midi/${name}.mid`;
  await writeFile(path.join(publicDirectory, midi), 'changed music');
  await assert.rejects(processDemoAssets(options), /Stale original demo/);
  await cp(path.join(publicRoot, midi), path.join(publicDirectory, midi));
  const mp3 = `mp3/${name}.mp3`;
  const bytes = await readFile(path.join(publicDirectory, mp3));
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path.join(publicDirectory, mp3), bytes);
  await assert.rejects(processDemoAssets(options), /encoded original MP3 changed/);
  await cp(path.join(publicRoot, mp3), path.join(publicDirectory, mp3));
  await writeFile(path.join(publicDirectory, 'licenses/DEMO_ASSETS.json'), '{}\n');
  await assert.rejects(processDemoAssets(options), /inventory mismatch/);
});

test('checks reject changed trusted artwork and missing project licensing', async (t) => {
  const {directory, publicDirectory} = await fixture(t);
  const options = {check: true, repositoryDirectory: directory};
  await writeFile(path.join(publicDirectory, 'favicon.svg'), '<svg/>');
  await assert.rejects(processDemoAssets(options), /original icon changed/);
  await cp(path.join(publicRoot, 'favicon.svg'), path.join(publicDirectory, 'favicon.svg'));
  await rm(path.join(directory, 'LICENSE'));
  await assert.rejects(processDemoAssets(options), /ENOENT/);
});


test('changing both inventory hashes cannot approve an arbitrary replacement MP3', async (t) => {
  const {directory, publicDirectory} = await fixture(t);
  const relative = `mp3/${name}.mp3`;
  const invalid = Buffer.from(`ID3${license}`);
  await writeFile(path.join(publicDirectory, relative), invalid);
  const manifestPath = path.join(directory, 'apps/doc/webmusic/assets.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.assets.find((entry) => entry.path === relative).sha256 = createHash('sha256').update(invalid).digest('hex');
  for (const filename of [manifestPath, path.join(publicDirectory, 'licenses/DEMO_ASSETS.json')]) {
    await writeFile(filename, JSON.stringify(manifest, null, 2) + '\n');
  }
  await assert.rejects(processDemoAssets({check: true, repositoryDirectory: directory}), /encoded original MP3 changed/);
});
