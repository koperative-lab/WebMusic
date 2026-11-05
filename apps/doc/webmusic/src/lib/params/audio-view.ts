// @webmusic/audio/view/element — every observed attribute of all View tags.
// Checked against `static get observedAttributes()` in
// packages/audio/src/view/element/*.ts.

import type {ElementParamCatalog} from './types';

const ENTRY = '@webmusic/audio/view/element';

/** The decoders `loadClipFromUrl` accepts, in the order the element lists them. */
const AUDIO_FORMATS = ['wav', 'aiff', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'webm'] as const;

/** `format` only ever qualifies `src`; it is inert on a `peaks-src` view. */
const FORMAT = {
  name: 'format',
  kind: 'enum',
  options: AUDIO_FORMATS,
  fallback: 'adaptive — taken from the src extension, else sniffed from the bytes',
  note: 'Forces the decoder used for `src`.',
} as const;

const PEAKS_SRC = {
  name: 'peaks-src',
  kind: 'text',
  placeholder: 'song.json',
  fallback: 'peaks come from src, .peaks or the bound clip',
  note: 'URL of BBC audiowaveform v2 JSON, hydrated straight into the pyramid — no decode at all.',
} as const;

/** The three canvas elements all paint their columns with this one colour. */
const WAVE_COLOR = {
  name: 'wave-color',
  kind: 'text',
  placeholder: 'currentColor',
  fallback: 'currentColor',
  note: 'Column fill, so it inherits the surrounding text colour by default.',
} as const;

/** Every colormap name `colormapByName` knows; anything else resolves to viridis. */
const COLORMAPS = ['viridis', 'magma', 'grayscale', 'gray'] as const;

