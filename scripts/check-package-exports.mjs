import {execFile} from 'node:child_process';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {expectedBrowserGlobals, expectedPublicEntries, expectedPublicEntryKinds, packageDirectories} from './package-policy.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(root, 'packages');
const npmCache = await mkdtemp(path.join(tmpdir(), 'webmusic-npm-cache-'));
const errors = [];
let checkedEntries = 0;

// The published packages of the consolidated monorepo, from the shared
// policy list — a new package is scanned here automatically.
const packageDirs = packageDirectories.map((dir) => path.join(root, ...dir.split('/')));
for (const directory of packageDirs) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const expected = expectedPublicEntries[manifest.name];
  if (!expected) {
    errors.push(`${manifest.name}: missing package policy.`);
    continue;
  }

  let packedFiles;
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const {stdout} = await execFileAsync(
      npm,
      ['pack', '--dry-run', '--json', '--workspace', manifest.name],
      {
        cwd: root,
        encoding: 'utf8',
        env: {...process.env, npm_config_cache: npmCache},
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const [packResult] = JSON.parse(stdout);
    packedFiles = new Set(packResult.files.map((file) => file.path));
  } catch (error) {
    errors.push(`${manifest.name}: npm pack --dry-run failed (${message(error)}).`);
    continue;
  }

  for (const subpath of expected) {
    const entryKind = expectedPublicEntryKinds[manifest.name]?.[subpath] ?? 'module';
    const target = manifest.exports?.[subpath];
    if (subpath === './package.json') {
      if (target !== './package.json') {
        errors.push(`${manifest.name} ${subpath}: must map to the literal "./package.json".`);
      } else if (!packedFiles.has('package.json')) {
        errors.push(`${manifest.name} ${subpath}: package.json is missing from the npm tarball.`);
      }
      checkedEntries += 1;
      continue;
    }
    if (!target || typeof target !== 'object') {
      errors.push(`${manifest.name} ${subpath}: missing conditional export.`);
      continue;
    }
    // Module entries use nested conditions so CommonJS consumers resolve the
    // .d.cts declarations; browser-IIFE entries stay flat {types, default}.
    let conditionTargets;
    if (entryKind === 'browser-iife') {
      if (target.import || target.require) {
        errors.push(`${manifest.name} ${subpath}: browser IIFE must not advertise ESM/CommonJS module targets.`);
      }
      conditionTargets = [
        ['types', target.types],
        ['default', target.default],
      ];
    } else {
      conditionTargets = [
        ['import.types', target.import?.types],
        ['import.default', target.import?.default],
        ['require.types', target.require?.types],
        ['require.default', target.require?.default],
      ];
      if (typeof target.import?.types === 'string' && !target.import.types.endsWith('.d.ts')) {
        errors.push(`${manifest.name} ${subpath}: import.types must resolve a .d.ts declaration.`);
      }
      if (typeof target.require?.types === 'string' && !target.require.types.endsWith('.d.cts')) {
        errors.push(`${manifest.name} ${subpath}: require.types must resolve a .d.cts declaration.`);
      }
    }
    const resolvedTargets = new Map();
    for (const [condition, relativeTarget] of conditionTargets) {
      if (typeof relativeTarget !== 'string') {
        errors.push(`${manifest.name} ${subpath}: missing ${condition} target.`);
        continue;
      }
      const packagePath = relativeTarget.replace(/^\.\//, '');
      const absoluteTarget = path.join(directory, packagePath);
      try {
        await access(absoluteTarget);
      } catch {
        errors.push(`${manifest.name} ${subpath}: ${condition} target does not exist (${relativeTarget}).`);
        continue;
      }
      resolvedTargets.set(condition, absoluteTarget);
      if (!packedFiles.has(packagePath)) {
        errors.push(`${manifest.name} ${subpath}: ${relativeTarget} is missing from the npm tarball.`);
      }
    }

    if (typeof target.import?.default === 'string') {
      try {
        await import(pathToFileURL(path.join(directory, target.import.default)).href);
      } catch (error) {
        errors.push(`${manifest.name} ${subpath}: ESM import failed (${message(error)}).`);
      }
    }
    if (typeof target.require?.default === 'string') {
      try {
        require(path.join(directory, target.require.default));
      } catch (error) {
        errors.push(`${manifest.name} ${subpath}: CommonJS require failed (${message(error)}).`);
      }
    }
    if (entryKind === 'browser-iife') {
      await checkBrowserIife({
        name: manifest.name,
        subpath,
        sourcePath: resolvedTargets.get('default'),
        declarationPath: resolvedTargets.get('types'),
      });
    }
    checkedEntries += 1;
  }
}

await rm(npmCache, {recursive: true, force: true});

await checkKernelReexports();
await checkCommonJsWorkerFallbacks();
await checkAnalysisWorkerEntryPurity();

if (errors.length > 0) {
  console.error(`Package export check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Package export check passed for ${checkedEntries} public entries.`);
}

async function checkKernelReexports() {
  const directory = path.join(root, 'platform/kernel');
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  for (const condition of ['import', 'require']) {
    try {
      const load = (subpath) => {
        const file = path.join(directory, manifest.exports[subpath][condition].default);
        return condition === 'import' ? import(pathToFileURL(file).href) : require(file);
      };
      const namespace = await load('.');
      for (const subpath of expectedPublicEntries[manifest.name]) {
        if (subpath === '.' || subpath === './package.json') continue;
        for (const [name, value] of Object.entries(await load(subpath))) {
          if (namespace[name] !== value) {
            errors.push(`@webmusic/kernel ${condition} ${subpath}: root re-export ${name} has a different identity.`);
          }
        }
      }
      const sync = await load('./sync');
      const mirror = new sync.MirrorClockMaster({position: 0, play() {}, pause() {}, stop() {}, seekPosition() {}}, () => 0);
      if (!(mirror.clock instanceof namespace.TransportClock) || namespace.TransportClock.prototype.positionAt.call(mirror.clock, 0) !== 0) {
        errors.push(`@webmusic/kernel ${condition}: MirrorClockMaster uses a different TransportClock class.`);
      }
    } catch (error) {
      errors.push(`@webmusic/kernel ${condition}: re-export identity check failed (${message(error)}).`);
    }
  }
}

async function checkCommonJsWorkerFallbacks() {
  const originalWorker = globalThis.Worker;
  let constructed = 0;
  class FakeWorker {
    listeners = new Map();
    constructor() {
      constructed += 1;
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    postMessage(message) {
      if (typeof message?.id !== 'number') return;
      queueMicrotask(() =>
        this.listeners.get('message')?.({data: {id: message.id, ok: false, error: 'fake worker response'}}),
      );
    }
    terminate() {}
  }
  globalThis.Worker = FakeWorker;
  try {
    const scoreAnalyze = require(path.join(packagesRoot, 'score/dist/analyze/worker-client.cjs'));
    scoreAnalyze.createAnalysisWorker().dispose();

    const scoreIo = require(path.join(packagesRoot, 'score/dist/io/worker-client.cjs'));
    const parser = scoreIo.createParserWorker();
    await parser.parse('X:1\nK:C\nC', 'abc');
    parser.dispose();

    if (constructed !== 0) {
      errors.push('CommonJS worker clients attempted to construct a Worker without a stable module URL.');
    }
  } catch (error) {
    errors.push(`CommonJS worker fallback failed (${message(error)}).`);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
}

async function checkAnalysisWorkerEntryPurity() {
  const analyzeDist = path.join(packagesRoot, 'score', 'dist', 'analyze');
  const esmProtocol = pathToFileURL(path.join(analyzeDist, 'worker-protocol.js')).href;
  const esmClient = pathToFileURL(path.join(analyzeDist, 'worker-client.js')).href;
  const esmRuntime = pathToFileURL(path.join(analyzeDist, 'worker.js')).href;
  const cjsProtocol = path.join(analyzeDist, 'worker-protocol.cjs');
  const cjsClient = path.join(analyzeDist, 'worker-client.cjs');
  const cjsRuntime = path.join(analyzeDist, 'worker.cjs');
  const setup = `
    class FakeWorkerGlobalScope {}
    const fakeSelf = new FakeWorkerGlobalScope();
    let registrations = 0;
    fakeSelf.addEventListener = (type) => { if (type === 'message') registrations += 1; };
    fakeSelf.postMessage = () => {};
    globalThis.WorkerGlobalScope = FakeWorkerGlobalScope;
    globalThis.self = fakeSelf;
  `;

  try {
    await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `${setup}
          await import(${JSON.stringify(esmProtocol)});
          if (registrations !== 0) throw new Error('ESM worker-protocol registered a message listener');
          await import(${JSON.stringify(esmClient)});
          if (registrations !== 0) throw new Error('ESM worker-client registered a message listener');
          await import(${JSON.stringify(esmRuntime)});
          if (registrations !== 1) throw new Error('ESM worker runtime did not register exactly one listener');
        `,
      ],
      {cwd: root, encoding: 'utf8'},
    );
  } catch (error) {
    errors.push(`@webmusic/score analyze ESM Worker entry purity failed (${message(error)}).`);
  }

  try {
    await execFileAsync(
      process.execPath,
      [
        '--eval',
        `${setup}
          require(${JSON.stringify(cjsProtocol)});
          if (registrations !== 0) throw new Error('CommonJS worker-protocol registered a message listener');
          require(${JSON.stringify(cjsClient)});
          if (registrations !== 0) throw new Error('CommonJS worker-client registered a message listener');
          require(${JSON.stringify(cjsRuntime)});
          if (registrations !== 1) throw new Error('CommonJS worker runtime did not register exactly one listener');
        `,
      ],
      {cwd: root, encoding: 'utf8'},
    );
  } catch (error) {
    errors.push(`@webmusic/score analyze CommonJS Worker entry purity failed (${message(error)}).`);
  }
}

async function checkBrowserIife({name, subpath, sourcePath, declarationPath}) {
  if (!sourcePath || !declarationPath) return;
  // Contracts are keyed by subpath: family packages ship one IIFE per
  // capability with its own global name.
  const contract = expectedBrowserGlobals[name]?.[subpath];
  if (!contract) {
    errors.push(`${name} ${subpath}: no browser-global contract in scripts/package-policy.mjs.`);
    return;
  }
  try {
    const declaration = await readFile(declarationPath, 'utf8');
    if (!declaration.includes(contract.globalName)) {
      errors.push(`${name} ${subpath}: declaration does not describe the ${contract.globalName} browser global.`);
    }

    const source = await readFile(sourcePath, 'utf8');
    const sourceMapPath = `${sourcePath}.map`;
    const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
    const bundledWorkspaceArtifacts = sourceMap.sources
      .map((source) => path.resolve(path.dirname(sourceMapPath), source))
      .map((absoluteSource) => path.relative(root, absoluteSource).replaceAll(path.sep, '/'))
      // Workspace dist artifacts live in this repo (or behind a node_modules
      // link) after the consolidation — both shapes must stay out of the IIFE.
      .filter((relativeSource) =>
        /^(?:platform\/kernel|packages\/(?:score|ui))\/dist\//.test(relativeSource) ||
        /(?:^|\/)node_modules\/(?:@webmusic\/[^/]+|webmusic)\/dist\//.test(relativeSource),
      );
    if (bundledWorkspaceArtifacts.length > 0) {
      errors.push(
        `${name} ${subpath}: IIFE re-bundles workspace dist artifacts instead of source ` +
          `(${bundledWorkspaceArtifacts.slice(0, 3).join(', ')}).`,
      );
    }
    const defined = new Map();
    const sandbox = {
      HTMLElement: class {},
      customElements: {
        get: (tag) => defined.get(tag),
        define: (tag, constructor) => defined.set(tag, constructor),
      },
    };
    runInNewContext(source, sandbox, {filename: sourcePath});

    if (typeof sandbox[contract.globalName]?.[contract.defineFunction] !== 'function') {
      errors.push(`${name} ${subpath}: IIFE does not expose ${contract.globalName}.${contract.defineFunction}().`);
    }
    for (const tag of contract.elements) {
      if (!defined.has(tag)) errors.push(`${name} ${subpath}: IIFE did not register <${tag}>.`);
    }
  } catch (error) {
    errors.push(`${name} ${subpath}: browser IIFE contract check failed (${message(error)}).`);
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
