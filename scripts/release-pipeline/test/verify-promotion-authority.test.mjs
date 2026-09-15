import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  githubApiVersion,
  officialRepository,
  releaseWorkflowPath,
  verifyPromotionAuthority,
} from '../verify-promotion-authority.mjs';

const runId = '12345';
const runAttempt = '2';
const version = '1.2.3';
const tag = `v${version}`;
const sourceSha = 'a'.repeat(40);
const artifactName = `webmusic-release-${runId}-${runAttempt}`;
const workflowId = 987;

test('verifies the authoritative run, workflow, artifact, annotated tag, and mainline ancestry', async () => {
  const fixture = createFixture();
  const fetchCalls = [];
  const gitCalls = [];
  const result = await verifyPromotionAuthority({
    manifest: fixture.manifest,
    releaseRunId: runId,
    artifactName,
    token: 'github-token',
    fetchImpl: createFetch(fixture, fetchCalls),
    git: createGit({}, gitCalls),
  });

  assert.deepEqual(result, {
    runId,
    candidateRunAttempt: runAttempt,
    completedRunAttempt: runAttempt,
    artifactId: 456,
    artifactName,
    sourceSha,
    tag,
  });
  assert.equal(fetchCalls.length, 3);
  assert.match(fetchCalls[0].url, new RegExp(`/actions/runs/${runId}$`));
  assert.match(fetchCalls[1].url, new RegExp(`/actions/workflows/${workflowId}$`));
  assert.match(fetchCalls[2].url, new RegExp(`/actions/runs/${runId}/artifacts\\?per_page=100&page=1$`));
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer github-token');
  assert.equal(fetchCalls[0].options.headers['X-GitHub-Api-Version'], githubApiVersion);
  assert.deepEqual(gitCalls, [
    ['remote', 'get-url', 'origin'],
    [
      'fetch',
      '--force',
      '--no-tags',
      'origin',
      '+refs/heads/main:refs/remotes/origin/main',
      `+refs/tags/${tag}:refs/tags/${tag}`,
    ],
    ['cat-file', '-t', `refs/tags/${tag}`],
    ['rev-parse', `refs/tags/${tag}^{commit}`],
    ['merge-base', '--is-ancestor', sourceSha, 'refs/remotes/origin/main'],
  ]);
});

test('accepts a successful later run attempt that reuses an earlier candidate artifact', async () => {
  const fixture = createFixture();
  fixture.run.run_attempt = Number(runAttempt) + 1;
  const result = await verifyPromotionAuthority({
    manifest: fixture.manifest,
    releaseRunId: runId,
    artifactName,
    token: 'github-token',
    fetchImpl: createFetch(fixture),
    git: createGit(),
  });

  assert.equal(result.candidateRunAttempt, runAttempt);
  assert.equal(result.completedRunAttempt, String(Number(runAttempt) + 1));
});

test('paginates the selected run artifact list before accepting the exact candidate', async () => {
  const fixture = createFixture();
  fixture.artifactPages = [
    {
      total_count: 101,
      artifacts: Array.from({length: 100}, (_, index) => ({
        ...fixture.artifacts.artifacts[0],
        id: 1000 + index,
        name: `unrelated-${index}`,
      })),
    },
    fixture.artifacts,
  ];
  fixture.artifactPages[1].total_count = 101;
  const fetchCalls = [];

  await verifyPromotionAuthority({
    manifest: fixture.manifest,
    releaseRunId: runId,
    artifactName,
    token: 'github-token',
    fetchImpl: createFetch(fixture, fetchCalls),
    git: createGit(),
  });

  assert.match(fetchCalls[3].url, /artifacts\?per_page=100&page=2$/);
});

test('retries transient GitHub failures within the configured attempt bound', async () => {
  const fixture = createFixture();
  const delegate = createFetch(fixture);
  const delays = [];
  let runAttempts = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith(`/actions/runs/${runId}`) && runAttempts++ === 0) {
      return jsonResponse({message: 'temporarily unavailable'}, 503);
    }
    return delegate(url, options);
  };

  await verifyPromotionAuthority({
    manifest: fixture.manifest,
    releaseRunId: runId,
    artifactName,
    token: 'github-token',
    fetchImpl,
    git: createGit(),
    requestAttempts: 2,
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(runAttempts, 2);
  assert.deepEqual(delays, [250]);
});

