import {Duration, Pitch, Rational, Score, ScoreBuilder, VoiceId, scoreFromJSON, scoreNotes} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ABCParseLimitError, parseABC, serializeABC} from '../../src/io/formats/abc';
import {MIDIParseLimitError, serializeMIDI} from '../../src/io/formats/midi';
import {MusicXMLParseLimitError, serializeMusicXML} from '../../src/io/formats/musicxml';
import {MXLParseLimitError, serializeMXL} from '../../src/io/formats/mxl';
import {ScoreInputLimitError} from '../../src/io/load';
import {createParserWorker, createRequestTracker, type WorkerLike} from '../../src/io/worker-client';
import {
  PARSE_WORKER_PROTOCOL,
  PARSE_WORKER_PROTOCOL_VERSION,
  handleParseRequest,
  type ParseRequest,
  type ParseResponse,
  type ParseWorkerRequest,
} from '../../src/io/worker-protocol';

function sampleScore() {
  const builder = new ScoreBuilder();
  builder.setMetadata({title: 'Sample'});
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Piano'});
  const voice = VoiceId(`${partId}-v1`);
  ['C4', 'E4', 'G4', 'C5'].forEach((name, index) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(index, 1),
      duration: new Duration({base: Rational.ONE}),
      voice,
    });
  });
  return builder.build();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function expectOkScore(response: ParseResponse): Promise<Score> {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.error);
  // The response payload must be plain JSON (postMessage / structured clone safe).
  expect(JSON.parse(JSON.stringify(response.score))).toEqual(response.score);
  return scoreFromJSON(JSON.parse(JSON.stringify(response.score)));
}

describe('handleParseRequest round-trips', () => {
  it('parses MusicXML text', async () => {
    const response = await handleParseRequest({id: 1, action: 'parse', format: 'musicxml', data: serializeMusicXML(sampleScore())});
    const score = await expectOkScore(response);
    expect(response.id).toBe(1);
    expect(scoreNotes(score)).toHaveLength(4);
  });

  it('parses MXL archives', async () => {
    const response = await handleParseRequest({id: 2, action: 'parse', format: 'mxl', data: toArrayBuffer(serializeMXL(sampleScore()))});
    const score = await expectOkScore(response);
    expect(scoreNotes(score)).toHaveLength(4);
  });

  it('parses MIDI buffers', async () => {
    const response = await handleParseRequest({id: 3, action: 'parse', format: 'midi', data: toArrayBuffer(serializeMIDI(sampleScore()))});
    const score = await expectOkScore(response);
    expect(scoreNotes(score)).toHaveLength(4);
  });

  it('parses ABC text', async () => {
    const response = await handleParseRequest({id: 4, action: 'parse', format: 'abc', data: serializeABC(sampleScore())});
    const score = await expectOkScore(response);
    expect(scoreNotes(score).length).toBeGreaterThan(0);
  });

  it('preserves common ABC slash duration forms through the Worker JSON boundary', async () => {
    const abc = 'X:1\nM:4/4\nL:1/4\nK:C\nC C2 C/ C// C3/ C3// C/2 C3/2';
    const expected = scoreNotes(parseABC(abc)).map((note) => note.duration.quarters.toString());
    const response = await handleParseRequest({id: 14, action: 'parse', format: 'abc', data: abc});
    const score = await expectOkScore(response);

    expect(scoreNotes(score).map((note) => note.duration.quarters.toString())).toEqual(expected);
    expect(expected).toEqual(['1', '2', '1/2', '1/4', '3/2', '3/4', '1/2', '3/2']);
  });

  it('auto-detects the format when "auto" or omitted', async () => {
    const midi = toArrayBuffer(serializeMIDI(sampleScore()));
    const auto = await handleParseRequest({id: 5, action: 'parse', format: 'auto', data: midi});
    expect((await expectOkScore(auto)) instanceof Score).toBe(true);
    const omitted = await handleParseRequest({id: 6, action: 'parse', data: serializeMusicXML(sampleScore())});
    expect(scoreNotes(await expectOkScore(omitted))).toHaveLength(4);
  });

  it('preserves detailed MusicXML diagnostics only for the explicit protocol action', async () => {
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
        <note><duration>1</duration></note>
      </measure></part>
    </score-partwise>`;
    const plain = await handleParseRequest({id: 11, action: 'parse', format: 'musicxml', data: xml});
    const detailed = await handleParseRequest({id: 12, action: 'parse-detailed', format: 'musicxml', data: xml});

    expect(plain).toMatchObject({id: 11, ok: true});
    if (plain.ok) expect(plain.diagnostics).toBeUndefined();
    expect(detailed).toMatchObject({id: 12, ok: true});
    if (detailed.ok) expect(detailed.diagnostics?.[0]).toMatchObject({code: 'musicxml-note-without-pitch'});
  });

  it('returns JSON-reconstructable canonical timeline events from the worker', async () => {
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
        <direction><sound tempo="120"/></direction>
        <direction><sound tempo="90"/></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      </measure></part>
    </score-partwise>`;
    const response = await handleParseRequest({id: 13, action: 'parse-detailed', format: 'musicxml', data: xml});
    const score = await expectOkScore(response);

    expect(score.timeMap.tempi).toHaveLength(1);
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(90);
    if (response.ok) {
      expect(response.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({code: 'musicxml-tempo-same-position-normalized'}),
      ]));
    }
  });
});

