import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {launchDocs, runCommand, startAstro, startCommand, withStartupLock} from './docs-dev.mjs';

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
catch (error) { if (error.exitCode !== 143) console.error(error.stack, JSON.stringify({code:error.code,syscall:error.syscall,exitCode:error.exitCode})); process.exitCode=error.exitCode??1; }
`);
  const child = spawn(process.execPath, [script], {stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(child, 'exit');
  await once(child.stdout, 'data');
  const grandchildPid = Number(await readFile(pidFile, 'utf8'));
  t.after(() => { try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* Already exited. */ } });
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(code, 143, `Interrupted build exited with ${code} (${signal ?? 'no signal'}):\n${stderr}`);
  assert.equal(signal, null);
  assert.equal(await withStartupLock(directory, () => {
    assert.throws(() => process.kill(grandchildPid, 0), {code: 'ESRCH'});
    return 'recovered';
  }), 'recovered');
});

function mockGroupKill(t, child, action) {
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
  const nativeKill = process.kill.bind(process);
  t.mock.method(process, 'kill', (pid, signal) => pid === -child.pid
    ? action(signal, () => nativeKill(pid, signal))
    : nativeKill(pid, signal));
}

function deniedGroup() {
  return Object.assign(new Error('kill EPERM'), {code: 'EPERM', syscall: 'kill'});
}

test('a transient post-exit process-group probe denial preserves the interrupted command result',
  {skip: process.platform === 'win32', timeout: 3000}, async (t) => {
    const directory = await fixture(t);
    let denied = false;
    let confirmedGone = false;
    await assert.rejects(withStartupLock(directory, () => {
      const running = startCommand(process.execPath, ['-e', 'process.exit(143)'],
        {quiet: true, processGroup: true, cleanupTimeoutMs: 500});
      mockGroupKill(t, running.child, (signal, native) => {
        if (signal === 0 && !denied) { denied = true; throw deniedGroup(); }
        try { return native(); } catch (error) {
          if (error.code === 'ESRCH') confirmedGone = true;
          throw error;
        }
      });
      return running.finished;
    }), (error) => error.exitCode === 143);
    assert.equal(denied, true);
    assert.equal(confirmedGone, true);
    assert.equal(await withStartupLock(directory, () => 'recovered'), 'recovered');
    assert.deepEqual(await readdir(path.join(directory, '.astro')), []);
  });

test('a transient post-exit SIGTERM denial waits for the process group to disappear',
  {skip: process.platform === 'win32', timeout: 3000}, async (t) => {
    let initialProbe = true;
    let denied = false;
    let confirmedGone = false;
    const running = startCommand(process.execPath, ['-e', 'process.exit(143)'],
      {quiet: true, processGroup: true, cleanupTimeoutMs: 500});
    mockGroupKill(t, running.child, (signal, native) => {
      if (signal === 0 && initialProbe) { initialProbe = false; return true; }
      if (signal === 'SIGTERM' && !denied) { denied = true; throw deniedGroup(); }
      try { return native(); } catch (error) {
        if (error.code === 'ESRCH') confirmedGone = true;
        throw error;
      }
    });
    await assert.rejects(running.finished, (error) => error.exitCode === 143);
    assert.equal(denied, true);
    assert.equal(confirmedGone, true);
  });

test('persistent process-group denial fails cleanup and blocks another build even after its owner exits',
  {skip: process.platform === 'win32', timeout: 3000}, async (t) => {
    const directory = await fixture(t);
    const denial = deniedGroup();
    const signals = [];
    let groupId;
    await assert.rejects(withStartupLock(directory, () => {
      const running = startCommand(process.execPath, ['-e', 'process.exit(143)'],
        {quiet: true, processGroup: true, cleanupTimeoutMs: 40});
      groupId = running.child.pid;
      mockGroupKill(t, running.child, (signal) => { signals.push(signal); throw denial; });
      return running.finished;
    }), (error) => {
      assert.equal(error.code, 'ERR_DEV_PROCESS_GROUP_CLEANUP');
      assert.equal(error.exitCode, 1);
      assert.equal(error.processGroupId, groupId);
      assert.equal(error.cause, denial);
      assert.equal(error.commandError.exitCode, 143);
      return true;
    });
    assert.ok(signals.includes(0), 'The group probe must not mistake denied observation for disappearance');
    assert.ok(signals.includes('SIGKILL'), 'The final termination attempt must not be mistaken for success when denied');
    const lock = path.join(directory, '.astro/webmusic-dev-start');
    const marker = JSON.parse(await readFile(path.join(lock, 'cleanup-failed.json'), 'utf8'));
    assert.equal(marker.processGroupId, groupId);
    assert.deepEqual(await readdir(lock), ['cleanup-failed.json']);
    // Use the reaped child PID to prove stale-owner recovery cannot erase this
    // unresolved-cleanup barrier merely because its original launcher has died.
    await writeFile(path.join(lock, `${groupId}-deadbeef`), '');
    let restarted = false;
    await assert.rejects(withStartupLock(directory, () => { restarted = true; }, {timeout: 50, poll: 1}), /cleanup|process group/i);
    assert.equal(restarted, false);
    assert.equal((await readdir(lock)).includes('cleanup-failed.json'), true);
    assert.deepEqual(await readdir(path.join(directory, '.astro')), ['webmusic-dev-start']);
  });

test('successful deadline SIGKILL preserves the command result and releases startup coordination',
  {skip: process.platform === 'win32', timeout: 3000}, async (t) => {
    const directory = await fixture(t);
    const signals = [];
    await assert.rejects(withStartupLock(directory, () => {
      const running = startCommand(process.execPath, ['-e', 'process.exit(143)'],
        {quiet: true, processGroup: true, cleanupTimeoutMs: 40});
      mockGroupKill(t, running.child, (signal) => { signals.push(signal); return true; });
      return running.finished;
    }), (error) => error.exitCode === 143);
    assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 1);
    assert.equal(await withStartupLock(directory, () => 'recovered'), 'recovered');
    assert.deepEqual(await readdir(path.join(directory, '.astro')), []);
  });

test('all npm entry points route through the same startup coordinator without predev stop', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const site = JSON.parse(await readFile(new URL('../apps/doc/webmusic/package.json', import.meta.url), 'utf8'));
  assert.equal(root.scripts.predev, undefined);
  assert.equal(root.scripts.dev, 'node scripts/docs-dev.mjs --build');
  assert.equal(root.scripts['dev:restart'], 'node scripts/docs-dev.mjs --build restart');
  assert.equal(site.scripts.dev, 'node ../../../scripts/docs-dev.mjs');
});