test('aborts a GitHub request at the configured timeout bound', async () => {
  const fixture = createFixture();
  const fetchImpl = async (_url, {signal}) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
    });

  await assert.rejects(
    verifyPromotionAuthority({
      manifest: fixture.manifest,
      releaseRunId: runId,
      artifactName,
      token: 'github-token',
      fetchImpl,
      git: createGit(),
      requestTimeoutMs: 5,
      requestAttempts: 1,
    }),
    /timed out/i,
  );
});

for (const [name, mutate, pattern] of [
  [
    'rejects a run from another repository',
    (fixture) => (fixture.run.repository.full_name = 'attacker/WebScore'),
    /official repository/i,
  ],
  [
    'rejects a different workflow path',
    (fixture) => (fixture.run.path = '.github/workflows/other.yml@refs/tags/v1.2.3'),
    /release\.yml/i,
  ],
  ['rejects a manual workflow run', (fixture) => (fixture.run.event = 'workflow_dispatch'), /push event/i],
  ['rejects an incomplete workflow run', (fixture) => (fixture.run.status = 'in_progress'), /completed successfully/i],
  ['rejects a failed workflow run', (fixture) => (fixture.run.conclusion = 'failure'), /completed successfully/i],
  ['rejects a different run head SHA', (fixture) => (fixture.run.head_sha = 'b'.repeat(40)), /head SHA/i],
  ['rejects a run attempt before the candidate was built', (fixture) => (fixture.run.run_attempt = 1), /predates/i],
  [
    'rejects a run whose workflow path selects another tag',
    (fixture) => (fixture.run.path = `${releaseWorkflowPath}@refs/tags/v9.9.9`),
    /tag v1\.2\.3/i,
  ],
  [
    'rejects a workflow id resolving to another path',
    (fixture) => (fixture.workflow.path = '.github/workflows/other.yml'),
    /workflow id.*release\.yml/i,
  ],
  ['rejects a missing named artifact', (fixture) => (fixture.artifacts.artifacts[0].name = 'other'), /exactly one artifact/i],
  ['rejects an expired artifact', (fixture) => (fixture.artifacts.artifacts[0].expired = true), /expired/i],
  [
    'rejects an artifact owned by another run',
    (fixture) => (fixture.artifacts.artifacts[0].workflow_run.id = 99999),
    /does not belong/i,
  ],
]) {
  test(name, async () => {
    const fixture = createFixture();
    mutate(fixture);
    await assert.rejects(
      verifyPromotionAuthority({
        manifest: fixture.manifest,
        releaseRunId: runId,
        artifactName,
        token: 'github-token',
        fetchImpl: createFetch(fixture),
        git: createGit(),
      }),
      pattern,
    );
  });
}

test('rejects manifest-selected run or artifact identity before querying GitHub', async () => {
  const fixture = createFixture();
  const fetchImpl = async () => {
    throw new Error('fetch must not run');
  };

  await assert.rejects(
    verifyPromotionAuthority({
      manifest: fixture.manifest,
      releaseRunId: '54321',
      artifactName,
      token: 'github-token',
      fetchImpl,
      git: createGit(),
    }),
    /manifest workflow identity/i,
  );
  await assert.rejects(
    verifyPromotionAuthority({
      manifest: fixture.manifest,
      releaseRunId: runId,
      artifactName: 'untrusted-artifact',
      token: 'github-token',
      fetchImpl,
      git: createGit(),
    }),
    /immutable candidate/i,
  );
});

for (const [name, gitOptions, pattern] of [
  ['rejects a non-official origin', {origin: 'https://github.com/attacker/WebScore.git'}, /Git origin/i],
  ['rejects a lightweight release tag', {tagType: 'commit'}, /annotated tag/i],
  ['rejects a tag targeting another commit', {tagCommit: 'b'.repeat(40)}, /does not point/i],
  ['rejects a source outside current origin/main', {ancestor: false}, /ancestor.*origin\/main/i],
]) {
  test(name, async () => {
    const fixture = createFixture();
    await assert.rejects(
      verifyPromotionAuthority({
        manifest: fixture.manifest,
        releaseRunId: runId,
        artifactName,
        token: 'github-token',
        fetchImpl: createFetch(fixture),
        git: createGit(gitOptions),
      }),
      pattern,
    );
  });
}

test('requires GITHUB_TOKEN before making GitHub requests', async () => {
  const fixture = createFixture();
  await assert.rejects(
    verifyPromotionAuthority({
      manifest: fixture.manifest,
      releaseRunId: runId,
      artifactName,
      token: '',
      fetchImpl: createFetch(fixture),
      git: createGit(),
    }),
    /GITHUB_TOKEN/i,
  );
});

