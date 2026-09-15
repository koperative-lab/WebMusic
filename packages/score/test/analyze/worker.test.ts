import {
  Duration,
  NoteId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type MidiNumber,
  type Score,
} from '../../src/core';
import {describe, expect, it, vi} from 'vitest';
import {segmentChords} from '../../src/analyze/core/chords';
import {detectKey} from '../../src/analyze/core/key';
import {findMotifs} from '../../src/analyze/core/motif';
import {romanNumerals} from '../../src/analyze/core/roman';
import {type AnalysisResult} from '../../src/analyze/headless/session';
import {voiceLeading} from '../../src/analyze/core/voice-leading';
// Importing the worker entry in Node must be a no-op (the self-registration
// is guarded for real worker scopes only) — the import itself is the test.
import {
  ANALYSIS_WORKER_PROTOCOL,
  ANALYSIS_WORKER_PROTOCOL_VERSION,
  createAnalysisWorkerState,
  handleAnalyzeRequest,
  type AnalysisWorkerErrorDetails,
  type AnalysisWorkerResponse,
} from '../../src/analyze/worker';
import {
  AnalysisWorkerRemoteError,
  createAnalysisWorker,
  type AnalysisWorkerLike,
} from '../../src/analyze/worker-client';

/** Deterministic mulberry32 PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALE = [0, 2, 4, 5, 7, 9, 11];

/** Same random multi-voice score generator as session.test.ts. */
function buildScore(notesPerVoice: number, voices = 4, parts = 2, seed = 42): Score {
  const rand = rng(seed);
  const builder = new ScoreBuilder();
  const partIds = Array.from({length: parts}, (_, p) => {
    const id = PartId(`part-${p}`);
    builder.addPart({id, name: `Part ${p}`});
    return id;
  });
  const centers = [76, 69, 62, 50];
  const durations: Array<[number, number]> = [[1, 2], [1, 2], [1, 1], [3, 2], [2, 1]];
  for (let v = 0; v < voices; v += 1) {
    let degree = 0;
    let onsetEighths = 0;
    for (let i = 0; i < notesPerVoice; i += 1) {
      const r = rand();
      if (r < 0.55) degree += rand() < 0.5 ? 1 : -1;
      else if (r < 0.8) degree += rand() < 0.5 ? 2 : -2;
      else if (r < 0.9) degree += rand() < 0.5 ? 4 : -4;
      if (degree > 10) degree -= 4;
      if (degree < -10) degree += 4;
      const center = centers[v % centers.length];
      const octave = Math.floor(degree / 7);
      const midi = Math.max(24, Math.min(100, center + octave * 12 + SCALE[((degree % 7) + 7) % 7]));
      const [num, den] = durations[(rand() * durations.length) | 0];
      builder.addNote(partIds[v % parts], {
        id: NoteId(`n-${v}-${i}`),
        pitch: Pitch.fromMidi(midi as MidiNumber),
        onsetQuarters: new Rational(onsetEighths, 2),
        duration: new Duration({base: new Rational(num, den)}),
        voice: VoiceId(`voice-${v}`),
      });
      onsetEighths += (num * 2) / den;
    }
  }
  return builder.build();
}

/** From-scratch analysis with the standalone functions (the ground truth). */
function freshAnalysis(score: Score): AnalysisResult {
  const key = detectKey(score);
  return {
    key,
    chords: segmentChords(score, {}),
    roman: romanNumerals(score, key, {}),
    motifs: findMotifs(score, {}),
    issues: voiceLeading(score),
  };
}

