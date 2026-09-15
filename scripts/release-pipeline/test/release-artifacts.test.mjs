import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {
  artifactManifestFileName,
  artifactManifestSchemaVersion,
  assertDistTagSnapshotUnchanged,
  assertReleaseTagSelectionDoesNotMoveBackward,
  compareStableVersions,
  createValidatedArtifactSnapshot,
  integrityForFile,
  npmPublishArguments,
  readArtifactManifest,
  releaseManifestFormat,
  releaseDistTag,
  releaseTagMutationState,
  releaseUploadDistTag,
  sharedStableVersion,
} from '../release-artifacts.mjs';
import {releasePackageNames} from '../release-packages.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('publishes all 13 workspace packages in one dependency-safe order', () => {
  assert.deepEqual(releasePackageNames, [
    '@webmusic/kernel',
    '@webscore/core',
    '@webscore/io',
    '@webscore/play',
    '@webscore/analyze',
    '@webscore/view',
    '@webscore/react',
    '@webaudio/core',
    '@webaudio/play',
    '@webaudio/analyze',
    '@webaudio/view',
    '@webaudio/react',
    '@webmusic/score-audio',
  ]);
  const workspaceDirectories = releasePackageNames.map(packageDirectory);
  assert.equal(workspaceDirectories[0], 'platform/kernel');
  assert.equal(workspaceDirectories.at(-1), 'bridges/score-audio');
  assert.equal(new Set(workspaceDirectories).size, releasePackageNames.length);
});

test('validates every exact tarball in a release artifact manifest', async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));

  const candidate = await readArtifactManifest(fixture.manifestPath, {
    expectedProfile: releaseManifestFormat,
  });

  assert.deepEqual(candidate.artifacts.map(({name}) => name), releasePackageNames);
  assert.ok(candidate.artifacts.every(({absolutePath}) => path.isAbsolute(absolutePath)));
});

test('rejects a candidate tarball changed after the manifest was written', async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));
  await writeFile(fixture.files[0], 'mutated candidate bytes');

  await assert.rejects(
    readArtifactManifest(fixture.manifestPath, {expectedProfile: releaseManifestFormat}),
    /size|integrity/i,
  );
});

test('rejects artifact paths that escape the manifest directory', async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
  manifest.artifacts[0].file = '../outside.tgz';
  await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(readArtifactManifest(fixture.manifestPath), /tarballs|escapes its manifest directory/i);
});

test('rejects incomplete GitHub Actions workflow identity in a candidate manifest', async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
  manifest.build.workflow = {
    provider: 'github-actions',
    repository: 'mrsteamedbun/WebMusic',
    workflowRef: 'mrsteamedbun/WebMusic/.github/workflows/release.yml@refs/tags/v0.1.0',
    runId: null,
    runAttempt: '1',
  };
  await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(readArtifactManifest(fixture.manifestPath), /workflow runId is required/i);
});

test('uses a private read-only snapshot after validating caller-controlled tarballs', async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));
  const suppliedCandidate = await readArtifactManifest(fixture.manifestPath, {
    expectedProfile: releaseManifestFormat,
  });
  const snapshot = await createValidatedArtifactSnapshot(suppliedCandidate);
  context.after(() => snapshot.cleanup());

  assert.notEqual(snapshot.candidate.artifacts[0].absolutePath, suppliedCandidate.artifacts[0].absolutePath);
  const snapshotRealDirectory = await realpath(snapshot.directory);
  assert.ok(snapshot.candidate.artifacts.every(({absolutePath}) => absolutePath.startsWith(snapshotRealDirectory)));
  if (process.platform !== 'win32') {
    assert.equal((await stat(snapshot.directory)).mode & 0o222, 0);
    assert.ok(
      (await Promise.all(snapshot.candidate.artifacts.map(({absolutePath}) => stat(absolutePath))))
        .every(({mode}) => (mode & 0o222) === 0),
    );
  }

  await writeFile(fixture.files[0], 'replacement bytes after snapshot validation');
  const reread = await readArtifactManifest(snapshot.candidate.manifestPath, {
    expectedProfile: releaseManifestFormat,
  });
  assert.equal(reread.artifacts[0].integrity, snapshot.candidate.artifacts[0].integrity);
});

test('rejects a tarball replaced between initial validation and snapshotting', async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));
  const suppliedCandidate = await readArtifactManifest(fixture.manifestPath, {
    expectedProfile: releaseManifestFormat,
  });
  await writeFile(fixture.files[0], 'replacement bytes before snapshot creation');

  await assert.rejects(createValidatedArtifactSnapshot(suppliedCandidate), /size|integrity/i);
});

test('constructs exact-tarball npm publish arguments with a non-default tag', () => {
  const tarball = path.join('/candidate', 'webmusic-kernel-0.1.0.tgz');
  const arguments_ = npmPublishArguments(tarball, {dryRun: true, version: '0.1.0'});

  assert.equal(arguments_[0], 'publish');
  assert.equal(arguments_[1], tarball);
  assert.equal(arguments_[arguments_.indexOf('--tag') + 1], releaseUploadDistTag('0.1.0'));
  assert.equal(releaseUploadDistTag('0.1.0'), 'webmusic-staging-v0.1.0');
  assert.equal(releaseDistTag, 'staging');
  assert.notEqual(releaseUploadDistTag('0.1.0'), releaseDistTag);
  assert.ok(arguments_.includes('--dry-run'));
  assert.ok(!arguments_.includes('--workspace'));
  assert.ok(!arguments_.includes('latest'));
});

test('rejects stale releases and concurrent shared dist-tag changes', () => {
  const artifact = {name: '@webscore/core', version: '1.2.3'};
  assert.throws(
    () => assertReleaseTagSelectionDoesNotMoveBackward(artifact, releaseDistTag, '1.2.4'),
    /refusing to move it backward/i,
  );
  assert.doesNotThrow(() =>
    assertDistTagSnapshotUnchanged(
      artifact,
      {[releaseDistTag]: '1.2.2', latest: '1.2.2'},
      {[releaseDistTag]: '1.2.2', latest: '1.2.2'},
    ),
  );
  assert.throws(
    () =>
      assertDistTagSnapshotUnchanged(
        artifact,
        {[releaseDistTag]: '1.2.2', latest: '1.2.2'},
        {[releaseDistTag]: '1.2.4', latest: '1.2.2'},
      ),
    /changed concurrently/i,
  );
  assert.equal(
    releaseTagMutationState(
      artifact,
      {[releaseDistTag]: '1.2.2', latest: '1.2.2'},
      {[releaseDistTag]: '1.2.3', latest: '1.2.2'},
    ),
    'applied',
  );
  assert.throws(
    () =>
      releaseTagMutationState(
        artifact,
        {[releaseDistTag]: '1.2.2', latest: '1.2.2'},
        {[releaseDistTag]: '1.2.4', latest: '1.2.2'},
      ),
    /changed concurrently/i,
  );
});

test('keeps release version validation stable-only', () => {
  assert.equal(sharedStableVersion([{value: {version: '1.2.3'}}, {value: {version: '1.2.3'}}]), '1.2.3');
  assert.throws(
    () => sharedStableVersion([{value: {version: '1.2.3-rc.1'}}]),
    /stable x\.y\.z version/i,
  );
  assert.throws(
    () => sharedStableVersion([{value: {version: '01.2.3'}}]),
    /stable x\.y\.z version/i,
  );
});

test('compares stable release lines without numeric precision loss', () => {
  assert.equal(compareStableVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareStableVersions('1.10.0', '1.2.99'), 1);
  assert.equal(compareStableVersions('999999999999999999999.0.0', '2.0.0'), 1);
  assert.equal(compareStableVersions('1.2.3-rc.1', '1.2.3'), undefined);
});

test('publish command refuses to run without an artifact manifest', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [path.join(root, 'scripts', 'publish-workspaces.mjs'), '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
    }),
    (error) => /--manifest <artifact-manifest\.json>/.test(error.stderr),
  );
});

test('promotion command refuses to run without an archived artifact manifest', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [path.join(root, 'scripts', 'promote-workspaces.mjs'), '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
    }),
    (error) => /--manifest <artifact-manifest\.json>/.test(error.stderr),
  );
});

