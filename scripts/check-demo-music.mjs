#!/usr/bin/env node
// Every documentation demo and copyable example plays Arabesque No. 1 from the
// owner-maintained apps/doc/webmusic/public/ folder. This gate only reads that
// folder; it never writes, regenerates or re-encodes media (see AGENTS.md).
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PIECE = 'Arabesque No.1';
export const PUBLIC_DIR = 'apps/doc/webmusic/public';
/** Folder → file extension of each Arabesque format. */
export const FORMATS = {midi: 'mid', mxl: 'mxl', wav: 'wav', mp3: 'mp3'};
const SCANNED = ['apps/doc/webmusic/src', 'apps/doc/shared'];
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

export function run() {
  const publicFiles = new Set(Object.entries(FORMATS)
    .map(([folder, extension]) => `${folder}/${PIECE}.${extension}`)
    .filter((file) => existsSync(path.join(root, PUBLIC_DIR, file))));
  const problems = [];
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
  const problems = run();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`check:demo-music: every demo media reference uses ${PIECE}.`);
}
