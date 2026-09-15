import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, scoreNotes} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {serializeMIDI} from '../../src/io/formats/midi';
import {parseMXL, serializeMXL} from '../../src/io/formats/mxl';
import {ScoreInputLimitError, ScoreLoadTimeoutError, loadScore, loadScoreFromUrl} from '../../src/io/load';
import {createParserWorker} from '../../src/io/worker-client';

function sampleScore() {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Piano'});
  builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: new Duration({base: Rational.ONE}),
    voice: VoiceId(`${partId}-v1`),
  });
  return builder.build();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('score source size limits', () => {
  it('rejects oversized binary input before passing it to a format parser', async () => {
    const input = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 0, 0]);

    await expect(loadScore(input, {format: 'midi', maxInputBytes: 8})).rejects.toBeInstanceOf(ScoreInputLimitError);
    await expect(loadScore(input, {format: 'midi', maxInputBytes: 8})).rejects.toThrow(/maxInputBytes/);
  });

  it('uses Content-Length to reject and cancel an oversized download before reading it', async () => {
    const cancel = vi.fn(async () => {});
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(9));
    const response = {
      ok: true,
      headers: {get: (name: string) => (name.toLowerCase() === 'content-length' ? '9' : null)},
      body: {cancel},
      arrayBuffer,
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(loadScoreFromUrl('https://example.com/oversized.mid', {maxInputBytes: 8})).rejects.toThrow(/maxInputBytes/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('counts streamed chunks, cancels at the limit, and never falls back to arrayBuffer()', async () => {
    const cancel = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({done: false, value: new Uint8Array(5)})
        .mockResolvedValueOnce({done: false, value: new Uint8Array(5)}),
      cancel,
      releaseLock,
    };
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(10));
    const response = {
      ok: true,
      headers: {get: () => null},
      body: {getReader: () => reader},
      arrayBuffer,
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(loadScoreFromUrl('https://example.com/chunked.mid', {maxInputBytes: 8})).rejects.toThrow(/maxInputBytes/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('parses a permitted native streamed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(serializeMIDI(sampleScore()) as unknown as BodyInit)));

    const score = await loadScoreFromUrl('https://example.com/permitted.mid', {maxInputBytes: 8 * 1024});
    expect(scoreNotes(score)).toHaveLength(1);
  });

  it('applies the same bounded streaming read to ParserWorker URL loading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(9))));
    const parser = createParserWorker();

    await expect(parser.loadFromUrl('https://example.com/worker.mid', 'midi', {maxInputBytes: 8})).rejects.toThrow(
      /maxInputBytes/,
    );
    parser.dispose();
  });
});

describe('score load cancellation', () => {
  it('rejects a pre-aborted URL load without starting fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadScoreFromUrl('https://example.com/not-started.mid', {signal: controller.signal}),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels an active response reader when the caller aborts', async () => {
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const cancel = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const reader = {
      read: vi.fn(() => {
        markReadStarted?.();
        return new Promise<ReadableStreamReadResult<Uint8Array>>(() => {});
      }),
      cancel,
      releaseLock,
    };
    const response = {
      ok: true,
      headers: {get: () => null},
      body: {getReader: () => reader},
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const controller = new AbortController();

    const pending = loadScoreFromUrl('https://example.com/slow.mid', {signal: controller.signal});
    await readStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('enforces timeoutMs across a fetch that never settles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    const pending = loadScoreFromUrl('https://example.com/never.mid', {timeoutMs: 25});
    const rejection = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);

    const error = await rejection;
    expect(error).toBeInstanceOf(ScoreLoadTimeoutError);
    expect(error).toMatchObject({name: 'ScoreLoadTimeoutError', timeoutMs: 25});
  });

  it('validates timeoutMs before starting work', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadScoreFromUrl('https://example.com/tune.mid', {timeoutMs: 0})).rejects.toThrow(/timeoutMs/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let a non-settling body cancellation hide the load failure', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      body: {cancel},
    } as unknown as Response)));

    await expect(loadScoreFromUrl('https://example.com/unavailable.mid')).rejects.toThrow(/503 Unavailable/);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('MXL archive size limits', () => {
  it('rejects an oversized compressed archive before ZIP metadata is inspected', async () => {
    const archive = serializeMXL(sampleScore());
    const buffer = toArrayBuffer(archive);

    await expect(parseMXL(buffer, {maxArchiveBytes: archive.byteLength - 1})).rejects.toThrow(/maxArchiveBytes/);

    const score = await parseMXL(buffer, {maxArchiveBytes: archive.byteLength});
    expect(scoreNotes(score)).toHaveLength(1);
  });

  it('keeps decompression and ZIP-directory limits configurable', async () => {
    const archive = serializeMXL(sampleScore());
    const buffer = toArrayBuffer(archive);

    await expect(parseMXL(buffer, {maxEntryBytes: 1})).rejects.toThrow(/maxEntryBytes/);
    await expect(parseMXL(buffer, {maxEntries: 1})).rejects.toThrow(/maxEntries/);
    await expect(parseMXL(buffer, {maxPathLength: 5})).rejects.toThrow(/maxPathLength/);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
