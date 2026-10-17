import type {ElementParamCatalog} from './types';

export const AUDIO_EDIT_PARAMS: ElementParamCatalog = {
  'audio-document': {
    tag: 'audio-document',
    entry: '@webmusic/audio/edit/element',
    params: [
      {name: 'src', kind: 'text', fallback: 'No URL', note: 'Load a new document; a failed replacement retains the previous editor.'},
      {name: 'format', kind: 'enum', options: ['wav', 'aiff', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'webm'], fallback: 'Auto — extension or content', note: 'Override URL format detection; ignored while .clip is assigned.'},
      {name: 'history', kind: 'bool', fallback: 'true — local undo is enabled', note: 'Changing this option creates a fresh document with the configured input.'},
      {name: 'history-limit', kind: 'number', min: 1, step: 1, fallback: '100', note: 'Maximum retained undo/redo transactions; ignored when history is false.'},
    ],
    properties: [
      {name: 'clip', note: 'Explicit decoded AudioClip input; undefined restores src loading.'},
      {name: 'loader', note: 'Optional caller-owned decoding closure; receives URL, limits and AbortSignal.'},
      {name: 'loadOptions', note: 'Configured input/decode resource limits forwarded to the loader; an injected loader enforces its own limits.'},
      {name: 'processors', note: 'Borrowed range processor recipes; replacing the array reloads the configured document.'},
      {name: 'editor', note: 'Read-only owned AudioClipEditor, available after successful loading.'},
      {name: 'status', note: 'Read-only empty/loading/ready/error/disposed state.'},
      {name: 'error', note: 'Read-only most recent load/configuration error.'},
      {name: 'loadedSrc', note: 'Read-only successfully loaded URL, independent of a pending or failed src.'},
      {name: 'reload()', note: 'Retry the configured input and return ready/empty/superseded/failed.'},
    ],
    events: [
      {name: 'webmusic:sourcechange', note: 'The editor getter changed; subscribers reconnect before the prior editor is disposed.'},
      {name: 'webaudio:documentstatechange', note: 'Loading/result state with editor, loadedSrc and error.'},
      {name: 'webaudio:error', note: 'Failed document-load operation.'},
    ],
  },
};