test('promotion workflow runs authority and credential-free registry verification before mutation', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/promote-release.yml', import.meta.url),
    'utf8',
  );
  const download = workflow.indexOf('Download the selected immutable candidate');
  const authority = workflow.indexOf(
    '- name: Verify selected release run and artifact authority',
  );
  const registry = workflow.indexOf(
    '- name: Verify the complete staged registry release',
  );
  const mutation = workflow.indexOf(
    'name: Promote or recover incomplete latest with durable markers',
  );
  const registryEnd = workflow.indexOf('\n      - name:', registry + 1);

  assert.ok(download >= 0 && download < authority);
  assert.ok(authority < registry && registry < mutation);
  const authorityStep = workflow.slice(authority, registry);
  const registryStep = workflow.slice(registry, registryEnd);
  assert.match(authorityStep, /node scripts\/verify-promotion-authority\.mjs/);
  assert.match(authorityStep, /GITHUB_TOKEN/);
  assert.match(authorityStep, /--release-run-id/);
  assert.match(authorityStep, /--artifact-name/);
  assert.doesNotMatch(registryStep, /GITHUB_TOKEN|NODE_AUTH_TOKEN|secrets\.NPM_TOKEN/);
  assert.match(registryStep, /if: inputs\.operation != 'recover'/);
  for (const runBody of workflow.matchAll(/\n\s+run:\s*(?:\||>-)[^\n]*\n([\s\S]*?)(?=\n\s+- name:|\n\s+- uses:|\n\S|$)/g)) {
    assert.doesNotMatch(
      runBody[1],
      /\$\{\{\s*inputs\./,
      'workflow_dispatch inputs must enter shell steps through step env variables',
    );
  }
});

function createFixture() {
  const manifest = {
    version,
    source: {gitSha: sourceSha, gitTreeState: 'clean'},
    build: {
      workflow: {
        provider: 'github-actions',
        repository: officialRepository,
        workflowRef: `${officialRepository}/${releaseWorkflowPath}@refs/tags/${tag}`,
        runId,
        runAttempt,
      },
    },
  };
  const run = {
    id: Number(runId),
    repository: {full_name: officialRepository},
    head_repository: {full_name: officialRepository},
    path: `${releaseWorkflowPath}@refs/tags/${tag}`,
    workflow_id: workflowId,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_sha: sourceSha,
    run_attempt: Number(runAttempt),
    // GitHub documents this as a branch-oriented field; tag authority is
    // instead bound through run.path plus the independently fetched Git tag.
    head_branch: 'main',
  };
  const workflow = {id: workflowId, path: releaseWorkflowPath, state: 'active'};
  const artifacts = {
    total_count: 1,
    artifacts: [
      {
        id: 456,
        name: artifactName,
        expired: false,
        workflow_run: {
          id: Number(runId),
          head_sha: sourceSha,
          head_branch: 'main',
        },
      },
    ],
  };
  return {manifest, run, workflow, artifacts};
}

function createFetch(fixture, calls = []) {
  let artifactPage = 0;
  return async (url, options) => {
    calls.push({url, options});
    if (url.endsWith(`/actions/runs/${runId}`)) return jsonResponse(fixture.run);
    if (url.endsWith(`/actions/workflows/${workflowId}`)) return jsonResponse(fixture.workflow);
    if (url.includes(`/actions/runs/${runId}/artifacts?`)) {
      const response = fixture.artifactPages?.[artifactPage] ?? fixture.artifacts;
      artifactPage += 1;
      return jsonResponse(response);
    }
    return jsonResponse({message: 'not found'}, 404);
  };
}

function createGit(options = {}, calls = []) {
  const origin = options.origin ?? `https://github.com/${officialRepository}.git`;
  const tagType = options.tagType ?? 'tag';
  const tagCommit = options.tagCommit ?? sourceSha;
  const ancestor = options.ancestor ?? true;
  return async (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'remote') return {stdout: `${origin}\n`};
    if (arguments_[0] === 'fetch') return {stdout: ''};
    if (arguments_[0] === 'cat-file') return {stdout: `${tagType}\n`};
    if (arguments_[0] === 'rev-parse') return {stdout: `${tagCommit}\n`};
    if (arguments_[0] === 'merge-base') {
      if (!ancestor) throw new Error('not an ancestor');
      return {stdout: ''};
    }
    throw new Error(`Unexpected git command: ${arguments_.join(' ')}`);
  };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(value),
  };
}
