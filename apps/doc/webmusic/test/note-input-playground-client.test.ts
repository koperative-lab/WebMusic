// @vitest-environment jsdom

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {mountNoteInputPlaygrounds} from '../src/components/note-input-playground-client';
import {mountPlaygrounds} from '../src/components/playground-client';

type ParamControl = HTMLInputElement | HTMLSelectElement;
type RecorderElement = HTMLElement & {source?: EventTarget};

let clipboardWrite: ReturnType<typeof vi.fn>;

function renderPanel(): HTMLElement {
  document.body.innerHTML = `
    <div
      data-wm-pg
      data-target="[data-ni-input]"
      data-markup="[data-ni-composition]"
    >
      <div data-pg-stage>
        <div data-ni-composition data-pg-fragment>
          <note-input
            data-ni-input
            layout="piano"
            start="48"
            end="71"
          ></note-input>
        </div>
      </div>

      <div data-pg-controls>
        <label>
          <select data-pg-attr="layout">
            <option value="piano">piano</option>
            <option value="grid">grid</option>
            <option value="chords">chords</option>
          </select>
        </label>
      </div>

      <section data-ni-recorder-editor>
        <span data-ni-recorder-count>0 recorders</span>
        <button type="button" data-ni-recorder-add>Mount recorder</button>
        <div data-ni-recorder-list></div>
        <p data-ni-recorder-empty>No recorder mounted.</p>
        <p data-ni-recorder-status aria-live="polite"></p>

        <template data-ni-recorder-template>
          <details data-ni-recorder-card>
            <label data-pg-scope='[data-ni-recorder]'>
              <input type="number" data-pg-attr="bpm" min="1" step="any">
            </label>
            <label data-pg-scope='[data-ni-recorder]'>
              <input type="number" data-pg-attr="quantize" min="0" step="any">
            </label>
            <button type="button" data-ni-recorder-remove>Remove recorder</button>
          </details>
        </template>
      </section>

      <div data-pg-code-stack>
        <pre data-pg-markup data-pg-copy-source></pre>
        <div data-ni-recorder-code-block hidden>
          <pre data-ni-recorder-code data-pg-copy-source></pre>
        </div>
      </div>
      <button type="button" data-pg-copy>Copy</button>
      <button type="button" data-pg-reset>Reset</button>
    </div>
  `;

  mountPlaygrounds();
  mountNoteInputPlaygrounds();
  return document.querySelector<HTMLElement>('[data-wm-pg]')!;
}

function noteInput(panel: HTMLElement): HTMLElement {
  return panel.querySelector<HTMLElement>('[data-ni-input]')!;
}

function recorder(panel: HTMLElement): RecorderElement | null {
  return panel.querySelector<RecorderElement>('[data-ni-recorder]');
}

function addButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>('[data-ni-recorder-add]')!;
}

function removeButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>('[data-ni-recorder-remove]')!;
}

function recorderControl(panel: HTMLElement, attribute: string): ParamControl {
  return panel.querySelector<ParamControl>(
    `[data-ni-recorder-card] [data-pg-attr="${attribute}"]`,
  )!;
}

function setControl(control: ParamControl, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event(
    control instanceof HTMLSelectElement ? 'change' : 'input',
    {bubbles: true},
  ));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function visibleCopyText(panel: HTMLElement): string {
  return Array.from(panel.querySelectorAll<HTMLElement>('[data-pg-copy-source]'))
    .filter((source) => !source.closest('[hidden]'))
    .map((source) => source.textContent ?? '')
    .join('\n\n');
}

