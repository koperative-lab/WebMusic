import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';

const execute = promisify(execFile);
const skillSource = fileURLToPath(new URL('../../../../skills/webmusic/', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
let temporary;
let installed;
let site;
let manifest;
let files;
let loadContext;

beforeAll(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'webmusic-skill-commands-'));
  installed = path.join(temporary, 'webmusic');
  site = path.join(temporary, 'site');
  await cp(skillSource, installed, {recursive: true});
  ({loadContext} = await import(pathToFileURL(path.join(installed, 'scripts/_context.mjs')).href));
  const docs = 'agent-context/score/element/score-player.md';
  const source = 'agent-context/source/packages/score/src/play/element/player.ts.txt';
  const styles = 'agent-context/styles/element/score-player.md';
  const theme = 'agent-context/source/packages/ui/src/theme.ts.txt';
  files = new Map([
    ['llms.txt', '# WebMusic index\n'],
    ['llms-full.txt', '# Complete public manual\n'],
    ['llms-components.txt', '# Component contracts\n'],
    ['llms-patterns.txt', '# Composition patterns\n'],
    [docs, '# Score player\n\nUse one player for related views.\n'],
    [source, 'export class ScorePlayerElement {}\n'],
    [styles, '# Public styling\n\nUse the transport part.\n'],
    [theme, 'export const theme = "shared tokens";\n'],
    ['agent-context/uikit/index.md', '# Theming\n\nPublic UI tokens.\n'],
    ['agent-context/catalog.json', json({
      schemaVersion: 1,
      components: [
        {id: 'element/score-player', kind: 'element', title: 'Score player', description: 'Ready-made playback.', docs: [docs], source: [source], styles: [styles]},
        {id: 'headless/score-player', kind: 'headless', title: 'Headless player', description: 'Custom interface playback.', docs: [docs], source: [source], styles: []},
      ],
      theme: {docs: ['agent-context/uikit/index.md'], source: [theme]},
    })],
  ]);
  manifest = {
    schemaVersion: 1,
    release: {commit: '3ab5cdf116fda6f3bf364bf5b6ea56dc315942ce', packages: {'@webmusic/kernel': '0.1.0', '@webmusic/ui': '0.1.0', '@webmusic/score': '0.1.0'}},
    catalog: 'agent-context/catalog.json',
    pages: [{route: '/score/element/score-player/', output: docs}],
    outputs: [...files].map(([output, contents]) => ({path: output, sha256: sha256(contents)})),
  };
  files.set('agent-context/manifest.json', json(manifest));
  for (const [relative, contents] of files) {
    await mkdir(path.dirname(path.join(site, relative)), {recursive: true});
    await writeFile(path.join(site, relative), contents);
  }
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await rm(temporary, {recursive: true, force: true}); });

async function cli(command, args = [], context = site) {
  try {
    const result = await execute(process.execPath, [path.join(installed, 'scripts', `${command}.mjs`), ...args, ...(context ? ['--context-dir', context] : [])], {cwd: temporary});
    return {...result, code: 0};
  } catch (error) { return {stdout: error.stdout, stderr: error.stderr, code: error.code}; }
}

it('runs all six commands from a copied skill with no repository or npm dependency', async () => {
  const license = (await readFile(path.join(installed, 'LICENSE'), 'utf8')).trim();
  const listed = await cli('list_components', ['--kind', 'element', '--json']);
  expect(listed.code).toBe(0);
  expect(listed.stderr).toBe('');
  expect(JSON.parse(listed.stdout).map(({id}) => id)).toEqual(['element/score-player']);
  const expected = [
    ['get_component_docs', ['element/score-player'], 'Use one player for related views.'],
    ['get_source', ['element/score-player'], 'export class ScorePlayerElement {}'],
    ['get_styles', ['element/score-player'], 'Use the transport part.'],
    ['get_theme', [], 'export const theme = "shared tokens";'],
    ['get_docs', ['patterns'], '# Composition patterns'],
  ];
  for (const [command, args, contents] of expected) {
    const result = await cli(command, args);
    expect(result, command).toMatchObject({code: 0, stderr: ''});
    expect(result.stdout).toContain(contents);
    if (command === 'get_source' || command === 'get_theme') expect(result.stdout).toContain(license);
  }
});

