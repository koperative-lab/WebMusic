import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  artifactManifestFileName,
  artifactManifestSchemaVersion,
  assertNoPackagingLifecycle,
  integrityForFile,
  loadWorkspaceReleaseManifests,
  readArtifactManifest,
  releaseManifestFormat,
  sharedStableVersion,
} from './release-artifacts.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const {output, profile} = parseArguments(process.argv.slice(2));
const outputDirectory = path.resolve(root, output);
const tarballDirectory = path.join(outputDirectory, 'tarballs');
const manifestPath = path.join(outputDirectory, artifactManifestFileName);
const npmCache = await mkdtemp(path.join(tmpdir(), 'webmusic-artifact-npm-cache-'));
const npmEnv = {...process.env, npm_config_cache: npmCache};
let ownsOutputDirectory = false;

try {
  await mkdir(path.dirname(outputDirectory), {recursive: true});
  try {
    await mkdir(outputDirectory);
    ownsOutputDirectory = true;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail(`Release artifact output already exists: ${outputDirectory}. Refusing to overwrite a candidate.`);
    }
    throw error;
  }
  await mkdir(tarballDirectory);

  const sourceBeforeBuild = await sourceIdentity();
  const workspaces = await loadWorkspaceReleaseManifests(root);
  const version = sharedStableVersion(workspaces);
  for (const workspace of workspaces) assertNoPackagingLifecycle(workspace);

  console.log(`Building release packages once for ${version}.`);
  await run(npm, ['run', 'build:packages']);

  const artifacts = [];
  for (const workspace of workspaces) {
    console.log(`Packing ${workspace.name}@${version}.`);
    const {stdout} = await run(npm, [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      tarballDirectory,
      '--workspace',
      workspace.name,
    ]);
    const result = parsePackResult(stdout, workspace.name, version);
    const absoluteTarball = path.join(tarballDirectory, result.filename);
    const fileStat = await stat(absoluteTarball);
    const integrity = await integrityForFile(absoluteTarball);
    if (result.integrity !== integrity) {
      fail(`${workspace.name} npm pack integrity does not match the generated tarball bytes.`);
    }
    if (Number.isSafeInteger(result.size) && result.size !== fileStat.size) {
      fail(`${workspace.name} npm pack size does not match the generated tarball bytes.`);
    }
    artifacts.push({
      name: workspace.name,
      version,
      file: path.posix.join('tarballs', result.filename),
      integrity,
      size: fileStat.size,
    });
  }

  const sourceAfterBuild = await sourceIdentity();
  if (sourceAfterBuild.source.gitSha !== sourceBeforeBuild.source.gitSha) {
    fail(
      `Git HEAD changed while building release artifacts ` +
        `(${sourceBeforeBuild.source.gitSha} -> ${sourceAfterBuild.source.gitSha}).`,
    );
  }
  if (sourceAfterBuild.status !== sourceBeforeBuild.status) {
    fail('The Git worktree changed while building/packing release artifacts; review the generated diff and retry.');
  }
  const npmVersion = (await run(npm, ['--version'])).stdout.trim();
  const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const manifest = {
    schemaVersion: artifactManifestSchemaVersion,
    profile,
    version,
    createdAt: new Date().toISOString(),
    source: sourceBeforeBuild.source,
    toolchain: {
      node: process.version,
      npm: npmVersion,
      lockfileVersion: lockfile.lockfileVersion,
    },
    build: {
      command: 'npm run build:packages',
      packCommand: 'npm pack --json --ignore-scripts',
      workflow: workflowIdentity(),
    },
    artifacts,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
  await readArtifactManifest(manifestPath, {expectedProfile: profile});
  console.log(`Release artifact manifest written to ${manifestPath}.`);
} catch (error) {
  if (ownsOutputDirectory) await rm(outputDirectory, {recursive: true, force: true});
  throw error;
} finally {
  await rm(npmCache, {recursive: true, force: true});
}

function parseArguments(arguments_) {
  let output;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--output') {
      output = requireValue(arguments_, ++index, '--output');
    } else {
      fail(`Unknown argument: ${argument}.`);
    }
  }
  if (!output) fail('Usage: node scripts/create-release-artifacts.mjs --output <directory>.');
  return {output, profile: releaseManifestFormat};
}

function workflowIdentity() {
  if (process.env.GITHUB_ACTIONS !== 'true') return {provider: 'local'};
  return {
    provider: 'github-actions',
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value || value.startsWith('--')) fail(`${option} requires a value.`);
  return value;
}

function parsePackResult(stdout, expectedName, expectedVersion) {
  let results;
  try {
    results = JSON.parse(stdout);
  } catch {
    fail(`npm pack returned invalid JSON for ${expectedName}.`);
  }
  const [result] = results ?? [];
  if (
    results?.length !== 1 ||
    result.name !== expectedName ||
    result.version !== expectedVersion ||
    typeof result.filename !== 'string' ||
    path.basename(result.filename) !== result.filename ||
    !result.filename.endsWith('.tgz') ||
    typeof result.integrity !== 'string'
  ) {
    fail(`npm pack returned unexpected metadata for ${expectedName}@${expectedVersion}.`);
  }
  return result;
}

async function sourceIdentity() {
  const gitSha = (await git(['rev-parse', 'HEAD'])).trim();
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all']);
  return {
    source: {gitSha, gitTreeState: status.trim().length === 0 ? 'clean' : 'dirty'},
    status,
  };
}

async function git(arguments_) {
  return (await execFileAsync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })).stdout;
}

async function run(command, arguments_) {
  try {
    return await execFileAsync(command, arguments_, {
      cwd: root,
      encoding: 'utf8',
      env: npmEnv,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const commandOutput = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    if (commandOutput) console.error(commandOutput);
    throw error;
  }
}

function fail(message) {
  throw new Error(message);
}
