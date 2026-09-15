import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  artifactManifestFileName,
  createValidatedArtifactSnapshot,
  readArtifactManifest,
  releaseManifestFormat,
} from './release-artifacts.mjs';
import {expectedBrowserGlobals, expectedPublicEntries, expectedPublicEntryKinds} from './package-policy.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requestedManifest = parseArguments(process.argv.slice(2));
const installTimeoutMs = parseInstallTimeout(process.env.WEBMUSIC_EXTERNAL_INSTALL_TIMEOUT_MS);
const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-external-install-'));
const consumer = path.join(directory, 'consumer');
const npmCache = path.join(directory, 'npm-cache');
const npmEnv = {...process.env, npm_config_cache: npmCache};
const tsc = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const tscArguments = [
  '--noEmit',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--target',
  'ES2022',
  '--lib',
  'ES2022,DOM',
  // Optional peers (tone, decoder wasm packages, ...) are deliberately not
  // installed; their declaration noise is out of scope. The fixtures' own
  // code still proves each resolution chain end to end.
  '--skipLibCheck',
];
let artifactSnapshot;

try {
  await Promise.all([mkdir(consumer), mkdir(npmCache)]);
  const manifestPath = requestedManifest ?? path.join(directory, 'candidate', artifactManifestFileName);
  if (!requestedManifest) {
    console.log('No artifact manifest supplied; creating one candidate set for this local smoke test.');
    const {stdout} = await execFileAsync(
      process.execPath,
      [path.join(root, 'scripts', 'create-release-artifacts.mjs'), '--output', path.dirname(manifestPath)],
      {cwd: root, encoding: 'utf8', env: npmEnv, maxBuffer: 16 * 1024 * 1024},
    );
    if (stdout.trim()) console.log(stdout.trim());
  } else {
    console.log(`Reusing exact release artifacts from ${manifestPath}.`);
  }
  const suppliedCandidate = await readArtifactManifest(manifestPath, {expectedProfile: releaseManifestFormat});
  artifactSnapshot = await createValidatedArtifactSnapshot(suppliedCandidate);
  const candidate = artifactSnapshot.candidate;
  const packageNames = candidate.artifacts.map(({name}) => name);
  const dependencies = {};
  for (const artifact of candidate.artifacts) {
    dependencies[artifact.name] = `file:${artifact.absolutePath}`;
  }

  // The smoke surface is the deliberate public API policy, not a hand-copied
  // list: every module entry must load, and every browser-IIFE entry must
  // honor its script-only contract. Worker runtime entries stay in both
  // passes; like the score workers, they must remain inert under plain Node.
  const moduleSpecifiers = [];
  const browserIifeEntries = [];
  for (const name of packageNames) {
    const subpaths = expectedPublicEntries[name];
    if (!subpaths) {
      throw new Error(`${name} has no public-entry policy in scripts/package-policy.mjs.`);
    }
    for (const subpath of subpaths) {
      const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
      const kind = expectedPublicEntryKinds[name]?.[subpath] ?? 'module';
      if (kind === 'browser-iife') browserIifeEntries.push({name, specifier});
      else moduleSpecifiers.push(specifier);
    }
  }

  await writeFile(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({name: 'webmusic-external-install-smoke', private: true, type: 'module', dependencies}, null, 2)}\n`,
  );
  console.log('Installing packed artifacts in a temporary consumer.');
  try {
    await execFileAsync(
      npm,
      ['install', '--ignore-scripts', '--package-lock=false', '--no-audit', '--fund=false'],
      {
        cwd: consumer,
        encoding: 'utf8',
        env: npmEnv,
        maxBuffer: 16 * 1024 * 1024,
        timeout: installTimeoutMs,
        killSignal: 'SIGTERM',
      },
    );
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM') {
      throw new Error(
        `External consumer npm install exceeded ${installTimeoutMs} ms. ` +
          'Check registry/network availability or set WEBMUSIC_EXTERNAL_INSTALL_TIMEOUT_MS to a larger finite value.',
        {cause: error},
      );
    }
    throw error;
  }
  console.log(`Checking ESM and CommonJS public imports for ${moduleSpecifiers.length} module entries.`);
  await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await Promise.all(${JSON.stringify(moduleSpecifiers)}.map((name) => import(name)));`,
    ],
    {cwd: consumer, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
  );
  await execFileAsync(
    process.execPath,
    ['--eval', `for (const name of ${JSON.stringify(moduleSpecifiers)}) require(name);`],
    {cwd: consumer, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
  );
  console.log(`Checking TypeScript resolution for every module entry from ESM and CommonJS consumers.`);
  for (const extension of ['mts', 'cts']) {
    const fixture = path.join(consumer, `all-public-entries.${extension}`);
    await writeFile(
      fixture,
      [
        ...moduleSpecifiers.map((specifier, index) => `import * as Entry${index} from ${JSON.stringify(specifier)};`),
        ...moduleSpecifiers.map((_specifier, index) => `void Entry${index};`),
        '',
      ].join('\n'),
    );
    await execFileAsync(tsc, [...tscArguments, fixture], {
      cwd: consumer,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  for (const {specifier} of browserIifeEntries) {
    await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          const globalBundle = await import(${JSON.stringify(specifier)});
          if (Object.keys(globalBundle).length !== 0) {
            throw new Error(${JSON.stringify(`${specifier} must remain a browser IIFE without module exports.`)});
          }
        `,
      ],
      {cwd: consumer, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
    );
  }
  console.log(`Checking the browser-IIFE declaration contract for ${browserIifeEntries.length} global entries.`);
  for (const {name, specifier} of browserIifeEntries) {
    const contract = expectedBrowserGlobals[name];
    if (!contract) {
      throw new Error(`${name} has no browser-global contract in scripts/package-policy.mjs.`);
    }
    const fixtureBase = specifier.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const globalTypeFixture = path.join(consumer, `global-bundle-${fixtureBase}.ts`);
    const scoreSpecificLines =
      name === '@webscore/play'
        ? {
            imports: [
              "import type {SynthRouteCleanup} from '@webscore/play/headless';",
              'const cleanup: SynthRouteCleanup = () => {};',
              'void cleanup;',
            ],
            calls: ['window.WebScorePlay.defineSimpleScorePlayerElement();'],
          }
        : {imports: [], calls: []};
    await writeFile(
      globalTypeFixture,
      [
        `import '${specifier}';`,
        ...scoreSpecificLines.imports,
        `${contract.globalName}.${contract.defineFunction}();`,
        `window.${contract.globalName}.${contract.defineFunction}();`,
        ...scoreSpecificLines.calls,
        '',
      ].join('\n'),
    );
    await execFileAsync(tsc, [...tscArguments, globalTypeFixture], {
      cwd: consumer,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const invalidGlobalTypeFixture = path.join(consumer, `invalid-global-bundle-${fixtureBase}.ts`);
    await writeFile(
      invalidGlobalTypeFixture,
      [
        `import {${contract.defineFunction}} from '${specifier}';`,
        `void ${contract.defineFunction};`,
        '',
      ].join('\n'),
    );
    try {
      await execFileAsync(tsc, [...tscArguments, invalidGlobalTypeFixture], {
        cwd: consumer,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      throw new Error(`${specifier} incorrectly allows named module imports in TypeScript.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('incorrectly allows named module imports')) throw error;
      const output = [error?.stdout, error?.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join('\n');
      if (!/has no exported member|no exported member/i.test(output)) throw error;
    }
  }
  console.log('Checking the kernel type chain through an installed dependent package.');
  const kernelTypeChainFixture = path.join(consumer, 'kernel-clock-chain.ts');
  await writeFile(
    kernelTypeChainFixture,
    [
      "import {ScorePlayer} from '@webscore/play/headless';",
      '',
      'declare const player: ScorePlayer;',
      // This annotation compiles only when the @webmusic/kernel dependency's
      // types resolve in an external consumer, proving the published chain.
      "const reader: import('@webmusic/kernel/transport').TransportClockReader = player.clock;",
      'reader.positionAt(0);',
      '',
    ].join('\n'),
  );
  await execFileAsync(tsc, [...tscArguments, kernelTypeChainFixture], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  console.log('Checking Worker client fallbacks.');
  await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', `
      const {createParserWorker} = await import('@webscore/io/worker-client');
      const parser = createParserWorker();
      await parser.parse('X:1\\nK:C\\nC', 'abc');
      parser.dispose();
      const {createAnalysisWorker} = await import('@webscore/analyze/worker-client');
      createAnalysisWorker().dispose();
    `],
    {cwd: consumer, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
  );
  await execFileAsync(
    process.execPath,
    ['--eval', `
      (async () => {
        const {createParserWorker} = require('@webscore/io/worker-client');
        const parser = createParserWorker();
        await parser.parse('X:1\\nK:C\\nC', 'abc');
        parser.dispose();
        const {createAnalysisWorker} = require('@webscore/analyze/worker-client');
        createAnalysisWorker().dispose();
      })().catch((error) => { throw error; });
    `],
    {cwd: consumer, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
  );
  console.log(`External consumer install smoke test passed for ${packageNames.length} packages.`);
} finally {
  await artifactSnapshot?.cleanup();
  await rm(directory, {recursive: true, force: true});
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length !== 2 || arguments_[0] !== '--manifest' || !arguments_[1]) {
    throw new Error('Usage: node scripts/check-external-install.mjs [--manifest <artifact-manifest.json>].');
  }
  return path.resolve(root, arguments_[1]);
}

function parseInstallTimeout(value) {
  if (value == null || value === '') return 300_000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('WEBMUSIC_EXTERNAL_INSTALL_TIMEOUT_MS must be a positive integer number of milliseconds.');
  }
  return parsed;
}
