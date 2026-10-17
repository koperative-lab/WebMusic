import {SessionTransport} from '@webmusic/kernel/session';
import {ScoreBuilder, PartId, VoiceId, Pitch, Rational, Duration} from '@webmusic/score';
import {ScorePlayer, Sound} from '@webmusic/score/play/headless';
import {createAudioClip} from '@webmusic/audio';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';
import {runControlTiming} from './timing-control';
import {runEffectTiming} from './timing-effects';

const sampleRate = 48000;
const assert = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message); };
const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
interface Gate {start: number; end: number}

async function fixture(options: {clipDuration?: number; offset?: number; scale?: number; gates?: Gate[]; loopEnd?: number; duration?: number} = {}) {
  const gates = options.gates ?? [{start: 0.1, end: 0.2}, {start: 0.35, end: 0.5}];
  const clipDuration = options.clipDuration ?? 1;
  const duration = options.duration ?? 1.1;
  const offset = options.offset ?? 0.05;
  const scale = options.scale ?? 1;
  const loopEnd = options.loopEnd ?? 0.6;
  const context = new OfflineAudioContext(4, Math.round(duration * sampleRate), sampleRate);
  const render = context.startRendering.bind(context);
  // OfflineAudioContext starts suspended. Expose readiness to the public runtime
  // before rendering; the context identity, native currentTime and DSP stay real.
  // This fixture verifies scheduled graph samples, not browser autoplay policy.
  Object.defineProperty(context, 'state', {configurable: true, get: () => 'running'});
  // Score's live-host guard deliberately rejects the offline-only marker. The
  // harness retains native rendering separately while supplying a live-shaped
  // host object; this does not make OfflineAudioContext a supported Score host.
  Object.defineProperty(context, 'startRendering', {configurable: true, value: undefined});
  const merger = context.createChannelMerger(4);
  merger.connect(context.destination);
  const audioDestination = context.createChannelSplitter(2);
  const scoreDestination = context.createChannelSplitter(2);
  audioDestination.connect(merger, 0, 0); audioDestination.connect(merger, 1, 1);
  scoreDestination.connect(merger, 0, 2); scoreDestination.connect(merger, 1, 3);

  const samples = new Float32Array(Math.round(clipDuration * sampleRate));
  for (const gate of gates) samples.fill(1, Math.round(gate.start * sampleRate), Math.min(samples.length, Math.round(gate.end * sampleRate)));
  const clip = createAudioClip({sampleRate, channelData: [samples]});
  const audio = new AudioClipPlayer(clip, {audioContext: context as unknown as AudioContext, destination: audioDestination, engine: 'buffer'});
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('test'), name: 'Test'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  for (const gate of gates) builder.addNote(part, {
    id: builder.newNoteId(), voice: VoiceId('voice'), pitch: Pitch.fromMidi(60),
    onsetQuarters: Rational.ZERO, duration: Duration.quarter(),
    performed: {onsetSec: gate.start, durationSec: gate.end - gate.start, velocity: 127},
  });
  const noteSample = context.createBuffer(1, sampleRate * 2, sampleRate);
  noteSample.getChannelData(0).fill(1);
  const sound = Sound.samples({60: noteSample}, {attackSeconds: 0, decaySeconds: 0, sustainLevel: 1, releaseSeconds: 0, gain: 1});
  let scoreTick: (() => void) | undefined;
  const score = new ScorePlayer(builder.build(), {audioContext: context as unknown as AudioContext,
    destination: scoreDestination, synth: sound, reverb: false, lookaheadSeconds: 2,
    createTickSource: () => ({get running() { return scoreTick !== undefined; }, workerBacked: false,
      start(callback) { scoreTick = callback; }, stop() { scoreTick = undefined; }, dispose() { scoreTick = undefined; }})});
  const session = new SessionTransport(() => context.currentTime, {leadInSeconds: 0.1, driftCheckIntervalMs: 0});
  const mapping = {offsetSeconds: offset, positionScale: scale};
  session.register({play: () => audio.play(), pause: () => audio.pause(), stop: () => audio.stop(), seek: value => audio.seek(value), setRate: rate => audio.setRate(rate),
    get position() { return audio.seconds; }, get running() { return audio.playing; }}, {
    identity: audio, axis: 'clip-seconds', ...mapping, durationSeconds: () => clip.duration, endPolicy: 'position',
    prepare: () => audio.preload(), activate: () => audio.activateScheduling(), attachScheduling: binding => audio.attachScheduling(binding),
  });
  session.register({play: () => score.play(), pause: () => score.pause(), stop: () => score.stop(), seek: value => score.seek(value), setRate: rate => score.setRate(rate),
    get position() { return score.nominalSeconds; }, get running() { return score.isPlaying(); }}, {
    identity: score, axis: 'score-seconds', ...mapping, durationSeconds: () => score.durationSeconds * score.rate, endPolicy: 'position',
    prepare: () => score.preload(), attachScheduling: binding => score.attachScheduling(binding),
  });
  await session.setLoop({startSeconds: 0, endSeconds: loopEnd});
  await session.setRate(1.5);
  await session.play();
  assert(audio.clock?.state.originTime === score.clock.state.originTime, 'Mixed players did not borrow the same origin');
  assert(audio.clock?.rate === score.clock.rate, 'Mixed player mapped rates differ');
  const expected = (time: number, origin = session.clock.state) => {
    if (origin.paused || time < origin.originTime) return 0;
    const raw = origin.originPosition + (time - origin.originTime) * origin.rate;
    const wrapped = raw < loopEnd ? raw : raw % loopEnd;
    const local = offset + wrapped * scale;
    return gates.some(gate => local >= gate.start && local < gate.end) ? Math.SQRT1_2 : 0;
  };
  return {context, render, session, score, audio, expected, tick: () => scoreTick?.(),
    dispose() { session.dispose(); audio.dispose(); score.dispose(); sound.dispose(); merger.disconnect(); delete (context as unknown as {state?: string}).state; delete (context as unknown as {startRendering?: unknown}).startRendering; }};
}

