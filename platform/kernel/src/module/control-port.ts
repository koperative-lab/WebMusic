import type {ParamSurface} from './parameter';
import type {PortReadiness} from './port';

/** The control family as a port: a borrowed parameter surface and its handles. */
export interface ControlPort {
  readonly id: string;
  readonly family: 'control';
  readonly direction: 'input';
  readonly multiplicity: 'sum';
  readonly schemaVersion: number;
  readonly readiness: PortReadiness;
  readonly params: ParamSurface;
}

/** Expose a module's parameters as its control port. The surface keeps its own owner. */
export function createControlPort(params: ParamSurface, options: {id?: string} = {}): ControlPort {
  return Object.freeze({
    id: options.id ?? 'params',
    family: 'control' as const,
    direction: 'input' as const,
    multiplicity: 'sum' as const,
    schemaVersion: 1,
    get readiness(): PortReadiness {
      return params.handles.length > 0 && params.handles.every(handle => handle.snapshot.disposed) ? 'detached' : 'ready';
    },
    params,
  });
}