/** Apply one random edit (pitch / move / resize / remove / add) to one part. */
function randomEdit(score: Score, rand: () => number, step: number): Score {
  const ids: string[] = [];
  for (const part of score.parts) for (const note of part.notes) ids.push(note.id);
  const id = NoteId(ids[(rand() * ids.length) | 0]);
  const span = Math.max(1, Math.ceil(score.durationQuarters.toFloat()));
  const roll = rand();
  return score.edit((tx) => {
    if (roll < 0.35) {
      tx.updateNote(id, {pitch: Pitch.fromMidi((36 + ((rand() * 48) | 0)) as MidiNumber)});
    } else if (roll < 0.6) {
      tx.updateNote(id, {onsetQuarters: new Rational((rand() * span * 2) | 0, 2)});
    } else if (roll < 0.75) {
      tx.updateNote(id, {duration: new Duration({base: new Rational(1 + ((rand() * 4) | 0), 2)})});
    } else if (roll < 0.9) {
      tx.removeNote(id);
    } else {
      tx.addNote(score.parts[(rand() * score.parts.length) | 0].id, {
        id: NoteId(`added-${step}`),
        pitch: Pitch.fromMidi((40 + ((rand() * 40) | 0)) as MidiNumber),
        onsetQuarters: new Rational((rand() * span * 2) | 0, 2),
        duration: new Duration({base: new Rational(1, 1)}),
        voice: VoiceId('voice-added'),
      });
    }
  });
}

/** Simulate the postMessage round-trip: structured clone of plain JSON. */
function ship<T>(value: T): T {
  return structuredClone(value);
}

function expectOk(response: AnalysisWorkerResponse): AnalysisResult {
  if (!response.ok) throw new Error(`expected ok response, got error: ${response.error}`);
  return response.result;
}

const INVALID_ANALYSIS_WORKER_OPTIONS: readonly unknown[] = [
  null,
  [],
  1,
  'window=2',
  {windowQuarters: '2'},
  {windowQuarters: Number.NaN},
  {motifLength: 1.5},
  {minOccurrences: 0},
];

function restoreGlobalProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

