import {dirname, join} from 'node:path';

// Deliberately constrained source checks, not an MDX/Astro evaluator. Recognize
// literal relative default Astro imports and rendered component names. Ignore
// fenced examples and comments so a copied skeleton cannot satisfy the policy.
const blank = (text) => text.replace(/[^\n]/g, ' ');
function prose(source) {
  let fence;
  return source.split('\n').map((line) => {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = match[1];
      else if (fence[0] === match[1][0] && match[1].length >= fence.length) fence = undefined;
      return blank(line);
    }
    return fence ? blank(line) : line;
  }).join('\n').replace(/<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}/g, blank);
}

function imports(source) {
  return [...source.matchAll(/\bimport\s+([A-Z][A-Za-z0-9]*)\s+from\s+['"](\.[^'"]*\.astro)['"]/g)]
    .map((match) => ({name: match[1], specifier: match[2]}));
}

function markup(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---/, blank)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank);
}

/** Return actionable failures for the current leaf pages and shared frame. */
export function headlessDocProblems({pages, readFile, frameFile}) {
  const failures = [];
  const groups = new Map();
  const loaded = new Map();
  const load = (file) => {
    if (loaded.has(file)) return loaded.get(file);
    try {
      const source = prose(readFile(file));
      loaded.set(file, source);
      return source;
    } catch {
      failures.push(`${file}: cannot read imported Headless demo component`);
      loaded.set(file, undefined);
      return undefined;
    }
  };
  const reachesFrame = (file, seen = new Set()) => {
    if (seen.has(file)) return false;
    seen.add(file);
    const source = load(file);
    if (source === undefined) return false;
    if (file === frameFile) return true;
    const rendered = markup(source);
    return imports(source).some(({name, specifier}) =>
      new RegExp(`<${name}\\b`).test(rendered) && reachesFrame(join(dirname(file), specifier), seen));
  };

  for (const {file, source: raw} of pages) {
    const match = /(?:^|\/)([^/]+)\/headless\/(play|analyze|view)\/([^/]+)\.mdx$/.exec(file);
    if (!match) continue;
    const [, family, capability, name] = match;
    if (name === 'index') {
      failures.push(`${file}: Headless capability groups have no Overview leaf`);
      continue;
    }
    const group = `${family}/headless/${capability}`;
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';
    const order = Number(/^\s+order:\s*([^\n]+)/m.exec(frontmatter)?.[1]);
    if (!Number.isInteger(order)) failures.push(`${file}: no integer sidebar.order`);
    groups.set(group, [...(groups.get(group) ?? []), order]);

    const source = prose(raw);
    const rendered = markup(source);
    const demos = imports(source).filter(({name}) => /(?:Demo|Playground|Showcase|Sandbox)$/.test(name))
      .flatMap(({name, specifier}) => [...rendered.matchAll(new RegExp(`^[ \\t]*<${name}\\b`, 'gm'))]
        .map((instance) => ({name, specifier, index: instance.index})));
    if (demos.length !== 1) {
      failures.push(`${file}: expected exactly one rendered main Demo/Playground/Showcase/Sandbox, found ${demos.length}`);
    }
    for (const demo of demos) {
      if (!reachesFrame(join(dirname(file), demo.specifier))) {
        failures.push(`${file}: <${demo.name}> must render the shared HeadlessDemoFrame through relative Astro imports`);
      }
    }

    const importSections = [...rendered.matchAll(/^## Import\s*$/gm)];
    const relatedSections = [...rendered.matchAll(/^## Related\s*$/gm)];
    const apiSections = [...rendered.matchAll(/<details\b[^>]*>\s*<summary>\s*API\s*<\/summary>/g)];
    const apiSummaries = [...rendered.matchAll(/<summary>\s*API\s*<\/summary>/g)];
    if (importSections.length !== 1) failures.push(`${file}: expected one ## Import section`);
    if (relatedSections.length !== 1) failures.push(`${file}: expected one ## Related section`);
    if (apiSections.length !== 1 || apiSummaries.length !== 1) failures.push(`${file}: expected exactly one API <details> block`);
    if (demos.length === 1 && importSections.length === 1 && relatedSections.length === 1 && apiSections.length === 1) {
      const importAt = importSections[0].index;
      const relatedAt = relatedSections[0].index;
      if (!(demos[0].index < importAt && apiSections.every((api) => importAt < api.index && api.index < relatedAt))) {
        failures.push(`${file}: required order is main demo → Import → API details → Related`);
      }
    }
  }

  for (const [group, orders] of groups) {
    const sorted = [...orders].sort((a, b) => a - b);
    if (!sorted.every((order, index) => order === index + 1)) {
      failures.push(`${group}: Headless orders are ${sorted.join(', ')}, expected 1…${sorted.length}`);
    }
  }

  const frame = load(frameFile);
  if (frame !== undefined) {
    const body = markup(frame);
    for (const [label, pattern] of [
      ['Parameters disclosure', /<summary>\s*Parameters\s*<\/summary>/g],
      ['LiveDemoCanvas', /<LiveDemoCanvas\b/g],
      ['Copy control', /\bdata-hl-copy(?=\s|=|>)/g],
      ['Reset control', /\bdata-hl-reset(?=\s|=|>)/g],
    ]) {
      if ([...body.matchAll(pattern)].length !== 1) failures.push(`${frameFile}: expected exactly one ${label}`);
    }
    if (/<(summary|legend|h[1-6])\b[^>]*>\s*(?:State|Events)(?:\s|<)/i.test(body)
      || /\b(?:aria-label|data-panel)\s*=\s*['"](?:State|Events)['"]/i.test(body)
      || /\bdata-hl-(?:states?|events?)(?:\s|=|>)/i.test(body)) {
      failures.push(`${frameFile}: the shared frame must not render separate State or Events panels`);
    }
  }
  return failures;
}
