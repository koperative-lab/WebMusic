export type UiCompositionStatus = 'composed' | 'partial' | 'extract' | 'behavior';

export interface UiCompositionEntry {
  family: 'Score' | 'Audio';
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
  {family: 'Score', capability: 'Play', tag: 'score-rack-control', headless: 'Rack', ui: '@webmusic/ui mixer · master/member faders · labels', status: 'composed', publishedUi: true, href: '/score/element/play/score-rack-control/'},
  {family: 'Score', capability: 'Play', tag: 'score-rack-part', headless: 'Rack member (score + Sound)', ui: 'Declaration only; renders nothing — documented on the desk it belongs to', status: 'behavior', href: '/score/element/play/score-rack-control/'},
  {family: 'Score', capability: 'Play', tag: 'score-recorder', headless: 'ScoreRecorderSession + recordedNotesToScore', ui: '@webmusic/ui recorder · record/play/export · status', status: 'composed', publishedUi: true, href: '/score/element/play/score-recorder/'},
  {family: 'Score', capability: 'Play', tag: 'score-note-input', headless: 'note-input-model · piano/grid/chord/QWERTY pitch mapping', ui: '@webmusic/ui note surface · presenter-owned pointer/chord/QWERTY interaction', status: 'composed', publishedUi: true, href: '/score/element/play/score-note-input/'},
  {family: 'Score', capability: 'Play', tag: 'score-synth-panel', headless: 'LfoController + EqController + SynthPanelAudioGraph + parameter descriptors', ui: '@webmusic/ui section panel · parameter rack · macro rack · envelope · EQ · LFO', status: 'composed', publishedUi: true, href: '/score/element/play/score-synth-panel/'},

  {family: 'Score', capability: 'View', tag: 'score-view', headless: 'createScoreView + createScoreMap + createPianoRollLayout + player binding', ui: '@webmusic/ui stage · timeline · five score surfaces', status: 'composed', publishedUi: true, href: '/score/element/view/score-view/'},
  {family: 'Score', capability: 'View', tag: 'score-pitch-view', headless: 'ActiveNoteTracker + pitch projections + player binding', ui: '@webmusic/ui pitch · keyboard/staff/fretboard', status: 'composed', publishedUi: true, href: '/score/element/view/score-pitch-view/'},
  {family: 'Score', capability: 'View', tag: 'score-sheet-view', headless: 'OSMD renderer binding + MusicXML serializer', ui: '@webmusic/ui stage · status; optional OSMD engraving surface', status: 'composed', publishedUi: true, href: '/score/element/view/score-sheet-view/'},

  {family: 'Score', capability: 'Analyze', tag: 'score-chord-analysis', headless: 'inspectScoreChords or held-note inspection + explicit key context', ui: '@webmusic/ui harmony · chord lane or current nameplate', status: 'composed', publishedUi: true, href: '/score/element/analyze/score-chord-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'score-interval-analysis', headless: 'analyzeIntervals + written/sounding pitch evidence', ui: '@webmusic/ui harmony · interval lane', status: 'composed', publishedUi: true, href: '/score/element/analyze/score-interval-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'score-scale-analysis', headless: 'inspectScale + explicit tonic and scale form', ui: '@webmusic/ui harmony · scale degree lane', status: 'composed', publishedUi: true, href: '/score/element/analyze/score-scale-analysis/'},
  {family: 'Score', capability: 'Analyze', tag: 'score-rhythm-analysis', headless: 'inspectScoreRhythm + explicit meter grouping', ui: '@webmusic/ui harmony · grouped rhythm lane', status: 'composed', publishedUi: true, href: '/score/element/analyze/score-rhythm-analysis/'},

  {family: 'Audio', capability: 'Play', tag: 'audio-player', headless: 'AudioPlayer + selected clip/queue/mix backend', ui: '@webmusic/ui transport · seek · time · status', status: 'composed', publishedUi: true, href: '/audio/element/play/audio-player/'},
  {family: 'Audio', capability: 'Play', tag: 'audio-playlist', headless: 'AudioPlaylist', ui: '@webmusic/ui playlist · queue selection · per-entry state', status: 'composed', publishedUi: true, href: '/audio/element/play/audio-playlist/'},
  {family: 'Audio', capability: 'Play', tag: 'audio-mixer', headless: 'AudioMixer', ui: '@webmusic/ui mixer · master/member strips · mute/solo', status: 'composed', publishedUi: true, href: '/audio/element/play/audio-mixer/'},
  {family: 'Audio', capability: 'Play', tag: 'audio-recorder', headless: 'AudioRecorder', ui: '@webmusic/ui recorder · record · live meter · status', status: 'composed', publishedUi: true, href: '/audio/element/play/audio-recorder/'},
  {family: 'Audio', capability: 'View', tag: 'audio-view', headless: 'AudioTimeline + renderer binding', ui: '@webmusic/ui stage · SurfaceSlider · status; waveform/spectrogram/meter surface', status: 'composed', publishedUi: true, href: '/audio/element/view/audio-view/'},
  {family: 'Audio', capability: 'View', tag: 'audio-live-view', headless: 'LiveViewController + LiveScrollBuffer over a borrowed analyser', ui: '@webmusic/ui CanvasStage · RAF/DPR/status; live render adapter', status: 'composed', publishedUi: true, href: '/audio/element/view/audio-live-view/'},
  {family: 'Audio', capability: 'Analyze', tag: 'audio-level-analyzer', headless: 'createRealtimeAnalyzer + borrowed player analyser', ui: '@webmusic/ui level-analyzer · sampled dynamics · threshold · freeze', status: 'composed', publishedUi: true, href: '/audio/element/analyze/audio-level-analyzer/'},
  {family: 'Audio', capability: 'Analyze', tag: 'audio-meter', headless: 'AudioMeterController + AudioMeterDisplay over an owned/borrowed analyser', ui: '@webmusic/ui stage · VU, loudness, waveform, oscilloscope, spectrum, spectrogram and stereometer painters', status: 'composed', publishedUi: true, href: '/audio/element/analyze/audio-meter/'},
  {family: 'Audio', capability: 'Analyze', tag: 'audio-oscilloscope', headless: 'createRealtimeAnalyzer + borrowed player analyser', ui: '@webmusic/ui oscilloscope · trigger · timebase · freeze · probe', status: 'composed', publishedUi: true, href: '/audio/element/analyze/audio-oscilloscope/'},
  {family: 'Audio', capability: 'Analyze', tag: 'audio-spectrum-analyzer', headless: 'createRealtimeAnalyzer + borrowed player analyser', ui: '@webmusic/ui spectrum-analyzer · log FFT · frequency probe · peak hold', status: 'composed', publishedUi: true, href: '/audio/element/analyze/audio-spectrum-analyzer/'},
  {family: 'Audio', capability: 'Analyze', tag: 'audio-transient-analyzer', headless: 'createTransientDetector + borrowed player analyser', ui: '@webmusic/ui transient-analyzer · attack strength · threshold · freeze', status: 'composed', publishedUi: true, href: '/audio/element/analyze/audio-transient-analyzer/'},
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
