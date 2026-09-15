// ============================================================================
// @webmusic/score/play/demos — ready-made demo elements.
//
// Each element is a self-contained, zero-wiring showcase of one `@webmusic/score/play`
// web component: it builds its own sample music and wires the underlying element
// (or engine) for you. Drop the tag on a page — no JavaScript needed:
//
//   import {defineNoteInputDemoElement} from '@webmusic/score/play/demos';
//   defineNoteInputDemoElement();
//   // <note-input-demo layout="piano"></note-input-demo>
//
// These exist for documentation / getting-started use; production apps wire the
// real elements (`@webmusic/score/play/element`) with their own scores. Everything is
// overridable — sample builders are exported, so you can compose your own.
// ============================================================================

import {defineOnce, HTMLElementBase} from '../element/internal/base';
import {defineScoreRecorderElement} from '../element/score-recorder';
import {
  DEFAULT_TR808_GRID_MAP,
  defineNoteInputElement,
} from '../element/note-input';
import {defineSynthPanelElement, type SoundParam, type Envelope} from '../element/synth-panel';
import {InteractivePlayer} from '../headless/interactive-player';
import {OscillatorSynth} from '../headless/oscillator-synth';
import {Sound} from '../headless/sound';
import {defineSinglePurposeDemoElements} from './single-purpose';

export {sampleScore, sampleRack, type SampleScoreOptions} from './samples';

// The single-purpose demo elements (`<simple-score-player-demo>`,
// `<rack-control-demo>`, …) round out the flat demo set alongside the
// consolidated `*-demo` elements declared below.
export * from './single-purpose';

/** Wire a pure input surface (`.onNote`) to a fresh oscillator-backed player. */
function wireInput(el: HTMLElement & {onNote?: (m: number, v: number, on: boolean) => void}, gain = 0.2): InteractivePlayer {
  const player = new InteractivePlayer();
  player.addVoice('in', Sound.oscillator({type: 'triangle', gain, releaseSeconds: 0.05}));
  el.onNote = (midi, velocity, on) => {
    if (on) player.noteOn('in', midi, velocity, 3600);
    else player.noteOff('in', midi);
  };
  return player;
}

/** Wire `.onNote` to a SoundFont (`.sf2` / `.sf3` via `spessasynth_lib`). */
function wireInputSoundFont(
  el: HTMLElement & {onNote?: (m: number, v: number, on: boolean) => void},
  url: string,
  {gain = 1, channel = 0, program = 0}: {gain?: number; channel?: number; program?: number} = {},
): InteractivePlayer {
  const player = new InteractivePlayer();
  player.addVoice('in', Sound.soundfont2(url, {channel, program, gain}));
  el.onNote = (midi, velocity, on) => {
    if (on) player.noteOn('in', midi, velocity, 3600);
    else player.noteOff('in', midi);
  };
  return player;
}

/** `<score-recorder-demo>` — a piano `<note-input>` feeding a `<score-recorder>`. */
export class ScoreRecorderDemoElement extends HTMLElementBase {
  connectedCallback(): void {
    if (this.dataset.mounted) return;
    this.dataset.mounted = 'true';
    defineNoteInputElement();
    defineScoreRecorderElement();
    const kb = document.createElement('note-input') as HTMLElement & {
      onNote?: (midi: number, velocity: number, on: boolean) => void;
    };
    kb.setAttribute('layout', 'piano');
    kb.setAttribute('start', '48');
    kb.setAttribute('end', '71');
    kb.style.display = 'block';
    const rec = document.createElement('score-recorder') as HTMLElement & {
      input: (midi: number, velocity: number, on: boolean) => void;
    };
    rec.style.display = 'block';
    rec.style.marginTop = '0.7rem';
    kb.onNote = (midi, velocity, on) => rec.input(midi, velocity, on);
    this.replaceChildren(kb, rec);
  }
}


/**
 * `<note-input-demo>` — a `<note-input>` wired to a triangle synth. The demo's
 * `layout` attribute (piano | grid | chords, default piano)
 * is forwarded to the inner element.
 */
