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
  const clearTap = () => {
    const previousTap = tap;
    const previousAnalyser = analyser;
    tap = undefined; analyser = undefined; port = undefined;
    try { previousTap?.release(); } finally { previousAnalyser?.disconnect(); }
  };
  const refresh = () => {
    const module = target;
    if (!active || !module || preparing) return;
    const revision = generation;
    preparing = true;
    try {
      if (!active || generation !== revision) return;
      const next = module.getPort?.(host.getAttribute('port') ?? 'output');
      if (!next || next.disposed) { clearTap(); update({module}); return; }
      if (next === port) return;
      const candidate = next.context.createAnalyser();
      let lease: ConnectionLease;
      try { lease = next.tap(candidate); }
      catch (error) { candidate.disconnect(); throw error; }
      clearTap();
      analyser = candidate; tap = lease; port = next;
      update({module, analyser});
    } catch (error) {
      if (!active || generation !== revision) return;
      clearTap();
      update({module, error});
    } finally {
      if (generation === revision) preparing = false;
    }
  };
  const attach = (module: ModuleHandle | undefined) => {
    if (!active) return;
    if (initialized && target === module) { if (module && !preparing) void refresh(); return; }
    initialized = true;
    generation++;
    preparing = false;
    unsubscribe?.(); unsubscribe = undefined;
    clearTap();
    target = module;
    update({module});
    if (!active || target !== module || !module) return;
    unsubscribe = module.subscribe?.(() => { void refresh(); });
    void refresh();
  };
  if (assigned !== undefined) attach(assigned ?? undefined);
  else if (host.hasAttribute('input')) {
    const selector = host.getAttribute('input') ?? '';
    stopDiscovery = observeModuleTarget(host, selector, attach);
  } else stopDiscovery = observeModuleContext(host, (context) => attach(context?.target));
  return () => {
    if (!active) return;
    active = false; generation++;
    stopDiscovery?.(); unsubscribe?.(); clearTap();
    target = undefined;
  };
}
