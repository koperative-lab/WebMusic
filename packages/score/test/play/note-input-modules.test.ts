// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import * as facade from '../../src/play/element/note-input';
import * as api from '../../src/play/api';
import * as model from '../../src/play/core/note-input-model';
import {mountNoteSurface, pianoKeyLayout} from '@webmusic/ui/note';

describe('note-input module boundaries', () => {
  it('keeps historical mapping exports on the element facade', () => {
    expect(facade.DEFAULT_CHORDS).toBe(model.DEFAULT_CHORDS);
    expect(api.DEFAULT_CHORDS).toBe(model.DEFAULT_CHORDS);
    expect(facade.QWERTY_KEY_MAP).toBe(model.QWERTY_KEY_MAP);
    expect(facade.gridKeyboardMidi).toBe(model.gridKeyboardMidi);
    expect(facade.parseGridMap).toBe(model.parseGridMap);
    expect(api.parseGridMap).toBe(model.parseGridMap);
    expect(model.normalizeNoteInputLayout('unknown')).toBe('piano');
  });

  it('delegates piano, grid, and chord DOM to the published note presenter', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let layout: 'piano' | 'grid' | 'chords' = 'piano';
    const handle = mountNoteSurface(host, {
      snapshot: () => ({
        layout,
        piano: pianoKeyLayout(60, 61, new Map([[60, 'A']])),
        grid: [{midi: 36, code: 'KeyZ', ref: 'z1'}],
        chords: [{label: 'C', index: 0}],
      }),
    });
    expect(handle.element.querySelector('[data-midi="60"]')?.textContent).toBe('A');
    layout = 'grid';
    handle.update();
    expect(handle.element.querySelector('[data-code="KeyZ"]')?.getAttribute('data-midi')).toBe('36');
    layout = 'chords';
    handle.update();
    expect(handle.element.querySelector('button')?.textContent).toBe('C');
    handle.destroy();
  });
});
