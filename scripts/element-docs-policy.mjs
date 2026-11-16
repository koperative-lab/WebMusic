import {dirname, join} from 'node:path';
import {imports, markup, prose} from './headless-docs-policy.mjs';

// One page shape for every Component page (COMPONENT-PAGE-TEMPLATE.md)
// and every Headless instance page (HEADLESS-PAGE-TEMPLATE.md):
//
//   main demo → introduction → ## Import → ## Ports and composition
//   → optional ## topics (topic demos allowed) → API <details>
//   → Styling <details> (Components only) → ## Related (a bullet list)
//
// Deliberately constrained source checks, not an MDX evaluator. Fenced
// examples and comments are blanked first, so a copied skeleton inside a code
// block can neither satisfy nor break the policy. Blanking keeps every offset,
// so a position found in the blanked text also points into the raw page.

const DEMO_NAME = /(?:Demo|Playground)$/;
const MAX_INTRO_BLOCKS = 3;

const blankImports = (text) => text.replace(/^[ \t]*import\s[^\n]*$/gm, (line) => line.replace(/[^\n]/g, ' '));
const lineStart = (name) => new RegExp(`^[ \\t]*<${name}\\b[^>]*\\/>`, 'gm');
const detailsBlock = (summary) => new RegExp(`<details\\b[^>]*>\\s*<summary>\\s*${summary}\\s*<\\/summary>`, 'g');

/**
 * The two page kinds. A Component page renders its demo through
 * `ElementDemo` and documents styling; a Headless page renders its demo
 * through `HeadlessDemoFrame` and has no styling of its own.
 */
const KINDS = {
  element: {page: /(?:^|\/)element\/(?:play|analyze|view)\/([^/]+)\.mdx$/, frame: 'ElementDemo', styling: true},
  headless: {page: /(?:^|\/)headless\/(?:(?:play|analyze|view)\/)?([^/]+)\.mdx$/, frame: 'HeadlessDemoFrame', styling: false},
};

/** Return actionable failures for the Component leaf pages. */
export function elementDocProblems({pages, readFile, frameFile}) {
  return pageShapeProblems({pages, readFile, frameFile, kind: 'element'});
}

/** Return actionable failures for the Headless instance pages, Bridge included. */
export function headlessShapeProblems({pages, readFile, frameFile}) {
  return pageShapeProblems({pages, readFile, frameFile, kind: 'headless'});
}