test('external install requires a finite positive npm install timeout', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [path.join(root, 'scripts', 'check-external-install.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, WEBMUSIC_EXTERNAL_INSTALL_TIMEOUT_MS: '0'},
    }),
    (error) => /must be a positive integer/.test(error.stderr),
  );
});

test('release mutation commands require a finite positive npm timeout', async () => {
  for (const script of ['publish-workspaces.mjs', 'promote-workspaces.mjs']) {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(root, 'scripts', script), '--manifest', 'missing.json', '--dry-run'],
        {
          cwd: root,
          encoding: 'utf8',
          env: {...process.env, WEBSCORE_RELEASE_NPM_TIMEOUT_MS: '0'},
        },
      ),
      (error) => /WEBSCORE_RELEASE_NPM_TIMEOUT_MS must be a positive safe integer/.test(error.stderr),
    );
  }
});

test(
  'release publish and promotion terminate npm subprocesses at the configured timeout',
  {skip: process.platform === 'win32'},
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.directory, {recursive: true, force: true}));
    const bin = path.join(fixture.directory, 'timeout-bin');
    await mkdir(bin);

    const fakeGit = path.join(bin, 'git');
    await writeFile(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "if (process.argv[2] === 'rev-parse') console.log('a'.repeat(40));",
        "else if (process.argv[2] !== 'status') process.exitCode = 2;",
        '',
      ].join('\n'),
    );
    await chmod(fakeGit, 0o755);

    const fakeNpm = path.join(bin, 'npm');
    await writeFile(
      fakeNpm,
      ['#!/usr/bin/env node', 'setInterval(() => {}, 1_000);', ''].join('\n'),
    );
    await chmod(fakeNpm, 0o755);

    const environment = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      WEBSCORE_RELEASE_NPM_TIMEOUT_MS: '100',
    };
    for (const script of ['publish-workspaces.mjs', 'promote-workspaces.mjs']) {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [
            path.join(root, 'scripts', script),
            '--manifest',
            fixture.manifestPath,
            '--dry-run',
          ],
          {cwd: root, encoding: 'utf8', env: environment},
        ),
        (error) => /npm .* exceeded 100 ms/.test(error.stderr),
      );
    }
  },
);

test(
  'official publication accepts a later attempt of the same run but rejects an earlier attempt',
  {skip: process.platform === 'win32'},
  async (context) => {
    const laterAttempt = await createOfficialPublishHarness(context, {
      candidateRunAttempt: '1',
      currentRunAttempt: '2',
      failStagingName: '@webscore/core',
    });
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          path.join(root, 'scripts', 'publish-workspaces.mjs'),
          '--manifest',
          laterAttempt.fixture.manifestPath,
        ],
        {cwd: root, encoding: 'utf8', env: laterAttempt.environment},
      ),
      (error) => /bounded compensation completed.*preflight snapshot/s.test(error.stderr),
    );
    const acceptedState = JSON.parse(await readFile(laterAttempt.npmState, 'utf8'));
    assert.equal(acceptedState.failed, true);

    const earlierAttempt = await createOfficialPublishHarness(context, {
      candidateRunAttempt: '2',
      currentRunAttempt: '1',
    });
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          path.join(root, 'scripts', 'publish-workspaces.mjs'),
          '--manifest',
          earlierAttempt.fixture.manifestPath,
        ],
        {cwd: root, encoding: 'utf8', env: earlierAttempt.environment},
      ),
      (error) => /current workflow attempt 1 predates candidate attempt 2/i.test(error.stderr),
    );
    const rejectedState = JSON.parse(await readFile(earlierAttempt.npmState, 'utf8'));
    assert.equal(rejectedState.candidateAdds, 0);
  },
);

test(
  'real publish stops before mutation when a shared dist-tag changes after the all-package preflight',
  {skip: process.platform === 'win32'},
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.directory, {recursive: true, force: true}));
    const bin = path.join(fixture.directory, 'bin');
    const npmLog = path.join(fixture.directory, 'npm-calls.jsonl');
    const npmState = path.join(fixture.directory, 'npm-state.json');
    await mkdir(bin);

    const fakeGit = path.join(bin, 'git');
    await writeFile(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "if (process.argv[2] === 'rev-parse') console.log('a'.repeat(40));",
        "else if (process.argv[2] !== 'status') process.exitCode = 2;",
        '',
      ].join('\n'),
    );
    await chmod(fakeGit, 0o755);

    const fakeNpm = path.join(bin, 'npm');
    await writeFile(
      fakeNpm,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "fs.appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify(args)}\\n`);",
        "if (args[0] !== 'view') process.exit(90);",
        'const [name, field] = args.slice(1);',
        "if (field === 'dist.integrity') {",
        '  const integrities = JSON.parse(process.env.FAKE_NPM_INTEGRITIES);',
        '  process.stdout.write(JSON.stringify(integrities[name]));',
        '  process.exit(0);',
        '}',
        "if (field === 'dist-tags.latest') {",
        "  process.stdout.write(JSON.stringify('0.0.9'));",
        '  process.exit(0);',
        '}',
        'const state = fs.existsSync(process.env.FAKE_NPM_STATE)',
        "  ? JSON.parse(fs.readFileSync(process.env.FAKE_NPM_STATE, 'utf8'))",
        '  : {};',
        'const key = `${name}:${field}`;',
        'state[key] = (state[key] ?? 0) + 1;',
        "fs.writeFileSync(process.env.FAKE_NPM_STATE, JSON.stringify(state));",
        "if (field === 'dist-tags.staging') {",
        "  const selected = name === '@webscore/core' && state[key] > 1 ? '0.2.0' : '0.0.9';",
        '  process.stdout.write(JSON.stringify(selected));',
        '  process.exit(0);',
        '}',
        'process.exit(91);',
        '',
      ].join('\n'),
    );
    await chmod(fakeNpm, 0o755);

    const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
    const workflowRef = 'mrsteamedbun/WebMusic/.github/workflows/release.yml@refs/tags/v0.1.0';
    manifest.build.workflow = {
      provider: 'github-actions',
      repository: 'mrsteamedbun/WebMusic',
      workflowRef,
      runId: '12345',
      runAttempt: '1',
    };
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const integrities = Object.fromEntries(
      manifest.artifacts.map((artifact) => [`${artifact.name}@${artifact.version}`, artifact.integrity]),
    );
    const environment = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REPOSITORY: 'mrsteamedbun/WebMusic',
      GITHUB_REF_PROTECTED: 'true',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v0.1.0',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_WORKFLOW_REF: workflowRef,
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '1',
      FAKE_NPM_LOG: npmLog,
      FAKE_NPM_STATE: npmState,
      FAKE_NPM_INTEGRITIES: JSON.stringify(integrities),
    };

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(root, 'scripts', 'publish-workspaces.mjs'), '--manifest', fixture.manifestPath],
        {cwd: root, encoding: 'utf8', env: environment},
      ),
      (error) => /changed concurrently/.test(error.stderr),
    );
    const calls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(([command]) => command === 'view'));
    assert.ok(calls.every(([command]) => command !== 'publish' && command !== 'dist-tag'));
  },
);

