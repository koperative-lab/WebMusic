// The manual acceptance runner: one check at a time, a live canvas of the
// packages' own components, and a Pass / Fail / Skip record with notes per
// environment, keyed to the build under test and exported as Markdown.
import './styles.css';
import {CHECKS, GROUPS} from './checks';
import type {Check, MountContext} from './model';
import {buildKey, describeBuild, fetchBuildIdentity, shortCommit, type BuildIdentity} from './build';
import {
  activeEnvironment, addEnvironment, assess, environmentLabel, loadStore, progress, removeEnvironment, reportFileName,
  saveStore, selectEnvironment, setEnvironmentFields, setResult, statusOf, storeOutcomes, toMarkdown,
  type EnvironmentFields, type ResultStore, type Status,
} from './report';

const SETUP_STEPS: readonly string[] = [
  'Check that the build below is the commit you mean to accept. A pass on a build with uncommitted changes cannot accept a release.',
  'Use headphones or a known speaker at a comfortable level, with no other audio playing.',
  'Fill in the environment. Press “New environment” for each further device or browser.',
  'Work down the list: follow Steps in the live canvas, compare with Expected, then choose Pass, Fail or Skip. A failure or a skip needs a note.',
  'Phones block the microphone on plain-HTTP network addresses: run F1 on the desktop localhost URL.',
  'Send each failure, with its notes, to the agent; it fixes them in a new commit and you test that commit. When every check passes, tell the agent the build is accepted. Copy Markdown is an optional way to paste your findings; nothing needs to be saved.',
];

const MARKS: Record<Status, string> = {untested: '', pass: '✓', fail: '✕', skip: '–'};
const STATUS_TEXT: Record<Status, string> = {untested: 'untested', pass: 'Pass', fail: 'Fail', skip: 'Skip'};
const CHECK_IDS = CHECKS.map((check) => check.id);

const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
const app = document.querySelector<HTMLElement>('#app')!;

let identity: BuildIdentity;
let store: ResultStore;
let storageWorks = true;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function commit(next: ResultStore): void {
  store = next;
  storageWorks = saveStore(storage, store);
  renderChrome();
}

// ---------------------------------------------------------------- routing

type Route = {kind: 'setup'} | {kind: 'check'; check: Check; index: number};

function currentRoute(): Route {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const index = CHECKS.findIndex((check) => check.id === id);
  return index < 0 ? {kind: 'setup'} : {kind: 'check', check: CHECKS[index]!, index};
}

const go = (id: string | undefined) => { location.hash = id ? `#/${id}` : '#/'; };

// ---------------------------------------------------------------- layout

const header = element('header', {class: 'mt-bar'});
const nav = element('nav', {class: 'mt-nav', 'aria-label': 'Checks'});
const main = element('main', {class: 'mt-main', tabindex: '-1'});
const announcer = element('p', {class: 'mt-hidden', role: 'status'});

function report(): string {
  return toMarkdown(store, CHECKS.map((check) => ({id: check.id, title: check.title})), identity);
}

