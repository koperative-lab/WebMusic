/**
 * The dependency-safe publish order for the monorepo's five packages: the
 * two foundations first, then the two domain families, and the bridge last
 * (it peer-depends on every other package). This file owns the publish
 * ORDER only; the gate scripts derive their scan lists from
 * `packageDirectories` in scripts/package-policy.mjs.
 */
export const releasePackageNames = Object.freeze([
  '@webmusic/kernel',
  '@webmusic/ui',
  '@webmusic/score',
  '@webmusic/audio',
  '@webmusic/bridge',
]);