test(
  'an upload failure never exposes a partial graph through shared staging',
  {skip: process.platform === 'win32'},
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.directory, {recursive: true, force: true}));
    const bin = path.join(fixture.directory, 'upload-bin');
    const npmLog = path.join(fixture.directory, 'upload-npm-calls.jsonl');
    const npmState = path.join(fixture.directory, 'upload-npm-state.json');
    await mkdir(bin);
    await writeFile(npmState, JSON.stringify({publishAttempts: 0, integrities: {}}));

    const fakeGit = path.join(bin, 'git');
    await writeFile(
      fakeGit,
      [
        '#!/usr/bin/env node',
        "if (process.argv[2] === 'rev-parse') console.log('a'.repeat(40));",
        "else if (process.argv[2] !== 'status') process.exitCode = 2;",
        '',
      ].join('\n'),
    );
    await chmod(fakeGit, 0o755);

    const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
    const workflowRef = 'mrsteamedbun/WebMusic/.github/workflows/release.yml@refs/tags/v0.1.0';
    manifest.build.workflow = {
      provider: 'github-actions',
      repository: 'mrsteamedbun/WebMusic',
      workflowRef,
      runId: '9876',
      runAttempt: '1',
    };
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const fakeNpm = path.join(bin, 'npm');
    await writeFile(
      fakeNpm,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "fs.appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify(args)}\\n`);",
        "const state = JSON.parse(fs.readFileSync(process.env.FAKE_NPM_STATE, 'utf8'));",
        "const save = () => {",
        "  const temporary = `${process.env.FAKE_NPM_STATE}.${process.pid}.tmp`;",
        "  fs.writeFileSync(temporary, JSON.stringify(state));",
        "  fs.renameSync(temporary, process.env.FAKE_NPM_STATE);",
        "};",
        "if (args[0] === 'view') {",
        '  const [spec, field] = args.slice(1);',
        "  if (field === 'dist.integrity') {",
        '    process.stdout.write(JSON.stringify(state.integrities[spec] ?? null));',
        '    process.exit(0);',
        '  }',
        "  if (field === 'dist-tags.staging' || field === 'dist-tags.latest') {",
        "    process.stdout.write(JSON.stringify('0.0.9'));",
        '    process.exit(0);',
        '  }',
        '}',
        "if (args[0] === 'publish') {",
        '  state.publishAttempts += 1;',
        '  if (state.publishAttempts === 4) { save(); process.exit(90); }',
        '  const artifact = JSON.parse(process.env.FAKE_NPM_ARTIFACTS)[state.publishAttempts - 1];',
        '  state.integrities[`${artifact.name}@${artifact.version}`] = artifact.integrity;',
        '  save();',
        '  process.exit(0);',
        '}',
        "if (args[0] === 'dist-tag') process.exit(91);",
        'process.exit(92);',
        '',
      ].join('\n'),
    );
    await chmod(fakeNpm, 0o755);

    const environment = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REPOSITORY: 'mrsteamedbun/WebMusic',
      GITHUB_REF_PROTECTED: 'true',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v0.1.0',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_WORKFLOW_REF: workflowRef,
      GITHUB_RUN_ID: '9876',
      GITHUB_RUN_ATTEMPT: '1',
      FAKE_NPM_LOG: npmLog,
      FAKE_NPM_STATE: npmState,
      FAKE_NPM_ARTIFACTS: JSON.stringify(manifest.artifacts),
    };

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(root, 'scripts', 'publish-workspaces.mjs'), '--manifest', fixture.manifestPath],
        {cwd: root, encoding: 'utf8', env: environment},
      ),
    );
    const calls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(([command]) => command === 'publish').length, 4);
    assert.equal(calls.filter(([command]) => command === 'dist-tag').length, 0);
  },
);

test(
  'an Nth staging mutation failure rolls back every earlier owned mutation in reverse order',
  {skip: process.platform === 'win32'},
  async (context) => {
    const harness = await createOfficialPublishHarness(context, {
      failStagingName: '@webscore/play',
      unsetStagingName: '@webscore/core',
    });

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(root, 'scripts', 'publish-workspaces.mjs'), '--manifest', harness.fixture.manifestPath],
        {cwd: root, encoding: 'utf8', env: harness.environment},
      ),
      (error) => /bounded compensation completed.*preflight snapshot/s.test(error.stderr),
    );

    const finalState = JSON.parse(await readFile(harness.npmState, 'utf8'));
    assert.equal(finalState.tags['@webscore/core'].staging, undefined);
    for (const name of releasePackageNames.filter((name) => name !== '@webscore/core')) {
      assert.equal(finalState.tags[name].staging, '0.0.9');
    }
    assert.ok(Object.values(finalState.tags).every(({latest}) => latest === '0.0.9'));

    const calls = (await readFile(harness.npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      calls.filter(([command]) => command === 'dist-tag'),
      [
        ['dist-tag', 'add', '@webmusic/kernel@0.1.0', 'staging'],
        ['dist-tag', 'add', '@webscore/core@0.1.0', 'staging'],
        ['dist-tag', 'add', '@webscore/io@0.1.0', 'staging'],
        ['dist-tag', 'add', '@webscore/play@0.1.0', 'staging'],
        ['dist-tag', 'add', '@webscore/play@0.0.9', 'staging'],
        ['dist-tag', 'add', '@webscore/io@0.0.9', 'staging'],
        ['dist-tag', 'rm', '@webscore/core', 'staging'],
        ['dist-tag', 'add', '@webmusic/kernel@0.0.9', 'staging'],
      ],
    );
  },
);

test(
  'final staging verification detects an external rewrite without overwriting it during rollback',
  {skip: process.platform === 'win32'},
  async (context) => {
    const harness = await createOfficialPublishHarness(context, {rewriteCoreAfterAll: true});

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(root, 'scripts', 'publish-workspaces.mjs'), '--manifest', harness.fixture.manifestPath],
        {cwd: root, encoding: 'utf8', env: harness.environment},
      ),
      (error) => /automatic rollback was incomplete/.test(error.stderr),
    );

    const finalState = JSON.parse(await readFile(harness.npmState, 'utf8'));
    assert.equal(finalState.tags['@webscore/core'].staging, '0.2.0');
    for (const name of releasePackageNames.filter((name) => name !== '@webscore/core')) {
      assert.equal(finalState.tags[name].staging, '0.0.9');
    }
    assert.ok(Object.values(finalState.tags).every(({latest}) => latest === '0.0.9'));

    const calls = (await readFile(harness.npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    const stagingAdds = calls.filter(
      ([command, operation, , tag]) => command === 'dist-tag' && operation === 'add' && tag === 'staging',
    );
    assert.deepEqual(
      stagingAdds.slice(0, releasePackageNames.length).map(([, , spec]) => spec),
      releasePackageNames.map((name) => `${name}@0.1.0`),
    );
    assert.deepEqual(
      stagingAdds.slice(releasePackageNames.length).map(([, , spec]) => spec),
      releasePackageNames
        .filter((name) => name !== '@webscore/core')
        .reverse()
        .map((name) => `${name}@0.0.9`),
    );
    assert.ok(!stagingAdds.some(([, , spec]) => spec === '@webscore/core@0.0.9'));
  },
);

test(
  'staging rollback compensates an intent whose failed write becomes visible after the predecessor',
  {skip: process.platform === 'win32'},
  async (context) => {
    const harness = await createOfficialPublishHarness(context, {
      failStagingName: '@webscore/play',
      delayedCommitFailure: true,
    });

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(root, 'scripts', 'publish-workspaces.mjs'), '--manifest', harness.fixture.manifestPath],
        {cwd: root, encoding: 'utf8', env: harness.environment},
      ),
      (error) => /bounded compensation completed.*preflight snapshot/s.test(error.stderr),
    );

    const finalState = JSON.parse(await readFile(harness.npmState, 'utf8'));
    assert.equal(finalState.pendingMutation, undefined);
    assert.ok(Object.values(finalState.tags).every(({staging}) => staging === '0.0.9'));
    assert.ok(Object.values(finalState.tags).every(({latest}) => latest === '0.0.9'));

    const calls = (await readFile(harness.npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(
      calls.filter(
        (args) => args.join(' ') === 'dist-tag add @webscore/play@0.0.9 staging',
      ).length >= 2,
    );
  },
);

