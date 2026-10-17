import {observeModuleContext, observeModuleTarget} from '@webmusic/kernel/element';
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
  let generation = 0;
  let target: ModuleHandle | undefined;
  let port: AudioOutputPort | undefined;
  let tap: ConnectionLease | undefined;
  let analyser: AnalyserNode | undefined;
  let unsubscribe: (() => void) | undefined;
  let stopDiscovery: (() => void) | undefined;
  let preparing = false;
  let initialized = false;
  const current = (revision: number) => active && isCurrent() && generation === revision;
  const clearTap = () => {
    const previousTap = tap;
    const previousAnalyser = analyser;
    tap = undefined; analyser = undefined; port = undefined;
    try { previousTap?.release(); } finally { previousAnalyser?.disconnect(); }
  };
  const dispose = () => {
    if (!active) return;
    active = false; generation++;
    const discovery = stopDiscovery;
    const subscription = unsubscribe;
    stopDiscovery = undefined; unsubscribe = undefined; target = undefined;
    try { discovery?.(); }
    finally { try { subscription?.(); } finally { clearTap(); } }
  };
  const refresh = () => {
    const module = target;
    if (!active || !isCurrent() || !module || preparing) return;
    const revision = generation;
    preparing = true;
    let candidate: AnalyserNode | undefined;
    let lease: ConnectionLease | undefined;
    try {
      const next = module.getPort?.(host.getAttribute('port') ?? 'output');
      if (!current(revision)) return;
      if (!next || next.disposed) {
        clearTap();
        if (current(revision)) update({module});
        return;
      }
      if (next === port) return;
      candidate = next.context.createAnalyser();
      if (!current(revision)) return;
      lease = next.tap(candidate);
      if (!current(revision)) return;
      clearTap();
      if (!current(revision)) return;
      analyser = candidate; tap = lease; port = next;
      candidate = undefined; lease = undefined;
      update({module, analyser});
    } catch (error) {
      if (!current(revision)) return;
      clearTap();
      if (current(revision)) update({module, error});
    } finally {
      try { lease?.release(); } finally { candidate?.disconnect(); }
      if (generation === revision) preparing = false;
      if (!isCurrent()) dispose();
    }
  };
  const attach = (module: ModuleHandle | undefined) => {
    if (!active || !isCurrent()) return;
    if (initialized && target === module) { if (module && !preparing) refresh(); return; }
    initialized = true;
    const revision = ++generation;
    preparing = false;
    const previous = unsubscribe;
    unsubscribe = undefined;
    target = module;
    try { clearTap(); } finally { previous?.(); }
    if (!current(revision)) return;
    update({module});
    if (!current(revision) || !module) return;
    const subscription = module.subscribe?.(() => { refresh(); });
    if (!current(revision)) { subscription?.(); return; }
    unsubscribe = subscription;
    refresh();
  };
  try {
    if (assigned !== undefined) attach(assigned ?? undefined);
    else {
      const discovery = host.hasAttribute('input')
        ? observeModuleTarget(host, host.getAttribute('input') ?? '', attach)
        : observeModuleContext(host, (context) => attach(context?.target));
      if (active && isCurrent()) stopDiscovery = discovery;
      else discovery();
    }
    if (!isCurrent()) dispose();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