export class NoteInputDemoElement extends HTMLElementBase {
  private player?: InteractivePlayer;
  connectedCallback(): void {
    if (this.dataset.mounted) return;
    this.dataset.mounted = 'true';
    defineNoteInputElement();
    const layout = this.getAttribute('layout') ?? 'piano';
    const el = document.createElement('note-input') as HTMLElement & {onNote?: (m: number, v: number, on: boolean) => void};
    el.setAttribute('layout', layout);
    if (layout === 'piano' || this.hasAttribute('keyboard')) {
      el.setAttribute('start', '48');
      el.setAttribute('end', '71');
      if (this.hasAttribute('keyboard')) el.setAttribute('keyboard', '');
    }
    if (layout === 'grid') {
      const gridMap = this.getAttribute('grid-map') ?? DEFAULT_TR808_GRID_MAP;
      el.setAttribute('map', gridMap);
    }
    el.style.display = 'block';
    const sf2 = this.getAttribute('sound-font');
    this.player = sf2
      ? wireInputSoundFont(el, sf2, {channel: 9, gain: layout === 'chords' ? 0.5 : 1})
      : wireInput(el, layout === 'chords' ? 0.14 : 0.2);
    this.replaceChildren(el);
  }
  disconnectedCallback(): void {
    this.player?.dispose();
    this.player = undefined;
  }
}


/**
 * `<synth-panel-demo>` — a piano `<note-input>` played through a live
 * oscillator synth, with a `<synth-panel>` (sound + envelope sections) that
 * retunes the timbre as you turn the knobs / drag the envelope.
 */
export class SynthPanelDemoElement extends HTMLElementBase {
  private player?: InteractivePlayer;
  connectedCallback(): void {
    if (this.dataset.mounted) return;
    this.dataset.mounted = 'true';
    defineNoteInputElement();
    defineSynthPanelElement();

    const player = new InteractivePlayer();
    const synth = new OscillatorSynth(player.context, {
      type: 'triangle',
      gain: 0.18,
      attackSeconds: 0.01,
      releaseSeconds: 0.12,
      detune: 0,
      cutoff: 8000,
      resonance: 0.7,
    });
    player.addVoice('kbd', synth);
    this.player = player;

    const keyboard = document.createElement('note-input') as HTMLElement & {
      onNote?: (midi: number, velocity: number, on: boolean) => void;
    };
    keyboard.setAttribute('layout', 'piano');
    keyboard.setAttribute('start', '48');
    keyboard.setAttribute('end', '71');
    keyboard.style.display = 'block';
    keyboard.onNote = (midi, velocity, on) => {
      if (on) player.noteOn('kbd', midi, velocity, 3600);
      else player.noteOff('kbd', midi);
    };

    const WAVES: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];
    const panel = document.createElement('synth-panel') as HTMLElement & {
      sound?: SoundParam[];
      apply?: (e: Envelope) => void;
    };
    panel.setAttribute('sections', 'sound,envelope');
    panel.style.display = 'block';
    panel.style.marginTop = '0.9rem';
    panel.sound = [
      {group: 'osc', name: 'wave', value: 3, min: 0, max: 3, options: WAVES, apply: (i) => synth.setParam('type', WAVES[Math.round(i)])},
      {group: 'osc', name: 'tune', value: 0, min: -50, max: 50, step: 1, unit: '¢', apply: (v) => synth.setParam('detune', v)},
      {group: 'osc', name: 'level', value: 0.18, min: 0, max: 0.5, step: 0.01, apply: (v) => synth.setParam('gain', v)},
      {group: 'filter', name: 'cutoff', value: 8000, min: 200, max: 12000, step: 10, unit: 'Hz', apply: (v) => synth.setParam('cutoff', v)},
      {group: 'filter', name: 'resonance', value: 0.7, min: 0.1, max: 18, step: 0.1, apply: (v) => synth.setParam('resonance', v)},
    ];
    panel.apply = (e) => {
      synth.setParam('attackSeconds', e.attack);
      synth.setParam('releaseSeconds', Math.max(0.02, e.release));
    };

    this.replaceChildren(keyboard, panel);
  }
  disconnectedCallback(): void {
    this.player?.dispose();
    this.player = undefined;
  }
}



export function defineScoreRecorderDemoElement(tag = 'score-recorder-demo'): void {
  defineOnce(tag, ScoreRecorderDemoElement);
}
export function defineNoteInputDemoElement(tag = 'note-input-demo'): void {
  defineOnce(tag, NoteInputDemoElement);
}
export function defineSynthPanelDemoElement(tag = 'synth-panel-demo'): void {
  defineOnce(tag, SynthPanelDemoElement);
}

/** Register every `*-demo` element at its default tag (consolidated + single-purpose). */
export function defineAllDemoElements(): void {
  defineScoreRecorderDemoElement();
  defineNoteInputDemoElement();
  defineSynthPanelDemoElement();
  defineSinglePurposeDemoElements();
}
