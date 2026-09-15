// @vitest-environment jsdom
/// <reference types="astro/client" />

import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountPlaygrounds} from '../src/components/playground-client';
import {mountRackControlPlaygrounds} from '../src/components/rack-control-playground-client';

vi.hoisted(() => vi.stubEnv('BASE_URL', '/WebMusic/'));
afterAll(() => vi.unstubAllEnvs());

interface PartRecipe {
  key: string;
  id: string;
  src: string;
  sound: string;
  format?: string;
}

const INITIAL_PARTS: PartRecipe[] = [
  {key: 'rack-part-1', id: 'lead', src: '/midi/lead.mid', sound: 'triangle'},
  {key: 'rack-part-2', id: 'bass', src: '/midi/bass.mid', sound: 'sawtooth'},
  {key: 'rack-part-3', id: 'pad', src: '/midi/pad.mid', sound: 'sine'},
];

const scopeFor = (key: string): string => `[data-pg-child-key="${key}"]`;

function fields(scope?: string): string {
  const scopeAttribute = scope ? ` data-pg-scope='${scope}'` : '';
  return `
    <label${scopeAttribute}><input data-pg-attr="id"></label>
    <label${scopeAttribute}><input data-pg-attr="src"></label>
    <label${scopeAttribute}>
      <select data-pg-attr="format">
        <option value="">adaptive</option>
        <option value="midi">midi</option>
        <option value="abc">abc</option>
      </select>
    </label>
    <label${scopeAttribute}><input data-pg-attr="sound"></label>
  `;
}

function partMarkup(part: PartRecipe): string {
  const format = part.format ? ` format="${part.format}"` : '';
  return `<rack-part
    data-pg-child-key="${part.key}"
    id="${part.id}"
    src="${part.src}"
    sound="${part.sound}"${format}
  ></rack-part>`;
}

function cardMarkup(part: PartRecipe): string {
  return `
    <details data-rc-part-card data-rc-key="${part.key}">
      <summary data-rc-summary tabindex="0">
        <span data-rc-summary-name>${part.id}</span>
        <span data-rc-summary-meta></span>
      </summary>
      ${fields(scopeFor(part.key))}
      <p data-rc-name-error></p>
      <button type="button" data-rc-remove>Remove part</button>
    </details>
  `;
}

function renderRackPanel(): HTMLElement {
  document.body.innerHTML = `
    <div
      data-wm-pg
      data-target="[data-rc-desk]"
      data-markup="[data-rc-master]"
    >
      <div data-pg-stage>
        <score-player data-rc-master>
          <rack-control data-rc-desk>
            ${INITIAL_PARTS.map(partMarkup).join('')}
          </rack-control>
        </score-player>
      </div>

      <section data-rc-collection aria-labelledby="rack-parts-title">
        <span id="rack-parts-title">Rack parts</span>
        <span data-rc-count></span>
        <button type="button" data-rc-add aria-expanded="false">+ Add part</button>

        <form data-rc-draft data-pg-draft hidden novalidate>
          ${fields()}
          <p data-rc-name-error></p>
          <button type="button" data-rc-cancel>Cancel</button>
          <button type="submit">Create part</button>
        </form>

        <div data-rc-list>
          ${INITIAL_PARTS.map(cardMarkup).join('')}
        </div>
        <p data-rc-empty hidden></p>
        <p data-rc-status></p>

        <template data-rc-part-template>
          <details data-rc-part-card>
            <summary data-rc-summary tabindex="0">
              <span data-rc-summary-name></span>
              <span data-rc-summary-meta></span>
            </summary>
            ${fields(scopeFor('__rack_part_key__'))}
            <p data-rc-name-error></p>
            <button type="button" data-rc-remove>Remove part</button>
          </details>
        </template>
      </section>

      <pre data-pg-markup></pre>
      <button type="button" data-pg-reset>Reset</button>
      <button type="button" data-pg-copy>Copy</button>
    </div>
  `;

  mountPlaygrounds();
  mountRackControlPlaygrounds();
  return document.querySelector<HTMLElement>('[data-wm-pg]')!;
}

function desk(panel: HTMLElement): HTMLElement {
  return panel.querySelector<HTMLElement>('[data-rc-desk]')!;
}

function directParts(panel: HTMLElement): HTMLElement[] {
  return Array.from(desk(panel).children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.localName === 'rack-part',
  );
}

function draftControl(panel: HTMLElement, attribute: string): HTMLInputElement | HTMLSelectElement {
  return panel.querySelector(`[data-rc-draft] [data-pg-attr="${attribute}"]`)!;
}

function card(panel: HTMLElement, key: string): HTMLElement {
  return panel.querySelector<HTMLElement>(`[data-rc-part-card][data-rc-key="${key}"]`)!;
}

