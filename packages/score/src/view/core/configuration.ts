import type {ScoreViewConfiguration, ScoreViewType, VisualizerRenderOptions} from './types';

const commonKeys: ReadonlyArray<keyof VisualizerRenderOptions> = [
  'noteHeight', 'noteSpacing', 'pixelsPerSecond', 'noteRGB', 'activeNoteRGB',
  'minPitch', 'maxPitch', 'virtualization', 'noteColor', 'activeNoteColor', 'showAnnotations',
];

const modeKeys: Record<ScoreViewType, readonly string[]> = {
  'piano-roll': commonKeys,
  staff: [...commonKeys, 'defaultKey', 'instruments', 'scrollType', 'splitStaves'],
  waterfall: [
    ...commonKeys, 'whiteNoteWidth',
    'blackNoteWidth', 'showOnlyOctavesUsed',
  ],
};

/**
 * Validate mode/option compatibility before replacing a view configuration.
 * Throws TypeError for an unknown mode, malformed options or unsupported key.
 * Renderer-specific value defaults and ranges remain owned by each renderer.
 */
export function validateScoreViewConfiguration(value: ScoreViewConfiguration): void {
  if (!value || typeof value !== 'object') throw new TypeError('A score view configuration is required.');
  const {type, options} = value as {type?: unknown; options?: unknown};
  if (type !== 'piano-roll' && type !== 'staff' && type !== 'waterfall') {
    throw new TypeError(`Unknown score view type: ${String(type)}.`);
  }
  if (options === undefined) return;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Score view options must be an object.');
  }
  for (const key of Object.keys(options)) {
    if (!modeKeys[type].includes(key)) {
      throw new TypeError(`Option "${key}" is not supported by score view type "${type}".`);
    }
  }
}
