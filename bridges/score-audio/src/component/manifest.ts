// Component manifests (DEC-081): what a host needs to place a component in a
// graph — its ports, its parameters and how it takes the size of its box —
// so Studio, `mountComponent` and an app place every component the same way,
// with no code for one component's kind.
//
// A code-authored component (one of the packages' Components) declares its
// manifest here, beside the Elements it names. Each port is bound through a
// public member the Element already has: an audio input through `analyser`,
// a source input through `inputModule`, a note output through `module`
// (DEC-063). A graph-authored component's manifest is derived from its edge
// objects by `projectManifest`.
//
// Pure data and functions: no DOM is touched until an Element is defined.

import {defineAudioLevelAnalyzerElement, defineAudioMeterElement, defineAudioOscilloscopeElement, defineAudioSpectrumAnalyzerElement,
  defineAudioTransientAnalyzerElement} from '@webmusic/audio/analyze/element';
import {defineAudioEffectElement, defineAudioMixerElement, defineAudioPlayerElement, defineAudioPlaylistElement, defineAudioRecorderElement} from '@webmusic/audio/play/element';
import {defineAudioClipViewElement, defineAudioLiveViewElement, defineAudioViewElement} from '@webmusic/audio/view/element';
import {parseModuleProject, type ModuleProject, type ProjectAssetReference} from '@webmusic/kernel/module';
import {OBJECT_PLUGIN_PREFIX, inletId, outletId, parseArgs} from '@webmusic/kernel/objects';
import {defineChordAnalysisElement, defineIntervalAnalysisElement, defineRhythmAnalysisElement,
  defineScaleAnalysisElement} from '@webmusic/score/analyze/element';
import {defineNoteInputElement, defineRackControlElement, defineRackPartElement, defineScoreEffectElement, defineScorePlayerElement, defineScoreRecorderElement,
  defineSynthPanelElement} from '@webmusic/score/play/element';
import {Effect} from '@webmusic/score/play/headless';
import {definePitchViewElement, defineScoreGridViewElement, defineScoreViewElement, defineSheetViewElement} from '@webmusic/score/view/element';

/** A port of a component, as a graph sees it. */
export interface ComponentPort {
  readonly id: string;
  readonly family: 'audio' | 'note' | 'source' | 'message';
  readonly direction: 'input' | 'output';
}

/** A port of a code-authored component, with the Element member that carries it. */
export type ComponentPortBinding =
  /** Audio in: the host connects the cord to an AnalyserNode and hands it to the Element's `analyser`. */
  | (ComponentPort & {readonly family: 'audio'; readonly direction: 'input'; readonly bind: 'analyser'; readonly fftSize: number})
  /** A source in: the host hands the upstream module to the Element's `inputModule`. */
  | (ComponentPort & {readonly family: 'source'; readonly direction: 'input'; readonly bind: 'inputModule'})
  /** A source in, for a panel: the host hands the upstream module to the Element's `moduleTarget`, whose parameters and inserts it edits. */
  | (ComponentPort & {readonly family: 'source'; readonly direction: 'input'; readonly bind: 'moduleTarget'})
  /**
   * A source in, for a companion of an audio player: the host hands the
   * upstream box's Element to `player`, which then plays through that player
   * and its Session. With no cord it is linked to nothing, so it never plays
   * by itself outside the graph.
   */
  | (ComponentPort & {readonly family: 'source'; readonly direction: 'input'; readonly bind: 'player'})
  /**
   * A source in, for an Audio view: the host lends the view, on its box, a
   * module context whose `AUDIO_PLAYER_OWNER` is the Element of the box its
   * cord comes from, so the view follows that player by containment (DEC-068):
   * its playhead, and its clip when the view has no data of its own.
   */
  | (ComponentPort & {readonly family: 'source'; readonly direction: 'input'; readonly bind: 'owner'})
  /** Audio in or out of an insert: the host connects the box's input to the Element's `input` and its `output` to the box's output, and gives it the graph's `context`. */
  | (ComponentPort & {readonly family: 'audio'; readonly bind: 'insert'})
  /** Notes in: the host hands the Element's `inputModule` a module whose `notes` output repeats the cords' notes. */
  | (ComponentPort & {readonly family: 'note'; readonly direction: 'input'; readonly bind: 'inputModule'})
  /** Notes out: the host forwards the note output port of the Element's `module`. */
  | (ComponentPort & {readonly family: 'note'; readonly direction: 'output'; readonly bind: 'module'})
  /** A source out: a cord hands the Element's `module` to the `inputModule` of the companion it reaches (DEC-063). */
  | (ComponentPort & {readonly family: 'source'; readonly direction: 'output'; readonly bind: 'module'})
  /**
   * Audio out: the host lends the Element a module context with the graph's
   * audio environment and Session, whose default destination is this port
   * (DEC-084). A player in it joins the graph's Session; a desk's master plays into it.
   */
  | (ComponentPort & {readonly family: 'audio'; readonly direction: 'output'; readonly bind: 'context'})
  /** Audio in: the host admits the cord's audio as one channel of the Element's `module`, labelled `channel`. */
  | (ComponentPort & {readonly family: 'audio'; readonly direction: 'input'; readonly bind: 'admit'; readonly channel: string});

