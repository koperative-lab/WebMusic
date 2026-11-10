import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import {defineConfig} from 'vitest/config';
import {UI_COMPOSITION_CATALOG} from '../doc/shared/ui-catalog.ts';
import {readSummaries} from './summaries.ts';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

// Arabesque No. 1 comes from the documentation site's owner-maintained public
// folder. Vite only reads it (served in development, copied into this app's
// ignored dist/ on build); nothing here writes to that folder (AGENTS.md).
const publicDir = fileURLToPath(new URL('../doc/webmusic/public', import.meta.url));

// Optional audio engines @webmusic/audio reaches only through guarded dynamic
// imports; they are not installed. Same list and handling as the docs site.
const OPTIONAL_AUDIO_PEERS = [
  'music-metadata', 'mpg123-decoder', 'ogg-opus-decoder', 'mediabunny',
  'signalsmith-stretch', '@soundtouchjs/audio-worklet', '@wasm-audio-decoders/flac',
  '@wasm-audio-decoders/ogg-vorbis', 'webfft', 'realtime-bpm-analyzer', 'pitchfinder',
  'aubiojs', 'essentia.js', '@spotify/basic-pitch', '@tensorflow/tfjs', '@magenta/music',
];

const stubOptionalPeers: Plugin = {
  name: 'webmusic-library:stub-optional-peers',
  apply: 'serve',
  enforce: 'pre',
  resolveId: (id) => OPTIONAL_AUDIO_PEERS.includes(id) ? `\0webmusic-empty:${id}` : null,
  load: (id) => id.startsWith('\0webmusic-empty:') ? 'export default {};' : null,
};

// One sentence per element, read from its owning documentation page.
const SUMMARIES_ID = 'virtual:webmusic-library/summaries';
const summaries: Plugin = {
  name: 'webmusic-library:summaries',
  resolveId: (id) => id === SUMMARIES_ID ? `\0${SUMMARIES_ID}` : null,
  load(id) {
    if (id !== `\0${SUMMARIES_ID}`) return null;
    for (const entry of UI_COMPOSITION_CATALOG) {
      const route = entry.href.replace(/^\/|\/$/g, '');
      this.addWatchFile(fileURLToPath(new URL(`../doc/webmusic/src/content/docs/${route}.mdx`, import.meta.url)));
    }
    return `export default ${JSON.stringify(readSummaries(repositoryRoot, UI_COMPOSITION_CATALOG))};`;
  },
};

// The home page keeps pictures of each element per build. This key changes
// when a package is rebuilt or the library's drawing code changes, so a
// picture always shows the code that is running.
function pictureVersion(): string {
  const hash = createHash('sha256');
  for (const pkg of ['platform/kernel', 'packages/ui', 'packages/score', 'packages/audio']) {
    const manifest = `${repositoryRoot}${pkg}/package.json`;
    hash.update(readFileSync(manifest));
    const dist = `${repositoryRoot}${pkg}/dist`;
    if (existsSync(dist)) hash.update(String(statSync(dist).mtimeMs));
  }
  for (const file of ['src/compose.ts', 'src/recipes.ts', 'src/render.ts', 'src/snapshot.ts', 'src/elements.ts']) {
    hash.update(readFileSync(fileURLToPath(new URL(file, import.meta.url))));
  }
  return hash.digest('hex').slice(0, 16);
}

export default defineConfig({
  publicDir,
  define: {__LIBRARY_PICTURE_VERSION__: JSON.stringify(pictureVersion())},
  plugins: [stubOptionalPeers, summaries],
  server: {fs: {allow: [repositoryRoot]}},
  build: {
    target: 'es2022',
    rollupOptions: {
      external: OPTIONAL_AUDIO_PEERS,
      // The library page and the background frame that draws its pictures.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        render: fileURLToPath(new URL('render.html', import.meta.url)),
      },
    },
  },
  worker: {format: 'es', rollupOptions: {external: OPTIONAL_AUDIO_PEERS}},
  test: {environment: 'jsdom', include: ['test/**/*.test.ts']},
});
