// @vitest-environment jsdom

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDemos, type DemoScope} from '../src/components/demo-lifecycle';
import {monitorNoteInput} from '../src/components/note-input-monitor';

const audio = vi.hoisted(() => ({players: [] as Array<{
  addVoice: ReturnType<typeof vi.fn>;
  preload: ReturnType<typeof vi.fn<() => Promise<void>>>;
  noteOn: ReturnType<typeof vi.fn>;
  noteOff: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}>}));

vi.mock('@webmusic/score/play/headless', () => ({
  InteractivePlayer: class {
    addVoice = vi.fn();
    preload = vi.fn<() => Promise<void>>().mockResolvedValue();
    noteOn = vi.fn();
    noteOff = vi.fn();
    dispose = vi.fn();
    constructor() { audio.players.push(this); }
  },
  Sound: {oscillator: vi.fn((options: unknown) => ({options}))},
}));

type Input = Parameters<typeof monitorNoteInput>[0];
type Recorder = HTMLElement & {source?: EventTarget};
const registrations: Array<() => void> = [];
const fileName = resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/ScoreRecorderDemo.astro');
const astroSource = readFileSync(fileName, 'utf8');
const elementModule = {
  defineNoteInputElement: vi.fn(),
  defineScoreRecorderElement: vi.fn(),
};

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return {promise, resolve};
}

/** Run the real demo client with the real lifecycle and monitoring helper. */
function runDemo(): void {
  const source = astroSource.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('ScoreRecorderDemo has no client script');
  const code = ts.transpileModule(source, {
    fileName,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText;
  const modules: Record<string, unknown> = {
    '@webmusic/score/play/element': elementModule,
    './note-input-monitor': {monitorNoteInput},
    './demo-lifecycle': {
      mountDemos: (selector: string, setup: (root: HTMLElement, scope: DemoScope) => void) => {
        registrations.push(mountDemos(selector, setup));
      },
    },
  };
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
    return modules[name];
  }, {});
}

function composition(): HTMLElement {
  const markup = astroSource.match(/<div data-sr-composition>[\s\S]*?<\/div>/)?.[0];
  if (!markup) throw new Error('ScoreRecorderDemo has no composition');
  const holder = document.createElement('div');
  holder.innerHTML = markup.replace('map={DEFAULT_TR808_GRID_MAP}', 'map="z1=35,a1=50"');
  const root = holder.firstElementChild as HTMLElement;
  const input = root.querySelector<Input>('score-note-input')!;
  Object.defineProperty(input, 'layout', {
    configurable: true,
    get: () => input.getAttribute('layout') ?? 'piano',
    set: (value: string) => input.setAttribute('layout', value),
  });
  document.body.append(root);
  return root;
}

function mount(): {root: HTMLElement; input: Input; recorder: Recorder} {
  const root = composition();
  runDemo();
  return {
    root,
    input: root.querySelector<Input>('score-note-input')!,
    recorder: root.querySelector<Recorder>('score-recorder')!,
  };
}

afterEach(async () => {
  for (const stop of registrations.splice(0)) stop();
  document.body.replaceChildren();
  audio.players.splice(0);
  await flush();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Score recorder demo composition', () => {
  it('attaches each recorder to its own sibling input before audio readiness', () => {
    const first = composition();
    const second = composition();
    runDemo();
    expect(elementModule.defineNoteInputElement).toHaveBeenCalledOnce();
    expect(elementModule.defineScoreRecorderElement).toHaveBeenCalledOnce();
    for (const root of [first, second]) {
      const input = root.querySelector<Input>('score-note-input')!;
      expect(root.querySelector<Recorder>('score-recorder')!.source).toBe(input);
      expect(input.onNote).toBeTypeOf('function');
    }
    expect(audio.players).toHaveLength(2);
    for (const player of audio.players) expect(player.preload).not.toHaveBeenCalled();
  });

  it('cleans source and sound routes on navigation and remounts once', async () => {
    const {root, input, recorder} = mount();
    const previous = audio.players[0]!;
    const pending = deferred();
    previous.preload.mockReturnValue(pending.promise);
    input.onNote!(60, 100, true);

    document.dispatchEvent(new Event('astro:before-swap'));
    expect(recorder.source).toBeUndefined();
    expect(input.onNote).toBeUndefined();
    expect(previous.dispose).toHaveBeenCalledOnce();
    pending.resolve();
    await flush();
    expect(previous.noteOn).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('astro:page-load'));
    document.dispatchEvent(new Event('astro:page-load'));
    expect(audio.players).toHaveLength(2);
    expect(recorder.source).toBe(input);
    input.onNote!(64, 90, true);
    await flush();
    expect(audio.players[1]!.noteOn).toHaveBeenCalledWith('piano', 64, 90, 3600);
    expect(previous.noteOn).not.toHaveBeenCalled();

    root.remove();
    await flush();
    expect(recorder.source).toBeUndefined();
    expect(input.onNote).toBeUndefined();
    expect(audio.players[1]!.dispose).toHaveBeenCalledOnce();
  });

  it('drops a released attack while its sound is still preloading', async () => {
    const {input} = mount();
    const player = audio.players[0]!;
    const pending = deferred();
    player.preload.mockReturnValue(pending.promise);
    input.onNote!(60, 100, true);
    input.onNote!(60, 100, false);
    expect(player.noteOff).toHaveBeenCalledWith('piano', 60);
    pending.resolve();
    await flush();
    expect(player.noteOn).not.toHaveBeenCalled();
  });

  it('keeps a newer attack when an older preload resolves for the same pitch', async () => {
    const {input} = mount();
    const player = audio.players[0]!;
    const older = deferred();
    const newer = deferred();
    player.preload.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    input.onNote!(60, 100, true);
    input.onNote!(60, 100, false);
    input.layout = 'grid';
    input.onNote!(60, 70, true);
    older.resolve();
    await flush();
    expect(player.noteOn).not.toHaveBeenCalled();
    newer.resolve();
    await flush();
    expect(player.noteOn).toHaveBeenCalledExactlyOnceWith('grid', 60, 70, 3600);
  });

  it('releases the voice that started a note after its surface layout changes', async () => {
    const {input} = mount();
    const player = audio.players[0]!;
    input.onNote!(60, 100, true);
    await flush();
    expect(player.noteOn).toHaveBeenCalledWith('piano', 60, 100, 3600);
    input.layout = 'chords';
    input.onNote!(60, 100, false);
    expect(player.noteOff).toHaveBeenCalledExactlyOnceWith('piano', 60);
    input.onNote!(67, 90, true);
    await flush();
    expect(player.noteOn).toHaveBeenLastCalledWith('chords', 67, 90, 3600);
  });
});
