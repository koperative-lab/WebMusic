// Release gate 3: the person's manual acceptance report for this exact build.
//
//   npm run release:acceptance -- acceptance-reports/webmusic-x.y.z-abcdef0-acceptance.md
//
// The report is the Markdown the manual acceptance runner (apps/test) exports.
// It stays outside Git; this script only reads it. It passes when the report
// names this checkout's version and HEAD commit, was taken on a clean tree,
// this checkout is clean, it lists no unknown check, and the runner's own
// acceptance rule (apps/test/src/report.ts assess()) holds for every check in
// the current catalog. Run with --experimental-strip-types (package.json does).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readBuildIdentity} from '../apps/test/build-identity.ts';
import {CHECKS} from '../apps/test/src/checks.ts';
import {assess, parseReport, reportIdentity} from '../apps/test/src/report.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} markdown the exported report
 * @param {{version: string, commit: string, changes: number}} current this checkout
 * @param {readonly string[]} checkIds the current catalog
 * @returns {{ok: boolean, problems: string[], environments: number}}
 */
export function verifyAcceptanceReport(markdown, current, checkIds) {
  let report;
  try {
    report = parseReport(markdown);
  } catch (error) {
    return {ok: false, problems: [error instanceof Error ? error.message : String(error)], environments: 0};
  }
  const problems = [];
  const named = reportIdentity(report);
  if (named.version !== current.version) problems.push(`the report is for version ${named.version}; this checkout is ${current.version}`);
  if (named.commit !== current.commit) problems.push(`the report is for commit ${named.commit}; HEAD is ${current.commit}`);
  if (current.changes > 0) problems.push(`this checkout has ${current.changes} uncommitted changes; release from a clean checkout of the accepted commit`);
  const known = new Set(checkIds);
  const unknown = report.checkIds.filter((id) => !known.has(id));
  if (unknown.length) problems.push(`the report lists checks the catalog does not: ${unknown.join(', ')}`);
  if (report.environments === 0) problems.push('the report has no tested environment');
  problems.push(...assess(report.outcomes, checkIds, named).reasons);
  return {ok: problems.length === 0, problems, environments: report.environments};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npm run release:acceptance -- <report.md>');
    process.exit(2);
  }
  const current = readBuildIdentity(root);
  const result = verifyAcceptanceReport(readFileSync(path, 'utf8'), current, CHECKS.map((check) => check.id));
  if (result.ok) {
    console.log(`Manual acceptance verified for v${current.version} at ${current.commit} (${CHECKS.length} checks, ${result.environments} environment${result.environments === 1 ? '' : 's'}).`);
  } else {
    console.error(`Manual acceptance is not established for v${current.version} at ${current.commit}:`);
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }
}
