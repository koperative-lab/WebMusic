// Results of a manual acceptance pass: one record per tested environment
// (device + browser + output), one status and note per check. Kept in
// localStorage so a pass can stretch over several sittings; exported as
// Markdown for the audit record or JSON for a later import.

export type Status = 'untested' | 'pass' | 'fail' | 'skip';

export interface CheckResult {
  readonly status: Status;
  readonly notes: string;
  readonly updatedAt: string;
}

export interface Environment {
  readonly id: string;
  readonly device: string;
  readonly browser: string;
  readonly output: string;
  readonly microphone: string;
  readonly createdAt: string;
  readonly results: Readonly<Record<string, CheckResult>>;
}

export interface ResultStore {
  readonly version: 1;
  readonly activeId: string;
  readonly environments: readonly Environment[];
}

export interface ExportCheck {
  readonly id: string;
  readonly title: string;
}

export const STORAGE_KEY = 'webmusic-manual-test:v1';

let sequence = 0;
function newId(now: Date): string {
  sequence += 1;
  return `env-${now.getTime().toString(36)}-${sequence}`;
}

export function createEnvironment(now = new Date(), fields: Partial<Pick<Environment, 'device' | 'browser' | 'output' | 'microphone'>> = {}): Environment {
  return {
    id: newId(now),
    device: fields.device ?? '',
    browser: fields.browser ?? '',
    output: fields.output ?? '',
    microphone: fields.microphone ?? '',
    createdAt: now.toISOString(),
    results: {},
  };
}

export function emptyStore(now = new Date()): ResultStore {
  const environment = createEnvironment(now);
  return {version: 1, activeId: environment.id, environments: [environment]};
}

const STATUSES = new Set<Status>(['untested', 'pass', 'fail', 'skip']);

/** Accept only a well-formed stored value; anything else starts a fresh store. */
export function parseStore(text: string | null | undefined, now = new Date()): ResultStore {
  if (!text) return emptyStore(now);
  try {
    const value = JSON.parse(text) as Partial<ResultStore>;
    if (value?.version !== 1 || !Array.isArray(value.environments) || value.environments.length === 0) return emptyStore(now);
    const environments = value.environments.filter((environment): environment is Environment =>
      !!environment && typeof environment.id === 'string' && typeof environment.results === 'object' && environment.results !== null)
      .map((environment) => ({
        ...environment,
        results: Object.fromEntries(Object.entries(environment.results).filter(([, result]) =>
          !!result && STATUSES.has(result.status) && typeof result.notes === 'string')),
      }));
    if (environments.length === 0) return emptyStore(now);
    const activeId = environments.some((environment) => environment.id === value.activeId) ? value.activeId! : environments[0]!.id;
    return {version: 1, activeId, environments};
  } catch {
    return emptyStore(now);
  }
}

export function loadStore(storage: Pick<Storage, 'getItem'> | undefined): ResultStore {
  try { return parseStore(storage?.getItem(STORAGE_KEY)); } catch { return emptyStore(); }
}

/** Saving is best effort: a private window or blocked storage keeps the pass in memory. */
export function saveStore(storage: Pick<Storage, 'setItem'> | undefined, store: ResultStore): boolean {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(store)); return !!storage; } catch { return false; }
}

export function activeEnvironment(store: ResultStore): Environment {
  return store.environments.find((environment) => environment.id === store.activeId) ?? store.environments[0]!;
}

function replaceActive(store: ResultStore, update: (environment: Environment) => Environment): ResultStore {
  const active = activeEnvironment(store);
  return {...store, environments: store.environments.map((environment) => environment === active ? update(environment) : environment)};
}

export function setResult(store: ResultStore, checkId: string, patch: Partial<Pick<CheckResult, 'status' | 'notes'>>, now = new Date()): ResultStore {
  return replaceActive(store, (environment) => {
    const previous = environment.results[checkId] ?? {status: 'untested' as Status, notes: '', updatedAt: ''};
    return {...environment, results: {...environment.results, [checkId]: {
      status: patch.status ?? previous.status,
      notes: patch.notes ?? previous.notes,
      updatedAt: now.toISOString(),
    }}};
  });
}

export function setEnvironmentFields(store: ResultStore, fields: Partial<Pick<Environment, 'device' | 'browser' | 'output' | 'microphone'>>): ResultStore {
  return replaceActive(store, (environment) => ({...environment, ...fields}));
}

export function addEnvironment(store: ResultStore, now = new Date()): ResultStore {
  const environment = createEnvironment(now);
  return {...store, activeId: environment.id, environments: [...store.environments, environment]};
}

export function selectEnvironment(store: ResultStore, id: string): ResultStore {
  return store.environments.some((environment) => environment.id === id) ? {...store, activeId: id} : store;
}

export function removeEnvironment(store: ResultStore, id: string, now = new Date()): ResultStore {
  const environments = store.environments.filter((environment) => environment.id !== id);
  if (environments.length === 0) return emptyStore(now);
  return {...store, environments, activeId: store.activeId === id ? environments[0]!.id : store.activeId};
}

export function statusOf(environment: Environment, checkId: string): Status {
  return environment.results[checkId]?.status ?? 'untested';
}

export function progress(environment: Environment, checkIds: readonly string[]): {done: number; total: number; failed: number} {
  let done = 0;
  let failed = 0;
  for (const id of checkIds) {
    const status = statusOf(environment, id);
    if (status !== 'untested') done += 1;
    if (status === 'fail') failed += 1;
  }
  return {done, total: checkIds.length, failed};
}

export function environmentLabel(environment: Environment, index: number): string {
  const name = [environment.device, environment.browser].filter(Boolean).join(' · ');
  return `E${index + 1}${name ? ` ${name}` : ''}`;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const STATUS_MARK: Record<Status, string> = {untested: '', pass: 'pass', fail: 'FAIL', skip: 'skip'};

/** One environment table and one results table, ready to paste into the audit record. */
export function toMarkdown(store: ResultStore, checks: readonly ExportCheck[]): string {
  const lines: string[] = [];
  lines.push('| # | Device and OS | Browser and version | Output | Microphone | Started |', '| --- | --- | --- | --- | --- | --- |');
  store.environments.forEach((environment, index) => {
    lines.push(`| E${index + 1} | ${cell(environment.device)} | ${cell(environment.browser)} | ${cell(environment.output)} | ${cell(environment.microphone)} | ${environment.createdAt.slice(0, 10)} |`);
  });
  lines.push('');
  const heads = store.environments.map((_, index) => `E${index + 1}`);
  lines.push(`| Check | ${heads.join(' | ')} | Notes |`, `| --- | ${heads.map(() => '---').join(' | ')} | --- |`);
  for (const check of checks) {
    const marks = store.environments.map((environment) => STATUS_MARK[statusOf(environment, check.id)]);
    const notes = store.environments
      .map((environment, index) => {
        const note = environment.results[check.id]?.notes.trim();
        return note ? `E${index + 1}: ${note}` : '';
      })
      .filter(Boolean)
      .join('; ');
    lines.push(`| ${check.id} ${cell(check.title)} | ${marks.join(' | ')} | ${cell(notes)} |`);
  }
  return `${lines.join('\n')}\n`;
}
