import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDirectories} from './package-policy.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptName = 'build-receipt.json';
// Keep the default search order aligned with tsup's loadTsupConfig/Joycon.
const tsupConfigNames = ['ts', 'cts', 'mts', 'js', 'cjs', 'mjs', 'json'].map((extension) => `tsup.config.${extension}`).concat('package.json');
const buildConfigPattern = /^(?:tsconfig.*\.json|tsup.*\.(?:[cm]?[jt]s|json))$/;

function configurationInputs(root, base) {
  const inputs = [];
  let resolvedTsup = false;
  // tsup searches ancestors, excluding the filesystem root and node_modules.
  for (let directory = base; directory !== path.parse(directory).root && path.basename(directory) !== 'node_modules'; directory = path.dirname(directory)) {
    const relative = path.relative(root, directory);
    const inside = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    if (!inside && resolvedTsup) break;
    if (inside) {
      // Include all candidates: adding/removing a higher-priority configuration
      // or changing an ancestor package.json can change the next build.
      inputs.push(...readdirSync(directory).filter((file) => file === 'package.json' || buildConfigPattern.test(file)).map((file) => path.join(directory, file)));
    }
    if (resolvedTsup) continue;
    for (const name of tsupConfigNames) {
      const filename = path.join(directory, name);
      if (!existsSync(filename)) continue;
      if (lstatSync(filename).isSymbolicLink()) throw new Error(`Build configuration must not be a symbolic link: ${filename}`);
      // Joycon stops on the property's presence, even when its value is null.
      if (name === 'package.json' && !Object.hasOwn(JSON.parse(readFileSync(filename, 'utf8')), 'tsup')) continue;
      if (!inside) throw new Error(`tsup resolves configuration outside the repository: ${filename}. Keep build configuration inside the repository before building or packing.`);
      resolvedTsup = true;
      break;
    }
  }
  return inputs;
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.name === '.DS_Store') return [];
    if (entry.isSymbolicLink()) throw new Error(`Build inputs and outputs must not contain symbolic links: ${filename}`);
    return entry.isDirectory() ? filesUnder(filename) : entry.isFile() ? [filename] : [];
  });
}

function digestFiles(root, filenames) {
  const hash = createHash('sha256');
  for (const filename of [...new Set(filenames)].sort()) {
    if (lstatSync(filename).isSymbolicLink()) throw new Error(`Build inputs and outputs must not contain symbolic links: ${filename}`);
    hash.update(path.relative(root, filename).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(filename));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function sourceFingerprint(root = repository) {
  root = path.resolve(root);
  const inputs = ['package.json', 'package-lock.json', 'tsconfig.base.json'].map((file) => path.join(root, file));
  // Shared build policy and source-built IIFEs can affect a sibling package.
  inputs.push(...filesUnder(path.join(root, 'scripts')).filter((file) => !file.includes(`${path.sep}release-pipeline${path.sep}`)));
  for (const directory of packageDirectories) {
    const base = path.join(root, directory);
    inputs.push(...['package.json', 'LICENSE', 'README.md'].map((file) => path.join(base, file)));
    inputs.push(...filesUnder(path.join(base, 'src')), ...filesUnder(path.join(base, 'scripts')));
    inputs.push(...configurationInputs(root, base));
  }
  return digestFiles(root, inputs);
}

function outputFingerprint(directory) {
  const receipt = path.join(directory, 'dist', receiptName);
  return digestFiles(directory, filesUnder(path.join(directory, 'dist')).filter((file) => file !== receipt));
}

function validateTargets(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const visit = (value) => {
    if (typeof value === 'string') {
      if (!value.startsWith('./') || value.includes('*') || !existsSync(path.resolve(directory, value))) {
        throw new Error(`Missing or unsupported export target ${value}; rebuild before packing.`);
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(manifest.exports);
  for (const file of ['LICENSE', 'README.md']) {
    if (!existsSync(path.join(directory, file))) throw new Error(`Missing ${file}.`);
  }
  return manifest;
}

export function recordBuild(directory, fingerprint = sourceFingerprint()) {
  const manifest = validateTargets(directory);
  writeFileSync(path.join(directory, 'dist', receiptName), `${JSON.stringify({
    schema: 1,
    name: manifest.name,
    version: manifest.version,
    source: fingerprint,
    outputs: outputFingerprint(directory),
  }, null, 2)}\n`);
}

export function verifyBuild(directory, fingerprint = sourceFingerprint()) {
  const manifest = validateTargets(directory);
  const filename = path.join(directory, 'dist', receiptName);
  if (!existsSync(filename)) throw new Error('Missing build receipt. Run npm run build:packages before packing.');
  const receipt = JSON.parse(readFileSync(filename, 'utf8'));
  if (receipt.schema !== 1 || receipt.name !== manifest.name || receipt.version !== manifest.version
    || receipt.source !== fingerprint || receipt.outputs !== outputFingerprint(directory)) {
    throw new Error('Source, metadata, or output changed since the build. Run npm run build:packages and repeat release validation.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const all = process.argv.includes('--all');
    const directories = all ? packageDirectories.map((directory) => path.join(repository, directory)) : [process.cwd()];
    if (directories.some((directory) => !packageDirectories.includes(path.relative(repository, directory).split(path.sep).join('/')))) {
      throw new Error('Run from a publishable package directory, or pass --all from the repository.');
    }
    const fingerprint = sourceFingerprint();
    for (const directory of directories) {
      if (process.argv.includes('--write')) recordBuild(directory, fingerprint);
      else verifyBuild(directory, fingerprint);
    }
    // npm pack --json forwards lifecycle stdout, so status belongs on stderr.
    console.error(`Package artifact ${process.argv.includes('--write') ? 'receipts written' : 'check passed'} for ${directories.length} package(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