describe('handleAnalyzeRequest (worker message handler)', () => {
  it('importing the worker module in Node does not crash and exports the handler', () => {
    expect(typeof handleAnalyzeRequest).toBe('function');
    expect(typeof createAnalysisWorkerState).toBe('function');
  });

  it('does not self-register in a non-dedicated WorkerGlobalScope without postMessage', async () => {
    const workerGlobalScopeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WorkerGlobalScope');
    const dedicatedWorkerGlobalScopeDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'DedicatedWorkerGlobalScope',
    );
    const selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
    class FakeWorkerGlobalScope {}
    const addEventListener = vi.fn();
    const serviceOrSharedScope = Object.assign(new FakeWorkerGlobalScope(), {addEventListener});

    Object.defineProperty(globalThis, 'WorkerGlobalScope', {
      configurable: true,
      value: FakeWorkerGlobalScope,
    });
    Reflect.deleteProperty(globalThis, 'DedicatedWorkerGlobalScope');
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: serviceOrSharedScope,
    });
    try {
      vi.resetModules();
      await import('../../src/analyze/worker');
      expect(addEventListener).not.toHaveBeenCalled();
    } finally {
      restoreGlobalProperty('WorkerGlobalScope', workerGlobalScopeDescriptor);
      restoreGlobalProperty('DedicatedWorkerGlobalScope', dedicatedWorkerGlobalScopeDescriptor);
      restoreGlobalProperty('self', selfDescriptor);
      vi.resetModules();
    }
  });

  it('self-registers when the scope has dedicated Worker messaging capabilities', async () => {
    const workerGlobalScopeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WorkerGlobalScope');
    const dedicatedWorkerGlobalScopeDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'DedicatedWorkerGlobalScope',
    );
    const selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
    class FakeWorkerGlobalScope {}
    class FakeDedicatedWorkerGlobalScope extends FakeWorkerGlobalScope {}
    const addEventListener = vi.fn();
    const postMessage = vi.fn();
    const dedicatedScope = Object.assign(new FakeDedicatedWorkerGlobalScope(), {
      addEventListener,
      postMessage,
    });

    Object.defineProperty(globalThis, 'WorkerGlobalScope', {
      configurable: true,
      value: FakeWorkerGlobalScope,
    });
    Object.defineProperty(globalThis, 'DedicatedWorkerGlobalScope', {
      configurable: true,
      value: FakeDedicatedWorkerGlobalScope,
    });
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: dedicatedScope,
    });
    try {
      vi.resetModules();
      await import('../../src/analyze/worker');
      expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    } finally {
      restoreGlobalProperty('WorkerGlobalScope', workerGlobalScopeDescriptor);
      restoreGlobalProperty('DedicatedWorkerGlobalScope', dedicatedWorkerGlobalScopeDescriptor);
      restoreGlobalProperty('self', selfDescriptor);
      vi.resetModules();
    }
  });

  it('analyze returns a full result deep-equal to a from-scratch analysis', () => {
    const score = buildScore(100);
    const state = createAnalysisWorkerState();
    const response = handleAnalyzeRequest(state, {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 1,
      action: 'analyze',
      score: ship(score.toJSON()),
    });
    expect(response.id).toBe(1);
    expect(expectOk(response)).toEqual(freshAnalysis(score));
  });

  it('sequential updates match a from-scratch analysis across 15 random edits', () => {
    let score = buildScore(150); // 4 voices × 150 = 600 notes
    const state = createAnalysisWorkerState();
    expectOk(
      handleAnalyzeRequest(state, {
        protocol: ANALYSIS_WORKER_PROTOCOL,
        protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
        id: 1,
        action: 'analyze',
        score: ship(score.toJSON()),
      }),
    );

    const rand = rng(1234);
    for (let step = 0; step < 15; step += 1) {
      score = randomEdit(score, rand, step);
      const response = handleAnalyzeRequest(state, {
        protocol: ANALYSIS_WORKER_PROTOCOL,
        protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
        id: 2 + step,
        action: 'update',
        score: ship(score.toJSON()),
      });
      // The centerpiece invariant: worker-side incremental === from scratch.
      expect(expectOk(response)).toEqual(freshAnalysis(score));
    }
  });

  it('update without a prior analyze creates a session (full analysis)', () => {
    const score = buildScore(50);
    const state = createAnalysisWorkerState();
    const response = handleAnalyzeRequest(state, {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 7,
      action: 'update',
      score: ship(score.toJSON()),
    });
    expect(expectOk(response)).toEqual(freshAnalysis(score));
  });

  it('analyze honors session options', () => {
    const score = buildScore(80, 4, 2, 7);
    const state = createAnalysisWorkerState();
    const options = {windowQuarters: 1, motifLength: 3, minOccurrences: 3};
    const response = handleAnalyzeRequest(state, {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 1,
      action: 'analyze',
      score: ship(score.toJSON()),
      options,
    });
    const key = detectKey(score);
    expect(expectOk(response)).toEqual({
      key,
      chords: segmentChords(score, {windowQuarters: 1}),
      roman: romanNumerals(score, key, {windowQuarters: 1}),
      motifs: findMotifs(score, {length: 3, minOccurrences: 3}),
      issues: voiceLeading(score),
    });
  });

  it('rejects invalid session options instead of emitting a malformed success result', async () => {
    const score = buildScore(4, 1, 1);
    const response = handleAnalyzeRequest(createAnalysisWorkerState(), {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 2,
      action: 'analyze',
      score: ship(score.toJSON()),
      options: {windowQuarters: Number.NaN},
    });
    expect(response).toMatchObject({
      id: 2,
      ok: false,
      errorDetails: {code: 'invalid-request', operation: 'analyze'},
    });

    const fallback = createAnalysisWorker();
    await expect(fallback.analyze(score, {windowQuarters: Number.NaN})).rejects.toThrow(/finite/);
    fallback.dispose();
  });

  it.each(INVALID_ANALYSIS_WORKER_OPTIONS)('rejects malformed wire options before analysis (%j)', (options) => {
    const response = handleAnalyzeRequest(createAnalysisWorkerState(), {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 3,
      action: 'analyze',
      score: ship(buildScore(1).toJSON()),
      options,
    });

    expect(response).toMatchObject({
      id: 3,
      ok: false,
      errorDetails: {code: 'invalid-request', operation: 'analyze'},
    });
  });

  it('allows unknown option fields for forward-compatible protocol extension', () => {
    const score = buildScore(2);
    const response = handleAnalyzeRequest(createAnalysisWorkerState(), {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 4,
      action: 'analyze',
      score: ship(score.toJSON()),
      options: {windowQuarters: 1, futureOption: true},
    });

    expect(expectOk(response)).toEqual({
      ...freshAnalysis(score),
      chords: segmentChords(score, {windowQuarters: 1}),
      roman: romanNumerals(score, detectKey(score), {windowQuarters: 1}),
    });
  });

  it('returns an error response (not a throw) for malformed score JSON', () => {
    const state = createAnalysisWorkerState();
    const response = handleAnalyzeRequest(state, {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 9,
      action: 'analyze',
      score: {nonsense: true} as never,
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/scoreFromJSON/);
      expect(response.errorDetails).toMatchObject({
        version: 1,
        code: 'analysis-failed',
        operation: 'analyze',
        retryable: false,
        causeCode: 'invalid-json',
      });
    }
  });

  it('rejects an unsupported protocol version with a structured response', () => {
    const response = handleAnalyzeRequest(createAnalysisWorkerState(), {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: 99,
      id: 10,
      action: 'analyze',
      score: ship(buildScore(1).toJSON()),
    });
    expect(response).toMatchObject({
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 10,
      ok: false,
      errorDetails: {code: 'unsupported-protocol', operation: 'protocol'},
    });
  });

  it('rejects an invalid request id before analysis', () => {
    const response = handleAnalyzeRequest(createAnalysisWorkerState(), {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: Number.NaN,
      action: 'analyze',
      score: ship(buildScore(1).toJSON()),
    });
    expect(response).toMatchObject({
      id: -1,
      ok: false,
      errorDetails: {code: 'invalid-request', operation: 'protocol'},
    });
  });
});