test(
  'latest promotion persists rollback and completion evidence and restores unset latest',
  {skip: process.platform === 'win32'},
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.directory, {recursive: true, force: true}));
    const bin = path.join(fixture.directory, 'promote-bin');
    const npmLog = path.join(fixture.directory, 'promote-npm-calls.jsonl');
    const npmState = path.join(fixture.directory, 'promote-npm-state.json');
    await mkdir(bin);

    const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
    manifest.build.workflow = {
      provider: 'github-actions',
      repository: 'mrsteamedbun/WebMusic',
      workflowRef: 'mrsteamedbun/WebMusic/.github/workflows/release.yml@refs/tags/v0.1.0',
      runId: '12345',
      runAttempt: '1',
    };
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const integrities = Object.fromEntries(
      manifest.artifacts.map((artifact) => [`${artifact.name}@${artifact.version}`, artifact.integrity]),
    );
    const startingTags = () =>
      Object.fromEntries(
        releasePackageNames.map((name) => [
          name,
          name === '@webscore/core' ? {staging: '0.1.0'} : {staging: '0.1.0', latest: '0.0.9'},
        ]),
      );
    const initialState = {
      failed: false,
      failLatest: true,
      tags: startingTags(),
    };
    await writeFile(npmState, JSON.stringify(initialState));

    const fakeNpm = path.join(bin, 'npm');
    await writeFile(
      fakeNpm,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "fs.appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify(args)}\\n`);",
        "const state = JSON.parse(fs.readFileSync(process.env.FAKE_NPM_STATE, 'utf8'));",
        "const save = () => {",
        "  const temporary = `${process.env.FAKE_NPM_STATE}.${process.pid}.tmp`;",
        "  fs.writeFileSync(temporary, JSON.stringify(state));",
        "  fs.renameSync(temporary, process.env.FAKE_NPM_STATE);",
        "};",
        "if (args[0] === 'view') {",
        '  const [spec, field] = args.slice(1);',
        "  if (field === 'dist.integrity') {",
        '    process.stdout.write(JSON.stringify(JSON.parse(process.env.FAKE_NPM_INTEGRITIES)[spec]));',
        '    process.exit(0);',
        '  }',
      "  if (field.startsWith('dist-tags.')) {",
      "    const tag = field.slice('dist-tags.'.length);",
      '    if (',
      '      state.pendingMutation &&',
      '      state.pendingMutation.name === spec &&',
      '      state.pendingMutation.tag === tag &&',
      '      !state.pendingMutation.revealed',
      '    ) {',
      '      if (state.pendingMutation.readsBeforeReveal > 0) {',
      '        state.pendingMutation.readsBeforeReveal -= 1;',
      '      } else {',
      '        state.tags[spec][tag] = state.pendingMutation.version;',
      '        state.pendingMutation.revealed = true;',
      '      }',
      '      save();',
      '    }',
      '    process.stdout.write(JSON.stringify(state.tags[spec][tag] ?? null));',
        '    process.exit(0);',
        '  }',
        '}',
        "if (args[0] === 'dist-tag' && args[1] === 'add') {",
        '  const spec = args[2];',
        "  const split = spec.lastIndexOf('@');",
        '  const name = spec.slice(0, split);',
        '  const version = spec.slice(split + 1);',
        '  const tag = args[3];',
        '  if (',
        "    tag.startsWith('webmusic-latest-complete-') &&",
        '    name === state.failCompletionName &&',
        '    !state.completionFailed',
        '  ) {',
        '    state.completionFailed = true;',
        '    if (state.delayedCompletionFailure) {',
        '      state.pendingMutation = {',
        '        name,',
        '        tag,',
        '        version,',
        '        readsBeforeReveal: state.completionReadsBeforeReveal ?? 2,',
        '        revealed: false,',
        '      };',
        '    }',
        '    save();',
        '    process.exit(88);',
        '  }',
        '  if (',
        "    (tag.startsWith('webmusic-latest-before-') ||",
        "      tag.startsWith('webmusic-latest-unset-')) &&",
        '    name === state.failMarkerName &&',
        '    !state.markerFailed',
        '  ) {',
        '    state.markerFailed = true;',
        '    save();',
        '    process.exit(89);',
        '  }',
      "  if (name === '@webscore/play' && version === '0.1.0' && tag === 'latest' && state.failLatest !== false && !state.failed) {",
      '    state.failed = true;',
      '    if (state.delayedCommitFailure) {',
      '      state.pendingMutation = {',
      '        name,',
      '        tag,',
      '        version,',
      '        readsBeforeReveal: 2,',
      '        revealed: false,',
      '      };',
      '    }',
      '    save();',
      '    process.exit(90);',
      '  }',
      '  if (',
      '    state.pendingMutation &&',
      '    state.pendingMutation.name === name &&',
      '    state.pendingMutation.tag === tag &&',
      '    state.pendingMutation.version === version &&',
      '    !state.pendingMutation.revealed',
      '  ) {',
      '    save();',
      '    process.exit(0);',
      '  }',
      '  if (',
      '    state.pendingMutation &&',
      '    state.pendingMutation.name === name &&',
      '    state.pendingMutation.tag === tag &&',
      '    state.pendingMutation.revealed',
      '  ) {',
      '    delete state.pendingMutation;',
      '  }',
      '  state.tags[name][tag] = version;',
        '  save();',
        '  process.exit(0);',
        '}',
      "if (args[0] === 'dist-tag' && args[1] === 'rm') {",
      '  if (',
      '    state.pendingMutation &&',
      '    state.pendingMutation.name === args[2] &&',
      '    state.pendingMutation.tag === args[3] &&',
      '    state.pendingMutation.revealed',
      '  ) {',
      '    delete state.pendingMutation;',
      '  }',
      '  delete state.tags[args[2]][args[3]];',
        '  save();',
        '  process.exit(0);',
        '}',
        'process.exit(91);',
        '',
      ].join('\n'),
    );
    await chmod(fakeNpm, 0o755);

    const environment = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: 'mrsteamedbun/WebMusic',
      GITHUB_REF_TYPE: 'branch',
      GITHUB_REF_NAME: 'main',
      GITHUB_REF_PROTECTED: 'true',
      GITHUB_WORKFLOW_REF: 'mrsteamedbun/WebMusic/.github/workflows/promote-release.yml@refs/heads/main',
      FAKE_NPM_LOG: npmLog,
      FAKE_NPM_STATE: npmState,
      FAKE_NPM_INTEGRITIES: JSON.stringify(integrities),
      WEBSCORE_RELEASE_TAG_RECONCILE_DELAY_MS: '1',
    };
    const promotionArguments = [
      path.join(root, 'scripts', 'promote-workspaces.mjs'),
      '--manifest',
      fixture.manifestPath,
      '--release-run-id',
      '12345',
    ];

    await assert.rejects(
      execFileAsync(process.execPath, promotionArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /bounded compensation completed.*preflight snapshot/s.test(error.stderr),
    );

    const finalState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.equal(finalState.tags['@webscore/core'].latest, undefined);
    assert.ok(
      releasePackageNames
        .filter((name) => name !== '@webscore/core')
        .every((name) => finalState.tags[name].latest === '0.0.9'),
    );
    const calls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    const firstLatestMutation = calls.findIndex(
      (args) => args[0] === 'dist-tag' && (args[1] === 'add' || args[1] === 'rm') && args[3] === 'latest',
    );
    assert.notEqual(firstLatestMutation, -1);
    const callsBeforeLatest = calls.slice(0, firstLatestMutation).map((args) => args.join(' '));
    assert.ok(
      callsBeforeLatest.includes(
        'dist-tag add @webscore/core@0.1.0 webmusic-latest-unset-before-v0.1.0',
      ),
    );
    for (const name of releasePackageNames.filter((name) => name !== '@webscore/core')) {
      assert.ok(
        callsBeforeLatest.includes(
          `dist-tag add ${name}@0.0.9 webmusic-latest-before-v0.1.0`,
        ),
      );
    }
    assert.ok(calls.some((args) => args.join(' ') === 'dist-tag add @webscore/core@0.1.0 latest'));
    assert.ok(calls.some((args) => args.join(' ') === 'dist-tag rm @webscore/core latest'));
    assert.equal(
      finalState.tags['@webscore/core']['webmusic-latest-unset-before-v0.1.0'],
      '0.1.0',
    );
    assert.ok(
      releasePackageNames
        .filter((name) => name !== '@webscore/core')
        .every(
          (name) =>
            finalState.tags[name]['webmusic-latest-before-v0.1.0'] === '0.0.9',
        ),
    );

    const delayedCommitState = {
      failed: false,
      failLatest: true,
      delayedCommitFailure: true,
      tags: startingTags(),
    };
    await writeFile(npmState, JSON.stringify(delayedCommitState));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, promotionArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /bounded compensation completed.*preflight snapshot/s.test(error.stderr),
    );
    const delayedFinalState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.equal(delayedFinalState.pendingMutation, undefined);
    assert.equal(delayedFinalState.tags['@webscore/core'].latest, undefined);
    assert.ok(
      releasePackageNames
        .filter((name) => name !== '@webscore/core')
        .every((name) => delayedFinalState.tags[name].latest === '0.0.9'),
    );
    const delayedCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(
      delayedCalls.filter(
        (args) => args.join(' ') === 'dist-tag add @webscore/play@0.0.9 latest',
      ).length >= 2,
    );

    const partialMarkerState = {
      failLatest: false,
      failMarkerName: '@webscore/play',
      markerFailed: false,
      tags: startingTags(),
    };
    await writeFile(npmState, JSON.stringify(partialMarkerState));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, promotionArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
    );
    const partialState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.equal(partialState.tags['@webscore/core'].latest, undefined);
    assert.ok(
      releasePackageNames
        .filter((name) => name !== '@webscore/core')
        .every((name) => partialState.tags[name].latest === '0.0.9'),
    );
    const partialCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(
      partialCalls.some(
        (args) =>
          args.join(' ') ===
          'dist-tag add @webscore/io@0.0.9 webmusic-latest-before-v0.1.0',
      ),
    );
    assert.ok(
      partialCalls.every(
        (args) => args[0] !== 'dist-tag' || args[3] !== 'latest',
      ),
    );

    const successfulState = {
      failLatest: false,
      failCompletionName: '@webscore/play',
      delayedCompletionFailure: true,
      completionReadsBeforeReveal: 2,
      tags: startingTags(),
    };
    await writeFile(npmState, JSON.stringify(successfulState));
    await writeFile(npmLog, '');
    const successfulPromotion = await execFileAsync(process.execPath, promotionArguments, {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    });
    assert.match(successfulPromotion.stdout, /Promoted all WebMusic packages/);
    const promotedState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.equal(promotedState.completionFailed, true);
    assert.ok(Object.values(promotedState.tags).every(({latest}) => latest === '0.1.0'));
    assert.equal(
      promotedState.tags['@webscore/core']['webmusic-latest-unset-before-v0.1.0'],
      '0.1.0',
    );
    for (const name of releasePackageNames.filter((name) => name !== '@webscore/core')) {
      assert.equal(promotedState.tags[name]['webmusic-latest-before-v0.1.0'], '0.0.9');
    }
    for (const name of releasePackageNames) {
      assert.equal(promotedState.tags[name]['webmusic-latest-complete-v0.1.0'], '0.1.0');
    }
    const successfulCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(
      successfulCalls.filter(
        (args) =>
          args.join(' ') ===
          'dist-tag add @webscore/play@0.1.0 webmusic-latest-complete-v0.1.0',
      ).length >= 2,
    );

    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, promotionArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /already has complete durable evidence.*same-version promote rerun/s.test(error.stderr),
    );
    const rerunCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(rerunCalls.every(([command]) => command !== 'dist-tag'));

    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, [...promotionArguments, '--recover'], {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /is durably complete.*must not roll latest back/s.test(error.stderr),
    );
    const completedRecoveryCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(completedRecoveryCalls.every(([command]) => command !== 'dist-tag'));

    const ambiguousCompletionState = {
      failLatest: false,
      failCompletionName: '@webscore/play',
      delayedCompletionFailure: true,
      completionReadsBeforeReveal: 100,
      tags: startingTags(),
    };
    await writeFile(npmState, JSON.stringify(ambiguousCompletionState));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, promotionArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /durable completion evidence is incomplete or ambiguous/s.test(error.stderr),
    );
    const ambiguousState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.ok(Object.values(ambiguousState.tags).every(({latest}) => latest === '0.1.0'));
    assert.equal(
      ambiguousState.tags['@webscore/core']['webmusic-latest-complete-v0.1.0'],
      '0.1.0',
    );
    assert.equal(
      ambiguousState.tags['@webscore/play']['webmusic-latest-complete-v0.1.0'],
      undefined,
    );

    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, [...promotionArguments, '--recover'], {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /partial or invalid durable completion evidence.*fail closed/s.test(error.stderr),
    );
    const ambiguousRecoveryCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(ambiguousRecoveryCalls.every(([command]) => command !== 'dist-tag'));
  },
);

