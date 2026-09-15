import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {releasePackageNames} from './release-packages.mjs';

export const artifactManifestFileName = 'artifact-manifest.json';
export const artifactManifestSchemaVersion = 1;
export const releaseManifestFormat = 'webmusic-1';
export const releaseDistTag = 'staging';

const lifecycleScripts = ['prepublish', 'prepare', 'prepublishOnly', 'prepack', 'postpack'];
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const integrityPattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const gitShaPattern = /^[0-9a-f]{40,64}$/;

export async function loadWorkspaceReleaseManifests(root) {
  return Promise.all(releasePackageNames.map(async (name) => ({
    name,
    path: manifestPath(root, name),
    value: JSON.parse(await readFile(manifestPath(root, name), 'utf8')),
  })));
}

export function sharedStableVersion(entries) {
  const versions = [...new Set(entries.map(({value}) => value.version))];
  if (versions.length !== 1 || !stableVersionPattern.test(versions[0] ?? '')) {
    fail(`Release packages must share one stable x.y.z version; found ${versions.join(', ')}.`);
  }
  return versions[0];
}

/** Compare two stable SemVer core versions without losing precision. */
export function compareStableVersions(left, right) {
  if (!stableVersionPattern.test(left) || !stableVersionPattern.test(right)) return undefined;
  const leftParts = left.split('.').map(BigInt);
  const rightParts = right.split('.').map(BigInt);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function releaseUploadDistTag(version) {
  if (!stableVersionPattern.test(version)) {
    fail(`Release upload tag requires a stable x.y.z version; received ${JSON.stringify(version)}.`);
  }
  return `webmusic-staging-v${version}`;
}

export function assertReleaseTagSelectionDoesNotMoveBackward(artifact, tag, selected) {
  if (!selected || selected === artifact.version) return;
  const comparison = compareStableVersions(selected, artifact.version);
  if (comparison == null) {
    fail(
      `${artifact.name}'s ${tag} dist-tag selects non-stable version ${selected}; ` +
        'refusing to overwrite it from the stable release workflow.',
    );
  }
  if (comparison > 0) {
    fail(
      `${artifact.name}'s ${tag} dist-tag already selects newer version ${selected}; ` +
        `refusing to move it backward to ${artifact.version}.`,
    );
  }
}

export function assertDistTagSnapshotUnchanged(artifact, expected, current) {
  for (const tag of [releaseDistTag, 'latest']) {
    const before = expected[tag];
    const now = current[tag];
    if (before !== now) {
      fail(
        `${artifact.name}'s ${tag} dist-tag changed concurrently ` +
          `(${before ?? 'unset'} -> ${now ?? 'unset'}); refusing to mutate release tags.`,
      );
    }
  }
}

export function releaseTagMutationState(artifact, before, current) {
  if (current.latest !== before.latest) {
    fail(
      `${artifact.name}'s latest dist-tag changed concurrently ` +
        `(${before.latest ?? 'unset'} -> ${current.latest ?? 'unset'}) while staging the release.`,
    );
  }
  const currentStaging = current[releaseDistTag];
  const previousStaging = before[releaseDistTag];
  if (currentStaging === artifact.version) return 'applied';
  if (currentStaging === previousStaging) return 'pending';
  fail(
    `${artifact.name}'s ${releaseDistTag} dist-tag changed concurrently ` +
      `(${previousStaging ?? 'unset'} -> ${currentStaging ?? 'unset'}) after the update; ` +
      'it will not be overwritten again.',
  );
}

export function assertNoPackagingLifecycle({name, value}) {
  const configured = lifecycleScripts.filter((script) => value.scripts?.[script]);
  if (configured.length > 0) {
    fail(
      `${name} defines npm packaging lifecycle script(s): ${configured.join(', ')}. ` +
        'Release artifact identity depends on packaging with --ignore-scripts.',
    );
  }
}

export async function integrityForFile(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha512-${hash.digest('base64')}`;
}

export async function readArtifactManifest(manifestFile, options = {}) {
  const absoluteManifestPath = path.resolve(manifestFile);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(absoluteManifestPath, 'utf8'));
  } catch (error) {
    fail(
      `Cannot read release artifact manifest ${absoluteManifestPath}: ` +
        `${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  validateManifestShape(manifest, options.expectedProfile);
  const directory = path.dirname(absoluteManifestPath);
  const realDirectory = await realpath(directory);
  const artifacts = [];

  for (const artifact of manifest.artifacts) {
    const absolutePath = resolveArtifactPath(directory, artifact.file);
    const fileInfo = await lstat(absolutePath).catch((error) => {
      fail(`Cannot access release artifact ${artifact.file}: ${error instanceof Error ? error.message : String(error)}.`);
    });
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      fail(`Release artifact ${artifact.file} must be a regular, non-symlink file.`);
    }
    const realArtifactPath = await realpath(absolutePath);
    if (escapesDirectory(realDirectory, realArtifactPath)) {
      fail(`Release artifact ${artifact.file} resolves outside its manifest directory.`);
    }
    const fileStat = await stat(realArtifactPath);
    if (fileStat.size !== artifact.size) {
      fail(
        `Release artifact ${artifact.file} has size ${fileStat.size}, ` +
          `but the manifest records ${artifact.size}.`,
      );
    }
    const integrity = await integrityForFile(realArtifactPath);
    if (integrity !== artifact.integrity) {
      fail(`Release artifact ${artifact.file} does not match its recorded SHA-512 integrity.`);
    }
    artifacts.push({...artifact, absolutePath: realArtifactPath});
  }

  return {manifest, manifestPath: absoluteManifestPath, artifacts};
}

/**
 * Copy a verified candidate into a private, read-only directory and validate
 * the copied bytes again. Consumers must use the returned paths rather than
 * the caller-controlled originals, closing the validation/use path-replacement
 * window for install and publish commands.
 */
export async function createValidatedArtifactSnapshot(candidate) {
  const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-release-snapshot-'));
  const tarballDirectory = path.join(directory, 'tarballs');
  const snapshotManifestPath = path.join(directory, artifactManifestFileName);
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await chmod(directory, 0o700).catch(() => {});
    await chmod(tarballDirectory, 0o700).catch(() => {});
    await rm(directory, {recursive: true, force: true});
  };

  try {
    await chmod(directory, 0o700);
    await mkdir(tarballDirectory, {mode: 0o700});
    const snapshotArtifacts = [];

    for (let index = 0; index < candidate.artifacts.length; index += 1) {
      const artifact = candidate.artifacts[index];
      const sourceInfo = await lstat(artifact.absolutePath).catch((error) => {
        fail(
          `Cannot snapshot release artifact ${artifact.file}: ` +
            `${error instanceof Error ? error.message : String(error)}.`,
        );
      });
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
        fail(`Release artifact ${artifact.file} changed before snapshotting or is now a symlink.`);
      }

      const bytes = await readFile(artifact.absolutePath);
      const snapshotFile = path.posix.join(
        'tarballs',
        `${String(index + 1).padStart(2, '0')}-${path.posix.basename(artifact.file)}`,
      );
      const snapshotPath = path.join(directory, snapshotFile);
      await writeFile(snapshotPath, bytes, {flag: 'wx', mode: 0o400});
      snapshotArtifacts.push({
        name: artifact.name,
        version: artifact.version,
        file: snapshotFile,
        integrity: artifact.integrity,
        size: artifact.size,
      });
    }

    const snapshotManifest = {...candidate.manifest, artifacts: snapshotArtifacts};
    await writeFile(snapshotManifestPath, `${JSON.stringify(snapshotManifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o400,
    });
    const snapshotCandidate = await readArtifactManifest(snapshotManifestPath, {
      expectedProfile: candidate.manifest.profile,
    });
    await Promise.all(snapshotCandidate.artifacts.map(({absolutePath}) => chmod(absolutePath, 0o400)));
    await chmod(snapshotManifestPath, 0o400);
    await chmod(tarballDirectory, 0o500);
    await chmod(directory, 0o500);
    return {candidate: snapshotCandidate, directory, cleanup};
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function assertManifestMatchesWorkspace(root, manifest) {
  const workspaces = await loadWorkspaceReleaseManifests(root);
  const version = sharedStableVersion(workspaces);
  if (manifest.version !== version) {
    fail(`Artifact manifest version ${manifest.version} does not match workspace version ${version}.`);
  }
  for (const entry of workspaces) {
    assertNoPackagingLifecycle(entry);
    const artifact = manifest.artifacts.find(({name}) => name === entry.name);
    if (!artifact || artifact.version !== entry.value.version) {
      fail(`${entry.name} does not match the artifact manifest version.`);
    }
  }
  return {version, workspaces};
}

export function npmPublishArguments(artifactPath, {dryRun = false, version} = {}) {
  if (releaseDistTag === 'latest') fail('Release candidates must never publish directly to latest.');
  const result = [
    'publish',
    artifactPath,
    '--tag',
    releaseUploadDistTag(version),
    '--provenance',
    '--access',
    'public',
    '--ignore-scripts',
  ];
  if (dryRun) result.push('--dry-run');
  return result;
}

function validateManifestShape(manifest, expectedProfile) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Release artifact manifest must be a JSON object.');
  }
  if (manifest.schemaVersion !== artifactManifestSchemaVersion) {
    fail(
      `Unsupported artifact manifest schema ${JSON.stringify(manifest.schemaVersion)}; ` +
        `expected ${artifactManifestSchemaVersion}.`,
    );
  }
  if (typeof manifest.profile !== 'string' || !/^webmusic-\d+$/.test(manifest.profile)) {
    fail('Release artifact manifest must name a webmusic-* manifest format.');
  }
  if (expectedProfile && manifest.profile !== expectedProfile) {
    fail(`Artifact manifest format ${manifest.profile} does not match expected format ${expectedProfile}.`);
  }
  if (!stableVersionPattern.test(manifest.version ?? '')) {
    fail(`Artifact manifest version ${JSON.stringify(manifest.version)} is not stable x.y.z semver.`);
  }
  if (
    typeof manifest.createdAt !== 'string' ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    new Date(manifest.createdAt).toISOString() !== manifest.createdAt
  ) {
    fail('Release artifact manifest createdAt must be an ISO timestamp.');
  }
  if (!manifest.source || !gitShaPattern.test(manifest.source.gitSha ?? '')) {
    fail('Release artifact manifest source.gitSha must be a full Git object id.');
  }
  if (!['clean', 'dirty'].includes(manifest.source.gitTreeState)) {
    fail('Release artifact manifest source.gitTreeState must be clean or dirty.');
  }
  if (!manifest.toolchain || typeof manifest.toolchain.node !== 'string' || manifest.toolchain.node.length === 0) {
    fail('Release artifact manifest toolchain.node is required.');
  }
  if (typeof manifest.toolchain.npm !== 'string' || manifest.toolchain.npm.length === 0) {
    fail('Release artifact manifest toolchain.npm is required.');
  }
  validateBuildIdentity(manifest.build);
  if (!Array.isArray(manifest.artifacts)) fail('Release artifact manifest artifacts must be an array.');
  if (manifest.artifacts.length !== releasePackageNames.length) {
    fail(
      `Artifact manifest contains ${manifest.artifacts.length} package(s); ` +
        `expected ${releasePackageNames.length}.`,
    );
  }

  const files = new Set();
  for (let index = 0; index < releasePackageNames.length; index += 1) {
    const artifact = manifest.artifacts[index];
    const expectedName = releasePackageNames[index];
    if (!artifact || artifact.name !== expectedName) {
      fail(`Artifact ${index + 1} must be ${expectedName} in release dependency order.`);
    }
    if (artifact.version !== manifest.version) {
      fail(`${artifact.name} artifact version ${artifact.version} does not match ${manifest.version}.`);
    }
    if (typeof artifact.file !== 'string' || artifact.file.length === 0) {
      fail(`${artifact.name} artifact file is required.`);
    }
    if (
      !artifact.file.startsWith('tarballs/') ||
      path.posix.normalize(artifact.file) !== artifact.file ||
      path.posix.extname(artifact.file) !== '.tgz'
    ) {
      fail(`${artifact.name} artifact file must be a canonical relative .tgz path under tarballs/.`);
    }
    if (files.has(artifact.file)) fail(`Artifact file ${artifact.file} is listed more than once.`);
    files.add(artifact.file);
    if (!integrityPattern.test(artifact.integrity ?? '')) {
      fail(`${artifact.name} artifact integrity must be a SHA-512 Subresource Integrity value.`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      fail(`${artifact.name} artifact size must be a positive integer.`);
    }
  }
}

function validateBuildIdentity(build) {
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    fail('Release artifact manifest build identity is required.');
  }
  if (build.command !== 'npm run build:packages') {
    fail('Release artifact manifest build.command must identify the package build gate.');
  }
  if (build.packCommand !== 'npm pack --json --ignore-scripts') {
    fail('Release artifact manifest build.packCommand must identify the script-free pack operation.');
  }
  const workflow = build.workflow;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    fail('Release artifact manifest build.workflow identity is required.');
  }
  if (workflow.provider === 'local') {
    const unexpected = Object.keys(workflow).filter((key) => key !== 'provider');
    if (unexpected.length > 0) fail('A local artifact workflow identity must contain only its provider.');
    return;
  }
  if (workflow.provider !== 'github-actions') {
    fail(`Unsupported release artifact workflow provider ${JSON.stringify(workflow.provider)}.`);
  }
  for (const field of ['repository', 'workflowRef', 'runId', 'runAttempt']) {
    if (typeof workflow[field] !== 'string' || workflow[field].length === 0) {
      fail(`GitHub Actions artifact workflow ${field} is required.`);
    }
  }
  if (!/^\d+$/.test(workflow.runId) || !/^[1-9]\d*$/.test(workflow.runAttempt)) {
    fail('GitHub Actions artifact workflow runId/runAttempt must be positive decimal identities.');
  }
  const prefix = `${workflow.repository}/.github/workflows/`;
  if (!workflow.workflowRef.startsWith(prefix) || !workflow.workflowRef.includes('@refs/')) {
    fail('GitHub Actions artifact workflowRef must belong to the recorded repository and an explicit ref.');
  }
}

function resolveArtifactPath(directory, relativeFile) {
  if (path.isAbsolute(relativeFile)) fail(`Artifact file ${relativeFile} must be relative to its manifest.`);
  const absolutePath = path.resolve(directory, relativeFile);
  if (escapesDirectory(directory, absolutePath)) {
    fail(`Artifact file ${relativeFile} escapes its manifest directory.`);
  }
  return absolutePath;
}

function escapesDirectory(directory, file) {
  const relative = path.relative(directory, file);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function manifestPath(root, name) {
  if (name === '@webmusic/kernel') return path.join(root, 'platform', 'kernel', 'package.json');
  if (name === '@webmusic/score-audio') return path.join(root, 'bridges', 'score-audio', 'package.json');
  const family = name.startsWith('@webaudio/') ? 'audio' : 'score';
  const basename = name.replace(/^@[a-z]+\//, '');
  return path.join(root, 'packages', family, basename, 'package.json');
}

function fail(message) {
  throw new Error(message);
}