describe('createAnalysisWorker (in-process fallback)', () => {
  it('falls back to an in-process session in Node and matches a fresh analysis', async () => {
    expect(typeof Worker).toBe('undefined'); // precondition for the fallback
    const client = createAnalysisWorker();
    let score = buildScore(80);
    expect(await client.analyze(score)).toEqual(freshAnalysis(score));

    const rand = rng(5);
    for (let step = 0; step < 5; step += 1) {
      score = randomEdit(score, rand, step);
      expect(await client.update(score)).toEqual(freshAnalysis(score));
    }
    client.dispose();
    await expect(client.update(score)).rejects.toThrow(/disposed/);
  });

  it('update before analyze works on the fallback client', async () => {
    const client = createAnalysisWorker();
    const score = buildScore(40);
    expect(await client.update(score)).toEqual(freshAnalysis(score));
    client.dispose();
  });

  it.each(INVALID_ANALYSIS_WORKER_OPTIONS)(
    'rejects the same malformed options as the Worker handler (%j)',
    async (options) => {
      const client = createAnalysisWorker();
      const score = buildScore(4, 1, 1);

      await expect(client.analyze(score, options as never)).rejects.toThrow(/Analysis worker option/);
      expect(await client.analyze(score)).toEqual(freshAnalysis(score));
      client.dispose();
    },
  );

  it('falls back when the default browser Worker constructor rejects', async () => {
    const previousWorker = globalThis.Worker;
    globalThis.Worker = class ThrowingWorker {
      constructor() {
        throw new Error('blocked by CSP');
      }
    } as unknown as typeof Worker;
    try {
      const score = buildScore(40);
      const client = createAnalysisWorker();
      expect(await client.analyze(score)).toEqual(freshAnalysis(score));
      client.dispose();
    } finally {
      if (previousWorker === undefined) delete (globalThis as {Worker?: typeof Worker}).Worker;
      else globalThis.Worker = previousWorker;
    }
  });
});

