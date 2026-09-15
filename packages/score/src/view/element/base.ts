// Re-export seam: the implementation lives in the shared kernel and is
// resolved at runtime from the @webmusic/kernel peer (the build
// externalizes it, so every package shares one kernel instance).
export type {ElementCleanup} from '@webmusic/kernel/element';
export {
  HTMLElementBase,
  WebMusicElement,
  upgradeProperty,
  upgradeProperties,
  numAttr,
  boolAttr,
  cssSizeAttr,
  defineOnce,
} from '@webmusic/kernel/element';
