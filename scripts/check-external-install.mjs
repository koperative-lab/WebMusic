#!/usr/bin/env node
// Proves the published packages work for someone outside this workspace.
//
// Everything else in `npm run check` inspects the monorepo: the source
// compiles, the export map's targets exist on disk, the manifests agree. None
// of that exercises the one path every consumer takes — install the tarball,
// import the entry. Workspace resolution hides real packaging faults, because
// inside the workspace `@webmusic/score` resolves to a directory whose `src`
// is right there, whether or not `dist` and the export map agree.
//
// So this packs the real tarballs, installs them into a throwaway project that
// is not part of any workspace, and from there:
//
//   - imports every public entry as ESM and requires every dual entry as CJS;
//   - composes Score's IO results with the root model API in both formats;
//   - checks every ESM/CommonJS declaration under `node16` and `nodenext`,
//     plus ESM under `bundler`, without skipping dependency declarations.
//
// Not part of `npm run check`: it packs, installs from the network and runs
// several consumer compiler configurations. Run it before publishing — see
// CONTRIBUTING.md#releasing.
//
// Usage: node scripts/check-external-install.mjs [--keep]

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDirectories} from './package-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

// Dependency order, so the install resolves the way a real consumer's would.
const PACKAGES = packageDirectories.map((directory) => [
  JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8')).name,
  directory,
]);

// React is an optional peer of Score. Installing it is what makes
// its `/react` entry reachable; without it that entry correctly fails to
// resolve, which would be indistinguishable here from a packaging fault.
const OPTIONAL_PEERS = ['react@19', 'react-dom@19', '@types/react@19', '@types/react-dom@19'];

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

// Throws rather than exiting: `process.exit()` inside the try below would skip
// the finally that removes the work directory, so every failing run would leak
// a consumer with a full node_modules — around 80 MB, on exactly the runs you
// repeat while fixing whatever failed.
class CheckFailed extends Error {}

function fail(message) {
  throw new CheckFailed(message);
}

const missingDist = PACKAGES.filter(([, dir]) => !existsSync(path.join(root, dir, 'dist')));
if (missingDist.length > 0) {
  console.error(
    `\nExternal install check failed: ${missingDist.map(([name]) => name).join(', ')} ` +
      'has no dist/. Run `npm run build:packages` first.',
  );
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), 'webmusic-external-'));
const consumer = path.join(work, 'consumer');
const tarballs = path.join(work, 'tarballs');
mkdirSync(consumer, {recursive: true});
mkdirSync(tarballs, {recursive: true});

