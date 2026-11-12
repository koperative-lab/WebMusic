import assert from 'node:assert/strict';
import test from 'node:test';
import {elementDocProblems} from './element-docs-policy.mjs';

const frameFile = 'components/ElementDemo.astro';
const pageFile = 'docs/score/element/view/score-view.mdx';
const component = 'components/ScoreViewDemo.astro';
const body = `import ScoreViewDemo from '../../../../components/ScoreViewDemo.astro';

<ScoreViewDemo />

\`<score-view>\` draws a loaded score.

It follows a player.

## Import

\`\`\`html
<score-view></score-view>
\`\`\`

## Ports and composition

A View module.

## Geometry

Topic prose.

<details class="component-section">
<summary>API</summary>
Members.
</details>

<details class="component-section">
<summary>Styling</summary>
Parts.
</details>

## Related

- [\`<score-grid-view>\`](/score/element/view/score-grid-view/) — edit notes in a grid.
`;
const page = (content = body, file = pageFile) => ({file, source: `---\ntitle: '<score-view>'\n---\n${content}`});
const direct = `---\nimport ElementDemo from './ElementDemo.astro';\n---\n<ElementDemo tag="score-view"><score-view></score-view></ElementDemo>`;
function check(pages = [page()], overrides = {}) {
  const files = {[frameFile]: '<div><slot /></div>', [component]: direct, ...overrides};
  return elementDocProblems({pages, frameFile, readFile(file) {
    if (!(file in files)) throw new Error('missing fixture');
    return files[file];
  }});
}

test('accepts the shared page shape, including a topic demo between Ports and API', () => {
  assert.deepEqual(check(), []);
  const topic = body
    .replace("import ScoreViewDemo", "import WaterfallDemo from '../../../../components/ScoreViewDemo.astro';\nimport ScoreViewDemo")
    .replace('Topic prose.', 'Topic prose.\n\n<WaterfallDemo />');
  assert.deepEqual(check([page(topic)]), []);
});

test('the main demo must come first and render ElementDemo', () => {
  const late = body.replace('<ScoreViewDemo />\n\n', '').replace('It follows a player.', 'It follows a player.\n\n<ScoreViewDemo />');
  assert.ok(check([page(late)]).some((failure) => failure.includes('first visible content')));
  const frameless = check([page()], {[component]: '<score-view></score-view>'});
  assert.ok(frameless.some((failure) => failure.includes('shared ElementDemo')));
});

test('the introduction is one to three prose paragraphs', () => {
  assert.ok(check([page(body.replace('`<score-view>` draws a loaded score.\n\nIt follows a player.\n\n', ''))])
    .some((failure) => failure.includes('found 0')));
  const long = body.replace('It follows a player.', 'One.\n\nTwo.\n\nThree.');
  assert.ok(check([page(long)]).some((failure) => failure.includes('found 4')));
  for (const block of ['```html\n<score-view></score-view>\n```', '| a | b |\n| - | - |', '- a list item']) {
    assert.ok(check([page(body.replace('It follows a player.', block))]).some((failure) => failure.includes('prose only')), block);
  }
});

test('sections run Import, Ports, topics, API, Styling, Related', () => {
  const swapped = body.replace('## Import', '## TEMP').replace('## Ports and composition', '## Import').replace('## TEMP', '## Ports and composition');
  assert.ok(check([page(swapped)]).some((failure) => failure.includes('first sections')));
  const lateTopic = body.replace('## Related', '## Late topic\n\nProse.\n\n## Related');
  assert.ok(check([page(lateTopic)]).some((failure) => failure.includes('after the API block')));
  assert.ok(check([page(body.replace(/## Related[\s\S]*$/, ''))]).some((failure) => failure.includes('one ## Related')));
  const extra = body.replace('<details class="component-section">\n<summary>Styling</summary>', '<details class="component-section">\n<summary>Headless</summary>\nMore.\n</details>\n\n<details class="component-section">\n<summary>Styling</summary>');
  assert.ok(check([page(extra)]).some((failure) => failure.includes('"Headless"')));
});

test('Related is a bullet list of links', () => {
  const inline = body.replace(/- \[`<score-grid-view>`\][^\n]*/, '[Grid](/score/element/view/score-grid-view/) · [Sheet](/score/element/view/score-sheet-view/)');
  assert.ok(check([page(inline)]).some((failure) => failure.includes('bullet list')));
});

test('fenced skeletons and inventory pages are ignored', () => {
  assert.deepEqual(check([page(body + '\n```mdx\n## Import\n<ScoreViewDemo />\n```\n')]), []);
  assert.deepEqual(check([page('No demo here.', 'docs/score/element/index.mdx')]), []);
});

test('Headless pages share the shape without Styling and render HeadlessDemoFrame', async () => {
  const {headlessShapeProblems} = await import('./element-docs-policy.mjs');
  const headlessFrame = 'components/HeadlessDemoFrame.astro';
  const demo = 'components/PlayerDemo.astro';
  const file = 'docs/audio/headless/play/audio-player.mdx';
  const headless = body
    .replace("import ScoreViewDemo from '../../../../components/ScoreViewDemo.astro';", "import PlayerDemo from '../../../../components/PlayerDemo.astro';")
    .replace('<ScoreViewDemo />', '<PlayerDemo />')
    .replace(/<details class="component-section">\n<summary>Styling<\/summary>\nParts.\n<\/details>\n\n/, '');
  const run = (content, demoSource = `---\nimport HeadlessDemoFrame from './HeadlessDemoFrame.astro';\n---\n<HeadlessDemoFrame />`) => headlessShapeProblems({
    pages: [{file, source: `---\ntitle: 'AudioPlayer'\n---\n${content}`}],
    frameFile: headlessFrame,
    readFile(path) {
      const files = {[headlessFrame]: '<div><slot /></div>', [demo]: demoSource};
      if (!(path in files)) throw new Error('missing fixture');
      return files[path];
    },
  });
  assert.deepEqual(run(headless), []);
  assert.ok(run(body.replace('ScoreViewDemo', 'PlayerDemo').replace('ScoreViewDemo', 'PlayerDemo').replace("'../../../../components/ScoreViewDemo.astro'", "'../../../../components/PlayerDemo.astro'")).some((failure) => failure.includes('no Styling')));
  assert.ok(run(headless, '<div>own chrome</div>').some((failure) => failure.includes('HeadlessDemoFrame')));
  assert.ok(run(headless.replace('<PlayerDemo />\n\n', '').replace('It follows a player.', 'It follows a player.\n\n<PlayerDemo />')).some((failure) => failure.includes('first visible content')));
});