function pageShapeProblems({pages, readFile, frameFile, kind}) {
  const {page: pagePattern, frame: frameName, styling: hasStyling} = KINDS[kind];
  const failures = [];
  const loaded = new Map();
  const load = (file) => {
    if (loaded.has(file)) return loaded.get(file);
    let source;
    try {
      source = prose(readFile(file));
    } catch {
      failures.push(`${file}: cannot read imported ${kind === 'element' ? 'Element' : 'Headless'} demo component`);
    }
    loaded.set(file, source);
    return source;
  };
  const reachesFrame = (file, seen = new Set()) => {
    if (seen.has(file)) return false;
    seen.add(file);
    if (file === frameFile) return true;
    const source = load(file);
    if (source === undefined) return false;
    const rendered = markup(source);
    return imports(source).some(({name, specifier}) =>
      new RegExp(`<${name}\\b`).test(rendered) && reachesFrame(join(dirname(file), specifier), seen));
  };

  for (const {file, source: raw} of pages) {
    const match = pagePattern.exec(file);
    if (!match || match[1] === 'index') continue;
    const text = prose(raw);
    const body = blankImports(markup(text));
    const problem = (message) => failures.push(`${file}: ${message}`);

    const demos = imports(text).filter(({name}) => DEMO_NAME.test(name))
      .flatMap(({name, specifier}) => [...body.matchAll(lineStart(name))]
        .map((instance) => ({name, specifier, index: instance.index, end: instance.index + instance[0].length})))
      .sort((a, b) => a.index - b.index);
    const first = body.search(/\S/);
    const main = demos[0];
    if (!main || main.index + body.slice(main.index).search(/\S/) !== first) {
      problem('the main demo must be the first visible content, before the introduction and every heading');
    } else if (!reachesFrame(join(dirname(file), main.specifier))) {
      problem(`<${main.name}> must render the shared ${frameName} through relative Astro imports`);
    }

    const headings = [...body.matchAll(/^## (.+?)[ \t]*$/gm)].map((heading) => ({title: heading[1], index: heading.index}));
    const titles = headings.map((heading) => heading.title);
    if (titles[0] !== 'Import' || titles[1] !== 'Ports and composition') {
      problem(`the first sections must be ## Import then ## Ports and composition; found ${titles.slice(0, 2).map((title) => `## ${title}`).join(', ') || 'none'}`);
    }
    for (const title of ['Import', 'Ports and composition', 'Related']) {
      const count = titles.filter((found) => found === title).length;
      if (count !== 1) problem(`expected one ## ${title} section, found ${count}`);
    }
    if (titles.length && titles.at(-1) !== 'Related') problem('## Related must be the last section');

    if (main && headings.length) {
      const intro = raw.slice(main.end, headings[0].index).trim();
      const blocks = intro ? intro.split(/\n[ \t]*\n/).map((block) => block.trim()).filter(Boolean) : [];
      if (blocks.length < 1 || blocks.length > MAX_INTRO_BLOCKS) {
        problem(`the introduction must be 1–${MAX_INTRO_BLOCKS} paragraphs, found ${blocks.length}`);
      }
      if (blocks.some((block) => /^(?:`{3}|~{3}|\||[-*+] |\d+\. |<|#|>|:::)/.test(block))) {
        problem('the introduction is prose only: move code, tables, lists, notes and demos into a topic section');
      }
    }

    const api = [...body.matchAll(detailsBlock('API'))];
    const styling = [...body.matchAll(detailsBlock('Styling'))];
    const otherDetails = [...body.matchAll(/<details\b[^>]*>\s*<summary>\s*([^<]*?)\s*<\/summary>/g)]
      .map((found) => found[1]).filter((summary) => summary !== 'API' && !(hasStyling && summary === 'Styling'));
    if (api.length !== 1) problem(`expected one API <details> block, found ${api.length}`);
    if (hasStyling && styling.length !== 1) problem(`expected one Styling <details> block, found ${styling.length}`);
    if (!hasStyling && styling.length) problem('a Headless page has no Styling block');
    for (const summary of otherDetails) problem(`<details> "${summary}" is not part of the page shape; make it a ## topic before API`);
    const ports = headings.find((heading) => heading.title === 'Ports and composition');
    const related = headings.find((heading) => heading.title === 'Related');
    const close = hasStyling ? styling[0] : api[0];
    if (api.length === 1 && close && ports && related) {
      if (!(ports.index < api[0].index && api[0].index <= close.index && close.index < related.index)) {
        problem(`required order is Ports and composition → topics → API${hasStyling ? ' → Styling' : ''} → Related`);
      }
      const late = headings.filter((heading) => heading.index > api[0].index && heading !== related);
      for (const heading of late) problem(`## ${heading.title} sits after the API block; topics come before API`);
      for (const demo of demos.slice(1)) {
        if (demo.index < ports.index || demo.index > api[0].index) problem(`<${demo.name}> is a topic demo and belongs in a topic section before API`);
      }
    }
    if (related) {
      const lines = body.slice(related.index).split('\n').slice(1).map((line) => line.trim()).filter(Boolean);
      if (!lines.length || lines.some((line) => !/^- \[[^\]]+\]\([^)]+\)/.test(line))) {
        problem('## Related is a bullet list of links: "- [label](route) — what it adds"');
      }
    }
  }
  return failures;
}
