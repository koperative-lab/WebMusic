// @webmusic/score/view/element — every observed attribute of the View tags.
// Checked against `static get observedAttributes()` in
// packages/score/src/view/element/*.ts. `<score-view>`'s last ten names are
// spread from NUMERIC_OPTION_ATTRS / COLOR_OPTION_ATTRS in score-view.ts, and
// the fallbacks below include the Element's responsive and theme defaults;
// the standalone renderer retains its own fixed-size defaults.

import type {ElementParamCatalog} from './types';

const ENTRY = '@webmusic/score/view/element';
const scoreTypes = (...values: string[]) => ({attribute: 'type', values, fallback: 'piano-roll'});
const pitchTypes = (...values: string[]) => ({attribute: 'type', values, fallback: 'keyboard'});

/** Explicit source input shared by the score-loading elements. */
const SRC = {
  name: 'src',
  kind: 'text',
  placeholder: 'song.mid',
  fallback: 'nothing drawn until you assign .score',
  note: 'URL of a MIDI / MusicXML / MXL / ABC file, loaded through the sibling @webmusic/score/io capability.',
} as const;

const FORMAT = {
  name: 'format',
  kind: 'enum',
  options: ['midi', 'mxl', 'musicxml', 'abc'],
  fallback: 'adaptive — taken from the src extension, else sniffed from the bytes',
  note: 'Forces the parser when the extension is missing or lies.',
} as const;