function edges(samples: Float32Array) {
  const found: number[] = [];
  for (let i = 1; i < samples.length; ++i) if ((samples[i] > 0.35) !== (samples[i - 1] > 0.35)) found.push(i);
  return found;
}

function verify(buffer: AudioBuffer, expected: (time: number) => number, silence = false) {
  const audio = buffer.getChannelData(0), score = buffer.getChannelData(2);
  let maximumError = 0, maximumDifference = 0, checkedFrames = 0, skippedBoundaryFrames = 0, audibleFrames = 0;
  for (let frame = 0; frame < buffer.length; frame++) {
    const time = frame / sampleRate;
    const value = expected(time);
    assert(Number.isFinite(audio[frame]) && Number.isFinite(score[frame]), `Nonfinite native sample at ${frame}`);
    // Browser buffer interpolation and event rounding can straddle a gate edge.
    // Keep a four-frame edge exclusion and separately assert every edge's frame.
    if (expected(Math.max(0, time - 4 / sampleRate)) !== value || expected(time + 4 / sampleRate) !== value) { skippedBoundaryFrames++; continue; }
    maximumError = Math.max(maximumError, Math.abs(audio[frame] - value), Math.abs(score[frame] - value));
    maximumDifference = Math.max(maximumDifference, Math.abs(audio[frame] - score[frame]));
    if (value > 0) audibleFrames++;
    checkedFrames++;
  }
  assert(maximumError < 2e-6, `Native signal differs from independently mapped gates by ${maximumError}`);
  assert(maximumDifference < 2e-6, `Score/Audio native sample difference ${maximumDifference}`);
  assert(silence || audibleFrames > 1000, 'Expected audible spans were not exercised');
  const audioEdges = edges(audio), scoreEdges = edges(score);
  assert(audioEdges.length === scoreEdges.length, `Native edge count ${audioEdges.length} differs from Score ${scoreEdges.length}`);
  const maximumEdgeDistanceFrames = audioEdges.reduce((max, frame, index) => Math.max(max, Math.abs(frame - scoreEdges[index])), 0);
  assert(maximumEdgeDistanceFrames <= 2, `Native onset/release alignment differs by ${maximumEdgeDistanceFrames} frames`);
  return {checkedFrames, skippedBoundaryFrames, audibleFrames, maximumError, maximumDifference, audioEdges, scoreEdges, maximumEdgeDistanceFrames, sampleTolerance: 2e-6, edgeToleranceFrames: 2};
}