describe('handleParseRequest error responses', () => {
  it('reports malformed MIDI as {ok: false} instead of throwing', async () => {
    const garbage = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0xff, 0xff, 0xff]); // MThd magic, bogus body
    const response = await handleParseRequest({id: 7, action: 'parse', format: 'midi', data: toArrayBuffer(garbage)});
    expect(response).toMatchObject({id: 7, ok: false});
    if (!response.ok) expect(typeof response.error).toBe('string');
  });

  it('reports malformed MusicXML as {ok: false}', async () => {
    const response = await handleParseRequest({id: 8, action: 'parse', format: 'musicxml', data: '<score-partwise><unclosed'});
    expect(response).toMatchObject({id: 8, ok: false});
  });

  it('rejects unknown actions and bad payloads', async () => {
    const nullRequest = await handleParseRequest(null as unknown as ParseRequest);
    expect(nullRequest).toMatchObject({
      id: -1,
      ok: false,
      errorDetail: {code: 'invalid-request', operation: 'protocol'},
    });
    const bad = await handleParseRequest({id: 9, action: 'transmogrify'} as unknown as ParseRequest);
    expect(bad).toMatchObject({id: 9, ok: false});
    const badData = await handleParseRequest({id: 10, action: 'parse', data: 42} as unknown as ParseRequest);
    expect(badData).toMatchObject({id: 10, ok: false});
    const badFormat = await handleParseRequest({
      id: 11,
      action: 'parse',
      format: 'bogus',
      data: 'X:1\nK:C\nC',
    } as unknown as ParseRequest);
    expect(badFormat).toMatchObject({
      id: 11,
      ok: false,
      errorDetail: {code: 'invalid-request', operation: 'protocol'},
    });
  });

  it('returns a versioned envelope and rejects an explicit protocol mismatch', async () => {
    const response = await handleParseRequest({
      id: 15,
      action: 'parse',
      format: 'abc',
      data: 'X:1\nK:C\nC',
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: 999,
    } as unknown as ParseRequest);

    expect(response).toMatchObject({
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id: 15,
      ok: false,
    });
    if (!response.ok) {
      expect(response.errorDetail).toMatchObject({
        version: 1,
        name: 'Error',
        code: 'unsupported-protocol',
        operation: 'protocol',
        message: expect.stringMatching(/version/),
        retryable: false,
      });
    }
  });

  it('rejects a partial protocol header instead of treating it as legacy v0', async () => {
    const response = await handleParseRequest({
      id: 17,
      action: 'parse',
      format: 'abc',
      data: 'X:1\nK:C\nC',
      protocol: PARSE_WORKER_PROTOCOL,
    } as unknown as ParseRequest);

    expect(response).toMatchObject({id: 17, ok: false});
    if (!response.ok) {
      expect(response.errorDetail).toMatchObject({
        code: 'invalid-request',
        operation: 'protocol',
      });
    }
  });

  it('serializes cancellation as a structured AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await handleParseRequest(
      {id: 16, action: 'parse', format: 'abc', data: 'X:1\nK:C\nC'},
      controller.signal,
    );

    expect(response).toMatchObject({id: 16, ok: false});
    if (!response.ok) {
      expect(response.errorDetail).toMatchObject({
        version: 1,
        name: 'AbortError',
        code: 'score-load-aborted',
        operation: 'cancel',
      });
    }
  });
});

