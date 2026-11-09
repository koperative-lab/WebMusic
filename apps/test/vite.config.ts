import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import {defineConfig} from 'vitest/config';

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

export default defineConfig({
  publicDir,
  plugins: [stubOptionalPeers],
  server: {fs: {allow: [fileURLToPath(new URL('../..', import.meta.url))]}},
  build: {target: 'es2022', rollupOptions: {external: OPTIONAL_AUDIO_PEERS}},
  worker: {format: 'es', rollupOptions: {external: OPTIONAL_AUDIO_PEERS}},
  test: {environment: 'jsdom', include: ['test/**/*.test.ts']},
});
