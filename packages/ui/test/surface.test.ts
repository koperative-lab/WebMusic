import {describe, expect, it} from 'vitest';
import {
  analysisStyle,
  envelopeStyle,
  eqStyle,
  lfoStyle,
  harmonyPresenterStyle,
  pitchStyle,
  workbenchStyle,
  macroRackStyle,
  macroStyle,
  meterStyle,
  minimapStyle,
  mixerStyle,
  noteStyle,
  parameterRackStyle,
  playlistStyle,
  recorderStyle,
  sectionPanelStyle,
  stageStyle,
  statusStyle,
  timelineStyle,
  trackListStyle,
  transportStyle,
} from '../src';
import {
  componentSurfaceDeclarations,
  controlBorderFallback,
} from '../src/internal/surface';
import {harmonyTokens} from '../src/harmony-style';

function ruleBodies(style: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...style.matchAll(new RegExp(`${escaped}\\)?\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1] ?? '');
}

function expectRuleToContain(style: string, selector: string, value: string): void {
  expect(
    ruleBodies(style, selector).some((body) => body.includes(value)),
    `${selector} should contain ${value}`,
  ).toBe(true);
}

describe('component surfaces', () => {
  it('uses one strict neutral default and the canonical override order', () => {
    expect(componentSurfaceDeclarations('example')).toEqual({
      'box-sizing': 'border-box',
      padding: 'var(--wm-example-surface-padding, var(--wm-component-padding, .6rem))',
      border: 'var(--wm-example-surface-border, var(--wm-component-border, 1px solid var(--wm-border, #d8d8d8)))',
      'border-radius': 'var(--wm-example-surface-radius, var(--wm-component-radius, var(--wm-control-radius, 0)))',
      background: 'var(--wm-example-surface-background, var(--wm-component-background, var(--wm-surface, #fff)))',
    });

    const legacy = componentSurfaceDeclarations('example', {background: 'var(--legacy, #fff)'});
    expect(legacy.background).toBe(
      'var(--wm-example-surface-background, var(--wm-component-background, var(--legacy, #fff)))',
    );
  });

  it.each([
    ['analysis', analysisStyle],
    ['envelope', envelopeStyle],
    ['eq', eqStyle],
    ['lfo', lfoStyle],
    ['harmony', harmonyPresenterStyle],
    ['pitch', pitchStyle],
    ['workbench', workbenchStyle],
    ['macro', macroStyle],
    ['macro-rack', macroRackStyle],
    ['meter', meterStyle],
    ['minimap', minimapStyle],
    ['mixer', mixerStyle],
    ['note', noteStyle],
    ['parameter', parameterRackStyle],
    ['playlist', playlistStyle],
    ['recorder', recorderStyle],
    ['panel', sectionPanelStyle],
    ['stage', stageStyle],
    ['status', statusStyle],
    ['timeline', timelineStyle],
    ['track-list', trackListStyle],
    ['transport', transportStyle],
  ])('%s owns its outer frame', (name, style) => {
    expect(style).toContain(`--wm-${name}-surface-background`);
    expect(style).toContain(`--wm-${name}-surface-border`);
    expect(style).toContain(`--wm-${name}-surface-padding`);
    expect(style).toContain(`--wm-${name}-surface-radius`);
    expect(style).toContain('--wm-component-background');
    expect(style).toContain('--wm-component-border');
    expect(style).toContain('--wm-component-padding');
    expect(style).toContain('--wm-component-radius');
  });

  it('keeps inverse graph colors on the functional SVG viewport', () => {
    expect(envelopeStyle).toMatch(/\.wui-envelope__svg[\s\S]*--wm-envelope-background/);
    expect(eqStyle).toMatch(/\.wui-eq__svg[\s\S]*--wm-eq-background/);
  });

  it('keeps canvas geometry inside the padded minimap and stage viewports', () => {
    expect(minimapStyle).toContain('.wui-minimap__viewport');
    expect(stageStyle).toContain('.wui-stage__surface');
    expect(statusStyle).toContain('.wui-status--embedded');
    expect(statusStyle).toContain('background: transparent');
    expect(macroRackStyle).toContain('.wui-macro-rack__item > .wui-macro');
  });

  it('keeps the mixer surface gutter even while protecting focus rings', () => {
    expectRuleToContain(mixerStyle, '.wui-mixer__channels', 'overflow-x:auto');
    expectRuleToContain(mixerStyle, '.wui-mixer__channels', 'padding:.3rem .3rem .5rem');
    expectRuleToContain(mixerStyle, '.wui-mixer__master', 'padding-block-start:.3rem');
    expect(mixerStyle).not.toContain('margin-block-start:-4px');
  });
});

describe('internal control borders', () => {
  it('publishes one light neutral fallback independent from the outer surface', () => {
    expect(controlBorderFallback).toBe(
      'var(--wm-control-border, var(--wm-border, #d8d8d8))',
    );
    expect(controlBorderFallback).not.toContain('--wm-component-border');
  });

  it.each([
    ['recorder button', recorderStyle, '.wui-recorder__button', 'border:', '--wm-recorder-button-border'],
    ['LFO shape chip', lfoStyle, '.wui-lfo__shape', 'border:', '--wm-lfo-chip-border'],
    ['mixer button', mixerStyle, '.wui-mixer__button', 'border:', '--wm-mixer-button-border'],
    ['mixer fader', mixerStyle, '.wui-mixer__input', '--wm-fader-track-border:', '--wm-mixer-track-border'],
    ['EQ viewport', eqStyle, '.wui-eq__svg', 'border:', '--wm-eq-border'],
    ['EQ point', eqStyle, '.wui-eq__point', 'stroke:', '--wm-eq-point-border'],
    ['envelope viewport', envelopeStyle, '.wui-envelope__svg', 'border:', '--wm-envelope-border'],
    ['envelope handle', envelopeStyle, '.wui-envelope__handle', 'stroke:', '--wm-envelope-handle-border'],
    ['playlist secondary button', playlistStyle, '.wui-playlist__button', 'border:', '--wm-playlist-button-border'],
    ['parameter group', parameterRackStyle, '.wui-parameter-rack__group', 'border:', '--wm-parameter-item-border'],
    [
      'flat parameter item',
      parameterRackStyle,
      ".wui-parameter-rack[data-layout='flat'] > .wui-parameter-rack__item",
      'border:',
      '--wm-parameter-item-border',
    ],
    ['note key', noteStyle, '.wui-note__key', 'border:', '--wm-note-border'],
    ['note grid cell', noteStyle, '.wui-note__cell', 'border:', '--wm-note-border'],
    ['note chord', noteStyle, '.wui-note__chord', 'border:', '--wm-note-border'],
    ['timeline ruler', timelineStyle, '.wui-timeline__ruler', 'border:', '--wm-timeline-border'],
    ['timeline lane', timelineStyle, '.wui-timeline__lane', 'border:', '--wm-timeline-border'],
  ])('%s uses the shared light control edge', (_name, style, selector, property, token) => {
    expectRuleToContain(style, selector, property);
    expectRuleToContain(style, selector, token);
    expectRuleToContain(style, selector, controlBorderFallback);
  });

  it('keeps primary actions visually distinct from neutral secondary controls', () => {
    expectRuleToContain(
      playlistStyle,
      '.wui-playlist__button.play',
      'var(--wm-accent, #111)',
    );
    expectRuleToContain(
      lfoStyle,
      '.wui-lfo__run',
      'var(--wm-foreground, #111)',
    );
    expectRuleToContain(
      transportStyle,
      '.wui-transport__play',
      'background: var(--wui-transport-button-bg)',
    );
  });

  it('does not turn filled transport tracks and slider thumbs into outlined boxes', () => {
    expectRuleToContain(transportStyle, '.wui-transport__track', 'border: 0');
    expectRuleToContain(transportStyle, '.wui-transport__seek', 'border: 0');
    expectRuleToContain(
      lfoStyle,
      '.wui-lfo__input::-webkit-slider-thumb',
      'border: 0',
    );
    expectRuleToContain(
      lfoStyle,
      '.wui-lfo__input::-moz-range-thumb',
      'border: 0',
    );
  });
});

describe('shared theme composition', () => {
  it.each([
    ['envelope', envelopeStyle, '.wui-envelope', '.wui-envelope__svg'],
    ['EQ', eqStyle, '.wui-eq__curve', '.wui-eq__svg'],
    ['LFO', lfoStyle, '.wui-lfo__curve', '.wui-lfo__wave'],
  ])('keeps %s inverse ink and surface independent of an ordinary light theme', (_name, style, ink, surface) => {
    const inkRules = ruleBodies(style, ink).join('\n');
    const surfaceRules = ruleBodies(style, surface).join('\n');
    expect(inkRules).toContain('var(--wm-foreground-on-inverse, #fff)');
    expect(inkRules).not.toContain('var(--wm-foreground,');
    expect(surfaceRules).toContain('var(--wm-surface-inverse, #111)');
    expect(surfaceRules).not.toContain('var(--wm-surface,');
  });

  it('uses achromatic neutrals in both color schemes without stripping musical palettes', () => {
    const neutralChains = Object.entries(harmonyTokens)
      .filter(([name]) => /-(paint|on-accent|ink-muted|line|accent|track|info)$/.test(name))
      .map(([, value]) => value);
    for (const match of pitchStyle.matchAll(/var\(--wui-pitch-(?:key-white|key-black|key-border|key-label|staff-line|fret-neck|fret-wire|fret-nut|fret-string|fret-inlay),[^;\n]+/g)) {
      neutralChains.push(match[0]);
    }
    expect(neutralChains.length).toBeGreaterThan(10);
    for (const value of neutralChains) {
      for (const [hex] of value.matchAll(/#[\da-f]{3,6}\b/gi)) {
        const digits = hex.slice(1);
        const channels = digits.length === 3 ? [...digits] : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
        expect(new Set(channels).size, `${hex} in ${value} should be neutral`).toBe(1);
      }
    }
    expect(harmonyTokens['--wui-degree-root']).toContain('#c2410c');
    expect(harmonyTokens['--wui-degree-third']).toContain('#0369a1');
  });

  it.each([
    ['recorder', recorderStyle, '.wui-recorder'],
    ['macro', macroStyle, '.wui-macro'],
    ['mixer', mixerStyle, '.wui-mixer'],
    ['EQ empty state', eqStyle, '.wui-eq__empty'],
  ])('lets the shared font family reach %s while retaining the legacy fallback', (_name, style, selector) => {
    const rule = ruleBodies(style, selector).join('\n');
    expect(rule).toMatch(/var\(--wm-font-family,\s*var\(--wm-font,/);
  });

  it('keeps mono readouts and button labels on the shared typography path', () => {
    expectRuleToContain(envelopeStyle, '.wui-envelope__readout', '--wm-font-mono');
    expectRuleToContain(recorderStyle, '.wui-recorder__status', '--wm-font-mono');
    expectRuleToContain(recorderStyle, '.wui-recorder__button', 'font:inherit');
    expectRuleToContain(playlistStyle, '.wui-playlist__button', 'font: inherit');
  });

  it('gives recorder and playlist controls the shared keyboard focus treatment', () => {
    expectRuleToContain(recorderStyle, '.wui-recorder__button:focus-visible', '--wm-focus');
    expect(playlistStyle).toContain('.wui-playlist__button:focus-visible,');
    expectRuleToContain(playlistStyle, '.wui-playlist__seek:focus-visible', '--wm-focus');
  });

  it('lets one control-size token resize analysis buttons as well as transport controls', () => {
    expectRuleToContain(workbenchStyle, '.wui-workbench__tab', '--wm-control-size');
    expectRuleToContain(workbenchStyle, '.wui-workbench__dock-toggle', '--wm-control-size');
    expectRuleToContain(workbenchStyle, '.wui-workbench__dock-knob', '--wm-control-size');
    expectRuleToContain(harmonyPresenterStyle, 'button.wui-harmony-nameplate__alternate', '--wm-control-size');
  });
});
