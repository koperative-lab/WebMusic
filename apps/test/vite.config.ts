import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import {defineConfig} from 'vitest/config';
import {readBuildIdentity} from './build-identity.ts';
import {BUILD_IDENTITY_FILE} from './src/build.ts';

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
  name: 'webmusic-test:stub-optional-peers',
  apply: 'serve',
  enforce: 'pre',
  resolveId: (id) => OPTIONAL_AUDIO_PEERS.includes(id) ? `\0webmusic-empty:${id}` : null,
  load: (id) => id.startsWith('\0webmusic-empty:') ? 'export default {};' : null,
};

// The build identity (version, commit, working tree, package versions). The
// development server reads Git on every request, so a reload after a commit
// shows the new commit; a production build writes the identity it was built at.
const buildIdentity: Plugin = {
  name: 'webmusic-test:build-identity',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== `${server.config.base}${BUILD_IDENTITY_FILE}`) return next();
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(`${JSON.stringify(readBuildIdentity(repositoryRoot), null, 2)}\n`);
    });
  },
  generateBundle() {
    this.emitFile({type: 'asset', fileName: BUILD_IDENTITY_FILE, source: `${JSON.stringify(readBuildIdentity(repositoryRoot), null, 2)}\n`});
  },
};

export default defineConfig({
  publicDir,
  plugins: [stubOptionalPeers, buildIdentity],
  server: {fs: {allow: [repositoryRoot]}},
  build: {target: 'es2022', rollupOptions: {external: OPTIONAL_AUDIO_PEERS}},
  worker: {format: 'es', rollupOptions: {external: OPTIONAL_AUDIO_PEERS}},
  test: {environment: 'jsdom', include: ['test/**/*.test.ts']},
});
