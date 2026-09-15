// ============================================================================
// Dist-layout anchor for the default analysis worker.
//
// This module is deliberately its own build entry: esbuild never merges entry
// modules into shared chunks, so after bundling this file always sits at
// `dist/analyze/worker-url.js`, next to `dist/analyze/worker.js`. Modules that
// can be hoisted into shared chunks (like the headless worker client) must
// not call `new URL('./worker.js', import.meta.url)` themselves — a chunk's
// `import.meta.url` points at the chunk's location, not at this directory.
// ============================================================================

/**
 * Spawn the bundled default analysis module worker, or return `undefined`
 * where that is impossible: no `Worker` global, the CommonJS build (where
 * `import.meta.url` is compiled away), CSP restrictions, or a missing asset.
 */
export function spawnDefaultAnalysisWorker(): Worker | undefined {
  if (typeof Worker === 'undefined' || typeof import.meta.url !== 'string') {
    return undefined;
  }
  try {
    return new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  } catch {
    // CSP, a missing worker asset, or unsupported module Workers should not
    // make the zero-configuration API fail synchronously.
    return undefined;
  }
}