/** A project asset the box's module loads and the host hands to an Element property. */
export interface ComponentAsset {
  /** The asset role in the module record; for `entries`, the prefix of its roles (`entry1`, `entry2`, …). */
  readonly role: string;
  /** What it loads as: a Score, an AudioClip, or every matching role as a playlist's `{id, label, clip}` entries, in role order. */
  readonly kind: 'score' | 'clip' | 'entries';
  /** The Element property the loaded value is assigned to. */
  readonly property: string;
}

/** A value set from the box's arguments, by position. */
export interface ComponentParameter {
  /** The key in the module's config. */
  readonly name: string;
  /** The argument's name in the box's usage. */
  readonly label: string;
  readonly kind: 'number' | 'word';
  readonly fallback: number | string;
  readonly min?: number;
  readonly max?: number;
  /** The Element attribute the value is written to. */
  readonly attribute?: string;
  /**
   * The value names a shared buffer the host binds; empty binds nothing until
   * a name is given. `true`: an `<audio-clip-view>` shows and edits it.
   * `'clip'`: its samples are the Element's read-only `clip`. `'take'`: each
   * take the Element records (`webaudio:recorded`) is written to it.
   */
  readonly buffer?: true | 'clip' | 'take';
  /** The words a `word` parameter accepts; without it, any word. */
  readonly choices?: readonly string[];
  /** A comma-separated list, each item one of these words; empty is an empty list. */
  readonly list?: readonly string[];
}

/** How an Element takes the height of a resized box (DEC-080). Selectors name public parts. */
export type ComponentFit =
  /** A height token on the Element sizes `surface`, measured inside `content`. */
  | {readonly kind: 'token'; readonly property: string; readonly content: string; readonly surface: string; readonly least: number}
  /** The Element's `height` attribute; `content`, when given, is measured to find what its tools take. */
  | {readonly kind: 'attribute'; readonly least: number; readonly content?: string};

/** A code-authored component: how a host places it in a graph. */
export interface ComponentManifest {
  /** The name typed into its box. */
  readonly name: string;
  readonly summary: string;
  /** The custom element's tag. */
  readonly tag: string;
  /** The project plugin ID of its module in a graph. */
  readonly plugin: string;
  readonly ports: readonly ComponentPortBinding[];
  readonly parameters: readonly ComponentParameter[];
  /** The music it plays, when it plays a project asset; without the asset it waits (DEC-082). */
  readonly asset?: ComponentAsset;
  /** Lend the graph's module context on the box although no audio output needs it: the Element then works in the graph's AudioContext. */
  readonly scope?: true;
  /**
   * An Element that works only inside another, as a declaration inside its
   * owner: the host places it in this container, which the box holds. The
   * manifest's attributes, settings and bindings apply to the inner Element;
   * the container takes its own attributes and lends the inner one its scope.
   */
  readonly container?: {readonly tag: string; readonly attributes?: Readonly<Record<string, string>>; define(): void};
  /** Set Element properties a config describes but no attribute carries, after its parameters are applied. */
  configure?(element: HTMLElement, config: Readonly<Record<string, unknown>>): void;
  /**
   * The host computes the Element's `.spectrogram` from the clip it shows —
   * its own, or its player's — while its `type` is `spectrogram`, because the
   * Element draws a spectrogram only from data given to it.
   */
  readonly spectrogram?: true;
  /** Attributes the Element starts with in a graph; a setting may replace one (DEC-085). */
  readonly attributes?: Readonly<Record<string, string>>;
  /**
   * Attributes a setting never writes: those the host needs as they are.
   */
  readonly locked?: readonly string[];
  /** Natural width in CSS pixels; its natural height is its own. */
  readonly width: number;
  /** How it follows a resized box; without one, a resized box clips it. */
  readonly fit?: ComponentFit;
  /**
   * Set when the Element edits a Score through `.editor` and `editable`
   * (DEC-086): while its `editable` attribute is on, its box lends it the
   * document of the box its `source` cord comes from.
   */
  readonly edits?: 'score';
  /** Register the custom element; safe to call again. */
  define(): void;
}

