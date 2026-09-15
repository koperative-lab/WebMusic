#!/usr/bin/env node
// Compile documented examples against built package declarations. Extraction
// includes supported fences, inline HTML scripts and literal MDX code exports.
// Optional local .dev/docs/DOCS-CONVENTIONS.md notes describe selection and
// fragment-input limitations; the checker does not require that directory.

import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'apps/doc/webmusic/src/content/docs');
const LANGUAGES = new Map([
  ['ts', 'ts'], ['typescript', 'ts'], ['tsx', 'tsx'],
  ['js', 'js'], ['javascript', 'js'], ['jsx', 'jsx'],
]);
const MISSING = new Set([2304, 2552, 18004]);
const NAMED = [
  /Cannot find name '([A-Za-z_$][\w$]*)'/,
  /No value exists in scope for the shorthand property '([A-Za-z_$][\w$]*)'/,
];
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

function isUnresolvedApiReference(diagnostic, message) {
  const file = diagnostic.file;
  if (!file) return false;
  const suggested = /Did you mean '([^']+)'/.exec(message)?.[1];
  let preserve = false;
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      // Missing constructors cannot be treated as host-supplied data: doing
      // so also hides every invalid member access on their instances.
      if (ts.isNewExpression(node.parent) && node.parent.expression === node &&
          node.getStart(file) === diagnostic.start) preserve = true;
      if (node.text === suggested && (ts.isImportSpecifier(node.parent) ||
          ts.isImportClause(node.parent) || ts.isNamespaceImport(node.parent))) preserve = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return preserve;
}

function importsWebMusic(code, extension) {
  const file = ts.createSourceFile(`snippet.${extension}`, code, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node) => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? node.arguments[0]
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : undefined;
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('@webmusic/')) found = true;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function hasSuppression(code, extension) {
  const file = ts.createSourceFile(`snippet.${extension}`, code, ts.ScriptTarget.Latest, true);
  let suppressed = false;
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(code, node.pos) ?? []) {
      if (/@ts-(?:nocheck|ignore|expect-error)\b/.test(code.slice(range.pos, range.end))) suppressed = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return suppressed;
}

/** Extract supported source without evaluating MDX or running an example. */
export function collectSnippets(source, page = 'example.mdx') {
  const snippets = [];
  const masked = source.split('\n');
  const lines = source.split('\n');
  let fence;
  const add = (code, extension, line, carrier, placeholders = true) => {
    if (!importsWebMusic(code, extension)) return;
    if (hasSuppression(code, extension)) throw new Error(`${page}:${line}: ${carrier} suppresses type checking; runnable examples must pass without @ts-nocheck, @ts-ignore or @ts-expect-error`);
    snippets.push({page, code, extension, line, carrier, placeholders});
  };
  const scripts = (code, firstLine, carrier) => {
    for (const match of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const attrs = match[1];
      if (/(?:^|\s)src\s*=/i.test(attrs)) continue;
      const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)?.slice(1).find((value) => value !== undefined)?.toLowerCase();
      if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
      const offset = match.index + match[0].indexOf('>') + 1;
      add(match[2], 'js', firstLine + lineAt(code, offset) - 1, `${carrier} script`);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fence) {
      const open = /^\s{0,3}(`{3,}|~{3,})([^\s`~]*).*$/u.exec(line);
      if (!open) continue;
      fence = {delimiter: open[1], language: open[2].toLowerCase(), start: i + 1, body: []};
    } else {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.delimiter[0] && close[1].length >= fence.delimiter.length) {
        const code = fence.body.join('\n');
        const extension = LANGUAGES.get(fence.language);
        if (extension) add(code, extension, fence.start + 1, `${fence.language} fence`);
        else if (fence.language === 'html') scripts(code, fence.start + 1, 'HTML fence');
        fence = undefined;
      } else fence.body.push(line);
    }
    masked[i] = ' '.repeat(line.length);
  }
  if (fence && (LANGUAGES.has(fence.language) || fence.language === 'html')) {
    throw new Error(`${page}:${fence.start}: unclosed ${fence.language} code fence`);
  }

  // Only top-level exported literal strings are code carriers. Parsing an
  // initializer with TypeScript handles escapes and nested quotes without eval.
  // Mask the whole declaration so its contents cannot become another export or
  // inline script. Interpolated code is rejected when it targets our packages.
  let prose = masked.join('\n');
  const exports = /^[ \t]*export\s+const\s+/gm;
  for (let match; (match = exports.exec(prose));) {
    const file = ts.createSourceFile('mdx-export.tsx', prose.slice(match.index), ts.ScriptTarget.Latest, true);
    const statement = file.statements[0];
    if (!statement || !ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let initializer = declaration.initializer;
      if (!initializer) continue;
      while (ts.isParenthesizedExpression(initializer)) initializer = initializer.expression;
      const name = declaration.name.getText(file);
      if (ts.isStringLiteralLike(initializer)) {
        add(initializer.text, 'ts', lineAt(source, match.index + initializer.getStart(file)), `MDX export ${name}`, false);
      } else if (initializer.getText(file).includes('@webmusic/')) {
        throw new Error(`${page}:${lineAt(source, match.index)}: nonliteral MDX code export ${name} cannot be checked; use a literal runnable example`);
      }
    }
    const end = match.index + statement.end;
    prose = prose.slice(0, match.index) + prose.slice(match.index, end).replace(/[^\n]/g, ' ') + prose.slice(end);
    exports.lastIndex = end;
  }
  scripts(prose, 1, 'inline HTML');
  return snippets;
}

