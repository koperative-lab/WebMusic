import assert from 'node:assert/strict';
import test from 'node:test';
import {headlessDocProblems} from './headless-docs-policy.mjs';

const frameFile = 'components/HeadlessDemoFrame.astro';
const pageFile = 'docs/score/headless/play/player.mdx';
const component = 'components/PlayerPlayground.astro';
const body = `import PlayerPlayground from '../../../../components/PlayerPlayground.astro';

<PlayerPlayground />

## Import

<details class="component-section">
<summary>API</summary>
Public reference.
</details>

## Related
`;
const page = (content = body, order = 1, file = pageFile) => ({file, source: `---\nsidebar:\n  order: ${order}\n---\n${content}`});
const frame = `<LiveDemoCanvas><slot /></LiveDemoCanvas>
<details><summary>Parameters</summary><slot name="parameters" /></details>
<button data-hl-copy>Copy</button><button data-hl-reset>Reset</button>`;
const direct = `---\nimport Frame from './HeadlessDemoFrame.astro';\n---\n<Frame><slot /></Frame>`;
function check(pages = [page()], overrides = {}) {
  const files = {[frameFile]: frame, [component]: direct, ...overrides};
  return headlessDocProblems({pages, frameFile, readFile(file) {
    if (!(file in files)) throw new Error('missing fixture');
    return files[file];
  }});
}

test('accepts direct/manual and recursive catalog frames without requiring a catalog', () => {
  assert.deepEqual(check(), []);
  assert.deepEqual(check([page()], {
    [component]: `---\nimport Playground from './HeadlessPlayground.astro';\n---\n<Playground />`,
    'components/HeadlessPlayground.astro': direct,
  }), []);
  assert.deepEqual(check([page(body.replace('Public reference.', 'Public reference.\n\n### Helpers\n\nSupporting contracts.'))]), []);
});

test('fenced or commented example demos cannot replace or multiply the rendered main demo', () => {
  const examples = ['```mdx\n' + body + '\n```', '~~~~mdx\n' + body + '\n~~~~', '<!--\n' + body + '\n-->', '{/*\n' + body + '\n*/}'];
  for (const example of examples) {
    assert.deepEqual(check([page(body + '\n' + example)]), []);
    assert.ok(check([page(example)]).some((failure) => failure.includes('found 0')));
  }
  assert.ok(check([page(body.replace('<PlayerPlayground />', '<PlayerPlayground />\n<PlayerPlayground />'))])
    .some((failure) => failure.includes('found 2')));
});

test('requires ordered Import, API details and Related; a loose API summary is insufficient', () => {
  for (const section of ['## Import', '## Related', '<details class="component-section">']) {
    assert.ok(check([page(body.replace(section, ''))]).length > 0, section);
  }
  const misplaced = body.replace('<PlayerPlayground />', '').replace('## Related', '<PlayerPlayground />\n\n## Related');
  assert.ok(check([page(misplaced)]).some((failure) => failure.includes('required order')));
  const afterRelated = body + '\n<details><summary>API</summary>Late reference</details>';
  assert.ok(check([page(afterRelated)]).some((failure) => failure.includes('exactly one API')));
});

test('validates dense orders independently in each capability and rejects Overview leaves', () => {
  const second = 'docs/score/headless/play/other.mdx';
  const view = 'docs/score/headless/view/view.mdx';
  assert.deepEqual(check([page(), page(body, 2, second), page(body, 1, view)]), []);
  for (const order of [1, 3, 'undefined']) {
    assert.ok(check([page(), page(body, order, second)]).some((failure) => failure.includes('Headless orders')));
  }
  assert.ok(check([page(body, 1, 'docs/score/headless/play/index.mdx')]).some((failure) => failure.includes('Overview leaf')));
});

test('an unused frame import, missing import or import cycle cannot satisfy frame reachability', () => {
  for (const source of [
    `---\nimport Frame from './HeadlessDemoFrame.astro';\n---\n<div>Unused import</div>`,
    `---\nimport Missing from './Missing.astro';\n---\n<Missing />`,
    `---\nimport Cycle from './PlayerPlayground.astro';\n---\n<Cycle />`,
  ]) {
    assert.ok(check([page()], {[component]: source}).some((failure) => failure.includes('must render the shared')));
  }
});

test('rejects separate frame State/Events panels but allows musical state text and reference examples', () => {
  assert.deepEqual(check([page()], {[frameFile]: frame + '<p>State changes update the score.</p>'}), []);
  for (const panel of ['<details><summary>State</summary></details>', '<h3>Events</h3>', '<div data-hl-events></div>', '<section aria-label="State"></section>']) {
    assert.ok(check([page()], {[frameFile]: frame + panel}).some((failure) => failure.includes('separate State or Events panels')));
  }
});

test('the frame retains one canvas, Parameters disclosure, Copy and Reset control', () => {
  for (const token of ['<LiveDemoCanvas>', '<summary>Parameters</summary>', 'data-hl-copy', 'data-hl-reset']) {
    assert.ok(check([page()], {[frameFile]: frame.replace(token, '')}).some((failure) => failure.includes('expected exactly one')));
    assert.ok(check([page()], {[frameFile]: frame.replace(token, token + token + ' ')}).some((failure) => failure.includes('expected exactly one')));
  }
});
