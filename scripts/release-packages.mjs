/**
 * Dependency-safe first-release order: Kernel and UI Kit, then Score.
 * Gate scripts derive their scan lists from packageDirectories in
 * scripts/package-policy.mjs; architecture checks reconcile both lists.
 */
export const releasePackageNames = Object.freeze([
  '@webmusic/kernel',
  '@webmusic/ui',
  '@webmusic/score',
]);
