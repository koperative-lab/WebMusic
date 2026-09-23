import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {attachSiteNotice, createSiteNoticeCollector, readSitePackageNotice, readSiteSupplement, verifySiteNotices} from './site-notices.mjs';
import {browserSandboxAlias} from '../apps/doc/webmusic/scripts/browser-sandbox.mjs';
import {Nodebox} from '../apps/doc/webmusic/src/runtime/unsupported-nodebox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRequire = createRequire(path.join(root, 'apps/doc/webmusic/package.json'));
const astroRequire = createRequire(appRequire.resolve('astro'));
const {build} = await import(pathToFileURL(astroRequire.resolve('vite')).href);

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'webmusic-site-notices-')));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'site-fixture', private: true, type: 'module'}));
  await writeFile(path.join(directory, 'LICENSE'), 'Copyright Site Authors\nSite permission.\n');
  return directory;
}

async function compile(directory, source, collector, aliases = []) {
  const entry = path.join(directory, 'entry.js');
  await writeFile(entry, source);
  await build({
    configFile: false,
    root: directory,
    logLevel: 'silent',
    resolve: {alias: aliases},
    plugins: [collector.plugin()],
    worker: {format: 'es', plugins: () => [collector.plugin()]},
    build: {outDir: 'dist', sourcemap: true, minify: true, lib: {entry, formats: ['es'], fileName: 'entry'}},
  });
  await writeFile(path.join(directory, 'dist/index.html'), '<html><head></head><body>Fixture</body></html>');
  return path.join(directory, 'dist');
}

