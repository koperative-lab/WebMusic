import {TransitionInsertChain, type Effect} from '@webmusic/kernel/effect';

const sampleRate = 48000;
const gain = (value: number): Effect => ({createAudioNodes(context) {
  const node = context.createGain(); node.gain.value = value;
  return {input: node, output: node, params: {gain: node.gain}, dispose: () => node.disconnect()};
}});

function verify(samples: Float32Array, expected: (time: number) => number, skip: readonly number[] = []) {
  let maximumError = 0, checkedSamples = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const time = frame / sampleRate;
    if (skip.some(boundary => Math.abs(time - boundary) < 4 / sampleRate)) continue;
    if (!Number.isFinite(samples[frame])) throw new Error(`Nonfinite transition sample at ${frame}`);
    maximumError = Math.max(maximumError, Math.abs(samples[frame] - expected(time)));
    checkedSamples++;
  }
  if (maximumError > 0.00003) throw new Error(`Native transition sample error ${maximumError} exceeds 0.00003`);
  return {maximumError, checkedSamples, tolerance: 0.00003};
}

async function crossfade() {
  const context = new OfflineAudioContext(1, sampleRate / 2, sampleRate);
  const chain = new TransitionInsertChain(context, {tick: {createWorker: () => null}});
  chain.output.connect(context.destination);
  const source = context.createConstantSource(); source.offset.value = 1; source.connect(chain.input); source.start();
  chain.replace([{id: 'gain', recipe: gain(0.8)}], {fadeSeconds: 0});
  const before = chain.current, input = chain.input, output = chain.output;
  chain.replace([{id: 'gain', recipe: gain(0.2)}], {fadeSeconds: 0.1});
  if (chain.input !== input || chain.output !== output) throw new Error('Effect replacement changed stable external ports');
  if (chain.current.instances[0].params.get('gain') === before.instances[0].params.get('gain')) throw new Error('Fresh effect generation reused old parameter identity');
  const retireAt = chain.retiring[0].retireAt;
  try {
    const buffer = await context.startRendering();
    const samples = verify(buffer.getChannelData(0), time => time < 0.1 ? 0.8 - 6 * time : 0.2);
    chain.collect();
    if (!before.disposed || chain.retiring.length) throw new Error('Expired native effect generation was not released');
    return {retireAt, stablePorts: true, freshParameterIdentity: true, samples};
  } finally { source.disconnect(); chain.dispose(); }
}

async function finiteDelayTail() {
  const context = new OfflineAudioContext(1, sampleRate / 2, sampleRate);
  const chain = new TransitionInsertChain(context, {tick: {createWorker: () => null}});
  const source = context.createConstantSource(); source.offset.value = 1; source.connect(chain.input); source.start();
  chain.output.connect(context.destination);
  const delaySeconds = 0.15;
  const delay: Effect = {createAudioNodes(audio) {
    const node = audio.createDelay(1); node.delayTime.value = delaySeconds;
    return {input: node, output: node, dispose: () => node.disconnect()};
  }};
  chain.replace([{id: 'delay', recipe: delay}], {fadeSeconds: 0});
  const before = chain.current;
  const paused = context.suspend(0.1);
  const rendering = context.startRendering();
  await paused;
  const changedAt = context.currentTime;
  chain.replace([{id: 'mute', recipe: gain(0)}], {fadeSeconds: 0.05, tailSeconds: 0.2});
  const retireAt = chain.retiring[0].retireAt;
  await context.resume();
  try {
    const buffer = await rendering;
    const inputAt = (time: number) => time < 0 ? 0 : time <= changedAt ? 1 : Math.max(0, 1 - (time - changedAt) / 0.05);
    const outputAt = (time: number) => time <= changedAt + 0.05 ? 1 : Math.max(0, 1 - (time - changedAt - 0.05) / 0.2);
    const samples = verify(buffer.getChannelData(0), time => inputAt(time - delaySeconds) * outputAt(time), [delaySeconds]);
    const tailFrame = Math.round((changedAt + 0.1) * sampleRate);
    if (buffer.getChannelData(0)[tailFrame] <= 0.5) throw new Error('Delayed output was cut when outgoing excitation stopped');
    chain.collect();
    if (!before.disposed || chain.retiring.length) throw new Error('Delay tail retained resources beyond its deadline');
    return {changedAt, delaySeconds, retireAt, tailSampleAfterInputFade: buffer.getChannelData(0)[tailFrame], samples};
  } finally { source.disconnect(); chain.dispose(); }
}

export async function runEffectTiming(): Promise<Array<{name: string; passed: boolean; evidence?: unknown; error?: string}>> {
  const tests = [];
  for (const [name, execute] of [['Native effect generation crossfade preserves ports and releases outgoing handles', crossfade], ['Native delay tail drains after excitation fade and expires at its audio deadline', finiteDelayTail]] as const) {
    try { tests.push({name, passed: true, evidence: await execute()}); }
    catch (error) { tests.push({name, passed: false, error: error instanceof Error ? error.stack : String(error)}); }
  }
  return tests;
}
