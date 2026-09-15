import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {packageDirectories} from './package-policy.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const canonical = 'git+https://github.com/example/WebMusic.git';

function checkout(t, origin) {
  const root = mkdtempSync(path.join(tmpdir(), 'webmusic-release-manifests-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(path.join(root, 'scripts'));
  for (const filename of ['release-manifests.mjs', 'release-surface.mjs', 'release-version.mjs', 'package-policy.mjs']) {
    copyFileSync(path.join(scriptsDirectory, filename), path.join(root, 'scripts', filename));
  }
  for (const directory of packageDirectories) {
    mkdirSync(path.join(root, directory), {recursive: true});
    writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify({
      name: `@webmusic/${path.basename(directory)}`,
      version: '0.1.0',
      repository: {type: 'git', url: canonical, directory},
      publishConfig: {access: 'public'},
    }));
  }
  mkdirSync(path.join(root, 'apps/doc/webmusic'), {recursive: true});
  writeFileSync(path.join(root, 'apps/doc/webmusic/package.json'), JSON.stringify({name: 'webmusic-doc', private: true}));
  if (origin !== undefined) {
    execFileSync('git', ['init', '--quiet', root]);
    if (origin !== null) execFileSync('git', ['-C', root, 'remote', 'add', 'origin', origin]);
  }
  return root;
}

function check(root, args = [], githubRepository) {
  const env = {...process.env};
  delete env.GITHUB_REPOSITORY;
  if (githubRepository) env.GITHUB_REPOSITORY = githubRepository;
  const result = spawnSync(process.execPath, ['scripts/release-manifests.mjs', ...args], {cwd: root, env, encoding: 'utf8'});
  return {status: result.status, output: `${result.stdout}${result.stderr}`};
}

test('explicit origin verification accepts GitHub HTTPS and both SSH URL forms', (t) => {
  for (const origin of [
    'https://github.com/example/WebMusic.git',
    'https://github.com/example/WebMusic/',
    'git@github.com:example/WebMusic.git',
    'ssh://git@github.com/example/WebMusic.git',
  ]) {
    const result = check(checkout(t, origin), ['--verify-origin']);
    assert.equal(result.status, 0, result.output);
  }
});

test('forks pass ordinary local checks but fail explicit publication-origin verification', (t) => {
  const root = checkout(t, 'git@github.com:contributor/WebMusic.git');
  const local = check(root);
  assert.equal(local.status, 0, local.output);
  const release = check(root, ['--verify-origin']);
  assert.equal(release.status, 1, release.output);
  assert.match(release.output, /expected git\+https:\/\/github\.com\/contributor\/WebMusic\.git from Git origin/);
});

test('explicit verification rejects missing Git metadata, missing origin and unsupported origins', (t) => {
  for (const origin of [undefined, null, 'https://gitlab.com/example/WebMusic.git']) {
    const root = checkout(t, origin);
    const local = check(root);
    assert.equal(local.status, 0, local.output);
    const release = check(root, ['--verify-origin']);
    assert.equal(release.status, 1, release.output);
    assert.match(release.output, /Cannot verify Git origin:/);
  }
});

test('fork CI passes default checks while explicit CI verification enforces repository identity', (t) => {
  const root = checkout(t, 'git@github.com:contributor/WebMusic.git');
  const ordinary = check(root, [], 'contributor/WebMusic');
  assert.equal(ordinary.status, 0, ordinary.output);
  const matching = check(root, ['--verify-ci-repository'], 'example/WebMusic');
  assert.equal(matching.status, 0, matching.output);
  const mismatched = check(root, ['--verify-ci-repository'], 'contributor/WebMusic');
  assert.equal(mismatched.status, 1, mismatched.output);
  assert.match(mismatched.output, /from GITHUB_REPOSITORY/);
});

test('explicit CI verification rejects missing or malformed GITHUB_REPOSITORY', (t) => {
  const root = checkout(t);
  for (const identifier of [undefined, '', 'example', 'example/WebMusic/extra', 'example/WebMusic\n', 'https://github.com/example/WebMusic', 'example/..']) {
    const ordinary = check(root, [], identifier);
    assert.equal(ordinary.status, 0, ordinary.output);
    const explicit = check(root, ['--verify-ci-repository'], identifier);
    assert.equal(explicit.status, 1, explicit.output);
    assert.match(explicit.output, /Cannot verify CI repository:/);
  }
});

test('origin and CI verification can be combined without bypassing either check', (t) => {
  const args = ['--verify-origin', '--verify-ci-repository'];
  const canonicalRoot = checkout(t, 'ssh://git@github.com/example/WebMusic.git');
  const matching = check(canonicalRoot, args, 'example/WebMusic');
  assert.equal(matching.status, 0, matching.output);
  const wrongCI = check(canonicalRoot, args, 'contributor/WebMusic');
  assert.equal(wrongCI.status, 1, wrongCI.output);
  assert.match(wrongCI.output, /from GITHUB_REPOSITORY/);
  const forkRoot = checkout(t, 'git@github.com:contributor/WebMusic.git');
  const explicit = check(forkRoot, args, 'example/WebMusic');
  assert.equal(explicit.status, 1, explicit.output);
  assert.match(explicit.output, /from Git origin/);
});

test('ordinary local checks still reject inconsistent package repository URLs', (t) => {
  const root = checkout(t, 'git@github.com:contributor/WebMusic.git');
  const filename = path.join(root, packageDirectories[0], 'package.json');
  const manifest = JSON.parse(readFileSync(filename, 'utf8'));
  manifest.repository.url = 'git+https://github.com/different/WebMusic.git';
  writeFileSync(filename, JSON.stringify(manifest));
  const result = check(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Published package repository.url values differ/);
});
