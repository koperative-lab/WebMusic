/**
 * Reviewed Headless + UI Kit contract for the public Score
 * Web Components. Keep this list explicit: adding an element is an
 * architecture decision, not something a directory glob should approve.
 *
 * `ui` names the published presenter subpaths the element is expected to
 * reach through static runtime imports. The union of the reviewed
 * closures plus the standalone presenters below must equal the public
 * `@webmusic/ui` subpaths in package-policy.mjs. Behavior-only elements
 * deliberately have no visible presenter.
 */
export const elementCompositionPolicy = Object.freeze([
  entry('Score', 'Play', 'score-player', 'packages/score/src/play/element/score-player.ts', ['transport']),
  entry('Score', 'Play', 'rack-control', 'packages/score/src/play/element/rack-control.ts', ['mixer']),
  // Declaration only: it renders nothing, so it has no presenter to reach.
  entry('Score', 'Play', 'rack-part', 'packages/score/src/play/element/rack-part.ts', [], true),
  entry('Score', 'Play', 'score-recorder', 'packages/score/src/play/element/score-recorder.ts', ['recorder']),
  entry('Score', 'Play', 'note-input', 'packages/score/src/play/element/note-input.ts', ['note']),
  entry('Score', 'Play', 'synth-panel', 'packages/score/src/play/element/synth-panel.ts', ['panel', 'parameter', 'macro', 'envelope', 'eq', 'lfo']),

  entry('Score', 'Analyze', 'key-analysis', 'packages/score/src/analyze/element/key-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'chord-analysis', 'packages/score/src/analyze/element/chord-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'roman-analysis', 'packages/score/src/analyze/element/roman-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'voice-leading-analysis', 'packages/score/src/analyze/element/voice-leading-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'live-chord-analysis', 'packages/score/src/analyze/element/live-chord-analysis.ts', ['analysis', 'harmony', 'workbench']),

  entry('Score', 'View', 'score-view', 'packages/score/src/view/element/score-view.ts', ['stage', 'timeline', 'status']),
  entry('Score', 'View', 'sheet-view', 'packages/score/src/view/element/sheet-view.ts', ['stage', 'status']),
  entry('Score', 'View', 'pitch-view', 'packages/score/src/view/element/pitch-view.ts', ['pitch']),
]);

/** Public presenters retained for custom composition without a Score Element. */
export const standaloneUiPresenters = Object.freeze(['minimap', 'playlist', 'meter', 'track-list']);

function entry(family, capability, tag, source, ui, behaviorOnly = false) {
  return Object.freeze({family, capability, tag, source, ui: Object.freeze(ui), behaviorOnly});
}