function renderChrome(): void {
  const environment = activeEnvironment(store);
  const counts = progress(environment, CHECK_IDS);
  const copy = element('button', {type: 'button', class: 'mt-action'}, 'Copy Markdown');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(report()); announce('Report copied'); } catch { download(); }
  });
  const save = element('button', {type: 'button', class: 'mt-action'}, 'Download Markdown');
  save.addEventListener('click', download);
  header.replaceChildren(
    element('a', {class: 'mt-brand', href: '#/', 'aria-label': 'WebMusic acceptance'}, element('span', {}, 'WebMusic'), element('span', {class: 'mt-brand__module'}, 'Acceptance')),
    element('span', {class: `mt-build${identity.changes > 0 || identity.commit === 'unknown' ? ' mt-build--warn' : ''}`, title: `Commit ${identity.commit} on ${identity.branch}`}, describeBuild(identity)),
    element('span', {class: 'mt-value', 'aria-label': 'Progress'},
      `${environmentLabel(environment, store.environments.indexOf(environment))} · ${counts.done}/${counts.total}${counts.failed ? ` · ${counts.failed} failed` : ''}`),
    element('span', {class: 'mt-spacer'}),
    copy, save,
  );

  const route = currentRoute();
  const list = element('ol', {class: 'mt-list'});
  const setupLink = element('a', {href: '#/', class: 'mt-item'}, element('span', {'aria-hidden': 'true'}), element('span', {class: 'mt-id'}, '0'), element('span', {}, 'Before you start'));
  if (route.kind === 'setup') setupLink.setAttribute('aria-current', 'page');
  list.append(element('li', {}, setupLink));
  for (const group of GROUPS) {
    const items = CHECKS.filter((check) => check.group === group.id);
    if (!items.length) continue;
    list.append(element('li', {class: 'mt-group mt-caption'}, `${group.id} · ${group.title}`));
    for (const check of items) {
      const status = statusOf(environment, check.id);
      const link = element('a', {href: `#/${check.id}`, class: `mt-item mt-item--${status}`},
        element('span', {class: 'mt-mark', 'aria-hidden': 'true'}, MARKS[status]),
        element('span', {class: 'mt-id'}, check.id),
        element('span', {}, check.title),
        element('span', {class: 'mt-hidden'}, ` (${STATUS_TEXT[status]})`));
      if (route.kind === 'check' && route.check === check) link.setAttribute('aria-current', 'page');
      list.append(element('li', {}, link));
    }
  }
  nav.replaceChildren(list);
  nav.querySelector('[aria-current="page"]')?.scrollIntoView({block: 'nearest'});
}

function announce(message: string): void {
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = message; });
}

function download(): void {
  const url = URL.createObjectURL(new Blob([report()], {type: 'text/markdown'}));
  const link = element('a', {href: url, download: reportFileName(identity)});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Report downloaded');
}

// ---------------------------------------------------------------- pages

let active: {controller: AbortController; cleanup?: () => void; canvas: HTMLElement} | undefined;

function unmount(): void {
  const current = active;
  active = undefined;
  if (!current) return;
  current.controller.abort();
  try { current.cleanup?.(); } catch (error) { console.error(error); }
  current.canvas.replaceChildren();
  current.canvas.removeAttribute('style');
}

function renderMain(): void {
  unmount();
  const route = currentRoute();
  if (route.kind === 'setup') renderSetup();
  else renderCheck(route.check, route.index);
  main.focus({preventScroll: true});
  window.scrollTo({top: 0});
}

function panel(label: string, ...children: (Node | string)[]): HTMLElement {
  return element('section', {class: 'mt-panel', 'aria-label': label},
    element('h2', {class: 'mt-panel__head mt-caption'}, label), ...children);
}

function pageHead(caption: string, ...title: (Node | string)[]): HTMLElement {
  return element('header', {class: 'mt-head'}, element('p', {class: 'mt-caption'}, caption), element('h1', {}, ...title));
}

function withClass<T extends HTMLElement>(node: T, name: string): T {
  node.classList.add(name);
  return node;
}

function definitionRows(rows: readonly [string, string][]): HTMLElement {
  return element('dl', {class: 'mt-facts'}, ...rows.flatMap(([name, value]) => [element('dt', {class: 'mt-caption'}, name), element('dd', {class: 'mt-value'}, value)]));
}