function cardControl(
  panel: HTMLElement,
  key: string,
  attribute: string,
): HTMLInputElement | HTMLSelectElement {
  return card(panel, key).querySelector(`[data-pg-attr="${attribute}"]`)!;
}

function type(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event('input', {bubbles: true}));
}

function submitDraft(panel: HTMLElement): void {
  panel.querySelector<HTMLFormElement>('[data-rc-draft]')!
    .dispatchEvent(new SubmitEvent('submit', {bubbles: true, cancelable: true}));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function addPart(panel: HTMLElement, recipe: Omit<PartRecipe, 'key'>): void {
  panel.querySelector<HTMLButtonElement>('[data-rc-add]')!.click();
  type(draftControl(panel, 'id'), recipe.id);
  type(draftControl(panel, 'src'), recipe.src);
  type(draftControl(panel, 'sound'), recipe.sound);
  if (recipe.format) type(draftControl(panel, 'format'), recipe.format);
  submitDraft(panel);
}

describe('rack-control nested playground', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('keeps the deployment base in the default source when adding and resetting parts', () => {
    const panel = renderRackPanel();
    const addButton = panel.querySelector<HTMLButtonElement>('[data-rc-add]')!;
    addButton.click();

    expect(draftControl(panel, 'src').value).toBe('/WebMusic/midi/demo.mid');
    type(draftControl(panel, 'id'), 'strings');
    submitDraft(panel);

    expect(directParts(panel).at(-1)?.getAttribute('src')).toBe('/WebMusic/midi/demo.mid');
    expect(cardControl(panel, 'rack-part-4', 'src').value).toBe('/WebMusic/midi/demo.mid');
    const copied = document.createElement('template');
    copied.innerHTML = panel.querySelector('[data-pg-markup]')?.textContent ?? '';
    expect(copied.content.querySelector('rack-part#strings')?.getAttribute('src'))
      .toBe('/WebMusic/midi/demo.mid');

    addButton.click();
    type(draftControl(panel, 'src'), '/custom.mid');
    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    addButton.click();
    expect(draftControl(panel, 'src').value).toBe('/WebMusic/midi/demo.mid');
  });

  it('keeps draft controls inert, then creates a configured part and stable-scoped card', () => {
    const panel = renderRackPanel();
    const before = directParts(panel);
    panel.querySelector<HTMLButtonElement>('[data-rc-add]')!.click();

    type(draftControl(panel, 'id'), 'strings');
    type(draftControl(panel, 'src'), '/midi/strings.abc');
    type(draftControl(panel, 'format'), 'abc');
    type(draftControl(panel, 'sound'), 'square');

    expect(directParts(panel)).toEqual(before);
    expect(desk(panel).querySelector('#strings')).toBeNull();

    submitDraft(panel);

    const created = directParts(panel).at(-1)!;
    expect(created.dataset.pgChildKey).toBe('rack-part-4');
    expect(Object.fromEntries(
      ['id', 'src', 'format', 'sound'].map((name) => [name, created.getAttribute(name)]),
    )).toEqual({
      id: 'strings',
      src: '/midi/strings.abc',
      format: 'abc',
      sound: 'square',
    });

    const createdCard = card(panel, 'rack-part-4');
    expect(createdCard.querySelector('[data-pg-scope]')?.getAttribute('data-pg-scope'))
      .toBe(scopeFor('rack-part-4'));
    expect(cardControl(panel, 'rack-part-4', 'id').value).toBe('strings');
    expect(cardControl(panel, 'rack-part-4', 'src').value).toBe('/midi/strings.abc');
    expect(panel.querySelector('[data-rc-count]')?.textContent).toBe('4 parts');
  });

  it('routes existing nested fields through the shared delegated parameter writer', async () => {
    const panel = renderRackPanel();
    const lead = directParts(panel)[0]!;
    const leadName = cardControl(panel, 'rack-part-1', 'id');

    type(leadName, 'melody');
    expect(lead.id).toBe('lead');
    leadName.dispatchEvent(new Event('change', {bubbles: true}));
    type(cardControl(panel, 'rack-part-1', 'src'), '/midi/melody.mid');
    type(cardControl(panel, 'rack-part-1', 'sound'), 'square');
    cardControl(panel, 'rack-part-1', 'format').value = 'midi';
    cardControl(panel, 'rack-part-1', 'format')
      .dispatchEvent(new Event('change', {bubbles: true}));
    await settle();

    expect(lead.id).toBe('melody');
    expect(lead.getAttribute('src')).toBe('/midi/melody.mid');
    expect(lead.getAttribute('sound')).toBe('square');
    expect(lead.getAttribute('format')).toBe('midi');
    expect(card(panel, 'rack-part-1').querySelector('[data-rc-summary-name]')?.textContent)
      .toBe('melody');
    const copied = document.createElement('template');
    copied.innerHTML = panel.querySelector('[data-pg-markup]')?.textContent ?? '';
    const copiedPart = copied.content.querySelector('rack-part#melody');
    expect(copiedPart?.getAttribute('src')).toBe('/midi/melody.mid');
    expect(copiedPart?.getAttribute('sound')).toBe('square');
    expect(copiedPart?.getAttribute('format')).toBe('midi');
  });

  it('rejects blank and duplicate names for both drafts and existing parts', () => {
    const panel = renderRackPanel();
    const draftName = draftControl(panel, 'id');
    panel.querySelector<HTMLButtonElement>('[data-rc-add]')!.click();

    type(draftName, '');
    submitDraft(panel);
    expect(directParts(panel)).toHaveLength(3);
    expect(draftName.getAttribute('aria-invalid')).toBe('true');

    type(draftName, 'lead');
    submitDraft(panel);
    expect(directParts(panel)).toHaveLength(3);
    expect(draftName.validationMessage).toContain('already exists');

    const leadName = cardControl(panel, 'rack-part-1', 'id');
    type(leadName, 'bass');
    expect(directParts(panel)[0]?.id).toBe('lead');
    expect(leadName.getAttribute('aria-invalid')).toBe('true');

    type(leadName, '');
    expect(directParts(panel)[0]?.id).toBe('lead');
    expect(leadName.validationMessage).toContain('Enter a part name');
  });

  it('removes the selected nested item instead of only the last one', async () => {
    const panel = renderRackPanel();
    card(panel, 'rack-part-2').querySelector<HTMLButtonElement>('[data-rc-remove]')!.click();
    await settle();

    expect(directParts(panel).map((part) => part.id)).toEqual(['lead', 'pad']);
    expect(panel.querySelector('[data-rc-part-card][data-rc-key="rack-part-2"]')).toBeNull();
    expect(panel.querySelector('[data-rc-part-card][data-rc-key="rack-part-3"]')).not.toBeNull();
    expect(panel.querySelector('[data-rc-count]')?.textContent).toBe('2 parts');
  });

  it('uses the shared Reset to restore exact initial parts, attributes, cards and fields', () => {
    const panel = renderRackPanel();
    type(cardControl(panel, 'rack-part-1', 'id'), 'edited-lead');
    type(cardControl(panel, 'rack-part-1', 'src'), '/midi/edited.mid');
    card(panel, 'rack-part-2').querySelector<HTMLButtonElement>('[data-rc-remove]')!.click();
    addPart(panel, {
      id: 'percussion',
      src: '/midi/drums.mid',
      sound: 'noise',
      format: 'midi',
    });

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();

    expect(directParts(panel).map((part) => ({
      key: part.dataset.pgChildKey,
      id: part.id,
      src: part.getAttribute('src'),
      format: part.getAttribute('format'),
      sound: part.getAttribute('sound'),
    }))).toEqual(INITIAL_PARTS.map((part) => ({
      key: part.key,
      id: part.id,
      src: part.src,
      format: null,
      sound: part.sound,
    })));
    expect(Array.from(panel.querySelectorAll<HTMLElement>('[data-rc-part-card]'))
      .map((item) => item.dataset.rcKey)).toEqual(INITIAL_PARTS.map((part) => part.key));
    expect(cardControl(panel, 'rack-part-1', 'id').value).toBe('lead');
    expect(cardControl(panel, 'rack-part-1', 'src').value).toBe('/midi/lead.mid');
    expect(panel.querySelector('[data-rc-part-card][data-rc-key="rack-part-4"]')).toBeNull();
    expect(panel.querySelector<HTMLFormElement>('[data-rc-draft]')?.hidden).toBe(true);
    expect(panel.querySelector('[data-rc-count]')?.textContent).toBe('3 parts');
  });

  it('also restores the initial nested structure after a BFCache pageshow', () => {
    const panel = renderRackPanel();
    type(cardControl(panel, 'rack-part-3', 'sound'), 'square');
    card(panel, 'rack-part-1').querySelector<HTMLButtonElement>('[data-rc-remove]')!.click();
    addPart(panel, {id: 'fx', src: '/midi/fx.mid', sound: 'noise'});

    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));

    expect(directParts(panel).map((part) => part.id)).toEqual(['lead', 'bass', 'pad']);
    expect(directParts(panel)[2]?.getAttribute('sound')).toBe('sine');
    expect(Array.from(panel.querySelectorAll<HTMLElement>('[data-rc-part-card]'))
      .map((item) => item.dataset.rcKey)).toEqual(INITIAL_PARTS.map((part) => part.key));
    expect(cardControl(panel, 'rack-part-3', 'sound').value).toBe('sine');
  });
});
