// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  mountPlaygrounds,
  PLAYGROUND_RESET_EVENT,
  PLAYGROUND_SYNC_EVENT,
} from '../src/components/playground-client';

function renderPanel(contents: string): HTMLElement {
  document.body.innerHTML = `
    <div data-wm-pg data-target="demo-root">
      <div data-pg-stage>${contents}</div>
      <div data-pg-controls></div>
      <div data-pg-code-stack>
        <pre data-pg-markup data-pg-copy-source></pre>
      </div>
      <button type="button" data-pg-reset>Reset</button>
      <button type="button" data-pg-copy>Copy</button>
    </div>
  `;
  return document.querySelector<HTMLElement>('[data-wm-pg]')!;
}

function inputFor(name: string, scope?: string): HTMLInputElement {
  const row = document.createElement('label');
  if (scope) row.dataset.pgScope = scope;
  const input = document.createElement('input');
  input.dataset.pgAttr = name;
  row.append(input);
  return input;
}

function addControl(panel: HTMLElement, input: HTMLInputElement): void {
  panel.querySelector('[data-pg-controls]')!.append(input.parentElement!);
}

describe('element playground client', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
  });

  it('deterministically clears browser-restored values when attributes are absent', () => {
    const panel = renderPanel('<demo-root></demo-root>');
    const text = inputFor('src');
    text.value = 'browser-restored.mid';
    addControl(panel, text);

    const bool = document.createElement('select');
    bool.dataset.pgAttr = 'loop';
    bool.dataset.pgKind = 'bool';
    bool.innerHTML = '<option value="unset">off</option><option value="on">on</option>';
    bool.value = 'on';
    const boolRow = document.createElement('label');
    boolRow.append(bool);
    panel.querySelector('[data-pg-controls]')!.append(boolRow);

    mountPlaygrounds();

    expect(text.value).toBe('');
    expect(bool.value).toBe('unset');
    expect(panel.querySelector('demo-root')?.hasAttribute('src')).toBe(false);
    expect(panel.querySelector('demo-root')?.hasAttribute('loop')).toBe(false);
  });

  it('delegates dynamic controls while leaving draft controls inert', () => {
    const panel = renderPanel(`
      <demo-root>
        <demo-child data-pg-child-key="lead" src="lead.mid"></demo-child>
      </demo-root>
    `);
    mountPlaygrounds();

    const scope = '[data-pg-child-key="lead"]';
    const dynamic = inputFor('src', scope);
    addControl(panel, dynamic);
    dynamic.value = 'edited.mid';
    dynamic.dispatchEvent(new Event('input', {bubbles: true}));

    const child = panel.querySelector('demo-child')!;
    expect(child.getAttribute('src')).toBe('edited.mid');
    expect(panel.querySelector('[data-pg-markup]')?.textContent).toContain('src="edited.mid"');

    const draft = document.createElement('div');
    draft.dataset.pgDraft = '';
    const draftInput = inputFor('sound', scope);
    draft.append(draftInput.parentElement!);
    panel.querySelector('[data-pg-controls]')!.append(draft);
    draftInput.value = 'triangle';
    draftInput.dispatchEvent(new Event('input', {bubbles: true}));
    expect(child.hasAttribute('sound')).toBe(false);

    draft.removeAttribute('data-pg-draft');
    panel.dispatchEvent(new Event(PLAYGROUND_SYNC_EVENT));
    expect(draftInput.value).toBe('');
    draftInput.value = 'triangle';
    draftInput.dispatchEvent(new Event('input', {bubbles: true}));
    expect(child.getAttribute('sound')).toBe('triangle');

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    expect(child.getAttribute('src')).toBe('lead.mid');
    expect(child.hasAttribute('sound')).toBe(false);
    expect(dynamic.value).toBe('lead.mid');
    expect(draftInput.value).toBe('');
  });

  it('can defer identity-like text fields until their change is committed', () => {
    const panel = renderPanel('<demo-root id="lead"></demo-root>');
    const id = inputFor('id');
    id.dataset.pgCommit = 'change';
    addControl(panel, id);
    mountPlaygrounds();

    const root = panel.querySelector('demo-root')!;
    id.value = 'melody';
    id.dispatchEvent(new Event('input', {bubbles: true}));
    expect(root.id).toBe('lead');

    id.dispatchEvent(new Event('change', {bubbles: true}));
    expect(root.id).toBe('melody');
  });

  it('dispatches structural reset first, then restores stable-scope authored values', () => {
    const panel = renderPanel(`
      <demo-root volume="0.5">
        <demo-child data-pg-child-key="lead" src="lead.mid"></demo-child>
      </demo-root>
    `);
    const volume = inputFor('volume');
    const loop = inputFor('loop');
    const childSrc = inputFor('src', '[data-pg-child-key="lead"]');
    addControl(panel, volume);
    addControl(panel, loop);
    addControl(panel, childSrc);
    mountPlaygrounds();

    volume.value = '0.9';
    volume.dispatchEvent(new Event('input', {bubbles: true}));
    loop.value = 'true';
    loop.dispatchEvent(new Event('input', {bubbles: true}));
    childSrc.value = 'edited.mid';
    childSrc.dispatchEvent(new Event('input', {bubbles: true}));

    let valueSeenByResetListener = '';
    panel.addEventListener(PLAYGROUND_RESET_EVENT, () => {
      const current = panel.querySelector('demo-child')!;
      valueSeenByResetListener = current.getAttribute('src') ?? '';
      const replacement = document.createElement('demo-child');
      replacement.dataset.pgChildKey = 'lead';
      replacement.setAttribute('src', 'temporary.mid');
      current.replaceWith(replacement);
    });

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();

    const root = panel.querySelector('demo-root')!;
    const restoredChild = panel.querySelector('demo-child')!;
    expect(valueSeenByResetListener).toBe('edited.mid');
    expect(root.getAttribute('volume')).toBe('0.5');
    expect(root.hasAttribute('loop')).toBe(false);
    expect(restoredChild.getAttribute('src')).toBe('lead.mid');
    expect(volume.value).toBe('0.5');
    expect(loop.value).toBe('');
    expect(childSrc.value).toBe('lead.mid');
  });

  it('does not rewrite an authored value already restored by a structural editor', () => {
    const panel = renderPanel(`
      <demo-root>
        <demo-child data-pg-child-key="lead" src="lead.mid"></demo-child>
      </demo-root>
    `);
    const childSrc = inputFor('src', '[data-pg-child-key="lead"]');
    addControl(panel, childSrc);
    mountPlaygrounds();

    let setAttribute: ReturnType<typeof vi.spyOn> | undefined;
    panel.addEventListener(PLAYGROUND_RESET_EVENT, () => {
      const replacement = document.createElement('demo-child');
      replacement.dataset.pgChildKey = 'lead';
      replacement.setAttribute('src', 'lead.mid');
      setAttribute = vi.spyOn(replacement, 'setAttribute');
      panel.querySelector('demo-child')!.replaceWith(replacement);
    });

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();

    expect(setAttribute).toBeDefined();
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('handles explicit and pageshow syncs without mounting duplicate delegates', () => {
    const panel = renderPanel('<demo-root mode="first"></demo-root>');
    const mode = inputFor('mode');
    addControl(panel, mode);
    mountPlaygrounds();
    mountPlaygrounds();

    const root = panel.querySelector('demo-root')!;
    const setAttribute = vi.spyOn(root, 'setAttribute');
    mode.value = 'second';
    mode.dispatchEvent(new Event('input', {bubbles: true}));
    expect(setAttribute).toHaveBeenCalledTimes(1);

    root.setAttribute('mode', 'external');
    panel.dispatchEvent(new Event(PLAYGROUND_SYNC_EVENT));
    expect(mode.value).toBe('external');

    let resetEvents = 0;
    panel.addEventListener(PLAYGROUND_RESET_EVENT, () => {
      resetEvents += 1;
    });

    root.setAttribute('mode', 'normal-load');
    mode.value = 'stale';
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: false}));
    expect(root.getAttribute('mode')).toBe('normal-load');
    expect(mode.value).toBe('normal-load');
    expect(resetEvents).toBe(0);

    root.setAttribute('mode', 'page-cache');
    mode.value = 'stale';
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    expect(root.getAttribute('mode')).toBe('first');
    expect(mode.value).toBe('first');
    expect(resetEvents).toBe(1);
  });

  it('escapes copied markup attribute values', () => {
    const panel = renderPanel('<demo-root></demo-root>');
    panel.querySelector('demo-root')!.setAttribute('label', 'A&B"<tag>');
    mountPlaygrounds();

    expect(panel.querySelector('[data-pg-markup]')?.textContent).toBe(
      '<demo-root label="A&amp;B&quot;&lt;tag&gt;"></demo-root>',
    );
  });

  it('flattens a native composition fragment and observes newly mounted sibling components', async () => {
    const panel = renderPanel(`
      <div data-pg-fragment>
        <note-input layout="piano"></note-input>
        <span>documentation chrome</span>
        <score-recorder bpm="120"></score-recorder>
      </div>
    `);
    panel.dataset.target = 'note-input';
    panel.dataset.markup = '[data-pg-fragment]';

    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    mountPlaygrounds();

    const markup = panel.querySelector<HTMLElement>('[data-pg-markup]')!;
    expect(markup.textContent).toBe(
      '<note-input layout="piano"></note-input>\n' +
      '<score-recorder bpm="120"></score-recorder>',
    );
    expect(markup.textContent).not.toContain('<div');
    expect(markup.textContent).not.toContain('documentation chrome');

    const synth = document.createElement('synth-panel');
    synth.setAttribute('sections', 'sound,effects');
    panel.querySelector<HTMLElement>('[data-pg-fragment]')!.append(synth);

    const expected =
      '<note-input layout="piano"></note-input>\n' +
      '<score-recorder bpm="120"></score-recorder>\n' +
      '<synth-panel sections="sound,effects"></synth-panel>';
    await vi.waitFor(() => expect(markup.textContent).toBe(expected));

    panel.querySelector<HTMLButtonElement>('[data-pg-copy]')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  });

  it('copies HTML together with visible JavaScript setup, and omits hidden setup', async () => {
    const panel = renderPanel('<demo-root src="demo.mid"></demo-root>');
    const setup = document.createElement('div');
    setup.dataset.fxCodeBlock = '';
    setup.innerHTML = '<pre data-pg-copy-source>player.effect = Effect.reverb();</pre>';
    panel.querySelector('[data-pg-code-stack]')!.append(setup);

    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    mountPlaygrounds();

    panel.querySelector<HTMLButtonElement>('[data-pg-copy]')!.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        '<demo-root src="demo.mid"></demo-root>\n\nplayer.effect = Effect.reverb();',
      );
    });

    writeText.mockClear();
    setup.hidden = true;
    panel.querySelector<HTMLButtonElement>('[data-pg-copy]')!.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('<demo-root src="demo.mid"></demo-root>');
    });
  });
});

