// ============================================================================
// Analysis-worker entry. Exports nothing; when evaluated inside a real Web
// Worker (classic or module) it registers a message handler that answers
// `AnalyzeWorkerRequest` messages with `AnalyzeWorkerResponse`s. Importing this
// file outside a worker (Node, SSR, main thread) is a harmless no-op, so the
// pure handler in worker-protocol.ts stays unit-testable everywhere.
//
// Use `createAnalysisWorker()` from `/analyze/worker-client` to resolve the
// shipped worker asset, or pass it a host-created Worker/factory. A package
// specifier in `new URL(specifier, import.meta.url)` is a relative URL, not a
// package export lookup.
// ============================================================================

import {dedicatedWorkerScope} from '@webmusic/kernel/worker';
import {
  createAnalysisWorkerState,
  handleAnalyzeRequest,
  prepareResponseForPost,
  type AnalyzeWorkerRequest,
} from "./api/worker-protocol";
import { createAudioAnalysisSession } from "./headless/session";

const scope = dedicatedWorkerScope();
if (scope) {
  const state = createAnalysisWorkerState(createAudioAnalysisSession);
  scope.addEventListener("message", (event) => {
    void handleAnalyzeRequest(state, event.data as AnalyzeWorkerRequest).then((response) => {
      if (response) {
        const { message, transfer } = prepareResponseForPost(response);
        scope.postMessage(message, transfer);
      }
    });
  });
}

export {};
