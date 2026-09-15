import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  assertDistTagSnapshotUnchanged,
  assertManifestMatchesWorkspace,
  assertReleaseTagSelectionDoesNotMoveBackward,
  createValidatedArtifactSnapshot,
  npmPublishArguments,
  readArtifactManifest,
  releaseManifestFormat,
  releaseDistTag,
  releaseTagMutationState,
  releaseUploadDistTag,
} from './release-artifacts.mjs';
import {
  reconcileDistTag,
  releaseNpmTimeout,
  tagReconcileDelay,
} from './release-command-policy.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const officialRepository = 'mrsteamedbun/WebMusic';
const officialWorkflowPath = '.github/workflows/release.yml';
const {dryRun, manifestPath} = parseArguments(process.argv.slice(2));
const npmTimeoutMs = releaseNpmTimeout();
const reconcileDelayMs = tagReconcileDelay();
const npmCache = await mkdtemp(path.join(tmpdir(), 'webmusic-publish-npm-cache-'));
const npmEnv = {...process.env, npm_config_cache: npmCache};
let artifactSnapshot;

try {
  const suppliedCandidate = await readArtifactManifest(manifestPath, {expectedProfile: releaseManifestFormat});
  artifactSnapshot = await createValidatedArtifactSnapshot(suppliedCandidate);
  const candidate = artifactSnapshot.candidate;
  const {version} = await assertManifestMatchesWorkspace(root, candidate.manifest);
  await assertSourceIdentity(candidate.manifest, dryRun);
  if (!dryRun) assertOfficialWorkflow(candidate.manifest, version);
  const initialDistTags = dryRun ? undefined : await assertDistTagsDoNotMoveBackward(candidate.artifacts);
  const uploadTag = releaseUploadDistTag(version);

  console.log(
    `${dryRun ? 'Dry-running' : 'Publishing'} ${candidate.artifacts.length} exact candidate tarballs ` +
      `through the version-specific ${uploadTag} upload tag.`,
  );
  for (const artifact of candidate.artifacts) {
    if (dryRun) {
      console.log(`Dry-run publishing ${artifact.name}@${artifact.version} from ${artifact.file}.`);
      await npmCommand(npmPublishArguments(artifact.absolutePath, {dryRun: true, version: artifact.version}));
      continue;
    }

    const spec = `${artifact.name}@${artifact.version}`;
    const existingIntegrity = await registryIntegrity(spec);
    if (existingIntegrity) {
      if (existingIntegrity !== artifact.integrity) {
        fail(
          `${spec} already exists with a different integrity. ` +
            'Stop and release a new version; do not overwrite or continue this release line.',
        );
      }
      console.log(
        `Skipping ${spec}; the registry artifact matches the candidate manifest.`,
      );
      continue;
    }

    console.log(`Publishing ${spec} from ${artifact.file} under ${uploadTag}.`);
    await npmCommand(npmPublishArguments(artifact.absolutePath, {version: artifact.version}));
    await waitForPublishedIntegrity(artifact);
  }

  if (!dryRun) {
    // Upload and shared-channel promotion are deliberately separate phases.
    // Never expose a partial lockstep graph merely because a later package
    // failed to upload or its registry integrity never became visible.
    await assertAllPublishedIntegrities(candidate.artifacts);
    await assertAllDistTagSnapshotsUnchanged(candidate.artifacts, initialDistTags);
    await advanceReleaseDistTagsWithRollback(candidate.artifacts, initialDistTags);
  }
  console.log(
    dryRun
      ? 'Publish dry run completed against the exact candidate tarballs.'
      : `All release packages are published or integrity-verified under ${releaseDistTag}; latest was not changed.`,
  );
} finally {
  await artifactSnapshot?.cleanup();
  await rm(npmCache, {recursive: true, force: true});
}

async function assertAllPublishedIntegrities(artifacts) {
  for (const artifact of artifacts) {
    const spec = `${artifact.name}@${artifact.version}`;
    const publishedIntegrity = await registryIntegrity(spec);
    if (publishedIntegrity !== artifact.integrity) {
      fail(
        `${spec} is not completely available with the candidate integrity; ` +
          `refusing to advance the shared ${releaseDistTag} channel.`,
      );
    }
  }
}

