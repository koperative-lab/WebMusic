// @webmusic/audio/play/element — every observed attribute of canonical Play tags.
// Checked against `static get observedAttributes()` in
// packages/audio/src/play/element/*.ts.

import type {ElementParamCatalog} from './types';

const ENTRY = '@webmusic/audio/play/element';

/** The three engines an `engine` attribute may name (PlayerEngineKind). */
const ENGINES = ['auto', 'buffer', 'media'] as const;

export const AUDIO_PLAY_PARAMS: ElementParamCatalog = {
  'audio-player': {
    tag: 'audio-player',
    entry: ENTRY,
    params: [
      {
        name: 'src',
        kind: 'text',
        placeholder: 'song.wav',
        fallback: 'no clip until you assign .clip / .player or call .load()',
        note: 'URL of an audio file. Loading it replaces the selected clip; removing it clears a clip that came from src.',
      },
      {
        name: 'format',
        kind: 'enum',
        options: ['wav', 'aiff', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'webm'],
        fallback: 'adaptive — taken from the src extension, else sniffed from the bytes',
        note: 'Forces the decode format. Changing it can only land through a reload of src.',
      },
      {
        name: 'controls',
        kind: 'bool',
        fallback: 'on — the transport is visible',
        note: 'Visibility only: the transport stays mounted and subscribed, so hiding it keeps the playhead.',
      },
      {
        name: 'loop',
        kind: 'text',
        placeholder: '2.5,8',
        fallback: 'no looping',
        note: 'Bare (or "true"/"loop") loops the whole clip; "a,b" — also "a-b"/"a:b" — loops those seconds. Applied live.',
      },
      {
        name: 'engine',
        kind: 'enum',
        options: [...ENGINES],
        fallback: 'auto',
        note: 'buffer decodes into memory, media streams through an <audio> element; auto prefers media above ten minutes.',
      },
      {
        name: 'preserves-pitch',
        kind: 'bool',
        fallback: 'off',
        note: 'Holds pitch while rate ≠ 1 on the media engine; a documented no-op on the buffer engine.',
      },
      {
        name: 'volume',
        kind: 'number',
        min: 0,
        max: 4,
        step: 0.1,
        fallback: '1',
        note: 'Linear master volume, clamped to 0–4 and applied live.',
      },
      {
        name: 'rate',
        kind: 'number',
        min: 0.25,
        max: 4,
        step: 0.05,
        fallback: '1',
        note: 'Playback speed, clamped to 0.25–4 and applied live.',
      },
      {
        name: 'pan',
        kind: 'number',
        min: -1,
        max: 1,
        step: 0.1,
        fallback: '0',
        note: 'Stereo position, clamped to -1–1 and applied live.',
      },
      {
        name: 'preload',
        kind: 'bool',
        fallback: 'off — no warm-up until the first play',
        note: 'Warms context, graph and decoded buffer on mount. `preload="none"` opts out, as on <audio>.',
      },
    ],
    properties: [
      {name: 'clip', note: 'Assign a loaded AudioClip; supersedes src and any in-flight load.'},
      {name: 'player', note: 'Borrow an existing AudioPlayer — the element never disposes what it borrows.'},
      {name: 'effect', note: 'An Effect spliced into the graph; reassigning rebuilds an owned player.'},
      {name: 'audioContext', note: 'Share one page-wide AudioContext. A supplied context is never closed here.'},
      {name: 'clock', note: 'Read-only TransportClockReader of the active engine; absent before first play and on the media engine.'},
      {name: 'analyser', note: 'The player’s AnalyserNode — what an <audio-meter> monitors. Reading it builds the graph.'},
      {name: 'beginScratch()', note: 'Borrow an audible scratch session for a nonempty decoded clip; unsupported sources return undefined.'},
      {name: 'scratching', note: 'Read-only state: an exclusive scratch session owns audible playback, including release inertia.'},
    ],
    events: [
      {name: 'webaudio:sourcechange', note: '{clip, revision} when the selected source changes, without requiring a graph.'},
      {name: 'webaudio:playerchange', note: '{player} when the central owner identity changes; companions rebind.'},
      {name: 'webaudio:statechange', note: '{playing} after playback state changes.'},
      {name: 'webaudio:timeupdate', note: '{seconds, duration, progress} on the cursor cadence.'},
      {name: 'webaudio:loaded', note: '{duration} once the engine graph is built.'},
      {name: 'webaudio:end', note: 'The finished AudioClip.'},
      {name: 'webaudio:seek', note: '{seconds, region?, progress} — the element’s own transport moved; programmatic seek() stays silent.'},
      {name: 'webaudio:regionenter', note: 'The Region the playhead entered.'},
      {name: 'webaudio:regionleave', note: 'The Region the playhead left.'},
      {name: 'webaudio:beat', note: '{index, seconds} on each beat-grid crossing.'},
      {name: 'webaudio:error', note: 'A failed load, an engine failure or a presenter failure.'},
    ],
  },

  'audio-playlist': {
    tag: 'audio-playlist',
    entry: ENTRY,
    params: [
      {name: 'player', kind: 'text', placeholder: '#session', fallback: 'standalone compatibility mode', note: 'Unique central audio-player selector. Explicit .player takes precedence; late insertion and replacement are observed.'},
      {
        name: 'src',
        kind: 'text',
        placeholder: 'one.mp3, two.mp3',
        fallback: 'entries read from light-DOM children (data-src, or an <a href>)',
        note: 'A comma or whitespace separated URL list. Ignored once .entries is assigned; a change reconciles entries without replacing unchanged sources.',
      },
      {
        name: 'loop',
        kind: 'bool',
        fallback: 'off',
        note: 'Loops the LIST — restart at the first entry after the last, and let previous/next wrap. Updates policy without replacing the current entry.',
      },
      {
        name: 'autoplay',
        kind: 'bool',
        fallback: 'off',
        note: 'Calls play() on mount. Browsers still gate sound until the reader interacts with the page.',
      },
      {
        name: 'volume',
        kind: 'number',
        min: 0,
        step: 0.1,
        fallback: '1',
        note: 'Applied live to the entry that is playing, never below 0 — changing it cannot interrupt it.',
      },
      {
        name: 'rate',
        kind: 'number',
        min: 0.25,
        max: 4,
        step: 0.05,
        fallback: '1',
        note: 'Applied live to the entry that is playing, clamped to 0.25–4.',
      },
      {
        name: 'prefetch',
        kind: 'bool',
        fallback: 'on',
        note: 'Fetch and decode the NEXT entry while the current one plays. Updates policy without replacing the current entry.',
      },
      {
        name: 'engine',
        kind: 'enum',
        options: [...ENGINES],
        fallback: 'auto',
        note: 'Forwarded to every entry’s player; an unknown value is ignored. Changing engines rebuilds the queue.',
      },
      {
        name: 'skip-failed',
        kind: 'bool',
        fallback: 'on',
        note: 'Advance past an entry that fails to load instead of stopping there. Updates policy without replacing the current entry.',
      },
    ],
    properties: [
      {name: 'player', note: 'Borrow the central AudioPlayer or its Element; linked controls share its selected backend.'},
      {name: 'entries', note: 'AudioPlaylistEntry[] — {id, label?, src?, clip?, streaming?, format?}. Overrides src and children.'},
      {name: 'playlist', note: 'The underlying AudioPlaylist controller. Borrowed — do not dispose it.'},
      {name: 'activePlayer', note: 'The current entry’s low-level AudioClipPlayer, replaced on advance.'},
      {name: 'index', note: 'Index of the current entry, or -1 when the queue is empty.'},
      {name: 'clip', note: 'PlayerLike facade: the current entry’s AudioClip, so <audio-view player="#id"> can bind to the queue.'},
      {name: 'analyser', note: 'The active entry’s AnalyserNode, or undefined between entries.'},
    ],
    events: [
      {name: 'webaudio:trackchange', note: '{id, index} — a different entry became current, including the first.'},
      {name: 'webaudio:trackend', note: '{id, index} — one entry reached its natural end.'},
      {name: 'webaudio:playlistend', note: 'The last entry ended and the list is not looping.'},
      {name: 'webaudio:timeupdate', note: '{seconds, duration, progress} for the current entry.'},
      {name: 'webaudio:seek', note: '{seconds, progress} when the seek bar is dragged.'},
      {name: 'webaudio:error', note: 'A load or playback failure; the entry is marked in the list.'},
    ],
  },

  'audio-mixer': {
    tag: 'audio-mixer',
    entry: ENTRY,
    params: [
      {name: 'player', kind: 'text', placeholder: '#session', fallback: 'standalone compatibility mode', note: 'Unique central audio-player selector. Explicit .player takes precedence; late insertion and replacement are observed.'},
      {
        name: 'master-volume',
        kind: 'number',
        min: 0,
        step: 0.1,
        fallback: '1',
        note: 'Master fader level, never below 0, applied in place — the stems keep playing.',
      },
      {
        name: 'autoplay',
        kind: 'bool',
        fallback: 'off',
        note: 'Play the whole desk on mount, and again whenever the attribute is set to true. Needs a mixer to already exist.',
      },
      {
        name: 'solo',
        kind: 'text',
        placeholder: 'track A',
        fallback: 'no solo',
        note: 'Id of the member to solo, applied in place. Removing the attribute clears the solo rather than freezing it.',
      },
    ],
    properties: [
      {name: 'player', note: 'Borrow the central AudioPlayer or its Element; linked controls share its selected backend.'},
      {name: 'mixer', note: 'Borrow an existing AudioMixer — never disposed by the element.'},
      {name: 'members', note: 'AudioMixerMemberSpec[] — {id, clip?, player?, effect?, volume?}. The element builds and owns that mixer.'},
      {name: 'audioContext', note: 'Share one page-wide context; re-mints only a mixer this element owns.'},
      {name: 'destination', note: 'Route the desk into an effects chain or a recording node.'},
      {name: 'masterVolume', note: 'The master level, readable and writable — the same value master-volume sets.'},
    ],
    events: [
      {name: 'webaudio:end', note: 'Every member has finished.'},
      {name: 'webaudio:memberend', note: '{id} when one member finished.'},
      {name: 'webaudio:error', note: 'An engine failure, a presenter failure, or a spec carrying neither clip nor player.'},
    ],
  },

  'audio-recorder': {
    tag: 'audio-recorder',
    entry: ENTRY,
    params: [
      {name: 'player', kind: 'text', placeholder: '#session', fallback: 'standalone compatibility mode', note: 'Unique central audio-player selector. Explicit .player takes precedence; late insertion and replacement are observed.'},
      {
        name: 'device-id',
        kind: 'text',
        placeholder: 'a MediaDeviceInfo.deviceId',
        fallback: 'the browser’s default input',
        note: 'Microphone to open. Read when the NEXT take starts — a running take is never reconfigured.',
      },
      {
        name: 'echo-cancellation',
        kind: 'bool',
        fallback: 'on',
        note: 'getUserMedia echo-cancellation constraint for the next take.',
      },
      {
        name: 'sample-rate',
        kind: 'number',
        min: 0,
        step: 1000,
        fallback: 'whatever the capture context settles on',
        note: 'Requested capture rate for the next take; the hardware may refuse it.',
      },
      {
        name: 'max-seconds',
        kind: 'number',
        min: 0,
        step: 1,
        fallback: 'the engine’s own memory limits',
        note: 'A MEMORY ceiling, not a timer: converted to frames using the last take’s rate, else sample-rate, else 44100. Breaching it ends capture as webaudio:error.',
      },
      {
        name: 'auto-export',
        kind: 'bool',
        fallback: 'off',
        note: 'Serialize every finished take to WAV and emit webaudio:exported.',
      },
    ],
    properties: [
      {name: 'player', note: 'Borrow the central AudioPlayer or its Element; linked controls share its selected backend.'},
      {name: 'recorder', note: 'The AudioRecorder behind the take in progress. Borrowed — undefined while idle.'},
      {name: 'take', note: 'The last finished AudioClip. Survives a disconnect: it is data, not a resource.'},
      {name: 'recording', note: 'Read-only: true from the moment capture goes live until the take is assembled.'},
      {name: 'playing', note: 'Read-only: true while the take is being auditioned.'},
      {name: 'level', note: 'Read-only input RMS 0..1 — the value webaudio:level carries. Zero while idle.'},
    ],
    events: [
      {name: 'webaudio:recordingstart', note: 'Capture is live — the microphone is open.'},
      {name: 'webaudio:level', note: '{level} input RMS, while recording.'},
      {name: 'webaudio:recorded', note: '{clip} — the finished take.'},
      {name: 'webaudio:exported', note: '{blob, format, clip} from auto-export or exportTake().'},
      {name: 'webaudio:error', note: 'An engine, playback or presenter failure.'},
    ],
  },

};
