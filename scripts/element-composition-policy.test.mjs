import assert from 'node:assert/strict';
import test from 'node:test';
import {sourceWithoutOwnedFocusWrite} from './element-composition-policy.mjs';

const owner = 'packages/score/src/view/render/score-grid.ts';
const focus = "svg.setAttribute('tabindex', '0');";

test('permits only the reviewed musical SVG focus write', () => {
  assert.equal(sourceWithoutOwnedFocusWrite('score-grid-view', owner, focus), '');
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus), focus);
  // The read-only <score-view> owns no editing surface and gets no exemption.
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, focus), focus);
  assert.equal(sourceWithoutOwnedFocusWrite('score-grid-view', 'packages/score/src/view/element/score-grid-view.ts', focus), focus);
  for (const other of ["surface.setAttribute('tabindex', '0');", "svg.setAttribute('tabindex', '-1');",
    "svg.setAttribute('role', 'slider');", "svg.setAttribute('aria-valuenow', '1');", 'svg.tabIndex = 0;']) {
    assert.equal(sourceWithoutOwnedFocusWrite('score-grid-view', owner, other), other);
  }
  assert.equal(sourceWithoutOwnedFocusWrite('score-grid-view', owner, focus + focus), focus);
});

test('permits each editing owner to withdraw only its own read-only tab stop once', () => {
  const owners = [['score-grid-view', owner, 'svg'], ['audio-view', 'packages/audio/src/view/render/waveform-editor.ts', 'surface']];
  for (const [tag, source, node] of owners) {
    const removal = `${node}.removeAttribute('tabindex');`;
    assert.equal(sourceWithoutOwnedFocusWrite(tag, source, removal), '');
    assert.equal(sourceWithoutOwnedFocusWrite(tag, source, removal + removal), removal);
    assert.equal(sourceWithoutOwnedFocusWrite(tag === 'score-grid-view' ? 'audio-view' : 'score-grid-view', source, removal), removal);
    for (const other of [`${node}.removeAttribute('aria-valuenow');`, `${node}.removeAttribute('role');`]) {
      assert.equal(sourceWithoutOwnedFocusWrite(tag, source, other), other);
    }
  }
  // The removed staff editor no longer has an exemption.
  const staff = "surface.removeAttribute('tabindex');";
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', 'packages/score/src/view/render/staff-editor.ts', staff), staff);
});

test('permits only the waveform editor application focus write', () => {
  const owner = 'packages/audio/src/view/render/waveform-editor.ts';
  const focus = "surface.setAttribute('tabindex', '0');";
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus), '');
  assert.equal(sourceWithoutOwnedFocusWrite('score-grid-view', owner, focus), focus);
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', 'packages/audio/src/view/element/audio-view.ts', focus), focus);
  for (const other of ["svg.setAttribute('tabindex', '0');", "surface.setAttribute('tabindex', '-1');",
    "surface.setAttribute('role', 'slider');", "surface.setAttribute('aria-valuenow', '1');", 'surface.tabIndex = 0;']) {
    assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, other), other);
  }
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus + focus), focus);
});

test('grants no focus exemption to the removed staff editor', () => {
  const owner = 'packages/score/src/view/render/staff-editor.ts';
  const focus = "surface.setAttribute('tabindex', '0');";
  for (const tag of ['score-view', 'score-grid-view']) assert.equal(sourceWithoutOwnedFocusWrite(tag, owner, focus), focus);
});
