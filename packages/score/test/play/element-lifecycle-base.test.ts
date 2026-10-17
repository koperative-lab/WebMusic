import {describe, expect, it} from 'vitest';
import {WebMusicElement} from '../../src/play/element/internal/base';
import {WebMusicElement as ViewBase} from '../../src/view/element/base';
import {WebMusicElement as AnalyzeBase} from '../../src/analyze/element/base';
import {
  RackControlElement,
  ScorePlayerElement,
  SynthPanelElement,
} from '../../src/play/element';

/**
 * Elements migrated onto the kernel lifecycle base. The base owns the mounted
 * flag, the per-lifetime cleanup scope and the error drain, so these pin the
 * inheritance rather than re-testing the kernel's own behaviour.
 */
describe('kernel element lifecycle adoption', () => {
  it('exposes the same base through every capability shim', () => {
    // view/ and analyze/ previously re-exported only HTMLElementBase, which
    // left their elements with no path onto the kernel lifecycle at all.
    expect(ViewBase).toBe(WebMusicElement);
    expect(AnalyzeBase).toBe(WebMusicElement);
  });

  it('puts the migrated play elements on the kernel base', () => {
    for (const element of [
      SynthPanelElement,
      ScorePlayerElement,
      RackControlElement,
    ]) {
      expect(Object.create(element.prototype)).toBeInstanceOf(WebMusicElement);
    }
  });

  it('keeps the guarded connection entry on the kernel base', () => {
    // A subclass that still declares its own connectedCallback would shadow
    // the base's generation guard and cleanup scope — the exact duplication
    // this migration removes.
    for (const element of [
      SynthPanelElement,
      ScorePlayerElement,
      RackControlElement,
    ]) {
      expect(Object.hasOwn(element.prototype, 'connectedCallback')).toBe(false);
    }
    // Modular Player/Rack may defer disconnection by one microtask to preserve
    // synchronous DOM moves. They delegate terminal teardown to the kernel;
    // modular-score-runtime.test.ts exercises both movement and actual removal.
    expect(Object.hasOwn(SynthPanelElement.prototype, 'disconnectedCallback')).toBe(false);
  });
});