export const SCORE_VIEW_PARAMS: ElementParamCatalog = {
  'score-view': {
    tag: 'score-view',
    entry: ENTRY,
    params: [
      {...SRC, fallback: 'borrow player data, else await .score'},
      FORMAT,
      {
        name: 'player',
        kind: 'text',
        placeholder: '#my-player',
        fallback: 'standalone score input',
        note: 'Borrow the selected player’s score and current position; initialize and follow paused, playing, seek and source changes.',
      },
      {
        name: 'type',
        kind: 'enum',
        options: ['piano-roll', 'staff', 'waterfall', 'map', 'thumbnail'],
        fallback: 'piano-roll',
        note: 'Which drawing is rendered; changing it disposes the old visualizer and re-renders. An unknown value falls back to piano-roll.',
      },
      {name: 'for-part', kind: 'text', placeholder: 'P1', fallback: 'every part', note: 'Map only: shade one part by id or name.', when: scoreTypes('map')},
      {name: 'cells', kind: 'number', min: 1, step: 1, fallback: '64', note: 'Map only: upper bound on density cells; bars are grouped evenly.', when: scoreTypes('map')},
      {
        name: 'width',
        kind: 'text',
        placeholder: '640',
        fallback: 'stretches to the container',
        note: 'Host width — a bare number is px, any other CSS length passes through untouched.',
      },
      {
        name: 'height',
        kind: 'text',
        placeholder: '240',
        fallback: 'natural height; thumbnail uses 3rem plus any annotations',
        note: 'Host height, same rule as width; a fixed height also sets overflow-y: auto, so a taller drawing scrolls inside the box.',
      },
      {
        name: 'show-annotations',
        kind: 'bool',
        fallback: 'on — show score directions',
        note: 'Show words, dynamics, tempo, rehearsal and pedal/hairpin marks in every type; false removes their drawing space without changing playback.',
      },
      {
        name: 'show-only-octaves-used',
        when: scoreTypes('waterfall'),
        kind: 'bool',
        fallback: 'on — the octaves used by the score',
        note: 'Waterfall only: show the octaves the score actually uses. Set false for the standard A0–C8 piano pitch range.',
      },
      {
        name: 'scroll-type',
        when: scoreTypes('staff'),
        kind: 'enum',
        options: ['page', 'note', 'bar'],
        fallback: 'page',
        note: 'Staff only: how the staff follows the playhead. An unrecognised value is ignored, leaving the default.',
      },
      {
        name: 'split-staves',
        when: scoreTypes('staff'),
        kind: 'bool',
        fallback: 'on — preserve source staff assignments',
        note: 'Staff only: preserve the score’s separate staves. Set false to combine staves within each part; parts remain separate. Changing this display option preserves the score and playback position.',
      },
      {
        name: 'pixels-per-second',
        when: scoreTypes('piano-roll', 'staff', 'waterfall'),
        kind: 'number',
        placeholder: '30',
        fallback: '30 (staff: shared readable scale, or compact for one layer)',
        note: 'Piano-roll/waterfall pixels per second. Staff uses a common quarter axis: a positive value gives value × 60 / initialQpm pixels per quarter; the automatic multilayer scale uses the smallest quantized score interval.',
      },
      {
        name: 'note-height',
        when: scoreTypes('piano-roll', 'staff'),
        kind: 'number',
        placeholder: '6',
        fallback: '6',
        note: 'Piano-roll note height or staff notation scale in px. Zero falls back to 6.',
      },
      {
        name: 'note-spacing',
        when: scoreTypes('piano-roll', 'staff', 'waterfall'),
        kind: 'number',
        placeholder: '1',
        fallback: '1',
        note: 'Note spacing in px; piano-roll/waterfall subtract it from note length and staff passes it to notation layout. Zero gives touching note spans.',
      },
      {
        name: 'min-pitch',
        when: scoreTypes('piano-roll', 'waterfall'),
        kind: 'number',
        step: 1,
        placeholder: '48',
        fallback: 'lowest note in the score, two semitones lower',
        note: 'Bottom of the pitch range drawn (MIDI number). Piano-roll and waterfall only — the staff spaces notes from notation, not from a pitch window.',
      },
      {
        name: 'max-pitch',
        when: scoreTypes('piano-roll', 'waterfall'),
        kind: 'number',
        step: 1,
        placeholder: '84',
        fallback: 'highest note in the score, two semitones higher',
        note: 'Top of the pitch range drawn (MIDI number). Set both ends and the score-derived padding is skipped. Ignored by the staff.',
      },
      {
        name: 'white-note-width',
        when: scoreTypes('waterfall'),
        kind: 'number',
        placeholder: '20',
        fallback: 'fit the available width',
        note: 'Waterfall only: natural-note pitch-column width in px; a positive explicit value disables fitting. Clear both pitch-column widths to restore fitting.',
      },
      {
        name: 'black-note-width',
        when: scoreTypes('waterfall'),
        kind: 'number',
        placeholder: '13.3',
        fallback: '0.62 × natural-note column width',
        note: 'Waterfall only: accidental pitch-column width in px; a positive explicit value disables fitting. Without white-note-width, natural-note columns use 20px.',
      },
      {
        name: 'default-key',
        when: scoreTypes('staff'),
        kind: 'number',
        step: 1,
        placeholder: '0',
        fallback: '0 (C major)',
        note: 'Staff only: fallback chromatic major-key index, 0–11 (0 = C, 1 = D♭, 2 = D), used when the score carries none.',
      },
      {
        name: 'note-color',
        when: scoreTypes('piano-roll', 'staff', 'waterfall', 'thumbnail'),
        kind: 'text',
        placeholder: '#2563eb',
        fallback: 'currentColor for thumbnail; otherwise --wm-foreground',
        note: 'Idle note fill: thumbnail accepts CSS colors; score renderers accept #rgb, #rrggbb, rgb() or r, g, b triples.',
      },
      {
        name: 'active-note-color',
        when: scoreTypes('piano-roll', 'staff', 'waterfall'),
        kind: 'text',
        placeholder: '#f59e0b',
        fallback: '--wm-score-view-active-note, else red rgb(240, 84, 119)',
        note: 'Color of sounding notes; staff also highlights their stems and flags. Uses the same syntax as note-color. The Element default is independent of the generic application accent.',
      },
    ],
    properties: [
      {name: 'score', note: 'Assign a loaded Score; overrides src and cancels any in-flight load.'},
      {name: 'currentTime', note: 'Read-only nominal score position in seconds.'},
      {name: 'active', note: 'Read-only MIDI pitches at the current score position; empty for map and thumbnail.'},
      {name: 'configure(configuration)', note: 'Atomically select piano-roll, staff or waterfall with compatible options. Map and thumbnail use type/options/attributes.'},
      {name: 'options', note: 'ScoreViewRenderOptions merged over the attributes (property wins) — including knobs with no attribute form, e.g. virtualization and the staff instruments filter.'},
      {name: 'type', note: 'Reflects the five-value Element type; the setter writes the attribute.'},
      {name: 'forPart', note: 'Read-only map part filter, or undefined.'},
      {name: 'cells', note: 'Read-only map cell limit, default 64 and minimum 1.'},
    ],
    events: [{name: 'webscore:seek', note: 'Map only: {quarters, seconds}, with nominal seconds; bubbling and composed.'}],
  },

  'sheet-view': {
    tag: 'sheet-view',
    entry: ENTRY,
    params: [
      SRC,
      FORMAT,
      {
        name: 'player',
        kind: 'text',
        placeholder: '#my-player',
        fallback: 'no cursor movement',
        note: 'Selector of a player — the OSMD cursor tracks its note events; a note released mid-chord leaves its siblings lit.',
      },
      {
        name: 'follow-cursor',
        kind: 'bool',
        fallback: 'on',
        note: 'Scroll the cursor into view on every move. Set to false to keep the page still; changing this preserves the engraving and current notes.',
      },
      {
        name: 'width',
        kind: 'text',
        placeholder: '100%',
        fallback: 'stretches to the container',
        note: 'Host width — a bare number is px, any other CSS length passes through. The engraving keeps a readable inner width and scrolls in narrower hosts; this does not reload the source.',
      },
      {
        name: 'height',
        kind: 'text',
        placeholder: '320',
        fallback: 'as tall as the engraving',
        note: 'Host height; a fixed height scrolls a long score inside the stage. Changing height does not reload or re-engrave the score.',
      },
    ],
    properties: [
      {name: 'score', note: 'Assign a loaded Score; overrides src.'},
      {name: 'OpenSheetMusicDisplay', note: 'Inject the OSMD constructor instead of importing the peer (bundlers, tests, pinned builds).'},
      {name: 'osmd', note: 'Reuse an already-constructed OSMD instance rather than building one.'},
    ],
  },

  'pitch-view': {
    tag: 'pitch-view', entry: ENTRY,
    params: [
      {name: 'type', kind: 'enum', options: ['keyboard', 'staff', 'fretboard'], fallback: 'keyboard', note: 'One passive sounding-pitch surface; switching preserves the current held notes.'},
      {name: 'player', kind: 'text', placeholder: '#my-player', fallback: 'use source, else wait for notes', note: 'Borrow held-note snapshots and events from one selected player; no score load or playback commands.'},
      {name: 'source', kind: 'text', placeholder: '#my-input', fallback: 'use player, else wait for notes', note: 'Legacy note-source selector used only when player is empty.'},
      {name: 'low', kind: 'number', step: 1, fallback: '36', note: 'Keyboard only: requested lowest MIDI key, rounded.', when: pitchTypes('keyboard')},
      {name: 'high', kind: 'number', step: 1, fallback: '84', note: 'Keyboard only: requested highest MIDI key, rounded.', when: pitchTypes('keyboard')},
      {name: 'system', kind: 'enum', options: ['grand', 'treble', 'bass'], fallback: 'grand', note: 'Staff only: clef system for the current pitches.', when: pitchTypes('staff')},
      {name: 'spelling', kind: 'enum', options: ['sharp', 'flat'], fallback: 'sharp', note: 'Pitch labels; this readout does not infer a key.'},
      {name: 'density', kind: 'enum', options: ['comfortable', 'compact'], fallback: 'comfortable', note: 'Pitch-surface type and spacing defaults.'},
      {name: 'scheme', kind: 'enum', options: ['inherit', 'system', 'light', 'dark'], fallback: 'inherit', note: 'Use the surrounding palette, system preference, or an explicit palette.'},
      {name: 'tuning', kind: 'text', placeholder: 'standard', fallback: 'standard', note: 'Fretboard only: standard or 1–12 comma/space-separated open-string MIDI numbers in visual string order.', when: pitchTypes('fretboard')},
      {name: 'first-fret', kind: 'number', min: 0, max: 24, step: 1, fallback: '0', note: 'Fretboard only: first displayed fret, clamped to 0–24.', when: pitchTypes('fretboard')},
      {name: 'frets', kind: 'number', min: 1, max: 24, step: 1, fallback: '12', note: 'Fretboard only: visible fret count, clamped to 1–24.', when: pitchTypes('fretboard')},
      {name: 'follow', kind: 'enum', options: ['active', 'none'], fallback: 'active', note: 'Keyboard only: reveal newly active pitches, or none to leave scrolling to a shared application container.', when: pitchTypes('keyboard')},
      {name: 'fit-to-width', kind: 'bool', fallback: 'off', note: 'Keyboard only: fit the complete normalized pitch range to the container, overriding explicit key widths and the CSS minimum width. Key heights remain unchanged.', when: pitchTypes('keyboard')},
      {name: 'white-key-width', kind: 'number', min: 1, step: 1, placeholder: '32', fallback: 'responsive width', note: 'Keyboard only: fixed natural-key width in px; the full board scrolls when needed. Ignored while fit-to-width is on.', when: pitchTypes('keyboard')},
      {name: 'black-key-width', kind: 'number', min: 1, step: 1, placeholder: '20', fallback: '0.62 × white-key width', note: 'Keyboard only: accidental-key width in px, capped at white width. Alone, derives white width by dividing by 0.62. Ignored while fit-to-width is on.', when: pitchTypes('keyboard')},
      {name: 'white-key-height', kind: 'number', min: 1, step: 1, placeholder: '80', fallback: 'theme height', note: 'Keyboard only: natural-key height in px; does not change pitch-column width.', when: pitchTypes('keyboard')},
      {name: 'black-key-height', kind: 'number', min: 1, step: 1, placeholder: '50', fallback: 'theme proportion', note: 'Keyboard only: accidental-key height in px, capped at white-key height.', when: pitchTypes('keyboard')},
      {name: 'fret-width', kind: 'number', min: 1, step: 1, placeholder: '36', fallback: 'responsive fret spacing', note: 'Fretboard only: fixed distance between adjacent fret wires in px.', when: pitchTypes('fretboard')},
      {name: 'string-spacing', kind: 'number', min: 1, step: 1, placeholder: '24', fallback: 'density geometry', note: 'Fretboard only: distance between adjacent strings in px.', when: pitchTypes('fretboard')},
      {name: 'string-width', kind: 'number', min: 0.1, step: 0.1, placeholder: '1', fallback: 'density stroke', note: 'Fretboard only: string line thickness in px, independent of viewport scale.', when: pitchTypes('fretboard')},
    ],
    properties: [
      {name: 'active', note: 'Read-only copy of the ascending sounding MIDI pitches, including notes outside the visible range.'},
      {name: 'type', note: 'Writable reflected type; unknown values resolve to keyboard.'},
      {name: 'low', note: 'Read-only requested keyboard lower endpoint.'},
      {name: 'high', note: 'Read-only requested keyboard upper endpoint.'},
      {name: 'system', note: 'Read-only resolved clef system.'},
      {name: 'spelling', note: 'Read-only resolved spelling.'},
      {name: 'density', note: 'Read-only resolved density.'},
      {name: 'scheme', note: 'Read-only resolved color scheme.'},
      {name: 'tuning', note: 'Read-only copy of the resolved open-string MIDI pitches.'},
      {name: 'firstFret', note: 'Read-only clamped first fret.'},
      {name: 'frets', note: 'Read-only clamped fret count.'},
      {name: 'whiteKeyWidth / blackKeyWidth / whiteKeyHeight / blackKeyHeight', note: 'Read-only positive pixel requests, or undefined for default keyboard geometry.'},
      {name: 'fretWidth / stringSpacing / stringWidth', note: 'Read-only positive pixel requests, or undefined for default fretboard geometry.'},
      {name: 'follow', note: 'Read-only keyboard follow mode, active or none.'},
      {name: 'fitToWidth', note: 'Read-only keyboard fitting flag, false by default; configure through fit-to-width.'},
    ],
  },
};
