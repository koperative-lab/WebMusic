import {arabesqueUrl} from '../../../doc/webmusic/src/components/headless/arabesque-score';
import {arabesqueAudioUrl} from '../../../doc/webmusic/src/components/headless/arabesque-audio';
import type {MountContext} from '../model';

export {arabesqueAudioUrl, arabesqueUrl};
export {arabesqueExcerpt, loadArabesqueScore} from '../../../doc/webmusic/src/components/headless/arabesque-score';

/** The streamed format, for native decode and media workflows. */
export const arabesqueMp3Url = (): string => `${import.meta.env.BASE_URL}mp3/Arabesque%20No.1.mp3`;
/** A General MIDI piano bank already shipped beside the Arabesque files. */
export const pianoSoundFontUrl = (): string => `${import.meta.env.BASE_URL}soundfont/YamahaGP.sf2`;

export function setMarkup(canvas: HTMLElement, html: string): void {
  canvas.innerHTML = html;
}

/** Component errors surface as the canvas's one error line. */
export function reportErrors(context: MountContext, root: HTMLElement = context.canvas): () => void {
  const onError = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    context.fail(detail && typeof detail === 'object' && 'error' in detail ? (detail as {error: unknown}).error : detail);
  };
  root.addEventListener('webscore:error', onError);
  root.addEventListener('webaudio:error', onError);
  return () => {
    root.removeEventListener('webscore:error', onError);
    root.removeEventListener('webaudio:error', onError);
  };
}

/** Stop every player in the canvas before its DOM goes away. */
export function stopPlayers(root: HTMLElement): void {
  for (const player of root.querySelectorAll<HTMLElement & {stop?: () => void}>('score-player, audio-player')) {
    try { player.stop?.(); } catch { /* A player that failed to load has nothing to stop. */ }
  }
}

function field(parameters: HTMLElement, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mt-param';
  const caption = document.createElement('span');
  caption.className = 'mt-caption';
  caption.textContent = label;
  row.append(caption);
  parameters.append(row);
  return row;
}

/** One secondary action in Parameters. */
export function addAction(context: MountContext, label: string, run: (button: HTMLButtonElement) => unknown, primary = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'mt-action mt-action--primary' : 'mt-action';
  button.textContent = label;
  button.addEventListener('click', () => {
    button.disabled = true;
    Promise.resolve(run(button)).catch((error: unknown) => context.fail(error)).finally(() => { button.disabled = false; });
  });
  let row = context.parameters.querySelector<HTMLElement>(':scope > .mt-actions');
  if (!row) {
    row = document.createElement('div');
    row.className = 'mt-actions';
    context.parameters.append(row);
  }
  row.append(button);
  return button;
}

/** A hairline grid of square choices; the current one is inverted. */
export function addChoice<T extends string>(
  context: MountContext, label: string, options: readonly {id: T; label: string}[], current: T,
  choose: (id: T) => unknown,
): void {
  const row = field(context.parameters, label);
  const grid = document.createElement('div');
  grid.className = 'mt-choice';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', label);
  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.setAttribute('aria-pressed', String(option.id === current));
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      Promise.resolve(choose(option.id)).catch((error: unknown) => context.fail(error));
    });
    return button;
  });
  grid.append(...buttons);
  row.append(grid);
}

/** A mono value readout in Parameters; returns its setter. */
export function addReadout(context: MountContext, label: string, initial = '—'): (value: string) => void {
  const row = field(context.parameters, label);
  const value = document.createElement('output');
  value.className = 'mt-value';
  value.textContent = initial;
  row.append(value);
  return (next) => { value.textContent = next; };
}

/** Poll a readout while the check is open. */
export function every(signal: AbortSignal, ms: number, tick: () => void): void {
  const id = setInterval(() => { if (!signal.aborted) tick(); }, ms);
  signal.addEventListener('abort', () => clearInterval(id), {once: true});
  tick();
}

interface NoteSurface extends Element { onNote?: (midi: number, velocity: number, on: boolean) => void }
interface MonitoredRecorder extends Element { input(midi: number, velocity: number, on: boolean): void }

/**
 * Feed a note surface into a recorder's monitored input: `routing="manual"` on
 * the surface, and `recorder.input()` both sounds (on the recorder's route) and
 * captures while a take is armed.
 */
export function wireMonitoredInput(surface: Element, recorder: Element): void {
  (surface as NoteSurface).onNote = (midi, velocity, on) => (recorder as MonitoredRecorder).input(midi, velocity, on);
}
