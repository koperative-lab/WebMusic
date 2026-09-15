// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {mountMacro} from '@webmusic/ui/macro';
import {mountNoteSurface} from '@webmusic/ui/note';
import {mountParameterRack} from '@webmusic/ui/parameter';

const PAYLOAD = '<img src=x onerror="globalThis.__webscoreXss=true">';


function expectSafeHost(host: HTMLElement): void {
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain(PAYLOAD);
}

describe('published UI presenter escaping', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (globalThis as Record<string, unknown>).__webscoreXss;
  });

  it('keeps note, parameter, and macro labels as text', () => {
    const noteHost = document.createElement('div');
    mountNoteSurface(noteHost, {snapshot: () => ({layout: 'chords', chords: [{label: PAYLOAD, index: 0}]})});
    expectSafeHost(noteHost);

    const parameterHost = document.createElement('div');
    mountParameterRack(parameterHost, {
      snapshot: () => ({parameters: [{id: 'gain', label: PAYLOAD, value: 0, min: 0, max: 1}]}),
      setValue: () => undefined,
    });
    expectSafeHost(parameterHost);

    const macroHost = document.createElement('div');
    mountMacro(macroHost, {
      snapshot: () => ({label: PAYLOAD, value: 0, targets: [{label: PAYLOAD, value: 0}]}),
      setValue: () => undefined,
    });
    expectSafeHost(macroHost);
  });



});
