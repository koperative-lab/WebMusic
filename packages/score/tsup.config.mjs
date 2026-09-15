import {defineConfig} from 'tsup';

/**
 * Every published module entry. This list is the single source of truth for
 * the dist layout: scripts/check-architecture.mjs imports it to reconcile
 * build entries against the exports map, so add entries here and in
 * package.json#exports together.
 *
 * `src/analyze/worker-url.ts` is a deliberate non-public entry: it anchors the
 * default worker URL to `dist/analyze/` (entry modules are never hoisted into
 * shared chunks, so its `import.meta.url` stays next to `worker.js`).
 */
export const moduleEntries = [
  'src/index.ts',
  'src/io/index.ts',
  'src/io/load.ts',
  'src/io/formats/index.ts',
  'src/io/worker-client.ts',
  'src/io/worker-protocol.ts',
  'src/io/worker.ts',
  'src/view/index.ts',
  'src/view/headless/index.ts',
  'src/view/render/index.ts',
  'src/view/element/index.ts',
  'src/play/index.ts',
  'src/play/headless/index.ts',
  'src/play/drivers.ts',
  'src/play/element/index.ts',
  'src/play/element/auto.ts',
  'src/play/element/global.ts',
  'src/play/demos/index.ts',
  'src/analyze/index.ts',
  'src/analyze/headless/index.ts',
  'src/analyze/element/index.ts',
  'src/analyze/worker-client.ts',
  'src/analyze/worker-protocol.ts',
  'src/analyze/worker.ts',
  'src/analyze/worker-url.ts',
  'src/react/index.tsx',
];

const globalDeclarationEntry = 'src/play/element/global.ts';
const declarationEntries = moduleEntries.filter((entry) => entry !== globalDeclarationEntry);

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
    dts: {entry: declarationEntries},
    sourcemap: true,
  },
  // tsup also splits CJS through Rollup. Keep one core implementation per
  // format so IO-created Score/Note/Rational instances work with the root API.
  // `import.meta.url` is compiled away so worker clients take their
  // documented in-process fallback (guarded by scripts/check-cjs-worker-client.mjs).
  {
    entry: moduleEntries,
    format: ['cjs'],
    tsconfig: 'tsconfig.build.json',
    splitting: true,
    dts: {entry: declarationEntries},
    sourcemap: true,
    define: {'import.meta.url': 'undefined'},
  },
  // Preserve the browser global's reference to the public Element declaration.
  // Bundling its namespace with all entries turns imported type-only aliases
  // into invalid `typeof` values in rollup-plugin-dts's namespace rewriting.
  // This IIFE has one ESM declaration target, not a CommonJS module contract.
  {
    entry: {global: globalDeclarationEntry},
    outDir: 'dist/play/element',
    format: ['esm'],
    tsconfig: 'tsconfig.build.json',
    external: ['./index.js'],
    dts: {only: true},
  },
  // Browser IIFE: <script>-tag bundle registering every play element and the
  // WebMusicScorePlay global. Bundles kernel and sibling capabilities from
  // SOURCE via the repo-level browser tsconfig paths — never from dist.
  {
    entry: {'play/auto': 'src/play/element/auto.ts'},
    format: ['iife'],
    globalName: 'WebMusicScorePlay',
    platform: 'browser',
    tsconfig: '../../scripts/tsconfig.browser-iife.json',
    // Optional SoundFont playback must not add the peer's JS/WASM to every
    // script-tag download. tsup skips its external plugin for IIFEs, so set
    // esbuild's own option. Direct browser users supply an import map for it.
    esbuildOptions(options) {
      options.external = [...(options.external ?? []), 'spessasynth_lib'];
    },
    minify: true,
    sourcemap: true,
  },
]);
