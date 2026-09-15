// ============================================================================
// @webmusic/score/io parse-worker entry. Exports nothing; when evaluated inside a Web Worker
// (classic or module) it registers a message handler that answers
// `ParseRequest` messages with `ParseResponse`s. Importing this file outside
// a worker (Node, SSR, main thread) is a harmless no-op.
//
// Spawn it with the bundler-friendly pattern:
//   new Worker(new URL('@webmusic/score/io/worker', import.meta.url), {type: 'module'})
// or let `createParserWorker()` from `@webmusic/score/io/worker-client` do it for you.
// ============================================================================

import {dedicatedWorkerScope} from '@webmusic/kernel/worker';
import {
  PARSE_WORKER_PROTOCOL,
  PARSE_WORKER_PROTOCOL_VERSION,
  handleParseRequest,
  type ParseWorkerRequest,
} from './worker-protocol';

const scope = dedicatedWorkerScope();
if (scope) {
  const active = new Map<number, {controller: AbortController; cancelled: boolean}>();
  scope.addEventListener('message', (event) => {
    const request = event.data as ParseWorkerRequest;
    if (request?.action === 'cancel') {
      if (
        request.protocol !== PARSE_WORKER_PROTOCOL ||
        request.protocolVersion !== PARSE_WORKER_PROTOCOL_VERSION
      ) {
        return;
      }
      const operation = active.get(request.id);
      if (operation) {
        operation.cancelled = true;
        operation.controller.abort();
      }
      return;
    }

    const operation = {controller: new AbortController(), cancelled: false};
    const requestId = Number.isSafeInteger(request?.id) && request.id >= 0 ? request.id : -1;
    const previous = active.get(requestId);
    previous?.controller.abort(new Error('Parser worker request id was reused'));
    active.set(requestId, operation);
    void handleParseRequest(request, operation.controller.signal).then((response) => {
      if (active.get(response.id) !== operation) return;
      active.delete(response.id);
      if (!operation.cancelled) scope.postMessage(response);
    });
  });
}

export {};
