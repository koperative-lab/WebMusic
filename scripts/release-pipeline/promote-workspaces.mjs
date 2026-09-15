import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  assertReleaseTagSelectionDoesNotMoveBackward,
  readArtifactManifest,
  releaseManifestFormat,
  releaseDistTag,
} from './release-artifacts.mjs';
import {
  establishDistTag,
  reconcileDistTag,
  releaseNpmTimeout,
  tagReconcileDelay,
} from './release-command-policy.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const officialRepository = 'mrsteamedbun/WebMusic';
const officialWorkflowPath = '.github/workflows/promote-release.yml';
const {dryRun, recover, manifestPath, releaseRunId} = parseArguments(process.argv.slice(2));
const npmTimeoutMs = releaseNpmTimeout();
const reconcileDelayMs = tagReconcileDelay();
const npmCache = await mkdtemp(path.join(tmpdir(), 'webmusic-promote-npm-cache-'));
const npmEnv = {...process.env, npm_config_cache: npmCache};

try {
  const candidate = await readArtifactManifest(manifestPath, {expectedProfile: releaseManifestFormat});
  if (!dryRun) assertOfficialPromotion(candidate.manifest, releaseRunId);

  if (recover) {
    // Recovery intentionally does not depend on staging. An interrupted run or
    // incident response may have moved that shared tag while the immutable
    // candidate version and its retained rollback markers remain recoverable.
    await verifyCandidateIntegrities(candidate.artifacts);
    await recoverLatestFromMarkers(candidate.artifacts);
    console.log(
      `Recovered all WebMusic packages from the ${candidate.manifest.version} latest promotion markers.`,
    );
  } else {
    const snapshots = await verifyCandidateGraph(candidate.artifacts);
    if (dryRun) {
      console.log(
        `Promotion dry run passed for ${candidate.manifest.version}; all exact artifacts and ` +
          `${releaseDistTag} selections are complete, and latest was not changed.`,
      );
    } else {
      await assertCompletionEvidenceAbsent(candidate.artifacts, snapshots);
      await assertSnapshotsUnchanged(candidate.artifacts, snapshots);
      await persistRollbackMarkers(candidate.artifacts, snapshots);
      await promoteWithRollback(candidate.artifacts, snapshots);
      await persistCompletionEvidence(candidate.artifacts, snapshots);
      console.log(`Promoted all WebMusic packages to ${candidate.manifest.version} on latest.`);
    }
  }
} finally {
  await rm(npmCache, {recursive: true, force: true});
}

function parseArguments(arguments_) {
  let dryRun = false;
  let recover = false;
  let manifestPath;
  let releaseRunId;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--dry-run') {
      dryRun = true;
    } else if (argument === '--recover') {
      recover = true;
    } else if (argument === '--manifest') {
      manifestPath = path.resolve(root, requireValue(arguments_, ++index, '--manifest'));
    } else if (argument === '--release-run-id') {
      releaseRunId = requireValue(arguments_, ++index, '--release-run-id');
    } else {
      fail(`Unknown argument: ${argument}.`);
    }
  }
  if (!manifestPath) {
    fail(
      'Usage: node scripts/promote-workspaces.mjs --manifest <artifact-manifest.json> ' +
        '[--release-run-id <id>] [--dry-run | --recover].',
    );
  }
  if (dryRun && recover) fail('--dry-run and --recover cannot be used together.');
  if (!dryRun && !/^\d+$/.test(releaseRunId ?? '')) {
    fail('Real promotion or recovery requires --release-run-id with the archived candidate workflow run id.');
  }
  return {dryRun, recover, manifestPath, releaseRunId};
}

async function verifyCandidateGraph(artifacts) {
  await verifyCandidateIntegrities(artifacts);
  const snapshots = new Map();
  for (const artifact of artifacts) {
    const snapshot = await distTagSnapshot(artifact.name);
    if (snapshot[releaseDistTag] !== artifact.version) {
      fail(
        `${artifact.name}'s ${releaseDistTag} dist-tag selects ` +
          `${snapshot[releaseDistTag] ?? 'nothing'}, not ${artifact.version}.`,
      );
    }
    assertReleaseTagSelectionDoesNotMoveBackward(artifact, 'latest', snapshot.latest);
    snapshots.set(artifact.name, snapshot);
  }
  return snapshots;
}

