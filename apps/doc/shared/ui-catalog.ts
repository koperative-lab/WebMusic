export type UiCompositionStatus = 'composed' | 'partial' | 'extract' | 'behavior';

export interface UiCompositionEntry {
  family: 'Score';
  capability: 'Play' | 'Analyze' | 'View';
  tag: string;
  headless: string;
  ui: string;
  status: UiCompositionStatus;
  /** The visible presenter is imported from the published @webmusic/ui package. */
  publishedUi?: true;
  href: string;
}

/**
 * The complete visual/behavioral element inventory for the unified docs.
 * This is intentionally explicit: the UI Kit page uses it as a migration
 * ledger while production elements move toward Headless + UI Kit composition.
 */
export const UI_COMPOSITION_CATALOG: readonly UiCompositionEntry[] = [
  {family: 'Score', capability: 'Play', tag: 'score-player', headless: 'ScorePlayer / RackTransportController', ui: '@webmusic/ui transport · seek · preset/rack shell', status: 'composed', publishedUi: true, href: '/score/element/play/score-player/'},
  {family: 'Score', capability: 'Play', tag: 'rack-control', headless: 'Rack', ui: '@webmusic/ui mixer · master/member faders · labels', status: 'composed', publishedUi: true, href: '/score/element/play/rack-control/'},
  {family: 'Score', capability: 'Play', tag: 'rack-part', headless: 'Rack member (score + Sound)', ui: 'Declaration only; renders nothing — documented on the desk it belongs to', status: 'behavior', href: '/score/element/play/rack-control/'},
  {family: 'Score', capability: 'Play', tag: 'score-recorder', headless: 'ScoreRecorderSession + recordedNotesToScore', ui: '@webmusic/ui recorder · record/play/export · status', status: 'composed', publishedUi: true, href: '/score/element/play/note-input/#score-recorder'},
  {family: 'Score', capability: 'Play', tag: 'note-input', headless: 'note-input-model · piano/grid/chord/QWERTY pitch mapping', ui: '@webmusic/ui note surface · presenter-owned pointer/chord/QWERTY interaction', status: 'composed', publishedUi: true, href: '/score/element/play/note-input/'},
  {family: 'Score', capability: 'Play', tag: 'synth-panel', headless: 'LfoController + EqController + SynthPanelAudioGraph + parameter descriptors', ui: '@webmusic/ui section panel · parameter rack · macro rack · envelope · EQ · LFO', status: 'composed', publishedUi: true, href: '/score/element/play/synth-panel/'},

  {family: 'Score', capability: 'View', tag: 'score-view', headless: 'createScoreView + createScoreMap + createPianoRollLayout + player binding', ui: '@webmusic/ui stage · timeline · five score surfaces', status: 'composed', publishedUi: true, href: '/score/element/view/score-view/'},
  {family: 'Score', capability: 'View', tag: 'pitch-view', headless: 'ActiveNoteTracker + pitch projections + player binding', ui: '@webmusic/ui pitch · keyboard/staff/fretboard', status: 'composed', publishedUi: true, href: '/score/element/view/pitch-view/'},
  {family: 'Score', capability: 'View', tag: 'sheet-view', headless: 'OSMD renderer binding + MusicXML serializer', ui: '@webmusic/ui stage · status; optional OSMD engraving surface', status: 'composed', publishedUi: true, href: '/score/element/view/sheet-view/'},

  {family: 'Score', capability: 'Analyze', tag: 'key-analysis', headless: 'AnalysisSession + live trackers + transport reader + key projection', ui: '@webmusic/ui harmony · one analysis surface', status: 'composed', publishedUi: true, href: '/score/element/analyze/key-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'chord-analysis', headless: 'AnalysisSession + live trackers + transport reader + chords projection', ui: '@webmusic/ui harmony · one analysis surface', status: 'composed', publishedUi: true, href: '/score/element/analyze/chord-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'roman-analysis', headless: 'AnalysisSession + live trackers + transport reader + roman projection', ui: '@webmusic/ui harmony · one analysis surface', status: 'composed', publishedUi: true, href: '/score/element/analyze/roman-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'voice-leading-analysis', headless: 'AnalysisSession + live trackers + transport reader + voice-leading projection', ui: '@webmusic/ui harmony · one analysis surface', status: 'composed', publishedUi: true, href: '/score/element/analyze/voice-leading-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'live-chord-analysis', headless: 'AnalysisSession + live trackers + transport reader + live-chord projection', ui: '@webmusic/ui harmony · one analysis surface', status: 'composed', publishedUi: true, href: '/score/element/analyze/live-chord-analysis/'},
] as const;

export const UI_STATUS_LABELS: Readonly<Record<UiCompositionStatus, string>> = {
  composed: 'Composed',
  partial: 'Partial',
  extract: 'Needs headless extraction',
  behavior: 'Behavior only',
};

export const UI_STATUS_DESCRIPTIONS: Readonly<Record<UiCompositionStatus, string>> = {
  composed: 'The Element class routes reusable domain state or algorithms through public Core/Headless APIs, while retaining only instance-specific orchestration.',
  partial: 'A model, presenter or callback boundary exists, but the Element class still owns important state, resources or domain glue.',
  extract: 'The element still couples its domain state or resource lifecycle to the visible UI and needs a reusable Headless owner.',
  behavior: 'The element intentionally exposes behavior and lifecycle without a visible presenter.',
};
