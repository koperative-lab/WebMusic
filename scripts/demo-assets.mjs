#!/usr/bin/env node
// Original, deterministic music for the public examples. No downloaded score or samples.
import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const title = 'WebMusic Study No. 1';
const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
const figures = [[0, 1, 2, 1, 0, 2, 1, 2, 0, 2, 1, 0], [2, 0, 1, 2, 1, 0, 1, 0, 2, 0, 2, 1]];

export function originalNotes() {
  return Array.from({length: 16}, (_, bar) => [1, 2].flatMap((staff) =>
    Array.from({length: 12}, (_, index) => {
      const chord = chords[bar % chords.length];
      const degree = figures[Math.floor(bar / 4) % 2][staff === 1 ? index : (index + 3) % 12];
      return {
        bar: bar + 1, staff, index,
        midi: chord[degree] + (staff === 1 ? 12 : 0),
        rest: staff === 1 && index === 11 && [3, 7, 11].includes(bar),
      };
    }))).flat();
}

function pitchXML(midi) {
  const step = ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B'][midi % 12];
  if (!step) throw new Error('The original study uses only natural pitches.');
  return `<pitch><step>${step}</step><octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
}

function noteXML(note) {
  const {bar, staff, index, midi, rest} = note;
  const hiddenNumber = Math.floor(index / 3) % 2 === 1;
  const marks = [];
  if (index % 3 === 0) marks.push(`<tuplet type="start" number="1" bracket="no" show-number="${hiddenNumber ? 'none' : 'actual'}"/>`);
  if (index % 3 === 2) marks.push(`<tuplet type="stop" number="1" show-number="${hiddenNumber ? 'none' : 'actual'}"/>`);
  if (bar % 2 === 1 && index === 0) marks.push('<slur type="start" number="1" placement="above"/>');
  if (bar % 2 === 0 && index === 11) marks.push('<slur type="stop" number="1" placement="above"/>');
  const articulations = [];
  if (staff === 1 && index === 0 && bar % 4 === 1) articulations.push('<staccato/>');
  if (staff === 1 && index === 6) articulations.push('<tenuto/>');
  if (staff === 1 && index === 3 && [1, 9].includes(bar)) articulations.push('<accent/>');
  if (articulations.length) marks.push(`<articulations>${articulations.join('')}</articulations>`);
  const pitch = rest
    ? `<rest><display-step>${bar === 4 ? 'E' : 'F'}</display-step><display-octave>${bar === 4 ? 4 : 5}</display-octave></rest>`
    : pitchXML(midi);
  return `      <note>${pitch}<duration>4</duration><voice>${staff}</voice><type>eighth</type>`
    + '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>'
    + `<stem>${staff === 1 ? 'up' : 'down'}</stem><staff>${staff}</staff>`
    + `<beam number="1">${['begin', 'continue', 'end'][index % 3]}</beam>`
    + `<notations>${marks.join('')}</notations></note>`;
}

export function originalMusicXML(licenseText) {
  const rights = licenseText.trim().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const notes = originalNotes();
  const measures = [];
  for (let bar = 1; bar <= 16; bar += 1) {
    const lines = [`    <measure number="${bar}">`];
    if (bar === 1) {
      lines.push('      <attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes>');
      lines.push('      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>');
    }
    if ([5, 9, 13].includes(bar)) {
      const treble = bar === 9;
      lines.push(`      <attributes><clef number="2"><sign>${treble ? 'G' : 'F'}</sign><line>${treble ? 2 : 4}</line></clef></attributes>`);
    }
    if (bar % 4 === 1) lines.push('      <direction placement="above"><direction-type><words>lightly</words></direction-type><staff>1</staff></direction>');
    if ([1, 9].includes(bar)) lines.push(`      <direction placement="below"><direction-type><dynamics><${bar === 1 ? 'mp' : 'mf'}/></dynamics></direction-type><staff>1</staff></direction>`);
    const wedge = {1: 'crescendo', 4: 'stop', 9: 'diminuendo', 12: 'stop'}[bar];
    if (wedge) lines.push(`      <direction placement="below"><direction-type><wedge type="${wedge}" number="1"/></direction-type><staff>1</staff></direction>`);
    lines.push(`      <direction placement="below"><direction-type><pedal type="${bar % 2 ? 'start' : 'stop'}" line="yes"/></direction-type><staff>2</staff></direction>`);
    for (const staff of [1, 2]) {
      if (staff === 2) lines.push('      <backup><duration>48</duration></backup>');
      lines.push(...notes.filter((note) => note.bar === bar && note.staff === staff).map(noteXML));
    }
    if (bar % 4 === 0) lines.push(`      <barline location="right"><bar-style>${bar === 16 ? 'light-heavy' : 'light-light'}</bar-style></barline>`);
    lines.push('    </measure>');
    measures.push(lines.join('\n'));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!-- Original music generated by scripts/demo-assets.mjs; provenance: apps/doc/webmusic/assets.json in the source repository. -->\n'
    + '<score-partwise version="3.1">\n'
    + `  <work><work-title>${title}</work-title></work>\n`
    + `  <identification><creator type="composer">WebMusic</creator><rights>${rights}</rights><source>https://github.com/koperative-lab/WebMusic/blob/main/scripts/demo-assets.mjs</source></identification>\n`
    + '  <part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list>\n'
    + `  <part id="P1">\n${measures.join('\n')}\n  </part>\n</score-partwise>\n`;
}

