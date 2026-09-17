import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {domainFamilies, packageDirectories} from './package-policy.mjs';
import {elementCompositionPolicy} from './element-composition-policy.mjs';
import {UI_COMPOSITION_CATALOG} from '../apps/doc/shared/ui-catalog.ts';
import {UI_PRESENTER_CATALOG} from '../apps/doc/shared/ui-presenter-catalog.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = 'apps/doc/webmusic/src/content/docs';
const LOCAL_DIRECTORY = '.dev';
const OUTPUTS = [`${LOCAL_DIRECTORY}/COMPONENTS.md`, `${LOCAL_DIRECTORY}/DOCUMENTATION-MAP.md`];
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => existsSync(path.join(ROOT, file));
const posix = (file) => file.split(path.sep).join('/');
const relative = (from, to) => posix(path.relative(path.dirname(from), to));
const link = (from, to, label) => `[${label}](<${relative(from, to)}>)`;
const clean = (value = '') => String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
  .replace(/(`[^`]*`)|[<>]/g, (match, span) => span ?? (match === '<' ? '&lt;' : '&gt;')).trim();
const code = (value) => `\`${value}\``;
const list = (values) => values.length ? values.map(code).join(', ') : 'None declared in this catalog.';

function repositoryFiles() {
  // Use the same deliverable file set in a fresh clone and a working tree.
  // Ignored local notes or agent settings must not affect public inventories.
  return [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT, encoding: 'utf8',
  }).split('\0').filter(Boolean))].filter((file) =>
    lstatSync(path.join(ROOT, file), {throwIfNoEntry: false}));
}

function catalogFiles(files, {statFile = (file) => lstatSync(path.join(ROOT, file))} = {}) {
  return files.filter((file) => {
    if (!/\.mdx?$/.test(file)) return false;
    if (file.split('/').some((part, index) =>
      part.startsWith('.') && !(index === 0 && part === '.agent') ||
      ['node_modules', 'dist', 'pages-dist', 'coverage'].includes(part))) return false;
    const stat = statFile(file);
    return stat.isFile() || file === 'CLAUDE.md' && stat.isSymbolicLink();
  }).sort();
}

function localDocumentationFiles(repositoryRoot = ROOT) {
  const directory = path.join(repositoryRoot, LOCAL_DIRECTORY);
  const stat = lstatSync(directory, {throwIfNoEntry: false});
  if (!stat) return {present: false, files: []};
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${LOCAL_DIRECTORY} must be a local directory, not a symlink.`);
  const files = [];
  const visit = (parent) => {
    for (const entry of readdirSync(path.join(repositoryRoot, parent), {withFileTypes: true})) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'pages-dist', 'coverage'].includes(entry.name)) continue;
      const file = `${parent}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(file);
    }
  };
  visit(LOCAL_DIRECTORY);
  return {present: true, files: files.sort()};
}

function updateLocalInventories(outputs, {repositoryRoot = ROOT, write = false} = {}) {
  // An ordinary public checkout has no .dev directory. Neither mode creates
  // one, and ignored local notes never become public catalog requirements.
  if (!localDocumentationFiles(repositoryRoot).present) return [];
  const failures = [];
  for (const [file, body] of outputs) {
    assert.ok(OUTPUTS.includes(file), `Unsupported local inventory output: ${file}`);
    const target = path.join(repositoryRoot, file);
    const stat = lstatSync(target, {throwIfNoEntry: false});
    assert.ok(!stat || stat.isFile() && !stat.isSymbolicLink(), `${file} must be a regular local file.`);
    if (write) writeFileSync(target, body);
    else if (!stat || readFileSync(target, 'utf8') !== body) failures.push(`${file}: stale or missing; run npm run docs:sync`);
  }
  return failures;
}

function agentAliasProblems(files, {
  statFile = (file) => lstatSync(path.join(ROOT, file), {throwIfNoEntry: false}),
  readLink = (file) => readlinkSync(path.join(ROOT, file)),
} = {}) {
  if (!files.includes('CLAUDE.md')) return [];
  if (!statFile('CLAUDE.md')?.isSymbolicLink()) return ['CLAUDE.md must be a relative symlink to AGENTS.md, not a separate instruction file.'];
  if (readLink('CLAUDE.md') !== 'AGENTS.md') return ['CLAUDE.md must point to AGENTS.md.'];
  if (!files.includes('AGENTS.md') || !statFile('AGENTS.md')?.isFile()) return ['A published CLAUDE.md alias requires the canonical AGENTS.md file in version control.'];
  return [];
}