test('actual Vite chunks include CSS ownership, exclude tree-shaken dependencies, and preserve maps', async (t) => {
  const directory = await fixture(t);
  for (const name of ['used', 'unused', 'styles', 'worker-only']) {
    const dependency = path.join(directory, 'node_modules', name);
    await mkdir(dependency, {recursive: true});
    await writeFile(path.join(dependency, 'package.json'), JSON.stringify({name, version: '1.0.0', main: 'index.js', type: 'module', sideEffects: name === 'styles', license: 'MIT'}));
    await writeFile(path.join(dependency, 'index.js'), `export const value = '${name}';`);
    if (name !== 'unused') await writeFile(path.join(dependency, 'LICENSE'), `Copyright ${name}\nPermission for ${name}.\n`);
  }
  await writeFile(path.join(directory, 'node_modules/styles/style.css'), '.notice-test { color: purple; }');
  await writeFile(path.join(directory, 'worker.js'), "import {value} from 'worker-only'; self.onmessage = () => self.postMessage(value);");
  await mkdir(path.join(directory, 'node_modules/used/NOTICE'));
  await writeFile(path.join(directory, 'node_modules/used/NOTICE/attribution.txt'), 'An additional attribution.\n');
  const collector = createSiteNoticeCollector({root: directory, appDirectory: directory, includeGenerated: false});
  const dist = await compile(directory, "import {value} from 'used'; import {value as unused} from 'unused'; import 'styles/style.css'; globalThis.noticeFixture=value; globalThis.workerFixture=()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'});", collector);
  const original = await readFile(path.join(dist, 'entry.js'), 'utf8');
  const map = await readFile(path.join(dist, 'entry.js.map'), 'utf8');
  await collector.write(dist);
  const notices = await readFile(path.join(dist, 'licenses/THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.match(notices, /Copyright used/);
  assert.match(notices, /An additional attribution/);
  assert.match(notices, /Copyright styles/);
  assert.match(notices, /Copyright worker-only/);
  assert.doesNotMatch(notices, /unused@/);
  assert.equal(await readFile(path.join(dist, 'entry.js.map'), 'utf8'), map);
  assert.equal(await readFile(path.join(dist, 'entry.js'), 'utf8'), attachSiteNotice(original, 'entry.js'));
  await verifySiteNotices(dist);
  await writeFile(path.join(dist, 'entry.js'), original);
  await assert.rejects(verifySiteNotices(dist), /Missing site license reference/);
  await rm(path.join(directory, 'node_modules/used/LICENSE'));
  // NOTICE alone is not permission to redistribute a dependency.
  await assert.rejects(collector.write(dist), /license identifier and license text/);
});

test('real React, Sandpack, Bravura, OSMD and SpessaSynth ship complete site notices', async (t) => {
  const directory = await fixture(t);
  const scoreRequire = createRequire(path.join(root, 'packages/score/package.json'));
  const imports = [
    ['React', appRequire.resolve('react')],
    ['Sandpack', appRequire.resolve('@codesandbox/sandpack-react')],
    ['VexFlow', scoreRequire.resolve('vexflow/bravura').replace('/build/cjs/vexflow-bravura.js', '/build/esm/entry/vexflow-bravura.js')],
    ['OSMD', appRequire.resolve('opensheetmusicdisplay')],
    ['SpessaSynth', appRequire.resolve('spessasynth_lib')],
  ];
  const source = imports.map(([name, file]) => `import * as ${name} from ${JSON.stringify(file)};`).join('\n')
    + `\nglobalThis.noticeFixture = [${imports.map(([name]) => name).join(',')}];`;
  const collector = createSiteNoticeCollector({root: directory, appDirectory: directory, includeGenerated: false});
  const dist = await compile(directory, source, collector, [browserSandboxAlias]);
  await collector.write(dist);
  const text = await readFile(path.join(dist, 'licenses/THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const required of ['Meta Platforms, Inc. and affiliates.', 'Apache License', 'CodeSandbox', 'Steinberg Media Technologies', 'SIL OPEN FONT LICENSE', 'Copyright 2019 PhonicScore', 'Stuart Knightley', 'Jean-loup Gailly', 'Basarat Ali Syed', 'Copyright (c) 2023 Arjun Barrett', 'Copyright (C) 2021 Nobuaki Tanaka', 'Emscripten 6.0.6', 'musl C runtime']) {
    assert.ok(text.includes(required), `Missing upstream notice: ${required}`);
  }
  const inventory = JSON.parse(await readFile(path.join(dist, 'licenses/BUNDLED_ASSETS.json'), 'utf8'));
  assert.ok(inventory.modules.some((id) => id.includes('bravura_glyphs.js')));
  assert.ok(inventory.packages.some(({key}) => key === 'opensheetmusicdisplay@2.1.3 bundled assets'));
  assert.ok(inventory.packages.some(({key}) => key === 'spessasynth_core@4.3.20 bundled assets'));
  assert.ok(inventory.packages.some(({key}) => key === 'stb-vorbis@0.0.6 bundled assets'));
  assert.ok(!inventory.packages.some(({key}) => key.startsWith('@codesandbox/nodebox@')));
  assert.ok(!inventory.modules.some((id) => id.startsWith('@codesandbox/nodebox@')));
  await writeFile(path.join(dist, 'untracked.js'), 'globalThis.unlicensed = true;');
  await assert.rejects(verifySiteNotices(dist), /does not cover/);
  await rm(path.join(dist, 'untracked.js'));
  await writeFile(path.join(dist, 'licenses/THIRD_PARTY_NOTICES.txt'), text.replace('Meta Platforms, Inc. and affiliates.', 'Removed'));
  await assert.rejects(verifySiteNotices(dist), /notices are missing or changed/);
  await mkdir(path.join(dist, 'pagefind'));
  await writeFile(path.join(dist, 'pagefind/wasm.en.pagefind'), 'unreviewed search binary');
  await assert.rejects(collector.write(dist), /Unreviewed Pagefind output/);
});

test('new prebundled dependency versions and modified reviewed fonts require a new review', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(readSiteSupplement({directory, manifest: {name: 'vexflow', version: '999.0.0'}}), /Review the prebundled assets/);
  await mkdir(path.join(directory, 'build/esm/src/fonts'), {recursive: true});
  await writeFile(path.join(directory, 'build/esm/src/fonts/bravura_glyphs.js'), 'modified glyphs');
  await assert.rejects(readSiteSupplement({directory, manifest: {name: 'vexflow', version: '4.2.5'}}), /Reviewed bundled asset changed/);
});

test('actual Nodebox bundles and unreviewed license identifiers fail the site policy', async (t) => {
  const directory = await fixture(t);
  const collector = createSiteNoticeCollector({root: directory, appDirectory: directory, includeGenerated: false});
  const entry = appRequire.resolve('@codesandbox/nodebox');
  const dist = await compile(directory, `import * as Nodebox from ${JSON.stringify(entry)}; globalThis.nodebox = Nodebox;`, collector);
  await assert.rejects(collector.write(dist), /Nodebox runtime is excluded/);
  await assert.rejects(readSitePackageNotice({directory, manifest: {name: 'new-package', version: '1.0.0', license: 'LicenseRef-NeedsReview'}}), /Review .* against the site distribution policy/);
  assert.throws(() => new Nodebox(), /Node server sandboxes are unavailable/);
});

test('Astro builds capture client code and prerender CSS without shipping server dependency notices', async (t) => {
  const directory = await fixture(t);
  for (const name of ['browser-runtime', 'lazy-runtime', 'page-styles', 'server-only']) {
    const dependency = path.join(directory, 'node_modules', name);
    await mkdir(dependency, {recursive: true});
    await writeFile(path.join(dependency, 'package.json'), JSON.stringify({name, version: '1.0.0', main: 'index.js', type: 'module', license: 'MIT'}));
    await writeFile(path.join(dependency, 'index.js'), `export const value = '${name}';`);
    if (name !== 'server-only') await writeFile(path.join(dependency, 'LICENSE'), `Copyright ${name}\nPermission for ${name}.\n`);
  }
  await symlink(path.dirname(appRequire.resolve('astro/package.json')), path.join(directory, 'node_modules/astro'), 'dir');
  await writeFile(path.join(directory, 'node_modules/page-styles/style.css'), 'body { color: rebeccapurple; }');
  await mkdir(path.join(directory, 'src/pages'), {recursive: true});
  await writeFile(path.join(directory, 'src/pages/index.astro'), `---
import 'page-styles/style.css';
import {value} from 'server-only';
---
<html><head><title>Notice smoke test</title></head><body>{value}<script>
import {value} from 'browser-runtime';
document.body.dataset.runtime = value;
</script></body></html>`);
  await writeFile(path.join(directory, 'src/pages/lazy.astro'), `<html><head><title>Lazy script</title></head><body><script>
import('lazy-runtime').then(({value}) => { document.body.dataset.lazyRuntime = value; });
</script></body></html>`);
  await writeFile(path.join(directory, 'src/pages/example.md'), '# Example\n\n```js\nconsole.log("Example");\n```\n');
  const config = {
    root: directory,
    cacheDir: path.join(directory, '.astro'),
    configFile: false,
    logLevel: 'silent',
    base: '/WebMusic/',
    redirects: {'/old': '/'},
    vite: {environments: {prerender: {resolve: {noExternal: ['server-only']}}}},
    build: {inlineStylesheets: 'never'},
  };
  // Astro intentionally places prerender output within cwd. A child process
  // keeps all of its caches and generated files inside the temporary fixture.
  const script = `import {build} from ${JSON.stringify(pathToFileURL(appRequire.resolve('astro')).href)};
import expressiveCode from ${JSON.stringify(pathToFileURL(appRequire.resolve('astro-expressive-code')).href)};
import notices from ${JSON.stringify(new URL('./site-notices.mjs', import.meta.url).href)};
await build({...${JSON.stringify(config)}, integrations: [expressiveCode(), notices(${JSON.stringify({root: directory, appDirectory: path.join(root, 'apps/doc/webmusic')})})]});`;
  await writeFile(path.join(directory, 'build.mjs'), script);
  await promisify(execFile)(process.execPath, ['build.mjs'], {cwd: directory});
  const dist = path.join(directory, 'dist');
  const inventory = JSON.parse(await readFile(path.join(dist, 'licenses/BUNDLED_ASSETS.json'), 'utf8'));
  const notices = await readFile(path.join(dist, 'licenses/THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.match(notices, /Copyright browser-runtime/);
  assert.match(notices, /Copyright lazy-runtime/);
  assert.match(notices, /Copyright page-styles/);
  assert.match(notices, /Copyright \(c\) 2023 Tibor Schiemann/);
  assert.doesNotMatch(notices, /server-only@/);
  assert.ok(inventory.artifacts.some((filename) => filename.endsWith('.css')));
  assert.ok(inventory.artifacts.some((filename) => filename.endsWith('.js')));
  assert.ok(inventory.artifacts.some((filename) => /\/ec\.[^.]+\.js$/.test(filename)));
  assert.ok(inventory.modules.some((id) => id === 'page-styles@1.0.0/style.css'));
  assert.match(await readFile(path.join(dist, 'index.html'), 'utf8'), /browser-runtime/);
  assert.match(await readFile(path.join(dist, 'old/index.html'), 'utf8'), /<link rel="license" href="\.\.\/licenses\/THIRD_PARTY_NOTICES.txt">/);
  await verifySiteNotices(dist);
});