test(
  'promotion recovery restores mixed latest values from retained markers and fails closed',
  {skip: process.platform === 'win32'},
  async (context) => {
    const fixture = await createFixture();
    context.after(() => rm(fixture.directory, {recursive: true, force: true}));
    const bin = path.join(fixture.directory, 'recover-bin');
    const npmLog = path.join(fixture.directory, 'recover-npm-calls.jsonl');
    const npmState = path.join(fixture.directory, 'recover-npm-state.json');
    await mkdir(bin);

    const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
    manifest.build.workflow = {
      provider: 'github-actions',
      repository: 'mrsteamedbun/WebMusic',
      workflowRef: 'mrsteamedbun/WebMusic/.github/workflows/release.yml@refs/tags/v0.1.0',
      runId: '12345',
      runAttempt: '1',
    };
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const integrities = Object.fromEntries(
      manifest.artifacts.map((artifact) => [`${artifact.name}@${artifact.version}`, artifact.integrity]),
    );
    const interruptedState = {
      tags: Object.fromEntries(
        releasePackageNames.map((name, index) => [
          name,
          name === '@webscore/core'
            ? {
                staging: '0.2.0',
                latest: '0.1.0',
                'webmusic-latest-unset-before-v0.1.0': '0.1.0',
              }
            : {
                staging: '0.1.0',
                latest: index < 3 ? '0.1.0' : '0.0.9',
                'webmusic-latest-before-v0.1.0': '0.0.9',
              },
        ]),
      ),
    };
    await writeFile(npmState, JSON.stringify(interruptedState));

    const fakeNpm = path.join(bin, 'npm');
    await writeFile(
      fakeNpm,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "fs.appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify(args)}\\n`);",
        "const state = JSON.parse(fs.readFileSync(process.env.FAKE_NPM_STATE, 'utf8'));",
        "const save = () => {",
        "  const temporary = `${process.env.FAKE_NPM_STATE}.${process.pid}.tmp`;",
        "  fs.writeFileSync(temporary, JSON.stringify(state));",
        "  fs.renameSync(temporary, process.env.FAKE_NPM_STATE);",
        "};",
        "if (args[0] === 'view') {",
        '  const [spec, field] = args.slice(1);',
        "  if (field === 'dist.integrity') {",
        '    process.stdout.write(JSON.stringify(JSON.parse(process.env.FAKE_NPM_INTEGRITIES)[spec]));',
        '    process.exit(0);',
        '  }',
        "  if (field.startsWith('dist-tags.')) {",
        "    const tag = field.slice('dist-tags.'.length);",
        '    if (',
        '      state.pendingMutation &&',
        '      state.pendingMutation.name === spec &&',
        '      state.pendingMutation.tag === tag &&',
        '      !state.pendingMutation.revealed',
        '    ) {',
        '      if (state.pendingMutation.readsBeforeReveal > 0) {',
        '        state.pendingMutation.readsBeforeReveal -= 1;',
        '      } else {',
        '        state.tags[spec][tag] = state.pendingMutation.version;',
        '        state.pendingMutation.revealed = true;',
        '      }',
        '      save();',
        '    }',
        '    process.stdout.write(JSON.stringify(state.tags[spec][tag] ?? null));',
        '    process.exit(0);',
        '  }',
        '}',
        "if (args[0] === 'dist-tag' && args[1] === 'add') {",
        '  const spec = args[2];',
        "  const split = spec.lastIndexOf('@');",
        '  const name = spec.slice(0, split);',
        '  const version = spec.slice(split + 1);',
        '  if (',
        '    state.pendingMutation &&',
        '    state.pendingMutation.name === name &&',
        '    state.pendingMutation.tag === args[3] &&',
        '    state.pendingMutation.revealed',
        '  ) {',
        '    delete state.pendingMutation;',
        '  }',
        '  state.tags[name][args[3]] = version;',
        '  save();',
        '  process.exit(0);',
        '}',
        "if (args[0] === 'dist-tag' && args[1] === 'rm') {",
        '  if (',
        '    state.pendingMutation &&',
        '    state.pendingMutation.name === args[2] &&',
        '    state.pendingMutation.tag === args[3] &&',
        '    state.pendingMutation.revealed',
        '  ) {',
        '    delete state.pendingMutation;',
        '  }',
        '  delete state.tags[args[2]][args[3]];',
        '  save();',
        '  process.exit(0);',
        '}',
        'process.exit(91);',
        '',
      ].join('\n'),
    );
    await chmod(fakeNpm, 0o755);

    const environment = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: 'mrsteamedbun/WebMusic',
      GITHUB_REF_TYPE: 'branch',
      GITHUB_REF_NAME: 'main',
      GITHUB_REF_PROTECTED: 'true',
      GITHUB_WORKFLOW_REF: 'mrsteamedbun/WebMusic/.github/workflows/promote-release.yml@refs/heads/main',
      FAKE_NPM_LOG: npmLog,
      FAKE_NPM_STATE: npmState,
      FAKE_NPM_INTEGRITIES: JSON.stringify(integrities),
      WEBSCORE_RELEASE_TAG_RECONCILE_DELAY_MS: '1',
    };
    const recoveryArguments = [
      path.join(root, 'scripts', 'promote-workspaces.mjs'),
      '--manifest',
      fixture.manifestPath,
      '--release-run-id',
      '12345',
      '--recover',
    ];

    const recovery = await execFileAsync(process.execPath, recoveryArguments, {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    });
    assert.match(recovery.stdout, /Recovered all WebMusic packages/);

    const recoveredState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.equal(recoveredState.tags['@webscore/core'].latest, undefined);
    assert.equal(
      recoveredState.tags['@webscore/core']['webmusic-latest-unset-before-v0.1.0'],
      '0.1.0',
    );
    for (const name of releasePackageNames.filter((name) => name !== '@webscore/core')) {
      assert.equal(recoveredState.tags[name].latest, '0.0.9');
      assert.equal(recoveredState.tags[name]['webmusic-latest-before-v0.1.0'], '0.0.9');
    }
    const recoveryCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(
      recoveryCalls.every(
        ([command, , field]) => command !== 'view' || field !== 'dist-tags.staging',
      ),
    );
    assert.ok(
      recoveryCalls.some((args) => args.join(' ') === 'dist-tag rm @webscore/core latest'),
    );
    assert.ok(
      recoveryCalls.some((args) => args.join(' ') === 'dist-tag add @webscore/io@0.0.9 latest'),
    );
    assert.ok(
      recoveryCalls.every(
        (args) =>
          args[0] !== 'dist-tag' ||
          args[1] === 'rm' ||
          args[3] === 'latest',
      ),
    );

    const delayedCompletionEvidenceState = structuredClone(interruptedState);
    delayedCompletionEvidenceState.pendingMutation = {
      name: '@webscore/play',
      tag: 'webmusic-latest-complete-v0.1.0',
      version: '0.1.0',
      readsBeforeReveal: 3,
      revealed: false,
    };
    await writeFile(npmState, JSON.stringify(delayedCompletionEvidenceState));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, recoveryArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /partial or invalid durable completion evidence.*before recovery mutation/s.test(error.stderr),
    );
    const delayedCompletionCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(delayedCompletionCalls.every(([command]) => command !== 'dist-tag'));

    const completionAppearsAtFinalState = structuredClone(interruptedState);
    completionAppearsAtFinalState.pendingMutation = {
      name: '@webscore/play',
      tag: 'webmusic-latest-complete-v0.1.0',
      version: '0.1.0',
      readsBeforeReveal: 6,
      revealed: false,
    };
    await writeFile(npmState, JSON.stringify(completionAppearsAtFinalState));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, recoveryArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /partial or invalid durable completion evidence.*final recovery verification/s.test(error.stderr),
    );
    const finalCompletionCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(finalCompletionCalls.some(([command]) => command === 'dist-tag'));

    const delayedInterruptedState = structuredClone(interruptedState);
    delayedInterruptedState.tags['@webscore/play'].latest = '0.0.9';
    delayedInterruptedState.pendingMutation = {
      name: '@webscore/play',
      tag: 'latest',
      version: '0.1.0',
      readsBeforeReveal: 3,
      revealed: false,
    };
    await writeFile(npmState, JSON.stringify(delayedInterruptedState));
    await writeFile(npmLog, '');
    const delayedRecovery = await execFileAsync(process.execPath, recoveryArguments, {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    });
    assert.match(delayedRecovery.stdout, /Recovered all WebMusic packages/);
    const delayedRecoveredState = JSON.parse(await readFile(npmState, 'utf8'));
    assert.equal(delayedRecoveredState.pendingMutation, undefined);
    assert.equal(delayedRecoveredState.tags['@webscore/play'].latest, '0.0.9');
    const delayedRecoveryCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(
      delayedRecoveryCalls.filter(
        (args) => args.join(' ') === 'dist-tag add @webscore/play@0.0.9 latest',
      ).length >= 2,
    );

    const allCandidateWithoutCompletion = structuredClone(interruptedState);
    for (const tags of Object.values(allCandidateWithoutCompletion.tags)) tags.latest = '0.1.0';
    await writeFile(npmState, JSON.stringify(allCandidateWithoutCompletion));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, recoveryArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /markers do not prove an incomplete promotion.*recovery is forbidden/s.test(error.stderr),
    );
    const unprovenRecoveryCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(unprovenRecoveryCalls.every(([command]) => command !== 'dist-tag'));

    const externallyChangedState = structuredClone(interruptedState);
    externallyChangedState.tags['@webscore/view'].latest = '0.0.8';
    await writeFile(npmState, JSON.stringify(externallyChangedState));
    await writeFile(npmLog, '');
    await assert.rejects(
      execFileAsync(process.execPath, recoveryArguments, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      }),
      (error) => /recovery is failing closed/.test(error.stderr),
    );
    const failClosedCalls = (await readFile(npmLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(failClosedCalls.every(([command]) => command !== 'dist-tag'));
  },
);

