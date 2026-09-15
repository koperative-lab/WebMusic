// @webmusic/score/play/element — five interactive roles plus the nonvisual rack-part declaration.
// Checked against `static get observedAttributes()` in
// packages/score/src/play/element/*.ts.

import type {ElementParamCatalog} from './types';

const ENTRY = '@webmusic/score/play/element';

export const SCORE_PLAY_PARAMS: ElementParamCatalog = {
  'score-player': {
    tag: 'score-player',
    entry: ENTRY,
    params: [
      {
        name: 'src',
        kind: 'text',
        placeholder: 'song.mid',
        fallback: 'nothing plays until you assign .score, .rack or .controller',
        note: 'URL of a MIDI / MusicXML / MXL / ABC file, loaded through the sibling @webmusic/score/io capability.',
      },
      {
        name: 'format',
        kind: 'enum',
        options: ['midi', 'mxl', 'musicxml', 'abc'],
        fallback: 'adaptive — taken from the src extension, else sniffed from the bytes',
        note: 'Forces the parser when the extension is missing or lies. Only read while src is being loaded.',
      },
      {
        name: 'sound-font',
        kind: 'text',
        placeholder: 'https://cdn/{midi}.mp3',
        fallback: 'the built-in oscillator synth',
        note: 'URL template with a {midi} placeholder — one sample per note. A value without {midi}, or any value once .sound is assigned, is ignored.',
      },
      {
        name: 'volume',
        kind: 'number',
        min: 0,
        step: 0.05,
        placeholder: '1',
        fallback: '1 — unchanged',
        note: 'Native player volume, applied live and clamped to >= 0; ignored once .volume is assigned. Inert in Rack/controller modes; use rack-control for Rack mixing.',
      },
      {
        name: 'rate',
        kind: 'number',
        min: 0,
        step: 0.1,
        placeholder: '1',
        fallback: '1 — score tempo',
        note: 'Native playback speed, applied live. Non-finite or non-positive values fall back to 1; ignored once .rate is assigned. Rack members keep their own rates; explicit .rate writes also reach a borrowed controller.',
      },
      {
        name: 'pan',
        kind: 'number',
        min: -1,
        max: 1,
        step: 0.1,
        placeholder: '0',
        fallback: '0 — centre',
        note: 'Native stereo pan, applied live and clamped to [-1, 1]; ignored once .pan is assigned. Inert in Rack/controller modes.',
      },
      {
        name: 'loop',
        kind: 'bool',
        fallback: 'off — the piece stops at the end',
        note: 'Native whole-piece looping, applied live. Ignored once .loop is assigned; inert in Rack/controller modes.',
      },
      {
        name: 'time-control',
        kind: 'enum',
        options: ['off', 'simple', 'full'],
        fallback: 'off — play button and seek bar only',
        note: 'How much of the clock to show: simple is the elapsed time, full adds the total. Changes in place, without remounting the transport.',
      },
      {
        name: 'volume-control',
        kind: 'enum',
        options: ['off', 'fader', 'knob'],
        fallback: 'off — volume is settable but has no control',
        note: 'Add a volume control to the chrome, as a horizontal fader or a rotary knob. Moves the same knob the volume attribute sets; needs the element to own its engine, so it is inert in .rack and .controller mode.',
      },
    ],
    properties: [
      {name: 'score', note: 'Assign a loaded Score; overrides src.'},
      {name: 'playback', note: 'Read-only stable ScorePlaybackSource: resolved data, readiness and revisioned snapshots/subscriptions.'},
      {name: 'resolvedScore', note: 'Read-only current native score, including src; undefined in Rack/controller modes.'},
      {name: 'getPlaybackSnapshot()', note: 'Native position, rate, playing and held note snapshot; undefined before mounting or in Rack/controller modes.'},
      {name: 'seekNominal(seconds)', note: 'Seek nominal score seconds and return a Promise. Rejects in Rack mode; use seek() or seekFraction() there.'},
      {name: 'rack', note: 'Borrow a Rack and coordinate member transport commands; overrides a nested desk, score and src.'},
      {name: 'controller', note: 'Borrow a headless PlayerController — the element becomes chrome only and loads nothing. Wins over rack / score / src.'},
      {name: 'sound', note: 'Borrowed HeadlessSynth; overrides the sound-font attribute.'},
      {name: 'effect', note: 'Post-processing chain for the owned single-score output. In rack/controller mode, configure that owner instead.'},
      {name: 'audioContext', note: 'Share an existing AudioContext (e.g. with an analyser).'},
      {name: 'destination', note: 'Route the output into this AudioNode instead of the context destination.'},
      {name: 'rate', note: 'Property form of the rate attribute. Assigning it pins the knob, and it is the only transport value pushed onto a borrowed controller.'},
      {name: 'volume', note: 'Native volume property; assignment pins the setting. Inert in Rack/controller modes.'},
      {name: 'pan', note: 'Native pan property; assignment pins the setting. Inert in Rack/controller modes.'},
      {name: 'loop', note: 'Native loop property; assignment pins the setting. Inert in Rack/controller modes.'},
      {name: 'currentTime', note: 'Read-only transport seconds from the mounted owner; Rack follows its longest built member.'},
      {name: 'duration', note: 'Read-only transport duration from the mounted owner; Rack remains 0 until member players are built.'},
      {name: 'play()', note: 'Awaits native/Rack startup; borrowed-controller mode delegates immediately. pause() / stop() / seek(s) / seekFraction(f) use the same mounted transport.'},
    ],
    events: [
      {name: 'webscore:noteon', note: '{midi, startTime} — startTime is the note onset in nominal score seconds.'},
      {name: 'webscore:noteoff', note: 'Same detail as noteon, at the release.'},
      {name: 'webscore:timeupdate', note: '{nominalSeconds, transportSeconds, transportDurationSeconds, progress} on every cursor tick and seek.'},
      {name: 'webscore:scorechange', note: '{score} as the native score is cleared or replaced.'},
      {name: 'webscore:statechange', note: 'Native playback snapshot after a state/settings change.'},
      {name: 'webscore:seek', note: 'An explicit non-controller command or native seek-bar navigation was issued; no detail.'},
      {name: 'webscore:stop', note: 'An explicit non-controller stop was issued; no detail.'},
      {name: 'webscore:end', note: 'Fired once the piece finishes.'},
      {name: 'webscore:error', note: '{operation: "seek" | "playback", error}; bubbling and composed. Reports async native void-seek failures or mounted playback/controller errors.'},
    ],
  },

  'rack-part': {
    tag: 'rack-part',
    entry: ENTRY,
    // A declaration, so every attribute names a piece of the member it declares
    // — never anything about playback, which belongs to the rack that builds it.
    params: [
      {
        name: 'id',
        kind: 'text',
        placeholder: 'lead',
        fallback: 'part-N — position among the desk’s direct children',
        note: 'Rack member id and fader label. Changing it reconciles the declaration with the resolved Score and does not refetch src.',
      },
      {
        name: 'src',
        kind: 'text',
        placeholder: '/midi/lead.mid',
        fallback: 'nothing is loaded, and the part declares no member',
        note: 'URL of the score this part contributes, loaded through the optional @webmusic/score/io peer.',
      },
      {
        name: 'format',
        kind: 'enum',
        options: ['midi', 'mxl', 'musicxml', 'abc'],
        fallback: 'adaptive — taken from the src extension, else sniffed from the bytes',
        note: 'Forces the parser when the extension is missing or lies. Only read while src is being loaded.',
      },
      {
        name: 'sound',
        kind: 'enum',
        options: ['sine', 'square', 'sawtooth', 'triangle'],
        fallback: "the rack's own default voice",
        note: 'Oscillator this part is voiced with. Ignored once .sound is assigned a synth.',
      },
    ],
    properties: [
      {name: 'score', note: 'A Score assigned directly, which wins over src.'},
      {name: 'sound', note: 'A HeadlessSynth assigned directly, which wins over the sound attribute.'},
    ],
    events: [
      {name: 'webscore:error', note: '{operation: "rack-part", error} when loading the score or reading the sound fails.'},
    ],
  },
  'rack-control': {
    tag: 'rack-control',
    entry: ENTRY,
    // Every attribute is about what the desk SHOWS. What it mixes is the rack's
    // business, and the rack's members are headless — a member is a score and a
    // sound, not an element — so there is nothing here about them.
    params: [
      {
        name: 'master',
        kind: 'bool',
        fallback: 'on — a master fader above the channels',
        note: 'Show the master strip. A desk without one is a submix: channel trims and nothing over them.',
      },
      {
        name: 'mute',
        kind: 'bool',
        fallback: 'on — an M button per channel',
        note: 'Show the per-channel mute. Hidden, the command is not offered to the mixer at all.',
      },
      {
        name: 'solo',
        kind: 'bool',
        fallback: 'on — an S button per channel',
        note: 'Show the per-channel solo. Exclusive: soloing one channel clears the rest.',
      },
    ],
    properties: [
      {name: 'rack', note: 'The Rack to mix. An assigned rack is adopted and never disposed; without one the element creates its own.'},
      {name: 'effect', note: 'A reusable Effect or Effect.chain applied once to the rack\'s summed master output.'},
    ],
    events: [
      {name: 'webscore:error', note: '{operation: "rack-control", error} when mounting or driving the mixer throws.'},
    ],
  },

  'note-input': {
    tag: 'note-input',
    entry: ENTRY,
    params: [
      {
        name: 'layout',
        kind: 'enum',
        options: ['piano', 'grid', 'chords'],
        fallback: 'piano',
        note: 'Which surface renders. An unrecognised value falls back to piano; every change releases the held notes first.',
      },
      {
        name: 'start',
        kind: 'number',
        step: 1,
        fallback: '48 on piano, 60 elsewhere',
        note: 'Lowest MIDI note of the piano range. With keyboard it is the octave anchor instead (default 48 on the grid); the grid without keyboard ignores it.',
      },
      {
        name: 'end',
        when: {attribute: 'layout', values: ['piano'], fallback: 'piano'},
        kind: 'number',
        step: 1,
        fallback: '71 on piano, 72 elsewhere',
        note: 'Highest MIDI note of the piano range. Ignored when keyboard is set — the QWERTY span fixes the top — and by the grid and chords layouts.',
      },
      {
        name: 'velocity',
        kind: 'number',
        min: 1,
        max: 127,
        fallback: '100 (110 on the grid)',
        note: 'Velocity carried in every note event and passed to .onNote. Clamped to 1…127.',
      },
      {
        name: 'row-interval',
        kind: 'number',
        fallback: '5',
        note: 'Read but never used by the built-in layouts — it exists for the exported gridCellMidi() helper behind custom isomorphic surfaces.',
        inert: 'no built-in layout reads it; only the exported gridCellMidi() helper does',
      },
      {
        name: 'keyboard',
        kind: 'text',
        placeholder: 'present = on',
        fallback: 'off — pointer and touch only',
        note: 'Presence-only — any value, "false" included, turns it on. Adds QWERTY musical typing on any layout, with Z / X shifting the octave.',
      },
      {
        name: 'map',
        when: {attribute: 'layout', values: ['grid'], fallback: 'piano'},
        kind: 'text',
        placeholder: 'z1=35,a1=50',
        fallback: 'no playable pads on the grid',
        note: 'layout="grid" only: comma / semicolon / space separated ref=midi pairs over rows q, a, z × columns 1–10. Unmapped cells stay dimmed. Ignored once .pads is assigned.',
      },
    ],
    properties: [
      {name: 'pads', note: 'Override the grid map with {midi, label?}[] — bottom-left is index 0. Takes precedence over map.'},
      {name: 'chords', note: 'Override the chord set with {label, notes}[] (layout="chords"). Defaults to the C-major diatonic triads.'},
      {name: 'onNote', note: 'Callback (midi, velocity, on) fired on every press and release, after the DOM event.'},
      {name: 'releaseHeld()', note: 'Release every held note and forget pointer, chord and keyboard state.'},
    ],
    events: [
      {name: 'webscore:noteon', note: '{midi, velocity} — bubbles and crosses the shadow boundary.'},
      {name: 'webscore:noteoff', note: 'Same detail, on release.'},
    ],
  },

  'score-recorder': {
    tag: 'score-recorder',
    entry: ENTRY,
    params: [
      {
        name: 'bpm',
        kind: 'number',
        min: 1,
        fallback: '120',
        note: 'Tempo written into the notated take. Read when a take is stopped, so it applies to the next stop rather than the running one.',
      },
      {
        name: 'quantize',
        kind: 'number',
        min: 0,
        fallback: '0 — the performed timing is kept',
        note: 'Snap grid in quarters (0.25 = sixteenths). Read at the same moment as bpm, when a take is stopped.',
      },
    ],
    properties: [
      {name: 'input()', note: '(midi, velocity, on) — monitor a note live and, when armed, capture it. The usual way to feed a note surface in.'},
      {name: 'source', note: 'Borrowed EventTarget for note events while connected. Assignment survives reconnect; replacement discards unmatched presses and preserves completed notes.'},
      {name: 'sound', note: 'Borrowed HeadlessSynth for live monitoring and take playback; defaults to a triangle oscillator.'},
      {name: 'audioContext', note: 'Share an AudioContext with monitoring and take playback.'},
      {name: 'record()', note: 'Arm a fresh take and discard the previous one. stop() notates the take and returns it.'},
      {name: 'take', note: 'Read-only: the last notated Score, or undefined before the first stop.'},
      {name: 'recordingActive', note: 'Read-only: whether a take is currently armed.'},
      {name: 'player', note: 'Read-only InteractivePlayer used for live monitoring.'},
    ],
    events: [
      {name: 'webscore:recorded', note: '{score} once a take has been stopped and notated.'},
      {name: 'webscore:error', note: '{operation: "play", error} when take playback fails.'},
    ],
  },

  'synth-panel': {
    tag: 'synth-panel',
    entry: ENTRY,
    params: [
      {
        name: 'sections',
        kind: 'text',
        placeholder: 'sound,envelope,eq',
        fallback: 'sound,effects',
        note: 'Comma list choosing which blocks render, in the order given: sound, effects, envelope, eq, lfo, macros. Unknown or duplicate names are dropped; an empty result falls back to sound,effects.',
      },
    ],
    properties: [
      {name: 'sound', note: 'SoundParam[] — one rotary knob each, grouped by `group`. `.params` is a long-standing alias.'},
      {name: 'context', note: 'The AudioContext the effects / EQ chain is built on. Required by the effects and eq sections.'},
      {name: 'effects', note: 'Effect[] the panel builds into a chain and exposes knobs for. `.effect` accepts a single one.'},
      {name: 'input', note: 'Read-only input port, stable while the AudioContext stays the same. Without applicable effects or EQ, the ports provide a dry bypass.'},
      {name: 'output', note: 'Read-only output port, stable while the AudioContext stays the same. Undefined, like input, without a context.'},
      {name: 'envelope', note: 'Partial ADSR assignment; the getter returns the whole envelope.'},
      {name: 'ranges', note: 'Per-stage envelope maxima in seconds ({attackMax, decayMax, releaseMax}) scaling the X axis.'},
      {name: 'apply', note: 'Callback run with the current ADSR on every envelope change, alongside webscore:envelope.'},
      {name: 'bands', note: 'Override the three EQ bands; assigning rebuilds the audio chain.'},
      {name: 'target', note: 'Borrowed LFO modulation target. Assignment never applies a value eagerly.'},
      {name: 'lfo', note: 'Partial LFO configuration: shape, rate, depth, phase and running. The getter returns the complete current state.'},
      {name: 'macros', note: 'SynthMacro[] — each macro knob drives many targets at once.'},
    ],
    events: [
      {name: 'webscore:envelope', note: 'The current {attack, decay, sustain, release} whenever the ADSR editor moves.'},
      {name: 'webscore:macro', note: '{index, label, value} whenever a macro knob is turned.'},
      {name: 'webscore:lfo', note: '{shape, rate, depth, phase, running} when the LFO configuration or run state changes.'},
      {name: 'webscore:error', note: '{operation: "synth-panel", error} from the envelope, LFO, EQ or teardown paths.'},
    ],
  },
};
