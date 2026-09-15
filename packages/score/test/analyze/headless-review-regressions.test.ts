import {describe, expect, it, vi} from 'vitest';
import {Duration, PartId, Pitch, Rational, Score, ScoreBuilder, VoiceId} from '../../src/core';
import {detectKey} from '../../src/analyze/core/key';
import {spellChord} from '../../src/analyze/core/chord-spelling';
import {fretboardVoicing, TUNINGS} from '../../src/analyze/core/fretboard-voicing';
import {createLiveChordTracker, createLiveKeyTracker, type LiveChordState} from '../../src/analyze/headless/live-trackers';
import {identifyChordFromMidi, segmentChords} from '../../src/analyze/core/chords';
import {rhythmPatterns} from '../../src/analyze/core/motif';
import {voiceLeading} from '../../src/analyze/core/voice-leading';
import {createScoreReport} from '../../src/analyze/headless/report';
import {createTransportClock} from '../../src/analyze/headless/transport-clock';
import {createAnalysisSession} from '../../src/analyze/headless/session';
import {projectMotifFlow, projectVoiceFlow} from '../../src/analyze/headless/workbench';
import {createAnalysisWorkerState, handleAnalyzeRequest} from '../../src/analyze/headless/worker';
import {ANALYSIS_WORKER_PROTOCOL, ANALYSIS_WORKER_PROTOCOL_VERSION, createAnalysisWorker, type AnalysisWorkerEventLike, type AnalysisWorkerLike, type AnalysisWorkerRequest, type AnalysisWorkerResponse} from '../../src/analyze/headless/worker-client';

type NoteSpec = [pitch: string | null, onset: number, duration: number];
function scoreOf(voices: Record<string, NoteSpec[]>): Score {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  builder.addPart({id: part, name: String(part)});
  for (const [voice, notes] of Object.entries(voices)) {
    for (const [pitch, onset, duration] of notes) {
      builder.addNote(part, {
        id: builder.newNoteId(),
        ...(pitch === null ? {rest: true} : {pitch: Pitch.parse(pitch)}),
        onsetQuarters: Rational.from(onset),
        duration: new Duration({base: Rational.from(duration)}),
        voice: VoiceId(voice),
      });
    }
  }
  return builder.build();
}

