// The manual acceptance runner: one check at a time, its live composition in
// the canvas, and a Pass / Fail / Skip record with notes per environment.
import './styles.css';
import {CHECKS, GROUPS} from './checks';
import type {Check, Lang, MountContext, Text} from './model';
import {
  activeEnvironment, addEnvironment, environmentLabel, loadStore, progress, removeEnvironment, saveStore,
  selectEnvironment, setEnvironmentFields, setResult, statusOf, toMarkdown, type Environment, type ResultStore, type Status,
} from './results';

const UI = {
  title: {zh: 'WebMusic 人工验收', en: 'WebMusic manual acceptance'},
  setup: {zh: '开始前', en: 'Before you start'},
  steps: {zh: '操作', en: 'Steps'},
  expected: {zh: '应当看到 / 听到', en: 'Expected'},
  component: {zh: '组件', en: 'Component'},
  parameters: {zh: '参数', en: 'Parameters'},
  result: {zh: '结果', en: 'Result'},
  pass: {zh: '通过', en: 'Pass'},
  fail: {zh: '失败', en: 'Fail'},
  skip: {zh: '跳过', en: 'Skip'},
  notes: {zh: '备注（失败时写下听到或看到了什么）', en: 'Notes (what you heard or saw when it failed)'},
  previous: {zh: '上一项', en: 'Previous'},
  next: {zh: '下一项', en: 'Next'},
  start: {zh: '开始第一项', en: 'Start the first check'},
  noComposition: {zh: '这一项回到前面的检查里操作，本页没有组件。', en: 'Perform this check on the earlier checks it names; this page has no component.'},
  environment: {zh: '测试环境', en: 'Environment'},
  device: {zh: '设备和系统', en: 'Device and OS'},
  browser: {zh: '浏览器和版本', en: 'Browser and version'},
  output: {zh: '输出（扬声器、耳机、声卡）', en: 'Output (speaker, headphones, interface)'},
  microphone: {zh: '麦克风', en: 'Microphone'},
  newEnvironment: {zh: '新环境', en: 'New environment'},
  removeEnvironment: {zh: '删除此环境', en: 'Remove this environment'},
  exportMarkdown: {zh: '复制 Markdown', en: 'Copy Markdown'},
  exportJson: {zh: '下载 JSON', en: 'Download JSON'},
  copied: {zh: '已复制', en: 'Copied'},
  downloaded: {zh: '已下载', en: 'Downloaded'},
  language: {zh: 'English', en: '中文'},
  progress: {zh: '进度', en: 'Progress'},
  failedCount: {zh: '失败', en: 'failed'},
  storageOff: {zh: '浏览器存储不可用：结果只保存在这个页面里，关闭前请导出。', en: 'Browser storage is unavailable: results live only in this page; export before closing.'},
} satisfies Record<string, Text>;

const SETUP_STEPS: readonly Text[] = [
  {zh: '戴上耳机或使用确定的扬声器，音量适中，关闭其他发声的应用。', en: 'Use headphones or a known speaker at a comfortable level, with no other audio playing.'},
  {zh: '填写下面的测试环境。换一台设备或浏览器时按“新环境”。', en: 'Fill in the environment below. Press “New environment” for each further device or browser.'},
  {zh: '左侧按顺序逐项检查：照“操作”去做，对照“应当看到 / 听到”，然后选通过、失败或跳过。', en: 'Work down the list on the left: follow Steps, compare with Expected, then choose Pass, Fail or Skip.'},
  {zh: '手机走局域网 http 时麦克风不可用，F1 请在电脑的 localhost 上测。', en: 'Over plain-HTTP network addresses phones block the microphone; run F1 on the desktop localhost URL.'},
  {zh: '完成后“复制 Markdown”，贴进 dev/audits/2026-11-07-mod15-device-acceptance.md 的结果表，或发给维护者。', en: 'When done, “Copy Markdown” and paste it into the results table of dev/audits/2026-11-07-mod15-device-acceptance.md, or send it to the maintainer.'},
];