test('release workflow isolates candidate execution from the credentialed publish job', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const buildCandidate = workflowJob(workflow, 'build_candidate');
  const externalTest = workflowJob(workflow, 'external_test');
  const rehearsal = workflowJob(workflow, 'rehearse_publish');
  const publish = workflowJob(workflow, 'publish');

  assert.equal(workflow.match(/\$\{\{ secrets\.NPM_TOKEN \}\}/g)?.length, 1);
  assert.equal(workflow.match(/id-token:\s*write/g)?.length, 1);
  assert.equal(workflow.match(/needs\.build_candidate\.outputs\.artifact_name/g)?.length, 3);
  assert.match(workflow, /group:\s*webmusic-npm-release/);
  assert.doesNotMatch(workflow, /webscore/i);

  assert.match(buildCandidate, /actions\/upload-artifact@[0-9a-f]{40}\s+# v7\.0\.1/);
  assert.match(buildCandidate, /artifact_name:\s*\$\{\{ steps\.artifact_identity\.outputs\.name \}\}/);
  // The immutable candidate name must stay in lockstep with the
  // expectedArtifactName in scripts/verify-promotion-authority.mjs.
  assert.match(buildCandidate, /name=webmusic-release-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  // One canonical tag-versus-version read; the release-manifests gate already
  // enforces that all 13 workspace manifests share one version.
  assert.match(buildCandidate, /require\('\.\/platform\/kernel\/package\.json'\)\.version/);
  assert.doesNotMatch(buildCandidate, /packages\/score\/\$pkg/);
  assert.doesNotMatch(buildCandidate, /check:external-install|NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/);

  assert.match(externalTest, /needs:\s*build_candidate/);
  assert.match(externalTest, /actions\/download-artifact@[0-9a-f]{40}\s+# v8\.0\.1/);
  assert.match(externalTest, /check:external-install/);
  assert.doesNotMatch(externalTest, /NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/);

  assert.match(rehearsal, /needs:[^\n]*external_test/);
  assert.match(rehearsal, /actions\/download-artifact@[0-9a-f]{40}\s+# v8\.0\.1/);
  assert.match(rehearsal, /--dry-run/);
  assert.doesNotMatch(rehearsal, /npm ci|NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/);

  assert.match(publish, /needs:[^\n]*external_test/);
  assert.match(publish, /environment:\s*npm-release/);
  assert.match(publish, /actions\/download-artifact@[0-9a-f]{40}\s+# v8\.0\.1/);
  assert.match(publish, /id-token:\s*write/);
  assert.match(publish, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.doesNotMatch(publish, /npm ci|check:external-install|npm run (?:build|check|test)/);
  assert.doesNotMatch(workflow, /uses:\s+actions\/[\w-]+@v\d+/);
  assert.match(buildCandidate, /github\.ref_protected/);
  assert.match(buildCandidate, /merge-base --is-ancestor/);
  assert.match(buildCandidate, /cat-file -t/);
});

test('promotion workflow consumes an explicit prior artifact and isolates registry authority', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'promote-release.yml'), 'utf8');
  const promote = workflowJob(workflow, 'promote');

  assert.match(workflow, /release_run_id:/);
  assert.match(workflow, /artifact_name:/);
  assert.match(workflow, /operation:/);
  assert.match(workflow, /- recover/);
  assert.match(workflow, /group:\s*webmusic-npm-release/);
  assert.match(promote, /environment:\s*npm-release/);
  assert.match(promote, /run-id:\s*\$\{\{ inputs\.release_run_id \}\}/);
  assert.match(promote, /github-token:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.equal(promote.match(/\$\{\{ secrets\.NPM_TOKEN \}\}/g)?.length, 1);
  assert.doesNotMatch(promote, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /uses:\s+actions\/[\w-]+@v\d+/);
  assert.match(promote, /--release-run-id/);
  assert.match(promote, /--dry-run/);
  assert.match(promote, /--recover/);
  assert.match(promote, /verify-promotion-authority\.mjs/);
  assert.match(promote, /release:verify-registry/);
});

test('every npm run command in a workflow references a defined package script', async () => {
  const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const manifestsByName = new Map([['<root>', rootManifest]]);

  for (const [directory, metadata] of Object.entries(lock.packages)) {
    if (!directory || !metadata.name) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue; // tolerate a stale lock entry removed in this worktree
      throw error;
    }
    manifestsByName.set(metadata.name, manifest);
  }

  let commands = 0;
  for (const file of ['ci.yml', 'deploy-docs.yml', 'release.yml', 'promote-release.yml']) {
    const workflow = await readFile(path.join(root, '.github', 'workflows', file), 'utf8');
    for (const match of workflow.matchAll(/\bnpm run\s+(?:-w\s+([^\s]+)\s+)?([\w:-]+)/g)) {
      commands += 1;
      const workspace = match[1] ?? '<root>';
      const script = match[2];
      const manifest = manifestsByName.get(workspace);
      assert.ok(manifest, `${file} references unknown workspace ${workspace}.`);
      assert.ok(
        manifest.scripts?.[script],
        `${file} references missing ${workspace === '<root>' ? 'root' : workspace} script ${script}.`,
      );
    }
  }
  assert.ok(commands > 10, 'The workflow script check did not inspect the expected commands.');
});

test('docs deployment is restricted to protected main and grants write permissions only to deploy', async () => {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'deploy-docs.yml'), 'utf8');
  const build = workflowJob(workflow, 'build');
  const deploy = workflowJob(workflow, 'deploy');

  assert.match(workflow, /permissions:\n\s+contents:\s*read/);
  assert.match(
    build,
    /if:\s*github\.ref_type == 'branch' && github\.ref_name == 'main' && github\.ref_protected/,
  );
  assert.match(build, /permissions:\n\s+contents:\s*read/);
  assert.doesNotMatch(build, /pages:\s*write|id-token:\s*write/);
  assert.match(deploy, /permissions:\n\s+pages:\s*write\n\s+id-token:\s*write/);
  assert.doesNotMatch(deploy, /contents:\s*write/);
});

