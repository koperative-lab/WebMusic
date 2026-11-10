// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import type {HeadlessSynth} from '../../src/play/headless';
import type {RackModule} from '@webmusic/kernel/module';
import {defineScorePlayerElement, type ScorePlayerElement} from '../../src/play/element/score-player';
import {defineRackControlElement, type RackControlElement} from '../../src/play/element/score-rack-control';
import {defineRackPartElement, type RackPartElement} from '../../src/play/element/score-rack-part';
import {defineScoreEffectElement} from '../../src/play/element/score-effect';
import {defineSynthPanelElement, type SynthPanelElement} from '../../src/play/element/score-synth-panel';

defineScorePlayerElement();
defineRackControlElement();
defineRackPartElement();
defineScoreEffectElement();
defineSynthPanelElement();

function score() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Part'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addMeasure({id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  builder.addNote(part, {id: builder.newNoteId(), voice: VoiceId('v'), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole()});
  return builder.build();
}

/** A context as a page has it before any gesture: created, but suspended. */
function suspendedContext() {
  const context = {} as AudioContext;
  const node = () => {
    const parameter = () => ({value: 1, defaultValue: 1, minValue: -100, maxValue: 100,
      setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn()});
    return {context, gain: parameter(), pan: parameter(), connect: vi.fn((to: AudioNode) => to), disconnect: vi.fn()} as unknown as GainNode;
  };
  Object.assign(context, {state: 'suspended', currentTime: 0, sampleRate: 48000,
    destination: node(), createGain: vi.fn(node), createStereoPanner: vi.fn(node),
    resume: vi.fn(async () => {}), close: vi.fn(async () => {})});
  return context;
}

const synth = (): HeadlessSynth => ({connect: vi.fn(() => vi.fn()), noteOn: vi.fn(), noteOff: vi.fn(), dispose: vi.fn()});
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function desk(preload?: string) {
  const context = suspendedContext();
  const root = document.createElement('score-player') as ScorePlayerElement;
  if (preload !== undefined) root.setAttribute('preload', preload);
  root.audioContext = context;
  const rack = document.createElement('score-rack-control') as RackControlElement;
  const part = document.createElement('score-rack-part') as RackPartElement;
  part.id = 'piano';
  part.score = score();
  part.sound = synth();
  const effect = document.createElement('score-effect');
  effect.id = 'mt-fx';
  effect.setAttribute('type', 'gain');
  effect.setAttribute('gain', '0.4');
  rack.append(part, effect);
  root.append(rack);
  const panel = document.createElement('score-synth-panel') as SynthPanelElement;
  panel.setAttribute('target', '#mt-fx');
  panel.setAttribute('sections', 'effects');
  document.body.append(root, panel);
  return {context, root, rack, panel};
}

afterEach(async () => {
  document.body.replaceChildren();
  await settle();
});

describe('Element preload (DEC-069)', () => {
  it('prepares a desk, its channels and its inserts on mount without starting or resuming playback', async () => {
    const {context, rack, panel} = desk();
    await settle();
    // The part has its desk channel and the effect panel its knobs before any play.
    expect((rack.module as RackModule).list().map((channel) => channel.id)).toEqual(['piano']);
    expect(panel.bindingState).toBe('ready');
    const values = [...panel.shadowRoot!.querySelectorAll('.wui-parameter-rack__value')].map((node) => node.textContent);
    expect(values).toEqual(['0.40']);
    expect(panel.shadowRoot!.textContent).not.toContain('Module target unavailable');
    // Nothing plays and the suspended context waits for the first play's gesture.
    expect(context.resume).not.toHaveBeenCalled();
    expect(rack.sessionTransport!.snapshot.paused).toBe(true);
  });

  it('keeps everything unprepared until play with preload="none"', async () => {
    const {context, rack, panel} = desk('none');
    await settle();
    expect(context.createGain).not.toHaveBeenCalled();
    expect((rack.module as RackModule).list()).toEqual([]);
    expect(panel.bindingState).toBe('unresolved');
  });

  it('preloads an outermost desk that owns its own Session', async () => {
    const context = suspendedContext();
    const rack = document.createElement('score-rack-control') as RackControlElement;
    const part = document.createElement('score-rack-part') as RackPartElement;
    part.id = 'lead';
    part.score = score();
    part.sound = synth();
    rack.append(part);
    // The desk's own environment creates its context through the global constructor.
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    try {
      document.body.append(rack);
      await settle();
      expect((rack.module as RackModule).list().map((channel) => channel.id)).toEqual(['lead']);
      expect(context.resume).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