// The five that DEC-078 placed as view objects keep their plugin IDs, so saved
// projects and exported components load unchanged.
export const KEYS_PLUGIN = 'webmusic.surface.keys';
export const SCOPE_PLUGIN = 'webmusic.surface.scope';
export const METER_PLUGIN = 'webmusic.surface.meter';
export const SPECTRUM_PLUGIN = 'webmusic.surface.spectrum';
export const ROLL_PLUGIN = 'webmusic.surface.roll';
/** Components placed after DEC-081 take their plugin ID from their tag. */
export const CLIP_PLUGIN = 'webmusic.component.audio-clip-view';
export const LEVEL_PLUGIN = 'webmusic.component.audio-level-analyzer';

const audioIn = (fftSize: number): ComponentPortBinding => ({id: 'input', family: 'audio', direction: 'input', bind: 'analyser', fftSize});
const sourceIn: ComponentPortBinding = {id: 'source', family: 'source', direction: 'input', bind: 'inputModule'};
const pluginOf = (tag: string): string => `webmusic.component.${tag}`;
const audioOut: ComponentPortBinding = {id: 'output', family: 'audio', direction: 'output', bind: 'context'};
/** A desk's inputs: each cord is one channel strip, named by its number. */
// Four strips and the master fit in 424 px.
const channelsIn = (count: number): ComponentPortBinding[] => Array.from({length: count}, (_, index) =>
  ({id: `in${index + 1}`, family: 'audio', direction: 'input', bind: 'admit', channel: String(index + 1)}));

/** The insert types a Score effect names, in the order a library lists them. */
const SCORE_EFFECTS = Object.freeze(['gain', 'panner', 'filter', 'delay', 'reverb', 'compressor', 'limiter', 'tremolo', 'chorus', 'distortion', 'bitcrusher'] as const);

