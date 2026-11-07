import {assertPortInfo} from './port';
import {assertModuleId, createModuleHandle, type ModuleHandle, type ModulePort} from './registry';

/** One module instance under test and the owner-side cleanup the module itself does not expose. */
export interface ModuleConformanceSubject {
  readonly module: ModuleHandle;
  dispose?(): void | Promise<void>;
}

export interface ModuleConformanceOptions {
  /** Call `prepare()` twice; skip for modules that need a live audio device. Default false. */
  prepare?: boolean;
  /** Create and dispose this many instances. Default 2. */
  repetitions?: number;
  /** When set, every instance must report this module ID. */
  expectedId?: string;
  /** Ports (`family/id`) the module lends but does not own, such as a borrowed transport; they may outlive it. */
  borrowedPorts?: readonly string[];
}

export interface ModuleConformanceFailure {
  readonly check: string;
  readonly message: string;
}

export interface ModuleConformanceReport {
  readonly passed: boolean;
  readonly instances: number;
  readonly failures: readonly ModuleConformanceFailure[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Framework-neutral contract checks for a module factory (DEC-068 MC-20).
 * Each package's tests run it against its module factories; third-party
 * modules can run it too. It reports every failure instead of stopping at the
 * first, and never disposes a borrowed resource the subject did not hand it.
 */
export async function checkModuleConformance(
  create: () => ModuleConformanceSubject | Promise<ModuleConformanceSubject>,
  options: ModuleConformanceOptions = {},
): Promise<ModuleConformanceReport> {
  const failures: ModuleConformanceFailure[] = [];
  const fail = (check: string, error: unknown) => { failures.push(Object.freeze({check, message: message(error)})); };
  const repetitions = options.repetitions ?? 2;
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new RangeError('repetitions must be a positive integer');
  let instances = 0;
  for (let index = 0; index < repetitions; index++) {
    let subject: ModuleConformanceSubject;
    try { subject = await create(); } catch (error) { fail('create', error); continue; }
    instances++;
    const {module} = subject;
    try { assertModuleId(module.id); } catch (error) { fail('id', error); }
    if (options.expectedId !== undefined && module.id !== options.expectedId) {
      fail('id', `Expected module ID ${options.expectedId}, received ${module.id}`);
    }
    try {
      const handle = createModuleHandle(module);
      if (!Object.isFrozen(handle)) fail('handle', 'createModuleHandle must return a frozen view');
      if (handle.params !== module.params || handle.inserts !== module.inserts || handle.capabilities !== module.capabilities) {
        fail('handle', 'Handle getters must delegate to the module');
      }
    } catch (error) { fail('handle', error); }

    let ports: readonly ModulePort[] = [];
    try {
      ports = module.ports?.() ?? [];
      if (!Array.isArray(ports)) throw new TypeError('ports() must return an array');
      const keys = new Set<string>();
      for (const port of ports) {
        try { assertPortInfo(port); } catch (error) { fail(`port:${String(port?.id)}`, error); continue; }
        const key = `${port.family}/${port.direction}/${port.id}`;
        if (keys.has(key)) fail('ports', `Duplicate port ${key}`);
        keys.add(key);
      }
      const again = module.ports?.() ?? [];
      if (again.length !== ports.length || again.some((port, position) => port !== ports[position])) {
        fail('ports', 'ports() must return the same port objects while nothing changed');
      }
      for (const port of ports) {
        if (port.family !== 'audio' || port.direction !== 'output' || !module.getPort) continue;
        const shortcut = module.getPort(port.id);
        if (shortcut !== undefined && shortcut !== port) fail('ports', `getPort(${port.id}) differs from ports()`);
      }
    } catch (error) { fail('ports', error); }

    if (module.subscribe) {
      try {
        const stop = module.subscribe(() => {});
        if (typeof stop !== 'function') throw new TypeError('subscribe() must return an unsubscribe function');
        stop();
        stop();
      } catch (error) { fail('subscribe', error); }
    }

    if (options.prepare && module.prepare) {
      try { await module.prepare(); await module.prepare(); } catch (error) { fail('prepare', error); }
    }

    if (subject.dispose) {
      try { await subject.dispose(); await subject.dispose(); } catch (error) { fail('dispose', error); }
      const borrowed = new Set(options.borrowedPorts ?? []);
      for (const port of ports) {
        if (borrowed.has(`${port.family}/${port.id}`)) continue;
        try {
          if (port.readiness !== 'detached') fail('dispose', `Port ${port.family}/${port.id} is still ${port.readiness} after disposal`);
        } catch (error) { fail('dispose', error); }
      }
    }
  }
  return Object.freeze({passed: failures.length === 0, instances, failures: Object.freeze(failures)});
}