function frontmatter(source, key) {
  const block = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  const raw = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block)?.[1] ?? '';
  return raw.replace(/^(['"])([\s\S]*)\1$/, '$2');
}

function pageForRoute(route) {
  const [pathname, fragment] = route.split('#');
  const base = `${DOCS}/${pathname.replace(/^\/|\/$/g, '')}`;
  const file = [`${base}.mdx`, `${base}/index.mdx`].find(exists);
  if (!file) throw new Error(`No source page for ${route}`);
  return {file, fragment};
}

function pageLink(from, route, label) {
  const {file, fragment} = pageForRoute(route);
  return `[${label}](<${relative(from, file)}${fragment ? `#${fragment}` : ''}>)`;
}

function elementPurpose(entry, page) {
  const source = read(page);
  const lines = source.split('\n');
  const heading = lines.findIndex((line) => /^##\s/.test(line) && line.includes(`<${entry.tag}>`));
  if (heading >= 0) {
    const paragraph = lines.slice(heading + 1).join('\n').trimStart().split(/\n\s*\n/)[0];
    if (paragraph) return clean(paragraph.split(/(?<=\.)\s+/)[0]);
  }
  return clean(frontmatter(source, 'description') || entry.ui);
}

function referenceForEntry(manifest, entry) {
  const family = manifest.name.split('/')[1];
  if (family === 'kernel') return `${DOCS}/kernel/api.mdx`;
  if (family === 'ui') {
    const presenter = UI_PRESENTER_CATALOG.find((p) => `./${p.presenter}` === entry);
    return presenter ? `${DOCS}/uikit/${presenter.classSlug}/${presenter.presenter}.mdx` : `${DOCS}/uikit/api.mdx`;
  }
  if (entry === '.') return `${DOCS}/${family}/api/index.mdx`;
  const [capability, form] = entry.slice(2).split('/');
  // The `/element` and `/headless` forms are inventoried per family rather than
  // per capability: one page lists every tag or every exported value, with a
  // section per capability, and routes each to its owning leaf page. The
  // capability anchor is what keeps the element entries and the three
  // headless entries distinguishable from one another in the generated map.
  if (form === 'headless') return `${DOCS}/${family}/headless/index.mdx#${capability}`;
  if (['element', 'auto', 'global'].includes(form)) return `${DOCS}/${family}/element/index.mdx#${capability}`;
  return `${DOCS}/${family}/api/${capability}.mdx`;
}

async function componentIndex(files) {
  const output = OUTPUTS[0];
  const params = {};
  for (const family of domainFamilies) {
    for (const capability of ['play', 'analyze', 'view']) {
      const file = path.join(ROOT, `apps/doc/webmusic/src/lib/params/${family}-${capability}.ts`);
      const module = await import(pathToFileURL(file).href);
      Object.assign(params, Object.values(module)[0]);
    }
  }
  const headlessPages = files.filter((file) => file.startsWith(`${DOCS}/`) && /\/headless\//.test(file) && !file.endsWith('/index.mdx'));
  const manifests = packageDirectories.map((directory) => ({directory, manifest: JSON.parse(read(`${directory}/package.json`))}));
  const entryCount = manifests.reduce((sum, {manifest}) => sum + Object.keys(manifest.exports).length, 0);
  const lines = [
    '# Component and capability index', '',
    '> Generated by npm run docs:sync from reviewed element policies, documentation catalogs, page descriptions, and package manifests. Do not hand-edit. The design contract is [COMPONENT-DESIGN.md](design/COMPONENT-DESIGN.md); current readiness is [STATUS.md](STATUS.md).', '',
    `This checkout contains **${UI_COMPOSITION_CATALOG.length} public element tags**, **${UI_PRESENTER_CATALOG.length} presenter entries**, **${headlessPages.length} Headless reference pages**, and **${entryCount} manifest exports including package.json metadata entries**. A page may own a class, factories, and helpers; page counts are not object or API completeness counts.`, '',
    '## How to use this index', '',
    'Every Element entry links its task, Headless collaboration, reviewed UI composition, source, and owning reference page. Attribute/property/event names below are derived from the documentation parameter catalog; they are navigation, not a second signature/default table. Source and the reference page own the complete contract. Presenter controls are demo catalog controls, not an assertion that every public binding or option is listed.', '',
    'Static data has no running clock. The component design contract requires each scheduling participant, follower, or interaction driver to declare its timing and resource ownership. Shared workflow pages are intentional for declarations and companions.', '',
    '## Web Components', '',
  ];
  for (const family of domainFamilies.map((family) => family[0].toUpperCase() + family.slice(1))) {
    for (const capability of ['Play', 'Analyze', 'View']) {
      lines.push(`### ${family} / ${capability}`, '');
      for (const entry of UI_COMPOSITION_CATALOG.filter((e) => e.family === family && e.capability === capability)) {
        const policy = elementCompositionPolicy.find((e) => e.tag === entry.tag);
        const spec = params[entry.tag];
        if (!policy || !spec) throw new Error(`Missing reviewed composition or params for ${entry.tag}`);
        const {file} = pageForRoute(entry.href);
        lines.push(`#### ${code(`<${entry.tag}>`)}`, '', elementPurpose(entry, file), '',
          `- Behavior/data collaboration: ${clean(entry.headless)}.`,
          `- Reviewed UI composition: ${policy.behaviorOnly ? 'Nonvisual behavior/declaration; no presenter required.' : list(policy.ui.map((p) => `@webmusic/ui/${p}`)) + '.'}`,
          `- Attribute controls: ${list(spec.params.map((p) => p.name))}`,
          `- Properties and methods: ${list((spec.properties ?? []).map((p) => p.name))}`,
          `- Events: ${list((spec.events ?? []).map((p) => p.name))}`,
          `- ${pageLink(output, entry.href, 'Owning workflow and contract')} · ${link(output, policy.source, 'Element source')} · ${link(output, `apps/doc/webmusic/src/lib/params/${family.toLowerCase()}-${capability.toLowerCase()}.ts`, 'Parameter catalog')}`, '');
      }
    }
  }
  lines.push('## UI presenters', '', '| Entry | Responsibility | Demo state / options | Contract and implementation |', '|---|---|---|---|');
  for (const presenter of UI_PRESENTER_CATALOG) {
    const page = `${DOCS}/uikit/${presenter.classSlug}/${presenter.presenter}.mdx`;
    lines.push(`| ${code(`@webmusic/ui/${presenter.presenter}`)} | ${clean(presenter.summary)} | State: ${list((presenter.state ?? []).map((p) => p.name))} Options: ${list((presenter.options ?? []).map((p) => p.name))} | ${link(output, page, 'Reference')} · ${link(output, `packages/ui/src/${presenter.presenter}.ts`, 'Source')} |`);
  }
  lines.push('', '## Headless objects and related helpers', '', 'These are the currently documented ownership pages, not a proof that every exported member has complete reference coverage. See STATUS for catalog and template alignment work.', '', '| Reference owner | Task | Public source entry |', '|---|---|---|');
  for (const file of headlessPages) {
    const source = read(file);
    const segments = file.slice(DOCS.length + 1).split('/');
    const barrel = `packages/${segments[0]}/src/${segments[2]}/headless/index.ts`;
    lines.push(`| ${link(output, file, clean(frontmatter(source, 'title')))} | ${clean(frontmatter(source, 'description'))} | ${link(output, barrel, 'Barrel and contracts')} |`);
  }
  lines.push('', '## API and resource entry map', '', 'This manifest-derived map includes worker, driver, render, registration, framework, and metadata entries. The referenced page owns usage; each manifest remains authoritative for resolution and packaging. Some entries have import side effects or optional runtime requirements.', '', '| Import | Manifest | Owning reference |', '|---|---|---|');
  for (const {directory, manifest} of manifests) {
    for (const entry of Object.keys(manifest.exports)) {
      const name = entry === '.' ? manifest.name : `${manifest.name}/${entry.slice(2)}`;
      const reference = entry === './package.json' ? `${directory}/package.json` : referenceForEntry(manifest, entry);
      if (!exists(reference.split('#')[0])) throw new Error(`Missing owning reference for ${name}: ${reference}`);
      lines.push(`| ${code(name)} | ${link(output, `${directory}/package.json`, 'Manifest')} | ${link(output, reference, entry === './package.json' ? 'Metadata' : 'Reference')} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const DEV_HISTORY = /^\.dev\/(audits|plans|log|prototypes)\//;
const isDatedAudit = (file) => /^\.dev\/audits\/\d{4}-\d{2}-\d{2}\//.test(file);
const isCurrentDevGuide = (file) => file.startsWith('.dev/') &&
  (!DEV_HISTORY.test(file) || file.endsWith('/README.md') && !isDatedAudit(file));

function role(file) {
  if (file === 'CLAUDE.md') return 'Agent instruction alias; relative symlink to canonical AGENTS.md';
  if (path.posix.basename(file) === 'AGENTS.md') return 'Agent onboarding, documentation routing and development workflow';
  if (file.startsWith('.agent/skills/') && file.endsWith('/SKILL.md')) return 'Project skill source; client discovery is configured separately';
  if (file.startsWith('.agent/')) return 'Project agent toolkit / workflow / rule-owner map; local development notes remain optional';
  if (file === 'skills/README.md') return 'Public consumer skill installation and maintenance';
  if (file.startsWith('skills/') && file.endsWith('/SKILL.md')) return 'Portable application-development skill entry point';
  if (file.startsWith('skills/') && file.includes('/assets/')) return 'Bundled consumer-project instruction fragment';
  if (file.startsWith('skills/') && file.includes('/evals/')) return 'Consumer skill behavioral acceptance scenarios';
  if (file.startsWith('skills/')) return 'Public consumer skill reference';
  if (file.startsWith(`${DOCS}/`)) return 'Public reference / orientation; public source, examples and owning reference';
  if (file.startsWith('.dev/') && file.endsWith('/README.md') && !isDatedAudit(file)) return DEV_HISTORY.test(file)
    ? 'Maintained navigation to historical records or prototypes; not a current work queue'
    : 'Current documentation navigation and ownership';
  if (DEV_HISTORY.test(file)) return 'Historical evidence / proposal / workflow record / prototype; current work is in STATUS';
  if (/^packages\/[^/]+\/docs\//.test(file)) return 'Historical package notes; current reference is in the docs site';
  if (file.startsWith('scripts/release-pipeline/')) return 'Archived release design, not an active workflow';
  if (file === '.dev/STATUS.md') return 'Current implementation and verification status';
  if (OUTPUTS.includes(file)) return 'Derived inventory; regenerate rather than hand-edit';
  if (file === 'README.md') return 'Navigation and project entry';
  if (file === 'CONTRIBUTING.md') return 'Public contribution process and verification entry point';
  if (file === 'SECURITY.md') return 'Security reporting process and supported-version policy';
  if (file === 'CHANGELOG.md') return 'Release notes; Unreleased does not establish publication';
  if (/TEMPLATE\.md$/.test(file)) return 'Current public-page authoring contract';
  if (file === '.dev/DEVELOPMENT.md' || /(?:PUBLISHING|RELEASING)\.md$/.test(file) || file === 'apps/README.md') return 'Current contributor / operational reference';
  if (file.startsWith('.dev/') || /ARCHITECTURE\.md$/.test(file) || file.startsWith('platform/') && !file.startsWith('platform/kernel/')) return 'Current design / technical contract; proposals explicitly marked inside';
  return 'Package usage and technical reference';
}

function documentationMap(files) {
  const output = OUTPUTS[1];
  const groups = new Map([
    ['Project and contribution entry points', []],
    ['Project agent toolkit', []],
    ['Consumer Agent Toolkit', []],
    ['Core development guidance and generated indexes', []],
    ['Component design', []],
    ['Documentation authoring', []],
    ['Release operations', []],
    ['Package and platform references', []],
    ['Public documentation', []],
    ['Plans, audits, workflow logs and prototypes', []],
    ['Package notes and release archive', []],
  ]);
  for (const file of files) {
    const group = !file.includes('/') ? 'Project and contribution entry points'
      : file.startsWith('.agent/') ? 'Project agent toolkit'
      : file.startsWith('skills/') ? 'Consumer Agent Toolkit'
      : file.startsWith('.dev/design/') ? 'Component design'
      : file.startsWith('.dev/docs/') ? 'Documentation authoring'
      : file.startsWith('.dev/release/') ? 'Release operations'
      : DEV_HISTORY.test(file) ? 'Plans, audits, workflow logs and prototypes'
      : file.startsWith('.dev/') ? 'Core development guidance and generated indexes'
      : file.startsWith(`${DOCS}/`) ? 'Public documentation'
      : /^packages\/[^/]+\/docs\//.test(file) || file.startsWith('scripts/release-pipeline/') ? 'Package notes and release archive'
      : 'Package and platform references';
    groups.get(group).push(file);
  }
  const sections = [...groups].filter(([, members]) => members.length).flatMap(([title, members]) => [
    `## ${title}`, '', '| Document | Role |', '|---|---|',
    ...members.map((file) => `| ${link(output, file, file)} | ${role(file)} |`), '',
  ]);
  return [
    '# Repository documentation map', '',
    '> Generated locally by npm run docs:sync from tracked and non-ignored repository files plus the optional .dev notes present in this checkout. The .dev directory and these indexes are local resources, not public deliverables or build prerequisites. Other hidden directories, dependencies, builds, coverage and symlink targets are not traversed. An optional published .agent toolkit or verified CLAUDE.md alias can also be indexed. This map assigns reading roles, not a claim that historical statements or API examples are current.', '',
    `**${files.length} documents** are indexed. Start at [.dev/README.md](README.md) for ownership and reading order; consult [STATUS.md](STATUS.md) for open work and [COMPONENTS.md](COMPONENTS.md) for capabilities.`, '',
    'Current rules link to source/configuration. Package-local legacy notes, expansion plans, old pipeline descriptions, and audits retain history rather than compete with current contracts. Public pages own user-facing member details; design documents own intent and decisions.', '',
    ...sections,
  ].join('\n');
}

function withoutFences(source) {
  let fence = null;
  return source.split('\n').map((line) => {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

const HISTORICAL_BODY_MARKER = '<!-- docs:historical-body -->';

function currentLinkSource(file, source) {
  const prose = withoutFences(source);
  const archive = DEV_HISTORY.test(file) || /^(?:packages\/[^/]+\/docs\/|scripts\/release-pipeline\/)/.test(file);
  // README indexes and archive runbooks are current navigation, even when
  // they sit beside historical notes. Only an explicit, standalone marker
  // in a non-index archive note ends its current, checked preamble.
  if (!archive || path.posix.basename(file) === 'README.md' && !isDatedAudit(file)) return prose;
  const boundary = prose.split('\n').findIndex((line) => line.trim() === HISTORICAL_BODY_MARKER);
  return boundary < 0 ? prose : prose.split('\n').slice(0, boundary).join('\n');
}

function markdownFileTargets(source) {
  const targets = [];
  for (const match of source.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+)(?:\s+"[^"]*")?)\)/g)) {
    targets.push(match[1] ?? match[2]);
  }
  // Reference destinations are declarations, so check them independently of
  // whether their use is full, collapsed, or shortcut reference syntax.
  // Accept angle destinations, optional titles and a destination on the next
  // indented line, including definitions inside blockquotes.
  for (const match of source.matchAll(/^ {0,3}(?:>[ \t]*)*\[[^\]\n]+\]:[ \t]*(?:\n[ \t]+)?(?:<([^>\n]+)>|([^\s]+))/gm)) {
    targets.push(match[1] ?? match[2]);
  }
  return targets;
}

function fileLinkProblems(files, {readFile = read, targetExists = exists} = {}) {
  const failures = [];
  for (const file of files) {
    const source = currentLinkSource(file, readFile(file));
    for (const target of markdownFileTargets(source)) {
      if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(target)) {
        failures.push(`${file}: machine-local link ${target}`);
        continue;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
      if (target.startsWith('/')) {
        if (/^\/(?:Users|home|private|tmp)\//.test(target)) failures.push(`${file}: machine-local link ${target}`);
        continue; // Site-absolute routes belong to check:docs.
      }
      const pathname = decodeURI(target.split('#')[0]);
      if (!pathname) continue;
      const resolved = posix(path.normalize(path.join(path.dirname(file), pathname))).replace(/\/$/, '') || '.';
      if (!targetExists(resolved)) failures.push(`${file}: missing local target ${target}`);
    }
  }
  return failures;
}

function navigationTargets(source) {
  const definitions = new Map();
  const normalize = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();
  // File-link validation also checks unused definitions. Reading routes need
  // visible links, so exclude comments/code and resolve only used references.
  let prose = source.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  prose = prose.replace(/(`+)([\s\S]*?)\1(?!`)/g, '');
  prose = prose.replace(/^ {0,3}(?:>[ \t]*)*\[([^\]\n]+)\]:[ \t]*(?:\n[ \t]+)?(?:<([^>\n]+)>|([^\s]+))[^\n]*$/gm,
    (_, label, angle, plain) => {
      const key = normalize(label);
      if (!definitions.has(key)) definitions.set(key, angle ?? plain);
      return '';
    });
  const targets = [];
  prose = prose.replace(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+)(?:\s+"[^"]*")?)\)/g,
    (_, angle, plain) => {
      targets.push(angle ?? plain);
      return '';
    });
  for (const match of prose.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const target = definitions.get(normalize(match[2] || match[1]));
    if (target) targets.push(target);
  }
  return targets;
}

function devNavigationProblems(files, {readFile = read, guideEntry = 'README.md'} = {}) {
  const fileSet = new Set(files);
  const guides = new Set(files.filter(isCurrentDevGuide));
  const agentGuides = new Set(files.filter((file) => file.startsWith('.agent/')));
  const reachableFrom = (start, allowed) => {
    const reachable = new Set();
    const pending = fileSet.has(start) ? [start] : [];
    while (pending.length) {
      const file = pending.pop();
      if (reachable.has(file)) continue;
      reachable.add(file);
      // An automatically generated list must not conceal a missing reading route.
      if (OUTPUTS.includes(file)) continue;
      for (const target of navigationTargets(currentLinkSource(file, readFile(file)))) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) continue;
        const pathname = decodeURI(target.split(/[?#]/)[0]);
        const next = posix(path.normalize(path.join(path.dirname(file), pathname)));
        if (fileSet.has(next) && allowed.has(next)) pending.push(next);
      }
    }
    return reachable;
  };
  const reachable = reachableFrom(guideEntry, new Set([...guides, 'CONTRIBUTING.md']));
  const agentEntry = fileSet.has('AGENTS.md') ? 'AGENTS.md' : '.agent/README.md';
  const agentReachable = reachableFrom(agentEntry, agentGuides);
  return [
    ...[...guides].filter((file) => !reachable.has(file))
      .map((file) => `${file}: no maintained reading route from ${guideEntry}; link it from the appropriate documentation index`),
    ...[...agentGuides].filter((file) => !agentReachable.has(file))
      .map((file) => `${file}: no maintained reading route from ${agentEntry}; link it from the optional agent toolkit index`),
  ];
}

function runDevNavigationProbes() {
  const guide = '.dev/design/component.md';
  const orphan = [`${guide}: no maintained reading route from README.md; link it from the appropriate documentation index`];
  const probes = [
    {name: 'guide reached through section index', docs: {
      'README.md': '[Dev](.dev/README.md)',
      '.dev/README.md': '[Design](design/README.md)',
      '.dev/design/README.md': '[Component](component.md#contract)',
      [guide]: '[Back](README.md)',
    }, expected: []},
    {name: 'orphaned guide fails', docs: {'README.md': '', [guide]: ''}, expected: orphan},
    {name: 'generated inventory does not mask an orphan', docs: {
      'README.md': '[Map](.dev/DOCUMENTATION-MAP.md)',
      '.dev/DOCUMENTATION-MAP.md': '[Component](design/component.md)',
      [guide]: '',
    }, expected: orphan},
    {name: 'historical body does not establish current navigation', docs: {
      'README.md': '[Old](.dev/plans/old.md)',
      '.dev/plans/old.md': '[Component](../design/component.md)',
      [guide]: '',
    }, expected: orphan},
    {name: 'archive directory index is maintained navigation', docs: {
      'README.md': '[Plans](.dev/plans/README.md)',
      '.dev/plans/README.md': '[Component](../design/component.md)',
      [guide]: '',
    }, expected: []},
    {name: 'reference destination and cyclic links', docs: {
      'README.md': '[Guide][guide]\n[guide]: <.dev/design/component.md> "Guide"',
      [guide]: '[Self](component.md)',
    }, expected: []},
    {name: 'fenced link does not create navigation', docs: {
      'README.md': '```md\n[Component](.dev/design/component.md)\n```',
      [guide]: '',
    }, expected: orphan},
    {name: 'unused reference definition is not navigation', docs: {
      'README.md': '[unused]: .dev/design/component.md', [guide]: '',
    }, expected: orphan},
    {name: 'inline code is not navigation', docs: {
      'README.md': '`[Component](.dev/design/component.md)`', [guide]: '',
    }, expected: orphan},
    {name: 'commented link is not navigation', docs: {
      'README.md': '<!-- [Component](.dev/design/component.md) -->', [guide]: '',
    }, expected: orphan},
    {name: 'collapsed and shortcut references are navigation', docs: {
      'README.md': '[Component][]\n[Component]: .dev/design/component.md',
      [guide]: '[Back]\n[Back]: README.md',
      '.dev/design/README.md': '',
    }, expected: []},
    {name: 'first normalized reference definition wins', docs: {
      'README.md': '[Guide]\n\n[guide]: https://example.com\n[GUIDE]: .dev/design/component.md',
      [guide]: '',
    }, expected: orphan},
    {name: 'project toolkit routes to a skill', docs: {
      'AGENTS.md': '[Toolkit](.agent/README.md)',
      '.agent/README.md': '[Skill](skills/review/SKILL.md)',
      '.agent/skills/review/SKILL.md': '',
    }, expected: []},
    {name: 'unlinked project skill fails', docs: {
      'AGENTS.md': '', '.agent/skills/review/SKILL.md': '',
    }, expected: ['.agent/skills/review/SKILL.md: no maintained reading route from AGENTS.md; link it from the optional agent toolkit index']},
    {name: 'public guide can be reached through contribution guide without agent files', docs: {
      'README.md': '[Contribute](CONTRIBUTING.md)',
      'CONTRIBUTING.md': '[Component](.dev/design/component.md)',
      [guide]: '',
    }, expected: []},
    {name: 'agent-only route cannot replace a public reading route', docs: {
      'README.md': '', 'AGENTS.md': '[Component](.dev/design/component.md)', [guide]: '',
    }, expected: orphan},
    {name: 'optional toolkit can use its own index without an agent entry', docs: {
      'README.md': '', '.agent/README.md': '[Skill](skills/review/SKILL.md)',
      '.agent/skills/review/SKILL.md': '',
    }, expected: []},
    {name: 'missing optional contribution link does not crash navigation', docs: {
      'README.md': '[Contribute](CONTRIBUTING.md)', [guide]: '',
    }, expected: orphan},
  ];
  for (const probe of probes) {
    assert.deepEqual(devNavigationProblems(Object.keys(probe.docs), {
      readFile: (file) => probe.docs[file],
    }), probe.expected, probe.name);
  }
  return probes.length;
}

function runFileLinkProbes() {
  const ordinary = '.dev/probe.md';
  const plan = '.dev/plans/probe.md';
  const note = 'packages/audio/docs/README-play.md';
  const index = 'packages/audio/docs/README.md';
  const pipeline = 'scripts/release-pipeline/README.md';
  const missing = (file, target = 'missing.md') => [`${file}: missing local target ${target}`];
  const machine = (file, target) => [`${file}: machine-local link ${target}`];
  const history = `${HISTORICAL_BODY_MARKER}\n\n[Old reference](retired.md)\n[old]: /Users/old/checkout.md\n`;
  const probes = [
    {name: 'missing inline destination', source: '[Current](missing.md)', expected: missing(ordinary)},
    {name: 'missing reference destination', source: '[Current][ref]\n\n[ref]: missing.md', expected: missing(ordinary)},
    {name: 'angle reference with title', source: '[ref]: <missing.md> "Title"', expected: missing(ordinary)},
    {name: 'reference destination on next line', source: '[ref]:\n  missing.md', expected: missing(ordinary)},
    {name: 'blockquote reference definition', source: '> [ref]: missing.md', expected: missing(ordinary)},
    {name: 'missing inline in current archive preamble', file: plan, source: `[Current](missing.md)\n\n${history}`, expected: missing(plan)},
    {name: 'missing reference in current package preamble', file: note, source: `[ref]: missing.md\n\n${history}`, expected: missing(note)},
    {name: 'preserved history is allowed', file: plan, source: `[Current](exists.md)\n\n${history}`, expected: []},
    {name: 'package history is allowed', file: note, source: `[ref]: exists.md\n\n${history}`, expected: []},
    {name: 'unmarked archive is checked', file: plan, source: '[Current](missing.md)', expected: missing(plan)},
    {name: 'archive index is always checked', file: index, source: `${HISTORICAL_BODY_MARKER}\n\n[Current](missing.md)`, expected: missing(index)},
    {name: 'release archive README is always checked', file: pipeline, source: `${HISTORICAL_BODY_MARKER}\n\n[ref]: missing.md`, expected: missing(pipeline)},
    {name: 'dated audit README can preserve its historical body', file: '.dev/audits/2026-09-05/README.md', source: `[Current](exists.md)\n\n${history}`, expected: []},
    {name: 'audit directory index is always checked', file: '.dev/audits/README.md', source: history, expected: [
      '.dev/audits/README.md: missing local target retired.md',
      '.dev/audits/README.md: machine-local link /Users/old/checkout.md',
    ]},
    {name: 'dated workflow can preserve its historical body', file: '.dev/log/2026-09-09-agent-guidance-sync.md', source: `[Current](exists.md)\n\n${history}`, expected: []},
    {name: 'marker cannot exempt a current document', source: `${HISTORICAL_BODY_MARKER}\n[ref]: missing.md`, expected: missing(ordinary)},
    {name: 'machine-local inline target', source: '[Local](/Users/person/file.md)', expected: machine(ordinary, '/Users/person/file.md')},
    {name: 'machine-local reference target', source: '[ref]: /home/person/file.md', expected: machine(ordinary, '/home/person/file.md')},
    {name: 'file URI reference target', source: '[ref]: file:///Users/person/file.md', expected: machine(ordinary, 'file:///Users/person/file.md')},
    {name: 'Windows reference target', source: '[ref]: C:\\Users\\person\\file.md', expected: machine(ordinary, 'C:\\Users\\person\\file.md')},
    {name: 'fenced links and marker are not prose', file: plan, source: `\`\`\`md\n[Ignored](retired.md)\n${HISTORICAL_BODY_MARKER}\n\`\`\`\n[ref]: missing.md`, expected: missing(plan)},
    {name: 'valid inline and reference targets', source: '[Current](exists.md#heading)\n[ref]: <exists.md> "Title"', expected: []},
    {name: 'directory links use the delivered directory path', source: '[Directory](examples/)', targetExists: (file) => file === '.dev/examples', expected: []},
    {name: 'external and route boundaries', source: '[Web](https://example.com/)\n[Page](#heading)\n[Route](/score/)\n[ref]: mailto:maintainer@example.com', expected: []},
  ];
  for (const probe of probes) {
    const result = fileLinkProblems([probe.file ?? ordinary], {
      readFile: () => probe.source,
      targetExists: probe.targetExists ?? ((file) => file.endsWith('/exists.md')),
    });
    assert.deepEqual(result, probe.expected, probe.name);
  }
  return probes.length;
}

function runOptionalAgentProbes() {
  const regular = {isFile: () => true, isSymbolicLink: () => false};
  const symlink = {isFile: () => false, isSymbolicLink: () => true};
  assert.deepEqual(agentAliasProblems([]), [], 'agent files are optional');
  assert.deepEqual(agentAliasProblems(['AGENTS.md']), [], 'an agent guide does not require an alias');
  assert.deepEqual(agentAliasProblems(['AGENTS.md', 'CLAUDE.md'], {
    statFile: (file) => file === 'CLAUDE.md' ? symlink : regular,
    readLink: () => 'AGENTS.md',
  }), [], 'published relative alias is supported');
  assert.equal(agentAliasProblems(['CLAUDE.md'], {statFile: () => regular}).length, 1,
    'a published copied alias fails');
  assert.equal(agentAliasProblems(['CLAUDE.md'], {statFile: () => symlink, readLink: () => 'AGENTS.md'}).length, 1,
    'a published alias cannot depend on an ignored canonical file');
  assert.equal(agentAliasProblems(['AGENTS.md', 'CLAUDE.md'], {
    statFile: () => symlink, readLink: () => '/Users/person/AGENTS.md',
  }).length, 1, 'a machine-local alias fails');
  assert.deepEqual(catalogFiles(['README.md', '.dev/README.md', '.agent/README.md', 'notes-link.md', 'CLAUDE.md'], {
    statFile: (file) => file.endsWith('link.md') || file === 'CLAUDE.md' ? symlink : regular,
  }), ['.agent/README.md', 'CLAUDE.md', 'README.md'], 'only supported deliverable documentation is cataloged');
  return 7;
}

function runLocalDocumentationProbes() {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'webmusic-local-docs-'));
  const localExists = (file) => existsSync(path.join(repositoryRoot, file));
  const localRead = (file) => readFileSync(path.join(repositoryRoot, file), 'utf8');
  const outputs = new Map(OUTPUTS.map((file) => [file, `# ${path.basename(file)}\n`]));
  try {
    writeFileSync(path.join(repositoryRoot, 'README.md'), '[Contribution](CONTRIBUTING.md)\n');
    writeFileSync(path.join(repositoryRoot, 'CONTRIBUTING.md'), '# Contribution\n');
    const publicFiles = ['README.md', 'CONTRIBUTING.md'];
    assert.deepEqual(localDocumentationFiles(repositoryRoot), {present: false, files: []}, 'a public checkout needs no local notes');
    assert.deepEqual(updateLocalInventories(outputs, {repositoryRoot}), [], 'checking without .dev needs no generated files');
    assert.deepEqual(fileLinkProblems(publicFiles, {readFile: localRead, targetExists: localExists}), [], 'public links are still checked without .dev');
    writeFileSync(path.join(repositoryRoot, 'README.md'), '[Missing](missing.md)\n');
    assert.deepEqual(fileLinkProblems(publicFiles, {readFile: localRead, targetExists: localExists}), ['README.md: missing local target missing.md'], 'a missing public link still fails without .dev');
    updateLocalInventories(outputs, {repositoryRoot, write: true});
    assert.equal(localExists('.dev'), false, 'sync does not create an optional notes directory');
    assert.equal(localExists('dev'), false, 'sync never recreates the former public directory');

    mkdirSync(path.join(repositoryRoot, '.dev/docs'), {recursive: true});
    mkdirSync(path.join(repositoryRoot, '.dev/.agent'), {recursive: true});
    writeFileSync(path.join(repositoryRoot, '.dev/README.md'), '[Guide](docs/guide.md)\n[Components](COMPONENTS.md)\n[Map](DOCUMENTATION-MAP.md)\n');
    writeFileSync(path.join(repositoryRoot, '.dev/docs/guide.md'), '[Contribution](../../CONTRIBUTING.md)\n');
    writeFileSync(path.join(repositoryRoot, '.dev/.agent/private.md'), '[Ignored](missing.md)\n');
    symlinkSync('../CONTRIBUTING.md', path.join(repositoryRoot, '.dev/link.md'));
    assert.deepEqual(localDocumentationFiles(repositoryRoot), {
      present: true, files: ['.dev/README.md', '.dev/docs/guide.md'],
    }, 'optional notes are read without following symlinks or hidden directories');
    assert.equal(updateLocalInventories(outputs, {repositoryRoot}).length, 2, 'present local notes require fresh local inventories');
    updateLocalInventories(outputs, {repositoryRoot, write: true});
    assert.deepEqual(updateLocalInventories(outputs, {repositoryRoot}), [], 'sync refreshes local inventories');
    assert.equal(localExists('dev'), false, 'sync writes only inside .dev');
    assert.deepEqual(fileLinkProblems(localDocumentationFiles(repositoryRoot).files, {
      readFile: localRead, targetExists: localExists,
    }), [], 'local links resolve against the actual checkout');
    assert.deepEqual(devNavigationProblems(localDocumentationFiles(repositoryRoot).files, {
      readFile: localRead, guideEntry: '.dev/README.md',
    }), [], 'internal navigation does not require a route from the public README');
    writeFileSync(path.join(repositoryRoot, '.dev/docs/guide.md'), '[Missing](missing.md)\n');
    assert.deepEqual(fileLinkProblems(['.dev/docs/guide.md'], {
      readFile: localRead, targetExists: localExists,
    }), ['.dev/docs/guide.md: missing local target missing.md'], 'broken local links are still checked');
    writeFileSync(path.join(repositoryRoot, 'README.md'), '[Private](.dev/README.md)\n');
    assert.deepEqual(fileLinkProblems(publicFiles, {
      readFile: localRead, targetExists: (file) => publicFiles.includes(file) && localExists(file),
    }), ['README.md: missing local target .dev/README.md'], 'public documentation cannot depend on ignored notes');
    writeFileSync(path.join(repositoryRoot, OUTPUTS[0]), '# Stale\n');
    assert.equal(updateLocalInventories(outputs, {repositoryRoot}).length, 1, 'changed local inventories fail freshness checks');
    rmSync(path.join(repositoryRoot, OUTPUTS[0]));
    symlinkSync('../CONTRIBUTING.md', path.join(repositoryRoot, OUTPUTS[0]));
    assert.throws(() => updateLocalInventories(outputs, {repositoryRoot, write: true}), /regular local file/, 'sync does not overwrite a symlink target');
    assert.equal(localRead('CONTRIBUTING.md'), '# Contribution\n');
    rmSync(path.join(repositoryRoot, '.dev'), {recursive: true});
    symlinkSync('.', path.join(repositoryRoot, '.dev'));
    assert.throws(() => localDocumentationFiles(repositoryRoot), /local directory/, 'local indexing does not follow a directory symlink');
    return 18;
  } finally {
    rmSync(repositoryRoot, {recursive: true, force: true});
  }
}

const probeCount = runFileLinkProbes();
const navigationProbeCount = runDevNavigationProbes();
const optionalAgentProbeCount = runOptionalAgentProbes();
const localDocumentationProbeCount = runLocalDocumentationProbes();
if (process.argv.includes('--self-test')) {
  console.log(`Documentation probes passed: ${probeCount} file-link cases, ${navigationProbeCount} navigation cases, ${optionalAgentProbeCount} optional-agent cases, ${localDocumentationProbeCount} optional-local cases.`);
} else {
  const deliverables = repositoryFiles().filter((file) => !file.startsWith(`${LOCAL_DIRECTORY}/`));
  const aliasProblems = agentAliasProblems(deliverables);
  assert.equal(aliasProblems.length, 0, aliasProblems.join('\n'));
  const publicFiles = catalogFiles(deliverables);
  const local = localDocumentationFiles();
  const localFiles = local.present ? [...new Set([...local.files, ...OUTPUTS])].sort() : [];
  const files = [...new Set([...publicFiles, ...localFiles])].sort();
  const outputs = new Map([[OUTPUTS[0], await componentIndex(files)], [OUTPUTS[1], documentationMap(files)]]);
  if (process.argv.includes('--write')) {
    updateLocalInventories(outputs, {write: true});
    console.log(local.present
      ? `Local documentation inventories generated in ${LOCAL_DIRECTORY}: ${publicFiles.length} public and ${localFiles.length} local documents, ${UI_COMPOSITION_CATALOG.length} elements, ${UI_PRESENTER_CATALOG.length} presenters.`
      : `Documentation catalogs validated; no ${LOCAL_DIRECTORY} directory is present, so no local inventories were written.`);
  } else {
    const failures = updateLocalInventories(outputs);
    const deliveredPaths = new Set(deliverables);
    for (const file of deliverables) {
      for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory)) deliveredPaths.add(directory);
    }
    failures.push(...fileLinkProblems(publicFiles, {
      targetExists: (file) => exists(file) && (file === '.' || deliveredPaths.has(file)),
    }));
    failures.push(...devNavigationProblems(publicFiles));
    if (local.present) {
      failures.push(...fileLinkProblems(localFiles.filter(exists)));
      failures.push(...devNavigationProblems(localFiles.filter(exists), {guideEntry: `${LOCAL_DIRECTORY}/README.md`}));
    }
    if (failures.length) {
      console.error(`Development documentation check failed:\n${failures.map((f) => `- ${f}`).join('\n')}`);
      process.exitCode = 1;
    } else console.log(`Documentation check passed: ${publicFiles.length} public documents${local.present ? ` and ${localFiles.length} optional local documents` : ''}; public file links${local.present ? ', local inventories and internal reading routes' : ' and catalogs'} are consistent.`);
  }
}
