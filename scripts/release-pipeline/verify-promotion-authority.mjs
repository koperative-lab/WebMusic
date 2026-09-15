import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

export const officialRepository = 'mrsteamedbun/WebMusic';
export const releaseWorkflowPath = '.github/workflows/release.yml';
export const githubApiVersion = '2026-03-10';
export const githubRequestTimeoutMs = 15_000;
export const githubRequestAttempts = 3;

const execFileAsync = promisify(execFile);
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const gitShaPattern = /^[0-9a-f]{40,64}$/;
const positiveDecimalPattern = /^[1-9]\d*$/;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Verify a downloaded release candidate against GitHub's authoritative run,
 * workflow, and artifact records, then independently verify the current Git
 * tag and mainline ancestry. No registry state is read or mutated here.
 */
export async function verifyPromotionAuthority({
  manifest,
  releaseRunId,
  artifactName,
  token,
  fetchImpl = globalThis.fetch,
  git = runGit,
  requestTimeoutMs = githubRequestTimeoutMs,
  requestAttempts = githubRequestAttempts,
  sleep = delay,
}) {
  const identity = assertManifestIdentity(manifest, releaseRunId, artifactName);
  if (typeof token !== 'string' || token.trim().length === 0) {
    fail('GITHUB_TOKEN is required to verify promotion authority.');
  }
  if (typeof fetchImpl !== 'function') {
    fail('A Fetch implementation is required to query GitHub promotion authority.');
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    fail('GitHub request timeout must be a positive integer.');
  }
  if (!Number.isSafeInteger(requestAttempts) || requestAttempts < 1 || requestAttempts > 5) {
    fail('GitHub request attempts must be an integer from 1 through 5.');
  }

  const repositoryPath = officialRepository.split('/').map(encodeURIComponent).join('/');
  const apiBase = `https://api.github.com/repos/${repositoryPath}`;
  const request = (url) =>
    githubJson(url, {fetchImpl, token: token.trim(), requestTimeoutMs, requestAttempts, sleep});
  const run = await request(`${apiBase}/actions/runs/${identity.runId}`);
  const completedRunAttempt = assertRunIdentity(run, identity);

  const workflow = await request(`${apiBase}/actions/workflows/${run.workflow_id}`);
  assertWorkflowIdentity(workflow, run.workflow_id);

  const artifacts = await listRunArtifacts({apiBase, runId: identity.runId, request});
  const artifact = assertArtifactIdentity(artifacts, identity);

  await verifyGitAuthority(identity, git);
  return {
    runId: identity.runId,
    candidateRunAttempt: identity.runAttempt,
    completedRunAttempt,
    artifactId: artifact.id,
    artifactName: artifact.name,
    sourceSha: identity.sourceSha,
    tag: identity.tag,
  };
}

function assertManifestIdentity(manifest, releaseRunId, artifactName) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Artifact manifest must be a JSON object.');
  }
  const version = manifest.version;
  if (typeof version !== 'string' || !stableVersionPattern.test(version)) {
    fail('Artifact manifest version must be stable x.y.z semver.');
  }
  const sourceSha = manifest.source?.gitSha;
  if (typeof sourceSha !== 'string' || !gitShaPattern.test(sourceSha)) {
    fail('Artifact manifest source.gitSha must be a full lowercase Git object id.');
  }
  if (manifest.source?.gitTreeState !== 'clean') {
    fail('Artifact manifest must have been built from a clean Git worktree.');
  }
  if (typeof releaseRunId !== 'string' || !positiveDecimalPattern.test(releaseRunId)) {
    fail('release_run_id must be a positive decimal GitHub Actions run id.');
  }
  if (typeof artifactName !== 'string' || artifactName.length === 0) {
    fail('artifact_name is required.');
  }

  const workflow = manifest.build?.workflow;
  const tag = `v${version}`;
  const expectedWorkflowRef = `${officialRepository}/${releaseWorkflowPath}@refs/tags/${tag}`;
  if (
    workflow?.provider !== 'github-actions' ||
    workflow.repository !== officialRepository ||
    workflow.workflowRef !== expectedWorkflowRef ||
    workflow.runId !== releaseRunId ||
    typeof workflow.runAttempt !== 'string' ||
    !positiveDecimalPattern.test(workflow.runAttempt)
  ) {
    fail('Artifact manifest workflow identity does not match the selected official release run.');
  }

  const expectedArtifactName = `webmusic-release-${releaseRunId}-${workflow.runAttempt}`;
  if (artifactName !== expectedArtifactName) {
    fail(`artifact_name must be the immutable candidate ${expectedArtifactName}.`);
  }
  return {
    runId: releaseRunId,
    runAttempt: workflow.runAttempt,
    artifactName,
    sourceSha,
    tag,
    version,
  };
}