async function verifyCandidateIntegrities(artifacts) {
  for (const artifact of artifacts) {
    const spec = `${artifact.name}@${artifact.version}`;
    const integrity = await registryValue(spec, 'dist.integrity');
    if (integrity !== artifact.integrity) {
      fail(`${spec} does not match the archived candidate integrity; refusing latest mutation.`);
    }
  }
}

async function assertSnapshotsUnchanged(artifacts, expectedSnapshots) {
  for (const artifact of artifacts) {
    const expected = expectedSnapshots.get(artifact.name);
    const current = await distTagSnapshot(artifact.name);
    for (const tag of [releaseDistTag, 'latest']) {
      if (current[tag] !== expected[tag]) {
        fail(
          `${artifact.name}'s ${tag} dist-tag changed concurrently ` +
            `(${expected[tag] ?? 'unset'} -> ${current[tag] ?? 'unset'}); refusing promotion.`,
        );
      }
    }
  }
}

async function assertCompletionEvidenceAbsent(artifacts, snapshots) {
  let values;
  for (let observation = 0; observation < 3; observation += 1) {
    if (observation > 0) {
      await new Promise((resolve) => setTimeout(resolve, reconcileDelayMs));
    }
    values = await completionMarkerValues(artifacts);
    if (values.some((value) => value !== undefined)) break;
  }
  const latestComplete = artifacts.every(
    (artifact) => snapshots.get(artifact.name).latest === artifact.version,
  );
  if (values.every((value) => value === undefined)) {
    if (latestComplete) {
      const rollbackMarkers = [];
      for (const artifact of artifacts) rollbackMarkers.push(await rollbackMarkerSnapshot(artifact));
      if (rollbackMarkers.some((marker) => marker.previous !== undefined || marker.unset !== undefined)) {
        fail(
          `All latest tags select ${artifacts[0].version} and rollback evidence already exists, ` +
            'but durable completion evidence is absent; refusing an ambiguous same-version rerun.',
        );
      }
    }
    return;
  }

  const complete = values.every((value, index) => value === artifacts[index].version);
  if (complete && latestComplete) {
    fail(
      `Promotion ${artifacts[0].version} already has complete durable evidence; ` +
        'refusing a same-version promote rerun.',
    );
  }
  fail(
    `Promotion ${artifacts[0].version} has partial, invalid, or conflicting completion evidence; ` +
      'freeze promotion and recovery operations.',
  );
}

async function persistCompletionEvidence(artifacts, snapshots) {
  try {
    for (const artifact of artifacts) {
      await assertRollbackMarkerMatches(artifact, snapshots.get(artifact.name).latest);
      const current = await distTagSnapshot(artifact.name);
      if (current[releaseDistTag] !== artifact.version || current.latest !== artifact.version) {
        fail(
          `${artifact.name}'s release graph changed before durable promotion completion ` +
            'could be recorded.',
        );
      }

      const tag = completionMarkerTag(artifact.version);
      const result = await establishDistTag({
        name: artifact.name,
        tag,
        target: artifact.version,
        previous: undefined,
        read: () => distTagVersion(artifact.name, tag),
        establish: () => writeDistTag(artifact.name, artifact.version, tag),
        reconcileDelayMs,
      });
      if (result.commandFailures.length > 0) {
        console.warn(
          `${artifact.name}'s completion-marker command reported ` +
            `${result.commandFailures.length} failure(s), but the bounded stability window ` +
            'observed the version-specific completion evidence.',
        );
      }
    }

    for (const artifact of artifacts) {
      await assertRollbackMarkerMatches(artifact, snapshots.get(artifact.name).latest);
      const current = await distTagSnapshot(artifact.name);
      const completion = await completionMarkerVersion(artifact);
      if (
        current[releaseDistTag] !== artifact.version ||
        current.latest !== artifact.version ||
        completion !== artifact.version
      ) {
        fail(`Final durable completion verification failed for ${artifact.name}@${artifact.version}.`);
      }
    }
  } catch (error) {
    throw new AggregateError(
      [error],
      'Latest reached the candidate graph, but durable completion evidence is incomplete or ' +
        'ambiguous; do not report success, recover, or retry without incident review.',
    );
  }
}