const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
const LANG_KEY = 'webmusic-manual-test:lang';
let lang: Lang = (() => { try { return storage?.getItem(LANG_KEY) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } })();
let store: ResultStore = loadStore(storage);
let storageWorks = saveStore(storage, store);

const tr = (text: Text) => text[lang];
const app = document.querySelector<HTMLElement>('#app')!;

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
app.append(header, element('div', {class: 'mt-body'}, nav, main), announcer);

function renderChrome(): void {
  const environment = activeEnvironment(store);
  const counts = progress(environment, CHECKS.map((check) => check.id));
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = tr(UI.title);

  const exportMarkdown = element('button', {type: 'button', class: 'mt-action'}, tr(UI.exportMarkdown));
  exportMarkdown.addEventListener('click', async () => {
    const markdown = toMarkdown(store, CHECKS.map((check) => ({id: check.id, title: check.title.en})));
    try { await navigator.clipboard.writeText(markdown); announce(tr(UI.copied)); } catch { download('webmusic-manual-test.md', markdown, 'text/markdown'); }
  });
  const exportJson = element('button', {type: 'button', class: 'mt-action'}, tr(UI.exportJson));
  exportJson.addEventListener('click', () => download('webmusic-manual-test.json', `${JSON.stringify(store, null, 2)}\n`, 'application/json'));
  const toggle = element('button', {type: 'button', class: 'mt-action', lang: lang === 'zh' ? 'en' : 'zh'}, tr(UI.language));
  toggle.addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    try { storage?.setItem(LANG_KEY, lang); } catch { /* per-viewer preference only */ }
    renderChrome();
    renderMain();
  });
  header.replaceChildren(
    element('a', {class: 'mt-brand', href: '#/'}, tr(UI.title)),
    element('span', {class: 'mt-value', 'aria-label': tr(UI.progress)},
      `${environmentLabel(environment, store.environments.indexOf(environment))} · ${counts.done}/${counts.total}${counts.failed ? ` · ${counts.failed} ${tr(UI.failedCount)}` : ''}`),
    element('span', {class: 'mt-spacer'}),
    exportMarkdown, exportJson, toggle,
  );

  const route = currentRoute();
  const list = element('ol', {class: 'mt-list'});
  const setupLink = element('a', {href: '#/', class: 'mt-item'}, element('span', {class: 'mt-mark', 'aria-hidden': 'true'}, '○'), element('span', {class: 'mt-id'}, '0'), element('span', {}, tr(UI.setup)));
  if (route.kind === 'setup') setupLink.setAttribute('aria-current', 'page');
  list.append(element('li', {}, setupLink));
  for (const group of GROUPS) {
    const items = CHECKS.filter((check) => check.group === group.id);
    if (!items.length) continue;
    list.append(element('li', {class: 'mt-group mt-caption'}, `${group.id} · ${tr(group.title)}`));
    for (const check of items) {
      const status = statusOf(environment, check.id);
      const link = element('a', {href: `#/${check.id}`, class: `mt-item mt-item--${status}`},
        element('span', {class: 'mt-mark', 'aria-hidden': 'true'}, MARKS[status]),
        element('span', {class: 'mt-id'}, check.id),
        element('span', {}, tr(check.title)),
        element('span', {class: 'mt-hidden'}, ` (${statusText(status)})`));
      if (route.kind === 'check' && route.check === check) link.setAttribute('aria-current', 'page');
      list.append(element('li', {}, link));
    }
  }
  nav.replaceChildren(list);
  nav.querySelector('[aria-current="page"]')?.scrollIntoView({block: 'nearest'});
}

const MARKS: Record<Status, string> = {untested: '·', pass: '✓', fail: '✕', skip: '–'};
const statusText = (status: Status) => status === 'untested' ? '—' : tr(UI[status]);

