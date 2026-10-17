import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {isIdentifierReference, isRuntimeIdentifierReference} from './architecture-identifiers.mjs';

function references(text, predicate = isRuntimeIdentifierReference) {
  const source = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'document' && predicate(node)) {
      found.push(node.getStart(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('document-named interfaces, signatures and member labels are not runtime DOM access', () => {
  assert.deepEqual(references(`
    interface document { readonly value: string }
    interface EditorState { readonly document: Snapshot }
    interface ReadSource { document(): Snapshot }
    type Snapshot = { document: string };
    class State { document = 1; }
    class Source { document() { return 1; } }
    const state = { document: 1 };
    state.document;
  `), []);
});

test('type-only references stay non-runtime, including computed interface names', () => {
  const source = `
    type NativeDocument = typeof document;
    interface Source { [document.title]: NativeDocument }
  `;
  assert.equal(references(source, isIdentifierReference).length, 2);
  assert.deepEqual(references(source), []);
});

test('a nonvisual member does not hide a real global read in the same module', () => {
  const source = 'interface EditorState { readonly document: Snapshot }\ndocument.title;';
  assert.deepEqual(references(source), [source.lastIndexOf('document')]);
});

test('runtime expressions retain global reads in initializers, bodies and computed keys', () => {
  for (const source of [
    'document.title;',
    'const state = { document };',
    'const state = { document: document };',
    'const state = { [document.title]: true };',
    'class State { document = document.title; }',
    'class State { [document.title] = 1; }',
    'class State { document() { return document.title; } }',
    'function read(value: typeof document = document) { return value; }',
    'const exists = typeof document !== "undefined";',
  ]) {
    assert.equal(references(source).length, 1, source);
  }
});