function assertRunIdentity(run, identity) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    fail('GitHub returned an invalid workflow run record.');
  }
  if (decimalIdentity(run.id) !== identity.runId) {
    fail('GitHub workflow run id does not match release_run_id.');
  }
  if (run.repository?.full_name !== officialRepository) {
    fail('Selected workflow run does not belong to the official repository.');
  }
  if (run.head_repository && run.head_repository.full_name !== officialRepository) {
    fail('Selected workflow run source does not belong to the official repository.');
  }
  assertRunWorkflowPath(run.path, identity.tag);
  if (!Number.isSafeInteger(run.workflow_id) || run.workflow_id <= 0) {
    fail('Selected workflow run has an invalid workflow id.');
  }
  if (run.event !== 'push') {
    fail('Selected release workflow run was not triggered by a push event.');
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    fail('Selected release workflow run is not completed successfully.');
  }
  if (run.head_sha !== identity.sourceSha) {
    fail('Selected release workflow head SHA does not match the artifact manifest source.');
  }
  const completedRunAttempt = decimalIdentity(run.run_attempt);
  if (
    completedRunAttempt === undefined ||
    BigInt(completedRunAttempt) < BigInt(identity.runAttempt)
  ) {
    fail('Selected release workflow run attempt predates the candidate artifact attempt.');
  }
  return completedRunAttempt;
}

function assertWorkflowIdentity(workflow, expectedId) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    fail('GitHub returned an invalid workflow definition record.');
  }
  if (decimalIdentity(workflow.id) !== decimalIdentity(expectedId)) {
    fail('Selected workflow run references a different workflow id.');
  }
  if (workflow.path !== releaseWorkflowPath) {
    fail(`Selected workflow id does not resolve to ${releaseWorkflowPath}.`);
  }
}

