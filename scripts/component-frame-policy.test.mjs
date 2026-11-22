import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

// Visual design → Geometry: one outer frame per component, read from
// `--wm-component-border` and falling back to the line colour `--wm-border`.
// `--wm-control-border` is for controls inside the frame; an outer frame that
// falls back to it (directly or through a local alias such as `--ss-line`)
// draws a darker edge than its neighbours in any page that sets both tokens.

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCES = ['packages/ui/src', 'packages/score/src', 'packages/audio/src', 'bridges/score-audio/src'];

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/** The fallback argument of every `var(--wm-component-border, …)` in a source. */
export function componentBorderFallbacks(source) {
  const found = [];
  const marker = 'var(--wm-component-border,';
  for (let start = source.indexOf(marker); start >= 0; start = source.indexOf(marker, start + 1)) {
    let depth = 1;
    let end = start + marker.length;
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')') depth--;
      end++;
    }
    found.push({index: start, fallback: source.slice(start + marker.length, end - 1).trim()});
  }
  return found;
}

export function frameProblem(fallback) {
  if (/--wm-control-border/.test(fallback)) return 'falls back to the control line';
  if (!/var\(--wm-border\b/.test(fallback)) return 'does not fall back to --wm-border';
  return undefined;
}

test('the policy reads nested fallbacks and rejects control lines and local aliases', () => {
  const [ok] = componentBorderFallbacks('border: var(--wm-component-border, 1px solid var(--wm-border, #d8d8d8));');
  assert.equal(ok.fallback, '1px solid var(--wm-border, #d8d8d8)');
  assert.equal(frameProblem(ok.fallback), undefined);
  assert.equal(frameProblem('var(--wm-panel-border, 1px solid var(--wm-border, #ddd))'), undefined);
  assert.ok(frameProblem('1px solid var(--ss-line)'));
  assert.ok(frameProblem('1px solid var(--wm-control-border, var(--wm-border, #d8d8d8))'));
  assert.ok(frameProblem('var(--wm-panel-border, 1px solid ${LINE})'));
});

test('every component outer frame falls back to the line colour', () => {
  const failures = [];
  for (const dir of SOURCES) {
    for (const file of files(join(ROOT, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const {index, fallback} of componentBorderFallbacks(source)) {
        const problem = frameProblem(fallback);
        if (problem) {
          const line = source.slice(0, index).split('\n').length;
          failures.push(`${relative(ROOT, file)}:${line} ${problem}: ${fallback}`);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});
