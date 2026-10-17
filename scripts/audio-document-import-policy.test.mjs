import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowsAudioDocumentLoaderImport as allowed} from './audio-document-import-policy.mjs';

test('Audio declaration exception is restricted to one exact adapter, target and import symbol', () => {
  const args = ['@webmusic/audio', 'edit/element/internal/audio-document-loader.ts', 'play/api/load.ts'];
  const imported = {dynamic: false, runtime: true, symbols: ['loadClipFromUrl']};
  assert.equal(allowed(...args, imported), true);
  for (const [index, replacement] of [[0, '@webmusic/score'], [1, 'edit/headless/index.ts'],
    [1, 'edit/element/audio-document.ts'], [2, 'play/api/index.ts'], [2, 'play/headless/index.ts']]) {
    const changed = [...args]; changed[index] = replacement;
    assert.equal(allowed(...changed, imported), false);
  }
  for (const changed of [{dynamic: true}, {runtime: false}, {symbols: []}, {symbols: ['*']},
    {symbols: ['default']}, {symbols: ['loadClip']}, {symbols: ['loadClipFromUrl', 'parseWav']}]) {
    assert.equal(allowed(...args, {...imported, ...changed}), false);
  }
});
