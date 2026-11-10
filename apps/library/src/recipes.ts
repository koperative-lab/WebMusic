// What the library adds to the documentation catalogs: a functional category,
// search synonyms, the define function to call, and how each element takes
// part in a composed app. Tags, families, entries, attributes and summaries
// come from the documentation catalogs (see catalog.ts); a test fails when an
// element is missing here or a recipe names an element that no longer exists.

export type CategoryId =
  | 'playback'
  | 'mixing'
  | 'input'
  | 'sound'
  | 'notation'
  | 'audio-views'
  | 'theory'
  | 'metering';

export interface Category {
  readonly id: CategoryId;
  readonly label: string;
  /** The tag a card shows. */
  readonly short: string;
}

/** Functional groups, in the order an application is usually assembled. */
export const CATEGORIES: readonly Category[] = [
  {id: 'playback', label: 'Playback', short: 'Playback'},
  {id: 'mixing', label: 'Mixing and effects', short: 'Mixing'},
  {id: 'input', label: 'Note input and recording', short: 'Input'},
  {id: 'sound', label: 'Sound design', short: 'Sound'},
  {id: 'notation', label: 'Notation and piano roll', short: 'Notation'},
  {id: 'audio-views', label: 'Waveform and spectrum', short: 'Waveform'},
  {id: 'theory', label: 'Music theory analysis', short: 'Theory'},
  {id: 'metering', label: 'Metering and signal analysis', short: 'Metering'},
];

/**
 * Where an element sits in a composed app.
 *
 * - `score-host` / `audio-host`: the player that owns a domain's transport.
 * - `score-companion` / `audio-companion`: nests inside that player, which
 *   lends it data, state and time (views, analysis, inserts, queues).
 * - `score-free`: works on its own and joins the score player when there is one.
 * - `score-desk` / `score-desk-part`: the Rack desk and a member it declares.
 * - `audio-mix`: a mixer that owns its member players.
 */
export type Slot =
  | 'score-host' | 'score-companion' | 'score-free' | 'score-desk' | 'score-desk-part'
  | 'audio-host' | 'audio-companion' | 'audio-mix';

/** A card's footprint in reel cells: columns wide, rows tall. */
export interface CardSize {
  readonly w: number;
  readonly h: number;
}

export interface Recipe {
  readonly tag: string;
  /** Footprint of the element's card, from how much room the element draws in. */
  readonly size: CardSize;
  readonly category: CategoryId;
  /** Exported define function in the element's public entry. */
  readonly define: string;
  readonly slot: Slot;
  /** Attributes the composed markup writes, in order. Media URLs are filled in by compose. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** Needs authored notation, so the score host loads MusicXML instead of MIDI. */
  readonly notation?: true;
  /**
   * Edits a document the page owns: compose loads one editor of this domain,
   * lends it to the player and every editing view, and marks the views editable.
   */
  readonly editor?: 'score' | 'audio';
  /**
   * Link to the player with `input` as its sibling instead of nesting in it.
   * Score analysis waits for a score when nested (STATUS LIB-01), so it links.
   */
  readonly link?: 'input';
  /** Other elements a composed app adds so this one has something to work with. */
  readonly requires?: readonly string[];
  /** Search synonyms beyond the tag, summary and members. */
  readonly keywords: readonly string[];
}

