import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDirectories} from './package-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const requestedVersion = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
// The published packages, from the shared policy list; the unified doc
// app is private but its workspace ranges are validated too.
const packageDirs = packageDirectories.map((dir) => path.join(root, ...dir.split('/')));
const manifestPaths = [
  ...packageDirs.map((directory) => path.join(directory, 'package.json')),
  path.join(root, 'apps', 'doc', 'webmusic', 'package.json'),
];
const manifests = await Promise.all(manifestPaths.map(async (manifestPath) => ({
  manifestPath,
  value: JSON.parse(await readFile(manifestPath, 'utf8')),
})));
const publishedDirectories = new Set(packageDirs);
const published = manifests.filter(({manifestPath}) => publishedDirectories.has(path.dirname(manifestPath)));
const workspaceNames = new Set(published.map(({value}) => value.name));
const expectedRepositoryUrl = process.env.GITHUB_REPOSITORY
  ? `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`
  : undefined;

if (write && !requestedVersion) {
  fail('Usage: node scripts/release-manifests.mjs --write <version>');
}

const version = requestedVersion ?? singlePublishedVersion(published);
if (!isReleaseVersion(version)) {
  fail(`Invalid release version ${JSON.stringify(version)}; expected a stable x.y.z semver version.`);
}
const range = `^${version}`;
const errors = [];
const repositoryUrls = new Set();

for (const entry of manifests) {
  const isPublished = publishedDirectories.has(path.dirname(entry.manifestPath));
  if (isPublished && entry.value.version !== version) {
    if (write) entry.value.version = version;
    else errors.push(`${relative(entry.manifestPath)} has version ${entry.value.version}, expected ${version}.`);
  }
  if (isPublished) {
    const repository = entry.value.repository;
    const directory = path.relative(root, path.dirname(entry.manifestPath)).split(path.sep).join('/');
    if (!repository || repository.type !== 'git' || typeof repository.url !== 'string' || repository.url.length === 0) {
      errors.push(`${relative(entry.manifestPath)} is missing a git repository.url required for npm provenance.`);
    } else {
      repositoryUrls.add(repository.url);
      if (repository.directory !== directory) {
        errors.push(`${relative(entry.manifestPath)} repository.directory is ${JSON.stringify(repository.directory)}, expected ${JSON.stringify(directory)}.`);
      }
      if (expectedRepositoryUrl && repository.url !== expectedRepositoryUrl) {
        errors.push(`${relative(entry.manifestPath)} repository.url is ${repository.url}, expected ${expectedRepositoryUrl} for this GitHub Actions repository.`);
      }
    }
    // Every package here is scoped, and npm defaults a scoped package to
    // restricted. Without this field the first publish of that package either
    // fails or quietly ships private, depending on the account's plan — and it
    // is the kind of miss that only shows up on the one publish that matters.
    // `npm publish --access public` would also cover it, but then correctness
    // depends on remembering a flag rather than on the manifest.
    if (entry.value.publishConfig?.access !== 'public') {
      errors.push(`${relative(entry.manifestPath)} is missing publishConfig.access "public"; npm defaults scoped packages to restricted.`);
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const dependencies = entry.value[field];
    if (!dependencies) continue;
    for (const name of Object.keys(dependencies)) {
      if (!workspaceNames.has(name)) continue;
      if (dependencies[name] === range) continue;
      if (write) dependencies[name] = range;
      else errors.push(`${relative(entry.manifestPath)} ${field}.${name} is ${dependencies[name]}, expected ${range}.`);
    }
  }
}

if (!expectedRepositoryUrl && repositoryUrls.size > 1) {
  errors.push(`Published package repository.url values differ: ${[...repositoryUrls].join(', ')}.`);
}

if (write) {
  if (errors.length > 0) {
    console.error(`Release manifest check failed with ${errors.length} problem(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  for (const {manifestPath, value} of manifests) {
    await writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  }
  console.log(`Updated ${published.length} publishable packages and workspace dependency ranges to ${version}.`);
  console.log('Run npm install --package-lock-only before committing the release preparation.');
  process.exit(0);
}

if (errors.length > 0) {
  console.error(`Release manifest check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Release manifests are consistent at ${version}.`);
}

function singlePublishedVersion(entries) {
  const versions = [...new Set(entries.map(({value}) => value.version))];
  if (versions.length !== 1) {
    fail(`Publishable packages do not share one version: ${versions.join(', ')}.`);
  }
  return versions[0];
}

function isReleaseVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

function relative(file) {
  return path.relative(root, file);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