function fakeWorker() {
  const listeners = new Map<string, Set<(event: AnalysisWorkerEventLike) => void>>();
  const worker: AnalysisWorkerLike = {
    postMessage: vi.fn(),
    addEventListener(type, listener) {
      const values = listeners.get(type) ?? new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    terminate: vi.fn(),
  };
  return {worker, listeners};
}

/** Real handler, manually delivered replies: exercise request order independently of result math. */
function scheduledWorker() {
  const {worker, listeners} = fakeWorker();
  const sent: AnalysisWorkerRequest[] = [];
  const requests: AnalysisWorkerRequest[] = [];
  const state = createAnalysisWorkerState();
  worker.postMessage = (message) => {
    const request = structuredClone(message) as AnalysisWorkerRequest;
    sent.push(request);
    requests.push(request);
  };
  const compute = () => {
    const request = requests.shift();
    if (!request) throw new Error('No queued request');
    return structuredClone(handleAnalyzeRequest(state, request));
  };
  const reply = (data: AnalysisWorkerResponse) => {
    for (const listener of listeners.get('message') ?? []) listener({data});
  };
  return {worker, listeners, sent, requests, state, compute, reply};
}

describe('Analyze Headless independent boundary regressions', () => {
  it('reports no key when there is no tonal evidence', () => {
    for (const score of [new ScoreBuilder().build(), scoreOf({one: [[null, 0, 1]]})]) {
      expect(createScoreReport(score).rows.find((row) => row.label === 'Key')?.value).toBe('Unknown');
    }
  });

  it('keeps an explicitly zero-length presentation axis at zero', () => {
    const clock = createTransportClock({durationSeconds: 0});
    clock.sample({nominalSeconds: 2, rate: 1, atMs: 0});
    expect(clock.readAt(40).seconds).toBe(0);
    clock.hold(8);
    expect(clock.readAt(80).seconds).toBe(0);
    clock.release(80);
    clock.stop(100, 4);
    expect(clock.readAt(100).seconds).toBe(0);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid rhythm length %s before inspecting notes', (length) => {
    expect(() => rhythmPatterns(new ScoreBuilder().build(), length)).toThrow(RangeError);
    expect(() => rhythmPatterns(scoreOf({one: [['C4', 0, 1]]}), length)).toThrow(RangeError);
  });

  it('retains the useful one-note duration vocabulary', () => {
    expect(rhythmPatterns(scoreOf({one: [['C4', 0, 1], ['D4', 1, 2], ['E4', 3, 1]]}), 1))
      .toEqual([{pattern: [1], count: 2, onsets: [0, 3]}, {pattern: [2], count: 1, onsets: [1]}]);
  });

  it('does not compare parallel intervals across a rest followed by an unmatched onset', () => {
    const score = scoreOf({
      lower: [['C4', 0, 1], [null, 1, 1], ['C#4', 2, 1], ['D4', 3, 1]],
      upper: [['G4', 0, 3], ['A4', 3, 1]],
    });
    expect(voiceLeading(score).filter((issue) => issue.type === 'parallel-fifth')).toEqual([]);
    expect(createAnalysisSession(score).result.issues.filter((issue) => issue.type === 'parallel-fifth')).toEqual([]);
  });

  it('projects actual motif occurrence bounds when notes have sounding gaps', () => {
    const score = scoreOf({one: [['C4', 0, 1], ['D4', 2, 1], ['E4', 5, 1], ['F#4', 7, 1]]});
    const result = createAnalysisSession(score, {motifLength: 2}).result;
    expect(result.motifs).toHaveLength(1);
    expect(projectMotifFlow(result, score).bands.map((band) => [band.stampStart, band.stampEnd]))
      .toEqual([[0, 3], [2, 6], [5, 8]]);
  });

  it('rejects serialization failure through the returned Promise without a dangling request', async () => {
    const {worker} = fakeWorker();
    const client = createAnalysisWorker(worker);
    const score = scoreOf({one: [['C4', 0, 1]]});
    const serialize = vi.spyOn(Score.prototype, 'toJSON').mockImplementation(() => { throw new Error('serialize'); });
    try {
      await expect(client.analyze(score)).rejects.toThrow('serialize');
      await expect(client.update(score)).rejects.toThrow('serialize');
      expect(worker.postMessage).not.toHaveBeenCalled();
    } finally {
      serialize.mockRestore();
      client.dispose();
    }
  });

  it.each([false, true])('cleans partial worker listener installation (owned=%s)', (owned) => {
    const {worker, listeners} = fakeWorker();
    const add = worker.addEventListener;
    worker.addEventListener = (type, listener) => {
      add(type, listener);
      if (type === 'error') throw new Error('attach');
    };
    expect(() => createAnalysisWorker(owned ? () => worker : worker)).toThrow('attach');
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true);
    expect(worker.terminate).toHaveBeenCalledTimes(owned ? 1 : 0);
  });
  it('keeps same-named voices in different parts distinct through projection and JSON worker delivery', async () => {
    const builder = new ScoreBuilder();
    for (const [id, pitches] of [['lower', ['C4', 'D4']], ['upper', ['G4', 'A4']]] as const) {
      const part = PartId(id);
      builder.addPart({id: part, name: String(part)});
      pitches.forEach((pitch, onset) => builder.addNote(part, {
        id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.from(onset),
        duration: new Duration({base: Rational.ONE}), voice: VoiceId('1'),
      }));
    }
    const score = builder.build();
    const session = createAnalysisSession(score);
    expect(session.result.issues).toMatchObject([{
      type: 'parallel-fifth', voices: ['1', '1'], voiceParts: ['lower', 'upper'],
    }]);
    expect(Object.isFrozen(session.result.issues[0].voiceParts)).toBe(true);
    expect(projectVoiceFlow(session.result, score).brackets).toMatchObject([{from: 0, to: 1}]);
    const response = handleAnalyzeRequest(createAnalysisWorkerState(), {
      protocol: ANALYSIS_WORKER_PROTOCOL, protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: 1, action: 'analyze', score: structuredClone(score.toJSON()),
    });
    if (!response.ok) throw new Error(response.error);
    expect(response.result.issues).toEqual(session.result.issues);
    const {worker, listeners} = fakeWorker();
    const state = createAnalysisWorkerState();
    worker.postMessage = (message) => {
      const data = structuredClone(handleAnalyzeRequest(state, structuredClone(message)));
      for (const listener of listeners.get('message') ?? []) listener({data});
    };
    const client = createAnalysisWorker(worker);
    try {
      const remote = await client.analyze(score);
      expect(remote.issues).toEqual(session.result.issues);
      expect(Object.isFrozen(remote.issues[0].voiceParts)).toBe(true);
    } finally { client.dispose(); }
    expect(projectVoiceFlow(response.result, score).brackets).toMatchObject([{from: 0, to: 1}]);
    const legacy = {...session.result, issues: session.result.issues.map(({voiceParts: _parts, ...issue}) => issue)};
    expect(projectVoiceFlow(legacy, score).brackets).toEqual([]);
  });

  it('ranks all 24 transposed published key profiles without changing their tonic', () => {
    // Krumhansl/Kessler 1982 profile values, as published by Humdrum keycor.
    // Integer scaling avoids rounding the independently specified weights.
    const profiles = {
      major: [635, 223, 348, 233, 438, 409, 252, 519, 239, 366, 229, 288],
      minor: [633, 268, 352, 538, 260, 353, 254, 475, 398, 269, 334, 317],
    };
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    for (const [mode, weights] of Object.entries(profiles)) {
      for (let root = 0; root < 12; root += 1) {
        const score = scoreOf({one: weights.map((duration, degree) => [
          `${names[(root + degree) % 12]}4`, 0, duration,
        ] as NoteSpec)});
        const result = detectKey(score);
        expect(result).toMatchObject({tonic: names[root], mode});
        expect(result.scores[0].score).toBeCloseTo(1, 12);
        expect(result.confidence).toBeCloseTo(1, 12);
      }
    }
  });

  it('uses an unknown ranking for silence and no preference for a uniform chromatic histogram', () => {
    expect(detectKey(new ScoreBuilder().build())).toMatchObject({scores: [], confidence: 0});
    const score = scoreOf({one: ['C4', 'C#4', 'D4', 'Eb4', 'E4', 'F4', 'F#4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4']
      .map((pitch) => [pitch, 0, 1] as NoteSpec)});
    const result = detectKey(score);
    expect(result.confidence).toBe(0);
    expect(result.scores.every((candidate) => candidate.score === 0)).toBe(true);
  });

  it('recognizes conventional root-position triads across transposition and preserves every named pitch', () => {
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    for (let root = 0; root < 12; root += 1) {
      for (const [intervals, suffix] of [[[0, 4, 7], 'M'], [[0, 3, 7], 'm']] as const) {
        const midis = intervals.map((interval) => 48 + root + interval);
        expect(identifyChordFromMidi([...midis, midis[0] + 12])).toBe(`${names[root]}${suffix}`);
        const spelling = spellChord(midis);
        expect(spelling.pitches.map((pitch) => Pitch.parse(pitch.name).midi)).toEqual(midis);
      }
    }
    expect(spellChord([64, 67, 72]).primary?.symbol).toBe('CM/E');
  });

  it('retains each custom tuning metadata value in cached fretboard answers', () => {
    const spelling = spellChord([60, 64, 67]);
    const short = {...TUNINGS.standard, id: 'instrument', name: 'Instrument', frets: 12, inlays: [3]};
    const long = {...short, frets: 24, inlays: [7]};
    expect(fretboardVoicing(spelling, {tuning: short, lastFret: 5}).tuning).toMatchObject({frets: 12, inlays: [3]});
    expect(fretboardVoicing(spelling, {tuning: long, lastFret: 5}).tuning).toMatchObject({frets: 24, inlays: [7]});
    const a = {...short, id: 'a|b', name: 'c'};
    const b = {...short, id: 'a', name: 'b|c'};
    expect(fretboardVoicing(spelling, {tuning: a}).tuning.id).toBe('a|b');
    expect(fretboardVoicing(spelling, {tuning: b}).tuning.id).toBe('a');
  });

  it('does not post a request if serialization synchronously disposes the client', async () => {
    const {worker} = fakeWorker();
    const client = createAnalysisWorker(worker);
    const score = scoreOf({one: [['C4', 0, 1]]});
    const original = Score.prototype.toJSON;
    const serialize = vi.spyOn(Score.prototype, 'toJSON').mockImplementation(function (this: Score) {
      client.dispose();
      return original.call(this);
    });
    try {
      await expect(client.analyze(score)).rejects.toThrow('disposed');
      expect(worker.postMessage).not.toHaveBeenCalled();
    } finally { serialize.mockRestore(); client.dispose(); }
  });

  it('keeps live note occurrences and callbacks isolated from consumer mutation and reentry', () => {
    const states: LiveChordState[] = [];
    const chord = createLiveChordTracker({onUpdate: (state) => states.push(state)});
    for (const midi of [60, 60, 64, 67]) chord.noteOn(midi);
    (states.at(-1)!.midis as number[]).length = 0;
    chord.noteOff(60);
    expect(states.at(-1)?.midis).toEqual([60, 64, 67]);
    chord.noteOff(60);
    expect(states.at(-1)?.midis).toEqual([64, 67]);
    chord.reset();
    expect(states.at(-1)).toEqual({chord: '', midis: [], history: []});
    const key = createLiveKeyTracker(() => key.reset());
    key.noteOn(60);
    expect(key.heard).toBe(0);
    expect(key.result()).toBeUndefined();
  });

  it('uses half-open chord boundaries and never merges equal chords across silence', () => {
    const score = scoreOf({
      bass: [['C4', 0, 1], ['F4', 1, 1], ['C4', 3, 1]],
      middle: [['E4', 0, 1], ['A4', 1, 1], ['E4', 3, 1]],
      top: [['G4', 0, 1], ['C5', 1, 1], ['G4', 3, 1]],
    });
    expect(segmentChords(score).map((segment) => [segment.startQuarters, segment.endQuarters, segment.chord]))
      .toEqual([[0, 1, 'CM'], [1, 2, 'FM'], [3, 4, 'CM']]);
  });

  it('keeps the full sounding extent of overlapping notes in a voice lane', () => {
    const score = scoreOf({one: [['C4', 0, 8], ['D4', 1, 1]]});
    const lane = projectVoiceFlow(createAnalysisSession(score).result, score);
    expect(lane.bands[0]).toMatchObject({stampStart: 0, stampEnd: 8, start: 0, end: 4});
  });

});