async function persistRollbackMarkers(artifacts, snapshots) {
  // Persist every package's rollback target before latest is mutated anywhere.
  // Existing matching markers make this phase resumable if the process died
  // while writing markers; conflicting markers are retained evidence and fail closed.
  for (const artifact of artifacts) {
    const previous = snapshots.get(artifact.name).latest;
    const marker = await rollbackMarkerSnapshot(artifact);
    if (previous === undefined) {
      if (marker.previous !== undefined) {
        fail(
          `${artifact.name}'s ${marker.tags.previous} marker unexpectedly selects ${marker.previous}; ` +
            'refusing to overwrite rollback evidence.',
        );
      }
      if (marker.unset === undefined) {
        await setDistTag(artifact.name, artifact.version, marker.tags.unset);
      } else if (marker.unset !== artifact.version) {
        fail(
          `${artifact.name}'s ${marker.tags.unset} marker selects ${marker.unset}, ` +
            `not ${artifact.version}; refusing to overwrite rollback evidence.`,
        );
      }
    } else {
      if (marker.unset !== undefined) {
        fail(
          `${artifact.name}'s ${marker.tags.unset} marker is already set; ` +
            'refusing to overwrite rollback evidence.',
        );
      }
      if (marker.previous === undefined) {
        await setDistTag(artifact.name, previous, marker.tags.previous);
      } else if (marker.previous !== previous) {
        fail(
          `${artifact.name}'s ${marker.tags.previous} marker selects ${marker.previous}, ` +
            `not ${previous}; refusing to overwrite rollback evidence.`,
        );
      }
    }
  }

  // This second pass is the durability barrier: all marker writes and all
  // original release-tag snapshots must be visible before the first latest write.
  for (const artifact of artifacts) {
    const expected = snapshots.get(artifact.name);
    await assertRollbackMarkerMatches(artifact, expected.latest);
    const current = await distTagSnapshot(artifact.name);
    for (const tag of [releaseDistTag, 'latest']) {
      if (current[tag] !== expected[tag]) {
        fail(
          `${artifact.name}'s ${tag} dist-tag changed while rollback markers were persisted ` +
            `(${expected[tag] ?? 'unset'} -> ${current[tag] ?? 'unset'}); refusing promotion.`,
        );
      }
    }
  }
}

async function promoteWithRollback(artifacts, snapshots) {
  const changed = [];
  try {
    for (const artifact of artifacts) {
      const snapshot = snapshots.get(artifact.name);
      await assertRollbackMarkerMatches(artifact, snapshot.latest);
      const current = await distTagSnapshot(artifact.name);
      if (current[releaseDistTag] !== artifact.version || current.latest !== snapshot.latest) {
        fail(`${artifact.name}'s release tags changed after promotion preflight.`);
      }
      if (current.latest === artifact.version) continue;
      // Record the mutation intent before invoking npm. A command can reach the
      // registry and still fail locally or time out while verifying visibility.
      // Rollback distinguishes "not applied" from "applied" using the snapshot.
      changed.push(artifact);
      await setDistTag(artifact.name, artifact.version, 'latest');
    }

    for (const artifact of artifacts) {
      await assertRollbackMarkerMatches(artifact, snapshots.get(artifact.name).latest);
      const snapshot = await distTagSnapshot(artifact.name);
      if (snapshot[releaseDistTag] !== artifact.version || snapshot.latest !== artifact.version) {
        fail(`Final registry verification failed for ${artifact.name}@${artifact.version}.`);
      }
    }
  } catch (promotionError) {
    const rollbackErrors = await rollbackLatest(changed, snapshots);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [promotionError, ...rollbackErrors],
        'Latest promotion failed and automatic rollback was incomplete; freeze release operations.',
      );
    }
    throw new Error(
      'Latest promotion failed; bounded compensation completed and final registry ' +
        'observations matched the preflight snapshot. Retained markers remain available for recovery.',
      {cause: promotionError},
    );
  }
}

