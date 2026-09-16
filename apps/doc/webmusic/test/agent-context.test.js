import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {
  agentContext, declaredAgentContextPaths, extractAgentMarkdown, generateAgentContext,
  patternSections, verifyAgentContextOutput, verifyReleaseBaseline,
} from '../scripts/agent-context.mjs';
import {assertPublicRuntimeSource} from '../scripts/agent-context-catalog.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const temporary = [];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const document = (body) => `---\ntitle: Fixture\ndescription: A test reference\n---\n\n${body}`;
const temp = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-agent-context-'));
  temporary.push(directory);
  return directory;
};
const write = async (directory, relative, contents) => {
  await mkdir(path.dirname(path.join(directory, relative)), {recursive: true});
  await writeFile(path.join(directory, relative), contents);
};
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, {recursive: true, force: true}))); });

describe('agent context MDX extraction', () => {
  it('preserves Unicode prose, tables, literal examples and URLs inside code', async () => {
    const markdown = 'é — 😀\n\n| Units | Default |\n| --- | --- |\n| seconds | `0` |\n\n```ts\nconst path = "/asset.wav";\n```\n\n[Reference](/score/api/)';
    const result = await extractAgentMarkdown(document(markdown), {resolveLink: (url) => `https://example.test/WebMusic${url}`});
    expect(result.body).toContain(markdown.slice(0, markdown.indexOf('[Reference]')));
    expect(result.body).toContain('[Reference](<https://example.test/WebMusic/score/api/>)');
    expect(result.body).not.toContain('title: Fixture');
  });

  it('extracts exported code without evaluating JavaScript, including retained unused samples', async () => {
    const source = document('import ApiSandbox from "./ApiSandbox.astro";\n\nexport const rendered = (`import {ScorePlayer} from "@webmusic/score/play/headless";`);\n\nexport const extra = "const escaped = \\"ok\\";";\n\n<ApiSandbox code={rendered} />');
    const result = await extractAgentMarkdown(source);
    expect(result.body).toContain('```ts\nimport {ScorePlayer}');
    expect(result.body).toContain('### extra\n\n```ts\nconst escaped = "ok";');
    expect(result.body).not.toContain('export const rendered');
  });

  it('includes the actual allowlisted imported raw helper', async () => {
    const filename = 'apps/doc/webmusic/src/content/docs/quick-start.mdx';
    const source = await readFile(path.join(root, filename), 'utf8');
    const helper = await readFile(path.join(root, 'apps/doc/webmusic/src/components/quick-start-player-client.ts'), 'utf8');
    const result = await extractAgentMarkdown(source, {root, filename});
    expect(result.body).toContain(helper.trimEnd());
    expect(result.body).not.toContain('<Code');
    expect(result.body).toContain('## Register the components');
  });

  it('preserves copyable project instructions directly from the documentation page', async () => {
    const filename = 'apps/doc/webmusic/src/content/docs/agent-toolkit/agents-md.mdx';
    const source = await readFile(path.join(root, filename), 'utf8');
    const instructions = source.match(/```markdown\n[\s\S]*?\n```/)?.[0];
    expect(instructions).toBeTruthy();
    const result = await extractAgentMarkdown(source, {root, filename});
    expect(result.body).toContain(instructions);
  });

  it('preserves static HTML tables and rewrites links without rewriting fenced application HTML', async () => {
    const source = document('<details>\n<summary>Details</summary>\n\n```html\n<a href="/application">Open</a>\n```\n\n<table><tbody><tr><td><a href="/score/">Score</a></td></tr></tbody></table>\n\n</details>');
    const result = await extractAgentMarkdown(source, {resolveLink: (url) => `https://example.test/WebMusic${url}`});
    expect(result.body).toContain('<a href="/application">Open</a>');
    expect(result.body).toContain('<a href="https://example.test/WebMusic/score/">Score</a>');
  });

  it.each([
    ['computed export', 'export const code = (() => "should not run")();'],
    ['interpolated export', 'export const code = `hello ${process.env.USER}`;'],
    ['unknown component', 'import Unknown from "./Unknown.astro";\n\n<Unknown />'],
    ['computed content', '{1 + 2}'],
    ['computed HTML', '<table id={"computed"} />'],
    ['private raw import', 'import notes from "../../.dev/STATUS.md?raw";'],
    ['executable export', 'export default function run() { return "x"; }'],
  ])('rejects %s with the owning file in its diagnostic', async (_, source) => {
    await expect(extractAgentMarkdown(document(source), {filename: 'test.mdx'})).rejects.toThrow(/test\.mdx:/);
  });
});

