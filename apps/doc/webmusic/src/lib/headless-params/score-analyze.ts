import type {HeadlessObjectCatalog} from './types';

export const SCORE_ANALYZE_HEADLESS: HeadlessObjectCatalog = {
  'analysis-follower': {
    name: 'createAnalysisFollower',
    entry: '@webmusic/score/analyze/headless',
    construction: 'createAnalysisFollower({options})',
    options: [
      {name: 'score', kind: 'enum', options: ['borrowed', 'sample', 'alternate'], fallback: 'borrowed',
        note: 'Fixture selector: omit score to borrow the player; sample/alternate pass an explicit Score. An alternate Score mismatches the sample player.'},
      {name: 'playback', kind: 'enum', options: ['none', 'player', 'read-only'], fallback: 'player — the demo attaches its owned sample player',
        note: 'Fixture selector: player.playback, the same source without a seek command, or no source. The library default is no source.'},
      {name: 'analysis', kind: 'text', placeholder: '{"windowQuarters":2,"motifLength":4,"minOccurrences":2}', fallback: 'session defaults',
        note: 'JSON AnalysisSessionOptions. Changing windowQuarters, motifLength or minOccurrences recreates the follower and its analysis session.'},
    ],
    commands: [
      {name: 'setScore', kind: 'enum', options: ['borrowed', 'sample', 'alternate'],
        note: 'Pass undefined to resume borrowing, or one of the two actual fixture Scores.'},
      {name: 'setPlayback', kind: 'enum', options: ['none', 'player', 'read-only'],
        note: 'Replace or release the follower subscription; its owner keeps playing.'},
      {name: 'seekNominal', kind: 'number', min: 0, step: .25, placeholder: '1',
        note: 'Navigate in nominal score seconds. The returned promise reports committed, superseded or failed.'},
      {name: 'seekQuarters', kind: 'number', min: 0, step: .5, placeholder: '2',
        note: 'Navigate in quarter notes using the current Score tempo map; source rate does not change this axis.'},
      {name: 'dispose', kind: 'action',
        note: 'Release this follower and clear its state. The demo player remains owned by the stage; Reset reconstructs both.'},
    ],
  },
};
