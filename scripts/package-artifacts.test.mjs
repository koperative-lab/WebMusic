import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {recordBuild, sourceFingerprint, verifyBuild} from './package-artifacts.mjs';
import {packageDirectories} from './package-policy.mjs';

function sourceFixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'webmusic-source-receipt-'));
  const directory = path.join(parent, 'repository');
  t.after(() => rmSync(parent, {recursive: true, force: true}));
  const write = (file, value) => {
    const filename = path.join(directory, file);
    mkdirSync(path.dirname(filename), {recursive: true});
    writeFileSync(filename, value);
  };
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.base.json', 'scripts/tsconfig.browser-iife.json']) write(file, '{}\n');
  for (const base of packageDirectories) {
    write(`${base}/package.json`, JSON.stringify({name: `@webmusic/${path.basename(base)}`, version: '0.1.0', type: 'module', exports: './dist/index.js'}));
    for (const file of ['LICENSE', 'README.md', 'tsconfig.build.json', 'src/index.ts']) write(`${base}/${file}`, '{}\n');
    write(`${base}/dist/index.js`, 'export const value = 1;\n');
  }
  return {directory, write, ui: path.join(directory, 'packages/ui')};
}

test('packing rejects missing, stale, or altered build output', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'webmusic-artifacts-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  mkdirSync(path.join(directory, 'dist'));
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: '@webmusic/example', version: '0.1.0', exports: {'.': {import: {types: './dist/index.d.ts', default: './dist/index.js'}}}}));
  writeFileSync(path.join(directory, 'LICENSE'), 'MIT\n');
  writeFileSync(path.join(directory, 'README.md'), 'Example\n');
  assert.throws(() => recordBuild(directory, 'source-a'), /Missing.*export/);
  writeFileSync(path.join(directory, 'dist/index.js'), 'export const value = 1;\n');
  writeFileSync(path.join(directory, 'dist/index.d.ts'), 'export declare const value = 1;\n');
  assert.throws(() => verifyBuild(directory, 'source-a'), /Missing build receipt/);
  recordBuild(directory, 'source-a');
  assert.doesNotThrow(() => verifyBuild(directory, 'source-a'));
  assert.throws(() => verifyBuild(directory, 'source-b'), /changed since the build/);
  writeFileSync(path.join(directory, 'dist/index.js'), 'export const value = 2;\n');
  assert.throws(() => verifyBuild(directory, 'source-a'), /changed since the build/);
});

test('source receipts include shared source, lockfile, and browser build mappings', (t) => {
  const {directory, write} = sourceFixture(t);
  const original = sourceFingerprint(directory);
  for (const file of ['package-lock.json', 'scripts/tsconfig.browser-iife.json', 'packages/ui/src/index.ts', 'platform/kernel/src/index.ts', 'packages/score/tsconfig.build.json']) {
    write(file, 'changed\n');
    assert.notEqual(sourceFingerprint(directory), original, `${file} must invalidate the build`);
    write(file, '{}\n');
  }
  write('packages/ui/dist/generated.js', 'generated\n');
  assert.equal(sourceFingerprint(directory), original, 'building a sibling does not invalidate existing receipts');
});

test('packing rejects added, edited, or removed tsup configurations at every repository ancestor', async (t) => {
  for (const location of ['', 'packages/', 'packages/ui/', 'platform/']) {
    for (const extension of ['ts', 'cts', 'mts', 'js', 'cjs', 'mjs', 'json']) {
      const file = `${location}tsup.config.${extension}`;
      await t.test(file, (t) => {
        const {directory, write, ui} = sourceFixture(t);
        const original = sourceFingerprint(directory);
        recordBuild(ui, original);
        write(file, extension === 'json' ? '{"minify":true}\n' : 'export default {minify: true};\n');
        const configured = sourceFingerprint(directory);
        assert.throws(() => verifyBuild(ui, configured), /changed since the build/);
        recordBuild(ui, configured);
        write(file, extension === 'json' ? '{"minify":false}\n' : 'export default {minify: false};\n');
        assert.throws(() => verifyBuild(ui, sourceFingerprint(directory)), /changed since the build/);
        rmSync(path.join(directory, file));
        assert.equal(sourceFingerprint(directory), original);
        assert.throws(() => verifyBuild(ui, original), /changed since the build/);
      });
    }
  }
});

