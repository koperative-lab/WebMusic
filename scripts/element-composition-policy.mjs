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
  entry('Score', 'Edit', 'score-document', 'packages/score/src/edit/element/score-document.ts', [], true),
  entry('Score', 'Play', 'score-player', 'packages/score/src/play/element/score-player.ts', ['transport']),
  entry('Score', 'Play', 'score-rack-control', 'packages/score/src/play/element/score-rack-control.ts', ['mixer']),
  // Declaration only: it renders nothing, so it has no presenter to reach.
  entry('Score', 'Play', 'score-rack-part', 'packages/score/src/play/element/score-rack-part.ts', [], true),
  entry('Score', 'Play', 'score-recorder', 'packages/score/src/play/element/score-recorder.ts', ['recorder']),
  entry('Score', 'Play', 'score-note-input', 'packages/score/src/play/element/score-note-input.ts', ['note']),
  entry('Score', 'Play', 'score-synth-panel', 'packages/score/src/play/element/score-synth-panel.ts', ['panel', 'parameter', 'macro', 'envelope', 'eq', 'lfo']),

  entry('Score', 'Analyze', 'score-chord-analysis', 'packages/score/src/analyze/element/score-chord-analysis.ts', ['analysis', 'harmony', 'workbench']),
  entry('Score', 'Analyze', 'score-live-chord-analysis', 'packages/score/src/analyze/element/score-live-chord-analysis.ts', ['analysis', 'harmony', 'workbench']),

  entry('Score', 'View', 'score-view', 'packages/score/src/view/element/score-view.ts', ['stage', 'timeline', 'status']),
  entry('Score', 'View', 'score-sheet-view', 'packages/score/src/view/element/score-sheet-view.ts', ['stage', 'status']),
  entry('Score', 'View', 'score-pitch-view', 'packages/score/src/view/element/score-pitch-view.ts', ['pitch']),

  entry('Audio', 'Edit', 'audio-document', 'packages/audio/src/edit/element/audio-document.ts', [], true),
  entry('Audio', 'Play', 'audio-player', 'packages/audio/src/play/element/audio-player.ts', ['transport']),
  entry('Audio', 'Play', 'audio-playlist', 'packages/audio/src/play/element/audio-playlist.ts', ['playlist']),
  entry('Audio', 'Play', 'audio-mixer', 'packages/audio/src/play/element/audio-mixer.ts', ['mixer']),
  entry('Audio', 'Play', 'audio-recorder', 'packages/audio/src/play/element/audio-recorder.ts', ['recorder']),
  entry('Audio', 'Analyze', 'audio-level-analyzer', 'packages/audio/src/analyze/element/audio-level-analyzer.ts', ['level-analyzer']),
  entry('Audio', 'Analyze', 'audio-meter', 'packages/audio/src/analyze/element/audio-meter.ts', ['meter']),
  entry('Audio', 'Analyze', 'audio-oscilloscope', 'packages/audio/src/analyze/element/audio-oscilloscope.ts', ['oscilloscope']),
  entry('Audio', 'Analyze', 'audio-spectrum-analyzer', 'packages/audio/src/analyze/element/audio-spectrum-analyzer.ts', ['spectrum-analyzer']),
  entry('Audio', 'Analyze', 'audio-transient-analyzer', 'packages/audio/src/analyze/element/audio-transient-analyzer.ts', ['transient-analyzer']),

  entry('Audio', 'View', 'audio-view', 'packages/audio/src/view/element/audio-view.ts', ['stage', 'status', 'meter']),
  entry('Audio', 'View', 'audio-live-view', 'packages/audio/src/view/element/audio-live-view.ts', ['stage']),
]);

/** Main presenters available without a domain Element consumer. */
export const standaloneUiPresenters = Object.freeze(['minimap', 'playlist', 'meter', 'track-list']);

/**
 * Musical editing surfaces own their focus entry and keyboard interpretation.
 * Staff entry, piano-roll editing and waveform ranges are not stage sliders. Exempt
 * only this literal write at this reviewed owner; slider/value ARIA and any
 * other tabindex owner are still checked across the complete closure.
 */
export function sourceWithoutOwnedFocusWrite(tag, source, text) {
  if (tag === 'score-view' && source === 'packages/score/src/view/render/staff-editor.ts') {
    return text.replace("surface.setAttribute('tabindex', '0');", '');
  }
  // Editing surfaces leave the tab order while read-only; each removal is the
  // same owner withdrawing its own focus entry, never a second ARIA owner.
  if (tag === 'audio-view' && source === 'packages/audio/src/view/render/waveform-editor.ts') {
    return text.replace("surface.setAttribute('tabindex', '0');", '').replace("surface.removeAttribute('tabindex');", '');
  }
  if (tag !== 'score-view' || source !== 'packages/score/src/view/render/piano-roll-editor.ts') return text;
  return text.replace("svg.setAttribute('tabindex', '0');", '').replace("svg.removeAttribute('tabindex');", '');
}

function entry(family, capability, tag, source, ui, behaviorOnly = false) {
  return Object.freeze({family, capability, tag, source, ui: Object.freeze(ui), behaviorOnly});
}