/** The packages' Components a graph can hold, in the order a library lists them. */
export const OFFICIAL_COMPONENTS: readonly ComponentManifest[] = Object.freeze<ComponentManifest[]>([
  {name: 'keys', summary: 'Piano keyboard: play notes into a synth', tag: 'score-note-input', plugin: KEYS_PLUGIN,
    ports: [{id: 'notes', family: 'note', direction: 'output', bind: 'module'}],
    parameters: [
      {name: 'low', label: 'low', kind: 'number', fallback: 48, min: 0, max: 127, attribute: 'start'},
      {name: 'high', label: 'high', kind: 'number', fallback: 72, min: 0, max: 127, attribute: 'end'},
    ],
    attributes: {layout: 'piano', routing: 'manual', 'aria-label': 'Keyboard'},
    // The box is a piano whose notes the host forwards: its fit and width are a piano's.
    locked: ['layout', 'routing'],
    width: 320, fit: {kind: 'token', property: '--wm-note-height', content: '[part~="root"]', surface: '[part~="viewport"]', least: 24},
    define: () => defineNoteInputElement()},
  {name: 'roll', summary: 'Piano roll following a score', tag: 'score-grid-view', plugin: ROLL_PLUGIN,
    ports: [{id: 'source', family: 'source', direction: 'input', bind: 'inputModule'}],
    parameters: [], attributes: {height: '176', 'note-height': '6'},
    edits: 'score',
    width: 320, fit: {kind: 'attribute', least: 48},
    define: () => defineScoreGridViewElement()},
  {name: 'scope', summary: 'Oscilloscope of the incoming audio', tag: 'audio-oscilloscope', plugin: SCOPE_PLUGIN,
    ports: [audioIn(2048)],
    parameters: [{name: 'timebaseMs', label: 'milliseconds', kind: 'number', fallback: 10, min: 1, max: 40, attribute: 'timebase-ms'}],
    width: 288, fit: {kind: 'token', property: '--wm-oscilloscope-height', content: '[part~="root"]', surface: '[part~="plot"]', least: 32},
    define: () => defineAudioOscilloscopeElement()},
  {name: 'meter', summary: 'Level meter of the incoming audio', tag: 'audio-meter', plugin: METER_PLUGIN,
    ports: [audioIn(2048)], parameters: [],
    width: 224, fit: {kind: 'attribute', least: 32},
    define: () => defineAudioMeterElement()},
  {name: 'spectrum', summary: 'Spectrum of the incoming audio', tag: 'audio-spectrum-analyzer', plugin: SPECTRUM_PLUGIN,
    ports: [audioIn(4096)], parameters: [],
    width: 288, fit: {kind: 'token', property: '--wm-spectrum-height', content: '[part~="root"]', surface: '[part~="plot"]', least: 32},
    define: () => defineAudioSpectrumAnalyzerElement()},
  {name: 'level', summary: 'RMS, peak and crest of the incoming audio', tag: 'audio-level-analyzer', plugin: LEVEL_PLUGIN,
    ports: [audioIn(2048)],
    parameters: [{name: 'thresholdDbfs', label: 'threshold dBFS', kind: 'number', fallback: -12, min: -60, max: 0, attribute: 'threshold-dbfs'}],
    width: 288,
    define: () => defineAudioLevelAnalyzerElement()},
  // A buffer's waveform: `buffer` holds the samples and shows nothing (DEC-081).
  {name: 'clip', summary: 'Show and edit the samples of a named buffer', tag: 'audio-clip-view', plugin: CLIP_PLUGIN,
    ports: [],
    parameters: [{name: 'buffer', label: 'name', kind: 'word', fallback: '', buffer: true}],
    attributes: {height: '120'},
    // A clip view's height counts its tools and ruler; what it draws is measured.
    width: 320, fit: {kind: 'attribute', least: 96, content: 'section'},
    define: () => defineAudioClipViewElement()},
  // Placed after the first seven: the packages' other Components that take
  // their data from a cord.
  {name: 'sheet', summary: 'Engraved sheet music following a score', tag: 'score-sheet-view', plugin: pluginOf('score-sheet-view'),
    ports: [sourceIn], parameters: [], attributes: {layout: 'flow', height: '160'},
    edits: 'score',
    width: 320, fit: {kind: 'attribute', least: 64},
    define: () => defineSheetViewElement()},
  {name: 'view', summary: 'Staff, piano roll or waterfall of a score', tag: 'score-view', plugin: pluginOf('score-view'),
    ports: [sourceIn],
    parameters: [{name: 'type', label: 'type', kind: 'word', fallback: 'staff', choices: ['staff', 'piano-roll', 'waterfall'], attribute: 'type'}],
    attributes: {height: '120'},
    width: 320, fit: {kind: 'attribute', least: 48},
    define: () => defineScoreViewElement()},
  {name: 'pitch', summary: 'The pitches sounding now, on keys, a staff or frets', tag: 'score-pitch-view', plugin: pluginOf('score-pitch-view'),
    ports: [sourceIn],
    parameters: [{name: 'type', label: 'type', kind: 'word', fallback: 'keyboard', choices: ['keyboard', 'staff', 'fretboard'], attribute: 'type'}],
    width: 320,
    define: () => definePitchViewElement()},
  {name: 'chords', summary: 'Chords of a score as it plays', tag: 'score-chord-analysis', plugin: pluginOf('score-chord-analysis'),
    ports: [sourceIn], parameters: [], width: 320,
    define: () => defineChordAnalysisElement()},
  {name: 'intervals', summary: 'Intervals of a score as it plays', tag: 'score-interval-analysis', plugin: pluginOf('score-interval-analysis'),
    ports: [sourceIn], parameters: [], width: 320,
    define: () => defineIntervalAnalysisElement()},
  {name: 'rhythm', summary: 'Rhythm of a score against its beats', tag: 'score-rhythm-analysis', plugin: pluginOf('score-rhythm-analysis'),
    ports: [sourceIn], parameters: [], width: 320,
    define: () => defineRhythmAnalysisElement()},
  {name: 'degrees', summary: 'Pitches of a score as degrees of a scale', tag: 'score-scale-analysis', plugin: pluginOf('score-scale-analysis'),
    ports: [sourceIn],
    parameters: [
      {name: 'scale', label: 'scale', kind: 'word', fallback: 'major',
        choices: ['major', 'natural-minor', 'harmonic-minor', 'melodic-minor-ascending', 'melodic-minor-descending'], attribute: 'scale'},
      {name: 'tonic', label: 'tonic', kind: 'word', fallback: '', attribute: 'tonic'},
    ],
    width: 320,
    define: () => defineScaleAnalysisElement()},
  {name: 'transients', summary: 'Onsets in the incoming audio', tag: 'audio-transient-analyzer', plugin: pluginOf('audio-transient-analyzer'),
    ports: [audioIn(2048)], parameters: [], width: 288,
    define: () => defineAudioTransientAnalyzerElement()},
  {name: 'live', summary: 'Scrolling waveform or spectrogram of the incoming audio', tag: 'audio-live-view', plugin: pluginOf('audio-live-view'),
    ports: [audioIn(2048)],
    parameters: [{name: 'type', label: 'type', kind: 'word', fallback: 'waveform', choices: ['waveform', 'spectrogram'], attribute: 'type'}],
    attributes: {height: '64'},
    width: 320, fit: {kind: 'attribute', least: 32},
    define: () => defineAudioLiveViewElement()},
  // Players and desks (DEC-084): each plays in the graph's Session through the
  // module context its box lends it, so its transport and the graph's are one.
  {name: 'player', summary: 'Play a score with its own transport, in the graph\'s Session', tag: 'score-player', plugin: pluginOf('score-player'),
    ports: [audioOut, {id: 'source', family: 'source', direction: 'output', bind: 'module'}], parameters: [],
    asset: {role: 'source', kind: 'score', property: 'score'},
    attributes: {controls: 'show', 'aria-label': 'Score player'}, width: 320,
    define: () => defineScorePlayerElement()},
  {name: 'track', summary: 'Play a recording with its own transport, in the graph\'s Session', tag: 'audio-player', plugin: pluginOf('audio-player'),
    ports: [audioOut, {id: 'source', family: 'source', direction: 'output', bind: 'module'}], parameters: [],
    asset: {role: 'source', kind: 'clip', property: 'clip'},
    attributes: {controls: 'show', 'aria-label': 'Audio player'}, width: 320,
    define: () => defineAudioPlayerElement()},
  {name: 'rack', summary: 'Mixing desk: a fader, mute and solo for each cord in, and a master', tag: 'score-rack-control', plugin: pluginOf('score-rack-control'),
    ports: [...channelsIn(4), audioOut], parameters: [], attributes: {'aria-label': 'Rack'}, width: 424,
    define: () => defineRackControlElement()},
  {name: 'mixer', summary: 'Audio mixer: a fader, mute and solo for each cord in, and a master', tag: 'audio-mixer', plugin: pluginOf('audio-mixer'),
    ports: [...channelsIn(4), audioOut], parameters: [], attributes: {'aria-label': 'Mixer'}, width: 424,
    define: () => defineAudioMixerElement()},
  // A recorder takes the notes cabled to it and plays its take into the graph.
  {name: 'recorder', summary: 'Record the incoming notes as a score, replay and export the take', tag: 'score-recorder', plugin: pluginOf('score-recorder'),
    ports: [{id: 'notes', family: 'note', direction: 'input', bind: 'inputModule'}, audioOut], parameters: [],
    attributes: {'aria-label': 'Score recorder'}, width: 320,
    define: () => defineScoreRecorderElement()},
  // A panel attached to the module its cord comes from; without one it shows no controls.
  {name: 'panel', summary: 'Sound, envelope and effect controls of the player cabled to it', tag: 'score-synth-panel', plugin: pluginOf('score-synth-panel'),
    ports: [{id: 'target', family: 'source', direction: 'input', bind: 'moduleTarget'}], parameters: [],
    attributes: {sections: 'sound,envelope,effects', 'aria-label': 'Synth panel'}, width: 320,
    define: () => defineSynthPanelElement()},
  // A read-only waveform of a named buffer; `clip` is the one that edits. The Element's spectrogram and meter types
  // need data a buffer does not carry, so the type stays `waveform`.
  // A read-only drawing: of a named buffer, or of the track cabled to it, following its playhead.
  {name: 'wave', summary: 'Waveform or spectrogram of a named buffer, or of the track cabled to it', tag: 'audio-view', plugin: pluginOf('audio-view'),
    ports: [{id: 'source', family: 'source', direction: 'input', bind: 'owner'}],
    parameters: [
      {name: 'buffer', label: 'name', kind: 'word', fallback: '', buffer: 'clip'},
      {name: 'type', label: 'type', kind: 'word', fallback: 'waveform', choices: ['waveform', 'spectrogram'], attribute: 'type'},
    ],
    spectrogram: true, attributes: {height: '96', 'aria-label': 'Audio view'},
    width: 320, fit: {kind: 'attribute', least: 32},
    define: () => defineAudioViewElement()},
  // The two companions of `track`: cabled from it, they play through it and its Session.
  {name: 'take', summary: 'Record the microphone; the take goes to a named buffer and plays through the track cabled to it', tag: 'audio-recorder', plugin: pluginOf('audio-recorder'),
    ports: [{id: 'player', family: 'source', direction: 'input', bind: 'player'}],
    parameters: [{name: 'buffer', label: 'name', kind: 'word', fallback: '', buffer: 'take'}],
    scope: true, attributes: {'aria-label': 'Audio recorder'}, width: 320,
    define: () => defineAudioRecorderElement()},
  {name: 'playlist', summary: 'A queue of recordings, played in order through the track cabled to it', tag: 'audio-playlist', plugin: pluginOf('audio-playlist'),
    ports: [{id: 'player', family: 'source', direction: 'input', bind: 'player'}, audioOut], parameters: [],
    asset: {role: 'entry', kind: 'entries', property: 'entries'},
    attributes: {'aria-label': 'Playlist'}, width: 320,
    define: () => defineAudioPlaylistElement()},
  // The panel's insert mode: the audio cabled in passes through its effects, then its EQ.
  {name: 'eq', summary: 'Insert: the effects it names, then a three-band equalizer, with their controls', tag: 'score-synth-panel', plugin: pluginOf('score-synth-panel-eq'),
    ports: [{id: 'input', family: 'audio', direction: 'input', bind: 'insert'}, {id: 'output', family: 'audio', direction: 'output', bind: 'insert'}],
    parameters: [{name: 'effects', label: 'effects', kind: 'word', fallback: '', list: SCORE_EFFECTS}],
    attributes: {mode: 'insert', sections: 'effects,eq', 'aria-label': 'Equalizer'}, locked: ['mode'], width: 320,
    configure: (element, config) => {
      const names = String(config.effects ?? '').split(',').map(name => name.trim()).filter(name => (SCORE_EFFECTS as readonly string[]).includes(name));
      (element as HTMLElement & {effects?: unknown[]}).effects = names.map(name => {
        const recipe = (Effect as unknown as Record<string, () => {label?: string}>)[name]!();
        recipe.label = name;
        return recipe;
      });
    },
    define: () => defineSynthPanelElement()},
  // Declarations wrapped as components (DEC-089). An effect is one insert on the player its cord comes from.
  {name: 'effect', summary: 'One insert on the score player cabled to it; its controls are the player\'s panel', tag: 'score-effect', plugin: pluginOf('score-effect'),
    ports: [{id: 'target', family: 'source', direction: 'input', bind: 'moduleTarget'}],
    parameters: [{name: 'type', label: 'type', kind: 'word', fallback: 'gain', choices: SCORE_EFFECTS, attribute: 'type'}],
    attributes: {'aria-label': 'Effect'}, width: 160,
    define: () => defineScoreEffectElement()},
  {name: 'audio-effect', summary: 'One insert on the track cabled to it', tag: 'audio-effect', plugin: pluginOf('audio-effect'),
    ports: [{id: 'target', family: 'source', direction: 'input', bind: 'moduleTarget'}],
    parameters: [{name: 'type', label: 'type', kind: 'word', fallback: 'gain', choices: ['gain', 'filter', 'delay', 'compressor'], attribute: 'type'}],
    attributes: {'aria-label': 'Audio effect'}, width: 160,
    define: () => defineAudioEffectElement()},
  // One voice of a desk: placed in a desk of its own, which gives it a strip and plays it into the box's output.
  {name: 'part', summary: 'One voice: a score and an oscillator, with its own fader, in the graph\'s Session', tag: 'score-rack-part', plugin: pluginOf('score-rack-part'),
    ports: [audioOut, {id: 'source', family: 'source', direction: 'output', bind: 'module'}],
    parameters: [{name: 'sound', label: 'sound', kind: 'word', fallback: 'triangle', choices: ['sine', 'square', 'sawtooth', 'triangle'], attribute: 'sound'}],
    asset: {role: 'source', kind: 'score', property: 'score'},
    container: {tag: 'score-rack-control', attributes: {master: 'false', 'aria-label': 'Part'}, define: () => defineRackControlElement()},
    width: 96,
    define: () => defineRackPartElement()},
]);