function walk(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.mdx?$/.test(entry.name) ? [file] : [];
  });
}

export function compilerDiagnostics(files, options) {
  const program = ts.createProgram(files, options);
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
}

/** The run owns a unique cache directory; independent callers never delete it. */
export function checkSnippets(snippets, {root = ROOT, compile = compilerDiagnostics} = {}) {
  const cache = join(root, 'node_modules/.cache');
  mkdirSync(cache, {recursive: true});
  const work = mkdtempSync(join(cache, 'webmusic-snippets-'));
  const options = {
    noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [], skipLibCheck: true, strict: false, allowJs: true, checkJs: true,
    moduleDetection: ts.ModuleDetectionKind.Force, noUncheckedSideEffectImports: true,
  };
  const files = snippets.map((snippet, index) => join(work, `snippet-${index}.${snippet.extension}`));
  const byFile = new Map(files.map((file, index) => [file, index]));
  const preludes = snippets.map(() => '');
  const write = () => files.forEach((file, index) => writeFileSync(file, preludes[index] + snippets[index].code + '\n'));
  try {
    write();
    const declared = snippets.map(() => new Set());
    for (const diagnostic of compile(files, options)) {
      const index = diagnostic.file && byFile.get(diagnostic.file.fileName);
      if (index === undefined || !snippets[index].placeholders || !MISSING.has(diagnostic.code)) continue;
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (isUnresolvedApiReference(diagnostic, message)) continue;
      const name = NAMED.map((pattern) => pattern.exec(message)?.[1]).find(Boolean);
      if (name) declared[index].add(name);
    }
    declared.forEach((names, index) => {
      const js = ['js', 'jsx'].includes(snippets[index].extension);
      preludes[index] = [...names].map((name) => js
        ? `var ${name} = /** @type {*} */ (undefined);\n`
        : `declare const ${name}: any;\n`).join('');
    });
    write();
    return compile(files, options).map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const index = diagnostic.file && byFile.get(diagnostic.file.fileName);
      if (index === undefined) return `compiler: TS${diagnostic.code} ${message}`;
      const snippet = snippets[index];
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const snippetLine = position.line + 1 - (preludes[index].match(/\n/g)?.length ?? 0);
      // Literal exports may contain escaped newlines; report their source
      // declaration plus a code-relative line, rather than a false source line.
      const sourceLine = snippet.carrier.startsWith('MDX export') ? snippet.line : snippet.line + snippetLine - 1;
      return `${snippet.page}:${sourceLine} [${snippet.carrier}, code line ${snippetLine}]: TS${diagnostic.code} ${message}`;
    });
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

function main() {
  const snippets = walk(DOCS).flatMap((file) => collectSnippets(readFileSync(file, 'utf8'), relative(DOCS, file)));
  if (!snippets.length) throw new Error('No supported documentation examples import @webmusic/*; check extraction and source paths.');
  const failures = checkSnippets(snippets);
  if (failures.length) {
    console.error(`Doc snippet check failed with ${failures.length} problem(s):\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    console.error(`Checked ${snippets.length} examples against built declarations; rebuild packages if dist is stale.`);
    process.exitCode = 1;
  } else console.log(`Doc snippet check passed: ${snippets.length} examples (fences, inline scripts, and literal MDX code exports) compile against built declarations.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
}