try {
  console.log(`Packing ${PACKAGES.length} packages...`);
  const packed = [];
  for (const [, dir] of PACKAGES) {
    const out = run('npm', ['pack', '--pack-destination', tarballs], path.join(root, dir));
    packed.push(path.join(tarballs, out.trim().split('\n').at(-1)));
  }

  writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({name: 'webmusic-external-consumer', version: '1.0.0', private: true, type: 'module'}, null, 2)}\n`,
  );

  console.log('Installing them into a non-workspace consumer...');
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', ...packed, ...OPTIONAL_PEERS, `typescript@${typescriptRange()}`],
    consumer,
  );

  for (const name of ['@webmusic/audio', '@webmusic/bridge']) {
    if (existsSync(path.join(consumer, 'node_modules', ...name.split('/')))) {
      fail(`first-release installation unexpectedly includes deferred package ${name}.`);
    }
  }

  // Enumerate from the *installed* manifests, so the surface under test is the
  // one that shipped rather than the one in the source tree.
  const entries = [];
  const browserDeclarations = [];
  for (const [name] of PACKAGES) {
    const manifest = path.join(consumer, 'node_modules', ...name.split('/'), 'package.json');
    const exported = JSON.parse(readFileSync(manifest, 'utf8')).exports ?? {};
    for (const [sub, def] of Object.entries(exported)) {
      if (sub.endsWith('.json') || typeof def !== 'object' || def === null) continue;
      const spec = sub === '.' ? name : `${name}/${sub.slice(2)}`;
      if (def.import) entries.push({spec, kind: 'esm'});
      if (def.require) entries.push({spec, kind: 'cjs'});
      // Browser IIFEs have a declaration target but cannot be imported as
      // runtime modules. Their globals still need the same strict type check.
      if (!def.import && !def.require && def.types) browserDeclarations.push(spec);
    }
  }
  if (entries.length === 0) fail('found no public entries to import — enumeration is broken.');

  console.log(`Importing ${entries.length} entries (ESM + CJS)...`);
  writeFileSync(
    path.join(consumer, 'import-all.mjs'),
    [
      "import {createRequire} from 'node:module';",
      'const require_ = createRequire(import.meta.url);',
      `const entries = ${JSON.stringify(entries)};`,
      'const failures = [];',
      'for (const entry of entries) {',
      '  try {',
      "    if (entry.kind === 'esm') {",
      '      const namespace = await import(entry.spec);',
      "      if (typeof namespace !== 'object') throw new Error('namespace is not an object');",
      "      if (entry.spec.startsWith('@webmusic/kernel/')) {",
      "        const root = await import('@webmusic/kernel');",
      '        for (const [name, value] of Object.entries(namespace)) {',
      '          if (root[name] !== value) throw new Error(`root re-export ${name} has a different identity`);',
      '        }',
      '      }',
      '    } else {',
      '      const namespace = require_(entry.spec);',
      "      if (entry.spec.startsWith('@webmusic/kernel/')) {",
      "        const root = require_('@webmusic/kernel');",
      '        for (const [name, value] of Object.entries(namespace)) {',
      '          if (root[name] !== value) throw new Error(`root re-export ${name} has a different identity`);',
      '        }',
      '      }',
      '    }',
      '  } catch (error) {',
      '    failures.push(`[${entry.kind}] ${entry.spec}: ${String(error.message).split("\\n")[0]}`);',
      '  }',
      '}',
      'if (failures.length) {',
      "  console.error(failures.join('\\n'));",
      '  process.exit(1);',
      '}',
      'console.log(`  ${entries.length} entries imported`);',
      '',
    ].join('\n'),
  );
  try {
    process.stdout.write(run('node', ['import-all.mjs'], consumer));
  } catch (error) {
    fail(`entries failed to import:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }

  writeFileSync(
    path.join(consumer, 'score-composition.mjs'),
    readFileSync(path.join(root, 'scripts', 'external-score-composition.mjs'), 'utf8'),
  );
  try {
    process.stdout.write(run('node', ['score-composition.mjs'], consumer));
  } catch (error) {
    fail(`Score entries do not compose:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }

  const esm = entries.filter((entry) => entry.kind === 'esm');
  const cjs = entries.filter((entry) => entry.kind === 'cjs');
  for (const [extension, imports] of [['mts', esm], ['cts', cjs]]) {
    writeFileSync(
      path.join(consumer, `types.${extension}`),
      [
        ...imports.map((entry, index) => `import * as m${index} from '${entry.spec}';`),
        ...(extension === 'mts' ? browserDeclarations.map((spec) => `import '${spec}';`) : []),
        ...(extension === 'mts' ? [
          "const browserElements: typeof import('@webmusic/score/play/element') = WebMusicScorePlay;",
          'void browserElements;',
        ] : []),
        `export const count = ${imports.length};`,
        '',
      ].join('\n'),
    );
  }

  for (const resolution of ['node16', 'nodenext', 'bundler']) {
    console.log(`Typechecking public declarations under ${resolution} (skipLibCheck: false)...`);
    writeFileSync(
      path.join(consumer, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: resolution === 'bundler' ? 'esnext' : resolution,
            moduleResolution: resolution,
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            lib: ['ES2022', 'DOM'],
            types: [],
          },
          files: resolution === 'bundler' ? ['types.mts'] : ['types.mts', 'types.cts'],
        },
        null,
        2,
      )}\n`,
    );
    try {
      run(path.join(consumer, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], consumer);
    } catch (error) {
      fail(`declarations do not resolve under ${resolution}:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  }

  // Kernel's pure event/clock subpaths additionally promise no DOM types.
  for (const extension of ['mts', 'cts']) {
    writeFileSync(path.join(consumer, `kernel-pure.${extension}`), [
      "import {EventEmitter} from '@webmusic/kernel/events';",
      "import {TransportClock} from '@webmusic/kernel/transport';",
      'const clock = new TransportClock();',
      'const events = new EventEmitter<{position: number}>();',
      'clock.start(0);',
      "events.emit('position', clock.positionAt(1));",
      '',
    ].join('\n'));
  }
  for (const resolution of ['node16', 'nodenext']) {
    console.log(`Typechecking Kernel ESM + CJS under ${resolution} (pure entries without DOM, skipLibCheck: false)...`);
    writeFileSync(path.join(consumer, 'tsconfig-kernel.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: resolution, moduleResolution: resolution,
        strict: true, noEmit: true, skipLibCheck: false,
        lib: ['ES2022'], types: [],
      },
      files: ['kernel-pure.mts', 'kernel-pure.cts'],
    }, null, 2)}\n`);
    try {
      run(path.join(consumer, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig-kernel.json'], consumer);
    } catch (error) {
      fail(`Kernel pure declarations failed under ${resolution}:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  }

  console.log(
    `\nExternal install check passed: ${entries.length} runtime entries imported, Score model composition passed in both formats, ` +
      `${esm.length + browserDeclarations.length} ESM/browser and ${cjs.length} CommonJS declarations checked without skipLibCheck.`,
  );
} catch (error) {
  if (!(error instanceof CheckFailed)) throw error;
  console.error(`\nExternal install check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (keep) console.log(`\nWorkspace kept at ${work}`);
  else rmSync(work, {recursive: true, force: true});
}

// Pin the consumer's compiler to the one this repo builds with, so a drift in
// the ambient npx cache cannot turn this check green or red on its own.
function typescriptRange() {
  const {devDependencies} = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return (devDependencies?.typescript ?? 'latest').replace(/^[~^]/, '');
}
