import assert from 'node:assert/strict';
import test from 'node:test';
import {sourceWithoutOwnedFocusWrite} from './element-composition-policy.mjs';

const owner = 'packages/score/src/view/render/piano-roll-editor.ts';
const focus = "svg.setAttribute('tabindex', '0');";

test('permits only the reviewed musical SVG focus write', () => {
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, focus), '');
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus), focus);
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', 'packages/score/src/view/element/score-view.ts', focus), focus);
  for (const other of ["surface.setAttribute('tabindex', '0');", "svg.setAttribute('tabindex', '-1');",
    "svg.setAttribute('role', 'slider');", "svg.setAttribute('aria-valuenow', '1');", 'svg.tabIndex = 0;']) {
    assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, other), other);
  }
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, focus + focus), focus);
});

test('permits only the waveform editor application focus write', () => {
  const owner = 'packages/audio/src/view/render/waveform-editor.ts';
  const focus = "surface.setAttribute('tabindex', '0');";
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus), '');
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, focus), focus);
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', 'packages/audio/src/view/element/audio-view.ts', focus), focus);
  for (const other of ["svg.setAttribute('tabindex', '0');", "surface.setAttribute('tabindex', '-1');",
    "surface.setAttribute('role', 'slider');", "surface.setAttribute('aria-valuenow', '1');", 'surface.tabIndex = 0;']) {
    assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, other), other);
  }
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus + focus), focus);
});

test('permits only the staff input application focus write', () => {
  const owner = 'packages/score/src/view/render/staff-editor.ts';
  const focus = "surface.setAttribute('tabindex', '0');";
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, focus), '');
  assert.equal(sourceWithoutOwnedFocusWrite('audio-view', owner, focus), focus);
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', 'packages/score/src/view/element/score-view.ts', focus), focus);
  for (const other of ["svg.setAttribute('tabindex', '0');", "surface.setAttribute('tabindex', '-1');",
    "surface.setAttribute('role', 'slider');", "surface.setAttribute('aria-valuenow', '1');", 'surface.tabIndex = 0;']) {
    assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, other), other);
  }
  assert.equal(sourceWithoutOwnedFocusWrite('score-view', owner, focus + focus), focus);
});
