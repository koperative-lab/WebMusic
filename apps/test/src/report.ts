// Results of a manual acceptance pass and the Markdown report made from them.
// One record per tested environment (device + browser + output), one status
// and note per check, kept in this browser's localStorage under the build it
// was taken on. Nothing here is written to the repository: the person exports
// a Markdown report, and the release verifier
// (scripts/verify-acceptance-report.mjs) reads that report with parseReport()
// and judges it with the same assess() rule the runner shows.
import type {BuildIdentity} from './build.ts';

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

export type EnvironmentFields = Pick<Environment, 'device' | 'browser' | 'output' | 'microphone'>;

export interface ResultStore {
  readonly version: 2;
  /** The build these results were taken on; see buildKey(). */
  readonly build: string;
  readonly activeId: string;
  readonly environments: readonly Environment[];
}

export interface ReportCheck {
  readonly id: string;
  readonly title: string;
}

const STORAGE_PREFIX = 'webmusic-acceptance:v2:';
export const storageKey = (build: string): string => `${STORAGE_PREFIX}${build}`;

let sequence = 0;
export function createEnvironment(now = new Date(), fields: Partial<EnvironmentFields> = {}): Environment {
  sequence += 1;
  return {
    id: `env-${now.getTime().toString(36)}-${sequence}`,
    device: fields.device ?? '', browser: fields.browser ?? '', output: fields.output ?? '', microphone: fields.microphone ?? '',
    createdAt: now.toISOString(),
    results: {},
  };
}

export function emptyStore(build: string, now = new Date()): ResultStore {
  const environment = createEnvironment(now);
  return {version: 2, build, activeId: environment.id, environments: [environment]};
}

const STATUSES = new Set<Status>(['untested', 'pass', 'fail', 'skip']);

/** Accept only a well-formed record of this build; anything else starts fresh. */
export function parseStore(text: string | null | undefined, build: string, now = new Date()): ResultStore {
  if (!text) return emptyStore(build, now);
  try {
    const value = JSON.parse(text) as Partial<ResultStore>;
    if (value?.version !== 2 || value.build !== build || !Array.isArray(value.environments)) return emptyStore(build, now);
    const environments = value.environments.filter((environment): environment is Environment =>
      !!environment && typeof environment.id === 'string' && typeof environment.results === 'object' && environment.results !== null)
      .map((environment) => ({
        ...environment,
        results: Object.fromEntries(Object.entries(environment.results).filter(([, result]) =>
          !!result && STATUSES.has(result.status) && typeof result.notes === 'string')),
      }));
    if (environments.length === 0) return emptyStore(build, now);
    const activeId = environments.some((environment) => environment.id === value.activeId) ? value.activeId! : environments[0]!.id;
    return {version: 2, build, activeId, environments};
  } catch {
    return emptyStore(build, now);
  }
}

export function loadStore(storage: Pick<Storage, 'getItem'> | undefined, build: string): ResultStore {
  try { return parseStore(storage?.getItem(storageKey(build)), build); } catch { return emptyStore(build); }
}

