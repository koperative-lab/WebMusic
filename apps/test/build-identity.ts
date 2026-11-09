// Node side of the runner's build identity: read from Git and the manifests.
// Shared by the Vite plugin below and the release verifier
// (scripts/verify-acceptance-report.mjs), so both name a build the same way.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {BuildIdentity} from './src/build.ts';

/** Publishable package directories in release order (scripts/package-policy.mjs). */
const PACKAGE_DIRECTORIES = ['platform/kernel', 'packages/ui', 'packages/score', 'packages/audio', 'bridges/score-audio'];

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return undefined;
  }
}

function manifest(path: string): {name?: string; version?: string} {
  try { return JSON.parse(readFileSync(path, 'utf8')) as {name?: string; version?: string}; } catch { return {}; }
}

export function readBuildIdentity(root: string, now = new Date()): BuildIdentity {
  const status = git(root, ['status', '--porcelain']);
  const packages: Record<string, string> = {};
  for (const directory of PACKAGE_DIRECTORIES) {
    const {name, version} = manifest(join(root, directory, 'package.json'));
    if (name) packages[name] = version ?? 'unknown';
  }
  // The packages share one release version (scripts/release-manifests.mjs).
  const versions = [...new Set(Object.values(packages))];
  return {
    version: versions.length === 1 ? versions[0]! : versions.length ? 'mixed' : 'unknown',
    commit: git(root, ['rev-parse', 'HEAD']) ?? 'unknown',
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    changes: status ? status.split('\n').filter(Boolean).length : 0,
    committedAt: git(root, ['show', '-s', '--format=%cI', 'HEAD']) ?? '',
    packages,
    generatedAt: now.toISOString(),
  };
}