/** The manifest of a plugin ID, if it is an official component's. */
export function componentManifestOf(plugin: string): ComponentManifest | undefined {
  return OFFICIAL_COMPONENTS.find(manifest => manifest.plugin === plugin);
}

/** The manifest of a box name, if it names an official component. */
export function findComponentManifest(name: string): ComponentManifest | undefined {
  return OFFICIAL_COMPONENTS.find(manifest => manifest.name === name);
}

const PORT_FAMILIES: readonly ComponentPort['family'][] = ['message', 'audio', 'note', 'source'];

/**
 * The ports of a component placed in a project, by what it is (DEC-081 rule 3,
 * DEC-089): an official component's from its manifest, a graph-authored one's
 * — a `component` object — from the channel kinds its config lists, as `in<n>`
 * and `out<n>`. Undefined for a module that is not a component. A host that
 * connects components, such as an app's inspector (DEC-092), reads both the
 * same way.
 */
export function componentPorts(record: {readonly plugin: {readonly id: string}; readonly config: Readonly<Record<string, unknown>>}): readonly ComponentPort[] | undefined {
  const manifest = componentManifestOf(record.plugin.id);
  if (manifest) return Object.freeze(manifest.ports.map(({id, family, direction}) => Object.freeze({id, family, direction})));
  if (record.plugin.id !== `${OBJECT_PLUGIN_PREFIX}component`) return undefined;
  const side = (value: unknown, direction: ComponentPort['direction']): ComponentPort[] => Array.isArray(value)
    ? value.flatMap((kind, index) => PORT_FAMILIES.includes(kind as ComponentPort['family'])
      ? [Object.freeze({id: direction === 'input' ? inletId(index) : outletId(index), family: kind as ComponentPort['family'], direction})] : [])
    : [];
  return Object.freeze([...side(record.config.inlets, 'input'), ...side(record.config.outlets, 'output')]);
}

