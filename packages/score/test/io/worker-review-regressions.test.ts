import {describe, expect, it, vi} from 'vitest';
import {createParserWorker, type WorkerLike} from '../../src/io/worker-client';
import {PARSE_WORKER_PROTOCOL, PARSE_WORKER_PROTOCOL_VERSION, type ParseRequest} from '../../src/io/worker-protocol';

function controlledWorker() {
  let message: ((event: {data: unknown}) => void) | undefined;
  const requests: ParseRequest[] = [];
  const worker: WorkerLike = {
    postMessage: (request) => { requests.push(request as ParseRequest); },
    terminate: vi.fn(),
    addEventListener(type: string, listener: unknown) {
      if (type === 'message') message = listener as typeof message;
    },
  };
  return {worker, requests, emit: (data: unknown) => message?.({data})};
}

describe('parser worker malformed data and reentrant ownership', () => {
  it('rejects a null diagnostic location as a terminal message without throwing from the listener', async () => {
    const f = controlledWorker();
    const parser = createParserWorker(f.worker);
    const pending = parser.parseDetailed('X:1\nK:C\nC');
    const rejected = expect(pending).rejects.toThrow(/malformed/);
    expect(() => f.emit({
      protocol: PARSE_WORKER_PROTOCOL, protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id: f.requests[0].id, ok: true, score: {},
      diagnostics: [{code: 'test', severity: 'warning', format: 'abc', message: 'test', location: null}],
    })).not.toThrow();
    await rejected;
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    parser.dispose();
  });

  it('terminates a worker returned after its factory synchronously disposes the client', async () => {
    const f = controlledWorker();
    const parser = createParserWorker(() => { parser.dispose(); return f.worker; });
    await expect(parser.parse('X:1\nK:C\nC')).rejects.toThrow(/disposed/);
    expect(f.requests).toHaveLength(0);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    parser.dispose();
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
