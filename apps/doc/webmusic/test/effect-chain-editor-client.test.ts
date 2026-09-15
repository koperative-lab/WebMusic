// @vitest-environment jsdom

import {Effect} from '@webmusic/score/play/headless';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {mountEffectChainEditors} from '../src/components/effect-chain-editor-client';
import {mountPlaygrounds} from '../src/components/playground-client';
import {
  buildPlaygroundEffect,
  buildPlaygroundEffects,
  createEffectItem,
  EFFECT_DEFINITIONS,
  effectSetupCode,
} from '../src/lib/effect-playground';

function fieldMarkup(kind: string): string {
  const definition = EFFECT_DEFINITIONS.find((candidate) => candidate.kind === kind)!;
  return definition.fields.map((field) => {
    if (field.kind === 'enum') {
      const options = field.options.map((option) => (
        `<option value="${option}"${option === field.defaultValue ? ' selected' : ''}>${option}</option>`
      )).join('');
      return `<label><select data-fx-field="${field.key}" required>${options}</select></label>`;
    }
    return `<label><input
      type="number"
      data-fx-field="${field.key}"
      value="${field.defaultValue}"
      min="${field.min}"
      max="${field.max}"
      step="${field.step}"
      required
    ></label>`;
  }).join('');
}

function templateMarkup(kind: string): string {
  const definition = EFFECT_DEFINITIONS.find((candidate) => candidate.kind === kind)!;
  return `
    <template data-fx-template="${definition.kind}">
      <details data-fx-card data-fx-effect="${definition.kind}">
        <summary data-fx-summary>
          <strong>${definition.label}</strong>
          <span data-fx-summary-meta></span>
        </summary>
        ${fieldMarkup(definition.kind)}
        <button type="button" data-fx-up>Up</button>
        <button type="button" data-fx-down>Down</button>
        <button type="button" data-fx-remove>Remove</button>
      </details>
    </template>
  `;
}

interface RenderOptions {
  target?: 'score-player' | 'rack-control' | 'synth-panel';
  assignment?: 'effect' | 'effects';
  initial?: string;
  invalidEditorFirst?: boolean;
}

function renderEffectsPanel(options: RenderOptions = {}) {
  const isRack = options.target === 'rack-control';
  const isSynthPanel = options.target === 'synth-panel';
  const targetSelector = isRack
    ? '[data-rc-desk]'
    : isSynthPanel ? 'synth-panel' : 'score-player';
  const targetMarkup = isRack
    ? '<score-player><rack-control data-rc-desk></rack-control></score-player>'
    : isSynthPanel
      ? '<synth-panel></synth-panel>'
      : '<score-player src="/midi/demo.mid"></score-player>';
  const setupSelector = isRack
    ? 'rack-control'
    : isSynthPanel ? 'synth-panel' : 'score-player';
  const setupIdentifier = isRack
    ? 'rackControl'
    : isSynthPanel ? 'synthPanel' : 'player';
  const assignment = options.assignment ?? 'effect';
  document.body.innerHTML = `
    <div data-wm-pg data-target="${targetSelector}">
      <div data-pg-stage>${targetMarkup}</div>
      ${options.invalidEditorFirst ? `
        <section data-effect-chain-editor data-fx-target="[">
          <select data-fx-kind><option value="reverb">Reverb</option></select>
          <button type="button" data-fx-add>+ Add</button>
          <div data-fx-list></div>
        </section>
      ` : ''}
      <section
        data-effect-chain-editor
        data-fx-target="${targetSelector}"
        data-fx-assignment="${assignment}"
        data-fx-initial="${options.initial ?? ''}"
        data-fx-setup-selector="${setupSelector}"
        data-fx-setup-identifier="${setupIdentifier}"
        aria-labelledby="effect-chain-title"
      >
        <span id="effect-chain-title">Effects</span>
        <span data-fx-count></span>
        <select data-fx-kind>
          ${EFFECT_DEFINITIONS.map((definition) => (
            `<option value="${definition.kind}">${definition.label}</option>`
          )).join('')}
        </select>
        <button type="button" data-fx-add>+ Add</button>
        <div data-fx-list></div>
        <p data-fx-empty></p>
        <p data-fx-status aria-live="polite"></p>
        ${EFFECT_DEFINITIONS.map((definition) => templateMarkup(definition.kind)).join('')}
      </section>
      <div data-pg-code-stack>
        <pre data-pg-markup data-pg-copy-source></pre>
        <div data-fx-code-block hidden>
          <pre data-fx-code data-pg-copy-source></pre>
        </div>
      </div>
      <button type="button" data-pg-reset>Reset</button>
      <button type="button" data-pg-copy>Copy</button>
    </div>
  `;

  const panel = document.querySelector<HTMLElement>('[data-wm-pg]')!;
  const target = panel.querySelector<HTMLElement>(targetSelector)!;
  let assignedEffect: Effect | undefined;
  let assignedEffects: Effect[] | undefined;
  const setEffect = vi.fn<(effect: Effect | undefined) => void>((effect) => {
    assignedEffect = effect;
  });
  const setEffects = vi.fn<(effects: Effect[]) => void>((effects) => {
    assignedEffects = effects;
  });
  const stop = vi.fn();
  if (assignment === 'effects') {
    Object.defineProperty(target, 'effects', {
      configurable: true,
      get: () => assignedEffects,
      set: setEffects,
    });
  } else {
    Object.defineProperty(target, 'effect', {
      configurable: true,
      get: () => assignedEffect,
      set: setEffect,
    });
  }
  if (!isRack && !isSynthPanel) {
    Object.defineProperty(target, 'stop', {configurable: true, value: stop});
  }

  mountPlaygrounds();
  mountEffectChainEditors();
  return {
    panel,
    target,
    setEffect,
    setEffects,
    stop,
    effect: () => assignedEffect,
    effects: () => assignedEffects,
  };
}

