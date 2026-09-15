/**
 * The publish order is a public release dependency order across all four
 * workspace roots: the platform kernel first, then the score family, then the
 * audio family, then the score-audio bridge last. Release-oriented scripts
 * import this list instead of maintaining their own copies.
 */
export const releasePackageNames = Object.freeze([
  '@webmusic/kernel',
  '@webscore/core',
  '@webscore/io',
  '@webscore/play',
  '@webscore/analyze',
  '@webscore/view',
  '@webscore/react',
  '@webaudio/core',
  '@webaudio/play',
  '@webaudio/analyze',
  '@webaudio/view',
  '@webaudio/react',
  '@webmusic/score-audio',
]);
