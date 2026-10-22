import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

// Exercises the BUILT dist files, unlike the other suites which import src/.
// Each published format must keep one Core implementation shared by its
// entries, or errors and clips created through one entry fail instanceof
// checks and lose their codes in another.
const hasDist = existsSync(new URL('../dist/index.js', import.meta.url)) && existsSync(new URL('../dist/index.cjs', import.meta.url));
const requireBuilt = createRequire(import.meta.url);
const load = (name: string, extension: string) => extension === 'js'
  ? import(new URL(`../dist/${name}.js`, import.meta.url).href)
  : Promise.resolve(requireBuilt(fileURLToPath(new URL(`../dist/${name}.cjs`, import.meta.url))));

describe.skipIf(!hasDist)('@webmusic/audio built dist', () => {
  it.each(['js', 'cjs'])('edit entries share Core classes and keep failure codes (%s)', async (extension) => {
    const root = await load('index', extension);
    const edit = await load('edit/index', extension);
    const headless = await load('edit/headless/index', extension);
    expect(edit.AudioEditError).toBe(root.AudioEditError);
    expect(edit.AudioSequenceError).toBe(root.AudioSequenceError);
    expect(headless.AudioClipEditor).toBe(edit.AudioClipEditor);
    const clip = root.createAudioClip({sampleRate: 8000, channelData: [new Float32Array(8)]});
    const editor = headless.createAudioClipEditor(clip);
    const result = editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0,
      label: 'Split', operations: [{type: 'split', segmentId: 'missing', frame: 4, leftId: 'a', rightId: 'b'}]});
    expect(result.status).toBe('failed');
    expect(result.error).toBeInstanceOf(root.AudioEditError);
    expect(result.error.code).toBe('unknown-segment');
    editor.dispose();
  });
});
