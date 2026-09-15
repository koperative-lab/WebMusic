import {type Score, type ScorePlaybackSource} from '@webmusic/score';
import {followerDemoScore} from './demo-score';
import {renderNoteChips} from './musical-stage';
import {createAnalysisFollower, type AnalysisFollower} from '@webmusic/score/analyze/headless';
import {ScorePlayer} from '@webmusic/score/play/headless';
import {currentStaffMarks} from '@webmusic/score/view';
import {createPitchView, createScoreMapView, type PitchView, type ScoreMapView} from '@webmusic/score/view/headless';
import type {HeadlessDemoFactory, HeadlessDemoInstance} from '../../lib/headless-playground-client';

type Kind = 'analysis-follower' | 'score-map-view' | 'pitch-view';
type Model = AnalysisFollower | ScoreMapView | PitchView;

export {followerDemoScore} from './demo-score';

function record(value: unknown, label: string): Record<string, unknown> {
  const result: unknown = typeof value === 'string' ? JSON.parse(value) : value ?? {};
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError(`${label} must be a JSON object.`);
  return result as Record<string, unknown>;
}

/** Real objects, with only fixture selection and DOM output adapted by the demo. */
export function createPlaybackFollowerDemo(kind: Kind): HeadlessDemoFactory {
  return (options, stage): HeadlessDemoInstance => {
    const score = followerDemoScore();
    const alternateScore = followerDemoScore(true);
    const player = new ScorePlayer(score);
    // Removing the optional command creates a genuine read-only source while
    // retaining the real player's snapshots and subscription ordering.
    const readOnly: ScorePlaybackSource = {
      snapshot: () => player.playback.snapshot(),
      subscribe: (listener) => player.playback.subscribe(listener),
    };
    const sourceFor = (value: unknown): ScorePlaybackSource | undefined =>
      value === 'player' ? player.playback : value === 'read-only' ? readOnly : undefined;
    const scoreFor = (value: unknown): Score | undefined =>
      value === 'sample' ? score : value === 'alternate' ? alternateScore : undefined;
    const playbackMode = String(options.playback ?? (kind === 'pitch-view' ? 'none' : 'player'));
    const explicitMode = String(options.score ?? 'borrowed');
    const callbackMode = String(options.seekNominal ?? 'none');
    const pending: Array<() => void> = [];
    const cleanups: Array<() => void> = [];
    let active = true;
    let modelDisposed = false;
    let analysis: AnalysisFollower | undefined;
    let map: ScoreMapView | undefined;
    let pitch: PitchView | undefined;
    let model: Model;
    let currentMode = playbackMode;
    const status = stage.querySelector<HTMLElement>('[data-follow-status]');
    const summary = stage.querySelector<HTMLElement>('[data-follow-summary]');
    const data = stage.querySelector<HTMLElement>('[data-follow-data]');
    const input = stage.querySelector<HTMLElement>('[data-follow-input]');
    const playButton = stage.querySelector<HTMLButtonElement>('[data-follow-play]');
    const completeButton = stage.querySelector<HTMLButtonElement>('[data-follow-complete]');
    const ownerOutput = stage.querySelector<HTMLElement>('[data-follow-owner]');
    const message = (text: string): void => { if (active && status) status.textContent = text; };
    const fail = (error: unknown): void => message(error instanceof Error ? error.message : String(error));
    const adapter = callbackMode === 'none' ? undefined : (_seconds: number): void | Promise<void> => {
      if (callbackMode === 'reject') return Promise.reject(new Error('Demo command adapter rejected the seek.'));
      if (callbackMode === 'deferred') return new Promise<void>((resolve) => {
        pending.push(resolve);
        message(`${pending.length} pending seek(s). Send another seek, then complete them to inspect supersession.`);
      });
    };
    try {
      if (kind === 'analysis-follower') {
        analysis = createAnalysisFollower({score: scoreFor(explicitMode), playback: sourceFor(playbackMode),
          analysis: record(options.analysis, 'analysis')});
        model = analysis;
      } else if (kind === 'score-map-view') {
        map = createScoreMapView({score: scoreFor(explicitMode), playback: sourceFor(playbackMode),
          part: typeof options.part === 'string' ? options.part : undefined,
          maxCells: options.maxCells as number | undefined, maxMarks: options.maxMarks as number | undefined,
          seekNominal: adapter});
        model = map;
      } else {
        pitch = createPitchView({playback: sourceFor(playbackMode)});
        model = pitch;
      }
    } catch (error) {
      player.dispose();
      fail(error);
      throw error;
    }

    const paint = (): void => {
      if (!active) return;
      if (input) input.textContent = currentMode === 'none' ? 'Standalone input' : currentMode === 'read-only' ? 'Following the player · read-only source' : 'Following the player';
      if (analysis) {
        const state = analysis.state;
        const key = state.result?.key;
        if (summary) summary.textContent = `${key ? `${key.tonic} ${key.mode}` : 'No score analysis'} · ${state.readiness} · q${state.quarters?.toFixed(2) ?? '—'}`;
        if (data) {
          const segments = state.result?.chords ?? [];
          renderNoteChips(data, segments.map((segment) => `${segment.chord || '—'} · q${segment.startQuarters}–${segment.endQuarters}`), 'Load or attach a score to analyze its chords');
          Array.from(data.children).forEach((chip, index) => {
            const segment = segments[index];
            (chip as HTMLElement).dataset.active = String(state.quarters !== null && state.quarters >= segment.startQuarters && state.quarters < segment.endQuarters);
          });
        }
      } else if (map) {
        const state = map.state;
        if (summary) summary.textContent = `${state.readiness} · q${state.quarters.toFixed(2)} of ${state.map?.durationQuarters ?? 0}${state.pending ? ' · seeking' : ''}`;
        if (data) {
          // Preserve focused cells across playback snapshots while refreshing
          // the real density, bounds and current position.
          const cells = state.map?.cells ?? [];
          while (data.children.length > cells.length) data.lastElementChild?.remove();
          cells.forEach((cell, index) => {
            const button = data!.children[index] as HTMLButtonElement | undefined ?? document.createElement('button');
            button.type = 'button';
            button.dataset.followQuarter = String(cell.startQuarters);
            button.style.height = `${44 + cell.density * 48}px`;
            button.textContent = `${cell.firstMeasure === undefined ? 'q' + cell.startQuarters : 'Bar ' + cell.firstMeasure}${cell.lastMeasure !== undefined && cell.lastMeasure !== cell.firstMeasure ? '–' + cell.lastMeasure : ''} · ${cell.count} notes`;
            button.setAttribute('aria-label', `Seek to quarter ${cell.startQuarters}, ${cell.count} notes`);
            button.setAttribute('aria-current', String(state.quarters >= cell.startQuarters && state.quarters < cell.endQuarters));
            if (!button.parentElement) data!.append(button);
          });
        }
      } else if (pitch) {
        const midis = pitch.state.activeMidis;
        if (summary) summary.textContent = `${midis.length} held pitch${midis.length === 1 ? '' : 'es'}`;
        if (data) renderNoteChips(data, currentStaffMarks(midis).map((mark) => `${mark.label} · MIDI ${mark.midi}`), 'Send noteOn in Parameters or attach the player');
      }
    };
    const paintOwner = (): void => {
      if (!active) return;
      const snapshot = player.playback.snapshot();
      if (ownerOutput) ownerOutput.textContent = `${(snapshot.nominalSeconds ?? 0).toFixed(2)}s · ${snapshot.state}`;
      if (playButton) playButton.textContent = snapshot.state === 'playing' ? 'Pause' : 'Play';
    };
    const listen = (selector: string, callback: () => void | Promise<void>): void => {
      const node = stage.querySelector(selector);
      const handler = (): void => {
        if (!active) return;
        try { void Promise.resolve(callback()).catch(fail); } catch (error) { fail(error); }
      };
      node?.addEventListener('click', handler);
      cleanups.push(() => node?.removeEventListener('click', handler));
    };
    cleanups.push(model.subscribe(paint), player.playback.subscribe(paintOwner));
    listen('[data-follow-play]', async () => {
      if (player.isPlaying()) player.pause();
      else await player.play();
      paintOwner();
      message(modelDisposed ? 'The model is disposed; its borrowed player still operates.' : 'Player state changed; the connected model follows its snapshots.');
    });
    listen('[data-follow-stop]', () => { player.stop(); paintOwner(); });
    listen('[data-follow-owner-seek]', async () => { await player.seekNominal(1); paintOwner(); });
    listen('[data-follow-complete]', () => { for (const resolve of pending.splice(0)) resolve(); });
    if (map && data) {
      const navigate = (event: Event): void => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-follow-quarter]');
        if (!active || !button || !data.contains(button)) return;
        void map!.seekQuarters(Number(button.dataset.followQuarter)).then((outcome) => {
          message(`Seek ${outcome.status}${outcome.status === 'committed' ? ` · q${outcome.quarters.toFixed(2)}` : ''}.`);
          paint();
        }, fail);
      };
      data.addEventListener('click', navigate);
      cleanups.push(() => data.removeEventListener('click', navigate));
    }
    if (completeButton) completeButton.hidden = kind !== 'score-map-view' || callbackMode !== 'deferred';
    paint();
    paintOwner();
    message(kind === 'pitch-view' ? 'Use noteOn and noteOff, or attach the player.'
      : kind === 'score-map-view' ? 'Select a measure to navigate.' : 'Play or seek to follow the current chord.');

    const apiName = kind === 'analysis-follower' ? 'createAnalysisFollower' : kind === 'score-map-view' ? 'createScoreMapView' : 'createPitchView';
    const entry = kind === 'analysis-follower' ? 'analyze' : 'view';
    const constructionOptions: string[] = [];
    if (kind !== 'pitch-view' && explicitMode !== 'borrowed') constructionOptions.push(`score: ${explicitMode === 'alternate' ? 'alternateScore' : 'score'}`);
    if (playbackMode !== 'none') constructionOptions.push(`playback: ${playbackMode === 'player' ? 'player.playback' : 'readOnly'}`);
    if (kind === 'analysis-follower' && options.analysis !== undefined) constructionOptions.push(`analysis: ${JSON.stringify(record(options.analysis, 'analysis'))}`);
    if (kind === 'score-map-view') {
      for (const name of ['part', 'maxCells', 'maxMarks']) if (options[name] !== undefined) constructionOptions.push(`${name}: ${JSON.stringify(options[name])}`);
      if (adapter) constructionOptions.push('seekNominal');
    }
    const adapterCode = !adapter ? '' : callbackMode === 'deferred'
      ? 'const pending = [];\nconst seekNominal = (seconds) => new Promise((resolve) => pending.push(resolve));\n// Complete pending commands: pending.splice(0).forEach((resolve) => resolve());\n'
      : callbackMode === 'reject' ? "const seekNominal = (seconds) => Promise.reject(new Error('Seek rejected'));\n"
        : 'const seekNominal = (seconds) => { /* application command completed */ };\n';
    const construction = `import {${apiName}} from '@webmusic/score/${entry}/headless';\nimport {ScorePlayer} from '@webmusic/score/play/headless';\n// score and alternateScore are caller-supplied immutable Scores.\nconst player = new ScorePlayer(score);\n${playbackMode === 'read-only' ? 'const readOnly = {snapshot: () => player.playback.snapshot(), subscribe: (listener) => player.playback.subscribe(listener)};\n' : ''}${adapterCode}const model = ${apiName}({${constructionOptions.join(', ')}});\n// On application teardown:\nmodel.dispose();\nplayer.dispose();`;

    return {
      object: model as unknown as Record<string, unknown>,
      construction,
      on(event, handler) {
        if (event !== 'subscribe') return () => undefined;
        // This is the actual object's subscription, not a fabricated emitter.
        return model.subscribe((state) => handler(state));
      },
      invoke(name, args) {
        try {
          let result: unknown;
          if (name === 'setScore' && (analysis || map)) {
            (analysis ?? map)!.setScore(scoreFor(args[0]));
          } else if (name === 'setPlayback') {
            currentMode = String(args[0]);
            model.setPlayback(sourceFor(args[0]));
          } else if (name === 'configure' && map) {
            map.configure(record(args[0], 'configure'));
          } else if (name === 'updatePlayback' && pitch) {
            result = pitch.updatePlayback(player.playback.snapshot());
          } else {
            const callable = (model as unknown as Record<string, unknown>)[name];
            if (typeof callable !== 'function') throw new Error(`Unknown model command ${name}.`);
            result = callable.apply(model, args);
          }
          if (name === 'dispose') {
            modelDisposed = true;
            message('Model disposed. The demo-owned ScorePlayer remains available until Reset or navigation.');
          } else message(`${name}() ${result instanceof Promise ? 'pending' : 'completed'}.`);
          paint();
          if (result instanceof Promise) return result.then((outcome: unknown) => {
            if (active) {
              const status = outcome && typeof outcome === 'object' && 'status' in outcome ? String(outcome.status) : 'completed';
              message(`${name}() ${status}.`);
              paint();
            }
            return outcome;
          }, (error: unknown) => { fail(error); throw error; });
          return result;
        } catch (error) { fail(error); throw error; }
      },
      dispose() {
        if (!active) return;
        active = false;
        const errors: unknown[] = [];
        for (const cleanup of [...cleanups.splice(0).reverse(), () => model.dispose(), () => player.dispose()]) {
          try { cleanup(); } catch (error) { errors.push(error); }
        }
        for (const resolve of pending.splice(0)) resolve();
        if (errors.length) throw new AggregateError(errors, 'Follower demo cleanup failed');
      },
    };
  };
}

export function registerPlaybackFollowerFactories(): void {
  const factories = window as unknown as Record<string, HeadlessDemoFactory>;
  factories.__wmAnalysisFollowerDemo = createPlaybackFollowerDemo('analysis-follower');
  factories.__wmScoreMapViewDemo = createPlaybackFollowerDemo('score-map-view');
  factories.__wmPitchViewDemo = createPlaybackFollowerDemo('pitch-view');
  window.dispatchEvent(new Event('wm:headless-factory-ready'));
}
