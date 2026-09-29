import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {launchDocs, runCommand, startAstro, withStartupLock} from './docs-dev.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-dev-start-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function runtime(existing = null) {
  const calls = [];
  return {
    calls,
    lock: (action) => action(),
    existing: async () => { calls.push('existing'); return existing; },
    astro: async (args) => { calls.push(['astro', ...args]); },
    start: async (args) => { calls.push(['start', ...args]); return {finished: Promise.resolve()}; },
    build: async () => { calls.push('build'); },
    log: (message) => { calls.push(['log', message]); },
  };
}

test('repeat dev reuses a running server before a package build or takeover', async () => {
  const host = runtime({pid: 123, url: 'http://localhost:4321'});
  await launchDocs(['--build', '--port', '4322'], host);
  assert.equal(host.calls.length, 2);
  assert.equal(host.calls[0], 'existing');
  assert.match(host.calls[1][1], /Reusing.*without rebuilding/);
});

test('first root start builds before launch and preserves Astro flags and foreground default', async () => {
  const host = runtime();
  await launchDocs(['--build', '--host', 'localhost', '--port', '4321'], host);
  assert.deepEqual(host.calls, ['existing', 'build', ['start', '--host', 'localhost', '--port', '4321']]);
});

test('explicit restart stops before rebuilding; docs restart skips build', async () => {
  for (const build of [false, true]) {
    const host = runtime();
    await launchDocs([...(build ? ['--build'] : []), 'restart', '--port', '4444'], host);
    assert.deepEqual(host.calls, [['astro', 'stop'], 'existing', ...(build ? ['build'] : []), ['start', '--port', '4444']]);
  }
});

test('status, logs and stop never trigger package builds', async () => {
  for (const command of ['status', 'logs', 'stop']) {
    const host = runtime();
    await launchDocs(['--build', command], host);
    assert.deepEqual(host.calls, [['astro', command]]);
  }
});

test('build and child failures are preserved, including termination code 143', async () => {
  const host = runtime();
  host.build = async () => { throw new Error('broken build'); };
  await assert.rejects(launchDocs(['--build'], host), /broken build/);
  assert.deepEqual(host.calls, ['existing']);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(143)'], {quiet: true}), (error) => error.exitCode === 143);
});

test('unsafe bypass flags are rejected before stopping or building', async () => {
  for (const flag of ['--force', '--force=true', '--root=/tmp/other', '--ignore-lock']) {
    const host = runtime();
    await assert.rejects(launchDocs(['--build', flag], host), /startup contract/);
    assert.deepEqual(host.calls, []);
  }
});

test('concurrent starts build and start only once; second caller observes ready server', async (t) => {
  const directory = await fixture(t);
  let server = null;
  let builds = 0;
  let starts = 0;
  const host = {
    ...runtime(),
    lock: (action) => withStartupLock(directory, action, {poll: 5}),
    existing: async () => server,
    build: async () => { builds++; await delay(20); },
    start: async () => { starts++; await delay(20); server = {pid: 123, url: 'http://localhost:4321'}; },
  };
  await Promise.all([launchDocs(['--build'], host), launchDocs(['--build'], host)]);
  assert.equal(builds, 1);
  assert.equal(starts, 1);
  assert.deepEqual(await readdir(path.join(directory, '.astro')), []);
});

test('racing stale-owner recovery does not remove a newly acquired lock', async (t) => {
  const directory = await fixture(t);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await once(child, 'exit');
  const lock = path.join(directory, '.astro/webmusic-dev-start');
  await mkdir(lock, {recursive: true});
  await writeFile(path.join(lock, `${child.pid}-deadbeef`), '');
  let active = 0;
  let completed = 0;
  await Promise.all(Array.from({length: 6}, () => withStartupLock(directory, async () => {
    assert.equal(active++, 0);
    await delay(10);
    active--;
    completed++;
  }, {poll: 2})));
  assert.equal(completed, 6);
  assert.deepEqual(await readdir(path.join(directory, '.astro')), []);
});

test('a failing action releases the startup lock for the next attempt', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(withStartupLock(directory, () => { throw new Error('build failed'); }), /build failed/);
  assert.equal(await withStartupLock(directory, () => 'retried'), 'retried');
});

test('foreground readiness releases startup coordination while the child remains running', async (t) => {
  const directory = await fixture(t);
  const script = path.join(directory, 'fake-astro.mjs');
  await writeFile(script, `import {mkdirSync, writeFileSync} from 'node:fs';
mkdirSync('.astro', {recursive:true});
writeFileSync('.astro/dev.json', JSON.stringify({pid:process.pid,url:'http://localhost:4444'}));
setInterval(() => {}, 1000);
`);
  const server = await withStartupLock(directory, () => startAstro(script, [], directory));
  const receipt = JSON.parse(await readFile(path.join(directory, '.astro/dev.json'), 'utf8'));
  t.after(() => { try { process.kill(receipt.pid, 'SIGTERM'); } catch { /* Already exited. */ } });
  process.kill(receipt.pid, 0);
  assert.equal(await withStartupLock(directory, () => 'reused'), 'reused');
  process.kill(receipt.pid, 'SIGTERM');
  await assert.rejects(server.finished, (error) => error.exitCode === 143);
});

test('interrupting a build stops its process tree before another start', {skip: process.platform === 'win32'}, async (t) => {
  const directory = await fixture(t);
  const script = path.join(directory, 'interrupted-start.mjs');
  const moduleUrl = new URL('./docs-dev.mjs', import.meta.url).href;
  const pidFile = path.join(directory, 'grandchild.pid');
  const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM',()=>{setTimeout(()=>process.exit(0),150)});console.log('BUILDING');setInterval(()=>{},1000);`;
  const intermediate = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}], {stdio:'inherit'}); setInterval(()=>{},1000);`;
  await writeFile(script, `import {withStartupLock,runCommand} from ${JSON.stringify(moduleUrl)};
try { await withStartupLock(${JSON.stringify(directory)}, () => runCommand(process.execPath,['-e', ${JSON.stringify(intermediate)}], {processGroup:true})); }
catch (error) { process.exitCode=error.exitCode??1; }
`);
  const child = spawn(process.execPath, [script], {stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit');
  await once(child.stdout, 'data');
  const grandchildPid = Number(await readFile(pidFile, 'utf8'));
  t.after(() => { try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* Already exited. */ } });
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(code, 143);
  assert.equal(signal, null);
  assert.equal(await withStartupLock(directory, () => {
    assert.throws(() => process.kill(grandchildPid, 0), {code: 'ESRCH'});
    return 'recovered';
  }), 'recovered');
});

test('all npm entry points route through the same startup coordinator without predev stop', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const site = JSON.parse(await readFile(new URL('../apps/doc/webmusic/package.json', import.meta.url), 'utf8'));
  assert.equal(root.scripts.predev, undefined);
  assert.equal(root.scripts.dev, 'node scripts/docs-dev.mjs --build');
  assert.equal(root.scripts['dev:restart'], 'node scripts/docs-dev.mjs --build restart');
  assert.equal(site.scripts.dev, 'node ../../../scripts/docs-dev.mjs');
});