test('ancestor package.json tsup configuration and TypeScript mappings invalidate receipts', (t) => {
  const {directory, write, ui} = sourceFixture(t);
  for (const file of ['package.json', 'packages/package.json', 'platform/package.json', 'packages/ui/package.json']) {
    const filename = path.join(directory, file);
    const originalContents = file === 'packages/package.json' || file === 'platform/package.json' ? '{}\n' : readFileSync(filename, 'utf8');
    write(file, originalContents);
    recordBuild(ui, sourceFingerprint(directory));
    write(file, JSON.stringify({...JSON.parse(originalContents), tsup: {minify: true}}));
    assert.throws(() => verifyBuild(ui, sourceFingerprint(directory)), /changed since the build/, file);
    write(file, originalContents);
  }
  for (const file of ['tsconfig.json', 'packages/tsconfig.json', 'platform/tsconfig.json']) {
    recordBuild(ui, sourceFingerprint(directory));
    write(file, '{"compilerOptions":{"target":"ES2022"}}\n');
    assert.throws(() => verifyBuild(ui, sourceFingerprint(directory)), /changed since the build/, file);
  }
});

test('ambient tsup configuration outside the repository is rejected unless shadowed', (t) => {
  const {directory, write} = sourceFixture(t);
  write('../tsup.config.cjs', 'module.exports = {minify: true};\n');
  assert.throws(() => sourceFingerprint(directory), /tsup resolves configuration outside the repository/);
  write('tsup.config.json', '{}\n');
  const configured = sourceFingerprint(directory);
  write('../tsup.config.cjs', 'module.exports = {minify: false};\n');
  assert.equal(sourceFingerprint(directory), configured, 'a shadowed ambient configuration is not an input');
  rmSync(path.join(directory, 'tsup.config.json'));
  write('package.json', '{"tsup":null}\n');
  assert.doesNotThrow(() => sourceFingerprint(directory), 'the presence of package.json#tsup stops tsup discovery');
  write('package.json', '{}\n');
  rmSync(path.join(directory, '../tsup.config.cjs'));
  write('../package.json', '{"tsup":{}}\n');
  assert.throws(() => sourceFingerprint(directory), /tsup resolves configuration outside the repository/);
});

test('build configuration cannot depend on a symbolic link', (t) => {
  const {directory, write} = sourceFixture(t);
  write('../configuration.mjs', 'export default {};\n');
  symlinkSync('../configuration.mjs', path.join(directory, 'tsup.config.mjs'));
  assert.throws(() => sourceFingerprint(directory), /symbolic link/);
});

for (const file of ['packages/ui/tsup.config.js', 'tsup.config.mjs']) {
  test(`prepack rejects the actual tsup output change caused by ${file}`, (t) => {
    const {directory, write, ui} = sourceFixture(t);
    write('packages/ui/src/index.ts', 'export const value = 1;\n');
    const tsup = fileURLToPath(new URL('../node_modules/tsup/dist/cli-default.js', import.meta.url));
    const build = () => {
      // A tiny isolated fixture, never a build of the shared workspace dist.
      const result = spawnSync(process.execPath, [tsup, 'src/index.ts', '--format', 'esm', '--silent'], {cwd: ui, encoding: 'utf8'});
      assert.equal(result.status, 0, `${result.error ?? ''}${result.stdout}${result.stderr}`);
      return readFileSync(path.join(ui, 'dist/index.js'), 'utf8');
    };
    assert.doesNotMatch(build(), /RECEIPT_CONFIG_PROBE/);
    recordBuild(ui, sourceFingerprint(directory));
    write(file, 'export default {banner: {js: "// RECEIPT_CONFIG_PROBE"}};\n');
    assert.throws(() => verifyBuild(ui, sourceFingerprint(directory)), /changed since the build/);
    assert.match(build(), /RECEIPT_CONFIG_PROBE/, 'tsup really discovers this configuration and changes the artifact');
  });
}
