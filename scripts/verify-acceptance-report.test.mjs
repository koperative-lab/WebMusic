import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyAcceptanceReport} from './verify-acceptance-report.mjs';
import {CHECKS} from '../apps/test/src/checks.ts';
import {emptyStore, setResult, toMarkdown} from '../apps/test/src/report.ts';

const commit = 'a'.repeat(40);
const identity = {version: '1.2.3', commit, branch: 'main', changes: 0, committedAt: '', packages: {}, generatedAt: ''};
const checks = CHECKS.map((check) => ({id: check.id, title: check.title}));
const ids = checks.map((check) => check.id);
const current = {version: '1.2.3', commit, changes: 0};

function report(patch = (store) => store, build = identity) {
  let store = emptyStore('test');
  for (const id of ids) store = setResult(store, id, {status: 'pass'});
  return toMarkdown(patch(store), checks, build);
}

test('accepts a passing report of this exact clean build', () => {
  assert.deepEqual(verifyAcceptanceReport(report(), current, ids), {ok: true, problems: [], environments: 1});
});

test('rejects a report of another commit or version, or from a dirty tree', () => {
  const other = verifyAcceptanceReport(report(), {...current, commit: 'b'.repeat(40), version: '1.2.4'}, ids);
  assert.equal(other.ok, false);
  assert.match(other.problems.join('\n'), /version 1\.2\.3; this checkout is 1\.2\.4/);
  assert.match(other.problems.join('\n'), /HEAD is b{40}/);
  const dirty = verifyAcceptanceReport(report(undefined, {...identity, changes: 2}), current, ids);
  assert.match(dirty.problems.join('\n'), /working tree had 2 uncommitted changes/);
  assert.match(verifyAcceptanceReport(report(), {...current, changes: 1}, ids).problems.join('\n'), /this checkout has 1 uncommitted changes/);
});

test('rejects failures, missing passes, unexplained skips and unknown checks', () => {
  const first = ids[0];
  const failed = verifyAcceptanceReport(report((store) => setResult(store, first, {status: 'fail', notes: 'late'})), current, ids);
  assert.match(failed.problems.join('\n'), new RegExp(`failed: ${first}`));
  const skipped = verifyAcceptanceReport(report((store) => setResult(store, first, {status: 'skip'})), current, ids);
  assert.match(skipped.problems.join('\n'), new RegExp(`skipped without a note: ${first}`));
  const newer = verifyAcceptanceReport(report(), current, [...ids, 'Z9']);
  assert.match(newer.problems.join('\n'), /not passed in any environment: Z9/);
  const older = verifyAcceptanceReport(report(), current, ids.slice(1));
  assert.match(older.problems.join('\n'), new RegExp(`catalog does not: ${first}`));
  assert.deepEqual(verifyAcceptanceReport('# Something else\n', current, ids).problems, ['Not a WebMusic manual acceptance report.']);
});
