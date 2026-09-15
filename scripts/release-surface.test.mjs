import assert from 'node:assert/strict';
import test from 'node:test';
import {manifestBoundaryProblems, unpublishedWorkspacePackage} from './release-surface.mjs';

const release = ['@webmusic/kernel', '@webmusic/ui', '@webmusic/score'];

test('first-release consumers accept Score, Kernel and standalone UI presenter imports', () => {
  for (const specifier of ['@webmusic/score', '@webmusic/score/play/headless', '@webmusic/kernel/sync', '@webmusic/ui/minimap']) {
    assert.equal(unpublishedWorkspacePackage(specifier, release), undefined);
  }
});

test('deferred packages cannot return through a root or subpath import', () => {
  for (const specifier of ['@webmusic/audio', '@webmusic/audio/play/headless', '@webmusic/bridge']) {
    assert.equal(unpublishedWorkspacePackage(specifier, release), specifier.split('/').slice(0, 2).join('/'));
  }
  assert.equal(unpublishedWorkspacePackage('@webmusic/future', release), '@webmusic/future');
});

test('third-party packages and platform APIs are outside the workspace boundary', () => {
  for (const specifier of ['tone', 'node:fs', '@other/audio', './audio-contracts']) {
    assert.equal(unpublishedWorkspacePackage(specifier, release), undefined);
  }
});

test('deferred dependencies fail even when only optional or used by docs development', () => {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const manifest = {[field]: {'@webmusic/audio': '^0.1.0'}, peerDependenciesMeta: {'@webmusic/audio': {optional: true}}};
    assert.deepEqual(manifestBoundaryProblems(manifest, release), [
      `${field}.@webmusic/audio references a package outside this release.`,
    ]);
  }
});

test('Score consumers retain required Kernel and optional UI without a deferred package', () => {
  assert.deepEqual(manifestBoundaryProblems({
    dependencies: {tone: '^15.0.0'},
    peerDependencies: {'@webmusic/kernel': '^0.1.0', '@webmusic/ui': '^0.1.0', react: '^19.0.0'},
    peerDependenciesMeta: {'@webmusic/ui': {optional: true}, react: {optional: true}},
  }, release.values()), []);
});
