// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDemos} from '../src/components/demo-lifecycle';

const releases: Array<() => void> = [];
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const loadClipFromUrl = vi.fn();
type DemoPlayer = HTMLElement & {loading: boolean};
type DemoMixer = HTMLElement & {loading: boolean; members: Array<{clip: object}> | undefined};

function deferred() {
  let resolve!: (value: object) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<object>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function mount() {
  document.body.innerHTML = '<div class="wa-demo"><audio-player id="mixer-session"></audio-player><audio-mixer id="wa-mixer-demo" data-src="/wav/Arabesque%20No.1.wav"></audio-mixer><p data-mixer-status></p></div>';
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/AudioMixerDemo.astro'), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)![1];
  const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  new Function('require', 'exports', code)((name: string) => {
    if (name === '@webmusic/audio/play') return {loadClipFromUrl};
    if (name === '@webmusic/audio/play/element') return {defineAudioMixerElement() {}, defineAudioPlayerElement() {}};
    if (name === './demo-lifecycle') return {
      mountDemos: (...args: Parameters<typeof mountDemos>) => { releases.push(mountDemos(...args)); },
    };
    throw new Error(`Unexpected demo import: ${name}`);
  }, {});
  return {
    player: document.querySelector<DemoPlayer>('audio-player')!,
    mixer: document.querySelector<DemoMixer>('audio-mixer')!,
    status: document.querySelector<HTMLElement>('[data-mixer-status]')!,
  };
}

afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  loadClipFromUrl.mockReset();
});

describe('Audio mixer demo asynchronous source preparation', () => {
  it('keeps both the player and desk loading until members are assigned', async () => {
    const pending = deferred();
    loadClipFromUrl.mockReturnValueOnce(pending.promise);
    const {player, mixer, status} = mount();
    expect(player.loading).toBe(true);
    expect(mixer.loading).toBe(true);
    expect(status.textContent).toBe('');
    expect(status.hidden).toBe(true);
    const clip = {};
    pending.resolve(clip);
    await flush();
    expect(mixer.members?.map((member) => member.clip)).toEqual([clip, clip]);
    expect(player.loading).toBe(false);
    expect(mixer.loading).toBe(false);
  });

  it('clears busy state and reports preparation failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred();
    loadClipFromUrl.mockReturnValueOnce(pending.promise);
    const {player, mixer, status} = mount();
    pending.reject(new Error('decode failed'));
    await flush();
    expect(player.loading).toBe(false);
    expect(mixer.loading).toBe(false);
    expect(status.textContent).toContain('Audio could not be loaded');
    expect(status.hidden).toBe(false);
  });

  it('aborts navigation and ignores the old result after a new mount starts', async () => {
    const old = deferred();
    const fresh = deferred();
    loadClipFromUrl.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const {player, mixer} = mount();
    const signal = loadClipFromUrl.mock.calls[0][1].signal as AbortSignal;
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(signal.aborted).toBe(true);
    expect(player.loading).toBe(false);
    expect(mixer.loading).toBe(false);
    document.dispatchEvent(new Event('astro:page-load'));
    expect(player.loading).toBe(true);
    old.resolve({old: true});
    await flush();
    expect(mixer.members).toBeUndefined();
    expect(player.loading).toBe(true);
    expect(mixer.loading).toBe(true);
    const clip = {fresh: true};
    fresh.resolve(clip);
    await flush();
    expect(mixer.members?.[0]?.clip).toBe(clip);
    expect(player.loading).toBe(false);
    expect(mixer.loading).toBe(false);
  });
});
