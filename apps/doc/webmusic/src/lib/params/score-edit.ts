import type {ElementParamCatalog} from './types';

export const SCORE_EDIT_PARAMS: ElementParamCatalog = {
  'score-document': {
    tag: 'score-document',
    entry: '@webmusic/score/edit/element',
    params: [
      {name: 'src', kind: 'text', fallback: 'No URL', note: 'Load a new document; a failed replacement retains the previous editor.'},
      {name: 'format', kind: 'enum', options: ['midi', 'musicxml', 'mxl', 'abc'], fallback: 'Auto — extension or content', note: 'Override URL format detection; ignored while .score is assigned.'},
      {name: 'history', kind: 'bool', fallback: 'true — local undo is enabled', note: 'Changing this option creates a fresh document with the configured input.'},
      {name: 'history-limit', kind: 'number', min: 1, step: 1, fallback: '100', note: 'Maximum retained undo/redo transactions; ignored when history is false.'},
    ],
    properties: [
      {name: 'score', note: 'Explicit Score input; undefined restores src loading.'},
      {name: 'editor', note: 'Read-only owned ScoreEditor, available after successful loading.'},
      {name: 'status', note: 'Read-only empty/loading/ready/error/disposed state.'},
      {name: 'error', note: 'Read-only most recent load/configuration error.'},
      {name: 'loadedSrc', note: 'Read-only successfully loaded URL, independent of a pending or failed src.'},
      {name: 'reload()', note: 'Retry the configured input and return ready/empty/superseded/failed.'},
    ],
    events: [
      {name: 'webmusic:sourcechange', note: 'The editor getter changed; subscribers reconnect before the prior editor is disposed.'},
      {name: 'webscore:documentstatechange', note: 'Loading/result state with editor, loadedSrc and error.'},
      {name: 'webscore:error', note: 'Failed document-load operation.'},
    ],
  },
};
