/**
 * Reviewed Headless + UI Kit contract for the public Score and Audio
 * Web Components. Keep this list explicit: adding an element is an
 * architecture decision, not something a directory glob should approve.
 *
 * `ui` names the published presenter subpaths the element is expected to
 * reach through static runtime imports. The union of the reviewed
 * closures is checked against the public `@webmusic/ui` subpaths in
 * package-policy.mjs. Behavior-only elements deliberately have no visible
 * presenter.
 */
export const elementCompositionPolicy = Object.freeze([
  entry('Score', 'Play', 'score-player', 'packages/score/src/play/element/score-player.ts', ['transport']),
  entry('Score', 'Play', 'score-rack-control', 'packages/score/src/play/element/score-rack-control.ts', ['mixer']),
  // Declaration only: it renders nothing, so it has no presenter to reach.
  entry('Score', 'Play', 'score-rack-part', 'packages/score/src/play/element/score-rack-part.ts', [], true),
  entry('Score', 'Play', 'score-recorder', 'packages/score/src/play/element/score-recorder.ts', ['recorder']),
  entry('Score', 'Play', 'score-note-input', 'packages/score/src/play/element/score-note-input.ts', ['note']),
  entry('Score', 'Play', 'score-synth-panel', 'packages/score/src/play/element/score-synth-panel.ts', ['panel', 'parameter', 'macro', 'envelope', 'eq', 'lfo']),

  entry('Score', 'Analyze', 'score-chord-analysis', 'packages/score/src/analyze/element/score-chord-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'score-interval-analysis', 'packages/score/src/analyze/element/score-interval-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'score-scale-analysis', 'packages/score/src/analyze/element/score-scale-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'score-rhythm-analysis', 'packages/score/src/analyze/element/score-rhythm-analysis.ts', ['analysis', 'harmony', 'workbench']),

  entry('Score', 'View', 'score-view', 'packages/score/src/view/element/score-view.ts', ['stage', 'timeline', 'status']),
  entry('Score', 'View', 'score-sheet-view', 'packages/score/src/view/element/score-sheet-view.ts', ['stage', 'status']),
  entry('Score', 'View', 'score-pitch-view', 'packages/score/src/view/element/score-pitch-view.ts', ['pitch']),

  entry('Audio', 'Play', 'audio-player', 'packages/audio/src/play/element/audio-player.ts', ['transport']),
  entry('Audio', 'Play', 'audio-playlist', 'packages/audio/src/play/element/audio-playlist.ts', ['playlist']),
  entry('Audio', 'Play', 'audio-mixer', 'packages/audio/src/play/element/audio-mixer.ts', ['mixer']),
  entry('Audio', 'Play', 'audio-recorder', 'packages/audio/src/play/element/audio-recorder.ts', ['recorder']),
  entry('Audio', 'Analyze', 'audio-level-analyzer', 'packages/audio/src/analyze/element/audio-level-analyzer.ts', ['level-analyzer']),
  entry('Audio', 'Analyze', 'audio-meter', 'packages/audio/src/analyze/element/audio-meter.ts', ['stage']),
  entry('Audio', 'Analyze', 'audio-oscilloscope', 'packages/audio/src/analyze/element/audio-oscilloscope.ts', ['oscilloscope']),
  entry('Audio', 'Analyze', 'audio-spectrum-analyzer', 'packages/audio/src/analyze/element/audio-spectrum-analyzer.ts', ['spectrum-analyzer']),
  entry('Audio', 'Analyze', 'audio-transient-analyzer', 'packages/audio/src/analyze/element/audio-transient-analyzer.ts', ['transient-analyzer']),

  entry('Audio', 'View', 'audio-view', 'packages/audio/src/view/element/audio-view.ts', ['stage', 'status', 'meter']),
  entry('Audio', 'View', 'audio-live-view', 'packages/audio/src/view/element/audio-live-view.ts', ['stage']),
]);

/** Main presenters available without a domain Element consumer. */
export const standaloneUiPresenters = Object.freeze(['minimap', 'playlist', 'meter', 'track-list']);

function entry(family, capability, tag, source, ui, behaviorOnly = false) {
  return Object.freeze({family, capability, tag, source, ui: Object.freeze(ui), behaviorOnly});
}
