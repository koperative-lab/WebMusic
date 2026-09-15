// Guards the failure mode that kept CI red for every run between the
// workflow's restoration (2026-08-15) and 2026-08-22: npm's optional-
// dependency bug (npm/cli#4828). Regenerating package-lock.json over an
// existing node_modules prunes the platform-native optional packages that
// were not installed on the authoring machine, so a lock written on macOS
// can record @rollup/rollup-darwin-arm64 and nothing else. `npm ci` on a
// Linux runner then produces a tree where rollup cannot load its binary and
// every tsup build dies before the first check runs.
//
// The rule: every optional dependency any locked package declares must
// itself be present in the lock. That is what a clean `npm install` writes,
// and it is what makes the lock installable on every platform. The fix when
// this fails is always the same — delete node_modules AND package-lock.json,
// then `npm install` fresh (the same recipe DEVELOPMENT.md gives for a
// changed override).
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const packages = lock.packages ?? {};

// A lock path is a tree location ("node_modules/a/node_modules/b"); the
// package name is whatever follows the last "node_modules/" segment.
const present = new Set();
for (const treePath of Object.keys(packages)) {
  const marker = treePath.lastIndexOf('node_modules/');
  if (marker >= 0) present.add(treePath.slice(marker + 'node_modules/'.length));
}

const missing = new Map();
for (const [treePath, meta] of Object.entries(packages)) {
  for (const name of Object.keys(meta.optionalDependencies ?? {})) {
    if (present.has(name)) continue;
    if (!missing.has(name)) missing.set(name, treePath || '<root>');
  }
}

if (missing.size > 0) {
  console.error(
    `Lockfile check failed: ${missing.size} optional dependenc${missing.size === 1 ? 'y is' : 'ies are'} declared but absent from package-lock.json.`,
  );
  console.error('This lock cannot install on every platform — see npm/cli#4828.');
  for (const [name, declaredBy] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`- ${name} (declared by ${declaredBy})`);
  }
  console.error('Fix: rm -rf node_modules package-lock.json && npm install');
  process.exitCode = 1;
} else {
  console.log(`Lockfile check passed: every declared optional dependency is present across ${Object.keys(packages).length} locked packages.`);
}