async function nativeLoop() {
  const f = await fixture();
  const state = f.session.clock.state;
  try {
    assert(f.audio.schedulingMode === 'session-native', 'Fitting loop must select continuous native mode');
    const buffer = await f.render();
    return {mode: f.audio.schedulingMode, origin: state, offset: 0.05, samples: verify(buffer, time => f.expected(time, state))};
  } finally { f.dispose(); }
}

async function futureSeek() {
  const f = await fixture();
  try {
    const before = f.session.scheduling.epoch;
    await f.session.seek(0.3);
    const state = f.session.clock.state;
    assert(f.session.scheduling.epoch > before, 'Seek did not invalidate old scheduled voices');
    const buffer = await f.render();
    return {beforeEpoch: before, afterEpoch: f.session.scheduling.epoch, origin: state, samples: verify(buffer, time => f.expected(time, state))};
  } finally { f.dispose(); }
}

async function futurePause() {
  const f = await fixture();
  try {
    await f.session.pause();
    const buffer = await f.render();
    return {paused: f.session.clock.paused, samples: verify(buffer, () => 0, true)};
  } finally { f.dispose(); }
}

async function soundingRateEdit() {
  const f = await fixture();
  const before = f.session.clock.state;
  try {
    const suspended = f.context.suspend(0.18);
    const rendering = f.render();
    await suspended;
    const changedAt = f.context.currentTime;
    f.tick();
    await f.session.setRate(0.75);
    const after = f.session.clock.state;
    await f.context.resume();
    const buffer = await rendering;
    return {changedAt, before, after,
      samples: verify(buffer, time => f.expected(time, time < changedAt ? before : after))};
  } finally { f.dispose(); }
}

async function widerLoop() {
  const f = await fixture({clipDuration: 0.2, gates: [{start: 0, end: 0.2}], offset: -0.1, loopEnd: 0.6});
  const state = f.session.clock.state;
  const suspensions: Array<{referenceTime: number; before: number; after: number}> = [];
  try {
    assert(f.audio.schedulingMode === 'session-lookahead', 'Wider loop must select bounded lookahead mode');
    const pending = [];
    for (let time = 0.1; time < 1.05; time += 0.1) {
      pending.push(f.context.suspend(time).then(async () => {
        const before = f.session.position;
        f.tick();
        // Give the real worker-backed Audio scheduler a turn while native audio
        // time is frozen, then resume OfflineAudioContext's native renderer.
        await wait(60);
        const after = f.session.position;
        assert(after === before, 'Wall time changed the frozen audio-clock position');
        suspensions.push({referenceTime: f.context.currentTime, before, after});
        await f.context.resume();
      }));
    }
    const buffer = await f.render();
    await Promise.all(pending);
    return {mode: f.audio.schedulingMode, offset: -0.1, clipDuration: 0.2, loopEnd: 0.6,
      origin: state, suspensions, samples: verify(buffer, time => f.expected(time, state))};
  } finally { f.dispose(); }
}

async function run() {
  const cases = {nativeLoop, futureSeek, futurePause, soundingRateEdit, widerLoop};
  const tests = [];
  for (const [name, execute] of Object.entries(cases)) {
    try { tests.push({name, passed: true, evidence: await execute()}); }
    catch (error) { tests.push({name, passed: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}); }
  }
  tests.push(...await runControlTiming());
  tests.push(...await runEffectTiming());
  return {passed: tests.every(test => test.passed), sampleRate, tests,
    limitations: ['Offline native graph rendering verifies scheduling and sample windows, not hardware/device latency or browser autoplay.', 'The harness overrides readiness and hides the offline-only startRendering marker to supply a live-shaped Score host; AudioContext identity, reference time, nodes and rendering remain native. OfflineAudioContext is not a supported live ScorePlayer host.', 'Wider-loop acceptance supplies worker delivery between render blocks; it does not claim immunity to scheduling starvation.']};
}

(window as unknown as {runModularThirdTiming: typeof run}).runModularThirdTiming = run;