describe('agent context release and output contracts', () => {
  it('declares only explicitly public routes without requiring private notes', async () => {
    const directory = await temp();
    for (const relative of ['index.mdx', 'quick-start.mdx', 'score/api/index.mdx', 'agent-toolkit/index.mdx', 'audio/api.mdx', 'bridge/index.mdx', '.private/secrets.mdx']) {
      await write(directory, `apps/doc/webmusic/src/content/docs/${relative}`, document('Public content'));
    }
    await write(directory, 'apps/doc/shared/ui-presenter-catalog.ts', 'export const UI_PRESENTER_CATALOG = [];');
    await write(directory, 'apps/doc/shared/ui-catalog.ts', 'export const UI_COMPOSITION_CATALOG = [];');
    const routes = await declaredAgentContextPaths({root: directory});
    expect([...routes]).toEqual(expect.arrayContaining(['/llms.txt', '/llms-full.txt', '/llms-components.txt', '/llms-patterns.txt', '/agent-context/manifest.json', '/agent-context/catalog.json', '/agent-context/agent-toolkit/index.md', '/agent-context/index.md', '/agent-context/quick-start.md', '/agent-context/score/api/index.md']));
    expect([...routes].some((route) => /audio|bridge|private/.test(route))).toBe(false);
  });

  it('refuses symlinked documentation instead of exposing another directory', async () => {
    const directory = await temp();
    await write(directory, 'apps/doc/webmusic/src/content/docs/index.mdx', document('Public content'));
    await symlink(path.join(directory, 'apps/doc/webmusic/src/content/docs/index.mdx'), path.join(directory, 'apps/doc/webmusic/src/content/docs/linked.mdx'));
    await expect(declaredAgentContextPaths({root: directory})).rejects.toThrow(/symbolic link/);
  });

  it('fails when runtime code changes without a package version change', async () => {
    const directory = await temp();
    const manifest = json({name: '@webmusic/test', version: '0.1.0'});
    const source = 'export const value = 1;\n';
    await write(directory, 'package/package.json', manifest);
    await write(directory, 'package/src/index.ts', source);
    const baseline = {packages: [{name: '@webmusic/test', version: '0.1.0', directory: 'package', manifestSha256: digest(manifest), sourceSha256: digest(json([['index.ts', digest(source)]]))}]};
    await expect(verifyReleaseBaseline({root: directory, baseline})).resolves.toEqual(baseline);
    await write(directory, 'package/src/index.ts', 'export const value = 2;\n');
    await expect(verifyReleaseBaseline({root: directory, baseline})).rejects.toThrow(/unchanged package versions are insufficient/);
  });

  it('generates deterministic references for root and Pages deployments', async () => {
    const plain = await generateAgentContext({root, site: 'https://docs.example.test', base: '/'});
    const repeated = await generateAgentContext({root, site: 'https://docs.example.test', base: '/'});
    const pages = await generateAgentContext({root, site: 'https://docs.example.test', base: '/WebMusic/'});
    expect([...plain.files]).toEqual([...repeated.files]);
    expect(pages.files.get('llms.txt')).toContain('https://docs.example.test/WebMusic/agent-context/quick-start.md');
    expect(plain.files.get('llms.txt')).toContain('https://docs.example.test/agent-context/quick-start.md');
    expect(pages.files.get('agent-context/quick-start.md')).toContain('https://docs.example.test/WebMusic/mxl/demo.mxl');
    expect(pages.files.get('agent-context/uikit/catalog.md')).toContain('| Presenter | Group | Purpose |');
    expect(pages.files.get('agent-context/uikit/catalog.md')).toContain('@webmusic/ui/transport');
    expect(pages.files.get('agent-context/score/api/play.md')).toContain('renderScoreToBuffer');
    expect(pages.manifest.release.packages).toEqual({'@webmusic/kernel': '0.1.0', '@webmusic/ui': '0.1.0', '@webmusic/score': '0.1.0'});
    expect(pages.manifest.inputs.every((input) => !input.source.includes('.dev/') && !input.source.endsWith('/AGENTS.md'))).toBe(true);
    expect([...await declaredAgentContextPaths({root})].sort()).toEqual([...pages.files.keys()].map((name) => `/${name}`).sort());
  });

  it('generates from public inputs without Git history or private maintainer notes', async () => {
    const directory = await temp();
    const sources = [
      'LICENSE',
      'apps/doc/webmusic/src/content/docs',
      'apps/doc/shared/ui-presenter-catalog.ts', 'apps/doc/shared/ui-catalog.ts',
      'apps/doc/webmusic/src/components/quick-start-player-client.ts',
      'apps/doc/webmusic/scripts/agent-context.mjs',
      'apps/doc/webmusic/scripts/agent-context-catalog.mjs',
      'apps/doc/webmusic/scripts/agent-context-release.mjs',
      'scripts/element-composition-policy.mjs', 'scripts/package-policy.mjs',
      ...['platform/kernel', 'packages/ui', 'packages/score'].flatMap((name) => [`${name}/src`, `${name}/package.json`]),
    ];
    for (const source of sources) {
      await mkdir(path.dirname(path.join(directory, source)), {recursive: true});
      await cp(path.join(root, source), path.join(directory, source), {recursive: true});
    }
    const generated = await generateAgentContext({root: directory});
    expect(generated.files.get('agent-context/quick-start.md')).toContain('mountQuickStartStatus');
    expect(generated.files.has('llms.txt')).toBe(true);
    expect(generated.manifest.inputs.some((input) => input.source.startsWith('.'))).toBe(false);
    await write(directory, 'apps/doc/webmusic/scripts/agent-context-catalog.mjs', '// A reviewed recipe selection change.\n');
    expect((await generateAgentContext({root: directory})).manifest.documentationRevision).not.toBe(generated.manifest.documentationRevision);
  });

  it('separates task discovery, complete references, components and focused patterns', async () => {
    const {files, manifest} = await generateAgentContext({root});
    const full = files.get('llms-full.txt');
    const patterns = files.get('llms-patterns.txt');
    const bundles = Object.fromEntries(manifest.bundles.map((bundle) => [bundle.id, bundle]));
    expect(bundles.full.pages).toEqual(manifest.pages.map(({output}) => output));
    for (const page of manifest.pages) expect(full).toContain(files.get(page.output));
    expect(bundles.components.pages).toContain('agent-context/score/headless/play/score-player.md');
    expect(bundles.components.pages).toContain('agent-context/uikit/transport-time/transport.md');
    expect(bundles.components.pages).not.toContain('agent-context/score/api/io.md');
    expect(bundles.patterns.sections.find(({title}) => title === 'Style a custom music interface').headings).toContain('Theme with CSS custom properties');
    expect(patterns).toContain('<score-view player="#shared-player">');
    expect(patterns).toContain('## Customize With Hooks');
    expect(patterns).toContain('## Parse in a Worker');
    expect(patterns).not.toContain('## API Reference — @webmusic/score/io');
    expect(patterns).not.toContain('| `.resolvedScore`');
    expect(files.get('llms.txt')).toContain('## Load, parse and export music');
    for (const page of manifest.pages) {
      expect(files.get('llms.txt').split(`](${page.url})`).length - 1).toBe(1);
    }
  });

  it('preserves fenced details examples while excluding actual member-table details in patterns', () => {
    const source = '## Setup\n\n```html\n<details>Application content</details>\n```\n\n<details class="component-section">\n<summary>API</summary>\n\nMember table\n</details>\n\n## Next\n';
    expect(patternSections(source, ['Setup'], 'test.md')).toBe('## Setup\n\n```html\n<details>Application content</details>\n```');
    expect(() => patternSections(source, ['Renamed'], 'test.md')).toThrow('test.md: missing curated pattern heading Renamed');
  });

  it('links stable component IDs to verified owning sources and contracts', async () => {
    const {files, manifest} = await generateAgentContext({root});
    const catalog = JSON.parse(files.get(manifest.catalog));
    expect(catalog.license).toEqual({id: 'MIT', output: 'agent-context/LICENSE.txt'});
    expect(files.get(catalog.license.output)).toBe(await readFile(path.join(root, 'LICENSE'), 'utf8'));
    expect(catalog.stylesFormat).toBe('public-documentation');
    const player = catalog.components.find(({id}) => id === 'element/score-player');
    expect(player.docs).toEqual(['agent-context/score/element/play/score-player.md']);
    expect(player.source).toEqual(['agent-context/source/packages/score/src/play/element/score-player.ts.txt']);
    expect(files.get(player.source[0])).toBe(await readFile(path.join(root, 'packages/score/src/play/element/score-player.ts'), 'utf8'));
    expect(catalog.components.find(({id}) => id === 'headless/score-player').styles).toEqual([]);
    expect(catalog.components.find(({id}) => id === 'element/rack-part').styles).toEqual([]);
    expect(catalog.components.find(({id}) => id === 'ui/transport').styles).toContain('agent-context/uikit/index.md');
    for (const output of manifest.outputs) expect(digest(files.get(output.path))).toBe(output.sha256);
    expect(() => assertPublicRuntimeSource('.dev/STATUS.md', {packages: [{directory: 'packages/ui'}]})).toThrow(/outside verified runtime/);
    expect(() => assertPublicRuntimeSource('packages/ui/src/../private.ts', {packages: [{directory: 'packages/ui'}]})).toThrow(/outside verified runtime/);
  });

  it('verifies emitted bytes, the base and real built link targets', async () => {
    const directory = await temp();
    const files = new Map([['llms.txt', '[Score](https://docs.example.test/WebMusic/score/)\n']]);
    const generated = {files, manifest: {site: 'https://docs.example.test', base: '/WebMusic/', pages: []}};
    await write(directory, 'llms.txt', files.get('llms.txt'));
    await expect(verifyAgentContextOutput(directory, generated)).rejects.toThrow(/no built target/);
    await write(directory, 'score/index.html', '<h1>Score</h1>');
    await expect(verifyAgentContextOutput(directory, generated)).resolves.toBeUndefined();
    files.set('llms.txt', '<a href="https://docs.example.test/WebMusic/missing/">Missing</a>\n');
    await write(directory, 'llms.txt', files.get('llms.txt'));
    await expect(verifyAgentContextOutput(directory, generated)).rejects.toThrow(/no built target/);
    files.set('llms.txt', '[Score](https://docs.example.test/score/)\n');
    await write(directory, 'llms.txt', files.get('llms.txt'));
    await expect(verifyAgentContextOutput(directory, generated)).rejects.toThrow(/escapes documentation base/);
    await write(directory, 'llms.txt', 'stale');
    await expect(verifyAgentContextOutput(directory, generated)).rejects.toThrow(/output mismatch/);
  });

  it('serves generated files in development with the configured base and no stale cache', async () => {
    const integration = agentContext();
    integration.hooks['astro:config:done']({config: {root: new URL('../', import.meta.url), site: 'https://docs.example.test', base: '/WebMusic/'}});
    let middleware;
    await integration.hooks['astro:server:setup']({server: {middlewares: {use: (handler) => { middleware = handler; }}}});
    const headers = {};
    let result;
    let nextCalled = false;
    const response = {setHeader: (key, value) => { headers[key] = value; }, end: (contents) => { result = contents; }};
    await middleware({url: '/WebMusic/llms.txt'}, response, (error) => { if (error) throw error; nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(result).toContain('https://docs.example.test/WebMusic/agent-context/quick-start.md');
    for (const filename of ['llms-full.txt', 'llms-components.txt', 'llms-patterns.txt', 'agent-context/catalog.json', 'agent-context/agent-toolkit/agents-md.md']) {
      result = undefined;
      await middleware({url: `/WebMusic/${filename}`}, response, (error) => { if (error) throw error; nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(result).toBeTruthy();
      expect(headers['Content-Type']).toBe(filename.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
    }
    expect(headers['Cache-Control']).toBe('no-store');
    result = undefined;
    await middleware({url: '/llms.txt'}, response, (error) => { if (error) throw error; nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(result).toContain('https://docs.example.test/WebMusic/agent-context/quick-start.md');
    await middleware({url: '/unrelated/'}, response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
