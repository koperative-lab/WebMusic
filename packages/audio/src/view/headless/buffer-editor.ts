// Render an AudioClipEditor's current sound back to samples (DEC-077), so a
// shared buffer edited in `<audio-clip-view>` can be written back.

import {AudioClip} from '../../core/model/AudioClip';
import {renderAudioSequence} from '../../play/api/render-sequence';
import type {AudioClipEditor} from './audio-clip-editor';

/** The editor's current sound as a new clip; the clip is the caller's. */
export async function renderAudioClipEditor(editor: AudioClipEditor, signal?: AbortSignal): Promise<AudioClip> {
  const snapshot = editor.getSnapshot();
  const rendered = await renderAudioSequence(snapshot.content, snapshot.assets, {signal});
  return new AudioClip({sampleRate: rendered.sampleRate, channelData: [...rendered.channelData]});
}
