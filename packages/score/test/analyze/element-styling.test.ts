// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {
  ChordAnalysisElement,
  KeyAnalysisElement,
  LiveChordAnalysisElement,
  RomanAnalysisElement,
  VoiceLeadingAnalysisElement,
} from '../../src/analyze/element';

// Exercise the actual sibling presenter source without requiring a dist build
// during a coordinated checkout edit. There are no presenter behavior stubs.
vi.mock('@webmusic/ui/harmony', () => import('../../../ui/src/harmony'));
vi.mock('@webmusic/ui/workbench', () => import('../../../ui/src/workbench'));

const cases = [
  ['chord-analysis', ChordAnalysisElement, 'lane'],
  ['key-analysis', KeyAnalysisElement, 'lane'],
  ['roman-analysis', RomanAnalysisElement, 'lane'],
  ['voice-leading-analysis', VoiceLeadingAnalysisElement, 'lane'],
  ['live-chord-analysis', LiveChordAnalysisElement, 'nameplate'],
] as const;

for (const [tag, constructor] of cases) customElements.define(tag, constructor);

const score = (() => {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  for (const [at, chord] of [['C4', 'E4', 'G4'], ['D4', 'F#4', 'A4']].entries()) {
    for (const [voice, pitch] of chord.entries()) {
      builder.addNote(part, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(pitch),
        onsetQuarters: new Rational(at),
        duration: Duration.quarter(),
        voice: VoiceId(String(voice)),
      });
    }
  }
  return builder.build();
})();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => document.body.replaceChildren());

describe('Analyze Element styling composition', () => {
  for (const [tag, , contentPart] of cases) {
    it(`${tag} exposes one outer surface and an unpainted musical child`, async () => {
      const host = document.createElement(tag) as KeyAnalysisElement;
      if (contentPart === 'lane') host.score = score;
      document.body.append(host);
      await flush();

      expect(host.shadowRoot).toBeNull();
      expect(host.querySelectorAll(':scope > [part~="root"]')).toHaveLength(1);
      expect(host.querySelectorAll('[part~="surface"]')).toHaveLength(1);
      expect(host.querySelector('[part~="presentation"]')).not.toBeNull();
      expect(host.querySelector('[part~="content"]')).not.toBeNull();

      const child = host.querySelector<HTMLElement>(`[part~="${contentPart}"]`)!;
      // This is the composition contract, not a computed-custom-property test:
      // jsdom does not resolve inherited CSS variables or real layout.
      expect(child).not.toBeNull();
      expect(child.style.background).toBe('transparent');
      expect(child.style.padding).toBe('0px');
      expect(parseFloat(child.style.borderWidth)).toBe(0);
      expect(parseFloat(child.style.borderRadius)).toBe(0);
      if (contentPart === 'lane') {
        expect(child.querySelector('[part~="viewport"]')?.getAttribute('role')).toBe('slider');
        expect(child.querySelector('[part~="reel"]')).not.toBeNull();
      } else {
        expect(child.querySelector('[part~="symbol"]')).not.toBeNull();
        expect(child.querySelector('[role="status"]')).not.toBeNull();
      }
    });

    it(`${tag} preserves application styles and inherited token access after updates and remounts`, async () => {
      const parent = document.createElement('section');
      parent.style.cssText = '--wm-component-background:transparent;--wm-component-border:2px solid teal;--wm-control-radius:12px;--wm-foreground:navy;--wm-accent:purple;--wm-harmony-flow-tone:gold';
      const host = document.createElement(tag) as KeyAnalysisElement;
      host.style.cssText = 'width:85%;color:maroon;--wm-harmony-foreground:teal';
      const originalStyle = host.style.cssText;
      parent.append(host);
      document.body.append(parent);
      if (contentPart === 'lane') host.score = score;
      await flush();

      const musicalChild = host.querySelector(`[part~="${contentPart}"]`);
      parent.style.setProperty('--wm-component-background', 'rgba(0, 0, 0, .25)');
      parent.style.setProperty('--wm-harmony-flow-tone', 'pink');
      host.setAttribute('density', 'compact');
      host.setAttribute('scheme', 'dark');
      host.removeAttribute('scheme');
      expect(host.querySelector(`[part~="${contentPart}"]`)).toBe(musicalChild);
      if (contentPart === 'lane') host.setAttribute('motion', 'stepped');
      host.remove();
      parent.append(host);
      await flush();

      expect(host.style.cssText).toBe(originalStyle);
      expect(host.querySelector('[part~="surface"]')).not.toBeNull();
      expect(host.querySelector(`[part~="${contentPart}"]`)).not.toBeNull();
      // Neither the Element nor its presenters may publish local defaults in
      // the application's public vocabulary and thereby mask ancestor themes.
      for (const node of host.querySelectorAll<HTMLElement>('[style]')) {
        expect([...Array(node.style.length)].map((_, i) => node.style.item(i))
          .filter((property) => property.startsWith('--wm-'))).toEqual([]);
      }
      const presentation = host.querySelector<HTMLElement>('[part~="presentation"]')!;
      expect(presentation.style.getPropertyValue('color-scheme')).toBe('');
    });
  }
});
