import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {processBundleNotices} from './bundle-notices.mjs';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('./bundle-notices.mjs', import.meta.url));

async function bundleFixture(t, manifest = {name: 'transitive', version: '2.0.0', license: 'MIT'}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webmusic-notices-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const packageDirectory = path.join(root, 'package');
  const dependency = path.join(root, 'node_modules/transitive');
  await mkdir(path.join(packageDirectory, 'dist'), {recursive: true});
  await mkdir(dependency, {recursive: true});
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({name: 'fixture', version: '1.0.0'}));
  await writeFile(path.join(dependency, 'package.json'), JSON.stringify(manifest));
  const javascript = path.join(packageDirectory, 'dist/index.js');
  const original = 'globalThis.example = 42;\n//# sourceMappingURL=index.js.map\n';
  const sourceMap = JSON.stringify({version: 3, sources: ['../../node_modules/transitive/index.js'], mappings: 'AAAA', sourcesContent: ['globalThis.example = 42;']});
  await writeFile(javascript, original);
  await writeFile(`${javascript}.map`, sourceMap);
  return {root, packageDirectory, dependency, javascript, original, sourceMap};
}

test('discovers bundled transitive licenses, preserves mappings and rejects stripped notices', async (t) => {
  const {packageDirectory, dependency, javascript, original, sourceMap} = await bundleFixture(t);
  await writeFile(path.join(dependency, 'LICENSE'), 'Copyright Example\nPermission text.\n');
  await writeFile(path.join(dependency, 'NOTICE'), 'Additional attribution.\n');
  await assert.rejects(processBundleNotices({packageDirectory, check: true}), /Missing or stale/);
  assert.deepEqual(await processBundleNotices({packageDirectory}), {packages: 1, bundles: 1});
  const licensed = await readFile(javascript, 'utf8');
  assert.ok(licensed.startsWith('globalThis.example = 42;\n'));
  assert.match(licensed, /Copyright Example\nPermission text\./);
  assert.match(licensed, /Additional attribution\./);
  assert.ok(licensed.endsWith('//# sourceMappingURL=index.js.map\n'));
  assert.equal(await readFile(`${javascript}.map`, 'utf8'), sourceMap);
  await processBundleNotices({packageDirectory});
  assert.equal(await readFile(javascript, 'utf8'), licensed, 'repeated generation must be identical');
  await processBundleNotices({packageDirectory, check: true});
  await rm(path.join(packageDirectory, 'dist/THIRD_PARTY_NOTICES.txt'));
  await assert.rejects(processBundleNotices({packageDirectory, check: true}), /Missing or stale.*THIRD_PARTY_NOTICES/);
  await processBundleNotices({packageDirectory});
  await writeFile(path.join(dependency, 'NOTICE'), 'Updated required attribution.\n');
  await assert.rejects(processBundleNotices({packageDirectory, check: true}), /Missing or stale/);
  await processBundleNotices({packageDirectory});
  await writeFile(javascript, original);
  await assert.rejects(processBundleNotices({packageDirectory, check: true}), /Missing or stale/);
  await rm(path.join(dependency, 'LICENSE'));
  await assert.rejects(processBundleNotices({packageDirectory}), /need a license identifier and license text/);
});

for (const reviewed of [
  {name: 'fft.js', version: '4.0.4', license: 'MIT', repository: {url: 'git+ssh://git@github.com/indutny/fft.js.git'}},
  {name: '@nodable/entities', version: '3.0.0', license: 'MIT', repository: {url: 'git+https://github.com/nodable/val-parsers.git'}},
]) {
  test(`${reviewed.name} snapshot requires its reviewed version, license and repository`, async (t) => {
    const {packageDirectory, dependency, javascript} = await bundleFixture(t, reviewed);
    await processBundleNotices({packageDirectory});
    const bundle = await readFile(javascript, 'utf8');
    assert.ok(bundle.includes(`${reviewed.name}@${reviewed.version}`));
    assert.match(bundle, /LICENSE \(reviewed upstream snapshot\)/);
    assert.match(bundle, /Permission is hereby granted, free of charge/);
    assert.match(bundle, /THE SOFTWARE IS PROVIDED "AS IS"/);
    await processBundleNotices({packageDirectory, check: true});
    for (const change of [
      {version: '99.0.0'},
      {license: 'BSD-3-Clause'},
      {repository: {url: 'https://example.invalid/unreviewed'}},
    ]) {
      await writeFile(path.join(dependency, 'package.json'), JSON.stringify({...reviewed, ...change}));
      await assert.rejects(processBundleNotices({packageDirectory}), /need a license identifier and license text/);
    }
  });
}

test('CLI selects a package relative to the working directory and checks its notices', async (t) => {
  const {root, packageDirectory, dependency, javascript, original} = await bundleFixture(t);
  await writeFile(path.join(dependency, 'LICENSE'), 'Copyright Example\nPermission text.\n');
  const args = [cli, '--package-dir', path.relative(root, packageDirectory)];
  const {stdout} = await execFileAsync(process.execPath, args, {cwd: root});
  assert.match(stdout, /Bundled notices written: 1 packages in 1 bundles/);
  await execFileAsync(process.execPath, [...args, '--check'], {cwd: root});
  await writeFile(javascript, original);
  await assert.rejects(execFileAsync(process.execPath, [...args, '--check'], {cwd: root}), /Missing or stale/);
  await assert.rejects(execFileAsync(process.execPath, [...args, '--unknown'], {cwd: root}), /Unknown option/);
});