test('all first-party Actions are pinned to immutable full commit SHAs', async () => {
  const expectedActions = new Map([
    ['actions/checkout', ['de0fac2e4500dabe0009e67214ff5f5447ce83dd', 'v6.0.2']],
    ['actions/setup-node', ['48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', 'v6.4.0']],
    ['actions/upload-artifact', ['043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', 'v7.0.1']],
    ['actions/download-artifact', ['3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', 'v8.0.1']],
    ['actions/upload-pages-artifact', ['7b1f4a764d45c48632c6b24a0339c27f5614fb0b', 'v4.0.0']],
    ['actions/deploy-pages', ['d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e', 'v4.0.5']],
  ]);
  for (const file of ['ci.yml', 'deploy-docs.yml', 'release.yml', 'promote-release.yml']) {
    const workflow = await readFile(path.join(root, '.github', 'workflows', file), 'utf8');
    assert.doesNotMatch(workflow, /uses:\s+actions\/[\w-]+@v\d+/);
    for (const match of workflow.matchAll(/uses:\s+(actions\/[\w-]+)@([^\s#]+)\s+#\s+(v\S+)/g)) {
      assert.deepEqual(
        [match[2], match[3]],
        expectedActions.get(match[1]),
        `${file} does not use the reviewed ${match[1]} runtime.`,
      );
    }
  }
});

test('workflow checkouts never persist the GitHub token in the worktree', async () => {
  for (const file of ['ci.yml', 'deploy-docs.yml', 'release.yml', 'promote-release.yml']) {
    const workflow = await readFile(path.join(root, '.github', 'workflows', file), 'utf8');
    const checkouts = workflow.match(/uses:\s+actions\/checkout@/g)?.length ?? 0;
    const disabledCredentials = workflow.match(/persist-credentials:\s*false/g)?.length ?? 0;
    assert.ok(checkouts > 0, `${file} must contain at least one checkout step.`);
    assert.equal(
      disabledCredentials,
      checkouts,
      `${file} must set persist-credentials: false on every checkout step.`,
    );
  }
});

test('workflows and package manifests use the supported Node 22 floor and pinned Node 24 LTS', async () => {
  const ci = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const release = await readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const promote = await readFile(path.join(root, '.github', 'workflows', 'promote-release.yml'), 'utf8');
  assert.equal(ci.match(/node-version:\s*24\.18\.0/g)?.length, 2);
  assert.equal(ci.match(/node-version:\s*22\.23\.1/g)?.length, 1);
  assert.equal(release.match(/node-version:\s*24\.18\.0/g)?.length, 4);
  assert.equal(promote.match(/node-version:\s*24\.18\.0/g)?.length, 1);
  assert.doesNotMatch(`${ci}\n${release}\n${promote}`, /node-version:\s*(?:18|20)(?:\.|\s|$)/);
  assert.equal((await readFile(path.join(root, '.nvmrc'), 'utf8')).trim(), 'v22.23.1');

  const packagePaths = [
    'package.json',
    ...releasePackageNames.map((name) => `${packageDirectory(name)}/package.json`),
  ];
  for (const packagePath of packagePaths) {
    const manifest = JSON.parse(await readFile(path.join(root, packagePath), 'utf8'));
    assert.equal(manifest.engines.node, '>=22', `${packagePath} has a stale Node engine floor.`);
  }
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  for (const packagePath of packagePaths) {
    const key = packagePath === 'package.json' ? '' : packagePath.replace('/package.json', '');
    assert.equal(lock.packages[key].engines.node, '>=22', `${key || 'root'} lock metadata is stale.`);
  }
});

function packageDirectory(name) {
  if (name === '@webmusic/kernel') return 'platform/kernel';
  if (name === '@webmusic/score-audio') return 'bridges/score-audio';
  return `packages/${name.startsWith('@webaudio/') ? 'audio' : 'score'}/${name.split('/')[1]}`;
}

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-artifact-test-'));
  const tarballDirectory = path.join(directory, 'tarballs');
  await mkdir(tarballDirectory);
  const artifacts = [];
  const files = [];
  for (const name of releasePackageNames) {
    const filename = `${name.replace('@', '').replace('/', '-')}-0.1.0.tgz`;
    const file = path.join(tarballDirectory, filename);
    await writeFile(file, `candidate bytes for ${name}`);
    const info = await stat(file);
    artifacts.push({
      name,
      version: '0.1.0',
      file: path.posix.join('tarballs', filename),
      integrity: await integrityForFile(file),
      size: info.size,
    });
    files.push(file);
  }
  const manifest = {
    schemaVersion: artifactManifestSchemaVersion,
    profile: releaseManifestFormat,
    version: '0.1.0',
    createdAt: '2026-07-11T00:00:00.000Z',
    source: {gitSha: 'a'.repeat(40), gitTreeState: 'clean'},
    toolchain: {node: 'v24.18.0', npm: '11.16.0', lockfileVersion: 3},
    build: {
      command: 'npm run build:packages',
      packCommand: 'npm pack --json --ignore-scripts',
      workflow: {provider: 'local'},
    },
    artifacts,
  };
  const manifestPath = path.join(directory, artifactManifestFileName);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {directory, files, manifestPath};
}

async function createOfficialPublishHarness(
  context,
  {
    failStagingName = '',
    unsetStagingName = '',
    rewriteCoreAfterAll = false,
    delayedCommitFailure = false,
    candidateRunAttempt = '1',
    currentRunAttempt = candidateRunAttempt,
  } = {},
) {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, {recursive: true, force: true}));
  const bin = path.join(fixture.directory, 'publish-bin');
  const npmLog = path.join(fixture.directory, 'publish-npm-calls.jsonl');
  const npmState = path.join(fixture.directory, 'publish-npm-state.json');
  await mkdir(bin);

  const fakeGit = path.join(bin, 'git');
  await writeFile(
    fakeGit,
    [
      '#!/usr/bin/env node',
      "if (process.argv[2] === 'rev-parse') console.log('a'.repeat(40));",
      "else if (process.argv[2] !== 'status') process.exitCode = 2;",
      '',
    ].join('\n'),
  );
  await chmod(fakeGit, 0o755);

  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
  const workflowRef = 'mrsteamedbun/WebMusic/.github/workflows/release.yml@refs/tags/v0.1.0';
  manifest.build.workflow = {
    provider: 'github-actions',
    repository: 'mrsteamedbun/WebMusic',
    workflowRef,
    runId: '24680',
    runAttempt: candidateRunAttempt,
  };
  await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const integrities = Object.fromEntries(
    manifest.artifacts.map((artifact) => [`${artifact.name}@${artifact.version}`, artifact.integrity]),
  );
  const initialState = {
    failed: false,
    candidateAdds: 0,
    tags: Object.fromEntries(
      releasePackageNames.map((name) => [name, {staging: '0.0.9', latest: '0.0.9'}]),
    ),
  };
  if (unsetStagingName) delete initialState.tags[unsetStagingName].staging;
  await writeFile(npmState, JSON.stringify(initialState));

  const fakeNpm = path.join(bin, 'npm');
  await writeFile(
    fakeNpm,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      "fs.appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify(args)}\\n`);",
      "const state = JSON.parse(fs.readFileSync(process.env.FAKE_NPM_STATE, 'utf8'));",
      "const save = () => fs.writeFileSync(process.env.FAKE_NPM_STATE, JSON.stringify(state));",
      "if (args[0] === 'view') {",
      '  const [spec, field] = args.slice(1);',
      "  if (field === 'dist.integrity') {",
      '    process.stdout.write(JSON.stringify(JSON.parse(process.env.FAKE_NPM_INTEGRITIES)[spec]));',
      '    process.exit(0);',
      '  }',
      "  if (field === 'dist-tags.staging' || field === 'dist-tags.latest') {",
      "    const tag = field.split('.')[1];",
      '    if (',
      '      state.pendingMutation &&',
      '      state.pendingMutation.name === spec &&',
      '      state.pendingMutation.tag === tag &&',
      '      !state.pendingMutation.revealed',
      '    ) {',
      '      if (state.pendingMutation.readsBeforeReveal > 0) {',
      '        state.pendingMutation.readsBeforeReveal -= 1;',
      '      } else {',
      '        state.tags[spec][tag] = state.pendingMutation.version;',
      '        state.pendingMutation.revealed = true;',
      '      }',
      '      save();',
      '    }',
      '    process.stdout.write(JSON.stringify(state.tags[spec][tag] ?? null));',
      '    process.exit(0);',
      '  }',
      '}',
      "if (args[0] === 'dist-tag' && args[1] === 'add') {",
      '  const spec = args[2];',
      "  const split = spec.lastIndexOf('@');",
      '  const name = spec.slice(0, split);',
      '  const version = spec.slice(split + 1);',
      '  const tag = args[3];',
      '  if (',
      "    tag === 'staging' &&",
      '    version === process.env.FAKE_CANDIDATE_VERSION &&',
      '    name === process.env.FAKE_FAIL_STAGING_NAME &&',
      '    !state.failed',
      '  ) {',
      '    state.failed = true;',
      "    if (process.env.FAKE_DELAYED_COMMIT_FAILURE === 'true') {",
      '      state.pendingMutation = {',
      '        name,',
      '        tag,',
      '        version,',
      '        readsBeforeReveal: 2,',
      '        revealed: false,',
      '      };',
      '    }',
      '    save();',
      '    process.exit(90);',
      '  }',
      '  if (',
      '    state.pendingMutation &&',
      '    state.pendingMutation.name === name &&',
      '    state.pendingMutation.tag === tag &&',
      '    state.pendingMutation.revealed',
      '  ) {',
      '    delete state.pendingMutation;',
      '  }',
      '  state.tags[name][tag] = version;',
      "  if (tag === 'staging' && version === process.env.FAKE_CANDIDATE_VERSION) {",
      '    state.candidateAdds += 1;',
      '    if (',
      "      process.env.FAKE_REWRITE_CORE_AFTER_ALL === 'true' &&",
      '      state.candidateAdds === Number(process.env.FAKE_PACKAGE_COUNT)',
      '    ) {',
      "      state.tags['@webscore/core'].staging = '0.2.0';",
      '    }',
      '  }',
      '  save();',
      '  process.exit(0);',
      '}',
      "if (args[0] === 'dist-tag' && args[1] === 'rm') {",
      '  if (',
      '    state.pendingMutation &&',
      '    state.pendingMutation.name === args[2] &&',
      '    state.pendingMutation.tag === args[3] &&',
      '    state.pendingMutation.revealed',
      '  ) {',
      '    delete state.pendingMutation;',
      '  }',
      '  delete state.tags[args[2]][args[3]];',
      '  save();',
      '  process.exit(0);',
      '}',
      'process.exit(91);',
      '',
    ].join('\n'),
  );
  await chmod(fakeNpm, 0o755);

  const environment = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REPOSITORY: 'mrsteamedbun/WebMusic',
    GITHUB_REF_PROTECTED: 'true',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v0.1.0',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_WORKFLOW_REF: workflowRef,
    GITHUB_RUN_ID: '24680',
    GITHUB_RUN_ATTEMPT: currentRunAttempt,
    FAKE_NPM_LOG: npmLog,
    FAKE_NPM_STATE: npmState,
    FAKE_NPM_INTEGRITIES: JSON.stringify(integrities),
    FAKE_CANDIDATE_VERSION: '0.1.0',
    FAKE_PACKAGE_COUNT: String(releasePackageNames.length),
    FAKE_FAIL_STAGING_NAME: failStagingName,
    FAKE_REWRITE_CORE_AFTER_ALL: String(rewriteCoreAfterAll),
    FAKE_DELAYED_COMMIT_FAILURE: String(delayedCommitFailure),
    WEBSCORE_RELEASE_TAG_RECONCILE_DELAY_MS: '1',
  };

  return {environment, fixture, npmLog, npmState};
}

function workflowJob(workflow, name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${name} job in release.yml.`);
  const afterHeader = start + marker.length;
  const next = /^ {2}[a-z_]+:\n/m.exec(workflow.slice(afterHeader));
  return workflow.slice(start, next ? afterHeader + next.index : workflow.length);
}
