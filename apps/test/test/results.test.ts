import {describe, expect, it} from 'vitest';
import {
  activeEnvironment, addEnvironment, emptyStore, parseStore, progress, removeEnvironment, saveStore,
  selectEnvironment, setEnvironmentFields, setResult, statusOf, toMarkdown, STORAGE_KEY,
} from '../src/results';
import {CHECKS, GROUPS} from '../src/checks';

const now = new Date('2026-11-08T10:00:00Z');

describe('manual result store', () => {
  it('records a status and a note on the active environment only', () => {
    let store = addEnvironment(emptyStore(now), now);
    store = setResult(store, 'A1', {status: 'fail', notes: 'flam | late'}, now);
    const [first, second] = store.environments;
    expect(statusOf(second!, 'A1')).toBe('fail');
    expect(statusOf(first!, 'A1')).toBe('untested');
    store = setResult(store, 'A1', {notes: 'still late'}, now);
    expect(activeEnvironment(store).results.A1).toMatchObject({status: 'fail', notes: 'still late'});
  });

  it('round-trips through storage and rejects malformed values', () => {
    const memory = new Map<string, string>();
    const storage = {getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }};
    const store = setResult(setEnvironmentFields(emptyStore(now), {device: 'MacBook', browser: 'Chrome 141'}), 'B1', {status: 'pass'}, now);
    expect(saveStore(storage, store)).toBe(true);
    expect(parseStore(memory.get(STORAGE_KEY), now)).toEqual(store);
    expect(parseStore('{"version":2}', now).environments).toHaveLength(1);
    expect(parseStore('not json', now).environments[0]!.results).toEqual({});
    const tampered = JSON.parse(memory.get(STORAGE_KEY)!);
    tampered.environments[0].results.B1.status = 'maybe';
    expect(parseStore(JSON.stringify(tampered), now).environments[0]!.results).toEqual({});
  });

  it('survives storage that throws', () => {
    expect(saveStore({setItem: () => { throw new Error('quota'); }}, emptyStore(now))).toBe(false);
  });

  it('switches and removes environments without losing the others', () => {
    let store = addEnvironment(emptyStore(now), now);
    const [first, second] = store.environments;
    store = selectEnvironment(store, first!.id);
    expect(store.activeId).toBe(first!.id);
    store = removeEnvironment(store, first!.id, now);
    expect(store.environments.map((environment) => environment.id)).toEqual([second!.id]);
    expect(removeEnvironment(store, second!.id, now).environments).toHaveLength(1);
  });

  it('exports one Markdown row per check with escaped notes', () => {
    let store = setEnvironmentFields(emptyStore(now), {device: 'iPhone', browser: 'Safari'});
    store = setResult(store, 'A1', {status: 'fail', notes: 'a | b\nc'}, now);
    store = setResult(store, 'A2', {status: 'pass'}, now);
    const markdown = toMarkdown(store, [{id: 'A1', title: 'One'}, {id: 'A2', title: 'Two'}, {id: 'A3', title: 'Three'}]);
    expect(markdown).toContain('| E1 | iPhone | Safari |');
    expect(markdown).toContain('| A1 One | FAIL | E1: a \\| b<br>c |');
    expect(markdown).toContain('| A2 Two | pass |  |');
    expect(markdown).toContain('| A3 Three |  |  |');
    expect(progress(activeEnvironment(store), ['A1', 'A2', 'A3'])).toEqual({done: 2, total: 3, failed: 1});
  });
});

describe('check catalog', () => {
  it('has unique IDs in known groups with both languages filled in', () => {
    const ids = CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((group) => group.id));
    for (const check of CHECKS) {
      expect(groups.has(check.group), check.id).toBe(true);
      for (const text of [check.title, ...check.steps, ...check.expected]) {
        expect(text.zh.trim(), check.id).not.toBe('');
        expect(text.en.trim(), check.id).not.toBe('');
      }
      expect(check.steps.length, check.id).toBeGreaterThan(0);
      expect(check.expected.length, check.id).toBeGreaterThan(0);
    }
  });
});