async function assertAllDistTagSnapshotsUnchanged(artifacts, expectedSnapshots) {
  for (const artifact of artifacts) {
    const current = await distTagSnapshot(artifact.name);
    assertDistTagSnapshotUnchanged(artifact, expectedSnapshots.get(artifact.name), current);
  }
}

async function advanceReleaseDistTagsWithRollback(artifacts, initialSnapshots) {
  const changed = [];
  try {
    for (const artifact of artifacts) {
      await ensureReleaseDistTag(
        artifact,
        initialSnapshots.get(artifact.name),
        () => changed.push(artifact),
      );
    }
    await assertFinalReleaseDistTags(artifacts, initialSnapshots);
  } catch (stagingError) {
    const rollbackErrors = await rollbackReleaseDistTags(changed, artifacts, initialSnapshots);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [stagingError, ...rollbackErrors],
        'Staging promotion failed and automatic rollback was incomplete; freeze release operations.',
      );
    }
    throw new Error(
      'Staging promotion failed; bounded compensation completed and final registry ' +
        'observations matched the preflight snapshot. Re-run verification before continuing.',
      {cause: stagingError},
    );
  }
}

async function assertFinalReleaseDistTags(artifacts, initialSnapshots) {
  for (const artifact of artifacts) {
    const initial = initialSnapshots.get(artifact.name);
    const current = await distTagSnapshot(artifact.name);
    if (current[releaseDistTag] !== artifact.version) {
      fail(
        `Final ${releaseDistTag} verification failed for ${artifact.name}: ` +
          `expected ${artifact.version}, received ${current[releaseDistTag] ?? 'unset'}.`,
      );
    }
    if (current.latest !== initial.latest) {
      fail(
        `${artifact.name}'s latest dist-tag changed during staging ` +
          `(${initial.latest ?? 'unset'} -> ${current.latest ?? 'unset'}).`,
      );
    }
  }
}

async function rollbackReleaseDistTags(changed, artifacts, initialSnapshots) {
  const errors = [];
  for (const artifact of [...changed].reverse()) {
    const initial = initialSnapshots.get(artifact.name);
    const artifactErrors = [];
    let current;
    try {
      current = await distTagSnapshot(artifact.name);
    } catch (error) {
      errors.push(error);
      continue;
    }

    if (current.latest !== initial.latest) {
      artifactErrors.push(
        new Error(
          `${artifact.name}'s latest changed concurrently during staging rollback ` +
            `(${initial.latest ?? 'unset'} -> ${current.latest ?? 'unset'}).`,
        ),
      );
    }

    const selected = current[releaseDistTag];
    const previous = initial[releaseDistTag];
    if (selected !== previous && selected !== artifact.version) {
      artifactErrors.push(
        new Error(
          `${artifact.name}'s ${releaseDistTag} changed concurrently during rollback ` +
            `(${artifact.version} -> ${selected ?? 'unset'}); it will not be overwritten.`,
        ),
      );
    } else {
      try {
        const result = await reconcileDistTag({
          name: artifact.name,
          tag: releaseDistTag,
          target: artifact.version,
          previous,
          read: () => distTagVersion(artifact.name, releaseDistTag),
          compensate: () => compensateReleaseDistTag(artifact, previous),
          reconcileDelayMs,
        });
        if (result.commandFailures.length > 0) {
          console.warn(
            `${artifact.name}'s ${releaseDistTag} compensation command reported ` +
              `${result.commandFailures.length} failure(s), but the bounded stability window ` +
              'observed the preflight value.',
          );
        }
      } catch (error) {
        artifactErrors.push(error);
      }
    }

    errors.push(...artifactErrors);
  }

  try {
    await assertRestoredDistTagSnapshots(artifacts, initialSnapshots);
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

async function compensateReleaseDistTag(artifact, previous) {
  if (previous) {
    await npmCommand(['dist-tag', 'add', `${artifact.name}@${previous}`, releaseDistTag]);
  } else {
    await npmCommand(['dist-tag', 'rm', artifact.name, releaseDistTag]);
  }
}

async function assertRestoredDistTagSnapshots(artifacts, initialSnapshots) {
  for (const artifact of artifacts) {
    const expected = initialSnapshots.get(artifact.name);
    const current = await distTagSnapshot(artifact.name);
    for (const tag of [releaseDistTag, 'latest']) {
      if (current[tag] === expected[tag]) continue;
      fail(
        `Final rollback verification failed for ${artifact.name}'s ${tag}: ` +
          `expected ${expected[tag] ?? 'unset'}, received ${current[tag] ?? 'unset'}.`,
      );
    }
  }
}

function parseArguments(arguments_) {
  let dryRun = false;
  let manifestPath;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--dry-run') {
      dryRun = true;
    } else if (argument === '--manifest') {
      const value = arguments_[++index];
      if (!value || value.startsWith('--')) fail('--manifest requires a path.');
      manifestPath = path.resolve(root, value);
    } else {
      fail(`Unknown argument: ${argument}.`);
    }
  }
  if (!manifestPath) {
    fail('Usage: node scripts/publish-workspaces.mjs --manifest <artifact-manifest.json> [--dry-run].');
  }
  return {dryRun, manifestPath};
}

