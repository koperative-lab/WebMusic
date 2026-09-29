import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rmdir, unlink, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const documentationRoot = path.join(repositoryRoot, 'apps/doc/webmusic');

export function startCommand(command, args, {cwd, quiet = false, processGroup = false} = {}) {
  const grouped = processGroup && process.platform !== 'win32';
  const child = spawn(command, args, {cwd, detached: grouped, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'});
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk; });
  child.stderr?.on('data', (chunk) => { output += chunk; });
  let interruptedSignal;
  const terminate = (signal) => {
    if (grouped && child.pid) {
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    } else child.kill(signal);
  };
  const handlers = ['SIGINT', 'SIGTERM'].map((signal) => {
    const handler = () => { interruptedSignal = signal; terminate(signal); };
    process.on(signal, handler);
    return [signal, handler];
  });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      signal = interruptedSignal ?? signal;
      if (code === 0 && !signal) resolve();
      else reject(Object.assign(new Error(`${path.basename(command)} exited with ${signal ?? code}.${output ? `\n${output.trim()}` : ''}`), {exitCode: signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : code ?? 1}));
    });
  }).finally(async () => {
    try {
      if (grouped && child.pid) await drainProcessGroup(child.pid);
    } finally {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    }
  });
  // A foreground server may fail while its readiness receipt is being polled.
  void finished.catch(() => {});
  return {child, finished, terminate};
}

async function drainProcessGroup(pid) {
  const exists = () => {
    try { process.kill(-pid, 0); return true; } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  if (!exists()) return;
  try { process.kill(-pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const deadline = Date.now() + 5000;
  while (exists()) {
    if (Date.now() >= deadline) {
      try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      // SIGKILL prevents surviving builders from touching package output. A
      // reparented zombie can briefly remain visible until the OS reaps it.
      return;
    }
    await delay(20);
  }
}

export async function runCommand(command, args, options) {
  await startCommand(command, args, options).finished;
}

// A prepared, nonempty directory is published atomically. Reaping removes only
// the dead owner's unique marker; rmdir cannot delete a newly acquired owner.
export async function withStartupLock(siteRoot, action, {timeout = 300_000, poll = 100} = {}) {
  const directory = path.join(siteRoot, '.astro');
  const lock = path.join(directory, 'webmusic-dev-start');
  const owner = `${process.pid}-${randomUUID()}`;
  const candidate = path.join(directory, `webmusic-dev-start-${owner}`);
  const deadline = Date.now() + timeout;
  await mkdir(directory, {recursive: true});
  await mkdir(candidate);
  let acquired = false;
  try {
    await writeFile(path.join(candidate, owner), '');
    while (!acquired) {
      try {
        await rename(candidate, lock);
        acquired = true;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        let owners;
        try { owners = await readdir(lock); } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        if (owners.length === 0) {
          await removeEmptyDirectory(lock);
          continue;
        }
        if (owners.length !== 1 || !/^\d+-[0-9a-f-]+$/.test(owners[0])) throw new Error(`Invalid documentation startup lock: ${lock}`, {cause: error});
        const pid = Number(owners[0].split('-')[0]);
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid documentation startup owner: ${lock}`, {cause: error});
        try { process.kill(pid, 0); } catch (error) {
          if (error.code === 'ESRCH') {
            await removeOwner(lock, owners[0]);
            continue;
          }
          if (error.code !== 'EPERM') throw error;
        }
        if (Date.now() >= deadline) throw new Error(`Another documentation startup is still holding ${lock}; wait for it to finish before retrying.`, {cause: error});
        await delay(poll);
      }
    }
    return await action();
  } finally {
    await removeOwner(acquired ? lock : candidate, owner);
    if (!acquired) await removeEmptyDirectory(candidate);
  }
}

async function removeEmptyDirectory(directory) {
  try { await rmdir(directory); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

async function removeOwner(directory, owner) {
  try { await unlink(path.join(directory, owner)); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await removeEmptyDirectory(directory);
}

export async function startAstro(binary, args, siteRoot) {
  const running = startCommand(process.execPath, [binary, 'dev', ...args], {cwd: siteRoot});
  let done = false;
  void running.finished.then(() => { done = true; }, () => { done = true; });
  const deadline = Date.now() + 120_000;
  try {
    while (!done) {
      try {
        const receipt = JSON.parse(await readFile(path.join(siteRoot, '.astro/dev.json'), 'utf8'));
        if (receipt.pid === running.child.pid) return {finished: running.finished};
      } catch (error) {
        // Astro writes the receipt after listen; a concurrent read may see its write.
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (Date.now() >= deadline) throw new Error('Astro did not publish a startup receipt within 120 seconds.');
      await delay(50);
    }
    // Native agent/background startup exits once its detached server is ready.
    await running.finished;
    return {finished: running.finished};
  } catch (error) {
    running.terminate('SIGTERM');
    await running.finished.catch(() => {});
    throw error;
  }
}

export async function launchDocs(args, runtime) {
  const build = args.includes('--build');
  const forwarded = args.filter((arg) => arg !== '--build');
  if (forwarded.some((arg) => /^--(?:force|root|ignore-lock)(?:=|$)/.test(arg))) {
    throw new Error('Use dev:restart (or docs:dev -- restart) to replace this checkout\'s server. --force, --root and --ignore-lock bypass the shared startup contract.');
  }
  const command = forwarded[0];
  if (['status', 'logs'].includes(command) || forwarded.includes('--help') || forwarded.includes('-h')) {
    await runtime.astro(forwarded);
    return;
  }
  if (command && !command.startsWith('-') && !['stop', 'restart'].includes(command)) {
    throw new Error(`Unknown documentation command: ${command}`);
  }
  const started = await runtime.lock(async () => {
    if (command === 'stop') {
      await runtime.astro(forwarded);
      return;
    }
    if (command === 'restart') await runtime.astro(['stop']);
    const existing = await runtime.existing();
    if (existing) {
      runtime.log(`Documentation server already running at ${existing.url} (pid ${existing.pid}). Reusing it without rebuilding packages.\nUse npm run dev:restart to rebuild packages and restart explicitly.`);
      return;
    }
    if (build) await runtime.build();
    const flags = command === 'restart' ? forwarded.slice(1) : forwarded;
    return runtime.start(flags);
  });
  await started?.finished;
}

export function createRuntime({siteRoot = documentationRoot, repoRoot = repositoryRoot, astroBin} = {}) {
  const require = createRequire(path.join(documentationRoot, 'package.json'));
  const binary = astroBin ?? path.join(path.dirname(require.resolve('astro/package.json')), 'bin/astro.mjs');
  const astro = (args, quiet = false) => runCommand(process.execPath, [binary, 'dev', ...args], {cwd: siteRoot, quiet});
  return {
    astro,
    start: (args) => startAstro(binary, args, siteRoot),
    lock: (action) => withStartupLock(siteRoot, action),
    async existing() {
      // Let Astro validate its PID/command and clear a stale lock through its
      // public CLI; inspect its local receipt only after that check succeeds.
      await astro(['status'], true);
      try {
        const data = JSON.parse(await readFile(path.join(siteRoot, '.astro/dev.json'), 'utf8'));
        if (Number.isSafeInteger(data.pid) && data.pid > 0 && typeof data.url === 'string') return data;
        throw new Error('Astro returned an invalid documentation-server receipt.');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    build: () => runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:packages'], {cwd: repoRoot, processGroup: true}),
    log: (message) => console.log(message),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await launchDocs(process.argv.slice(2), createRuntime()); } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
