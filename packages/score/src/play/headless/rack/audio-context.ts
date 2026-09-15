import {createWebAudioContext} from '@webmusic/kernel/audio-context';

/** Create a browser AudioContext while keeping Rack construction SSR-safe. */
export function createRackAudioContext(): AudioContext {
  return createWebAudioContext('Web Audio is not available. Pass an existing AudioContext in options.audioContext.');
}
