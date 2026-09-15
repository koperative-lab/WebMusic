import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readArtifactManifest, releaseManifestFormat} from './release-artifacts.mjs';

const execFileAsync = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const provenancePredicateType = 'https://slsa.dev/provenance/v1';
const defaultTimeoutMs = 180_000;

export async function verifyRegistryRelease(manifestPath, options = {}) {
  const candidate = await readArtifactManifest(manifestPath, {
    expectedProfile: releaseManifestFormat,
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-registry-release-'));
  const npmCache = path.join(directory, 'npm-cache');
  const timeoutMs = options.timeoutMs ?? registryVerificationTimeout();
  const environment = {...process.env, npm_config_cache: npmCache};

  try {
    const dependencies = Object.fromEntries(
      candidate.artifacts.map(({name, version}) => [name, version]),
    );
    await writeFile(
      path.join(directory, 'package.json'),
      `${JSON.stringify({
        name: 'webmusic-registry-release-verification',
        private: true,
        version: '0.0.0',
        dependencies,
      }, null, 2)}\n`,
    );

    console.log(`Installing the complete WebMusic ${candidate.manifest.version} graph from npm.`);
    await runNpm(
      [
        'install',
        '--ignore-scripts',
        '--package-lock=true',
        '--strict-peer-deps',
        '--no-audit',
        '--fund=false',
        '--save=false',
      ],
      {cwd: directory, environment, timeoutMs},
    );

    const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
    assertRegistryLockMatchesCandidate(lock, candidate.artifacts);

    for (const artifact of candidate.artifacts) {
      const {stdout} = await runNpm(
        ['view', `${artifact.name}@${artifact.version}`, 'dist.attestations', '--json'],
        {cwd: directory, environment, timeoutMs},
      );
      let metadata;
      try {
        metadata = stdout.trim() ? JSON.parse(stdout) : undefined;
      } catch (error) {
        throw new Error(`${artifact.name}@${artifact.version} returned malformed attestation metadata.`, {
          cause: error,
        });
      }
      assertRequiredProvenance(artifact, metadata);
    }

    console.log('Verifying registry signatures and provenance attestations for the installed graph.');
    await runNpm(['audit', 'signatures'], {cwd: directory, environment, timeoutMs});
    console.log(
      `Registry graph, manifest integrities, signatures, and provenance passed for ` +
        `${candidate.manifest.version}.`,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

export function assertRegistryLockMatchesCandidate(lock, artifacts) {
  if (!lock || typeof lock !== 'object' || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('Registry verification did not produce a package-lock with package records.');
  }

  for (const artifact of artifacts) {
    const location = `node_modules/${artifact.name}`;
    const installed = lock.packages[location];
    if (!installed || typeof installed !== 'object') {
      throw new Error(`${artifact.name}@${artifact.version} is missing from the installed registry graph.`);
    }
    if (installed.version !== artifact.version) {
      throw new Error(
        `${artifact.name} resolved to ${installed.version ?? 'an unknown version'}, ` +
          `not candidate ${artifact.version}.`,
      );
    }
    if (installed.integrity !== artifact.integrity) {
      throw new Error(
        `${artifact.name}@${artifact.version} installed with an integrity that differs from the candidate manifest.`,
      );
    }
    if (
      installed.link === true ||
      typeof installed.resolved !== 'string' ||
      !/^https:\/\/registry\.npmjs\.org\//.test(installed.resolved)
    ) {
      throw new Error(`${artifact.name}@${artifact.version} was not resolved from the public npm registry.`);
    }
  }
}

export function assertRequiredProvenance(artifact, metadata) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    typeof metadata.url !== 'string' ||
    !metadata.url.startsWith('https://registry.npmjs.org/-/npm/v1/attestations/') ||
    metadata.provenance?.predicateType !== provenancePredicateType
  ) {
    throw new Error(
      `${artifact.name}@${artifact.version} does not expose the required npm SLSA provenance attestation.`,
    );
  }
}

function registryVerificationTimeout() {
  const raw = process.env.WEBSCORE_REGISTRY_VERIFY_TIMEOUT_MS;
  if (raw === undefined) return defaultTimeoutMs;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error('WEBSCORE_REGISTRY_VERIFY_TIMEOUT_MS must be a positive safe integer.');
  }
  return Number(raw);
}

async function runNpm(arguments_, {cwd, environment, timeoutMs}) {
  try {
    const result = await execFileAsync(npm, arguments_, {
      cwd,
      encoding: 'utf8',
      env: environment,
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });
    if (result.stdout.trim() && arguments_[0] === 'audit') console.log(result.stdout.trim());
    return result;
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM') {
      throw new Error(`npm ${arguments_.join(' ')} exceeded ${timeoutMs} ms.`, {cause: error});
    }
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    if (output) console.error(output);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = parseArguments(process.argv.slice(2));
  await verifyRegistryRelease(manifestPath);
}

function parseArguments(arguments_) {
  let manifestPath;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== '--manifest') throw new Error(`Unknown argument: ${argument}.`);
    const value = arguments_[++index];
    if (!value || value.startsWith('--')) throw new Error('--manifest requires a path.');
    manifestPath = path.resolve(value);
  }
  if (!manifestPath) {
    throw new Error(
      'Usage: node scripts/verify-registry-release.mjs --manifest <artifact-manifest.json>.',
    );
  }
  return manifestPath;
}