it('selects bundles and known documentation routes, never arbitrary local files', async () => {
  for (const query of ['index', 'full', 'components', 'patterns', 'llms-patterns.txt', '/score/element/score-player/', 'agent-context/score/element/score-player.md']) {
    expect(await cli('get_docs', [query])).toMatchObject({code: 0, stderr: ''});
  }
  for (const query of ['../../package.json', 'agent-context/manifest.json', 'toString']) {
    const result = await cli('get_docs', [query]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  }
});

it('returns actionable errors for unavailable contracts and invalid command input', async () => {
  for (const [command, args, message] of [
    ['get_component_docs', ['score-player'], 'Run list_components.mjs'],
    ['get_styles', ['headless/score-player'], 'No visual styling contract'],
    ['list_components', ['--kind', 'audio'], '--kind must be'],
    ['get_docs', [], 'Expected one'],
    ['get_docs', ['index', '--unknown'], 'Unknown option'],
    ['get_docs', ['index', '--base-url'], 'needs a value'],
    ['get_docs', ['index', '--base-url', 'https://example.com/'], 'Choose either'],
  ]) {
    const result = await cli(command, args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
  }
});

it('shows help for every command even when no context files exist', async () => {
  for (const command of ['list_components', 'get_component_docs', 'get_source', 'get_styles', 'get_theme', 'get_docs']) {
    const result = await cli(command, ['--help'], path.join(temporary, 'absent'));
    expect(result).toMatchObject({code: 0, stderr: ''});
    expect(result.stdout).toContain('--context-dir');
  }
});

it('rejects a mixed local snapshot before printing unverified content', async () => {
  const tampered = path.join(temporary, 'tampered');
  await cp(site, tampered, {recursive: true});
  await writeFile(path.join(tampered, 'llms-patterns.txt'), 'Tampered output.\n');
  const result = await cli('get_docs', ['patterns'], tampered);
  expect(result).toMatchObject({code: 1, stdout: ''});
  expect(result.stderr).toContain('Context hash mismatch');
});

it('rejects unsupported releases and missing output from incomplete snapshots', async () => {
  const mismatch = path.join(temporary, 'mismatch');
  await cp(site, mismatch, {recursive: true});
  const changed = structuredClone(manifest);
  changed.release.packages['@webmusic/score'] = '0.2.0';
  await writeFile(path.join(mismatch, 'agent-context/manifest.json'), json(changed));
  expect((await cli('get_docs', ['index'], mismatch)).stderr).toContain('Unsupported context version');
  await writeFile(path.join(mismatch, 'agent-context/manifest.json'), json(manifest));
  await rm(path.join(mismatch, 'llms.txt'));
  expect((await cli('get_docs', ['index'], mismatch)).stderr).toContain('Missing context file');
  const context = await loadContext({'--context-dir': mismatch});
  const missingPath = path.join(await realpath(mismatch), 'llms.txt');
  await expect(context.document('index')).rejects.toMatchObject({
    name: 'Error',
    message: 'Missing context file: llms.txt. --context-dir must point to a complete generated site root.',
    cause: {code: 'ENOENT', path: missingPath},
  });
});

it('does not follow snapshot symlinks outside the selected context directory', async () => {
  const escaped = path.join(temporary, 'escaped');
  await cp(site, escaped, {recursive: true});
  await rm(path.join(escaped, 'llms.txt'));
  await symlink(path.join(site, 'llms.txt'), path.join(escaped, 'llms.txt'));
  const result = await cli('get_docs', ['index'], escaped);
  expect(result).toMatchObject({code: 1, stdout: ''});
  expect(result.stderr).toContain('escapes the selected directory');
});

it('fetches verified context under the configured site base using native HTTP responses', async () => {
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, settings) => {
    requests.push(String(url));
    expect(settings.redirect).toBe('error');
    expect(settings.signal).toBeInstanceOf(AbortSignal);
    const contents = files.get(new URL(url).pathname.replace(/^\/WebMusic\//, ''));
    return new Response(contents ?? 'Not found', {status: contents ? 200 : 404});
  }));
  const context = await loadContext({'--base-url': 'https://docs.example/WebMusic'});
  expect((await context.component('element/score-player')).title).toBe('Score player');
  expect(await context.document('patterns')).toBe(files.get('llms-patterns.txt'));
  expect(requests).toEqual([
    'https://docs.example/WebMusic/agent-context/manifest.json',
    'https://docs.example/WebMusic/agent-context/catalog.json',
    'https://docs.example/WebMusic/llms-patterns.txt',
  ]);
});

it('reports HTTP failures and hash errors from fetched responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Missing', {status: 404})));
  await expect(loadContext({'--base-url': 'https://docs.example/'})).rejects.toThrow('HTTP 404');
  vi.stubGlobal('fetch', vi.fn(async (url) => new Response(String(url).endsWith('/manifest.json') ? json(manifest) : 'Wrong build')));
  const context = await loadContext({'--base-url': 'https://docs.example/'});
  await expect(context.document('patterns')).rejects.toThrow('Context hash mismatch');
  expect(await readFile(path.join(site, 'llms-patterns.txt'), 'utf8')).toBe(files.get('llms-patterns.txt'));
});

it('retains network causes without changing the actionable fetch message', async () => {
  const cause = new TypeError('connection refused');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  await expect(loadContext({'--base-url': 'https://docs.example/'})).rejects.toMatchObject({
    name: 'Error',
    message: 'Could not fetch https://docs.example/agent-context/manifest.json: connection refused. Check the site root or use --context-dir.',
    cause,
  });
});

it('retains JSON syntax errors behind the context manifest message', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{invalid')));
  await expect(loadContext({'--base-url': 'https://docs.example/'})).rejects.toMatchObject({
    name: 'Error',
    message: 'Context manifest is not valid JSON. Use a generated WebMusic documentation site.',
    cause: expect.any(SyntaxError),
  });
});
