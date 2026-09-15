import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {checkSnippets, collectSnippets} from './check-doc-snippets.mjs';

const code = 'import { Player } from "@webmusic/example";\nnew Player().play();';
const fence = (body, language = 'ts') => `\`\`\`${language}\n${body}\n\`\`\``;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'webmusic-snippet-test-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const pkg = join(root, 'node_modules/@webmusic/example');
  mkdirSync(pkg, {recursive: true});
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({type: 'module', exports: './index.d.ts'}));
  writeFileSync(join(pkg, 'index.d.ts'), 'export class Player { play(): void; }\nexport interface Score { title: string; }\nexport function Widget(props: {count: number}): any;\n');
  const react = join(root, 'node_modules/react');
  mkdirSync(react, {recursive: true});
  writeFileSync(join(react, 'package.json'), JSON.stringify({type: 'module', exports: {'./jsx-runtime': './jsx-runtime.d.ts'}}));
  writeFileSync(join(react, 'jsx-runtime.d.ts'), 'export namespace JSX { interface Element {} interface IntrinsicElements {} }');
  return root;
}

test('selects supported fence languages and retains independent source locations', () => {
  const languages = ['ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx'];
  const snippets = collectSnippets(languages.map((language) => fence(code, language)).join('\n\n'), 'all.mdx');
  assert.equal(snippets.length, 6);
  assert.deepEqual(snippets.map((snippet) => snippet.extension), ['ts', 'ts', 'tsx', 'js', 'js', 'jsx']);
  assert.deepEqual(snippets.map((snippet) => snippet.line), [2, 7, 12, 17, 22, 27]);
  assert.ok(snippets.every((snippet) => snippet.page === 'all.mdx' && snippet.placeholders));
});

test('uses syntax to distinguish real imports, side effects, re-exports and type references from prose', () => {
  const imports = [
    'import "@webmusic/example";',
    'export { Player } from "@webmusic/example";',
    'const api = await import("@webmusic/example");',
    'type Player = import("@webmusic/example").Player;',
    'import type { Player } from "@webmusic/example";',
  ];
  assert.equal(collectSnippets(imports.map((body) => fence(body)).join('\n')).length, 5);
  assert.equal(collectSnippets(fence('// import "@webmusic/example";\nconst mention = "@webmusic/example";')).length, 0);
  assert.equal(collectSnippets(fence('import "some-other-package";')).length, 0);
  assert.equal(collectSnippets(fence(code, 'text')).length, 0);
});

test('respects fence delimiter kind and length without extracting nested examples twice', () => {
  const source = ['````ts', code, '```', '````', '~~~js', code, '~~~'].join('\n');
  const snippets = collectSnippets(source);
  assert.equal(snippets.length, 2);
  assert.ok(snippets[0].code.endsWith('```'));
  assert.throws(() => collectSnippets('```tsx\n' + code, 'broken.mdx'), /broken\.mdx:1: unclosed tsx/);
  assert.throws(() => collectSnippets('```html\n<script>' + code + '</script>', 'broken.mdx'), /broken\.mdx:1: unclosed html/);
});

test('extracts executable inline HTML scripts once, excluding remote and data scripts', () => {
  const html = `<script type="module">\n${code}\n</script>`;
  const source = [fence(html, 'html'), html, `<script src="/remote.js">${code}</script>`, `<script type="application/json">${code}</script>`, `<script type=application/json>${code}</script>`, `<script data-src="example" data-type="application/json" type="module">${code}</script>`].join('\n');
  const snippets = collectSnippets(source);
  assert.equal(snippets.length, 3);
  assert.deepEqual(snippets.map((snippet) => snippet.carrier), ['HTML fence script', 'inline HTML script', 'inline HTML script']);
  assert.deepEqual(snippets.map((snippet) => snippet.extension), ['js', 'js', 'js']);
});

test('rejects type-check suppressions without mistaking quoted examples for directives', () => {
  for (const directive of ['// @ts-nocheck', '// @ts-ignore', '// @ts-expect-error', '/* @ts-nocheck */']) {
    assert.throws(() => collectSnippets(fence(directive + '\n' + code)), /suppresses type checking/);
    assert.throws(() => collectSnippets('export const code = ' + JSON.stringify(directive + '\n' + code) + ';'), /suppresses type checking/);
  }
  assert.equal(collectSnippets(fence(code + '\nconst text = "// @ts-nocheck";')).length, 1);
});