describe('Analyze worker mixed command ordering', () => {
  const a = () => scoreOf({one: [['C4', 0, 1]]});
  const b = () => scoreOf({one: [['D4', 0, 2]]});
  const c = () => scoreOf({one: [['E4', 0, 3]]});
  const d = () => scoreOf({one: [['C4', 0, 1], ['D4', 1, 1], ['E4', 2, 1], ['F#4', 3, 1]]});

  it.each([false, true])('reanalyze replaces earlier updates even when the old reply arrives late (%s)', async (late) => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(h.worker);
    try {
      const first = client.update(a());
      const skipped = client.update(b());
      const oldReply = h.compute();
      const latestScore = c();
      const latest = client.analyze(latestScore, {motifLength: 2});
      if (!late) h.reply(oldReply);
      const latestReply = h.compute();
      h.reply(latestReply);
      if (late) h.reply(oldReply);
      const results = await Promise.all([first, skipped, latest]);
      expect(results[0]).toBe(results[2]);
      expect(results[1]).toBe(results[2]);
      expect(results[2]).toEqual(createAnalysisSession(latestScore, {motifLength: 2}).result);
      expect(h.sent.map((request) => request.action)).toEqual(['update', 'analyze']);
      expect(h.requests).toEqual([]);
      expect(h.state.session?.score.toJSON()).toEqual(latestScore.toJSON());
    } finally { client.dispose(); }
  });

  it('holds a later update behind reanalysis and coalesces all update waiters under the new options', async () => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(h.worker);
    try {
      const first = client.update(a());
      const skipped = client.update(b());
      const oldReply = h.compute();
      const analyzedScore = c();
      const analyzed = client.analyze(analyzedScore, {motifLength: 2});
      const newestScore = d();
      const newest = client.update(newestScore);
      expect(h.sent.map((request) => request.action)).toEqual(['update', 'analyze']);
      h.reply(oldReply);
      expect(h.sent).toHaveLength(2);
      h.reply(h.compute());
      expect(await analyzed).toEqual(createAnalysisSession(analyzedScore, {motifLength: 2}).result);
      expect(h.sent.map((request) => request.action)).toEqual(['update', 'analyze', 'update']);
      expect(h.sent[2].score).toEqual(newestScore.toJSON());
      h.reply(h.compute());
      const results = await Promise.all([first, skipped, newest]);
      expect(results[0]).toBe(results[2]);
      expect(results[1]).toBe(results[2]);
      expect(results[2].motifs).toHaveLength(1);
      expect(h.state.session?.score.toJSON()).toEqual(newestScore.toJSON());
    } finally { client.dispose(); }
  });

  it('lets only the newest analyze release subsequent updates while each analyze keeps its own result', async () => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(h.worker);
    try {
      const older = client.analyze(a(), {motifLength: 4});
      const replacedUpdate = client.update(b());
      const newer = client.analyze(c(), {motifLength: 2});
      const finalScore = d();
      const finalUpdate = client.update(finalScore);
      h.reply(h.compute());
      expect(await older).toEqual(createAnalysisSession(a(), {motifLength: 4}).result);
      expect(h.sent.map((request) => request.action)).toEqual(['analyze', 'analyze']);
      h.reply(h.compute());
      expect(await newer).toEqual(createAnalysisSession(c(), {motifLength: 2}).result);
      expect(h.sent.map((request) => request.action)).toEqual(['analyze', 'analyze', 'update']);
      h.reply(h.compute());
      const results = await Promise.all([replacedUpdate, finalUpdate]);
      expect(results[0]).toBe(results[1]);
      expect(results[1].motifs).toHaveLength(1);
      expect(h.state.session?.score.toJSON()).toEqual(finalScore.toJSON());
    } finally { client.dispose(); }
  });

  it('rejects every superseded update waiter when the newest analysis fails without a later update', async () => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(h.worker);
    try {
      const first = client.update(a());
      const skipped = client.update(b());
      const analyzed = client.analyze(c(), {motifLength: 0});
      const settled = Promise.allSettled([first, skipped, analyzed]);
      h.reply(h.compute());
      h.reply(h.compute());
      const outcomes = await settled;
      expect(outcomes).toHaveLength(3);
      for (const outcome of outcomes) {
        expect(outcome).toMatchObject({status: 'rejected', reason: {
          name: 'AnalysisWorkerRemoteError', operation: 'analyze', code: 'invalid-request',
        }});
      }
      expect(h.requests).toEqual([]);
      const retry = client.update(d());
      h.reply(h.compute());
      await expect(retry).resolves.toEqual(createAnalysisSession(d()).result);
    } finally { client.dispose(); }
  });

  it('drops later queued updates on reanalysis failure instead of silently using old options', async () => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(h.worker);
    try {
      const initial = client.analyze(a(), {motifLength: 2});
      h.reply(h.compute());
      await initial;
      const oldScore = b();
      const oldUpdate = client.update(oldScore);
      const invalid = client.analyze(c(), {motifLength: 0});
      const newest = client.update(d());
      const settled = Promise.allSettled([oldUpdate, invalid, newest]);
      h.reply(h.compute());
      h.reply(h.compute());
      for (const outcome of await settled) {
        expect(outcome).toMatchObject({status: 'rejected', reason: {
          name: 'AnalysisWorkerRemoteError', operation: 'analyze', code: 'invalid-request',
        }});
      }
      expect(h.sent.map((request) => request.action)).toEqual(['analyze', 'update', 'analyze']);
      expect(h.requests).toEqual([]);
      expect(h.state.session?.score.toJSON()).toEqual(oldScore.toJSON());
    } finally { client.dispose(); }
  });

  it.each([false, true])('disposal settles all barrier/queued waiters and ignores late replies (owned=%s)', async (owned) => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(owned ? () => h.worker : h.worker);
    const pending = [client.update(a()), client.update(b()), client.analyze(c()), client.update(d())];
    const settled = Promise.allSettled(pending);
    client.dispose();
    client.dispose();
    expect(await settled).toHaveLength(4);
    for (const outcome of await settled) {
      expect(outcome).toMatchObject({status: 'rejected', reason: {message: 'AnalysisWorkerClient is disposed'}});
    }
    expect([...h.listeners.values()].every((entries) => entries.size === 0)).toBe(true);
    expect(h.worker.terminate).toHaveBeenCalledTimes(owned ? 1 : 0);
    h.reply(h.compute());
    h.reply(h.compute());
    expect(h.sent).toHaveLength(2);
    await expect(client.update(a())).rejects.toThrow('disposed');
  });

  it('a terminal worker error rejects every mixed pending call and clears the queued input', async () => {
    const h = scheduledWorker();
    const client = createAnalysisWorker(h.worker);
    const pending = [client.update(a()), client.update(b()), client.analyze(c()), client.update(d())];
    const settled = Promise.allSettled(pending);
    for (const listener of h.listeners.get('error') ?? []) listener({message: 'runtime stopped'});
    for (const outcome of await settled) {
      expect(outcome).toMatchObject({status: 'rejected', reason: {message: 'runtime stopped'}});
    }
    h.reply(h.compute());
    h.reply(h.compute());
    expect(h.sent).toHaveLength(2);
    await expect(client.analyze(a())).rejects.toThrow('runtime stopped');
    client.dispose();
  });
});