function selectKind(panel: HTMLElement, kind: string): void {
  const select = panel.querySelector<HTMLSelectElement>('[data-fx-kind]')!;
  select.value = kind;
}

function addEffect(panel: HTMLElement, kind: string): HTMLElement {
  selectKind(panel, kind);
  panel.querySelector<HTMLButtonElement>('[data-fx-add]')!.click();
  return Array.from(panel.querySelectorAll<HTMLElement>('[data-fx-card]')).at(-1)!;
}

function field(card: HTMLElement, key: string): HTMLInputElement | HTMLSelectElement {
  return card.querySelector(`[data-fx-field="${key}"]`)!;
}

describe('effect-chain editor shared by component playgrounds', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('offers every supported recipe and expands the equalizer to three peaking filters', () => {
    const filter = vi.spyOn(Effect, 'filter');
    const items = EFFECT_DEFINITIONS.map((definition, index) => (
      createEffectItem(definition.kind, `effect-${index + 1}`)
    ));

    expect(EFFECT_DEFINITIONS.map((definition) => definition.kind)).toEqual([
      'reverb',
      'equalizer',
      'filter',
      'delay',
      'chorus',
      'compressor',
      'distortion',
    ]);
    expect(buildPlaygroundEffect(items)).toBeInstanceOf(Effect);
    expect(filter).toHaveBeenCalledTimes(4);
    expect(filter.mock.calls.slice(0, 3).map(([options]) => options?.type))
      .toEqual(['peaking', 'peaking', 'peaking']);

    const setup = effectSetupCode(items, {identifier: 'player'});
    for (const factory of ['reverb', 'filter', 'delay', 'chorus', 'compressor', 'distortion']) {
      expect(setup).toContain(`Effect.${factory}(`);
    }
    expect(setup.match(/type: 'peaking'/g)).toHaveLength(3);
  });

  it('builds and assigns a flat effect array for synth-panel', () => {
    const equalizer = createEffectItem('equalizer', 'effect-1');
    expect(buildPlaygroundEffects([equalizer])).toHaveLength(3);

    const {panel, setEffect, setEffects, effects, stop} = renderEffectsPanel({
      target: 'synth-panel',
      assignment: 'effects',
    });
    addEffect(panel, 'equalizer');
    addEffect(panel, 'reverb');

    expect(setEffect).not.toHaveBeenCalled();
    expect(setEffects).toHaveBeenCalledTimes(2);
    expect(effects()).toHaveLength(4);
    expect(effects()?.every((effect) => effect instanceof Effect)).toBe(true);
    expect(stop).not.toHaveBeenCalled();

    const setup = panel.querySelector<HTMLElement>('[data-fx-code]')?.textContent ?? '';
    expect(setup).toContain("const synthPanel = document.querySelector('synth-panel');");
    expect(setup).toContain('synthPanel.effects = [');
    expect(setup).not.toContain('synthPanel.effect = Effect.chain(');
    expect(setup.match(/Effect\.filter\(/g)).toHaveLength(3);

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    expect(effects()).toEqual([]);
    expect(setEffects).toHaveBeenLastCalledWith([]);
  });

  it('loads and restores an authored effect stack', () => {
    const {panel, effects, setEffects} = renderEffectsPanel({
      target: 'synth-panel',
      assignment: 'effects',
      initial: 'reverb,delay',
    });

    expect(effects()).toHaveLength(2);
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(2);
    expect(Array.from(panel.querySelectorAll<HTMLElement>('[data-fx-card]'))
      .map((card) => card.dataset.fxEffect)).toEqual(['reverb', 'delay']);

    panel.querySelector<HTMLElement>('[data-fx-card] [data-fx-remove]')?.click();
    expect(effects()).toHaveLength(1);
    setEffects.mockClear();

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    expect(effects()).toHaveLength(2);
    expect(setEffects).toHaveBeenCalledTimes(1);
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(2);
  });

  it('targets the rack-control summed bus and emits rack-specific setup code', () => {
    const {panel, setEffect, stop} = renderEffectsPanel({target: 'rack-control'});

    addEffect(panel, 'compressor');

    expect(setEffect).toHaveBeenCalledTimes(1);
    expect(setEffect).toHaveBeenCalledWith(expect.any(Effect));
    expect(stop).not.toHaveBeenCalled();
    const setup = panel.querySelector<HTMLElement>('[data-fx-code]')?.textContent ?? '';
    expect(setup).toContain("const rackControl = document.querySelector('rack-control');");
    expect(setup).toContain('rackControl.effect = Effect.chain(');
  });

  it('rolls pending UI back when the target rejects a replacement', async () => {
    const {panel, setEffect, effect} = renderEffectsPanel({target: 'rack-control'});
    const failure = new Error('replacement failed');
    setEffect.mockImplementationOnce(() => { throw failure; });

    selectKind(panel, 'delay');
    panel.querySelector<HTMLButtonElement>('[data-fx-add]')!.click();
    await Promise.resolve();

    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(0);
    expect(panel.querySelector('[data-fx-count]')?.textContent).toBe('0 effects');
    expect(panel.querySelector<HTMLElement>('[data-fx-code-block]')?.hidden).toBe(true);
    expect(panel.querySelector('[data-fx-status]')?.textContent)
      .toContain('Effects were not applied. replacement failed');
    expect(effect()).toBeUndefined();

    addEffect(panel, 'delay');
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(1);
    const applied = effect();
    const delay = panel.querySelector<HTMLElement>('[data-fx-card]')!;
    const time = field(delay, 'delaySeconds');
    time.value = '0.6';
    setEffect.mockImplementationOnce(() => { throw failure; });
    time.dispatchEvent(new Event('change', {bubbles: true}));
    expect(time.value).toBe('0.25');
    expect(effect()).toBe(applied);

    setEffect.mockImplementationOnce(() => { throw failure; });
    delay.querySelector<HTMLButtonElement>('[data-fx-remove]')!.click();
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(1);
    expect(effect()).toBe(applied);
  });

  it('lets later editors mount when an earlier demo has an invalid selector', () => {
    const {panel, effect} = renderEffectsPanel({invalidEditorFirst: true});
    const editors = panel.querySelectorAll<HTMLElement>('[data-effect-chain-editor]');
    const validEditor = editors[1]!;

    addEffect(validEditor, 'chorus');

    expect(effect()).toBeInstanceOf(Effect);
    expect(validEditor.querySelectorAll('[data-fx-card]')).toHaveLength(1);
  });

  it('does not rebuild on input, then stops and applies one chain on change', () => {
    const {panel, setEffect, stop} = renderEffectsPanel();
    const card = addEffect(panel, 'reverb');
    setEffect.mockClear();
    stop.mockClear();

    const seconds = field(card, 'seconds');
    seconds.value = '2.4';
    seconds.dispatchEvent(new Event('input', {bubbles: true}));
    expect(stop).not.toHaveBeenCalled();
    expect(setEffect).not.toHaveBeenCalled();

    seconds.dispatchEvent(new Event('change', {bubbles: true}));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(setEffect).toHaveBeenCalledTimes(1);

    setEffect.mockClear();
    stop.mockClear();
    seconds.value = '9';
    seconds.dispatchEvent(new Event('change', {bubbles: true}));
    expect(seconds.getAttribute('aria-invalid')).toBe('true');
    expect(stop).not.toHaveBeenCalled();
    expect(setEffect).not.toHaveBeenCalled();
  });

  it('keeps UI order, runtime order and setup code order together', async () => {
    const {panel} = renderEffectsPanel();
    const reverb = addEffect(panel, 'reverb');
    const delay = addEffect(panel, 'delay');

    delay.querySelector<HTMLButtonElement>('[data-fx-up]')!.click();
    expect(Array.from(panel.querySelectorAll<HTMLElement>('[data-fx-card]'))
      .map((card) => card.dataset.fxEffect)).toEqual(['delay', 'reverb']);

    const setup = panel.querySelector<HTMLElement>('[data-fx-code]')!.textContent ?? '';
    expect(setup.indexOf('Effect.delay(')).toBeLessThan(setup.indexOf('Effect.reverb('));

    reverb.querySelector<HTMLButtonElement>('[data-fx-remove]')!.click();
    await Promise.resolve();
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(1);
    expect(panel.querySelector('[data-fx-card]')?.getAttribute('data-fx-effect')).toBe('delay');
    expect(panel.querySelector('[data-fx-count]')?.textContent).toBe('1 effect');
    expect(document.activeElement).toBe(delay.querySelector('[data-fx-summary]'));
  });

  it('restores dry output on Reset and persisted pageshow', () => {
    const {panel, effect, setEffect, stop} = renderEffectsPanel();
    addEffect(panel, 'chorus');
    expect(effect()).toBeInstanceOf(Effect);
    expect(panel.querySelector<HTMLElement>('[data-fx-code-block]')?.hidden).toBe(false);

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(0);
    expect(panel.querySelector('[data-fx-count]')?.textContent).toBe('0 effects');
    expect(panel.querySelector<HTMLElement>('[data-fx-code-block]')?.hidden).toBe(true);
    expect(panel.querySelector<HTMLSelectElement>('[data-fx-kind]')?.value).toBe('reverb');
    expect(effect()).toBeUndefined();

    addEffect(panel, 'distortion');
    setEffect.mockClear();
    stop.mockClear();
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(0);
    expect(panel.querySelector<HTMLSelectElement>('[data-fx-kind]')?.value).toBe('reverb');
    expect(effect()).toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(setEffect).toHaveBeenCalledWith(undefined);
  });

  it('resets the rack master chain without treating the mixer as a transport', () => {
    const {panel, effect, stop} = renderEffectsPanel({target: 'rack-control'});
    addEffect(panel, 'equalizer');
    expect(effect()).toBeInstanceOf(Effect);

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    expect(effect()).toBeUndefined();
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(0);
    expect(stop).not.toHaveBeenCalled();

    addEffect(panel, 'reverb');
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    expect(effect()).toBeUndefined();
    expect(panel.querySelectorAll('[data-fx-card]')).toHaveLength(0);
    expect(stop).not.toHaveBeenCalled();
  });
});