async function recoverLatestFromMarkers(artifacts) {
  const recoverySnapshots = new Map();

  // Phase one is read-only. Require one unambiguous marker for every package,
  // require completion evidence to be entirely absent, then require every
  // current latest value to be either the candidate or recorded predecessor.
  // Any third value may be an external release operation.
  for (const artifact of artifacts) {
    const marker = await rollbackMarkerSnapshot(artifact);
    let previous;
    if (marker.previous !== undefined && marker.unset === undefined) {
      assertReleaseTagSelectionDoesNotMoveBackward(
        artifact,
        marker.tags.previous,
        marker.previous,
      );
      previous = marker.previous;
    } else if (marker.previous === undefined && marker.unset === artifact.version) {
      previous = undefined;
    } else if (marker.previous === undefined && marker.unset === undefined) {
      fail(`${artifact.name} has no rollback marker for ${artifact.version}; recovery cannot proceed.`);
    } else {
      fail(
        `${artifact.name} has ambiguous or invalid rollback markers for ${artifact.version}; ` +
          'recovery cannot proceed.',
      );
    }
    recoverySnapshots.set(artifact.name, {previous, marker});
  }
  await assertCompletionMarkersStablyAbsent(artifacts, 'during read-only recovery preflight');

  let observedIncompleteLatest = false;
  for (const artifact of artifacts) {
    const {previous} = recoverySnapshots.get(artifact.name);
    const current = await distTagVersion(artifact.name, 'latest');
    if (current !== artifact.version && current !== previous) {
      fail(
        `${artifact.name}'s latest is ${current ?? 'unset'}, neither candidate ${artifact.version} ` +
          `nor recorded predecessor ${previous ?? 'unset'}; recovery is failing closed.`,
      );
    }
    if (current !== artifact.version) observedIncompleteLatest = true;
  }
  if (!observedIncompleteLatest) {
    fail(
      `All latest tags already select ${artifacts[0].version} while durable completion evidence ` +
        'is absent; the markers do not prove an incomplete promotion, so recovery is forbidden.',
    );
  }
  await assertCompletionMarkersStablyAbsent(artifacts, 'before recovery mutation');

  // Phase two is resumable: a process interruption can only leave each package
  // at the candidate or predecessor, the same states accepted above.
  for (const artifact of artifacts) {
    const recovery = recoverySnapshots.get(artifact.name);
    await assertRollbackMarkerMatches(artifact, recovery.previous);
    const current = await distTagVersion(artifact.name, 'latest');
    if (current !== artifact.version && current !== recovery.previous) {
      fail(`${artifact.name}'s latest changed externally during recovery; recovery is failing closed.`);
    }
    if (recovery.previous === artifact.version) continue;

    // An interrupted npm command may commit after recovery first observes the
    // predecessor. Compensate every safe candidate/predecessor state and
    // require a bounded stability window before claiming recovery.
    const result = await reconcileDistTag({
      name: artifact.name,
      tag: 'latest',
      target: artifact.version,
      previous: recovery.previous,
      read: () => distTagVersion(artifact.name, 'latest'),
      compensate: () => compensateLatest(artifact.name, recovery.previous),
      reconcileDelayMs,
    });
    if (result.commandFailures.length > 0) {
      console.warn(
        `${artifact.name}'s recovery compensation command reported ` +
          `${result.commandFailures.length} failure(s), but the bounded stability window ` +
          'observed the retained predecessor.',
      );
    }
  }

  for (const artifact of artifacts) {
    const {previous} = recoverySnapshots.get(artifact.name);
    await assertRollbackMarkerMatches(artifact, previous);
    const current = await distTagVersion(artifact.name, 'latest');
    if (current !== previous) {
      fail(
        `Recovery verification failed for ${artifact.name}: latest is ${current ?? 'unset'}, ` +
          `expected ${previous ?? 'unset'}.`,
      );
    }
  }
  // Keep the completion barrier as the last registry observation before the
  // caller reports success. A marker that becomes visible while the restored
  // latest graph is being verified must still turn recovery into an incident.
  await assertCompletionMarkersStablyAbsent(artifacts, 'during final recovery verification');
}

