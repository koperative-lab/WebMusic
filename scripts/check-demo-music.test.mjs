import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {comparePin, demoSourceFiles, findViolations, parsePin, PIECE} from './check-demo-music.mjs';

const present = new Set(['midi/Arabesque No.1.mid', 'mxl/Arabesque No.1.mxl', 'wav/Arabesque No.1.wav', 'mp3/Arabesque No.1.mp3']);

test('checks new and moved source without depending on the Git index', (t) => {
  const repository = mkdtempSync(path.join(tmpdir(), 'webmusic-demo-scan-'));
  t.after(() => rmSync(repository, {recursive: true, force: true}));
  const files = {
    'doc/src/content/demo.mdx': 'midi/Other.mid',
    'doc/shared/ui.ts': 'midi/Arabesque%20No.1.mid',
    'doc/src/node_modules/fixture.ts': '',
    'doc/src/dist/generated.js': '',
    'doc/src/.cache/generated.ts': '',
    'doc/src/media.mid': '',
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repository, file)), {recursive: true});
    writeFileSync(path.join(repository, file), body);
  }
  symlinkSync(path.join(repository, 'doc/src'), path.join(repository, 'doc/shared/linked'));
  const sources = demoSourceFiles(repository);
  assert.deepEqual(sources, ['doc/shared/ui.ts', 'doc/src/content/demo.mdx']);
  assert.match(sources.flatMap((file) => findViolations(files[file], file, present)).join('\n'), /Other\.mid is not Arabesque/);
  assert.throws(() => demoSourceFiles(repository, ['missing/src']), /ENOENT/);
});

test('accepts every Arabesque No. 1 format, encoded or literal', () => {
  const text = [
    "const a = `${import.meta.env.BASE_URL}midi/Arabesque%20No.1.mid`;",
    '<score-player src="/mxl/Arabesque%20No.1.mxl"></score-player>',
    "await loadClipFromUrl('/wav/Arabesque%20No.1.wav');",
    'The file `public/mp3/Arabesque No.1.mp3` streams.',
  ].join('\n');
  assert.deepEqual(findViolations(text, 'demo.astro', present), []);
});

test('rejects another piece, generated fixtures and the former study', () => {
  const text = "midi/Editing.mid\n'/wav/webmusic-study-no-1.wav'\nmxl/Other%20Piece.mxl";
  const problems = findViolations(text, 'demo.mdx', present);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /demo\.mdx:1: midi\/Editing\.mid is not Arabesque No\.1/);
  assert.match(problems[1], /demo\.mdx:2:/);
  assert.match(problems[2], /demo\.mdx:3:/);
});

test('rejects a mismatched folder and extension or a file absent from public', () => {
  assert.match(findViolations('wav/Arabesque%20No.1.mp3', 'x.ts', present)[0], /mixes the wav\/ folder/);
  assert.match(findViolations('mp3/Arabesque%20No.1.mp3', 'x.ts', new Set(['midi/Arabesque No.1.mid']))[0], /missing/);
  assert.equal(PIECE, 'Arabesque No.1');
});

test('compares the public folder with the owner pin', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const pin = parsePin(`${a}  midi/Arabesque No.1.mid\n${b}  favicon.svg\n`);
  assert.deepEqual(comparePin(pin, new Map([['midi/Arabesque No.1.mid', a], ['favicon.svg', b]])), []);
  const problems = comparePin(pin, new Map([['midi/Arabesque No.1.mid', b], ['extra.wav', a]]));
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /differs from its pinned bytes/);
  assert.match(problems.join('\n'), /extra\.wav is not in/);
  assert.match(problems.join('\n'), /favicon\.svg is pinned but missing/);
});