describe('createRequestTracker (id correlation)', () => {
  it('correlates out-of-order responses by id', async () => {
    const tracker = createRequestTracker<string>();
    const a = tracker.add();
    const b = tracker.add();
    expect(a.id).not.toBe(b.id);
    expect(tracker.size).toBe(2);
    expect(tracker.resolve(b.id, 'second')).toBe(true);
    expect(tracker.resolve(a.id, 'first')).toBe(true);
    await expect(a.promise).resolves.toBe('first');
    await expect(b.promise).resolves.toBe('second');
    expect(tracker.size).toBe(0);
  });

  it('ignores unknown / already-settled ids', () => {
    const tracker = createRequestTracker<string>();
    const {id, promise} = tracker.add();
    void promise.catch(() => {});
    expect(tracker.resolve(999, 'nope')).toBe(false);
    expect(tracker.reject(id, new Error('boom'))).toBe(true);
    expect(tracker.reject(id, new Error('again'))).toBe(false);
  });

  it('rejectAll flushes every pending request', async () => {
    const tracker = createRequestTracker<string>();
    const a = tracker.add();
    const b = tracker.add();
    tracker.rejectAll(new Error('worker died'));
    await expect(a.promise).rejects.toThrow('worker died');
    await expect(b.promise).rejects.toThrow('worker died');
    expect(tracker.size).toBe(0);
  });
});

/** In-process fake Worker that answers via the real protocol handler. */
function fakeWorker() {
  let onMessage: ((event: {data: ParseResponse}) => void) | undefined;
  let onError: ((event: {message: string}) => void) | undefined;
  const seen: ParseRequest[] = [];
  const posted: Array<{data: unknown; transfer: Transferable[]}> = [];
  let terminated = false;
  const worker: WorkerLike = {
    postMessage(message, transfer) {
      posted.push({
        data: (message as Partial<ParseRequest>).data,
        transfer: [...(transfer ?? [])],
      });
      const request = structuredClone(
        message,
        transfer && transfer.length > 0 ? {transfer} : undefined,
      ) as ParseRequest;
      seen.push(request);
      void handleParseRequest(request).then((response) => onMessage?.({data: response}));
    },
    terminate() {
      terminated = true;
    },
    addEventListener(type: string, listener: unknown) {
      if (type === 'message') onMessage = listener as typeof onMessage;
      if (type === 'error') onError = listener as typeof onError;
    },
  } as WorkerLike;
  return {
    worker,
    seen,
    posted,
    emitError: (message: string) => onError?.({message}),
    get terminated() {
      return terminated;
    },
  };
}

