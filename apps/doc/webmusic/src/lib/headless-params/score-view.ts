import type {HeadlessObjectCatalog} from './types';

const PLAYBACK_CHOICES = ['none', 'player', 'read-only'];
const SCORE_CHOICES = ['borrowed', 'sample', 'alternate'];

export const SCORE_VIEW_HEADLESS: HeadlessObjectCatalog = {
  'score-map-view': {
    name: 'createScoreMapView',
    entry: '@webmusic/score/view/headless',
    construction: 'createScoreMapView({options})',
    options: [
      {name: 'score', kind: 'enum', options: SCORE_CHOICES, fallback: 'borrowed',
        note: 'Fixture selector: omit score to borrow data, or pass the actual sample/alternate Score.'},
      {name: 'playback', kind: 'enum', options: PLAYBACK_CHOICES, fallback: 'player — the demo attaches its owned sample player',
        note: 'Borrow player.playback, a read-only view of that source, or no source. The library default is no source.'},
      {name: 'part', kind: 'text', fallback: 'all parts',
        note: 'Exact part ID or name for density counts. The whole Score time axis remains intact.'},
      {name: 'maxCells', kind: 'number', min: 1, step: 1, placeholder: '64', fallback: '64',
        note: 'Finite cell budget; rounded and clamped to at least one.'},
      {name: 'maxMarks', kind: 'number', min: 1, step: 1, placeholder: '24', fallback: '24',
        note: 'Finite ruler budget; major structural landmarks survive thinning.'},
      {name: 'seekNominal', kind: 'enum', options: ['none', 'resolve', 'reject', 'deferred'], fallback: 'none',
        note: 'Demo callback fixture for playback=none. Resolve succeeds, reject fails, deferred waits for the stage completion button. A bound native source owns seeking.'},
    ],
    commands: [
      {name: 'setScore', kind: 'enum', options: SCORE_CHOICES,
        note: 'Replace explicit Score data, or pass undefined to resume source following.'},
      {name: 'setPlayback', kind: 'enum', options: PLAYBACK_CHOICES,
        note: 'Replace or detach the borrowed source, invalidating earlier commands.'},
      {name: 'configure', kind: 'text', placeholder: '{"maxCells":4,"maxMarks":8}',
        note: 'JSON ScoreMapOptions: part, maxCells and maxMarks. Reproject the current Score without rebuilding playback.'},
      {name: 'setPosition', kind: 'number', step: .25, placeholder: '1',
        note: 'Apply a local nominal-seconds observation. This changes the map cursor without commanding the player.'},
      {name: 'seekQuarters', kind: 'number', step: .5, placeholder: '2',
        note: 'Clamp a quarter-note request and delegate in nominal seconds. Its promise reports committed, superseded or failed.'},
      {name: 'dispose', kind: 'action',
        note: 'Release observation and supersede pending commands. Reset reconstructs the map and its owned demo player.'},
    ],
    composedBy: ['score-view'],
  },
  'pitch-view': {
    name: 'createPitchView',
    entry: '@webmusic/score/view/headless',
    construction: 'createPitchView({options})',
    options: [
      {name: 'playback', kind: 'enum', options: PLAYBACK_CHOICES, fallback: 'none',
        note: 'Omit for standalone note input, or borrow the demo player source. A pitch follower never sends transport commands.'},
    ],
    commands: [
      {name: 'setPlayback', kind: 'enum', options: PLAYBACK_CHOICES,
        note: 'Attach, replace or release the source subscription; clears notes and resets source revision scope.'},
      {name: 'updatePlayback', kind: 'action',
        note: 'The demo supplies player.playback.snapshot() as the required argument. Apply one real snapshot without subscribing.'},
      {name: 'noteOn', kind: 'number', min: 0, max: 127, step: 1, placeholder: '60',
        note: 'Add one MIDI occurrence. Repeated noteOn calls for the same pitch are counted independently.'},
      {name: 'noteOff', kind: 'number', min: 0, max: 127, step: 1, placeholder: '60',
        note: 'Release one occurrence. The pitch remains active until every matching noteOn has been released.'},
      {name: 'clear', kind: 'action',
        note: 'Clear held notes while retaining the borrowed subscription; its next snapshot replaces the projection.'},
      {name: 'dispose', kind: 'action',
        note: 'Release the subscription and clear local state. Reset reconstructs a usable view.'},
    ],
    composedBy: ['pitch-view'],
  },
};
