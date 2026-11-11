// Mount a composition in a live canvas with the packages' own Elements. The
// entry list names each public element entry once; a recipe's define name is
// looked up in it, so a renamed export fails here instead of drawing nothing.
import {EDITOR_LOADERS, SPECTROGRAM_OPTIONS, composeApp, type Composition, type EditorStep, type Overrides, type SpectrogramStep} from './compose.ts';

type EntryModule = Record<string, unknown>;

export const ELEMENT_ENTRIES: Readonly<Record<string, () => Promise<EntryModule>>> = {
  '@webmusic/score/play/element': () => import('@webmusic/score/play/element'),
  '@webmusic/score/view/element': () => import('@webmusic/score/view/element'),
  '@webmusic/score/analyze/element': () => import('@webmusic/score/analyze/element'),
  '@webmusic/audio/play/element': () => import('@webmusic/audio/play/element'),
  '@webmusic/audio/view/element': () => import('@webmusic/audio/view/element'),
  '@webmusic/audio/analyze/element': () => import('@webmusic/audio/analyze/element'),
};

/** The Headless entries that load the documents editing views borrow. */
export const EDITOR_ENTRIES: Readonly<Record<string, () => Promise<EntryModule>>> = {
  '@webmusic/score/view/headless': () => import('@webmusic/score/view/headless'),
  '@webmusic/audio/view/headless': () => import('@webmusic/audio/view/headless'),
};

interface Editor { dispose(): void }
type EditorHost = Element & {editor?: Editor};

/** Load one editor and lend it to its targets; returns the cleanup that detaches and disposes it. */
async function lendEditor(root: HTMLElement, step: EditorStep, signal: AbortSignal): Promise<() => void> {
  const {entry, name} = EDITOR_LOADERS[step.kind];
  const load = (await EDITOR_ENTRIES[entry]!())[name];
  if (typeof load !== 'function') throw new Error(`${entry} does not export ${name}()`);
  const editor = await (load as (url: string, options: {signal: AbortSignal}) => Promise<Editor>)(step.url, {signal});
  if (signal.aborted) { editor.dispose(); return () => {}; }
  const hosts = [...root.querySelectorAll<EditorHost>(step.targets.join(', '))];
  for (const host of hosts) host.editor = editor;
  return () => {
    for (const host of hosts) host.editor = undefined;
    editor.dispose();
  };
}

type SpectrogramView = Element & {spectrogram?: unknown};

/** Decode the clip, compute its spectrogram and give it to the view; returns the cleanup. */
async function assignSpectrogram(root: HTMLElement, step: SpectrogramStep, signal: AbortSignal): Promise<() => void> {
  const [{loadClipFromUrl}, {computeSpectrogram}] = await Promise.all([import('@webmusic/audio/play'), import('@webmusic/audio/analyze')]);
  const clip = await loadClipFromUrl(step.url, {signal});
  const channel = clip.channelData(0);
  if (signal.aborted || !channel) return () => {};
  const view = root.querySelector<SpectrogramView>(step.target);
  if (!view) return () => {};
  view.spectrogram = computeSpectrogram(channel, clip.sampleRate, SPECTROGRAM_OPTIONS);
  return () => { view.spectrogram = undefined; };
}

/** Resolve every define function a composition needs, without calling them. */
export async function resolveDefines(imports: Composition['imports']): Promise<(() => void)[]> {
  const defines: (() => void)[] = [];
  for (const [entry, names] of imports) {
    const load = ELEMENT_ENTRIES[entry];
    if (!load) throw new Error(`No element entry ${entry}`);
    const module = await load();
    for (const name of names) {
      const define = module[name];
      if (typeof define !== 'function') throw new Error(`${entry} does not export ${name}()`);
      defines.push(define as () => void);
    }
  }
  return defines;
}

/** The live composition, with Arabesque served from this app's base. */
export function liveComposition(tags: readonly string[], overrides?: Overrides): Composition {
  return composeApp(tags, {mediaBase: import.meta.env.BASE_URL, overrides});
}

/** Stop every player in the canvas before its DOM goes away. */
function stopPlayers(root: HTMLElement): void {
  for (const player of root.querySelectorAll<HTMLElement & {stop?: () => void}>('score-player, audio-player')) {
    try { player.stop?.(); } catch { /* A player that failed to load has nothing to stop. */ }
  }
}

/**
 * Define the composition's tags, write its markup into the canvas and route
 * component errors to `fail`. Returns the cleanup that stops its players.
 */
export async function mountComposition(canvas: HTMLElement, composition: Composition, fail: (error: unknown) => void, signal: AbortSignal): Promise<() => void> {
  const defines = await resolveDefines(composition.imports);
  if (signal.aborted) return () => {};
  for (const define of defines) define();
  canvas.innerHTML = composition.markup;
  const onError = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    fail(detail && typeof detail === 'object' && 'error' in detail ? (detail as {error: unknown}).error : detail);
  };
  canvas.addEventListener('webscore:error', onError);
  canvas.addEventListener('webaudio:error', onError);
  const releases: (() => void)[] = [];
  const cleanup = () => {
    canvas.removeEventListener('webscore:error', onError);
    canvas.removeEventListener('webaudio:error', onError);
    stopPlayers(canvas);
    for (const release of releases.splice(0)) release();
    canvas.replaceChildren();
  };
  try {
    for (const release of await Promise.all([
      ...composition.editors.map((step) => lendEditor(canvas, step, signal)),
      ...composition.spectrograms.map((step) => assignSpectrogram(canvas, step, signal)),
    ])) releases.push(release);
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
