import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Note} from '../../src/core';
import {ScorePlayer, SoundfontSynth, renderScoreToBuffer} from '../../src/play/headless';

function score(transpose: number) {
  const b = new ScoreBuilder();
  const part = PartId('clarinet');
  b.addPart({id: part, name: 'Clarinet', transpose: {chromatic: transpose}});
  b.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  b.addNote(part, {
    id: b.newNoteId(), pitch: Pitch.fromMidi(62), onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(), voice: VoiceId('voice'), lyric: 'preserved', staff: 1,
  });
  return b.build();
}

function audio() {
  const param = () => ({value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}});
  const node = () => ({gain: param(), pan: param(), connect(destination: unknown) { return destination; }, disconnect() {}});
  const channel = new Float32Array(100);
  const sample: AudioBuffer = {
    length: channel.length, numberOfChannels: 1, sampleRate: 1000, duration: 0.1,
    getChannelData: () => channel,
    copyFromChannel: (destination, _channelNumber, startInChannel = 0) => {
      destination.set(channel.subarray(startInChannel, startInChannel + destination.length));
    },
    copyToChannel: (source, _channelNumber, startInChannel = 0) => {
      channel.set(source.subarray(0, channel.length - startInChannel), startInChannel);
    },
  };
  const bufferSources: Array<{buffer: AudioBuffer | null}> = [];
  const context = {
    currentTime: 0, state: 'running', sampleRate: 1000, destination: node(),
    createGain: node, createStereoPanner: node,
    createBufferSource: () => {
      const source = {...node(), buffer: null as AudioBuffer | null, start() {}, stop() {}};
      bufferSources.push(source);
      return source;
    },
  } as unknown as AudioContext;
  return {context, sample, bufferSources};
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sounding-pitch sample preparation', () => {
  it.each([[-2, 60], [0, 62]])('preloads and plays transpose %i as MIDI %i', async (transpose, midi) => {
    vi.useFakeTimers();
    const f = audio();
    const fallback = {connect() {}, noteOn: vi.fn()};
    const synth = new SoundfontSynth(f.context, {samples: {[midi]: f.sample}, fallback});
    const player = new ScorePlayer(score(transpose), {audioContext: f.context, synth});
    await player.play();
    vi.advanceTimersByTime(0);
    expect(fallback.noteOn).not.toHaveBeenCalled();
    expect(f.bufferSources).toHaveLength(1);
    expect(f.bufferSources[0].buffer).toBe(f.sample);
    player.dispose();
    synth.dispose();
  });

  it('gives native and offline custom preload the same projected pitches and source note identity fields', async () => {
    const source = score(-2);
    const f = audio();
    const received: Array<readonly Note[]> = [];
    const synth = {connect() {}, noteOn() {}, preload: async (notes?: readonly Note[]) => { received.push(notes ?? []); }};
    const player = new ScorePlayer(source, {audioContext: f.context, synth});
    await player.preload();
    class Offline {
      destination = {};
      createGain() { return {connect() {}, disconnect() {}}; }
      async startRendering() { return {} as AudioBuffer; }
    }
    vi.stubGlobal('OfflineAudioContext', Offline);
    await renderScoreToBuffer(source, {synth});
    expect(received).toHaveLength(2);
    for (const notes of received) {
      expect(notes).toHaveLength(1);
      expect(notes[0].pitch.midi).toBe(60);
      expect(notes[0].id).toBe(source.notes[0].id);
      expect(notes[0].lyric).toBe('preserved');
      expect(notes[0].staff).toBe(1);
      expect(notes[0].duration).toBe(source.notes[0].duration);
    }
    expect(source.notes[0].pitch.midi).toBe(62);
    player.dispose();
  });
});
