import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'prefix-docs-base.mjs');

test('prefixes built HTML links idempotently and accepts base-aware emitted assets', async (context) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'webmusic-doc-base-'));
  context.after(() => rm(dist, {recursive: true, force: true}));
  await mkdir(path.join(dist, '_astro'));
  await writeFile(
    path.join(dist, 'index.html'),
    [
      '<a href="/score/">Score</a>',
      '<img src="/audio/demo.wav">',
      '<a href="/WebMusic/audio/">Already prefixed</a>',
      '<a href="https://example.com/audio/demo.wav">External</a>',
      '<pre><code>fetch("/audio/example.wav")</code></pre>',
    ].join('\n'),
  );
  await writeFile(
    path.join(dist, '_astro', 'page.js'),
    'const sample = "/WebMusic/audio/demo.wav";\n',
  );

  await execFileAsync(process.execPath, [script, dist, '/WebMusic']);
  const once = await readFile(path.join(dist, 'index.html'), 'utf8');
  assert.match(once, /href="\/WebMusic\/score\/"/);
  assert.match(once, /src="\/WebMusic\/audio\/demo\.wav"/);
  assert.equal(once.match(/\/WebMusic\/audio\//g)?.length, 2);

  await execFileAsync(process.execPath, [script, dist, '/WebMusic/']);
  assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), once);
});

test('rejects a root-absolute asset embedded in emitted JavaScript', async (context) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'webmusic-doc-base-invalid-'));
  context.after(() => rm(dist, {recursive: true, force: true}));
  await writeFile(path.join(dist, 'index.html'), '<main>Docs</main>');
  await writeFile(path.join(dist, 'page.js'), 'fetch("/midi/demo.mid");\n');

  await assert.rejects(
    execFileAsync(process.execPath, [script, dist, '/WebMusic']),
    (error) => /asset URL\(s\).*escape \/WebMusic.*import\.meta\.env\.BASE_URL/s.test(error.stderr),
  );
});
