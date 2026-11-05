import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findViolations, PIECE} from './check-demo-music.mjs';

const present = new Set(['midi/Arabesque No.1.mid', 'mxl/Arabesque No.1.mxl', 'wav/Arabesque No.1.wav', 'mp3/Arabesque No.1.mp3']);

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