function renderSetup(): void {
  const environment = activeEnvironment(store);
  const field = (key: keyof EnvironmentFields, label: string, placeholder = '') => {
    const input = element('input', {class: 'mt-field', type: 'text', value: environment[key], placeholder});
    input.addEventListener('change', () => commit(setEnvironmentFields(store, {[key]: input.value.trim()})));
    return element('label', {class: 'mt-param'}, element('span', {class: 'mt-caption'}, label), input);
  };
  const select = element('select', {class: 'mt-field', 'aria-label': 'Environment'});
  store.environments.forEach((item, index) => {
    const option = element('option', {value: item.id}, environmentLabel(item, index));
    option.selected = item.id === store.activeId;
    select.append(option);
  });
  select.addEventListener('change', () => { commit(selectEnvironment(store, select.value)); renderMain(); });
  const add = element('button', {type: 'button', class: 'mt-action'}, 'New environment');
  add.addEventListener('click', () => { commit(addEnvironment(store)); renderMain(); });
  const remove = element('button', {type: 'button', class: 'mt-action'}, 'Remove this environment');
  remove.addEventListener('click', () => {
    if (!confirm(`Remove ${environmentLabel(environment, store.environments.indexOf(environment))} and its results?`)) return;
    commit(removeEnvironment(store, environment.id));
    renderMain();
  });
  const start = element('button', {type: 'button', class: 'mt-action mt-action--primary'}, 'Start the first check');
  start.addEventListener('click', () => go(CHECKS[0]!.id));

  const assessment = assess(storeOutcomes(store), CHECK_IDS, identity);
  const warnings: string[] = [];
  if (identity.commit === 'unknown') warnings.push('The runner could not read the commit. Serve it from a Git checkout with npm run test:manual.');
  if (identity.changes > 0) warnings.push(`This build has ${identity.changes} uncommitted change${identity.changes === 1 ? '' : 's'}: use it for debugging, then commit and accept the commit itself.`);

  main.replaceChildren(
    pageHead('0 · Setup', 'Before you start'),
    element('div', {class: 'mt-layout'},
      element('div', {class: 'mt-stage'},
        ...warnings.map((warning) => element('p', {class: 'mt-error mt-error--block', role: 'alert'}, warning)),
        ...(storageWorks ? [] : [element('p', {class: 'mt-error mt-error--block', role: 'alert'}, 'Browser storage is unavailable: results live only in this page; download the report before closing it.')]),
        panel('Checklist', element('ol', {class: 'mt-steps'}, ...SETUP_STEPS.map((step) => element('li', {}, step)))),
        panel('Environment',
          element('div', {class: 'mt-form'},
            element('label', {class: 'mt-param'}, element('span', {class: 'mt-caption'}, 'Environment'), select),
            field('device', 'Device and OS'), field('browser', 'Browser and version'),
            field('output', 'Output device', 'Speaker, headphones or interface'), field('microphone', 'Microphone')),
          element('div', {class: 'mt-actions'}, add, remove, element('span', {class: 'mt-spacer'}), start))),
      element('div', {class: 'mt-side'},
    panel('Build under test', definitionRows([
      ['Version', identity.version],
      ['Commit', identity.commit],
      ['Branch', identity.branch],
      ['Working tree', identity.changes > 0 ? `${identity.changes} uncommitted changes` : 'clean'],
      ['Committed', identity.committedAt || '—'],
      ...Object.entries(identity.packages).map(([name, version]) => [name, version] as [string, string]),
    ])),
    panel('Summary',
      definitionRows([
        ['Summary', assessment.accepted ? 'Every check passed' : 'Open'],
        ...assessment.reasons.map((reason) => ['Open', reason] as [string, string]),
      ])))),
  );
}

/** The package elements a canvas mounted, so the person sees what is under test. */
function mountedElements(canvas: HTMLElement): string {
  const names = new Set<string>();
  for (const node of canvas.querySelectorAll('*')) {
    if (node.localName.includes('-') && customElements.get(node.localName)) names.add(`<${node.localName}>`);
  }
  return [...names].join(' ');
}