/** Saving is best effort: a private window or blocked storage keeps the pass in memory. */
export function saveStore(storage: Pick<Storage, 'setItem'> | undefined, store: ResultStore): boolean {
  try { storage?.setItem(storageKey(store.build), JSON.stringify(store)); return !!storage; } catch { return false; }
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

export function setEnvironmentFields(store: ResultStore, fields: Partial<EnvironmentFields>): ResultStore {
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
  if (environments.length === 0) return emptyStore(store.build, now);
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

// ---------------------------------------------------------------- verdict

/** One check's outcome in each tested environment. */
export type Outcomes = Readonly<Record<string, readonly {readonly status: Status; readonly notes: string}[]>>;

export interface Assessment {
  readonly accepted: boolean;
  /** Why the pass does not accept this build; empty when accepted. */
  readonly reasons: readonly string[];
}

/**
 * The single acceptance rule, shared by the runner and the release verifier:
 * a committed build with a clean working tree; no check failed anywhere;
 * every check passed in at least one environment; every skip says why.
 */
export function assess(outcomes: Outcomes, checkIds: readonly string[], identity: Pick<BuildIdentity, 'commit' | 'changes'>): Assessment {
  const reasons: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(identity.commit)) reasons.push('the build has no known commit');
  if (identity.changes > 0) reasons.push(`the working tree had ${identity.changes} uncommitted change${identity.changes === 1 ? '' : 's'}`);
  const failed = checkIds.filter((id) => (outcomes[id] ?? []).some((outcome) => outcome.status === 'fail'));
  const unpassed = checkIds.filter((id) => !(outcomes[id] ?? []).some((outcome) => outcome.status === 'pass'));
  const unexplained = checkIds.filter((id) => (outcomes[id] ?? []).some((outcome) => outcome.status === 'skip' && !outcome.notes.trim()));
  if (failed.length) reasons.push(`failed: ${failed.join(', ')}`);
  if (unpassed.length) reasons.push(`not passed in any environment: ${unpassed.join(', ')}`);
  if (unexplained.length) reasons.push(`skipped without a note: ${unexplained.join(', ')}`);
  return {accepted: reasons.length === 0, reasons};
}

export function storeOutcomes(store: ResultStore): Outcomes {
  const outcomes: Record<string, {status: Status; notes: string}[]> = {};
  for (const environment of store.environments) {
    for (const [id, result] of Object.entries(environment.results)) {
      (outcomes[id] ??= []).push({status: result.status, notes: result.notes});
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------- Markdown

export const REPORT_TITLE = '# WebMusic manual acceptance report';
const STATUS_WORD: Record<Status, string> = {untested: 'Untested', pass: 'Pass', fail: 'Fail', skip: 'Skip'};
const WORD_STATUS = new Map(Object.entries(STATUS_WORD).map(([status, word]) => [word, status as Status]));

const cell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const uncell = (text: string) => text.trim().replace(/<br>/g, '\n').replace(/\\([\\|])/g, '$1');

export function reportFileName(identity: BuildIdentity): string {
  return `webmusic-${identity.version}-${identity.commit.slice(0, 7)}-acceptance.md`;
}

/** The whole report: build identity, verdict, environments and every check. */
export function toMarkdown(store: ResultStore, checks: readonly ReportCheck[], identity: BuildIdentity, now = new Date()): string {
  const assessment = assess(storeOutcomes(store), checks.map((check) => check.id), identity);
  const lines: string[] = [REPORT_TITLE, ''];
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Version | ${cell(identity.version)} |`);
  lines.push(`| Commit | ${cell(identity.commit)} |`);
  lines.push(`| Branch | ${cell(identity.branch)} |`);
  lines.push(`| Working tree | ${identity.changes > 0 ? `${identity.changes} uncommitted changes` : 'clean'} |`);
  lines.push(`| Committed | ${cell(identity.committedAt)} |`);
  lines.push(`| Packages | ${cell(Object.entries(identity.packages).map(([name, version]) => `${name} ${version}`).join(', '))} |`);
  lines.push(`| Exported | ${now.toISOString()} |`);
  lines.push(`| Verdict | ${assessment.accepted ? 'Accepted' : cell(`Not accepted: ${assessment.reasons.join('; ')}`)} |`);
  lines.push('', '## Environments', '');
  lines.push('| Environment | Device and OS | Browser and version | Output | Microphone | Started |', '| --- | --- | --- | --- | --- | --- |');
  store.environments.forEach((environment, index) => {
    lines.push(`| E${index + 1} | ${cell(environment.device)} | ${cell(environment.browser)} | ${cell(environment.output)} | ${cell(environment.microphone)} | ${environment.createdAt.slice(0, 10)} |`);
  });
  lines.push('', '## Results', '');
  const heads = store.environments.map((_, index) => `E${index + 1}`);
  lines.push(`| Check | Title | ${heads.join(' | ')} | Notes |`, `| --- | --- | ${heads.map(() => '---').join(' | ')} | --- |`);
  for (const check of checks) {
    const marks = store.environments.map((environment) => STATUS_WORD[statusOf(environment, check.id)]);
    const notes = store.environments
      .map((environment, index) => {
        // One line per environment inside the cell, so the report reads back unambiguously.
        const note = environment.results[check.id]?.notes.trim().replace(/\s*\n\s*/g, ' ');
        return note ? `E${index + 1}: ${note}` : '';
      })
      .filter(Boolean)
      .join('\n');
    lines.push(`| ${check.id} | ${cell(check.title)} | ${marks.join(' | ')} | ${cell(notes)} |`);
  }
  return `${lines.join('\n')}\n`;
}

export interface ParsedReport {
  readonly fields: Readonly<Record<string, string>>;
  readonly environments: number;
  readonly outcomes: Outcomes;
  readonly checkIds: readonly string[];
}

function cells(line: string): string[] {
  const parts = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
  return parts.map((part) => uncell(part));
}

function section(lines: readonly string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('|')) rows.push(line);
  }
  return rows;
}

/** Read a report this runner exported; throws on anything else. */
export function parseReport(markdown: string): ParsedReport {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== REPORT_TITLE) throw new Error('Not a WebMusic manual acceptance report.');
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) continue;
    const [name, value] = cells(line);
    if (name && name !== 'Field' && !/^-+$/.test(name)) fields[name] = value ?? '';
  }
  const results = section(lines, '## Results');
  const header = results[0] ? cells(results[0]) : [];
  if (header[0] !== 'Check' || header[1] !== 'Title' || header.at(-1) !== 'Notes') throw new Error('The report has no results table.');
  const environments = header.length - 3;
  const outcomes: Record<string, {status: Status; notes: string}[]> = {};
  const checkIds: string[] = [];
  for (const row of results.slice(2)) {
    const values = cells(row);
    const id = values[0]!;
    const notes = values.at(-1) ?? '';
    const noteFor = (index: number) => notes.split('\n').find((line) => line.startsWith(`E${index + 1}: `))?.slice(`E${index + 1}: `.length) ?? '';
    checkIds.push(id);
    outcomes[id] = values.slice(2, 2 + environments).map((word, index) => {
      const status = WORD_STATUS.get(word);
      if (!status) throw new Error(`${id}: unknown status “${word}”.`);
      return {status, notes: noteFor(index)};
    });
  }
  return {fields, environments, outcomes, checkIds};
}

/** The identity a parsed report names, in the runner's own terms. */
export function reportIdentity(report: ParsedReport): Pick<BuildIdentity, 'version' | 'commit' | 'changes'> {
  const tree = report.fields['Working tree'] ?? '';
  return {
    version: report.fields.Version ?? 'unknown',
    commit: report.fields.Commit ?? 'unknown',
    changes: tree === 'clean' ? 0 : Number.parseInt(tree, 10) || 1,
  };
}

