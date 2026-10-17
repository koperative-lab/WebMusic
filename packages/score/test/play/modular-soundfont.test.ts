// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {Sound} from '../../src/play/headless/sound';
import {defineScorePlayerElement, type ScorePlayerElement} from '../../src/play/element/score-player';
import {defineSynthPanelElement, type SynthPanelElement} from '../../src/play/element/score-synth-panel';

defineScorePlayerElement();
defineSynthPanelElement();

class SampleBuffer {
  readonly length = 96000;
  readonly numberOfChannels = 1;
  readonly sampleRate = 48000;
  readonly duration = 2;
}

function audioFixture() {
  let now = 0;
  const context = {} as AudioContext;
  const parameter = () => ({
    value: 1, defaultValue: 1, minValue: -1e6, maxValue: 1e6, automationRate: 'a-rate',
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const node = () => ({
    context, gain: parameter(), pan: parameter(), frequency: parameter(), detune: parameter(),
    Q: parameter(), offset: parameter(), connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(), start: vi.fn((_time?: number) => {}), stop: vi.fn((_time?: number) => {}), setPeriodicWave: vi.fn(),
  });
  const samples: ReturnType<typeof node>[] = [];
  const buffer = new SampleBuffer() as unknown as AudioBuffer;
  Object.defineProperty(context, 'currentTime', {get: () => now});
  Object.assign(context, {
    state: 'running', sampleRate: 48000, destination: node(),
    createGain: vi.fn(node), createStereoPanner: vi.fn(node), createOscillator: vi.fn(node),
    createConstantSource: vi.fn(node), createBiquadFilter: vi.fn(node),
    createBufferSource: vi.fn(() => { const source = node(); samples.push(source); return source; }),
    decodeAudioData: vi.fn(async () => buffer), resume: vi.fn(async () => {}), close: vi.fn(),
  });
  return {context, buffer, samples, at: (time: number) => { now = time; }};
}

function score() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('part'), name: 'Part'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addNote(part, {id: builder.newNoteId(), voice: VoiceId('voice'), pitch: Pitch.fromMidi(60),
    onsetQuarters: Rational.ZERO, duration: Duration.whole(),
    performed: {onsetSec: 0, durationSec: 2, velocity: 127}});
  return builder.build();
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const cleanups: Array<() => void> = [];

async function mount(kind: 'template' | 'explicit' = 'template') {
  vi.useFakeTimers();
  vi.stubGlobal('AudioBuffer', SampleBuffer);
  const f = audioFixture();
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetch);
  const root = document.createElement('score-player') as ScorePlayerElement;
  root.setAttribute('composition', 'modules');
  root.audioContext = f.context;
  const leaf = document.createElement('score-player') as ScorePlayerElement;
  leaf.score = score();
  leaf.setAttribute('sound-font', '/samples/{midi}.wav');
  if (kind === 'explicit') {
    const sound = Sound.samples({60: f.buffer});
    leaf.sound = sound;
    cleanups.push(() => sound.dispose());
  }
  const panel = document.createElement('score-synth-panel') as SynthPanelElement;
  panel.sections = ['envelope'];
  leaf.append(panel);
  root.append(leaf);
  document.body.append(root);
  await settle();
  return {...f, root, leaf, panel, fetch, session: root.sessionTransport!};
}

afterEach(async () => {
  document.body.replaceChildren();
  await settle();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('modular sound-font instrument capabilities', () => {
  it('keeps inspection lazy and exposes the prepared sampler ADSR through its attached panel', async () => {
    const f = await mount();
    const module = f.leaf.module!;
    expect(module.params).toBeUndefined();
    expect(f.panel.shadowRoot!.textContent).toContain('No instrument envelope parameters available');
    expect(f.context.createGain).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();

    await f.session.preload();
    await settle();
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0][0]).toBe('/samples/60.wav');
    expect(module.params).toBeDefined();
    const params = module.params!;
    expect(params.handles.map((handle) => handle.descriptor.id)).toEqual([
      'attackSeconds', 'decaySeconds', 'sustainLevel', 'releaseSeconds',
    ]);
    const slider = (name: string) => f.panel.shadowRoot!.querySelector<HTMLInputElement>(`input[aria-label="${name} (next notes)"]`)!;
    for (const [name, value] of [['attack', '0.02'], ['decay', '0.3'], ['Sustain', '0.35'], ['release', '0.2']] as const) {
      const input = slider(name);
      expect(input).not.toBeNull();
      input.value = value;
      input.dispatchEvent(new Event('input', {bubbles: true}));
    }
    expect(params.handles.map((handle) => handle.snapshot.baseValue)).toEqual([0.02, 0.3, 0.35, 0.2]);
    await f.session.play();
    expect(f.samples).toHaveLength(1);
    const source = f.samples[0];
    const envelope = source.connect.mock.calls[0][0] as ReturnType<typeof audioFixture>['samples'][number];
    const start = source.start.mock.calls[0][0] as number;
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, start + 0.02);
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.35, start + 0.02 + 0.3);
    f.panel.remove();
    expect(module.params).toBe(params);
    expect(params.get('sustainLevel')!.snapshot.disposed).toBe(false);
    f.root.remove();
    await settle();
    expect(params.get('sustainLevel')!.snapshot.disposed).toBe(true);
  });

  it.each(['template', 'explicit'] as const)('retimes the same sounding %s sample when Session rate changes', async (kind) => {
    const f = await mount(kind);
    await f.session.play();
    expect(f.samples).toHaveLength(1);
    const original = f.samples[0];
    const start = original.start.mock.calls[0][0] as number;
    const release = f.leaf.module!.params?.get('releaseSeconds')!.snapshot.baseValue ?? 0.08;
    f.at(start + 0.2);
    await f.session.setRate(2);
    expect(f.samples).toHaveLength(1);
    expect(f.samples[0]).toBe(original);
    expect(original.start).toHaveBeenCalledOnce();
    expect(original.stop).toHaveBeenLastCalledWith(start + 0.2 + 1.8 / 2 + release);
    expect(f.fetch).toHaveBeenCalledTimes(kind === 'template' ? 1 : 0);
  });
});