function renderCheck(check: Check, index: number): void {
  const environment = activeEnvironment(store);
  const result = environment.results[check.id];
  const group = GROUPS.find((item) => item.id === check.group);
  const canvas = element('div', {class: 'mt-canvas'});
  const parameters = element('div', {class: 'mt-parameters'});
  const error = element('p', {class: 'mt-error', role: 'alert', hidden: ''});
  const inventory = element('span', {class: 'mt-inventory'});
  const reload = element('button', {type: 'button', class: 'mt-action mt-action--quiet'}, 'Reload canvas');
  reload.addEventListener('click', () => renderMain());
  const parameterPanel = withClass(panel('Parameters', parameters), 'mt-slot-parameters');
  parameterPanel.hidden = true;

  const statusButtons = (['pass', 'fail', 'skip'] as const).map((status) => {
    const button = element('button', {type: 'button', class: `mt-status mt-status--${status}`, 'aria-pressed': String(result?.status === status)}, STATUS_TEXT[status]);
    button.addEventListener('click', () => {
      const current = activeEnvironment(store).results[check.id]?.status;
      const next = current === status ? 'untested' : status;
      commit(setResult(store, check.id, {status: next, notes: notes.value}));
      for (const other of statusButtons) other.setAttribute('aria-pressed', String(other === button && next !== 'untested'));
      announce(`${check.id}: ${STATUS_TEXT[next]}`);
    });
    return button;
  });
  const notes = element('textarea', {class: 'mt-field mt-notes', rows: '3', 'aria-label': 'Notes', placeholder: 'Notes: what you heard or saw, or why you skipped'});
  notes.value = result?.notes ?? '';
  notes.addEventListener('change', () => commit(setResult(store, check.id, {notes: notes.value})));

  const previous = element('a', {class: 'mt-action', href: index > 0 ? `#/${CHECKS[index - 1]!.id}` : '#/'}, '← Previous');
  const next = CHECKS[index + 1];
  const nextLink = element('a', {class: 'mt-action mt-action--primary', href: next ? `#/${next.id}` : '#/'}, next ? `Next · ${next.id} →` : 'Report →');

  main.replaceChildren(
    pageHead(`${check.group} · ${group?.title ?? ''}`, element('span', {class: 'mt-id'}, check.id), ' ', check.title),
    element('div', {class: 'mt-layout mt-layout--check'},
      element('div', {class: 'mt-stage'},
        element('section', {class: 'mt-panel mt-live', 'aria-label': 'Live canvas'},
          element('div', {class: 'mt-panel__head'}, element('h2', {class: 'mt-caption'}, 'Live canvas'), inventory, reload),
          canvas, error)),
      element('div', {class: 'mt-side'},
        withClass(panel('Steps', element('ol', {class: 'mt-steps'}, ...check.steps.map((step) => element('li', {}, step)))), 'mt-slot-steps'),
        withClass(panel('Expected', element('ul', {class: 'mt-steps'}, ...check.expected.map((item) => element('li', {}, item)))), 'mt-slot-expected'),
        parameterPanel,
        element('section', {class: 'mt-panel mt-slot-result', 'aria-label': 'Result'},
          element('h2', {class: 'mt-panel__head mt-caption'}, `Result · ${environmentLabel(environment, store.environments.indexOf(environment))}`),
          element('div', {class: 'mt-choice mt-choice--status', role: 'group', 'aria-label': 'Result'}, ...statusButtons),
          notes),
        element('nav', {class: 'mt-pager mt-slot-pager', 'aria-label': 'Previous and next check'}, previous, nextLink))),
  );

  const controller = new AbortController();
  const current: NonNullable<typeof active> = {controller, canvas};
  active = current;
  const context: MountContext = {
    canvas, parameters, signal: controller.signal,
    fail(reason) {
      if (controller.signal.aborted) return;
      if ((reason as {name?: string} | undefined)?.name === 'AbortError') return;
      error.hidden = false;
      error.textContent = reason instanceof Error ? reason.message : String(reason);
      console.error(reason);
    },
  };
  const observer = new MutationObserver(() => {
    parameterPanel.hidden = parameters.childElementCount === 0;
    inventory.textContent = mountedElements(canvas);
    inventory.title = inventory.textContent;
  });
  observer.observe(parameters, {childList: true});
  observer.observe(canvas, {childList: true, subtree: true});
  controller.signal.addEventListener('abort', () => observer.disconnect(), {once: true});
  void check.mount().then((mount) => controller.signal.aborted ? undefined : mount(context)).then((cleanup) => {
    if (typeof cleanup !== 'function') return;
    if (controller.signal.aborted) cleanup();
    else current.cleanup = cleanup;
  }, (reason: unknown) => context.fail(reason));
}

async function start(): Promise<void> {
  app.append(element('p', {class: 'mt-loading mt-caption'}, 'Reading the build…'));
  identity = await fetchBuildIdentity(import.meta.env.BASE_URL);
  store = loadStore(storage, buildKey(identity));
  storageWorks = saveStore(storage, store);
  document.title = `WebMusic acceptance · v${identity.version} · ${shortCommit(identity)}`;
  app.replaceChildren(header, element('div', {class: 'mt-body'}, nav, main), announcer);
  window.addEventListener('hashchange', () => { renderChrome(); renderMain(); });
  // A page leaving the back/forward cache must not keep audio running.
  window.addEventListener('pagehide', unmount);
  window.addEventListener('pageshow', (event) => { if (event.persisted) renderMain(); });
  renderChrome();
  renderMain();
}

void start();
