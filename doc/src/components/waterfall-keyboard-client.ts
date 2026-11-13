import type {ScorePlayerElement} from '@webmusic/score/play/element';
import type {DemoScope} from './demo-lifecycle';
import {arabesqueExcerpt, loadArabesqueScore} from './headless/arabesque-score';
import {mountQuickStartStatus} from './quick-start-player-client';

/** Independent note and keyboard views use one pitch scale and one borrowed player. */
export function mountWaterfallKeyboardDemo(root: HTMLElement, scope: DemoScope): void {
  const player = root.querySelector<ScorePlayerElement>('score-player')!;
  const view = root.querySelector<HTMLElement>('score-view')!;
  const keyboards = [...root.querySelectorAll<HTMLElement>('score-pitch-view')];
  const direction = root.querySelector<HTMLSelectElement>('[data-aligned-direction]')!;
  const track = root.querySelector<HTMLElement>('[data-aligned-track]')!;
  const width = root.querySelector<HTMLSelectElement>('[data-aligned-width]')!;
  const timeScale = root.querySelector<HTMLSelectElement>('[data-aligned-time-scale]')!;
  const height = root.querySelector<HTMLSelectElement>('[data-aligned-key-height]')!;
  const status = root.querySelector<HTMLElement>('[data-aligned-status]')!;
  const updateGeometry = (): void => {
    const [white, black] = width.value.split('/').map(Number);
    const depth = Number(height.value);
    if (!(white > 0) || !(black > 0) || !(depth > 0)) return;
    const travel = direction.value;
    const horizontal = travel === 'left' || travel === 'right';
    const pitchSpan = 21 * white; // C3–B5 has twenty-one natural keys.
    const timeSpan = horizontal ? 360 : 180;
    view.setAttribute('direction', travel);
    view.setAttribute('white-note-width', String(white));
    view.setAttribute('black-note-width', String(black));
    view.setAttribute('height', String(horizontal ? pitchSpan : timeSpan));
    view.setAttribute('width', String(horizontal ? timeSpan : pitchSpan));
    for (const [index, keyboard] of keyboards.entries()) {
      keyboard.setAttribute('direction', horizontal ? (index === 0 ? 'right' : 'left') : (index === 0 ? 'down' : 'up'));
      keyboard.setAttribute('white-key-width', String(white));
      keyboard.setAttribute('black-key-width', String(black));
      keyboard.setAttribute('white-key-height', String(depth));
      keyboard.setAttribute('black-key-height', String(Math.round(depth * .625)));
      keyboard.style.height = `${horizontal ? pitchSpan : depth}px`;
    }
    track.style.width = `${horizontal ? timeSpan + 2 * depth : pitchSpan}px`;
    track.style.height = `${horizontal ? pitchSpan : timeSpan + 2 * depth}px`;
    track.style.gridTemplateColumns = horizontal ? `${depth}px ${timeSpan}px ${depth}px` : 'minmax(0, 1fr)';
    track.style.gridTemplateRows = horizontal ? 'minmax(0, 1fr)' : `${depth}px ${timeSpan}px ${depth}px`;
  };
  scope.listen(width, 'change', updateGeometry);
  scope.listen(height, 'change', updateGeometry);
  scope.listen(direction, 'change', updateGeometry);
  scope.listen(timeScale, 'change', () => view.setAttribute('pixels-per-second', timeScale.value));
  updateGeometry();
  scope.add(() => { player.score = undefined; player.loading = false; });
  scope.add(mountQuickStartStatus(player, status));
  player.loading = true;
  scope.run(loadArabesqueScore().then((score) => {
    if (scope.active) player.score = arabesqueExcerpt(score, 16);
  }).finally(() => {
    if (scope.active) player.loading = false;
  }), () => { status.hidden = false; status.textContent = 'Could not load Arabesque No. 1.'; status.dataset.error = ''; });
}
