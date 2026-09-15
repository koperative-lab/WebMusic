#!/usr/bin/env node
// ============================================================================
// License gate for the published package policy.
//
// Enforces the copyleft red-line: only permissive licenses may appear in a
// package's `dependencies` / `optionalDependencies`; every non-permissive
// `peerDependency` MUST be marked `optional: true` in `peerDependenciesMeta`.
//
// This guards against a copyleft package (pitchfinder GPL, aubiojs GPL,
// essentia.js AGPL, waveform-data LGPL) — or an MPL package — being promoted
// into a hard dependency, or a copyleft peer being silently flipped to required.
//
// The classification is by package NAME (we can't read installed licenses in a
// clean checkout), listing every restricted package the project knows about.
// Update RESTRICTED when a new optional engine is added.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packageDirectories } from './package-policy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages that must NEVER appear in dependencies/optionalDependencies, and
 *  must be `optional: true` when listed as peerDependencies. */
const RESTRICTED = {
  'pitchfinder': 'GPL-3.0',
  'aubiojs': 'GPL-3.0',
  'essentia.js': 'AGPL-3.0',
  'waveform-data': 'LGPL-3.0',
  '@soundtouchjs/audio-worklet': 'MPL-2.0',
  'mediabunny': 'MPL-2.0',
};

let failed = false;
const fail = (msg) => {
  console.error(`::error::${msg}`);
  failed = true;
};

// Scan the published manifests directly and fail loudly if one is
// unreadable — an empty scan would let a copyleft promotion slip through as
// a vacuous pass.
const packageDirs = packageDirectories.map((dir) => join(root, ...dir.split('/')));

for (const pkgDir of packageDirs) {
  const manifestPath = join(pkgDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const hard = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) };
  for (const name of Object.keys(hard)) {
    if (name in RESTRICTED) {
      fail(`${manifest.name}: ${name} (${RESTRICTED[name]}) must not be a hard/optional dependency — move it to an optional peerDependency.`);
    }
  }

  const peers = manifest.peerDependencies ?? {};
  const meta = manifest.peerDependenciesMeta ?? {};
  for (const name of Object.keys(peers)) {
    if (name in RESTRICTED && meta[name]?.optional !== true) {
      fail(`${manifest.name}: restricted peer ${name} (${RESTRICTED[name]}) must be marked { optional: true } in peerDependenciesMeta.`);
    }
  }
}

if (failed) {
  console.error('License gate failed.');
  process.exit(1);
}
console.log('License gate passed: no copyleft package in hard dependencies; all restricted peers are optional.');