async function listRunArtifacts({apiBase, runId, request}) {
  const artifacts = [];
  let expectedTotal;
  for (let page = 1; page <= 100; page += 1) {
    const response = await request(
      `${apiBase}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
    );
    if (
      !response ||
      typeof response !== 'object' ||
      !Number.isSafeInteger(response.total_count) ||
      response.total_count < 0 ||
      !Array.isArray(response.artifacts)
    ) {
      fail('GitHub returned an invalid workflow artifact list.');
    }
    expectedTotal ??= response.total_count;
    if (response.total_count !== expectedTotal) {
      fail('GitHub workflow artifact count changed while authority was being verified.');
    }
    artifacts.push(...response.artifacts);
    if (artifacts.length >= expectedTotal) {
      if (artifacts.length !== expectedTotal) {
        fail('GitHub workflow artifact pagination returned an inconsistent count.');
      }
      return artifacts;
    }
    if (response.artifacts.length === 0) {
      fail('GitHub workflow artifact pagination ended before total_count was reached.');
    }
  }
  fail('GitHub workflow artifact list exceeded the verification page limit.');
}

function assertArtifactIdentity(artifacts, identity) {
  const matches = artifacts.filter((artifact) => artifact?.name === identity.artifactName);
  if (matches.length !== 1) {
    fail(`Selected release run must contain exactly one artifact named ${identity.artifactName}.`);
  }
  const [artifact] = matches;
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0) {
    fail('Selected release artifact has an invalid artifact id.');
  }
  if (artifact.expired !== false) {
    fail(`Selected release artifact ${identity.artifactName} is expired.`);
  }
  if (decimalIdentity(artifact.workflow_run?.id) !== identity.runId) {
    fail('Selected release artifact does not belong to release_run_id.');
  }
  if (artifact.workflow_run?.head_sha !== identity.sourceSha) {
    fail('Selected release artifact head SHA does not match the manifest source.');
  }
  return artifact;
}

async function verifyGitAuthority(identity, git) {
  if (typeof git !== 'function') fail('A Git command implementation is required.');
  const origin = (await gitOutput(git, ['remote', 'get-url', 'origin'])).trim();
  if (!isOfficialOrigin(origin)) {
    fail(`Git origin does not point to ${officialRepository}.`);
  }

  const tagRef = `refs/tags/${identity.tag}`;
  const mainRef = 'refs/remotes/origin/main';
  await gitOutput(git, [
    'fetch',
    '--force',
    '--no-tags',
    'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    `+${tagRef}:${tagRef}`,
  ]);

  const tagType = (await gitOutput(git, ['cat-file', '-t', tagRef])).trim();
  if (tagType !== 'tag') {
    fail(`Release tag ${identity.tag} is not an annotated tag.`);
  }
  const tagCommit = (await gitOutput(git, ['rev-parse', `${tagRef}^{commit}`])).trim();
  if (tagCommit !== identity.sourceSha) {
    fail(`Release tag ${identity.tag} does not point to the manifest source commit.`);
  }
  try {
    await gitOutput(git, ['merge-base', '--is-ancestor', identity.sourceSha, mainRef]);
  } catch {
    fail('Manifest source commit is not an ancestor of current origin/main.');
  }
}

async function githubJson(url, {fetchImpl, token, requestTimeoutMs, requestAttempts, sleep}) {
  let lastFailure = 'failed';
  for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let retryable = true;
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'webmusic-promotion-authority',
          'X-GitHub-Api-Version': githubApiVersion,
        },
        signal: controller.signal,
      });
      if (!response?.ok) {
        const status = Number.isSafeInteger(response?.status) ? response.status : undefined;
        retryable = status === undefined || [408, 429, 500, 502, 503, 504].includes(status);
        lastFailure = status === undefined ? 'returned an invalid response' : `returned HTTP ${status}`;
      } else {
        try {
          return await response.json();
        } catch {
          retryable = controller.signal.aborted;
          lastFailure = controller.signal.aborted ? 'timed out' : 'returned invalid JSON';
        }
      }
    } catch {
      lastFailure = controller.signal.aborted ? 'timed out' : 'failed at the network boundary';
    } finally {
      clearTimeout(timeout);
    }

    if (!retryable || attempt === requestAttempts) {
      fail(`GitHub authority request ${lastFailure}.`);
    }
    await sleep(250 * attempt);
  }
  fail(`GitHub authority request ${lastFailure}.`);
}

function assertRunWorkflowPath(value, tag) {
  if (typeof value !== 'string') {
    fail(`Selected workflow run was not created by ${releaseWorkflowPath}.`);
  }
  const separator = value.lastIndexOf('@');
  const workflowPath = separator === -1 ? value : value.slice(0, separator);
  const workflowRef = separator === -1 ? undefined : value.slice(separator + 1);
  if (workflowPath !== releaseWorkflowPath) {
    fail(`Selected workflow run was not created by ${releaseWorkflowPath}.`);
  }
  if (workflowRef !== tag && workflowRef !== `refs/tags/${tag}`) {
    fail(`Selected release workflow run path does not select tag ${tag}.`);
  }
}

function decimalIdentity(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && positiveDecimalPattern.test(value)) return value;
  return undefined;
}

function isOfficialOrigin(value) {
  const normalized = value.trim().replace(/\.git$/, '');
  return (
    normalized === `https://github.com/${officialRepository}` ||
    normalized === `git@github.com:${officialRepository}` ||
    normalized === `ssh://git@github.com/${officialRepository}`
  );
}

async function gitOutput(git, arguments_) {
  const result = await git(arguments_);
  if (typeof result === 'string') return result;
  if (result && typeof result.stdout === 'string') return result.stdout;
  fail(`Git command ${arguments_[0]} returned invalid output.`);
}

async function runGit(arguments_) {
  return execFileAsync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArguments(arguments_) {
  let manifestPath;
  let releaseRunId;
  let artifactName;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--manifest') {
      manifestPath = path.resolve(process.cwd(), requireValue(arguments_, ++index, '--manifest'));
    } else if (argument === '--release-run-id') {
      releaseRunId = requireValue(arguments_, ++index, '--release-run-id');
    } else if (argument === '--artifact-name') {
      artifactName = requireValue(arguments_, ++index, '--artifact-name');
    } else {
      fail(`Unknown argument: ${argument}.`);
    }
  }
  if (!manifestPath || !releaseRunId || !artifactName) {
    fail(
      'Usage: node scripts/verify-promotion-authority.mjs --manifest <artifact-manifest.json> ' +
        '--release-run-id <id> --artifact-name <name>.',
    );
  }
  return {manifestPath, releaseRunId, artifactName};
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value || value.startsWith('--')) fail(`${option} requires a value.`);
  return value;
}

async function main() {
  const {manifestPath, releaseRunId, artifactName} = parseArguments(process.argv.slice(2));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(`Cannot read artifact manifest: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const result = await verifyPromotionAuthority({
    manifest,
    releaseRunId,
    artifactName,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(
    `Promotion authority verified for ${result.tag}: run ${result.runId} completed at attempt ` +
      `${result.completedRunAttempt}, candidate artifact from attempt ` +
      `${result.candidateRunAttempt}: ${result.artifactName} (${result.artifactId}).`,
  );
}

function fail(message) {
  throw new Error(message);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Promotion authority verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