describe('createParserWorker', () => {
  it('falls back to in-process parsing when Worker is unavailable (Node)', async () => {
    expect(typeof Worker).toBe('undefined'); // vitest node environment
    const parser = createParserWorker();
    const score = await parser.parse(serializeMusicXML(sampleScore()));
    expect(score instanceof Score).toBe(true);
    expect(scoreNotes(score)).toHaveLength(4);
    const detailed = await parser.parseDetailed(`<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
        <note><duration>1</duration></note>
      </measure></part>
    </score-partwise>`, 'musicxml');
    expect(detailed.diagnostics[0]).toMatchObject({code: 'musicxml-note-without-pitch'});
    const midi = await parser.parse(serializeMIDI(sampleScore()), 'midi');
    expect(scoreNotes(midi)).toHaveLength(4);
    parser.dispose();
    await expect(parser.parse('X:1\nK:C\nC')).rejects.toThrow('disposed');
  });

  it('falls back when the default browser Worker constructor rejects', async () => {
    vi.stubGlobal(
      'Worker',
      class ThrowingWorker {
        constructor() {
          throw new Error('blocked by CSP');
        }
      },
    );
    const parser = createParserWorker();
    const score = await parser.parse(serializeMusicXML(sampleScore()));
    expect(scoreNotes(score)).toHaveLength(4);
    parser.dispose();
  });

  it('loadFromUrl fetches on the calling thread and parses (fallback path)', async () => {
    const bytes = serializeMIDI(sampleScore());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(toArrayBuffer(bytes))));
    const parser = createParserWorker();
    const score = await parser.loadFromUrl('https://example.com/tune.mid');
    expect(scoreNotes(score)).toHaveLength(4);
    parser.dispose();
  });

  it('loadFromUrl rejects on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', {status: 404, statusText: 'Not Found'})));
    const parser = createParserWorker();
    await expect(parser.loadFromUrl('https://example.com/missing.mxl')).rejects.toThrow('404');
    parser.dispose();
  });

  it('preserves the HTTP error when response-body cancellation throws synchronously', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      body: {cancel: () => { throw new Error('cancel failed'); }},
    } as unknown as Response)));
    const parser = createParserWorker();

    await expect(parser.loadFromUrl('https://example.com/unavailable.mxl')).rejects.toThrow(
      '503 Unavailable',
    );
    parser.dispose();
  });

  it('round-trips through a supplied worker and correlates concurrent requests', async () => {
    const fake = fakeWorker();
    const parser = createParserWorker(fake.worker);
    const [xmlScore, midiScore] = await Promise.all([
      parser.parse(serializeMusicXML(sampleScore()), 'musicxml'),
      parser.parse(toArrayBuffer(serializeMIDI(sampleScore())), 'midi'),
    ]);
    expect(scoreNotes(xmlScore)).toHaveLength(4);
    expect(scoreNotes(midiScore)).toHaveLength(4);
    expect(fake.seen.map((r) => r.id)).toHaveLength(2);
    expect(new Set(fake.seen.map((r) => r.id)).size).toBe(2);
    const detailed = await parser.parseDetailed(`<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
        <note><duration>1</duration></note>
      </measure></part>
    </score-partwise>`, 'musicxml');
    expect(detailed.diagnostics[0]).toMatchObject({format: 'musicxml'});
    expect(fake.seen.at(-1)?.action).toBe('parse-detailed');
    parser.dispose();
    expect(fake.terminated).toBe(true);
  });

  it('copies caller-owned ArrayBuffers before transferring them to a Worker', async () => {
    const input = new TextEncoder().encode('X:1\nK:C\nC').buffer as ArrayBuffer;
    const expected = [...new Uint8Array(input)];
    const fake = fakeWorker();
    const parser = createParserWorker(fake.worker);

    const score = await parser.parse(input, 'abc');

    expect(scoreNotes(score)).toHaveLength(1);
    expect(input.byteLength).toBe(expected.length);
    expect([...new Uint8Array(input)]).toEqual(expected);
    expect(fake.posted[0]?.data).not.toBe(input);
    expect(fake.posted[0]?.transfer[0]).toBe(fake.posted[0]?.data);
    parser.dispose();
  });

  it('copies only the exact byte range of caller-owned Uint8Array views', async () => {
    const encoded = new TextEncoder().encode('X:1\nK:C\nD');
    const padded = new Uint8Array(encoded.byteLength + 8);
    padded.fill(0xff);
    padded.set(encoded, 4);
    const view = new Uint8Array(padded.buffer, 4, encoded.byteLength);
    const fake = fakeWorker();
    const parser = createParserWorker(fake.worker);

    const score = await parser.parse(view, 'abc');

    expect(scoreNotes(score)).toHaveLength(1);
    expect((fake.seen.at(-1)?.data as ArrayBuffer).byteLength).toBe(encoded.byteLength);
    expect([...view]).toEqual([...encoded]);
    expect([...padded.slice(0, 4)]).toEqual([0xff, 0xff, 0xff, 0xff]);
    parser.dispose();
  });

  it('copies SharedArrayBuffer-backed views instead of trying to transfer shared memory', async () => {
    if (typeof SharedArrayBuffer !== 'function') return;
    const encoded = new TextEncoder().encode('X:1\nK:C\nE');
    const shared = new SharedArrayBuffer(encoded.byteLength + 2);
    const view = new Uint8Array(shared, 1, encoded.byteLength);
    view.set(encoded);
    const fake = fakeWorker();
    const parser = createParserWorker(fake.worker);

    const score = await parser.parse(view, 'abc');

    expect(scoreNotes(score)).toHaveLength(1);
    expect([...view]).toEqual([...encoded]);
    expect(fake.seen.at(-1)?.data).toBeInstanceOf(ArrayBuffer);
    parser.dispose();
  });

  it('transfers only URL buffers that the parser client allocated itself', async () => {
    const owned = new TextEncoder().encode('X:1\nK:C\nF').buffer as ArrayBuffer;
    const fake = fakeWorker();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: {get: () => null},
      body: null,
      arrayBuffer: vi.fn(async () => owned),
    } as unknown as Response)));
    const parser = createParserWorker(fake.worker);

    const score = await parser.loadFromUrl('https://example.com/owned.abc', 'abc');

    expect(scoreNotes(score)).toHaveLength(1);
    expect(fake.posted[0]?.data).toBe(owned);
    expect(fake.posted[0]?.transfer).toEqual([owned]);
    expect(owned.byteLength).toBe(0);
    expect(fake.seen.at(-1)?.data).toBeInstanceOf(ArrayBuffer);
    parser.dispose();
  });

  it('rejects oversized binary input before allocating or posting a Worker payload', async () => {
    const input = new ArrayBuffer(9);
    const fake = fakeWorker();
    const parser = createParserWorker(fake.worker);

    await expect(parser.parse(input, 'midi', {maxInputBytes: 8})).rejects.toBeInstanceOf(
      ScoreInputLimitError,
    );
    expect(input.byteLength).toBe(9);
    expect(fake.posted).toHaveLength(0);
    parser.dispose();
  });

  it('rejects oversized text before structured-cloning it into a Worker', async () => {
    const fake = fakeWorker();
    const parser = createParserWorker(fake.worker);

    await expect(parser.parse('\u00e9\u00e9\u00e9', 'abc', {maxInputBytes: 5})).rejects.toBeInstanceOf(
      ScoreInputLimitError,
    );
    expect(fake.posted).toHaveLength(0);
    parser.dispose();
  });

  it('uses the same call-time binary snapshot in the in-process fallback', async () => {
    const input = new TextEncoder().encode('X:1\nK:C\nC');
    const parser = createParserWorker();

    const pending = parser.parse(input, 'abc');
    input[input.length - 1] = 'D'.charCodeAt(0);
    const score = await pending;

    expect(scoreNotes(score)[0]?.pitch?.step).toBe('C');
    parser.dispose();
  });

  it('preserves stable resource-limit errors across Worker and fallback paths', async () => {
    const input = 'X:1\nK:C\nC';
    const fallbackParser = createParserWorker();
    const fake = fakeWorker();
    const workerParser = createParserWorker(fake.worker);

    const [fallbackResult, workerResult] = await Promise.allSettled([
      fallbackParser.parse(input, 'abc', {maxInputBytes: 4}),
      workerParser.parse(input, 'abc', {maxInputBytes: 4}),
    ]);
    for (const result of [fallbackResult, workerResult]) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ScoreInputLimitError);
        expect(result.reason).toMatchObject({code: 'score-input-limit'});
      }
    }

    fallbackParser.dispose();
    workerParser.dispose();
  });

  it('preserves format-specific limit errors across Worker and fallback paths', async () => {
    const abc = 'X:1\nK:C\nC D';
    const archive = toArrayBuffer(serializeMXL(sampleScore()));
    const midi = toArrayBuffer(serializeMIDI(sampleScore()));
    const musicxml = serializeMusicXML(sampleScore());
    for (const useWorker of [false, true]) {
      const fake = useWorker ? fakeWorker() : undefined;
      const parser = createParserWorker(fake?.worker);
      await expect(parser.parse(abc, 'abc', {abc: {maxTokens: 1}})).rejects.toBeInstanceOf(
        ABCParseLimitError,
      );
      await expect(
        parser.parse(archive.slice(0), 'mxl', {mxl: {maxEntryBytes: 1}}),
      ).rejects.toBeInstanceOf(MXLParseLimitError);
      await expect(
        parser.parse(midi.slice(0), 'midi', {midi: {maxEvents: 1}}),
      ).rejects.toBeInstanceOf(MIDIParseLimitError);
      await expect(
        parser.parse(musicxml, 'musicxml', {musicxml: {maxElements: 1}}),
      ).rejects.toBeInstanceOf(MusicXMLParseLimitError);
      parser.dispose();
    }
  });

  it('accepts a worker factory and surfaces worker parse errors', async () => {
    const fake = fakeWorker();
    const parser = createParserWorker(() => fake.worker);
    await expect(parser.parse('<score-partwise><unclosed', 'musicxml')).rejects.toThrow();
    parser.dispose();
  });

  it('rejects in-flight requests when the worker errors', async () => {
    let captured: ((event: {data: ParseResponse}) => void) | undefined;
    let onError: ((event: {message: string}) => void) | undefined;
    const silent: WorkerLike = {
      postMessage() {
        // Never responds — simulates a worker that crashes mid-parse.
        queueMicrotask(() => onError?.({message: 'worker exploded'}));
      },
      terminate() {},
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') captured = listener as typeof captured;
        if (type === 'error') onError = listener as typeof onError;
      },
    } as WorkerLike;
    void captured;
    const parser = createParserWorker(silent);
    await expect(parser.parse('X:1\nK:C\nC', 'abc')).rejects.toThrow('worker exploded');
    // The supplied worker is now retired. A second request must use the
    // in-process path rather than posting to a dead worker indefinitely.
    const score = await parser.parse('X:1\nK:C\nD', 'abc');
    expect(scoreNotes(score)).toHaveLength(1);
    parser.dispose();
  });

  it('recreates a factory worker after a runtime error', async () => {
    const failed = fakeWorker();
    const healthy = fakeWorker();
    let calls = 0;
    const parser = createParserWorker(() => (calls++ === 0 ? failed.worker : healthy.worker));

    const pending = parser.parse('X:1\nK:C\nC', 'abc');
    failed.emitError('worker exploded');
    await expect(pending).rejects.toThrow('worker exploded');

    const score = await parser.parse('X:1\nK:C\nD', 'abc');
    expect(scoreNotes(score)).toHaveLength(1);
    expect(calls).toBe(2);
    parser.dispose();
  });

  it('cancels one request, sends a versioned cancel action, and ignores its late response', async () => {
    let onMessage: ((event: {data: ParseResponse}) => void) | undefined;
    const seen: ParseWorkerRequest[] = [];
    let held: ParseRequest | undefined;
    const worker: WorkerLike = {
      postMessage(message) {
        const request = message as ParseWorkerRequest;
        seen.push(request);
        if (request.action === 'cancel') return;
        if (!held) {
          held = request;
          return;
        }
        void handleParseRequest(request).then((response) => onMessage?.({data: response}));
      },
      terminate() {},
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') onMessage = listener as typeof onMessage;
      },
    } as WorkerLike;
    const parser = createParserWorker(worker);
    const controller = new AbortController();

    const cancelled = parser.parse('X:1\nK:C\nC', 'abc', {signal: controller.signal});
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({name: 'AbortError'});

    expect(seen.map((request) => request.action)).toEqual(['parse', 'cancel']);
    expect(seen[0]).toMatchObject({
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
    });
    expect(seen[1]).toMatchObject({
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id: seen[0]?.id,
    });

    // A cancelled request can still finish in a non-preemptible parser. Its
    // response is unknown to the tracker and must not corrupt the next call.
    const lateResponse = await handleParseRequest(held!);
    onMessage?.({data: lateResponse});
    const next = await parser.parse('X:1\nK:C\nD', 'abc');
    expect(scoreNotes(next)).toHaveLength(1);
    parser.dispose();
  });

  it('rejects and retires a worker that responds with another protocol version', async () => {
    let onMessage: ((event: {data: unknown}) => void) | undefined;
    let terminated = false;
    const worker: WorkerLike = {
      postMessage(message) {
        const request = message as ParseRequest;
        queueMicrotask(() =>
          onMessage?.({
            data: {
              protocol: PARSE_WORKER_PROTOCOL,
              protocolVersion: 999,
              id: request.id,
              ok: false,
              error: 'wrong version',
            },
          }),
        );
      },
      terminate() {
        terminated = true;
      },
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') onMessage = listener as typeof onMessage;
      },
    } as WorkerLike;
    const parser = createParserWorker(worker);

    await expect(parser.parse('X:1\nK:C\nC', 'abc')).rejects.toThrow(/incompatible|malformed/);
    expect(terminated).toBe(true);
    parser.dispose();
  });

  it('requires structured error details on v1 failures', async () => {
    let onMessage: ((event: {data: unknown}) => void) | undefined;
    const worker: WorkerLike = {
      postMessage(message) {
        const request = message as ParseRequest;
        queueMicrotask(() =>
          onMessage?.({
            data: {
              protocol: PARSE_WORKER_PROTOCOL,
              protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
              id: request.id,
              ok: false,
              error: 'missing structured detail',
            },
          }),
        );
      },
      terminate() {},
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') onMessage = listener as typeof onMessage;
      },
    } as WorkerLike;
    const parser = createParserWorker(worker);

    await expect(parser.parse('X:1\nK:C\nC', 'abc')).rejects.toThrow(/incompatible|malformed/);
    parser.dispose();
  });

  it('rejects malformed diagnostic payloads instead of casting them', async () => {
    let onMessage: ((event: {data: unknown}) => void) | undefined;
    const worker: WorkerLike = {
      postMessage(message) {
        const request = message as ParseRequest;
        queueMicrotask(() =>
          onMessage?.({
            data: {
              protocol: PARSE_WORKER_PROTOCOL,
              protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
              id: request.id,
              ok: true,
              score: sampleScore().toJSON(),
              diagnostics: 'not-an-array',
            },
          }),
        );
      },
      terminate() {},
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') onMessage = listener as typeof onMessage;
      },
    } as WorkerLike;
    const parser = createParserWorker(worker);

    await expect(parser.parseDetailed('X:1\nK:C\nC', 'abc')).rejects.toThrow(/incompatible|malformed/);
    parser.dispose();
  });

  it('rejects and retires a worker that responds with an unknown request id', async () => {
    let onMessage: ((event: {data: unknown}) => void) | undefined;
    let terminated = false;
    const worker: WorkerLike = {
      postMessage(message) {
        const request = message as ParseRequest;
        queueMicrotask(() =>
          onMessage?.({
            data: {
              protocol: PARSE_WORKER_PROTOCOL,
              protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
              id: request.id + 100,
              ok: true,
              score: sampleScore().toJSON(),
            },
          }),
        );
      },
      terminate() {
        terminated = true;
      },
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') onMessage = listener as typeof onMessage;
      },
    } as WorkerLike;
    const parser = createParserWorker(worker);

    await expect(parser.parse('X:1\nK:C\nC', 'abc')).rejects.toThrow(/unknown request id/);
    expect(terminated).toBe(true);
    parser.dispose();
  });

  it('settles both Worker and URL operations when disposed', async () => {
    const worker: WorkerLike = {
      postMessage() {},
      terminate() {},
      addEventListener() {},
    } as WorkerLike;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const parser = createParserWorker(worker);

    const parsePending = parser.parse('X:1\nK:C\nC', 'abc');
    const urlPending = parser.loadFromUrl('https://example.com/never.mid', 'midi');
    parser.dispose();

    const settled = await Promise.allSettled([parsePending, urlPending]);
    expect(settled).toHaveLength(2);
    for (const result of settled) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({message: expect.stringMatching(/disposed/)});
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
