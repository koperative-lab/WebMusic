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

/**
 * How a card sizes to its element. `content`: the element has its own width
 * (faders, knobs, keys, a scope), so the card takes that width. `fill`: the
 * element stretches to whatever width it gets (a transport, a staff, a lane);
 * `width` is the least it needs and packing gives it the free span where it
 * lands. Either way the card is as tall as the element's picture. `height`,
 * and a content element's `width`, are used until its picture is drawn.
 */
export interface CardPreview {
  readonly fit: 'content' | 'fill';
  readonly width: number;
  readonly height: number;
}

export interface Recipe {
  readonly tag: string;
  /** How the element's card sizes to it on the home page. */
  readonly preview: CardPreview;
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
  /**
   * What the home page pictures, when the element draws nothing itself: a
   * selector inside its composition (an insert shows the panel on its
   * parameters, a Rack part the desk it adds a channel to).
   */
  readonly picture?: string;
  /** Other elements a composed app adds so this one has something to work with. */
  readonly requires?: readonly string[];
  /** Search synonyms beyond the tag, summary and members. */
  readonly keywords: readonly string[];
}

export const RECIPES: readonly Recipe[] = [
  // Playback
  {tag: 'score-player', preview: {fit: 'fill', width: 360, height: 78}, category: 'playback', define: 'defineScorePlayerElement', slot: 'score-host', attributes: {'time-control': 'full'}, keywords: ['transport', 'play', 'pause', 'seek', 'midi', 'musicxml', 'synth']},
  {tag: 'audio-player', preview: {fit: 'fill', width: 360, height: 66}, category: 'playback', define: 'defineAudioPlayerElement', slot: 'audio-host', attributes: {controls: ''}, keywords: ['transport', 'play', 'pause', 'seek', 'wav', 'mp3', 'recording']},
  {tag: 'audio-playlist', preview: {fit: 'content', width: 240, height: 72}, category: 'playback', define: 'defineAudioPlaylistElement', slot: 'audio-companion', attributes: {loop: ''}, keywords: ['queue', 'tracks', 'next', 'previous', 'album']},

  // Mixing and effects
  {tag: 'score-rack-control', preview: {fit: 'content', width: 260, height: 209}, category: 'mixing', define: 'defineRackControlElement', slot: 'score-desk', attributes: {master: '', mute: '', solo: ''}, keywords: ['desk', 'rack', 'fader', 'channels', 'mute', 'solo', 'multitrack']},
  {tag: 'score-rack-part', preview: {fit: 'content', width: 260, height: 209}, category: 'mixing', define: 'defineRackPartElement', slot: 'score-desk-part', picture: 'score-rack-control', requires: ['score-rack-control'], keywords: ['desk', 'rack', 'channel', 'track', 'member', 'layer']},
  {tag: 'score-effect', preview: {fit: 'content', width: 190, height: 141}, category: 'mixing', define: 'defineScoreEffectElement', slot: 'score-companion', picture: 'score-synth-panel', attributes: {id: 'room', type: 'reverb', seconds: '2', wet: '0.25'}, keywords: ['insert', 'reverb', 'delay', 'filter', 'compressor', 'fx']},
  {tag: 'audio-mixer', preview: {fit: 'content', width: 260, height: 240}, category: 'mixing', define: 'defineAudioMixerElement', slot: 'audio-mix', attributes: {id: 'mix'}, keywords: ['desk', 'fader', 'channels', 'mute', 'solo', 'multitrack', 'stems']},
  {tag: 'audio-effect', preview: {fit: 'content', width: 270, height: 141}, category: 'mixing', define: 'defineAudioEffectElement', slot: 'audio-companion', picture: 'score-synth-panel', attributes: {id: 'filter', type: 'filter', frequency: '1200'}, keywords: ['insert', 'filter', 'eq', 'reverb', 'delay', 'fx']},

  // Note input and recording
  {tag: 'score-note-input', preview: {fit: 'content', width: 370, height: 187}, category: 'input', define: 'defineNoteInputElement', slot: 'score-free', attributes: {id: 'keys', layout: 'piano', start: '48', end: '71', keyboard: ''}, keywords: ['keyboard', 'piano', 'pads', 'chords', 'qwerty', 'controller', 'instrument']},
  {tag: 'score-recorder', preview: {fit: 'content', width: 370, height: 231}, category: 'input', define: 'defineScoreRecorderElement', slot: 'score-free', attributes: {input: '#keys', quantize: '0.25'}, requires: ['score-note-input'], keywords: ['record', 'take', 'capture', 'export', 'midi', 'musicxml']},
  {tag: 'audio-recorder', preview: {fit: 'fill', width: 240, height: 48}, category: 'input', define: 'defineAudioRecorderElement', slot: 'audio-companion', keywords: ['record', 'microphone', 'mic', 'capture', 'take', 'voice']},

  // Sound design
  {tag: 'score-synth-panel', preview: {fit: 'content', width: 260, height: 266}, category: 'sound', define: 'defineSynthPanelElement', slot: 'score-companion', attributes: {sections: 'sound,envelope'}, keywords: ['synth', 'knobs', 'envelope', 'adsr', 'eq', 'lfo', 'macros', 'oscillator', 'patch']},

  // Notation and piano roll
  {tag: 'score-view', preview: {fit: 'fill', width: 480, height: 277}, category: 'notation', define: 'defineScoreViewElement', slot: 'score-companion', attributes: {type: 'staff'}, notation: true, keywords: ['piano roll', 'staff', 'waterfall', 'visualizer', 'notes']},
  {tag: 'score-sheet-view', preview: {fit: 'fill', width: 640, height: 660}, category: 'notation', define: 'defineSheetViewElement', slot: 'score-companion', attributes: {layout: 'flow'}, notation: true, editor: 'score', keywords: ['sheet music', 'engraving', 'notation', 'editor', 'staff', 'pages']},
  {tag: 'score-grid-view', preview: {fit: 'fill', width: 640, height: 540}, category: 'notation', define: 'defineScoreGridViewElement', slot: 'score-companion', editor: 'score', keywords: ['piano roll', 'daw', 'grid', 'editor', 'velocity', 'midi']},
  {tag: 'score-pitch-view', preview: {fit: 'fill', width: 360, height: 120}, category: 'notation', define: 'definePitchViewElement', slot: 'score-companion', attributes: {type: 'keyboard', low: '48', high: '84', 'fit-to-width': 'true'}, keywords: ['keyboard', 'fretboard', 'guitar', 'staff', 'active notes', 'piano']},

  // Waveform and spectrum
  {tag: 'audio-view', preview: {fit: 'fill', width: 480, height: 164}, category: 'audio-views', define: 'defineAudioViewElement', slot: 'audio-companion', attributes: {type: 'waveform', interactive: ''}, keywords: ['waveform', 'spectrogram', 'peaks', 'scrub', 'timeline']},
  {tag: 'audio-clip-view', preview: {fit: 'fill', width: 640, height: 252}, category: 'audio-views', define: 'defineAudioClipViewElement', slot: 'audio-companion', editor: 'audio', keywords: ['waveform', 'editor', 'fade', 'gain', 'markers', 'cut']},
  {tag: 'audio-live-view', preview: {fit: 'fill', width: 360, height: 76}, category: 'audio-views', define: 'defineAudioLiveViewElement', slot: 'audio-companion', attributes: {type: 'spectrogram'}, keywords: ['live', 'scrolling', 'spectrogram', 'waveform', 'analyser']},

  // Music theory analysis
  {tag: 'score-chord-analysis', preview: {fit: 'fill', width: 480, height: 165}, category: 'theory', define: 'defineChordAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1'}, keywords: ['harmony', 'chords', 'roman numerals', 'key']},
  {tag: 'score-interval-analysis', preview: {fit: 'fill', width: 480, height: 217}, category: 'theory', define: 'defineIntervalAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1'}, keywords: ['intervals', 'melody', 'harmony', 'distance']},
  {tag: 'score-scale-analysis', preview: {fit: 'fill', width: 480, height: 173}, category: 'theory', define: 'defineScaleAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1', tonic: 'E', scale: 'major'}, keywords: ['scale', 'degrees', 'key', 'tonic', 'mode']},
  {tag: 'score-rhythm-analysis', preview: {fit: 'fill', width: 480, height: 173}, category: 'theory', define: 'defineRhythmAnalysisElement', slot: 'score-companion', link: 'input', attributes: {window: '1'}, keywords: ['rhythm', 'meter', 'beats', 'attacks', 'groove']},

  // Metering and signal analysis
  {tag: 'audio-meter', preview: {fit: 'content', width: 390, height: 160}, category: 'metering', define: 'defineAudioMeterElement', slot: 'audio-companion', keywords: ['vu', 'loudness', 'level', 'stereo', 'spectrum', 'oscilloscope']},
  {tag: 'audio-level-analyzer', preview: {fit: 'content', width: 320, height: 236}, category: 'metering', define: 'defineAudioLevelAnalyzerElement', slot: 'audio-companion', keywords: ['rms', 'peak', 'crest', 'dynamics', 'loudness', 'level']},
  {tag: 'audio-oscilloscope', preview: {fit: 'content', width: 570, height: 261}, category: 'metering', define: 'defineAudioOscilloscopeElement', slot: 'audio-companion', keywords: ['scope', 'waveform', 'trigger', 'timebase']},
  {tag: 'audio-spectrum-analyzer', preview: {fit: 'content', width: 470, height: 261}, category: 'metering', define: 'defineAudioSpectrumAnalyzerElement', slot: 'audio-companion', keywords: ['fft', 'frequency', 'spectrum', 'eq', 'peak hold']},
  {tag: 'audio-transient-analyzer', preview: {fit: 'content', width: 300, height: 222}, category: 'metering', define: 'defineAudioTransientAnalyzerElement', slot: 'audio-companion', keywords: ['onsets', 'attacks', 'beats', 'transients', 'drums']},
];
