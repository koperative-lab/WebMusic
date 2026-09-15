// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from 'vitest';
import {mountPlaygrounds} from '../src/components/playground-client';
import {
  mountSynthPanelPlaygrounds,
  synthPanelSetupCode,
} from '../src/components/synth-panel-playground-client';

const values: Record<string, string> = {
  wave: 'triangle',
  tune: '0',
  level: '0.18',
  cutoff: '8000',
  resonance: '0.7',
  attack: '0.05',
  decay: '0.2',
  sustain: '0.6',
  release: '0.4',
  'attack-max': '2',
  'decay-max': '2',
  'release-max': '2',
  'low-frequency': '120',
  'low-gain': '0',
  'low-q': '0.8',
  'mid-frequency': '1000',
  'mid-gain': '0',
  'mid-q': '0.9',
  'high-frequency': '6000',
  'high-gain': '0',
  'high-q': '0.9',
  'lfo-shape': 'sine',
  'lfo-rate': '1',
  'lfo-depth': '0.6',
  'lfo-phase': '0',
  'lfo-running': 'off',
  'lfo-min': '400',
  'lfo-max': '9000',
  bright: '0.5',
  body: '0.5',
};

const groupFor = (key: string): string => {
  if (['wave', 'tune', 'level', 'cutoff', 'resonance'].includes(key)) return 'voice';
  if (['attack', 'decay', 'sustain', 'release', 'attack-max', 'decay-max', 'release-max'].includes(key)) return 'envelope';
  if (key.startsWith('low-') || key.startsWith('mid-') || key.startsWith('high-')) return 'eq';
  return 'modulation';
};

function propertyControls(): string {
  const groups = new Map<string, string[]>();
  for (const [key, value] of Object.entries(values)) {
    const markup = key === 'wave'
      ? `<select data-syp-param="wave" data-syp-default="triangle"><option value="triangle">triangle</option><option value="sine">sine</option></select>`
      : key === 'lfo-shape'
        ? `<select data-syp-param="lfo-shape" data-syp-default="sine"><option value="sine">sine</option><option value="square">square</option></select>`
        : key === 'lfo-running'
          ? `<select data-syp-param="lfo-running" data-syp-default="off"><option value="off">off</option><option value="on">on</option></select>`
      : `<input type="number" data-syp-param="${key}" data-syp-default="${value}" value="${value}" min="-100000" max="100000" step="any" required>`;
    const group = groupFor(key);
    groups.set(group, [...(groups.get(group) ?? []), markup]);
  }
  return Array.from(groups, ([group, controls]) => (
    `<div data-syp-group="${group}">${controls.join('')}</div>`
  )).join('');
}

function render(): {
  playground: HTMLElement;
  panel: HTMLElement & Record<string, unknown>;
} {
  document.body.innerHTML = `
    <div data-wm-pg data-target="[data-syp]">
      <div data-pg-stage>
        <note-input data-syp-input></note-input>
        <synth-panel data-syp sections="sound,effects,envelope,eq,lfo,macros"></synth-panel>
      </div>
      <section data-syp-properties>
        ${propertyControls()}
        <p data-syp-status></p>
      </section>
      <label><input data-pg-attr="sections"></label>
      <pre data-pg-markup></pre>
      <pre data-syp-code data-pg-copy-source></pre>
      <button type="button" data-pg-reset>Reset</button>
      <button type="button" data-pg-copy>Copy</button>
    </div>
  `;
  const playground = document.querySelector<HTMLElement>('[data-wm-pg]')!;
  const panel = playground.querySelector<HTMLElement>('[data-syp]')! as HTMLElement & Record<string, unknown>;
  let lfo = {shape: 'sine', rate: 1, depth: 0.6, phase: 0, running: false};
  Object.defineProperty(panel, 'lfo', {
    configurable: true,
    get: () => ({...lfo}),
    set: (config: Partial<typeof lfo>) => {
      lfo = {...lfo, ...config};
    },
  });
  mountPlaygrounds();
  mountSynthPanelPlaygrounds();
  return {playground, panel};
}

function control(key: string): HTMLInputElement | HTMLSelectElement {
  return document.querySelector(`[data-syp-param="${key}"]`)!;
}

function change(key: string, value: string): void {
  const item = control(key);
  item.value = value;
  item.dispatchEvent(new Event('change', {bubbles: true}));
}

