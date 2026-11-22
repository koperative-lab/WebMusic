// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {mountDemos} from '../src/components/demo-lifecycle';
import {bindTypeSwitch, defaultType, typeLabel} from '../src/components/element-demo-types';
import {ELEMENT_PARAMS} from '../src/lib/params';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pressed = () => [...document.querySelectorAll<HTMLButtonElement>('[data-value]')]
  .filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.dataset.value);

function panel(markup: string, fallback = 'piano-roll'): void {
  document.body.innerHTML = `<div data-wm-pg data-pg-tag="score-view">
    <div data-pg-types="type" data-pg-default="${fallback}">
      <button data-value="piano-roll"></button><button data-value="staff"></button><button data-value="waterfall"></button>
    </div>
    <div data-pg-stage>${markup}</div>
  </div>`;
}

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  document.body.innerHTML = '';
});

describe('Element demo type switch', () => {
  it('names values and resolves the default from the catalog fallback', () => {
    expect(typeLabel('piano-roll')).toBe('Piano roll');
    expect(typeLabel('vu')).toBe('VU');
    expect(defaultType(['vu', 'loudness'], 'vu — needle dial with peak and clip lamps')).toBe('vu');
    expect(defaultType(['score', 'live'], 'none')).toBeUndefined();
  });

  it('starts on the authored attribute, else the fallback', async () => {
    panel('<score-view type="staff"></score-view>');
    release = mountDemos('[data-pg-types]', bindTypeSwitch);
    expect(pressed()).toEqual(['staff']);
    release();
    panel('<score-view></score-view>');
    release = mountDemos('[data-pg-types]', bindTypeSwitch);
    expect(pressed()).toEqual(['piano-roll']);
  });

  it('writes the attribute on every instance of the tag and nothing else', () => {
    panel('<score-view></score-view><score-view type="staff"></score-view><score-player type="keep"></score-player>');
    release = mountDemos('[data-pg-types]', bindTypeSwitch);
    document.querySelector<HTMLButtonElement>('[data-value="waterfall"]')!.click();
    expect([...document.querySelectorAll('score-view')].map((view) => view.getAttribute('type'))).toEqual(['waterfall', 'waterfall']);
    expect(document.querySelector('score-player')!.getAttribute('type')).toBe('keep');
    expect(pressed()).toEqual(['waterfall']);
  });

  it('follows a change the element or script makes, and stops after release', async () => {
    panel('<score-view type="staff"></score-view>');
    release = mountDemos('[data-pg-types]', bindTypeSwitch);
    const view = document.querySelector('score-view')!;
    view.setAttribute('type', 'piano-roll');
    await flush();
    expect(pressed()).toEqual(['piano-roll']);
    release();
    release = undefined;
    view.setAttribute('type', 'waterfall');
    await flush();
    expect(pressed()).toEqual(['piano-roll']);
    document.querySelector<HTMLButtonElement>('[data-value="staff"]')!.click();
    expect(view.getAttribute('type')).toBe('waterfall');
  });

  it('every catalog switch is an enum whose fallback names an option', () => {
    const switches = Object.values(ELEMENT_PARAMS).flatMap((spec) => spec.params.filter((param) => param.switch).map((param) => ({tag: spec.tag, param})));
    expect(switches.map(({tag}) => tag).sort()).toEqual([
      'audio-effect', 'audio-live-view', 'audio-meter', 'audio-view',
      'score-chord-analysis', 'score-effect', 'score-interval-analysis', 'score-note-input', 'score-pitch-view', 'score-view',
    ]);
    for (const {param} of switches) expect(defaultType(param.options ?? [], param.fallback)).toBeDefined();
  });
});
