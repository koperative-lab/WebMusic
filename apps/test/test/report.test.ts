import {describe, expect, it} from 'vitest';
import {buildKey, type BuildIdentity} from '../src/build';
import {
  activeEnvironment, addEnvironment, assess, emptyStore, parseReport, parseStore, progress, removeEnvironment, reportIdentity,
  saveStore, selectEnvironment, setEnvironmentFields, setResult, statusOf, storageKey, storeOutcomes, toMarkdown, type ResultStore,
} from '../src/report';

const now = new Date('2026-11-09T10:00:00Z');
const commit = 'b80ce35'.padEnd(40, '0');
const identity: BuildIdentity = {
  version: '0.3.0', commit, branch: 'modular-redesign', changes: 0, committedAt: '2026-11-09T09:00:00Z',
  packages: {'@webmusic/kernel': '0.3.0', '@webmusic/score': '0.3.0'}, generatedAt: now.toISOString(),
};
const build = buildKey(identity);
const checks = [{id: 'A1', title: 'One'}, {id: 'A2', title: 'Two | pipe'}, {id: 'F1', title: 'Microphone'}];
const ids = checks.map((check) => check.id);

/** Every environment's outcome per check, untested included, as the report lists them. */
function listedOutcomes(store: ResultStore) {
  return Object.fromEntries(ids.map((id) => [id, store.environments.map((environment) => ({
    status: statusOf(environment, id), notes: (environment.results[id]?.notes ?? '').replace(/\s*\n\s*/g, ' '),
  }))]));
}

describe('result store', () => {
  it('records a status and a note on the active environment only', () => {
    let store = addEnvironment(emptyStore(build, now), now);
    store = setResult(store, 'A1', {status: 'fail', notes: 'flam | late'}, now);
    const [first, second] = store.environments;
    expect(statusOf(second!, 'A1')).toBe('fail');
    expect(statusOf(first!, 'A1')).toBe('untested');
    store = setResult(store, 'A1', {notes: 'still late'}, now);
    expect(activeEnvironment(store).results.A1).toMatchObject({status: 'fail', notes: 'still late'});
  });

  it('keeps each build’s results apart and rejects malformed values', () => {
    const memory = new Map<string, string>();
    const storage = {getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }};
    const store = setResult(setEnvironmentFields(emptyStore(build, now), {device: 'MacBook'}), 'A1', {status: 'pass'}, now);
    expect(saveStore(storage, store)).toBe(true);
    expect(parseStore(memory.get(storageKey(build)), build, now)).toEqual(store);
    // A record of another commit never loads as this build's results.
    const other = buildKey({...identity, commit: 'f'.repeat(40)});
    expect(parseStore(memory.get(storageKey(build)), other, now).environments[0]!.results).toEqual({});
    expect(buildKey({...identity, changes: 2})).not.toBe(build);
    expect(parseStore('not json', build, now).environments[0]!.results).toEqual({});
    const tampered = JSON.parse(memory.get(storageKey(build))!);
    tampered.environments[0].results.A1.status = 'maybe';
    expect(parseStore(JSON.stringify(tampered), build, now).environments[0]!.results).toEqual({});
  });

  it('survives storage that throws, and switches and removes environments', () => {
    expect(saveStore({setItem: () => { throw new Error('quota'); }}, emptyStore(build, now))).toBe(false);
    let store = addEnvironment(emptyStore(build, now), now);
    const [first, second] = store.environments;
    store = selectEnvironment(store, first!.id);
    expect(store.activeId).toBe(first!.id);
    store = removeEnvironment(store, first!.id, now);
    expect(store.environments.map((environment) => environment.id)).toEqual([second!.id]);
    expect(removeEnvironment(store, second!.id, now).environments).toHaveLength(1);
  });
});

describe('acceptance rule', () => {
  const passAll = () => {
    let store = emptyStore(build, now);
    for (const id of ids) store = setResult(store, id, {status: 'pass'}, now);
    return store;
  };

  it('accepts a clean commit where every check passed somewhere and nothing failed', () => {
    expect(assess(storeOutcomes(passAll()), ids, identity)).toEqual({accepted: true, reasons: []});
  });

  it('names every reason a pass cannot accept a release', () => {
    let store = passAll();
    store = setResult(store, 'A1', {status: 'fail'}, now);
    store = setResult(store, 'F1', {status: 'skip'}, now);
    store = addEnvironment(store, now);
    store = setResult(store, 'A2', {status: 'skip', notes: 'no speaker'}, now);
    const result = assess(storeOutcomes(store), ids, {commit, changes: 3});
    expect(result.accepted).toBe(false);
    expect(result.reasons).toEqual([
      'the working tree had 3 uncommitted changes',
      'failed: A1',
      'not passed in any environment: A1, F1',
      'skipped without a note: F1',
    ]);
    expect(assess(storeOutcomes(passAll()), ids, {commit: 'unknown', changes: 0}).reasons).toEqual(['the build has no known commit']);
  });
});

describe('Markdown report', () => {
  it('carries the build identity and verdict and reads back to the same outcomes', () => {
    let store = setEnvironmentFields(emptyStore(build, now), {device: 'iPhone', browser: 'Safari'});
    store = setResult(store, 'A1', {status: 'fail', notes: 'a | b\nc'}, now);
    store = setResult(store, 'A2', {status: 'pass'}, now);
    store = addEnvironment(store, now);
    store = setResult(store, 'F1', {status: 'skip', notes: 'phone over HTTP'}, now);
    const markdown = toMarkdown(store, checks, identity, now);
    expect(markdown).toContain(`| Commit | ${commit} |`);
    expect(markdown).toContain('| Version | 0.3.0 |');
    expect(markdown).toContain('| Working tree | clean |');
    expect(markdown).toContain('| Packages | @webmusic/kernel 0.3.0, @webmusic/score 0.3.0 |');
    expect(markdown).toContain('| Verdict | Not accepted: failed: A1; not passed in any environment: A1, F1 |');
    expect(markdown).toContain('| E1 | iPhone | Safari |');
    expect(markdown).toContain('| A1 | One | Fail | Untested | E1: a \\| b c |');
    expect(markdown).toContain('| A2 | Two \\| pipe | Pass | Untested |  |');
    expect(markdown).toContain('| F1 | Microphone | Untested | Skip | E2: phone over HTTP |');

    const parsed = parseReport(markdown);
    expect(parsed.environments).toBe(2);
    expect(parsed.checkIds).toEqual(ids);
    expect(parsed.outcomes).toEqual(listedOutcomes(store));
    expect(reportIdentity(parsed)).toEqual({version: '0.3.0', commit, changes: 0});
    expect(progress(store.environments[0]!, ids)).toEqual({done: 2, total: 3, failed: 1});
  });

  it('rejects text that is not a runner report', () => {
    expect(() => parseReport('# Notes\n')).toThrow('Not a WebMusic manual acceptance report.');
  });
});
