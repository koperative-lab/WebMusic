import {defineConfig} from 'tsup';

/**
 * Every published module entry. This list is the single source of truth for
 * the dist layout: scripts/check-architecture.mjs imports it to reconcile
 * build entries against the exports map, so add entries here and in
 * package.json#exports together.
 */
export const moduleEntries = [
  'src/index.ts',
  'src/view/index.ts',
  'src/view/headless/index.ts',
  'src/view/render/index.ts',
  'src/view/element/index.ts',
  'src/view/element/auto.ts',
  'src/view/element/global.ts',
  'src/play/index.ts',
  'src/play/headless/index.ts',
  'src/play/element/index.ts',
  'src/play/element/auto.ts',
  'src/play/element/global.ts',
  'src/play/worker-client.ts',
  'src/play/worker-protocol.ts',
  'src/play/worker.ts',
  'src/analyze/index.ts',
  'src/analyze/headless/index.ts',
  'src/analyze/element/index.ts',
  'src/analyze/element/auto.ts',
  'src/analyze/element/global.ts',
  'src/analyze/transcribe.ts',
  'src/analyze/worker-client.ts',
  'src/analyze/worker-protocol.ts',
  'src/analyze/worker.ts',
  'src/react/index.tsx',
];

const iife = (capability, globalName) => ({
  entry: {[`${capability}/auto`]: `src/${capability}/element/auto.ts`},
  format: ['iife'],
  globalName,
  platform: 'browser',
  tsconfig: '../../scripts/tsconfig.browser-iife.json',
  minify: true,
  sourcemap: true,
  define: {'import.meta.url': 'undefined'},
});

export default defineConfig([
  // ESM: code-split so the core model and other shared modules live in ONE
  // chunk — subpath entries must share class identity, not carry copies.
  // No `clean: true` here: tsup runs these configs concurrently against one
  // dist, and a per-config clean sweep deletes the other configs' fresh
  // output. `scripts/clean-dist.mjs` clears dist once, before tsup starts.
  {
    entry: moduleEntries,
    format: ['esm'],
    tsconfig: 'tsconfig.build.json',
    dts: true,
    sourcemap: true,
  },
  // CJS: no code splitting (esbuild limitation), so shared modules are
  // inlined per entry — the same tradeoff the pre-merge per-package builds
  // made. `import.meta.url` is compiled away so the worker clients fall back
  // to configured/explicit workers.
  {
    entry: moduleEntries,
    format: ['cjs'],
    tsconfig: 'tsconfig.build.json',
    dts: true,
    sourcemap: true,
    define: {'import.meta.url': 'undefined'},
  },
  // Browser IIFEs: <script>-tag bundles registering each capability's
  // elements and global. They bundle kernel and sibling capabilities from
  // SOURCE via the repo-level browser tsconfig paths — never from dist.
  iife('view', 'WebMusicAudioView'),
  iife('play', 'WebMusicAudioPlay'),
  iife('analyze', 'WebMusicAudioAnalyze'),
]);