export const RECIPES: readonly Recipe[] = [
  // Playback
  {tag: 'score-player', size: {w: 3, h: 1}, category: 'playback', define: 'defineScorePlayerElement', slot: 'score-host', attributes: {'time-control': 'full'}, keywords: ['transport', 'play', 'pause', 'seek', 'midi', 'musicxml', 'synth']},
  {tag: 'audio-player', size: {w: 3, h: 1}, category: 'playback', define: 'defineAudioPlayerElement', slot: 'audio-host', attributes: {controls: ''}, keywords: ['transport', 'play', 'pause', 'seek', 'wav', 'mp3', 'recording']},
  {tag: 'audio-playlist', size: {w: 2, h: 2}, category: 'playback', define: 'defineAudioPlaylistElement', slot: 'audio-companion', attributes: {loop: ''}, keywords: ['queue', 'tracks', 'next', 'previous', 'album']},

  // Mixing and effects
  {tag: 'score-rack-control', size: {w: 2, h: 2}, category: 'mixing', define: 'defineRackControlElement', slot: 'score-desk', attributes: {master: '', mute: '', solo: ''}, keywords: ['desk', 'rack', 'fader', 'channels', 'mute', 'solo', 'multitrack']},
  {tag: 'score-rack-part', size: {w: 2, h: 2}, category: 'mixing', define: 'defineRackPartElement', slot: 'score-desk-part', requires: ['score-rack-control'], keywords: ['desk', 'rack', 'channel', 'track', 'member', 'layer']},
  {tag: 'score-effect', size: {w: 2, h: 2}, category: 'mixing', define: 'defineScoreEffectElement', slot: 'score-companion', attributes: {id: 'room', type: 'reverb', seconds: '2', wet: '0.25'}, keywords: ['insert', 'reverb', 'delay', 'filter', 'compressor', 'fx']},
  {tag: 'audio-mixer', size: {w: 2, h: 2}, category: 'mixing', define: 'defineAudioMixerElement', slot: 'audio-mix', attributes: {id: 'mix'}, keywords: ['desk', 'fader', 'channels', 'mute', 'solo', 'multitrack', 'stems']},
  {tag: 'audio-effect', size: {w: 2, h: 2}, category: 'mixing', define: 'defineAudioEffectElement', slot: 'audio-companion', attributes: {id: 'filter', type: 'filter', frequency: '1200'}, keywords: ['insert', 'filter', 'eq', 'reverb', 'delay', 'fx']},

  // Note input and recording
  {tag: 'score-note-input', size: {w: 3, h: 2}, category: 'input', define: 'defineNoteInputElement', slot: 'score-free', attributes: {id: 'keys', layout: 'piano', start: '48', end: '71', keyboard: ''}, keywords: ['keyboard', 'piano', 'pads', 'chords', 'qwerty', 'controller', 'instrument']},
  {tag: 'score-recorder', size: {w: 3, h: 2}, category: 'input', define: 'defineScoreRecorderElement', slot: 'score-free', attributes: {input: '#keys', quantize: '0.25'}, requires: ['score-note-input'], keywords: ['record', 'take', 'capture', 'export', 'midi', 'musicxml']},
  {tag: 'audio-recorder', size: {w: 2, h: 1}, category: 'input', define: 'defineAudioRecorderElement', slot: 'audio-companion', keywords: ['record', 'microphone', 'mic', 'capture', 'take', 'voice']},

  // Sound design
  {tag: 'score-synth-panel', size: {w: 3, h: 2}, category: 'sound', define: 'defineSynthPanelElement', slot: 'score-free', attributes: {sections: 'sound,envelope'}, keywords: ['synth', 'knobs', 'envelope', 'adsr', 'eq', 'lfo', 'macros', 'oscillator', 'patch']},

  // Notation and piano roll
  {tag: 'score-view', size: {w: 4, h: 2}, category: 'notation', define: 'defineScoreViewElement', slot: 'score-companion', attributes: {type: 'staff'}, notation: true, keywords: ['piano roll', 'staff', 'waterfall', 'visualizer', 'notes']},
  {tag: 'score-sheet-view', size: {w: 5, h: 4}, category: 'notation', define: 'defineSheetViewElement', slot: 'score-companion', attributes: {layout: 'flow'}, notation: true, editor: 'score', keywords: ['sheet music', 'engraving', 'notation', 'editor', 'staff', 'pages']},
  {tag: 'score-grid-view', size: {w: 5, h: 4}, category: 'notation', define: 'defineScoreGridViewElement', slot: 'score-companion', editor: 'score', keywords: ['piano roll', 'daw', 'grid', 'editor', 'velocity', 'midi']},
  {tag: 'score-pitch-view', size: {w: 3, h: 1}, category: 'notation', define: 'definePitchViewElement', slot: 'score-companion', attributes: {type: 'keyboard', low: '48', high: '84', 'fit-to-width': 'true'}, keywords: ['keyboard', 'fretboard', 'guitar', 'staff', 'active notes', 'piano']},

  // Waveform and spectrum
  {tag: 'audio-view', size: {w: 4, h: 2}, category: 'audio-views', define: 'defineAudioViewElement', slot: 'audio-companion', attributes: {type: 'waveform', interactive: ''}, keywords: ['waveform', 'spectrogram', 'peaks', 'scrub', 'timeline']},
  {tag: 'audio-clip-view', size: {w: 5, h: 2}, category: 'audio-views', define: 'defineAudioClipViewElement', slot: 'audio-companion', editor: 'audio', keywords: ['waveform', 'editor', 'fade', 'gain', 'markers', 'cut']},
  {tag: 'audio-live-view', size: {w: 3, h: 2}, category: 'audio-views', define: 'defineAudioLiveViewElement', slot: 'audio-companion', attributes: {type: 'spectrogram'}, keywords: ['live', 'scrolling', 'spectrogram', 'waveform', 'analyser']},

  // Music theory analysis
  {tag: 'score-chord-analysis', size: {w: 4, h: 1}, category: 'theory', define: 'defineChordAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1'}, keywords: ['harmony', 'chords', 'roman numerals', 'key']},
  {tag: 'score-interval-analysis', size: {w: 4, h: 1}, category: 'theory', define: 'defineIntervalAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1'}, keywords: ['intervals', 'melody', 'harmony', 'distance']},
  {tag: 'score-scale-analysis', size: {w: 4, h: 1}, category: 'theory', define: 'defineScaleAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1', tonic: 'E', scale: 'major'}, keywords: ['scale', 'degrees', 'key', 'tonic', 'mode']},
  {tag: 'score-rhythm-analysis', size: {w: 4, h: 1}, category: 'theory', define: 'defineRhythmAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1'}, keywords: ['rhythm', 'meter', 'beats', 'attacks', 'groove']},

  // Metering and signal analysis
  {tag: 'audio-meter', size: {w: 2, h: 2}, category: 'metering', define: 'defineAudioMeterElement', slot: 'audio-companion', keywords: ['vu', 'loudness', 'level', 'stereo', 'spectrum', 'oscilloscope']},
  {tag: 'audio-level-analyzer', size: {w: 2, h: 2}, category: 'metering', define: 'defineAudioLevelAnalyzerElement', slot: 'audio-companion', keywords: ['rms', 'peak', 'crest', 'dynamics', 'loudness', 'level']},
  {tag: 'audio-oscilloscope', size: {w: 2, h: 2}, category: 'metering', define: 'defineAudioOscilloscopeElement', slot: 'audio-companion', keywords: ['scope', 'waveform', 'trigger', 'timebase']},
  {tag: 'audio-spectrum-analyzer', size: {w: 2, h: 2}, category: 'metering', define: 'defineAudioSpectrumAnalyzerElement', slot: 'audio-companion', keywords: ['fft', 'frequency', 'spectrum', 'eq', 'peak hold']},
  {tag: 'audio-transient-analyzer', size: {w: 2, h: 2}, category: 'metering', define: 'defineAudioTransientAnalyzerElement', slot: 'audio-companion', keywords: ['onsets', 'attacks', 'beats', 'transients', 'drums']},
];