/** A controllable fake worker: records requests, responds only when told to. */
function fakeWorker() {
  const posted: Array<{protocol: string; protocolVersion: number; id: number; action: string; score: unknown}> = [];
  let onMessage: ((event: {data: unknown}) => void) | null = null;
  let onError: ((event: {message?: string}) => void) | null = null;
  let terminated = false;
  const worker: AnalysisWorkerLike = {
    postMessage(message: unknown) {
      posted.push(message as {protocol: string; protocolVersion: number; id: number; action: string; score: unknown});
    },
    addEventListener(type, listener) {
      if (type === 'message') onMessage = listener as (event: {data: unknown}) => void;
      if (type === 'error') onError = listener as (event: {message?: string}) => void;
    },
    removeEventListener(type, listener) {
      if (type === 'message' && onMessage === listener) onMessage = null;
      if (type === 'error' && onError === listener) onError = null;
    },
    terminate() {
      terminated = true;
    },
  };
  return {
    worker,
    posted,
    isTerminated: () => terminated,
    listenerCount: () => Number(onMessage !== null) + Number(onError !== null),
    respond(
      response:
        | {id: number; ok: true; result: AnalysisResult}
        | {id: number; ok: false; error: string; errorDetails?: AnalysisWorkerErrorDetails},
    ) {
      const data: AnalysisWorkerResponse = response.ok
        ? {
            ...response,
            protocol: ANALYSIS_WORKER_PROTOCOL,
            protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
          }
        : {
            ...response,
            protocol: ANALYSIS_WORKER_PROTOCOL,
            protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
            errorDetails: response.errorDetails ?? {
              version: 1,
              code: 'analysis-failed',
              operation: 'update',
              message: response.error,
              retryable: false,
            },
          };
      onMessage?.({data});
    },
    respondRaw(response: unknown) {
      onMessage?.({data: response});
    },
    fail(message: string) {
      onError?.({message});
    },
  };
}

const dummyResult = (tag: string): AnalysisResult =>
  ({
    key: {tonic: tag, mode: 'major', confidence: 0, scores: []},
    chords: [],
    roman: [],
    motifs: [],
    issues: [],
  });