async function assertCompletionMarkersStablyAbsent(artifacts, phase) {
  for (let observation = 0; observation < 3; observation += 1) {
    if (observation > 0) {
      await new Promise((resolve) => setTimeout(resolve, reconcileDelayMs));
    }
    const values = await completionMarkerValues(artifacts);
    if (values.every((value) => value === undefined)) continue;
    if (values.every((value, index) => value === artifacts[index].version)) {
      fail(
        `Promotion ${artifacts[0].version} is durably complete; protected recovery must not ` +
          'roll latest back.',
      );
    }
    fail(
      `Promotion ${artifacts[0].version} has partial or invalid durable completion evidence ` +
        `${phase}; recovery is ambiguous and must fail closed.`,
    );
  }
}

async function assertRollbackMarkerMatches(artifact, previous) {
  const marker = await rollbackMarkerSnapshot(artifact);
  if (previous === undefined) {
    if (marker.previous === undefined && marker.unset === artifact.version) return;
  } else if (marker.previous === previous && marker.unset === undefined) {
    return;
  }
  fail(`${artifact.name}'s rollback markers changed or do not match the expected latest snapshot.`);
}

async function rollbackMarkerSnapshot(artifact) {
  const tags = rollbackMarkerTags(artifact.version);
  const [previous, unset] = await Promise.all([
    distTagVersion(artifact.name, tags.previous),
    distTagVersion(artifact.name, tags.unset),
  ]);
  return {tags, previous, unset};
}

async function completionMarkerVersion(artifact) {
  return distTagVersion(artifact.name, completionMarkerTag(artifact.version));
}

async function completionMarkerValues(artifacts) {
  return Promise.all(artifacts.map((artifact) => completionMarkerVersion(artifact)));
}

function completionMarkerTag(version) {
  return `webmusic-latest-complete-v${version}`;
}

function rollbackMarkerTags(version) {
  return {
    previous: `webmusic-latest-before-v${version}`,
    unset: `webmusic-latest-unset-before-v${version}`,
  };
}

