import {createConnectionLease, type ConnectionLease} from './lease';

// Web Audio coalesces identical connect calls. Shared leases must coalesce too.
const edges = new WeakMap<AudioNode, Map<AudioNode, number>>();
const connecting = new WeakSet<AudioNode>();

function connect(source: AudioNode, destination: AudioNode): ConnectionLease {
  if (connecting.has(source)) throw new Error('Audio connections from the same node cannot re-enter');
  if (!destination || source.context !== destination.context) {
    throw new Error('Audio endpoints must use the same context');
  }
  if (source === destination) throw new Error('An audio output cannot feed itself');
  const visited = new Set<AudioNode>();
  const pending = [destination];
  while (pending.length) {
    const node = pending.pop()!;
    if (node === source) throw new Error('Managed audio connections cannot form a feedback cycle');
    if (visited.has(node)) continue;
    visited.add(node);
    pending.push(...(edges.get(node)?.keys() ?? []));
  }
  const outgoing = edges.get(source) ?? new Map<AudioNode, number>();
  const references = outgoing.get(destination) ?? 0;
  if (references === 0) {
    connecting.add(source);
    try { source.connect(destination); }
    catch (error) {
      // A custom backend can connect before reporting failure. Undo only our attempted edge.
      try { source.disconnect(destination); } catch { /* Preserve the construction failure. */ }
      throw error;
    } finally { connecting.delete(source); }
  }
  outgoing.set(destination, references + 1);
  edges.set(source, outgoing);
  return createConnectionLease(() => {
    const count = outgoing.get(destination) ?? 0;
    if (count > 1) { outgoing.set(destination, count - 1); return; }
    outgoing.delete(destination);
    if (outgoing.size === 0) edges.delete(source);
    source.disconnect(destination);
  });
}

export interface AudioOutputPortOptions {
  id?: string;
  defaultDestination?: AudioNode;
  onCleanupError?: (error: unknown) => void;
}

/** Stable output with one normal route, one replacement claimant and independent taps/sends. */
export class AudioOutputPort {
  readonly id: string;
  readonly node: AudioNode;
  readonly context: BaseAudioContext;
  readonly kind = 'audio' as const;
  readonly direction = 'output' as const;
  readonly #onCleanupError?: (error: unknown) => void;
  readonly #branches = new Set<ConnectionLease>();
  #defaultDestination?: AudioNode;
  #defaultEdge?: ConnectionLease;
  #replacement?: {lease: ConnectionLease; edge: ConnectionLease};
  #disposed = false;
  #editing = false;
  #afterEdit?: () => void;

  constructor(node: AudioNode, options: AudioOutputPortOptions = {}) {
    this.node = node;
    this.context = node.context;
    this.id = options.id ?? 'main';
    this.#onCleanupError = options.onCleanupError;
    if (options.defaultDestination) this.setDefault(options.defaultDestination);
    Object.freeze(this);
  }
  get disposed(): boolean { return this.#disposed; }
  get defaultDestination(): AudioNode | undefined { return this.#defaultDestination; }
  get replaced(): boolean { return this.#replacement !== undefined; }

  setDefault(destination: AudioNode | undefined): void {
    this.#beginEdit();
    try {
      if (destination && destination.context !== this.context) throw new Error('Audio endpoints must use the same context');
      if (destination === this.node) throw new Error('An audio output cannot feed itself');
      if (destination === this.#defaultDestination) return;
      const next = destination && !this.#replacement ? this.#connect(destination) : undefined;
      const previous = this.#defaultEdge;
      this.#defaultDestination = destination;
      this.#defaultEdge = next;
      this.#retire(previous);
    } finally { this.#endEdit(); }
  }

  replace(destination: AudioNode): ConnectionLease {
    this.#beginEdit();
    try {
      if (this.#replacement) throw new Error('The main route already has a replacement claimant');
      const edge = this.#connect(destination);
      const lease = createConnectionLease(() => {
        if (this.#editing && !this.#disposed) {
          this.#afterEdit = () => this.#releaseReplacement(lease);
          return;
        }
        this.#releaseReplacement(lease);
      });
      this.#replacement = {lease, edge};
      const previous = this.#defaultEdge;
      this.#defaultEdge = undefined;
      this.#retire(previous);
      return lease;
    } finally { this.#endEdit(); }
  }

  send(destination: AudioNode): ConnectionLease { return this.#branch(destination); }
  tap(destination: AudioNode): ConnectionLease { return this.#branch(destination); }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#defaultDestination = undefined;
    const normal = this.#defaultEdge;
    this.#defaultEdge = undefined;
    const replacement = this.#replacement;
    this.#retire(normal);
    this.#retire(replacement?.lease);
    if (replacement) this.#releaseReplacement(replacement.lease);
    for (const lease of [...this.#branches]) this.#retire(lease);
    this.#branches.clear();
  }

  #branch(destination: AudioNode): ConnectionLease {
    this.#beginEdit();
    try {
      const edge = this.#connect(destination);
      const lease = createConnectionLease(() => {
        this.#branches.delete(lease);
        this.#retire(edge);
      });
      this.#branches.add(lease);
      return lease;
    } finally { this.#endEdit(); }
  }
  #releaseReplacement(lease: ConnectionLease): void {
    const current = this.#replacement;
    if (!current || current.lease !== lease) return;
    const alreadyEditing = this.#editing;
    this.#editing = true;
    this.#replacement = undefined;
    try {
      // A scope exit clears the current default before releasing admission.
      if (!this.#disposed && this.#defaultDestination) {
        try { this.#defaultEdge = this.#connect(this.#defaultDestination); }
        catch (error) { this.#report(error); }
      }
      this.#retire(current.edge);
    } finally { if (!alreadyEditing) this.#endEdit(); }
  }
  #endEdit(): void {
    this.#editing = false;
    const after = this.#afterEdit;
    this.#afterEdit = undefined;
    after?.();
  }
  #beginEdit(): void {
    this.#assertActive();
    if (this.#editing) throw new Error('Audio port edits cannot re-enter');
    this.#editing = true;
  }
  #connect(destination: AudioNode): ConnectionLease {
    const edge = connect(this.node, destination);
    if (this.#disposed) {
      this.#retire(edge);
      throw new Error('AudioOutputPort was disposed during connection');
    }
    return edge;
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('AudioOutputPort is disposed');
  }
  #retire(lease?: ConnectionLease): void {
    try { lease?.release(); } catch (error) { this.#report(error); }
  }
  #report(error: unknown): void {
    try { this.#onCleanupError?.(error); } catch { /* Complete remaining cleanup. */ }
  }
}
