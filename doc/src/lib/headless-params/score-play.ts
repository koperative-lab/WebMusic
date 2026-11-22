// @webmusic/score/play/headless — the objects the Play capability exports.
// Every option, command, state getter and event below was checked against
// packages/score/src/play/headless/ (score-player.ts and audio-contracts.ts),
// not against the API page.

import type {HeadlessObjectCatalog} from './types';

const ENTRY = '@webmusic/score/play/headless';

export const SCORE_PLAY_HEADLESS: HeadlessObjectCatalog = {
  'score-player': {
    name: 'ScorePlayer',
    entry: ENTRY,
    construction: 'new ScorePlayer(score, {options})',
    options: [
      {
        name: 'tempo',
        kind: 'number',
        min: 20,
        max: 300,
        step: 1,
        placeholder: '120',
        fallback: "the score's own tempo map",
        note: 'Overrides the score tempo at construction. setTempo() changes it on a running player.',
      },
      {
        name: 'expandRepeats',
        kind: 'bool',
        fallback: 'off — repeat signs are not unrolled',
        note: 'Unrolls repeat barlines and voltas before scheduling, so the player follows performance order.',
      },
      {
        name: 'cursorIntervalMs',
        kind: 'number',
        min: 16,
        max: 500,
        step: 1,
        placeholder: '50',
        fallback: 'the engine default',
        note: 'How often the cursor and timeupdate events fire while playing.',
      },
      {
        name: 'lookaheadSeconds',
        kind: 'number',
        min: 0.05,
        max: 2,
        step: 0.05,
        placeholder: '0.2',
        fallback: 'the engine default',
        note: 'How far ahead of the audio clock notes are scheduled. Larger survives jank; smaller reacts sooner.',
      },
      {
        name: 'synthOwnership',
        kind: 'enum',
        options: ['borrowed', 'owned'],
        fallback: 'borrowed — dispose() releases only the route',
        note: "With 'owned', dispose() also disposes the synth itself.",
        inert: 'the demo builds its own oscillator synth per player, so either setting tears down the same way',
      },
      {
        name: 'reverb',
        kind: 'bool',
        fallback: 'off',
        note: 'Adds a reverb send. Off and unset both leave the signal dry.',
      },
    ],
    commands: [
      {name: 'play', kind: 'action', note: 'Starts or resumes. Returns a Promise; needs a user gesture the first time.'},
      {name: 'pause', kind: 'action', note: 'Stops the clock and silences scheduled notes, keeping the position.'},
      {name: 'stop', kind: 'action', note: 'Pauses and returns the playhead to the start.'},
      {
        name: 'setTempo',
        kind: 'number',
        min: 20,
        max: 300,
        step: 1,
        placeholder: '120',
        note: 'Re-anchors the running clock to a new bpm without losing position.',
      },
      {
        name: 'setRate',
        kind: 'number',
        min: 0.25,
        max: 4,
        step: 0.05,
        placeholder: '1',
        note: 'Playback rate multiplier, applied to the running clock.',
      },
      {
        name: 'seekFraction',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        placeholder: '0.5',
        note: 'Jumps to a fraction of the piece. Clamped to 0…1.',
      },
      {
        name: 'setVolume',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.05,
        placeholder: '1',
        note: 'Output gain, 0…1.',
      },
      {
        name: 'setPan',
        kind: 'number',
        min: -1,
        max: 1,
        step: 0.1,
        placeholder: '0',
        note: 'Stereo position, -1…1.',
      },
    ],
    errors: ['operationError', 'listenerError'],
    composedBy: ['score-player'],
  },
};