async function rollbackLatest(changed, snapshots) {
  const errors = [];
  for (const artifact of [...changed].reverse()) {
    const previous = snapshots.get(artifact.name).latest;
    try {
      const current = await distTagSnapshot(artifact.name);
      if (current[releaseDistTag] !== snapshots.get(artifact.name)[releaseDistTag]) {
        errors.push(
          new Error(
            `${artifact.name}'s ${releaseDistTag} changed concurrently during latest rollback ` +
              `(${snapshots.get(artifact.name)[releaseDistTag] ?? 'unset'} -> ` +
              `${current[releaseDistTag] ?? 'unset'}).`,
          ),
        );
      }
      if (current.latest !== previous && current.latest !== artifact.version) {
        throw new Error(
          `${artifact.name}'s latest changed concurrently during rollback ` +
            `(${artifact.version} -> ${current.latest ?? 'unset'}).`,
        );
      }
      const result = await reconcileDistTag({
        name: artifact.name,
        tag: 'latest',
        target: artifact.version,
        previous,
        read: () => distTagVersion(artifact.name, 'latest'),
        compensate: () => compensateLatest(artifact.name, previous),
        reconcileDelayMs,
      });
      if (result.commandFailures.length > 0) {
        console.warn(
          `${artifact.name}'s latest compensation command reported ` +
            `${result.commandFailures.length} failure(s), but the bounded stability window ` +
            'observed the preflight value.',
        );
      }
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    await assertPromotionSnapshotsRestored(snapshots);
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

async function compensateLatest(name, previous) {
  if (previous) await writeDistTag(name, previous, 'latest');
  else await deleteDistTag(name, 'latest');
}

async function assertPromotionSnapshotsRestored(snapshots) {
  for (const [name, expected] of snapshots) {
    const artifact = {name, version: expected[releaseDistTag]};
    await assertRollbackMarkerMatches(artifact, expected.latest);
    const current = await distTagSnapshot(name);
    for (const tag of [releaseDistTag, 'latest']) {
      if (current[tag] === expected[tag]) continue;
      fail(
        `Final rollback verification failed for ${name}'s ${tag}: ` +
          `expected ${expected[tag] ?? 'unset'}, received ${current[tag] ?? 'unset'}.`,
      );
    }
  }
}

async function setDistTag(name, version, tag) {
  await writeDistTag(name, version, tag);
  await waitForTag(name, tag, version);
}

async function writeDistTag(name, version, tag) {
  await npmCommand(['dist-tag', 'add', `${name}@${version}`, tag]);
}

async function deleteDistTag(name, tag) {
  await npmCommand(['dist-tag', 'rm', name, tag]);
}

async function waitForTag(name, tag, expected) {
  for (const delay of [0, 1_000, 2_000, 4_000]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (await distTagVersion(name, tag) === expected) return;
  }
  fail(`${name}'s ${tag} dist-tag did not settle on ${expected ?? 'an unset value'}.`);
}

async function distTagSnapshot(name) {
  const [staging, latest] = await Promise.all([
    distTagVersion(name, releaseDistTag),
    distTagVersion(name, 'latest'),
  ]);
  return {[releaseDistTag]: staging, latest};
}

async function distTagVersion(name, tag) {
  const value = await registryValue(name, `dist-tags.${tag}`, {optional: true});
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function registryValue(spec, field, options = {}) {
  try {
    const {stdout} = await npmCommand(['view', spec, field, '--json']);
    if (!stdout.trim()) return undefined;
    return JSON.parse(stdout);
  } catch (error) {
    if (options.optional && isNotFound(error)) return undefined;
    throw error;
  }
}

function assertOfficialPromotion(manifest, releaseRunId) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    fail('Real latest promotion is allowed only from the protected GitHub Actions promotion workflow.');
  }
  if (
    process.env.GITHUB_REPOSITORY !== officialRepository ||
    process.env.GITHUB_REF_TYPE !== 'branch' ||
    process.env.GITHUB_REF_NAME !== 'main' ||
    process.env.GITHUB_REF_PROTECTED !== 'true'
  ) {
    fail('Real latest promotion requires the protected main branch in the official repository.');
  }
  const expectedWorkflowRef = `${officialRepository}/${officialWorkflowPath}@refs/heads/main`;
  if (process.env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef) {
    fail('Real latest promotion requires the official promote-release.yml workflow on main.');
  }
  const build = manifest.build?.workflow;
  const expectedReleaseWorkflowRef =
    `${officialRepository}/.github/workflows/release.yml@refs/tags/v${manifest.version}`;
  if (
    manifest.source?.gitTreeState !== 'clean' ||
    build?.provider !== 'github-actions' ||
    build.repository !== officialRepository ||
    build.workflowRef !== expectedReleaseWorkflowRef ||
    build.runId !== releaseRunId
  ) {
    fail('The archived candidate identity does not match the selected official release workflow run.');
  }
}

async function npmCommand(arguments_) {
  try {
    return await execFileAsync(npm, arguments_, {
      cwd: root,
      encoding: 'utf8',
      env: npmEnv,
      maxBuffer: 16 * 1024 * 1024,
      timeout: npmTimeoutMs,
      killSignal: 'SIGTERM',
    });
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM') {
      throw new Error(`npm ${arguments_.join(' ')} exceeded ${npmTimeoutMs} ms.`, {cause: error});
    }
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    if (output) console.error(output);
    throw error;
  }
}

function isNotFound(error) {
  const output = [error?.stdout, error?.stderr, error instanceof Error ? error.message : String(error)]
    .filter(Boolean)
    .join('\n');
  return /\bE404\b|404 Not Found|not in this registry/i.test(output);
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value || value.startsWith('--')) fail(`${option} requires a value.`);
  return value;
}

function fail(message) {
  throw new Error(message);
}
