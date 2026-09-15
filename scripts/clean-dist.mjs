// Removes a package's dist/ before tsup runs.
//
// Why this is not tsup's own `clean: true`: the family packages build
// several tsup configs (ESM, CJS, and one IIFE pass per capability) that
// tsup runs CONCURRENTLY against one output directory. `clean` belongs to a
// single config, and its delete sweep is asynchronous — it globs the old
// dist, then unlinks what it found while the other configs are already
// writing. A capability's freshly written `dist/<cap>/auto.global.js` can be
// unlinked by that sweep because the path was in the glob from the previous
// build, leaving its `.map` (written after the sweep passed) behind. The
// result is a dist that builds "successfully" and fails check:packages with
// a missing IIFE target. Cleaning once, before tsup starts, removes the race
// instead of narrowing it.
import {rm} from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2] ?? 'dist';
const resolved = path.resolve(process.cwd(), target);

if (path.relative(process.cwd(), resolved).startsWith('..')) {
  console.error(`clean-dist: refusing to remove ${resolved} — outside ${process.cwd()}.`);
  process.exit(1);
}

await rm(resolved, {recursive: true, force: true});
