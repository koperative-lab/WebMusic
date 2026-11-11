#!/usr/bin/env node
// Every documentation demo, copyable example and manual acceptance check plays
// Arabesque No. 1 from the owner-maintained apps/doc/webmusic/public/ folder.
// This gate only reads that folder; it never writes, regenerates or re-encodes media (see AGENTS.md).
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PIECE = 'Arabesque No.1';
export const PUBLIC_DIR = 'apps/doc/webmusic/public';
/** Owner-approved SHA-256 list of every file in PUBLIC_DIR; only the owner updates it. */
export const PUBLIC_PIN = 'apps/doc/webmusic/public.sha256';
const IGNORED = new Set(['.DS_Store', 'Thumbs.db']);
/** Folder → file extension of each Arabesque format. */
export const FORMATS = {midi: 'mid', mxl: 'mxl', wav: 'wav', mp3: 'mp3'};
const SCANNED = ['apps/doc/webmusic/src', 'apps/doc/shared', 'apps/test/src'];
const MEDIA = /\b(midi|mxl|wav|mp3)\/([^\s'"`)\]<>,;{}]+?)\.(midi?|mxl|wav|mp3)\b/g;

/** Return one message per media reference that is not an Arabesque No. 1 file. */
export function findViolations(text, file, publicFiles = new Set()) {
  const problems = [];
  for (const match of text.matchAll(MEDIA)) {
    const [reference, folder, rawName, extension] = match;
    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch { /* keep the raw spelling */ }
    const line = text.slice(0, match.index).split('\n').length;
    const where = `${file}:${line}`;
    if (name !== PIECE) {
      problems.push(`${where}: ${reference} is not ${PIECE}; demos and examples use only the Arabesque No. 1 files in ${PUBLIC_DIR}/`);
    } else if (extension !== FORMATS[folder]) {
      problems.push(`${where}: ${reference} mixes the ${folder}/ folder with .${extension}`);
    } else if (publicFiles.size && !publicFiles.has(`${folder}/${PIECE}.${extension}`)) {
      problems.push(`${where}: ${reference} is missing from ${PUBLIC_DIR}/`);
    }
  }
  return problems;
}

function trackedFiles(directories) {
  return execFileSync('git', ['ls-files', '-z', '--', ...directories], {cwd: root, encoding: 'utf8'})
    .split('\0').filter((file) => /\.(astro|mdx?|tsx?|jsx?|mjs|css|html)$/.test(file));
}

/** Every file below `directory` as a sorted relative path list, ignoring OS metadata files. */
export function listFiles(directory, prefix = '') {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    if (IGNORED.has(entry.name)) return [];
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) return [`${relative} (symbolic link)`];
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  }).sort();
}

/** Parse `sha256  path` lines into a Map. */
export function parsePin(text) {
  const pin = new Map();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trimEnd());
    if (match) pin.set(match[2], match[1]);
  }
  return pin;
}

/** Compare the folder's files and bytes with the owner's pin. */
export function comparePin(pin, actual) {
  const problems = [];
  for (const [file, hash] of actual) {
    if (!pin.has(file)) problems.push(`${PUBLIC_DIR}/${file} is not in ${PUBLIC_PIN}; only the owner adds files to this folder`);
    else if (pin.get(file) !== hash) problems.push(`${PUBLIC_DIR}/${file} differs from its pinned bytes; only the owner changes this folder`);
  }
  for (const file of pin.keys()) {
    if (!actual.has(file)) problems.push(`${PUBLIC_DIR}/${file} is pinned but missing; only the owner removes files from this folder`);
  }
  return problems;
}

function publicHashes() {
  const directory = path.join(root, PUBLIC_DIR);
  return new Map(listFiles(directory).map((file) => [file,
    file.endsWith('(symbolic link)') ? 'symbolic-link' : createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex')]));
}

export function run() {
  const pinFile = path.join(root, PUBLIC_PIN);
  const pinProblems = existsSync(pinFile)
    ? comparePin(parsePin(readFileSync(pinFile, 'utf8')), publicHashes())
    : [`${PUBLIC_PIN} is missing; the owner pins the approved public folder`];
  const publicFiles = new Set(Object.entries(FORMATS)
    .map(([folder, extension]) => `${folder}/${PIECE}.${extension}`)
    .filter((file) => existsSync(path.join(root, PUBLIC_DIR, file))));
  const problems = [...pinProblems];
  for (const [folder, extension] of Object.entries(FORMATS)) {
    if (!publicFiles.has(`${folder}/${PIECE}.${extension}`)) {
      problems.push(`${PUBLIC_DIR}/${folder}/${PIECE}.${extension} is missing; the repository owner maintains this folder`);
    }
  }
  for (const file of trackedFiles(SCANNED)) {
    problems.push(...findViolations(readFileSync(path.join(root, file), 'utf8'), file, publicFiles));
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--print-pin')) {
    // Prints the current folder's pin for the owner to review and commit; it never writes.
    for (const [file, hash] of publicHashes()) console.log(`${hash}  ${file}`);
    process.exit(0);
  }
  const problems = run();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`check:demo-music: every demo media reference uses ${PIECE}.`);
}