/** True when a component only listens: its audio cords are sends, never a replaced route. */
export function isListener(plugin: string): boolean {
  const manifest = componentManifestOf(plugin);
  return !!manifest && manifest.ports.length > 0 && manifest.ports.every(port => port.bind === 'analyser');
}

/** A parameter's value from a config, or its fallback when absent or out of kind. */
export function parameterValue(parameter: ComponentParameter, config: Readonly<Record<string, unknown>>): number | string {
  const value = config[parameter.name];
  if (parameter.kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : parameter.fallback;
  if (typeof value !== 'string') return parameter.fallback;
  if (parameter.list) return listed(parameter.list, value) ?? parameter.fallback;
  return !parameter.choices || parameter.choices.includes(value) ? value : parameter.fallback;
}

/** A comma-separated word list, when every item is one of `words`; undefined otherwise. */
function listed(words: readonly string[], value: string): string | undefined {
  const items = value.split(',').map(item => item.trim()).filter(Boolean);
  return items.every(item => words.includes(item)) ? items.join(',') : undefined;
}

/**
 * A config from a box's argument words, by position. A number out of its
 * range is clamped and a word that is not a number keeps the fallback; either
 * is reported. Returns the config and the first problem, if any.
 */
export function configOfArguments(manifest: ComponentManifest, words: readonly string[]): {config: Record<string, number | string>; error?: string} {
  const config: Record<string, number | string> = {};
  let error: string | undefined;
  if (words.length > manifest.parameters.length) error = `${manifest.name} takes ${manifest.parameters.length || 'no'} argument${manifest.parameters.length === 1 ? '' : 's'}.`;
  manifest.parameters.forEach((parameter, index) => {
    const word = words[index];
    if (word === undefined) { config[parameter.name] = parameter.fallback; return; }
    if (parameter.kind === 'word') {
      if (parameter.list) {
        const value = listed(parameter.list, word);
        if (value === undefined) error ??= `${manifest.name} ${parameter.label} must list ${parameter.list.join(', ')}, separated by commas.`;
        config[parameter.name] = value ?? parameter.fallback;
      } else if (parameter.choices && !parameter.choices.includes(word)) {
        error ??= `${manifest.name} ${parameter.label} must be one of ${parameter.choices.join(', ')}.`;
        config[parameter.name] = parameter.fallback;
      } else config[parameter.name] = word;
      return;
    }
    const number = Number(word);
    if (!Number.isFinite(number)) { error ??= `${parameter.label} must be a number.`; config[parameter.name] = parameter.fallback; return; }
    const min = parameter.min ?? -Infinity, max = parameter.max ?? Infinity;
    if (number < min || number > max) error ??= `${manifest.name} ${parameter.label} must be within ${min}–${max}.`;
    config[parameter.name] = Math.min(max, Math.max(min, number));
  });
  return error ? {config, error} : {config};
}

/** The usage shown for a component's box: its name and arguments with their fallbacks. */
export function componentUsage(manifest: ComponentManifest): string {
  return [manifest.name, ...manifest.parameters.map(parameter => parameter.fallback === '' ? `[${parameter.label}]` : `[${parameter.label}=${parameter.fallback}]`)].join(' ');
}

/** What a graph-authored component offers a host: the ports of its edge objects and the resources it loads. */
export interface ProjectManifest {
  readonly ports: readonly ComponentPort[];
  readonly assets: readonly ProjectAssetReference[];
}

const EDGES: Readonly<Record<string, Pick<ComponentPort, 'family' | 'direction'>>> = Object.freeze({
  inlet: {family: 'message', direction: 'input'}, 'inlet~': {family: 'audio', direction: 'input'},
  outlet: {family: 'message', direction: 'output'}, 'outlet~': {family: 'audio', direction: 'output'},
  // Notes and sources cross a component's edge as well (DEC-089).
  'inlet.note': {family: 'note', direction: 'input'}, 'outlet.note': {family: 'note', direction: 'output'},
  'inlet.source': {family: 'source', direction: 'input'}, 'outlet.source': {family: 'source', direction: 'output'},
});

/**
 * The manifest of a graph-authored component: the ports its edge objects make
 * (`inlet n` is `in<n>`, `outlet~ n` is `out<n>`, as the `component` object
 * names them) and its assets. `contextId` picks the component's context; by
 * default the project's top-level contexts.
 */
export function projectManifest(input: unknown, contextId?: string): ProjectManifest {
  const project: ModuleProject = parseModuleProject(input);
  const top = new Set(contextId !== undefined ? [contextId] : project.contexts.filter(context => context.parentId === undefined).map(context => context.id));
  const ports = new Map<string, ComponentPort>();
  for (const record of project.modules) {
    if (!top.has(record.contextId) || !record.plugin.id.startsWith(OBJECT_PLUGIN_PREFIX)) continue;
    const edge = EDGES[record.plugin.id.slice(OBJECT_PLUGIN_PREFIX.length)];
    if (!edge) continue;
    const index = parseArgs(record.config)[0];
    const number = index?.type === 'int' || index?.type === 'float' ? Math.trunc(index.value) : 0;
    const id = edge.direction === 'input' ? inletId(number) : outletId(number);
    if (!ports.has(id)) ports.set(id, Object.freeze({id, ...edge}));
  }
  const order = (port: ComponentPort) => (port.direction === 'input' ? 0 : 1e6) + Number(port.id.replace(/\D+/g, ''));
  return Object.freeze({
    ports: Object.freeze([...ports.values()].sort((a, b) => order(a) - order(b))),
    assets: Object.freeze([...project.assets]),
  });
}

const BUFFER_PLUGIN = `${OBJECT_PLUGIN_PREFIX}buffer`;
/** Plugin version of the components' modules. */
export const COMPONENT_PLUGIN_VERSION = '1.0.0';

/**
 * Move a buffer's waveform out of its box (DEC-081). Before the split a
 * `buffer` placed in the presentation showed its samples; each such buffer
 * gets a `clip` bound to its name, beside it on the canvas and in its place
 * in the presentation. A project with no presented `buffer` is returned as
 * it is, so running this again changes nothing.
 */
export function migrateBufferViews(input: unknown): ModuleProject {
  const project = parseModuleProject(input);
  const byId = new Map(project.modules.map(record => [record.id, record]));
  const presentation = project.layout.presentation ?? [];
  if (!presentation.some(item => byId.get(item.moduleId)?.plugin.id === BUFFER_PLUGIN)) return project;
  const ids = new Set(project.modules.map(record => record.id));
  const positions = new Map(project.layout.modules.map(item => [item.moduleId, item]));
  const modules = [...project.modules];
  const layout = [...project.layout.modules];
  const clips = new Map<string, string>();
  for (const item of presentation) {
    const record = byId.get(item.moduleId);
    if (record?.plugin.id !== BUFFER_PLUGIN || clips.has(record.id)) continue;
    const name = parseArgs(record.config)[0];
    if (name?.type !== 'symbol') continue;
    let id = `${record.id}-clip`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    clips.set(record.id, id);
    modules.push({id, contextId: record.contextId, plugin: {id: CLIP_PLUGIN, version: COMPONENT_PLUGIN_VERSION}, label: `clip ${name.value}`, config: {buffer: name.value}});
    const at = positions.get(record.id);
    layout.push({moduleId: id, x: at?.x ?? 0, y: (at?.y ?? 0) + (at?.height ?? 32) + 16});
  }
  return parseModuleProject({
    ...project,
    modules,
    layout: {
      ...project.layout,
      modules: layout,
      // A buffer that names nothing has no waveform to show: it leaves the presentation.
      presentation: presentation.flatMap(item => {
        if (byId.get(item.moduleId)?.plugin.id !== BUFFER_PLUGIN) return [item];
        const clip = clips.get(item.moduleId);
        return clip ? [{...item, moduleId: clip}] : [];
      }),
    },
  });
}