describe('synth-panel property playground', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('assigns every property family to the same live panel', () => {
    const {panel} = render();

    expect(panel.sound).toHaveLength(5);
    expect((panel.sound as Array<{name: string}>).map((item) => item.name))
      .toEqual(['wave', 'tune', 'level', 'cutoff', 'resonance']);
    expect(panel.envelope).toEqual({attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4});
    expect(panel.ranges).toEqual({attackMax: 2, decayMax: 2, releaseMax: 2});
    expect(panel.bands).toEqual([
      {frequency: 120, gain: 0, q: 0.8},
      {frequency: 1000, gain: 0, q: 0.9},
      {frequency: 6000, gain: 0, q: 0.9},
    ]);
    expect(panel.target).toMatchObject({min: 400, max: 9000, value: 8000, unit: 'Hz'});
    expect(panel.lfo).toEqual({shape: 'sine', rate: 1, depth: 0.6, phase: 0, running: false});
    expect(panel.macros).toHaveLength(2);
    expect((panel.macros as Array<{label: string}>).map((item) => item.label))
      .toEqual(['BRIGHT', 'BODY']);
    expect(panel).toHaveProperty('apply');
    expect(document.querySelector('[data-syp-code]')?.textContent)
      .toContain('panel.macros = [');
  });

  it('commits one property group at a time and reflects component events', () => {
    const {panel} = render();
    const initialSound = panel.sound;

    change('attack', '0.45');
    expect(panel.envelope).toEqual({attack: 0.45, decay: 0.2, sustain: 0.6, release: 0.4});
    expect(panel.sound).toBe(initialSound);

    change('mid-gain', '4.5');
    expect(panel.bands).toEqual(expect.arrayContaining([
      expect.objectContaining({frequency: 1000, gain: 4.5}),
    ]));

    panel.dispatchEvent(new CustomEvent('webscore:envelope', {
      detail: {attack: 0.1, decay: 0.3, sustain: 0.75, release: 0.8},
    }));
    expect(control('sustain').value).toBe('0.75');
    expect(document.querySelector('[data-syp-code]')?.textContent)
      .toContain('sustain: 0.75');

    panel.dispatchEvent(new CustomEvent('webscore:macro', {detail: {index: 1, value: 0.72}}));
    expect(control('body').value).toBe('0.72');

    panel.dispatchEvent(new CustomEvent('webscore:lfo', {
      detail: {shape: 'square', rate: 2.5, depth: 0.4, phase: 0.25, running: true},
    }));
    expect(control('lfo-shape').value).toBe('square');
    expect(control('lfo-rate').value).toBe('2.5');
    expect(control('lfo-depth').value).toBe('0.4');
    expect(control('lfo-phase').value).toBe('0.25');
    expect(control('lfo-running').value).toBe('on');
    expect(document.querySelector('[data-syp-code]')?.textContent)
      .toContain("panel.lfo = {shape: 'square', rate: 2.5, depth: 0.4, phase: 0.25, running: true};");
  });

  it('is idempotent and Reset restores properties, controls and sections', () => {
    const {playground, panel} = render();
    mountSynthPanelPlaygrounds();

    change('wave', 'sine');
    change('release', '1.25');
    change('lfo-max', '12000');
    const sections = playground.querySelector<HTMLInputElement>('[data-pg-attr="sections"]')!;
    sections.value = 'sound,envelope';
    sections.dispatchEvent(new Event('input', {bubbles: true}));

    playground.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();

    expect(control('wave').value).toBe('triangle');
    expect(control('release').value).toBe('0.4');
    expect(control('lfo-max').value).toBe('9000');
    expect(control('lfo-running').value).toBe('off');
    expect(panel.getAttribute('sections')).toBe('sound,effects,envelope,eq,lfo,macros');
    expect(panel.envelope).toEqual({attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4});
    expect(panel.target).toMatchObject({min: 400, max: 9000});
    expect(panel.lfo).toEqual({shape: 'sine', rate: 1, depth: 0.6, phase: 0, running: false});
  });

  it('keeps invalid drafts out of sibling commits and rejects reversed LFO bounds', async () => {
    const {panel} = render();
    const attack = control('attack') as HTMLInputElement;
    attack.value = '';
    attack.dispatchEvent(new Event('input', {bubbles: true}));

    change('decay', '0.7');
    expect(panel.envelope).toEqual({attack: 0.05, decay: 0.7, sustain: 0.6, release: 0.4});
    expect(document.querySelector('[data-syp-code]')?.textContent)
      .toContain('attack: 0.05, decay: 0.7');

    const targetBefore = panel.target;
    change('lfo-min', '12000');
    await Promise.resolve();
    expect(panel.target).toBe(targetBefore);
    expect(control('lfo-min').getAttribute('aria-invalid')).toBe('true');
    expect(control('lfo-max').getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('[data-syp-status]')?.textContent)
      .toContain('target.min must be less than or equal to target.max');
    expect(document.querySelector('[data-syp-code]')?.textContent)
      .toContain('panel.target = {min: 400, max: 9000');
  });

  it('restores authored property state after a persisted page show', () => {
    const {panel} = render();
    change('wave', 'sine');
    change('lfo-running', 'on');
    change('bright', '0.8');

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', {value: true});
    window.dispatchEvent(pageShow);

    expect(control('wave').value).toBe('triangle');
    expect(control('lfo-running').value).toBe('off');
    expect(control('bright').value).toBe('0.5');
    expect(panel.lfo).toEqual({shape: 'sine', rate: 1, depth: 0.6, phase: 0, running: false});
  });

  it('produces standalone setup for the configured graph', () => {
    const setup = synthPanelSetupCode({
      voice: {wave: 'sine', tune: -4, level: 0.2, cutoff: 5000, resonance: 1.2},
      envelope: {attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.8},
      ranges: {attackMax: 3, decayMax: 4, releaseMax: 5},
      bands: [
        {frequency: 100, gain: -2, q: 0.7},
        {frequency: 900, gain: 3, q: 1},
        {frequency: 7000, gain: 1, q: 0.8},
      ],
      lfoShape: 'square',
      lfoRate: 2.5,
      lfoDepth: 0.4,
      lfoPhase: 0.25,
      lfoRunning: true,
      lfoMin: 300,
      lfoMax: 8000,
      bright: 0.4,
      body: 0.6,
    });

    expect(setup).toContain("type: 'sine'");
    expect(setup).toContain('panel.ranges = {attackMax: 3, decayMax: 4, releaseMax: 5};');
    expect(setup).toContain('{frequency: 900, gain: 3, q: 1}');
    expect(setup).toContain("panel.lfo = {shape: 'square', rate: 2.5, depth: 0.4, phase: 0.25, running: true};");
    expect(setup).toContain('synth.connect(panel.input ?? context.destination);');
    expect(setup).toContain('panel.output?.connect(context.destination);');
  });
});