export const AUDIO_VIEW_PARAMS: ElementParamCatalog = {
  'audio-view': {
    tag: 'audio-view',
    entry: ENTRY,
    params: [
      {
        name: 'src',
        kind: 'text',
        placeholder: 'song.wav',
        fallback: 'no audio until you assign .clip / .peaks or bind a player',
        note: 'URL of an audio file, decoded through the sibling @webmusic/audio/play capability (imported dynamically).',
      },
      PEAKS_SRC,
      {
        ...FORMAT,
        note: 'Forces the decoder used for `src`; an unsupported name fails the load as webaudio:error.',
      },
      {
        name: 'type',
        kind: 'enum',
        options: ['waveform', 'spectrogram', 'meter'],
        fallback: 'waveform',
        note: 'Which visualization is drawn. Switching disposes the old one and re-renders; unknown values fall back to waveform.',
      },
      {
        name: 'player',
        kind: 'text',
        placeholder: '#my-player',
        fallback: 'no playhead, and no analyser for type="meter"',
        note: 'Same-root selector of exactly one player, observed for late insertion, upgrade and replacement; multiple matches bind nothing and invalid syntax emits webaudio:error. Live position/activity supports display-frame following; event-only targets keep their timeupdate cadence. The meter borrows .analyser.',
      },
      {
        name: 'interactive',
        kind: 'bool',
        fallback: 'off',
        note: 'Enable click, keyboard and seek/scrub dragging outside pan mode; pan controls the viewport independently.',
      },
      {
        name: 'drag-mode',
        kind: 'enum',
        options: ['seek', 'scrub', 'pan', 'none'],
        fallback: 'seek — absolute pointer position',
        note: 'seek follows the pointer; scrub centers the playhead, scratches supported decoded audio and coasts on release (left = forward, right = reverse); pan browses; none keeps clicks. annotate and active content editing override.',
        when: {attribute: 'type', values: ['waveform', 'spectrogram'], fallback: 'waveform'},
      },
      {
        name: 'annotate',
        kind: 'bool',
        fallback: 'off',
        note: 'Drag to create a Region, overriding drag-mode; emits webaudio:regionchange with the whole list.',
      },
      {
        name: 'follow',
        kind: 'bool',
        fallback: 'off — unless interactive is set',
        note: 'Follow playback in position mode. pan suspends following; scrub keeps a fixed center playhead independently of this value.',
      },
      {
        name: 'scrollable',
        kind: 'bool',
        fallback: 'on',
        note: 'Allow native and pan-mode browsing on waveform/spectrogram. Centered scrub disables native panning independently of this value.',
      },
      {
        name: 'virtualization',
        kind: 'text',
        placeholder: '2',
        fallback: "on, with the renderer's own buffer",
        note: 'Off-screen column culling: a number sets the buffer in screens, anything else reads as a tri-state boolean.',
      },
      {
        name: 'width',
        kind: 'text',
        placeholder: '640',
        fallback: "the element's own CSS width",
        note: "Reflected onto the host's inline width — a bare number is px, anything else is used as written.",
      },
      {
        name: 'pixels-per-second',
        kind: 'number',
        min: 1,
        step: 10,
        fallback: '100',
        note: 'Horizontal scale of the waveform / spectrogram, applied as a live re-zoom that keeps scroll and playhead.',
      },
      {
        name: 'height',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '128 waveform · 256 spectrogram · 54 meter',
        note: 'Surface height in CSS pixels; an explicit value stays in effect when type changes.',
      },
      {
        name: 'amplitude',
        kind: 'number',
        step: 0.1,
        fallback: '1',
        note: 'Visual gain on waveform peaks; may crop tall peaks without changing playback volume.',
      },
      {
        name: 'device-pixel-ratio',
        kind: 'number',
        step: 0.5,
        fallback: 'window.devicePixelRatio',
        note: 'Render-resolution override for the canvas backing store.',
      },
      {
        name: 'min-freq',
        kind: 'number',
        min: 0,
        step: 100,
        fallback: '0',
        note: 'Hz drawn at the bottom of the spectrogram.',
      },
      {
        name: 'max-freq',
        kind: 'number',
        min: 0,
        step: 100,
        fallback: "the data's Nyquist frequency",
        note: 'Hz drawn at the top of the spectrogram.',
      },
      {
        name: 'min-db',
        kind: 'number',
        step: 5,
        fallback: '-100',
        note: 'dB floor of the spectrogram magnitude → colour mapping.',
      },
      {
        name: 'max-db',
        kind: 'number',
        step: 5,
        fallback: '0',
        note: 'dB ceiling of the spectrogram magnitude → colour mapping.',
      },
      {
        name: 'bars',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '28',
        note: 'Bars drawn by type="meter" mode="spectrum".',
      },
      {
        name: 'bands',
        kind: 'number',
        min: 1,
        max: 12,
        step: 1,
        fallback: '3',
        note: 'Frequency bands for color-mode="multiband"; floored and clamped to 1–12.',
      },
      {
        name: 'history',
        kind: 'number',
        min: 0,
        step: 0.5,
        fallback: '0 — no trail',
        note: 'Seconds behind the playhead kept at full brightness while the rest dims.',
      },
      {
        ...WAVE_COLOR,
        placeholder: '#999',
        fallback: '--wm-waveform, then #999',
        note: 'Waveform column fill.',
      },
      {
        name: 'progress-color',
        kind: 'text',
        placeholder: '#444',
        fallback: '--wm-waveform-progress, then --wm-foreground, then #444',
        note: 'Fill of the played portion, left of the playhead.',
      },
      {
        name: 'playhead-color',
        kind: 'text',
        placeholder: '#c0392b',
        fallback: '--wm-playhead, then #c0392b',
        note: 'Playhead line on the waveform and the spectrogram.',
      },
      {
        name: 'background-color',
        kind: 'text',
        placeholder: 'transparent',
        fallback: 'transparent',
        note: 'Surface background. The spectrogram paints every pixel, so it has none.',
      },
      {
        name: 'color-map',
        kind: 'enum',
        options: COLORMAPS,
        fallback: 'viridis',
        note: 'Palette for the spectrogram and for waveform color-mode="colormap"; unknown names fall back to viridis.',
      },
      {
        name: 'color-mode',
        kind: 'enum',
        options: ['static', 'multiband', 'colormap'],
        fallback: 'static',
        note: 'How the waveform is coloured. The two frequency modes need .frequencyData (or .spectrogram).',
      },
      {
        name: 'channel-layout',
        kind: 'enum',
        options: ['merge', 'split'],
        fallback: 'merge',
        note: 'merge folds every peaks channel into one waveform; split stacks the first two as a stereo display.',
      },
      {
        name: 'color',
        kind: 'text',
        placeholder: '#999',
        fallback: 'shared --wm-meter-fill / --wm-accent defaults',
        note: 'Bar / fill colour of the meter.',
      },
      {
        name: 'peak-color',
        kind: 'text',
        placeholder: '#c0392b',
        fallback: '--wm-danger, then #c0392b',
        note: 'Peak-hold tick colour of the meter.',
      },
      {
        name: 'mode',
        kind: 'enum',
        options: ['level', 'spectrum'],
        fallback: 'level',
        note: 'Meter drawing: RMS / peak bars, or an FFT bar graph.',
      },
    ],
    properties: [
      {name: 'editor', note: 'Follow an editor from loadAudioClipEditor/createAudioClipEditor read-only (edit it with <audio-clip-view>); borrowed, never disposed. Undefined detaches it. Conflicts with independent src/peaks/clip data.'},
      {name: 'interactionSession', note: 'Optional shared AudioInteractionSession; its draft is drawn. Otherwise this View owns a local session.'},
      {name: 'clip', note: 'An AudioClip you already have; cancels any in-flight src load.'},
      {name: 'peaks', note: 'An AudioPeaks pyramid. Wins over src and peaks-src alike.'},
      {name: 'spectrogram', note: 'SpectrogramData — the only way into type="spectrogram".'},
      {name: 'frequencyData', note: 'STFT behind color-mode multiband / colormap; an array colours a split stereo display per channel.'},
      {name: 'regions', note: 'Replaces the region list drawn, hit-tested and merged onto by annotate.'},
      {name: 'options', note: 'A renderer option bag that wins over every option attribute.'},
      {name: 'zoom', note: 'The scale actually drawn at, in pixels per second — never 0. The setter is setZoom().'},
      {name: 'visibleRange()', note: 'The painted real-clip intersection, excluding centered blank padding; undefined for a meter or an empty view.'},
      {name: 'panTo()', note: 'Pan to clip seconds in position mode; ignored while scrub centers the playhead.'},
      {name: 'setZoom()', note: 'Live re-scale keeping scroll and playhead; reflects pixels-per-second.'},
    ],
    events: [
      {name: 'webaudio:seek', note: '{seconds, region?}: keys, ordinary clicks and seek drags announce requests before the command. Scratch-session clicks and scrub drags report accepted seconds afterward; fallback scrub clicks keep request order. pan never seeks.'},
      {name: 'webaudio:regionchange', note: "{regions} after an annotate drag — the element's whole list, not just the new one."},
      {name: 'webaudio:viewportchange', note: '{startSeconds, endSeconds} whenever the window moves, by user pan/zoom or by panTo()/setZoom().'},
      {name: 'webaudio:error', note: '{error} from a failed src / peaks-src load, a failed render or an invalid player selector.'},
    ],
  },

  'audio-clip-view': {
    tag: 'audio-clip-view',
    entry: ENTRY,
    params: [
      {name: 'src', kind: 'text', placeholder: 'song.wav', fallback: 'nothing drawn until .clip or .editor', note: 'Decoded audio drawn read-only; conflicts with .editor.'},
      FORMAT,
      {name: 'player', kind: 'text', placeholder: '#my-player', fallback: 'no playhead', note: 'Follow one selected player; with an editor, only while it plays the same revision. A ruler click asks it to seek.'},
      {name: 'width', kind: 'text', placeholder: '640', fallback: 'stretches to the container', note: 'Host width — a bare number is px, any other CSS length passes through.'},
      {name: 'height', kind: 'text', placeholder: '240', fallback: 'ruler plus 180 px of channel lanes', note: 'Host height in px; the channel lanes take what the ruler leaves.'},
      {name: 'editable', kind: 'bool', fallback: 'off — read-only drawing',
        note: 'Show the editing toolbar and accept gestures, keys and the gain HUD when a ready .editor is assigned; never creates an editor.'},
      {
        name: 'tools',
        kind: 'tokens',
        options: ['split', 'delete', 'clipboard', 'trim', 'silence', 'gain', 'fade', 'envelope', 'markers', 'grid', 'process', 'snap', 'zoom', 'history'],
        fallback: 'every feature',
        note: 'Features to offer; an unchecked feature leaves the toolbar and stops its gestures and keys. Range selection is always available.',
      },
      {name: 'tool', kind: 'enum', options: ['select', 'split', 'envelope'], fallback: 'select',
        note: 'Pointer tool; a tool whose feature is unchecked reads as select. The toolbar and V, R, E keys reflect it here.'},
      {name: 'snap', kind: 'enum', options: ['off', 'grid', 'zero', '10ms', '100ms', '1s', 'beat', 'bar'], fallback: 'off',
        note: 'Snap for the cursor, range edges and markers; grid (the snap button) follows the finest drawn line, zero the nearest zero crossing, beat and bar the document grid.'},
      {name: 'show-envelopes', kind: 'bool', fallback: 'off', note: 'Draw segment gain envelopes over the waveform; the envelope tool always shows them.'},
      {name: 'pixels-per-second', kind: 'number', min: 0, max: 48000, placeholder: 'auto', fallback: 'working zoom — eight bars of the grid, else 10 s',
        note: 'Horizontal zoom; 0 fits the clip. Toolbar zoom, + and − and Ctrl/Cmd+wheel reflect it here once the gesture settles.'},
      {name: 'amplitude', kind: 'number', min: 1, max: 16, step: .25, placeholder: '1', fallback: '1', note: 'Vertical waveform magnification, clamped to 1–16; Alt+wheel reflects it.'},
      {name: 'fade-curve', kind: 'enum', options: ['linear', 'logarithmic', 'cosine'], fallback: 'linear', note: 'Curve of fade commands and fade handles.'},
      {name: 'follow', kind: 'bool', fallback: 'on', note: 'Keep the playhead in view while playback advances.'},
      {name: 'grid', kind: 'bool', fallback: 'off', note: 'Draw the document beat grid and enable beat snap, quantize and PageUp/PageDown beat jump; G toggles it.'},
      {name: 'quantize', kind: 'bool', fallback: 'off', note: 'With grid, ruler seeks land on the nearest beat and a playing player keeps its beat phase.'},
      {name: 'grid-edit', kind: 'bool', fallback: 'off',
        note: 'Grid Edit mode: set downbeat, BPM, tap, nudge, stretch, ×2/×½ and meter in the toolbar; dragging moves the grid. Needs editable and the grid feature.'},
    ],
    properties: [
      {name: 'editor', note: 'Borrow an editor from loadAudioClipEditor/createAudioClipEditor; required for editing. Never disposed; undefined detaches it.'},
      {name: 'clip', note: 'A decoded AudioClip drawn read-only; rejected while an editor is assigned.'},
      {name: 'interactionSession', note: 'Borrow a same-document session to share the range and drafts with another view.'},
      {name: 'editable / tools / tool / snap / showEnvelopes / pixelsPerSecond / amplitude / fadeCurve / follow / grid / quantize / gridEdit', note: 'Reflect their attributes with the same fallbacks.'},
      {name: 'visibleRange()', note: 'The visible span in seconds, or undefined before drawing.'},
    ],
    events: [
      {name: 'webaudio:editpreview', note: 'A handle, gain line, envelope point, marker or HUD drag produced a draft: AudioDraftResult with status preview.'},
      {name: 'webaudio:editcommit', note: 'AudioEditResult with status committed: one edit, undo, redo or processing result.'},
      {name: 'webaudio:editerror', note: '{error} from an edit the document cannot take; nothing changes.'},
      {name: 'clipsettingschange', note: '{settings, changed} after a toolbar, keyboard or wheel change to tool, snap, envelopes, zoom, amplitude, fade curve, grid, quantize or Grid Edit.'},
    ],
  },

  'audio-live-view': {
    tag: 'audio-live-view',
    entry: ENTRY,
    params: [
      {
        name: 'type',
        kind: 'enum',
        options: ['waveform', 'spectrogram'],
        fallback: 'waveform',
        note: 'How each captured column is painted. Unknown values fall back to waveform; changing it starts a fresh history.',
      },
      {
        name: 'source',
        kind: 'text',
        placeholder: '#my-player',
        fallback: 'no analyser — the strip says so and stays still',
        note: 'Selector of an element exposing a tap: .analyser, .inputAnalyser, .recorder.inputAnalyser or .player.analyser.',
      },
      {
        name: 'window-seconds',
        kind: 'number',
        min: 0.5,
        step: 0.5,
        fallback: '5',
        note: 'Seconds of history the ring holds, never below 0.5. Shorter windows draw wider columns.',
      },
      {
        name: 'height',
        kind: 'text',
        placeholder: '120',
        fallback: '4rem',
        note: 'Strip height — a bare number is px, anything else is used as a CSS length.',
      },
      {...WAVE_COLOR, note: 'Column fill for type="waveform".'},
      {
        name: 'color-map',
        kind: 'enum',
        options: COLORMAPS,
        fallback: 'viridis',
        note: 'Palette for type="spectrogram"; unknown names fall back to viridis.',
      },
    ],
    properties: [
      {name: 'analyser', note: 'Borrow an AnalyserNode directly; overrides source. Never created, mutated or disposed here.'},
      {name: 'live', note: 'Getter: whether an analyser is currently resolved.'},
      {name: 'windowSeconds', note: 'Getter: the clamped window-seconds attribute.'},
    ],
    events: [{name: 'webaudio:error', note: '{error} when presenter sizing, animation or the draw adapter fails.'}],
  },
};
