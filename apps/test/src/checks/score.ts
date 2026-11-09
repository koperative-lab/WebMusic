import {Sound} from '@webmusic/score/play/headless';
import {defineScorePlayerElement, type ScorePlayerElement} from '@webmusic/score/play/element';
import {definePitchViewElement, defineScoreViewElement} from '@webmusic/score/view/element';
import type {Score} from '@webmusic/score';
import type {MountContext} from '../model';
import {
  addChoice, addReadout, arabesqueExcerpt, every, loadArabesqueScore, reportErrors, setMarkup, stopPlayers,
} from './shared';

function mountPlayerWithViews(context: MountContext): ScorePlayerElement {
  defineScorePlayerElement();
  defineScoreViewElement();
  definePitchViewElement();
  setMarkup(context.canvas, `
    <score-player id="mt-score" time-control="full" aria-label="Arabesque No. 1 score player"></score-player>
    <score-view input="#mt-score" type="staff" aria-label="Arabesque No. 1 notation"></score-view>
    <score-pitch-view input="#mt-score" type="keyboard" low="48" high="84" fit-to-width="true" white-key-height="96" black-key-height="60" aria-label="Sounding piano keys, C3 to C6"></score-pitch-view>`);
  return context.canvas.querySelector<ScorePlayerElement>('#mt-score')!;
}

/** D1–D3: the Quick Start composition — one player, a staff and a keyboard following it. */
export async function mountScoreCompanions(context: MountContext): Promise<() => void> {
  const player = mountPlayerWithViews(context);
  const stopErrors = reportErrors(context);
  player.score = await loadArabesqueScore('mxl');
  return () => { stopErrors(); stopPlayers(context.canvas); };
}

type SoundId = 'triangle' | 'sine' | 'square';
type ScoreId = 'whole' | 'opening';

/** D4: `.sound` and `.score` assigned to a mounted, playing player. */
export async function mountInPlaceReplacement(context: MountContext): Promise<() => void> {
  const player = mountPlayerWithViews(context);
  const stopErrors = reportErrors(context);
  const whole = await loadArabesqueScore('mxl');
  const scores: Record<ScoreId, Score> = {whole, opening: arabesqueExcerpt(whole, 16)};
  const sound = (type: SoundId) => Sound.oscillator({type, gain: 0.25});
  player.sound = sound('triangle');
  player.score = scores.whole;
  addChoice<SoundId>(context, {zh: '音色', en: 'Sound'}, [
    {id: 'triangle', label: {zh: '三角波', en: 'Triangle'}},
    {id: 'sine', label: {zh: '正弦波', en: 'Sine'}},
    {id: 'square', label: {zh: '方波', en: 'Square'}},
  ], 'triangle', (id) => { player.sound = sound(id); });
  addChoice<ScoreId>(context, {zh: '乐谱', en: 'Score'}, [
    {id: 'whole', label: {zh: '全曲', en: 'Whole piece'}},
    {id: 'opening', label: {zh: '开头 16 拍', en: 'Opening 16 beats'}},
  ], 'whole', (id) => { player.score = scores[id]; });
  const state = addReadout(context, {zh: '位置 / 时长', en: 'Position / duration'});
  const timed = player as unknown as {currentTime?: number; duration?: number};
  every(context.signal, 200, () => {
    const position = timed.currentTime;
    const duration = timed.duration;
    state(`${typeof position === 'number' ? position.toFixed(1) : '—'} s / ${typeof duration === 'number' ? duration.toFixed(1) : '—'} s`);
  });
  return () => { stopErrors(); stopPlayers(context.canvas); };
}
