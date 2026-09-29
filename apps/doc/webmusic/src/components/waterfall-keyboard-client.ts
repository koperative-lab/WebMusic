import type {ScorePlayerElement} from '@webmusic/score/play/element';
import type {DemoScope} from './demo-lifecycle';
import {arabesqueExcerpt, loadArabesqueScore} from './headless/arabesque-score';
import {mountQuickStartStatus} from './quick-start-player-client';

/** Both independent views use one pitch scale and one borrowed player. */
export function mountWaterfallKeyboardDemo(root: HTMLElement, scope: DemoScope): void {
  const player = root.querySelector<ScorePlayerElement>('score-player')!;
  const view = root.querySelector<HTMLElement>('score-view')!;
  const keyboard = root.querySelector<HTMLElement>('score-pitch-view')!;
  const track = root.querySelector<HTMLElement>('[data-aligned-track]')!;
  const width = root.querySelector<HTMLSelectElement>('[data-aligned-width]')!;
  const timeScale = root.querySelector<HTMLSelectElement>('[data-aligned-time-scale]')!;
  const height = root.querySelector<HTMLSelectElement>('[data-aligned-key-height]')!;
  const status = root.querySelector<HTMLElement>('[data-aligned-status]')!;
  const updateWidth = (): void => {
    const [white, black] = width.value.split('/').map(Number);
    if (!(white > 0) || !(black > 0)) return;
    view.setAttribute('white-note-width', String(white));
    view.setAttribute('black-note-width', String(black));
    keyboard.setAttribute('white-key-width', String(white));
    keyboard.setAttribute('black-key-width', String(black));
    // C3–B5 contains twenty-one natural notes. The shared track scrolls once.
    track.style.width = `${21 * white}px`;
  };
  const updateHeight = (): void => {
    const white = Number(height.value);
    keyboard.setAttribute('white-key-height', String(white));
    keyboard.setAttribute('black-key-height', String(Math.round(white * .625)));
  };
  scope.listen(width, 'change', updateWidth);
  scope.listen(height, 'change', updateHeight);
  scope.listen(timeScale, 'change', () => view.setAttribute('pixels-per-second', timeScale.value));
  updateWidth();
  updateHeight();
  scope.add(() => { player.score = undefined; });
  scope.add(mountQuickStartStatus(player, status));
  scope.run(loadArabesqueScore().then((score) => {
    if (scope.active) player.score = arabesqueExcerpt(score, 16);
  }), () => { status.textContent = 'Could not load the Arabesque score.'; });
}
