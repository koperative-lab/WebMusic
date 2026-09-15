// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScorePlayer} from '@webmusic/score/play/headless';
import type {AnalysisFollower} from '@webmusic/score/analyze/headless';
import type {PitchView, ScoreMapView} from '@webmusic/score/view/headless';
import type {HeadlessDemoInstance} from '../src/lib/headless-playground-client';
import {createPlaybackFollowerDemo} from '../src/components/headless/playback-followers-client';

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
  const demo = createPlaybackFollowerDemo(kind)(options, stage) as HeadlessDemoInstance;
  demos.push(demo);
  return {demo, stage, invoke: (name: string, ...args: unknown[]) => demo.invoke!(name, args)};
}

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

describe('real Analyze/View Headless demonstrations', () => {
  it('hydrates analysis from its real player, adapts score selection and reports read-only seek failure', async () => {
    const {demo, stage, invoke} = setup('analysis-follower');
    const follower = demo.object as unknown as AnalysisFollower;
    expect(follower.state.score?.metadata.title).toBe('C major study');
    expect(follower.state.result?.chords.length).toBeGreaterThan(0);
    stage.querySelector<HTMLButtonElement>('[data-follow-owner-seek]')!.click();
    await flush();
    expect(follower.state.nominalSeconds).toBeCloseTo(1);
    invoke('setScore', 'alternate');
    expect(follower.state.readiness).toBe('mismatched');
    invoke('setScore', 'borrowed');
    invoke('setPlayback', 'read-only');
    const result = await invoke('seekQuarters', 4);
    expect(result).toMatchObject({status: 'failed'});
    expect(stage.querySelector('[data-follow-status]')?.textContent).toContain('failed');
    expect(demo.construction).toContain('playback: player.playback');
    expect(demo.construction).not.toContain('"player"');
  });

  it('exercises real latest-wins map commands and releases deferred work on cleanup', async () => {
    const {demo, stage, invoke} = setup('score-map-view', {score: 'sample', playback: 'none', seekNominal: 'deferred'});
    const map = demo.object as unknown as ScoreMapView;
    const older = invoke('seekQuarters', 2) as Promise<unknown>;
    const newer = invoke('seekQuarters', 6) as Promise<unknown>;
    expect(map.state.pending).toBe(true);
    stage.querySelector<HTMLButtonElement>('[data-follow-complete]')!.click();
    expect(await older).toMatchObject({status: 'superseded'});
    expect(await newer).toMatchObject({status: 'committed', quarters: 6});
    expect(map.state.quarters).toBeCloseTo(6);
    invoke('configure', '{"maxCells":1}');
    expect(map.state.map?.cells).toHaveLength(1);
    expect(() => invoke('configure', '[]')).toThrow('JSON object');
    const pending = invoke('seekQuarters', 3) as Promise<unknown>;
    demo.dispose();
    expect(await pending).toMatchObject({status: 'superseded'});
  });

  it('uses counted pitch state and real projections, then replaces manual input from a player snapshot', () => {
    const {demo, stage, invoke} = setup('pitch-view');
    const pitch = demo.object as unknown as PitchView;
    const changes = vi.fn();
    const off = demo.on!('subscribe', changes);
    expect(changes).not.toHaveBeenCalled();
    invoke('noteOn', 60);
    invoke('noteOn', 60);
    invoke('noteOff', 60);
    expect(pitch.state.activeMidis).toEqual([60]);
    expect(stage.querySelector('[data-follow-data]')?.textContent).toContain('C4');
    invoke('updatePlayback');
    expect(pitch.state.activeMidis).toEqual([]);
    expect(pitch.state.playback?.readiness).toBe('ready');
    off();
  });

  it('model disposal preserves the borrowed owner, while Reset/navigation cleanup releases it once', async () => {
    const dispose = vi.spyOn(ScorePlayer.prototype, 'dispose');
    const {demo, stage, invoke} = setup('analysis-follower');
    invoke('dispose');
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
    const button = stage.querySelector<HTMLButtonElement>('[data-follow-quarter="4"]')!;
    button.focus();
    button.click();
    await flush();
    expect(map.state.quarters).toBe(4);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(stage.querySelector('[data-follow-status]')?.textContent).toContain('committed');
  });

  it('ignores delayed command feedback from an old model after Reset recreates the stage', async () => {
    const {demo: old, stage} = setup('score-map-view', {score: 'sample', playback: 'none', seekNominal: 'deferred'});
    stage.querySelector<HTMLButtonElement>('[data-follow-quarter="4"]')!.click();
    old.dispose();
    const next = createPlaybackFollowerDemo('score-map-view')({score: 'sample', playback: 'none'}, stage) as HeadlessDemoInstance;
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
