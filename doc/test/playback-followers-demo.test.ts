// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {loadScore} from '@webmusic/score/io';
import {ScorePlayer} from '@webmusic/score/play/headless';
import type {AnalysisFollower} from '@webmusic/score/analyze/headless';
import type {PitchView, ScoreMapView} from '@webmusic/score/view/headless';
import type {HeadlessDemoInstance} from '../src/lib/headless-playground-client';
import {createPlaybackFollowerDemo} from '../src/components/headless/playback-followers-client';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../public/midi/Arabesque No.1.mid');
const source = (await loadScore(readFileSync(file), {format: 'midi'})).withMetadata({title: 'Arabesque No. 1'});
const demos: HeadlessDemoInstance[] = [];
afterEach(() => {
  for (const demo of demos.splice(0)) demo.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(kind: 'analysis-follower' | 'score-map-view' | 'pitch-view', options: Record<string, unknown> = {}) {
  const stage = document.createElement('div');
  stage.innerHTML = `<button data-follow-play>Play</button><button data-follow-stop>Stop</button>
    <button data-follow-owner-seek>Seek</button><button data-follow-complete hidden>Complete</button>
    <output data-follow-owner></output><p data-follow-input></p><output data-follow-summary></output>
    <div data-follow-data></div><p data-follow-status></p>`;
  document.body.append(stage);
  const demo = createPlaybackFollowerDemo(kind, source)(options, stage) as HeadlessDemoInstance;
  demos.push(demo);
  return {demo, stage};
}

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

describe('real Analyze/View Headless demonstrations', () => {
  it('follows the demo player by default and reports a seek outcome from the real follower', async () => {
    const {demo, stage} = setup('analysis-follower');
    const follower = demo.object as unknown as AnalysisFollower;
    expect(follower.state.score?.metadata.title).toBe('Arabesque No. 1');
    expect(follower.state.result?.chords.length).toBeGreaterThan(0);
    expect(stage.querySelector('[data-follow-input]')?.textContent).toBe('Following the player');
    stage.querySelector<HTMLButtonElement>('[data-follow-owner-seek]')!.click();
    await flush();
    expect(follower.state.nominalSeconds).toBeCloseTo(1);
    expect(await follower.seekQuarters(4)).toMatchObject({status: 'committed'});
  });

  it('exercises real latest-wins map commands and releases deferred work on cleanup', async () => {
    const {demo, stage} = setup('score-map-view', {score: 'sample', playback: 'none', seekNominal: 'deferred'});
    const map = demo.object as unknown as ScoreMapView;
    const older = map.seekQuarters(2);
    const newer = map.seekQuarters(6);
    expect(map.state.pending).toBe(true);
    stage.querySelector<HTMLButtonElement>('[data-follow-complete]')!.click();
    expect(await older).toMatchObject({status: 'superseded'});
    expect(await newer).toMatchObject({status: 'committed', quarters: 6});
    expect(map.state.quarters).toBeCloseTo(6);
    map.configure({maxCells: 1});
    expect(map.state.map?.cells).toHaveLength(1);
    const pending = map.seekQuarters(3);
    demo.dispose();
    expect(await pending).toMatchObject({status: 'superseded'});
  });

  it('counts held pitches, follows the demo player and replaces manual input from its snapshot', () => {
    const {demo, stage} = setup('pitch-view');
    const pitch = demo.object as unknown as PitchView;
    const changes = vi.fn();
    const off = demo.on!('subscribe', changes);
    expect(changes).not.toHaveBeenCalled();
    pitch.noteOn(60);
    pitch.noteOn(60);
    pitch.noteOff(60);
    expect(pitch.state.activeMidis).toEqual([60]);
    expect(stage.querySelector('[data-follow-data]')?.textContent).toContain('C4');
    expect(pitch.state.playback?.readiness).toBe('ready');
    off();
  });

  it('model disposal preserves the borrowed owner, while navigation cleanup releases it once', async () => {
    const dispose = vi.spyOn(ScorePlayer.prototype, 'dispose');
    const {demo, stage} = setup('analysis-follower');
    (demo.object as unknown as AnalysisFollower).dispose();
    expect(dispose).not.toHaveBeenCalled();
    stage.querySelector<HTMLButtonElement>('[data-follow-owner-seek]')!.click();
    await flush();
    expect(stage.querySelector('[data-follow-owner]')?.textContent).toContain('1.00s');
    demo.dispose();
    demo.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    const before = stage.querySelector('[data-follow-owner]')?.textContent;
    stage.querySelector<HTMLButtonElement>('[data-follow-stop]')!.click();
    expect(stage.querySelector('[data-follow-owner]')?.textContent).toBe(before);
  });

  it('releases its owned player and reports invalid construction inputs', () => {
    const dispose = vi.spyOn(ScorePlayer.prototype, 'dispose');
    expect(() => setup('analysis-follower', {analysis: '[]'})).toThrow('JSON object');
    expect(dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-follow-status]')?.textContent).toContain('JSON object');
  });

  it('navigates through actual map cells and preserves the focused cell while position changes', async () => {
    const {demo, stage} = setup('score-map-view', {score: 'sample', playback: 'none'});
    const map = demo.object as unknown as ScoreMapView;
    const button = stage.querySelectorAll<HTMLButtonElement>('[data-follow-quarter]')[4];
    const quarter = Number(button.dataset.followQuarter);
    button.focus();
    button.click();
    await flush();
    expect(map.state.quarters).toBeCloseTo(quarter);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(stage.querySelector('[data-follow-status]')?.textContent).toContain('committed');
  });

  it('ignores delayed command feedback from an old model after a new one takes the stage', async () => {
    const {demo: old, stage} = setup('score-map-view', {score: 'sample', playback: 'none', seekNominal: 'deferred'});
    stage.querySelectorAll<HTMLButtonElement>('[data-follow-quarter]')[4].click();
    old.dispose();
    const next = createPlaybackFollowerDemo('score-map-view', source)({score: 'sample', playback: 'none'}, stage) as HeadlessDemoInstance;
    demos.push(next);
    const before = stage.textContent;
    await flush();
    expect(stage.textContent).toBe(before);
    expect((next.object as unknown as ScoreMapView).state.quarters).toBe(0);
  });

  it('ignores an audio-start rejection that arrives after demo cleanup', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(ScorePlayer.prototype, 'play').mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const {demo, stage} = setup('analysis-follower');
    stage.querySelector<HTMLButtonElement>('[data-follow-play]')!.click();
    demo.dispose();
    const before = stage.textContent;
    reject(new Error('Late audio failure'));
    await flush();
    expect(stage.textContent).toBe(before);
  });
});
