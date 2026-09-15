// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import * as elements from '../../src/view/element';
import {createScoreMap} from '../../src/view/core/map';
import {renderScoreThumbnail} from '../../src/view/render/thumbnail';

describe('consolidated View families', () => {
  it('registers three families without duplicate legacy tags', () => {
    elements.defineAllViewElements();
    elements.defineAllViewElements();
    expect(customElements.get('score-view')).toBe(elements.ScoreViewElement);
    expect(customElements.get('pitch-view')).toBe(elements.PitchViewElement);
    expect(customElements.get('sheet-view')).toBe(elements.SheetViewElement);
    for (const tag of ['keyboard-view', 'staff-view', 'fretboard-view', 'score-map', 'score-thumbnail']) {
      expect(customElements.get(tag)).toBeUndefined();
    }
  });

  it('removes redundant Element exports while preserving low-level helpers', () => {
    for (const name of ['KeyboardViewElement', 'StaffViewElement', 'FretboardViewElement',
      'ScoreMapElement', 'ScoreThumbnailElement', 'defineKeyboardViewElement', 'defineStaffViewElement',
      'defineFretboardViewElement', 'defineScoreMapElement', 'defineScoreThumbnailElement']) {
      expect(elements).not.toHaveProperty(name);
    }
    expect(createScoreMap).toBeTypeOf('function');
    expect(renderScoreThumbnail).toBeTypeOf('function');
  });
});