test('decodes MDX literal strings without executing code or re-scanning their contents', () => {
  const withScript = code + '\n// <script>' + code + '</script>';
  const source = 'export const escaped = ' + JSON.stringify(withScript) + ';\n\n' +
    'export const template = `' + code + '`;\n\n' +
    'export const ignored = (() => { throw new Error("must not execute"); })();';
  const snippets = collectSnippets(source, 'sandbox.mdx');
  assert.equal(snippets.length, 2);
  assert.equal(snippets[0].code, withScript);
  assert.equal(snippets[1].code, code);
  assert.ok(snippets.every((snippet) => !snippet.placeholders));
  assert.equal(collectSnippets('export const code = (' + JSON.stringify(code) + ');')[0].code, code);
  for (const initializer of [
    '`import "@webmusic/example"; ${input}`',
    '(`import "@webmusic/example"; ${input}`)',
    'String.raw`import "@webmusic/example";`',
    JSON.stringify('import "@webmusic/example";') + ' + otherCode',
  ]) {
    assert.throws(() => collectSnippets('export const code = ' + initializer + ';', 'computed.mdx'), /computed\.mdx:1: nonliteral MDX code export code cannot be checked/);
  }
});

test('compiles each carrier against declarations and preserves body, type and import failures', (t) => {
  const root = fixture(t);
  const examples = [
    ['valid.mdx', fence(code)],
    ['inputs.mdx', fence(code + '\nconsole.log(hostInput);')],
    ['valid-js.mdx', fence(code, 'js')],
    ['method.mdx', fence(code + '\nnew Player().missing();')],
    ['js-method.mdx', fence(code + '\nnew Player().missing();', 'js')],
    ['jsx-props.mdx', fence('import { Widget } from "@webmusic/example";\nconst el = <Widget count="wrong" />;', 'jsx')],
    ['tsx-props.mdx', fence('import { Widget } from "@webmusic/example";\nconst el = <Widget count="wrong" />;', 'tsx')],
    ['import.mdx', fence('import { Missing } from "@webmusic/example";')],
    ['side-effect.mdx', fence('import "@webmusic/example/missing";')],
    ['type.mdx', fence(code + '\nconst score: Score = input;')],
    ['html.mdx', fence(`<script type="module">${code}\nnew Player().missing();</script>`, 'html')],
    ['sandbox.mdx', 'export const code = ' + JSON.stringify(code + '\nconsole.log(hostInput);') + ';'],
    ['constructor.mdx', fence('import { Player } from "@webmusic/example";\nconst player = new Plyer(input);\nplayer.missing();')],
    ['function-typo.mdx', fence('import { Widget } from "@webmusic/example";\nWidge({count: 1});')],
  ];
  const snippets = examples.flatMap(([page, source]) => collectSnippets(source, page));
  const failures = checkSnippets(snippets, {root});
  assert.equal(failures.length, 11, failures.join('\n'));
  for (const [page] of examples.slice(3)) assert.ok(failures.some((failure) => failure.startsWith(page + ':')), page);
  assert.ok(failures.some((failure) => /method\.mdx:4 .*TS2339/.test(failure)), failures.join('\n'));
  assert.ok(failures.some((failure) => /sandbox\.mdx:1 \[MDX export code, code line 3\].*hostInput/.test(failure)));
});

test('reports compiler-level diagnostics and removes temporary files after errors', (t) => {
  const root = fixture(t);
  let work;
  const failures = checkSnippets(collectSnippets(fence(code)), {root, compile(files) {
    work = dirname(files[0]);
    assert.ok(existsSync(files[0]));
    return [{category: ts.DiagnosticCategory.Error, code: 9999, messageText: 'compiler configuration failed'}];
  }});
  assert.deepEqual(failures, ['compiler: TS9999 compiler configuration failed']);
  assert.equal(existsSync(work), false);
  assert.throws(() => checkSnippets(collectSnippets(fence(code)), {root, compile(files) {
    work = dirname(files[0]);
    throw new Error('compiler crashed');
  }}), /compiler crashed/);
  assert.equal(existsSync(work), false);
});

test('overlapping checks own distinct caches and leave each other’s files intact', (t) => {
  const root = fixture(t);
  const snippets = collectSnippets(fence(code));
  let outerWork;
  let innerWork;
  let nested = false;
  checkSnippets(snippets, {root, compile(files) {
    outerWork = dirname(files[0]);
    if (!nested) {
      nested = true;
      checkSnippets(snippets, {root, compile(innerFiles) {
        innerWork = dirname(innerFiles[0]);
        assert.notEqual(innerWork, outerWork);
        assert.equal(readFileSync(files[0], 'utf8').trim(), code);
        return [];
      }});
      assert.equal(existsSync(innerWork), false);
      assert.ok(existsSync(files[0]));
    }
    return [];
  }});
  assert.equal(existsSync(outerWork), false);
});