function announce(message: string): void {
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = message; });
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = element('a', {href: url, download: name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(tr(UI.downloaded));
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
}

function renderMain(): void {
  unmount();
  const route = currentRoute();
  if (route.kind === 'setup') renderSetup();
  else renderCheck(route.check, route.index);
  main.focus({preventScroll: true});
  window.scrollTo({top: 0});
}

function textField(label: Text, value: string, update: (value: string) => void): HTMLElement {
  const input = element('input', {class: 'mt-field', type: 'text', value});
  input.addEventListener('change', () => update(input.value.trim()));
  return element('label', {class: 'mt-param'}, element('span', {class: 'mt-caption'}, tr(label)), input);
}

function renderSetup(): void {
  const environment = activeEnvironment(store);
  const fields = (key: keyof Pick<Environment, 'device' | 'browser' | 'output' | 'microphone'>, label: Text) =>
    textField(label, environment[key], (value) => commit(setEnvironmentFields(store, {[key]: value})));
  const select = element('select', {class: 'mt-field', 'aria-label': tr(UI.environment)});
  store.environments.forEach((item, index) => {
    const option = element('option', {value: item.id}, environmentLabel(item, index));
    option.selected = item.id === store.activeId;
    select.append(option);
  });
  select.addEventListener('change', () => { commit(selectEnvironment(store, select.value)); renderMain(); });
  const add = element('button', {type: 'button', class: 'mt-action'}, tr(UI.newEnvironment));
  add.addEventListener('click', () => { commit(addEnvironment(store)); renderMain(); });
  const remove = element('button', {type: 'button', class: 'mt-action'}, tr(UI.removeEnvironment));
  remove.addEventListener('click', () => {
    if (!confirm(`${tr(UI.removeEnvironment)}: ${environmentLabel(environment, store.environments.indexOf(environment))}?`)) return;
    commit(removeEnvironment(store, environment.id));
    renderMain();
  });
  const start = element('button', {type: 'button', class: 'mt-action mt-action--primary'}, tr(UI.start));
  start.addEventListener('click', () => go(CHECKS[0]!.id));
  main.replaceChildren(
    element('h1', {}, tr(UI.setup)),
    element('ol', {class: 'mt-steps'}, ...SETUP_STEPS.map((step) => element('li', {}, tr(step)))),
    ...(storageWorks ? [] : [element('p', {class: 'mt-error', role: 'alert'}, tr(UI.storageOff))]),
    element('section', {class: 'mt-panel', 'aria-label': tr(UI.environment)},
      element('div', {class: 'mt-panel__head mt-caption'}, tr(UI.environment)),
      element('div', {class: 'mt-form'},
        element('label', {class: 'mt-param'}, element('span', {class: 'mt-caption'}, tr(UI.environment)), select),
        fields('device', UI.device), fields('browser', UI.browser), fields('output', UI.output), fields('microphone', UI.microphone)),
      element('div', {class: 'mt-actions'}, add, remove, start)),
  );
}

function renderCheck(check: Check, index: number): void {
  const environment = activeEnvironment(store);
  const result = environment.results[check.id];
  const group = GROUPS.find((item) => item.id === check.group);
  const canvas = element('div', {class: 'mt-canvas'});
  const parameters = element('div', {class: 'mt-parameters'});
  const error = element('p', {class: 'mt-error', role: 'alert', hidden: ''});
  const parameterPanel = element('section', {class: 'mt-panel', 'aria-label': tr(UI.parameters), hidden: ''},
    element('div', {class: 'mt-panel__head mt-caption'}, tr(UI.parameters)), parameters);

  const statusButtons = (['pass', 'fail', 'skip'] as const).map((status) => {
    const button = element('button', {type: 'button', class: `mt-status mt-status--${status}`, 'aria-pressed': String(result?.status === status)}, tr(UI[status]));
    button.addEventListener('click', () => {
      const next = result?.status === status ? 'untested' : status;
      commit(setResult(store, check.id, {status: next, notes: notes.value}));
      for (const other of statusButtons) other.setAttribute('aria-pressed', String(other === button && next !== 'untested'));
      announce(`${check.id}: ${statusText(next)}`);
    });
    return button;
  });
  const notes = element('textarea', {class: 'mt-field mt-notes', rows: '3', 'aria-label': tr(UI.notes), placeholder: tr(UI.notes)});
  notes.value = result?.notes ?? '';
  notes.addEventListener('change', () => commit(setResult(store, check.id, {notes: notes.value})));

  const previous = element('a', {class: 'mt-action', href: index > 0 ? `#/${CHECKS[index - 1]!.id}` : '#/'}, `← ${tr(UI.previous)}`);
  const next = CHECKS[index + 1];
  const nextLink = element('a', {class: 'mt-action mt-action--primary', href: next ? `#/${next.id}` : '#/'}, next ? `${tr(UI.next)} · ${next.id} →` : `${tr(UI.setup)} →`);

  main.replaceChildren(
    element('p', {class: 'mt-caption'}, `${check.group} · ${group ? tr(group.title) : ''}`),
    element('h1', {}, element('span', {class: 'mt-id'}, check.id), ' ', tr(check.title)),
    element('div', {class: 'mt-columns'},
      element('section', {}, element('h2', {class: 'mt-caption'}, tr(UI.steps)), element('ol', {class: 'mt-steps'}, ...check.steps.map((step) => element('li', {}, tr(step))))),
      element('section', {}, element('h2', {class: 'mt-caption'}, tr(UI.expected)), element('ul', {class: 'mt-steps'}, ...check.expected.map((item) => element('li', {}, tr(item)))))),
    element('section', {class: 'mt-panel', 'aria-label': tr(UI.component)},
      element('div', {class: 'mt-panel__head mt-caption'}, tr(UI.component)),
      check.mount ? canvas : element('p', {class: 'mt-empty'}, tr(UI.noComposition)), error),
    parameterPanel,
    element('section', {class: 'mt-panel mt-result', 'aria-label': tr(UI.result)},
      element('div', {class: 'mt-panel__head mt-caption'}, tr(UI.result)),
      element('div', {class: 'mt-choice mt-choice--status', role: 'group', 'aria-label': tr(UI.result)}, ...statusButtons),
      notes),
    element('div', {class: 'mt-actions mt-pager'}, previous, nextLink),
  );

  if (!check.mount) return;
  const controller = new AbortController();
  const current: NonNullable<typeof active> = {controller, canvas};
  active = current;
  const context: MountContext = {
    canvas, parameters, signal: controller.signal, lang,
    fail(reason) {
      if (controller.signal.aborted) return;
      if ((reason as {name?: string} | undefined)?.name === 'AbortError') return;
      error.hidden = false;
      error.textContent = reason instanceof Error ? reason.message : String(reason);
      console.error(reason);
    },
  };
  const observer = new MutationObserver(() => { parameterPanel.hidden = parameters.childElementCount === 0; });
  observer.observe(parameters, {childList: true});
  controller.signal.addEventListener('abort', () => observer.disconnect(), {once: true});
  void check.mount().then((mount) => controller.signal.aborted ? undefined : mount(context)).then((cleanup) => {
    if (typeof cleanup !== 'function') return;
    if (controller.signal.aborted) cleanup();
    else current.cleanup = cleanup;
  }, (reason: unknown) => context.fail(reason));
}

window.addEventListener('hashchange', () => { renderChrome(); renderMain(); });
// A page leaving the back/forward cache must not keep audio running.
window.addEventListener('pagehide', unmount);
window.addEventListener('pageshow', (event) => { if (event.persisted) renderMain(); });
renderChrome();
renderMain();