describe('createAnalysisWorker (worker-backed, latest-wins updates)', () => {
  it('overlapping updates all resolve with the newest result; stale scores are skipped', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const s1 = buildScore(10, 1, 1, 1);
    const s2 = randomEdit(s1, rng(2), 0);
    const s3 = randomEdit(s2, rng(3), 1);

    const p1 = client.update(s1); // sent immediately
    const p2 = client.update(s2); // queued while s1 is in flight
    const p3 = client.update(s3); // replaces s2 in the queue — s2 never sent

    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0].action).toBe('update');
    expect(fake.posted[0].protocol).toBe(ANALYSIS_WORKER_PROTOCOL);
    expect(fake.posted[0].protocolVersion).toBe(ANALYSIS_WORKER_PROTOCOL_VERSION);

    // The worker answers for s1 — stale, so the client must drop it and
    // immediately send the newest queued score (s3). s2 was superseded
    // before it was ever sent.
    fake.respond({id: fake.posted[0].id, ok: true, result: dummyResult('stale')});
    expect(fake.posted).toHaveLength(2);
    expect(fake.posted[1].score).toEqual(s3.toJSON());

    const fresh = dummyResult('fresh');
    fake.respond({id: fake.posted[1].id, ok: true, result: fresh});

    // Latest-wins: every caller observes the analysis of the NEWEST score.
    expect(await p1).toBe(fresh);
    expect(await p2).toBe(fresh);
    expect(await p3).toBe(fresh);
  });

  it('a single update resolves with its own result', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const promise = client.update(buildScore(10, 1, 1, 1));
    const result = dummyResult('only');
    fake.respond({id: fake.posted[0].id, ok: true, result});
    const resolved = await promise;
    expect(resolved).toBe(result);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.key)).toBe(true);
    expect(Object.isFrozen(resolved.key.scores)).toBe(true);
  });

  it('analyze requests are correlated by id and carry options', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const score = buildScore(10, 1, 1, 1);
    const promise = client.analyze(score, {windowQuarters: 1});
    expect(fake.posted[0]).toMatchObject({action: 'analyze', options: {windowQuarters: 1}});
    expect(fake.posted[0].score).toEqual(score.toJSON());
    const result = dummyResult('analyzed');
    fake.respond({id: fake.posted[0].id, ok: true, result});
    expect(await promise).toBe(result);
  });

  it('error responses reject, and dispose rejects pending calls', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const score = buildScore(10, 1, 1, 1);

    const failing = client.update(score);
    fake.respond({id: fake.posted[0].id, ok: false, error: 'boom'});
    await expect(failing).rejects.toBeInstanceOf(AnalysisWorkerRemoteError);

    const pending = client.analyze(score);
    client.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    // A ready-made worker instance is caller-owned: dispose must not terminate it.
    expect(fake.isTerminated()).toBe(false);
    expect(fake.listenerCount()).toBe(0);
  });

  it('rejects pending work when the worker responds with another protocol version', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const pending = client.analyze(buildScore(10, 1, 1, 1));
    fake.respondRaw({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: 99,
      id: fake.posted[0].id,
      ok: true,
      result: dummyResult('wrong'),
    });
    await expect(pending).rejects.toThrow(/Unsupported analysis worker response protocol .*@99/);
    expect(fake.listenerCount()).toBe(0);
  });

  it('rejects pending work when a valid response carries an unknown request id', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const pending = client.analyze(buildScore(10, 1, 1, 1));
    fake.respondRaw({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: fake.posted[0].id + 100,
      ok: true,
      result: dummyResult('wrong-id'),
    });
    await expect(pending).rejects.toThrow(/unknown request id/);
    expect(fake.listenerCount()).toBe(0);
  });

  it('rejects a malformed success response instead of resolving undefined', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const pending = client.analyze(buildScore(10, 1, 1, 1));
    fake.respondRaw({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: fake.posted[0].id,
      ok: true,
    });
    await expect(pending).rejects.toThrow(/malformed success response/);
    expect(fake.listenerCount()).toBe(0);
  });

  it('rejects an object that does not satisfy the AnalysisResult wire shape', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const pending = client.analyze(buildScore(10, 1, 1, 1));
    fake.respondRaw({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: fake.posted[0].id,
      ok: true,
      result: {},
    });
    await expect(pending).rejects.toThrow(/malformed success response/);
    expect(fake.listenerCount()).toBe(0);
  });

  it('rejects malformed structured error fields instead of trusting the TypeScript cast', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const pending = client.analyze(buildScore(10, 1, 1, 1));
    fake.respondRaw({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: fake.posted[0].id,
      ok: false,
      error: 'bad details',
      errorDetails: {
        version: 1,
        code: 'analysis-failed',
        operation: 'execute',
        message: 'bad details',
        retryable: false,
        causeCode: 42,
      },
    });
    await expect(pending).rejects.toThrow(/malformed error response/);
    expect(fake.listenerCount()).toBe(0);
  });

  it('fails current and future calls after a worker runtime error instead of leaving them pending', async () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(fake.worker);
    const score = buildScore(10, 1, 1, 1);

    const pending = client.analyze(score);
    fake.fail('worker exploded');
    await expect(pending).rejects.toThrow('worker exploded');
    await expect(client.analyze(score)).rejects.toThrow('worker exploded');
    await expect(client.update(score)).rejects.toThrow('worker exploded');
    expect(fake.posted).toHaveLength(1);
  });

  it('a factory-created worker is owned by the client and terminated on dispose', () => {
    const fake = fakeWorker();
    const client = createAnalysisWorker(() => fake.worker);
    client.dispose();
    expect(fake.isTerminated()).toBe(true);
  });

  it('end-to-end through handleAnalyzeRequest matches a fresh analysis', async () => {
    // Wire the fake worker to the real handler — the full protocol round-trip
    // (toJSON → clone → revive → session) without a real Worker.
    const state = createAnalysisWorkerState();
    const fake = fakeWorker();
    const original = fake.worker.postMessage.bind(fake.worker);
    fake.worker.postMessage = (message: unknown) => {
      original(message);
      const request = ship(message) as Parameters<typeof handleAnalyzeRequest>[1];
      queueMicrotask(() => fake.respond(handleAnalyzeRequest(state, request)));
    };
    const client = createAnalysisWorker(fake.worker);

    let score = buildScore(60);
    expect(await client.analyze(score)).toEqual(freshAnalysis(score));
    const rand = rng(11);
    for (let step = 0; step < 5; step += 1) {
      score = randomEdit(score, rand, step);
      expect(await client.update(score)).toEqual(freshAnalysis(score));
    }
    client.dispose();
  });
});