async function assertSourceIdentity(manifest, dryRun) {
  const gitOptions = {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  };
  const {stdout} = await execFileAsync('git', ['rev-parse', 'HEAD'], gitOptions);
  const currentSha = stdout.trim();
  if (currentSha !== manifest.source.gitSha) {
    fail(
      `Artifact manifest was built from ${manifest.source.gitSha}, but publication is running at ${currentSha}.`,
    );
  }
  if (!dryRun && manifest.source.gitTreeState !== 'clean') {
    fail('Real publication requires an artifact manifest produced from a clean Git tree.');
  }
  if (!dryRun) {
    const {stdout: status} = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      gitOptions,
    );
    if (status.trim()) fail('Real publication requires the current Git worktree to remain clean.');
  }
}

async function registryIntegrity(spec) {
  try {
    const {stdout} = await npmCommand(['view', spec, 'dist.integrity', '--json']);
    if (!stdout.trim()) return undefined;
    const value = JSON.parse(stdout);
    if (value === null) return undefined;
    if (typeof value !== 'string' || value.length === 0) {
      fail(`${spec} exists in the registry but does not expose dist.integrity.`);
    }
    return value;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function waitForPublishedIntegrity(artifact) {
  const spec = `${artifact.name}@${artifact.version}`;
  const retryDelays = [0, 1_000, 2_000, 4_000, 8_000];
  for (const delay of retryDelays) {
    if (delay > 0) await wait(delay);
    const publishedIntegrity = await registryIntegrity(spec);
    if (publishedIntegrity === artifact.integrity) return;
    if (publishedIntegrity) {
      fail(
        `${spec} was published but its registry integrity differs from the candidate manifest. ` +
          'Stop and investigate before attempting recovery.',
      );
    }
  }
  fail(
    `${spec} was published but its integrity did not become visible after bounded registry retries. ` +
      'Stop and inspect the registry before attempting recovery.',
  );
}

async function ensureReleaseDistTag(artifact, expectedSnapshot, recordMutationIntent) {
  const spec = `${artifact.name}@${artifact.version}`;
  const immediateSnapshot = await distTagSnapshot(artifact.name);
  assertDistTagSnapshotUnchanged(artifact, expectedSnapshot, immediateSnapshot);
  if (immediateSnapshot[releaseDistTag] === artifact.version) return;
  console.log(`Setting ${artifact.name}'s ${releaseDistTag} dist-tag to ${artifact.version}.`);
  // Record intent first: npm can update the registry and still time out or
  // report a local failure, in which case rollback must inspect this package.
  recordMutationIntent();
  await npmCommand(['dist-tag', 'add', spec, releaseDistTag]);
  const retryDelays = [0, 1_000, 2_000, 4_000];
  for (const delay of retryDelays) {
    if (delay > 0) await wait(delay);
    const currentSnapshot = await distTagSnapshot(artifact.name);
    if (releaseTagMutationState(artifact, immediateSnapshot, currentSnapshot) === 'applied') return;
  }
  fail(`${releaseDistTag} does not select ${spec} after bounded registry retries.`);
}

async function assertDistTagsDoNotMoveBackward(artifacts) {
  const snapshots = new Map();
  for (const artifact of artifacts) {
    const snapshot = await distTagSnapshot(artifact.name);
    for (const tag of [releaseDistTag, 'latest']) {
      assertReleaseTagSelectionDoesNotMoveBackward(artifact, tag, snapshot[tag]);
    }
    snapshots.set(artifact.name, snapshot);
  }
  return snapshots;
}

async function distTagSnapshot(name) {
  const [staging, latest] = await Promise.all([
    distTagVersion(name, releaseDistTag),
    distTagVersion(name, 'latest'),
  ]);
  return {[releaseDistTag]: staging, latest};
}

async function distTagVersion(name, tag) {
  try {
    const {stdout} = await npmCommand(['view', name, `dist-tags.${tag}`, '--json']);
    if (!stdout.trim()) return undefined;
    const value = JSON.parse(stdout);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function npmCommand(commandArguments) {
  try {
    return await execFileAsync(npm, commandArguments, {
      cwd: root,
      encoding: 'utf8',
      env: npmEnv,
      maxBuffer: 16 * 1024 * 1024,
      timeout: npmTimeoutMs,
      killSignal: 'SIGTERM',
    });
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM') {
      throw new Error(
        `npm ${commandArguments.join(' ')} exceeded ${npmTimeoutMs} ms.`,
        {cause: error},
      );
    }
    const commandOutput = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    if (commandOutput) console.error(commandOutput);
    throw error;
  }
}

function assertOfficialWorkflow(manifest, version) {
  const expectedTag = `v${version}`;
  if (process.env.GITHUB_ACTIONS !== 'true') {
    fail('Real publication is only allowed from the official GitHub Actions tag workflow. Use --dry-run locally.');
  }
  if (process.env.GITHUB_EVENT_NAME !== 'push') {
    fail('Real publication requires the protected tag-push event, not a manually supplied Actions environment.');
  }
  if (process.env.GITHUB_REPOSITORY !== officialRepository) {
    fail(
      `Real publication is restricted to ${officialRepository}; ` +
        `received ${process.env.GITHUB_REPOSITORY ?? 'no repository identity'}.`,
    );
  }
  if (process.env.GITHUB_REF_PROTECTED !== 'true') {
    fail(`Real publication requires ${expectedTag} to match a protected GitHub tag rule or ruleset.`);
  }
  if (process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== expectedTag) {
    fail(`Real publication requires tag ${expectedTag}; received ${process.env.GITHUB_REF_NAME ?? 'no tag'}.`);
  }
  if (process.env.GITHUB_SHA !== manifest.source.gitSha) {
    fail('The GitHub tag event SHA does not match the immutable candidate source SHA.');
  }

  const workflow = manifest.build?.workflow;
  const expectedWorkflowRef = `${officialRepository}/${officialWorkflowPath}@refs/tags/${expectedTag}`;
  if (
    workflow?.provider !== 'github-actions' ||
    workflow.repository !== officialRepository ||
    workflow.workflowRef !== expectedWorkflowRef ||
    workflow.runId !== process.env.GITHUB_RUN_ID ||
    process.env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef
  ) {
    fail('The candidate workflow identity does not match this protected release workflow run.');
  }
  const currentRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!/^[1-9]\d*$/.test(currentRunAttempt ?? '')) {
    fail('The protected release workflow run attempt must be a positive decimal identity.');
  }
  if (BigInt(currentRunAttempt) < BigInt(workflow.runAttempt)) {
    fail(
      `The current workflow attempt ${currentRunAttempt} predates candidate attempt ` +
        `${workflow.runAttempt}; refusing publication.`,
    );
  }
}

function isNotFound(error) {
  const output = [error?.stdout, error?.stderr, error instanceof Error ? error.message : String(error)]
    .filter(Boolean)
    .join('\n');
  return /\bE404\b|404 Not Found|not in this registry/i.test(output);
}

function fail(message) {
  throw new Error(message);
}