import {SCORE_PLAY_PARAMS} from '../src/lib/params/score-play';
import {SCORE_VIEW_PARAMS} from '../src/lib/params/score-view';
import {defaultChoices} from '../src/lib/default-label';

function fixture(tag = 'score-view') {
  document.body.replaceChildren();
  const panel = document.createElement('div');
  panel.dataset.wmPg = '';
  panel.dataset.target = tag;
  panel.dataset.markup = '[data-composition]';
  const stage = document.createElement('div');
  stage.dataset.pgStage = '';
  const composition = document.createElement('div');
  composition.dataset.composition = '';
  const player = document.createElement('score-player');
  player.id = 'owner';
  player.setAttribute('src', 'demo.mid');
  const target = document.createElement(tag);
  target.setAttribute('player', '#owner');
  composition.append(player, target);
  stage.append(composition);
  panel.append(stage);
  const addRows = (rowTag: string, scope?: string) => {
    const spec = SCORE_VIEW_PARAMS[rowTag] ?? SCORE_PLAY_PARAMS[rowTag]!;
    for (const param of spec.params) {
      const row = document.createElement('label');
      row.className = 'wm-pg__param';
      if (scope) row.dataset.pgScope = scope;
      if (param.when) row.dataset.pgWhen = JSON.stringify({...param.when,
        options: spec.params.find((entry) => entry.name === param.when!.attribute)?.options});
      let control: HTMLInputElement | HTMLSelectElement;
      if (param.kind === 'enum' || param.kind === 'bool') {
        control = document.createElement('select');
        for (const choice of defaultChoices(param.fallback, param.kind === 'bool' ? ['on', 'off'] : param.options ?? [], param.kind === 'bool' ? 'unset' : '')) {
          const option = document.createElement('option');
          option.value = choice.value;
          option.textContent = choice.label;
          control.append(option);
        }
      } else control = document.createElement('input');
      control.dataset.pgAttr = param.name;
      if (param.kind === 'bool') control.dataset.pgKind = 'bool';
      row.append(control);
      panel.append(row);
    }
  };
  addRows(tag);
  const playerRow = document.createElement('label');
  playerRow.dataset.pgScope = 'score-player';
  const playerSrc = document.createElement('input');
  playerSrc.dataset.pgAttr = 'src';
  playerRow.append(playerSrc);
  panel.append(playerRow);
  const output = document.createElement('pre'); output.dataset.pgMarkup = '';
  const copy = document.createElement('button'); copy.dataset.pgCopy = ''; copy.textContent = 'Copy';
  const reset = document.createElement('button'); reset.dataset.pgReset = '';
  panel.append(output, copy, reset); document.body.append(panel);
  const input = (name: string) => panel.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-pg-attr="${name}"]`)!;
  const row = (name: string) => input(name).closest('label')!;
  const change = (name: string, value: string) => {
    const control = input(name); control.value = value; control.dispatchEvent(new Event('change', {bubbles: true}));
  };
  return {panel, composition, player, target, playerSrc, output, copy, reset, input, row, change, addRows};
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('type-specific Element playground parameters', () => {
  it('formats long nested tags while preserving copied attribute values', () => {
    const f = fixture();
    const source = '/scores/a-long-example-for-a-small-composable-view.musicxml?title="Lead & bass"';
    f.player.setAttribute('src', source);
    f.target.setAttribute('type', 'waterfall');
    f.target.setAttribute('white-note-width', '28');
    f.target.setAttribute('active-note-color', '#f59e0b');
    mountPlaygrounds();
    const markup = f.output.textContent!;
    expect(markup).toContain('  <score-player\n');
    expect(markup).toContain('  <score-view\n');
    const copy = document.createElement('template');
    copy.innerHTML = markup;
    expect(copy.content.querySelector('score-player')?.getAttribute('src')).toBe(source);
    expect(copy.content.querySelector('score-view')?.getAttribute('player')).toBe('#owner');
    expect(copy.content.querySelector('score-view')?.getAttribute('active-note-color')).toBe('#f59e0b');
  });
  it('follows the effective type, retains hidden values, and leaves shared controls visible', async () => {
    const f = fixture(); mountPlaygrounds();
    expect(f.row('cells').hidden).toBe(true);
    expect(f.row('note-height').hidden).toBe(false);
    f.change('type', 'map'); f.change('cells', '42');
    expect(f.row('cells').hidden).toBe(false);
    expect(f.row('note-height').hidden).toBe(true);
    f.change('type', 'staff');
    expect(f.row('cells').hidden).toBe(true);
    expect(f.target.getAttribute('cells')).toBe('42');
    f.change('type', 'map');
    expect(f.input('cells').value).toBe('42');
    for (const name of ['src', 'format', 'player', 'type', 'width', 'height']) expect(f.row(name).hidden).toBe(false);
    f.target.setAttribute('type', 'not-a-type'); await Promise.resolve();
    expect(f.row('cells').hidden).toBe(true);
    expect(f.row('note-height').hidden).toBe(false);
  });

  it('copies the complete composition and Reset restores both owners and type visibility', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    const f = fixture('pitch-view'); mountPlaygrounds();
    f.change('type', 'fretboard'); f.change('frets', '9');
    f.playerSrc.value = 'other.mid'; f.playerSrc.dispatchEvent(new Event('change', {bubbles: true}));
    f.change('type', 'staff'); f.copy.click(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<score-player id="owner" src="other.mid">'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<pitch-view player="#owner" type="staff" frets="9">'));
    expect(f.row('frets').hidden).toBe(true);
    f.reset.click();
    expect(f.player.getAttribute('src')).toBe('demo.mid');
    expect(f.target.getAttribute('player')).toBe('#owner');
    expect(f.target.hasAttribute('type')).toBe(false);
    expect(f.target.hasAttribute('frets')).toBe(false);
    expect(f.row('low').hidden).toBe(false);
    expect(f.row('system').hidden).toBe(true);
    expect(f.output.textContent).not.toContain('other.mid');
    vi.runOnlyPendingTimers();
  });

  it('exposes keyboard fitting in Parameters and retains it across types and Copy/Reset', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    const f = fixture('pitch-view'); mountPlaygrounds();
    expect(f.row('fit-to-width').hidden).toBe(false);
    f.change('fit-to-width', 'on');
    expect(f.target.getAttribute('fit-to-width')).toBe('');
    f.copy.click(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('fit-to-width'));
    f.change('type', 'fretboard'); expect(f.row('fit-to-width').hidden).toBe(true);
    f.change('type', 'keyboard'); expect(f.row('fit-to-width').hidden).toBe(false);
    expect(f.input('fit-to-width').value).toBe('on');
    f.change('fit-to-width', 'unset'); expect(f.target.hasAttribute('fit-to-width')).toBe(false);
    f.change('fit-to-width', 'on');
    f.reset.click(); expect(f.target.hasAttribute('fit-to-width')).toBe(false);
    expect(f.row('fit-to-width').hidden).toBe(false);
    vi.runOnlyPendingTimers();
  });

  it('keeps annotation visibility shared across every score type and includes it in Copy/Reset', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    const f = fixture(); mountPlaygrounds();
    expect(f.input('show-annotations').value).toBe('unset');
    f.change('show-annotations', 'off');
    for (const type of ['staff', 'waterfall', 'map', 'thumbnail', 'piano-roll']) {
      f.change('type', type);
      expect(f.row('show-annotations').hidden).toBe(false);
      expect(f.input('show-annotations').value).toBe('off');
      expect(f.target.getAttribute('show-annotations')).toBe('false');
    }
    f.copy.click(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('show-annotations="false"'));
    f.reset.click();
    expect(f.target.hasAttribute('show-annotations')).toBe(false);
    expect(f.input('show-annotations').value).toBe('unset');
    expect(f.row('show-annotations').hidden).toBe(false);
    expect(f.output.textContent).not.toContain('show-annotations');
  });

  it('resolves conditional companion rows against their own scoped element', () => {
    const f = fixture('score-view');
    const companion = document.createElement('pitch-view'); companion.setAttribute('type', 'fretboard');
    f.composition.append(companion); f.addRows('pitch-view', 'pitch-view'); mountPlaygrounds();
    const scopeRow = (name: string) => f.panel.querySelector<HTMLLabelElement>(`[data-pg-scope="pitch-view"]:has([data-pg-attr="${name}"])`)!;
    expect(scopeRow('frets').hidden).toBe(false);
    expect(scopeRow('low').hidden).toBe(true);
    f.change('type', 'map');
    expect(scopeRow('frets').hidden).toBe(false);
    expect(f.row('cells').hidden).toBe(false);
  });
});


describe('Play demo parameter composition', () => {
  it('updates note-input range/map controls when the live layout changes and resets', async () => {
    const f = fixture('note-input');
    mountPlaygrounds();
    expect(f.row('map').hidden).toBe(true);
    expect(f.row('end').hidden).toBe(false);
    f.change('layout', 'grid');
    f.change('map', 'z1=36');
    expect(f.row('map').hidden).toBe(false);
    expect(f.row('end').hidden).toBe(true);
    f.change('layout', 'chords');
    expect(f.row('map').hidden).toBe(true);
    expect(f.target.getAttribute('map')).toBe('z1=36');
    f.reset.click();
    await Promise.resolve();
    expect(f.row('map').hidden).toBe(true);
    expect(f.row('end').hidden).toBe(false);
  });

  it('keeps a renamed Rack declaration addressable through its stable demo scope', () => {
    const f = fixture('rack-control');
    const part = document.createElement('rack-part');
    part.id = 'lead';
    part.dataset.rcPart = 'lead';
    part.setAttribute('src', 'lead.mid');
    f.target.append(part);
    f.addRows('rack-part', '[data-rc-part="lead"]');
    mountPlaygrounds();
    f.change('id', 'melody');
    f.change('sound', 'triangle');
    expect(part.id).toBe('melody');
    expect(part.getAttribute('sound')).toBe('triangle');
    f.reset.click();
    expect(part.id).toBe('lead');
    expect(part.getAttribute('src')).toBe('lead.mid');
    expect(part.hasAttribute('sound')).toBe(false);
  });
});
