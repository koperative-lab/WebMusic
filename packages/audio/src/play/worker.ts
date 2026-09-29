// ============================================================================
// Decode-worker entry. Exports nothing; when evaluated inside a Web Worker
// (classic or module) it registers a message handler that answers
// `DecodeRequest`s with `DecodeResponse`s, transferring the channel buffers
// back zero-copy. Importing this file outside a worker (Node, SSR, main thread)
// is a harmless no-op.
//
// Use `createDecoderWorker()` from `/play/worker-client` to resolve the shipped
// worker asset, or pass it a host-created Worker/factory. A package specifier
// passed to `new URL(specifier, import.meta.url)` resolves as a relative URL,
// not through the package export map.
// ============================================================================

import {dedicatedWorkerScope} from '@webmusic/kernel/worker';
import {handleDecodeRequest, transferablesOf, type DecodeRequest} from './core/worker-protocol';

const scope = dedicatedWorkerScope();
if (scope) {
  scope.addEventListener('message', (event) => {
    void handleDecodeRequest(event.data as DecodeRequest).then((response) => {
      scope.postMessage(response, transferablesOf(response));
    });
  });
}

export {};
