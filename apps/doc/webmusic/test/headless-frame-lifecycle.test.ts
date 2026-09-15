// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {cleanups} = vi.hoisted(() => ({cleanups: [] as Array<() => void>}));
vi.mock('../src/components/demo-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/demo-lifecycle')>();
  return {...actual, mountDemos: (...args: Parameters<typeof actual.mountDemos>) => {
    const cleanup = actual.mountDemos(...args);
    cleanups.push(cleanup);
    return cleanup;
  }};
});

type PendingCopy = {resolve(): void; reject(error: Error): void};
let requests: PendingCopy[];
let clipboard: ReturnType<typeof vi.fn>;
const flush = async (): Promise<void> => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };
const root = (): HTMLElement => document.querySelector('[data-headless-demo]')!;
const status = (): HTMLElement => root().querySelector('[data-hl-feedback]')!;
const click = (selector: string): void => root().querySelector<HTMLElement>(selector)!.click();

beforeEach(async () => {
  vi.resetModules();
  requests = [];
  clipboard = vi.fn(() => new Promise<void>((resolve, reject) => { requests.push({resolve, reject}); }));
  vi.stubGlobal('navigator', {...navigator, clipboard: {writeText: clipboard}});
  document.body.innerHTML = `<div data-headless-demo>
    <input data-option /><select data-choice><option>a</option><option>b</option></select>
    <button data-command>Apply</button><button data-hl-copy><span>Copy</span></button><button data-hl-reset>Reset</button>
    <p data-hl-feedback hidden></p><pre data-hl-readout>first code</pre>
  </div>`;
  await import('../src/lib/headless-frame-client');
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  await flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('manual Headless frame clipboard lifetime', () => {
  it('copies the current code even when its button child is clicked', async () => {
    click('[data-hl-copy] span');
    expect(clipboard).toHaveBeenCalledWith('first code');
    requests[0].resolve();
    await flush();
    expect(status().textContent).toBe('Code copied.');
    expect(status().hidden).toBe(false);
  });

  it('does not restore old Copy feedback after Reset dispatches its bubbling lifecycle event', async () => {
    const reset = vi.fn();
    root().addEventListener('wm:headless-reset', reset);
    click('[data-hl-copy]');
    click('[data-hl-reset]');
    expect(reset).toHaveBeenCalledOnce();
    requests[0].resolve();
    await flush();
    expect(status().textContent).toBe('');
    expect(status().hidden).toBe(true);
  });

  it.each(['input', 'change', 'click', 'Enter', 'wm:headless-reset'])(
    'preserves newer adapter feedback after %s while an older Copy fails', async (kind) => {
      click('[data-hl-copy]');
      if (kind === 'click') click('[data-command]');
      else if (kind === 'Enter') root().querySelector('[data-option]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      else if (kind === 'wm:headless-reset') root().dispatchEvent(new CustomEvent(kind, {bubbles: true}));
      else root().querySelector(kind === 'input' ? '[data-option]' : '[data-choice]')!.dispatchEvent(new Event(kind, {bubbles: true}));
      status().textContent = 'Updated musical result.';
      status().hidden = false;
      requests[0].reject(new Error('Old clipboard failure'));
      await flush();
      expect(status().textContent).toBe('Updated musical result.');
    },
  );

  it('lets only the newest Copy request report its outcome', async () => {
    click('[data-hl-copy]');
    root().querySelector('[data-hl-readout]')!.textContent = 'second code';
    click('[data-hl-copy] span');
    expect(clipboard.mock.calls.map(([text]) => text)).toEqual(['first code', 'second code']);
    requests[1].reject(new Error('Latest clipboard failure'));
    await flush();
    expect(status().textContent).toBe('Latest clipboard failure');
    requests[0].resolve();
    await flush();
    expect(status().textContent).toBe('Latest clipboard failure');
  });

  it('ignores clipboard completion after navigation removes the frame', async () => {
    click('[data-hl-copy]');
    const previousStatus = status();
    root().remove();
    await flush();
    requests[0].reject(new Error('Late clipboard failure'));
    await flush();
    expect(previousStatus.textContent).toBe('');
  });
});
