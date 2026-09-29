// Rewrite root-absolute internal HTML targets in the built docs site for a
// non-root deploy base (e.g. GitHub Pages project sites). Astro's own generated
// links respect `base`, but absolute links written in MDX content do not. After
// rewriting markup, scan all emitted HTML/JS/CSS for resource URLs that would
// escape the project-site base. JavaScript asset URLs must be authored with
// `import.meta.env.BASE_URL`; silently rewriting compiled JS would hide a source
// regression and is unsafe around minified syntax.
//
// Usage: node scripts/prefix-docs-base.mjs <distDir> <base>
import {readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const [dist, base] = process.argv.slice(2);
if (!dist || !base || !base.startsWith('/') || base === '/') {
  console.error('Usage: node scripts/prefix-docs-base.mjs <distDir> </base>');
  process.exit(1);
}
const prefix = base.replace(/\/$/, '');
const textExtensions = new Set(['.css', '.html', '.js', '.mjs']);
const deployAssetLiteral = /(["'`])\/(?!\/)(audio|midi|mxl|soundfont)\/[^"'`\s<>{}]*\1/g;

async function* textFiles(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* textFiles(full);
    else if (textExtensions.has(path.extname(entry.name))) yield full;
  }
}

let files = 0;
let rewrites = 0;
const emittedFiles = [];
for await (const file of textFiles(dist)) {
  emittedFiles.push(file);
  if (!file.endsWith('.html')) continue;
  const before = await readFile(file, 'utf8');
  const after = before.replace(
    /\b(href|src|action|poster)=(["'])\/(?!\/)([^"']*)\2/g,
    (match, attr, quote, rest) => {
      const target = `/${rest}`;
      if (target === prefix || target.startsWith(`${prefix}/`)) return match;
      rewrites += 1;
      return `${attr}=${quote}${prefix}/${rest}${quote}`;
    },
  );
  if (after !== before) {
    await writeFile(file, after);
    files += 1;
  }
}

const escapedAssets = [];
for (const file of emittedFiles) {
  const contents = await readFile(file, 'utf8');
  const executableContents = file.endsWith('.html')
    ? [...contents.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1])
    : [contents];
  for (const executable of executableContents) {
    for (const match of executable.matchAll(deployAssetLiteral)) {
      const literal = match[0].slice(1, -1);
      escapedAssets.push(`${path.relative(dist, file)}: ${literal}`);
    }
  }
  if (file.endsWith('.css')) {
    for (const match of contents.matchAll(
      /url\(\s*(["']?)\/(?!\/)(audio|midi|mxl|soundfont)\/[^)'"\s]+\1\s*\)/g,
    )) {
      const literal = match[0];
      if (literal.includes(`${prefix}/`)) continue;
      escapedAssets.push(`${path.relative(dist, file)}: ${literal}`);
    }
  }
}

if (escapedAssets.length > 0) {
  const sample = escapedAssets.slice(0, 20).map((entry) => `  - ${entry}`).join('\n');
  throw new Error(
    `Found ${escapedAssets.length} deploy asset URL(s) that escape ${prefix}. ` +
      `Use import.meta.env.BASE_URL in source:\n${sample}`,
  );
}

console.log(
  `Prefixed ${rewrites} root-absolute links across ${files} HTML files with ${prefix}; ` +
    `validated ${emittedFiles.length} emitted HTML/JS/CSS files.`,
);
