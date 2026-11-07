import {observeModuleInput} from '@webmusic/kernel/element';
import type {AudioOutputPort, ConnectionLease, ModuleHandle} from '@webmusic/kernel/module';

export interface ModuleAudioInput {
  readonly analyser?: AnalyserNode;
  readonly module?: ModuleHandle;
  readonly error?: unknown;
}

/** Borrow a named neutral audio port. Each consumer owns only its tap and analyser. */
export function bindModuleAudioInput(
  host: Element,
  assigned: ModuleHandle | null | undefined,
  update: (input: ModuleAudioInput) => void,
  isCurrent: () => boolean = () => true,
): () => void {
  let active = true;
  let tap: ConnectionLease | undefined;
  let analyser: AnalyserNode | undefined;
  const live = () => active && isCurrent();
  const clearTap = () => {
    const previousTap = tap;
    const previousAnalyser = analyser;
    tap = undefined; analyser = undefined;
    try { previousTap?.release(); } finally { previousAnalyser?.disconnect(); }
  };
  const stop = observeModuleInput(host, {family: 'audio', direction: 'output', port: 'output', assigned, isCurrent}, (state) => {
    if (!live()) return;
    const {module, error} = state;
    const port = state.port as AudioOutputPort | undefined;
    if (error !== undefined || !port) {
      clearTap();
      if (live()) update(error !== undefined ? {module, error} : {module});
      return;
    }
    let candidate: AnalyserNode | undefined;
    let lease: ConnectionLease | undefined;
    try {
      candidate = port.context.createAnalyser();
      if (!live()) return;
      lease = port.tap(candidate);
      if (!live()) return;
      clearTap();
      if (!live()) return;
      analyser = candidate; tap = lease;
      candidate = undefined; lease = undefined;
      update({module, analyser});
    } catch (failure) {
      if (!live()) return;
      clearTap();
      if (live()) update({module, error: failure});
    } finally {
      try { lease?.release(); } finally { candidate?.disconnect(); }
    }
  });
  return () => {
    if (!active) return;
    active = false;
    try { stop(); } finally { clearTap(); }
  };
}
