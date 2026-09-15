import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textExtensions = new Set([
  '.astro', '.css', '.js', '.json', '.md', '.mdx', '.mjs', '.ts', '.tsx', '.yaml', '.yml',
]);
const errors = [];

const {stdout} = await execFileAsync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

for (const relative of stdout.split('\0').filter(Boolean)) {
  if (!textExtensions.has(path.extname(relative))) continue;
  let content;
  try {
    content = await readFile(path.join(root, relative), 'utf8');
  } catch (error) {
    // `git ls-files --cached` still reports tracked files deleted in the
    // working tree. They are intentionally absent and need no format check.
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  if (content.includes('\r')) errors.push(`${relative}: contains CR/CRLF line endings.`);
  if (content.length > 0 && !content.endsWith('\n')) errors.push(`${relative}: missing final newline.`);
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (/[ \t]+$/.test(lines[index])) errors.push(`${relative}:${index + 1}: trailing whitespace.`);
  }
  if (relative.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (error) {
      errors.push(`${relative}: invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Format check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Format check passed.');
}
