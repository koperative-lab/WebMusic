// ============================================================================
// @webmusic/score/play/demos — ready-made demo elements.
//
// Each element is a self-contained, zero-wiring showcase of one `@webmusic/score/play`
// web component: it builds its own sample music and wires the underlying element
// (or engine) for you. Drop the tag on a page — no JavaScript needed:
//
//   import {defineRackControlDemoElement} from '@webmusic/score/play/demos';
//   defineRackControlDemoElement();
//   // <rack-control-demo></rack-control-demo>
//
// These exist for documentation / getting-started use; production apps wire the
// real elements (`@webmusic/score/play/element`) with their own scores. Everything is
// overridable — sample builders are exported, so you can compose your own.
// ============================================================================

import type {Score} from '../../core';
import {defineOnce, HTMLElementBase} from '../element/internal/base';
import {defineScorePlayerElement} from '../element/score-player';
import {defineRackControlElement} from '../element/rack-control';
import {mountPresetPlayer, type PresetPlayerHandle} from '../element/internal/preset-player';
import type {Rack} from '../headless/rack';
import {sampleScore, sampleRack} from './samples';

type WithScore = HTMLElement & {score?: Score};
type WithRack = HTMLElement & {rack?: Rack};

/** `<simple-score-player-demo>` — a `<score-player>` playing a built-in etude. */
export class SimpleScorePlayerDemoElement extends HTMLElementBase {
  connectedCallback(): void {
    if (this.dataset.mounted) return;
    this.dataset.mounted = 'true';
    defineScorePlayerElement();
    const el = document.createElement('score-player') as WithScore;
    el.style.display = 'block';
    el.score = sampleScore({title: 'Etude', bpm: 96});
    this.replaceChildren(el);
  }
}

/** `<preset-player-demo>` — the imperative `mountPresetPlayer` over a sample score. */
export class PresetPlayerDemoElement extends HTMLElementBase {
  private handle?: PresetPlayerHandle;
  connectedCallback(): void {
    if (this.handle) return;
    this.handle = mountPresetPlayer(sampleScore({title: 'Etude', bpm: 96}), this);
  }
  disconnectedCallback(): void {
    this.handle?.destroy();
    this.handle = undefined;
  }
}





/**
 * `<rack-control-demo>` — a `<score-player>` driving a two-instrument
 * `Rack`, with a `<rack-control>` mixer bound to the same rack.
 */
export class RackControlDemoElement extends HTMLElementBase {
  connectedCallback(): void {
    if (this.dataset.mounted) return;
    this.dataset.mounted = 'true';
    defineScorePlayerElement();
    defineRackControlElement();
    const rack = sampleRack();
    const player = document.createElement('score-player') as WithRack;
    player.style.display = 'block';
    player.rack = rack;
    const control = document.createElement('rack-control') as WithRack;
    control.style.display = 'block';
    control.style.marginTop = '0.9rem';
    control.rack = rack;
    this.replaceChildren(player, control);
  }
}



export function defineSimpleScorePlayerDemoElement(tag = 'simple-score-player-demo'): void {
  defineOnce(tag, SimpleScorePlayerDemoElement);
}
export function definePresetPlayerDemoElement(tag = 'preset-player-demo'): void {
  defineOnce(tag, PresetPlayerDemoElement);
}
export function defineRackControlDemoElement(tag = 'rack-control-demo'): void {
  defineOnce(tag, RackControlDemoElement);
}
/** Register every single-purpose `*-demo` element at its default tag. */
export function defineSinglePurposeDemoElements(): void {
  defineSimpleScorePlayerDemoElement();
  definePresetPlayerDemoElement();
  defineRackControlDemoElement();
}
