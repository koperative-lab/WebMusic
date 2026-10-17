import {SessionTransport, SessionLFO, attachSessionAutomation} from '@webmusic/kernel/session';
import {ParamHandle} from '@webmusic/kernel/module';

type Result = {name: string; passed: boolean; evidence?: unknown; error?: string};
const sampleRate = 48000;
const duration = 1.2;
const tolerance = 0.00003;

function context() { return new OfflineAudioContext(1, sampleRate * duration, sampleRate); }
function session(audio: OfflineAudioContext) {
  return new SessionTransport(() => audio.currentTime, {leadInSeconds: 0.05, driftCheckIntervalMs: 0, tick: {createWorker: () => null}});
}
function check(samples: Float32Array, expected: (time: number) => number, windows: readonly [number, number][]) {
  let maxError = 0, count = 0;
  for (const [from, to] of windows) {
    for (let index = Math.ceil(from * sampleRate); index < Math.floor(to * sampleRate); index++) {
      maxError = Math.max(maxError, Math.abs(samples[index] - expected(index / sampleRate)));
      count++;
    }
  }
  if (maxError > tolerance) throw new Error(`Native control trajectory error ${maxError} exceeds ${tolerance} over ${count} samples.`);
  return {maxError, tolerance, checkedSamples: count, windows};
}
function wrap(position: number, end: number) { return position < end ? position : position % end; }

async function automation() {
  const audio = context(), transport = session(audio);
  const source = audio.createConstantSource(), gain = audio.createGain();
  source.offset.value = 1; source.connect(gain); gain.connect(audio.destination); source.start();
  const parameter = new ParamHandle({id: 'gain', unit: 'linear-gain', range: {min: 0, max: 2}, defaultValue: 1, updateTiming: 'scheduled', modulation: 'audio-rate'});
  parameter.bindAudioParam(audio, gain.gain, {lazy: true});
  await transport.setLoop({startSeconds: 0, endSeconds: 1});
  await transport.seek(0.25); await transport.setRate(2);
  const track = attachSessionAutomation(transport.scheduling, audio, parameter,
    [{type: 'set', value: 0, timeSeconds: 0}, {type: 'linear', value: 1, timeSeconds: 1}],
    {lookaheadSeconds: 2, tick: {createWorker: () => null}});
  await transport.play();
  const result = await audio.startRendering();
  try {
    return {...check(result.getChannelData(0), time => wrap(0.25 + 2 * (time - 0.05), 1),
      [[0.06, 0.42], [0.43, 0.92], [0.93, 1.18]]), authorityEpoch: transport.scheduling.epoch,
      scheduledEvents: parameter.snapshot.automation?.length, effectiveReadback: parameter.snapshot.effectiveReadback.status};
  } finally { track.release(); transport.dispose(); parameter.dispose(); source.disconnect(); gain.disconnect(); }
}

async function phase(loop: 'repeat' | 'once') {
  const audio = context(), transport = session(audio);
  await transport.setLoop({startSeconds: 0, endSeconds: 0.75});
  await transport.seek(0.2); await transport.setRate(2);
  const lfo = new SessionLFO(audio, transport.scheduling, {frequency: 2, phase: 0.125, loop, lookaheadSeconds: 2, tick: {createWorker: () => null}});
  lfo.signal.output.connect(audio.destination);
  await transport.play();
  const result = await audio.startRendering();
  try {
    return {...check(result.getChannelData(0), time => {
      const position = 0.2 + 2 * (time - 0.05);
      return Math.sin(2 * Math.PI * ((loop === 'repeat' ? wrap(position, 0.75) : position) * 2 + 0.125));
    }, [[0.06, 0.32], [0.33, 0.695], [0.705, 1.07], [1.08, 1.18]]), loop, sharedRate: transport.scheduling.snapshot.rate};
  } finally { lfo.dispose(); transport.dispose(); }
}

async function seekAndSuspend() {
  const audio = context(), transport = session(audio);
  const lfo = new SessionLFO(audio, transport.scheduling, {frequency: 1, phase: 0, lookaheadSeconds: 2, tick: {createWorker: () => null}});
  lfo.signal.output.connect(audio.destination);
  await transport.play();
  const suspended = audio.suspend(0.352);
  const rendering = audio.startRendering();
  await suspended;
  const referenceTime = audio.currentTime, frozenPosition = transport.position;
  await new Promise(resolve => setTimeout(resolve, 70));
  if (audio.currentTime !== referenceTime || transport.position !== frozenPosition) throw new Error('Wall time advanced a suspended Session.');
  await transport.seek(0.6);
  const origin = transport.scheduling.snapshot.originTime;
  await audio.resume();
  const result = await rendering;
  try {
    const samples = result.getChannelData(0);
    return {referenceTime, frozenPosition, seekOrigin: origin,
      old: check(samples, time => Math.sin(2 * Math.PI * (time - 0.05)), [[0.06, referenceTime - 0.005]]),
      cancelled: check(samples, () => 0, [[referenceTime + 0.005, origin - 0.005]]),
      next: check(samples, time => Math.sin(2 * Math.PI * (0.6 + time - origin)), [[origin + 0.005, 1.18]])};
  } finally { lfo.dispose(); transport.dispose(); }
}

export async function runControlTiming(): Promise<Result[]> {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['Session relative native automation across loop passes at 2x', automation],
    ['Session LFO wrapped phase follows shared rate and loop boundaries', () => phase('repeat')],
    ['Session LFO continuous phase crosses loops without reset', () => phase('once')],
    ['Session LFO seek cancels future sources and suspension freezes reference time', seekAndSuspend],
  ];
  const results: Result[] = [];
  for (const [name, run] of cases) {
    try { results.push({name, passed: true, evidence: await run()}); }
    catch (error) { results.push({name, passed: false, error: error instanceof Error ? error.stack : String(error)}); }
  }
  return results;
}