function u16(value) { const data = Buffer.alloc(2); data.writeUInt16LE(value); return data; }
function u32(value) { const data = Buffer.alloc(4); data.writeUInt32LE(value >>> 0); return data; }
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A small deterministic ZIP writer using the standard uncompressed method.
// Fixed DOS timestamps avoid byte changes on subsequent generation.
function zipStored(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [filename, content] of entries) {
    const name = Buffer.from(filename);
    const data = Buffer.from(content);
    const crc = u32(crc32(data));
    const common = Buffer.concat([u16(0), u16(0), u16(0), u16(33), crc, u32(data.length), u32(data.length), u16(name.length), u16(0)]);
    const header = Buffer.concat([u32(0x04034b50), u16(20), common, name]);
    local.push(header, data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
}

export function originalMXL(xml) {
  return zipStored([
    ['mimetype', 'application/vnd.recordare.musicxml'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'],
    ['score.xml', xml],
  ]);
}

function variableLength(value) {
  const bytes = [value & 127];
  while ((value >>= 7) > 0) bytes.unshift((value & 127) | 128);
  return bytes;
}

export function originalMIDI(licenseText) {
  const meta = (type, text) => { const data = Buffer.from(text); return [0, 255, type, ...variableLength(data.length), ...data]; };
  const bytes = [...meta(3, title), ...meta(2, licenseText.trim()), 0, 255, 81, 3, 7, 161, 32, 0, 255, 88, 4, 4, 2, 24, 8, 0, 192, 0];
  const events = originalNotes().filter((note) => !note.rest).flatMap((note) => {
    const tick = (note.bar - 1) * 1920 + note.index * 160;
    return [{tick, on: true, midi: note.midi}, {tick: tick + 160, on: false, midi: note.midi}];
  }).sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on) || a.midi - b.midi);
  let previous = 0;
  for (const event of events) {
    bytes.push(...variableLength(event.tick - previous), event.on ? 144 : 128, event.midi, event.on ? 80 : 0);
    previous = event.tick;
  }
  bytes.push(0, 255, 47, 0);
  const track = Buffer.from(bytes);
  const size = Buffer.alloc(4); size.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from('MThd'), Buffer.from([0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), size, track]);
}

export async function processDemoAssets({check = false, repositoryDirectory = root} = {}) {
  const publicDirectory = path.join(repositoryDirectory, 'apps/doc/webmusic/public');
  const manifestFile = path.join(repositoryDirectory, 'apps/doc/webmusic/assets.json');
  const projectLicense = await readFile(path.join(repositoryDirectory, 'LICENSE'), 'utf8');
  if (!projectLicense.trim()) throw new Error('Empty project license.');
  const xml = originalMusicXML(projectLicense);
  const generated = new Map([
    ['xml/demo.xml', Buffer.from(xml)],
    ['mxl/demo.mxl', originalMXL(xml)],
    ['midi/demo.mid', originalMIDI(projectLicense)],
  ]);
  const provenance = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (provenance.schemaVersion !== 2 || !Array.isArray(provenance.assets)) throw new Error('Unsupported asset provenance manifest.');
  const allowedFiles = new Set();
  const validateRelativePath = (filename, boundary) => {
    if (typeof filename !== 'string' || !filename || path.isAbsolute(filename)
        || filename.includes('\\') || filename.split('/').includes('..')) {
      throw new Error(`Asset path must remain inside ${boundary}: ${filename}`);
    }
  };
  for (const asset of provenance.assets) {
    if (allowedFiles.has(asset.path)) throw new Error(`Duplicate asset provenance: ${asset.path}`);
    if (!asset.author || !asset.source || !asset.license || !asset.sourceLicenseFile) throw new Error(`Incomplete asset provenance: ${asset.path}`);
    validateRelativePath(asset.path, 'public/');
    validateRelativePath(asset.sourceLicenseFile, 'the source repository');
    allowedFiles.add(asset.path);
  }
  for (const relative of generated.keys()) {
    if (!allowedFiles.has(relative)) throw new Error(`Generated asset has no reviewed provenance: ${relative}`);
  }
  const walk = async (directory) => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (!entry.isFile() || !allowedFiles.has(path.relative(publicDirectory, filename).split(path.sep).join('/'))) {
        throw new Error(`Public file has no reviewed provenance: ${filename}`);
      }
    }
  };
  await walk(publicDirectory);
  for (const [relative, expected] of generated) {
    const filename = path.join(publicDirectory, relative);
    if (check) {
      if (!expected.equals(await readFile(filename))) throw new Error(`Stale original demo: ${relative}`);
    } else {
      await writeFile(filename, expected);
    }
  }
  for (const asset of provenance.assets) {
    const data = await readFile(path.join(publicDirectory, asset.path));
    const digest = createHash('sha256').update(data).digest('hex');
    if (check && asset.sha256 !== digest) throw new Error(`Asset provenance hash mismatch: ${asset.path}`);
    asset.sha256 = digest;
    const licenseText = await readFile(path.join(repositoryDirectory, asset.sourceLicenseFile), 'utf8');
    if (!licenseText.trim()) throw new Error(`Empty license file: ${asset.sourceLicenseFile}`);
  }
  if (!check) await writeFile(manifestFile, JSON.stringify(provenance, null, 2) + '\n');
  return {generated: generated.size, assets: provenance.assets.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--write'].includes(arg)) || (args.includes('--check') && args.includes('--write'))) {
    throw new Error('Usage: node scripts/demo-assets.mjs [--check|--write]');
  }
  const check = args.includes('--check');
  const result = await processDemoAssets({check});
  console.log(`Demo assets ${check ? 'verified' : 'written'}: ${result.generated} original formats, ${result.assets} provenance records.`);
}