describe('note-input recorder playground', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText: clipboardWrite},
    });
  });

  it('keeps all layouts in one documented demo instead of rendering a separate grid demo', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/content/docs/score/element/play/note-input.mdx'),
      'utf8',
    );
    expect(source.match(/<NoteInputDemo\s*\/>/g) ?? []).toHaveLength(1);
    expect(source).not.toContain('NoteInputGridDemo');
  });

  it('mounts idempotently and creates only one recorder and one editor card', () => {
    const panel = renderPanel();
    mountNoteInputPlaygrounds();
    mountNoteInputPlaygrounds();

    addButton(panel).click();
    addButton(panel).click();

    expect(panel.querySelectorAll('[data-ni-recorder]')).toHaveLength(1);
    expect(panel.querySelectorAll('[data-ni-recorder-card]')).toHaveLength(1);
    expect(panel.querySelector('[data-ni-recorder-empty]')).toHaveProperty('hidden', true);
    expect(panel.querySelector('[data-ni-recorder-count]')?.textContent).toContain('1');
    expect(addButton(panel).disabled).toBe(true);
    expect(addButton(panel).textContent).toBe('Recorder mounted');
  });

  it('switches all three layouts on the same note-input node', () => {
    const panel = renderPanel();
    const input = noteInput(panel);
    addButton(panel).click();
    const attached = recorder(panel)!;

    const layout = panel.querySelector<HTMLSelectElement>('[data-pg-attr="layout"]')!;
    for (const value of ['grid', 'chords', 'piano']) {
      setControl(layout, value);
      expect(noteInput(panel)).toBe(input);
      expect(input.getAttribute('layout')).toBe(value);
      expect(attached.source).toBe(input);
    }
  });

  it('mounts the recorder beside the input and binds its event source directly', () => {
    const panel = renderPanel();
    const composition = panel.querySelector<HTMLElement>('[data-ni-composition]')!;
    const input = noteInput(panel);

    addButton(panel).click();

    const attached = recorder(panel)!;
    expect(attached.localName).toBe('score-recorder');
    expect(attached.parentElement).toBe(composition);
    expect(attached.previousElementSibling).toBe(input);
    expect(attached.source).toBe(input);
  });

  it('routes the reused recorder parameter rows to the recorder scope only', async () => {
    const panel = renderPanel();
    const input = noteInput(panel);
    addButton(panel).click();

    const bpm = recorderControl(panel, 'bpm');
    const quantize = recorderControl(panel, 'quantize');
    expect(bpm.closest('[data-pg-scope]')?.getAttribute('data-pg-scope'))
      .toBe('[data-ni-recorder]');
    expect(quantize.closest('[data-pg-scope]')?.getAttribute('data-pg-scope'))
      .toBe('[data-ni-recorder]');

    setControl(bpm, '96');
    setControl(quantize, '0.5');
    await settle();

    expect(recorder(panel)?.getAttribute('bpm')).toBe('96');
    expect(recorder(panel)?.getAttribute('quantize')).toBe('0.5');
    expect(input.hasAttribute('bpm')).toBe(false);
    expect(input.hasAttribute('quantize')).toBe(false);
    expect(visibleCopyText(panel)).toContain('bpm="96"');
    expect(visibleCopyText(panel)).toContain('quantize="0.5"');
  });

  it('removes cleanly and can mount a fresh recorder again', () => {
    const panel = renderPanel();
    addButton(panel).click();
    const firstRecorder = recorder(panel)!;
    const firstCard = panel.querySelector<HTMLElement>('[data-ni-recorder-card]')!;
    setControl(recorderControl(panel, 'bpm'), '92');

    removeButton(panel).click();

    expect(recorder(panel)).toBeNull();
    expect(panel.querySelector('[data-ni-recorder-card]')).toBeNull();
    expect(panel.querySelector('[data-ni-recorder-empty]')).toHaveProperty('hidden', false);
    expect(panel.querySelector('[data-ni-recorder-count]')?.textContent).toContain('0');
    expect(panel.querySelector<HTMLElement>('[data-ni-recorder-code-block]')?.hidden).toBe(true);
    expect(addButton(panel).disabled).toBe(false);
    expect(addButton(panel).textContent).toBe('+ Mount recorder');

    addButton(panel).click();
    const secondRecorder = recorder(panel)!;
    const secondCard = panel.querySelector<HTMLElement>('[data-ni-recorder-card]')!;
    expect(secondRecorder).not.toBe(firstRecorder);
    expect(secondCard).not.toBe(firstCard);
    expect(secondRecorder.source).toBe(noteInput(panel));
    expect(secondRecorder.getAttribute('bpm')).not.toBe('92');
  });

  it('uses Reset to restore the initial layout and unmounted recorder structure', () => {
    const panel = renderPanel();
    const input = noteInput(panel);
    setControl(panel.querySelector<HTMLSelectElement>('[data-pg-attr="layout"]')!, 'grid');
    addButton(panel).click();
    setControl(recorderControl(panel, 'bpm'), '72');

    panel.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();

    expect(noteInput(panel)).toBe(input);
    expect(input.getAttribute('layout')).toBe('piano');
    expect(recorder(panel)).toBeNull();
    expect(panel.querySelector('[data-ni-recorder-card]')).toBeNull();
    expect(panel.querySelector('[data-ni-recorder-empty]')).toHaveProperty('hidden', false);
    expect(panel.querySelector('[data-ni-recorder-count]')?.textContent).toContain('0');
    expect(panel.querySelector<HTMLElement>('[data-ni-recorder-code-block]')?.hidden).toBe(true);
  });

  it('also restores the authored state after a persisted pageshow', () => {
    const panel = renderPanel();
    const input = noteInput(panel);
    setControl(panel.querySelector<HTMLSelectElement>('[data-pg-attr="layout"]')!, 'chords');
    addButton(panel).click();
    setControl(recorderControl(panel, 'quantize'), '0.25');

    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));

    expect(noteInput(panel)).toBe(input);
    expect(input.getAttribute('layout')).toBe('piano');
    expect(recorder(panel)).toBeNull();
    expect(panel.querySelector('[data-ni-recorder-card]')).toBeNull();
    expect(panel.querySelector('[data-ni-recorder-empty]')).toHaveProperty('hidden', false);
    expect(panel.querySelector<HTMLElement>('[data-ni-recorder-code-block]')?.hidden).toBe(true);
  });

  it('copies the sibling recorder markup and its required source setup only while mounted', async () => {
    const panel = renderPanel();
    addButton(panel).click();
    setControl(recorderControl(panel, 'bpm'), '108');
    setControl(recorderControl(panel, 'quantize'), '0.25');
    await settle();

    const codeBlock = panel.querySelector<HTMLElement>('[data-ni-recorder-code-block]')!;
    const setup = panel.querySelector<HTMLElement>('[data-ni-recorder-code]')!;
    expect(codeBlock.hidden).toBe(false);
    expect(setup.matches('[data-pg-copy-source]')).toBe(true);
    expect(setup.textContent).toMatch(/\.source\s*=/);

    const mountedOutput = visibleCopyText(panel);
    expect(mountedOutput).toContain('<note-input');
    expect(mountedOutput).toContain('<score-recorder');
    expect(mountedOutput).toContain('bpm="108"');
    expect(mountedOutput).toContain('quantize="0.25"');
    expect(mountedOutput).toMatch(/\.source\s*=/);
    expect(mountedOutput).not.toContain('data-ni-');

    panel.querySelector<HTMLButtonElement>('[data-pg-copy]')!.click();
    await settle();
    expect(clipboardWrite).toHaveBeenLastCalledWith(mountedOutput);

    removeButton(panel).click();
    await settle();
    expect(codeBlock.hidden).toBe(true);
    const unmountedOutput = visibleCopyText(panel);
    expect(unmountedOutput).toContain('<note-input');
    expect(unmountedOutput).not.toContain('<score-recorder');
    expect(unmountedOutput).not.toMatch(/\.source\s*=/);

    panel.querySelector<HTMLButtonElement>('[data-pg-copy]')!.click();
    await settle();
    expect(clipboardWrite).toHaveBeenLastCalledWith(unmountedOutput);
  });
});
