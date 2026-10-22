import {AudioClip, retainedClipPcmBytes} from '../../core/model/AudioClip';
import {makeId} from '../../core/utils/id';
import {AudioEditError, type AudioCheckpoint, type AudioClipboard, type AudioClipEditorPort,
  type AudioDocumentChange, type AudioDocumentSnapshot, type AudioDraftResult, type AudioEditCommand,
  type AudioEditFailure, type AudioEditOperation, type AudioEditResult, type AudioEditTransaction,
  type AudioEditorState, type AudioFrameRange, type AudioInteractionSession, type AudioInteractionSnapshot,
  type AudioPositionStep, type AudioProcessingRequest, type AudioProcessingResult, type AudioRangeProcessor, type AudioRevisionGuard} from '../../core/editing';
import {createAudioPositionMap, mapAudioPosition} from '../../core/audio-position-map';
import {AudioSequenceError, audioSequenceAssetIds, createAudioSequence, createMemoryAudioAssetStore,
  frameInteger, frameRange, readAudioSequenceRange, retainAudioSequence, sameAudioFormat,
  type AudioAssetLease, type AudioAssetReader, type AudioAssetStore, type AudioSequence, type AudioSequenceSegmentInput} from '../../core/sequence';
import {applyAudioOperations, inverseAudioSteps, sameAudioSequence, sliceAudioSegments, snapshotAudioJson, snapshotAudioOperations} from '../core';

export interface AudioClipEditorOptions {
  /** Required with sequence input; borrowed, never disposed by the editor. */
  readonly assets?: AudioAssetReader;
  /** Defaults: 100 transactions and 256 MiB retained solely by history. */
  readonly history?: false | {readonly limit?: number; readonly assetBytes?: number};
  readonly processors?: readonly AudioRangeProcessor[];
  /** Total input + raw processor output allocation budget; default 256 MiB. */
  readonly processingMaxBytes?: number;
  readonly onListenerError?: (error: unknown) => void;
}
interface ContentRoot {readonly contentId: string; readonly content: AudioSequence}
interface HistoryEntry {
  readonly before: ContentRoot; readonly after: ContentRoot; readonly label: string;
  readonly steps: readonly AudioPositionStep[]; readonly lease: AudioAssetLease;
}
interface HistoryPlan {
  readonly undo: HistoryEntry[]; readonly redo: HistoryEntry[];
  readonly pruned: HistoryEntry[]; readonly bytes: number;
}
interface ProcessingJob {readonly controller: AbortController; readonly revision: number; cancelled: boolean; superseded: boolean}

/** One immutable sequence owner; edits retain assets and never clone complete PCM. */
export class AudioClipEditor implements AudioClipEditorPort {
  private snapshot: AudioDocumentSnapshot;
  private publishedSnapshot: AudioDocumentSnapshot;
  private state: AudioEditorState;
  private currentLease: AudioAssetLease;
  private readonly assets: AudioAssetReader;
  private readonly ownedStore?: AudioAssetStore;
  private readonly historyLimit: number;
  private readonly historyByteLimit: number;
  private readonly historyEnabled: boolean;
  private readonly processors: readonly AudioRangeProcessor[];
  private readonly processingMaxBytes: number;
  private readonly onListenerError?: (error: unknown) => void;
  private savedContentId: string;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private trimmedCount = 0;
  private clipboard?: AudioClipboard;
  private readonly checkpoints = new WeakSet<AudioCheckpoint>();
  private readonly sessions = new Set<InteractionSession>();
  private job?: ProcessingJob;
  private busy = false;
  private publishing = false;
  private pending = false;
  private readonly sourceListeners = new Set<(snapshot: AudioDocumentSnapshot) => void>();
  private readonly stateListeners = new Set<(state: AudioEditorState) => void>();

  constructor(input: AudioClip | AudioSequence, options: AudioClipEditorOptions = {}) {
    if (!options || typeof options !== 'object' || (options.history !== undefined && options.history !== false &&
        (!options.history || typeof options.history !== 'object' || Array.isArray(options.history)))) invalid('Invalid editor options');
    this.historyEnabled = options.history !== false;
    this.historyLimit = options.history === false ? 0 : options.history?.limit ?? 100;
    this.historyByteLimit = options.history === false ? 0 : options.history?.assetBytes ?? 256 * 1024 * 1024;
    frameInteger(this.historyLimit, 'history limit'); frameInteger(this.historyByteLimit, 'history asset budget');
    if (this.historyEnabled && !this.historyLimit) invalid('Use history: false to disable history');
    this.processingMaxBytes = options.processingMaxBytes ?? 256 * 1024 * 1024;
    frameInteger(this.processingMaxBytes, 'processing budget');
    this.processors = Object.freeze([...(options.processors ?? [])]);
    const processorIds = new Set<string>();
    for (const processor of this.processors) {
      if (!processor || typeof processor.id !== 'string' || !processor.id || !Number.isSafeInteger(processor.version) || processor.version < 1 ||
          typeof processor.plan !== 'function' || typeof processor.process !== 'function' || processorIds.has(`${processor.id}:${processor.version}`)) invalid('Invalid or duplicate processor');
      processorIds.add(`${processor.id}:${processor.version}`);
    }
    if (options.onListenerError !== undefined && typeof options.onListenerError !== 'function') invalid('onListenerError must be a function');
    this.onListenerError = options.onListenerError;
    let sequence: AudioSequence;
    if ('hasSamples' in input) {
      if (options.assets) invalid('Clip input creates its own store; use sequence input with borrowed assets');
      this.ownedStore = createMemoryAudioAssetStore(); this.assets = this.ownedStore;
      const imported = this.ownedStore.registerClip(input);
      try {
        const descriptor = this.assets.getDescriptor(imported.assetIds[0])!;
        sequence = createAudioSequence({...descriptor, segments: [{kind: 'asset', id: makeId('segment'), assetId: descriptor.id,
          sourceStart: 0, sourceEnd: descriptor.length, gain: 1, envelope: []}]}, this.assets);
        this.currentLease = retainAudioSequence(sequence, this.assets);
      } finally {this.releaseAsset(imported);}
    } else {
      if (!options.assets) invalid('Sequence input requires an asset reader');
      this.assets = options.assets;
      sequence = createAudioSequence(input, this.assets);
      if (input.length !== sequence.length) invalid('Sequence length does not match segments');
      this.currentLease = retainAudioSequence(sequence, this.assets);
    }
    this.snapshot = Object.freeze({documentId: makeId('audio-document'), documentRevision: 0,
      contentId: makeId('audio-content'), content: sequence, assets: this.assets, status: 'ready'});
    this.publishedSnapshot = this.snapshot;
    this.savedContentId = this.snapshot.contentId;
    this.state = this.makeState(0);
  }
  get sequence(): AudioSequence {return this.snapshot.content;}
  getSnapshot(): AudioDocumentSnapshot {return this.snapshot;}
  getState(): AudioEditorState {return this.state;}
  subscribe(listener: (snapshot: AudioDocumentSnapshot) => void): () => void {return this.listen(this.sourceListeners, listener, this.snapshot);}
  subscribeState(listener: (state: AudioEditorState) => void): () => void {return this.listen(this.stateListeners, listener, this.state);}

  execute(command: AudioEditCommand): AudioEditResult {
    return this.run(() => {
      const captured = snapshotAudioJson(command) as AudioEditCommand;
      if (!captured || captured.version !== 1 || typeof captured.label !== 'string' ||
          Object.keys(captured).some((key) => !['version', 'documentId', 'expectedRevision', 'label', 'operations'].includes(key))) invalid('Invalid command envelope');
      this.checkGuard(captured);
      const result = applyAudioOperations(this.sequence, this.assets, captured.operations);
      return this.acceptEdit(result.content, captured.label, result.operations, result.steps);
    });
  }
  transaction(label: string, build: (transaction: AudioEditTransaction) => void, guard?: AudioRevisionGuard): AudioEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (typeof label !== 'string' || typeof build !== 'function') invalid('Transaction requires a label and callback');
      const operations: AudioEditOperation[] = [];
      let open = true;
      const builder = Object.freeze({add: (operation: AudioEditOperation) => {
        if (!open) throw new AudioEditError('transaction-aborted', 'Transaction callback has returned');
        operations.push(...snapshotAudioOperations([operation]));
      }});
      try {
        const returned: unknown = build(builder);
        if (returned && (typeof returned === 'object' || typeof returned === 'function') && 'then' in returned && typeof returned.then === 'function') {
          void Promise.resolve(returned).catch(() => {});
          throw new AudioEditError('transaction-aborted', 'Transactions cannot cross await');
        }
      } catch (error) {throw error instanceof AudioEditError ? error : new AudioEditError('transaction-aborted', String(error));}
      finally {open = false;}
      this.assertAlive();
      const result = applyAudioOperations(this.sequence, this.assets, operations);
      return this.acceptEdit(result.content, label, result.operations, result.steps);
    });
  }
  undo(guard?: AudioRevisionGuard): AudioEditResult {return this.travel('undo', guard);}
  redo(guard?: AudioRevisionGuard): AudioEditResult {return this.travel('redo', guard);}
  markSaved(): void {this.assertWritable(); if (this.savedContentId !== this.snapshot.contentId) {this.savedContentId = this.snapshot.contentId; this.refresh();}}
  clearHistory(): void {
    this.assertWritable(); this.busy = true;
    try {this.releaseHistory(); this.refresh();} finally {this.busy = false;}
  }
  createCheckpoint(): AudioCheckpoint {
    this.assertAlive();
    const snapshot = this.snapshot;
    const lease = retainAudioSequence(snapshot.content, this.assets);
    try {this.assertAlive();} catch (error) {this.releaseAsset(lease); throw error;}
    const checkpoint = Object.freeze({documentId: snapshot.documentId, contentId: snapshot.contentId,
      content: snapshot.content, assetIds: lease.assetIds, get released() {return lease.released;}, release: () => this.releaseAsset(lease)});
    this.checkpoints.add(checkpoint); return checkpoint;
  }
  restoreCheckpoint(checkpoint: AudioCheckpoint, guard?: AudioRevisionGuard): AudioEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (!checkpoint || !this.checkpoints.has(checkpoint) || checkpoint.released || checkpoint.documentId !== this.snapshot.documentId) {
        throw new AudioEditError('invalid-checkpoint', 'Checkpoint must be live and issued by this editor');
      }
      if (checkpoint.contentId === this.snapshot.contentId) return this.noop();
      createAudioSequence(checkpoint.content, this.assets);
      const lease = retainAudioSequence(checkpoint.content, this.assets);
      try {this.assertAlive();} catch (error) {this.releaseAsset(lease); throw error;}
      return this.commit(checkpoint, lease, 'restore', 'Restore checkpoint', [], [{type: 'reset', length: checkpoint.content.length}], [], []);
    });
  }
  createInteractionSession(): AudioInteractionSession {
    this.assertWritable();
    const session = new InteractionSession(this, (value) => this.sessions.delete(value), (error) => this.report(error));
    this.sessions.add(session); return session;
  }
  copy(range: AudioFrameRange): AudioClipboard {
    this.assertWritable(); this.busy = true;
    let internal: AudioClipboard | undefined, external: AudioClipboard | undefined;
    try {
      const content = this.selectionContent(range);
      internal = this.makeClipboard(content); external = this.makeClipboard(content); this.assertAlive();
      this.releaseAsset(this.clipboard); this.assertAlive(); this.clipboard = internal; this.refresh(); return external;
    } catch (error) {this.releaseAsset(internal); this.releaseAsset(external); throw error;}
    finally {this.busy = false;}
  }
  cut(range: AudioFrameRange, guard?: AudioRevisionGuard): AudioEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      const content = this.selectionContent(range);
      const clipboard = this.makeClipboard(content);
      try {
        const operations: AudioEditOperation[] = [{type: 'splice', startFrame: range.startFrame,
          deleteCount: range.endFrame - range.startFrame, segments: [], rightId: makeId('segment')}];
        const result = applyAudioOperations(this.sequence, this.assets, operations);
        const previous = this.clipboard; this.clipboard = clipboard;
        try {const outcome = this.acceptEdit(result.content, 'Cut audio', result.operations, result.steps); this.releaseAsset(previous); this.refresh(); return outcome;}
        catch (error) {
          if (this.snapshot.status === 'disposed') this.releaseAsset(previous);
          else this.clipboard = previous;
          throw error;
        }
      } catch (error) {this.releaseAsset(clipboard); throw error;}
    });
  }
  paste(frame: number, options: {readonly segmentIds?: readonly string[]; readonly rightId?: string} = {}, guard?: AudioRevisionGuard): AudioEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (!this.clipboard) throw new AudioEditError('clipboard-empty', 'Clipboard is empty');
      if (!sameAudioFormat(this.sequence, this.clipboard.content)) throw new AudioEditError('incompatible-audio-format', 'Clipboard format must match the document');
      if (options.segmentIds && options.segmentIds.length !== this.clipboard.content.segments.length) invalid('Paste requires one ID per clipboard segment');
      const segments = this.clipboard.content.segments.map((segment, index) => ({...segment, id: options.segmentIds?.[index] ?? makeId('segment')}));
      const operations: AudioEditOperation[] = [{type: 'splice', startFrame: frame, deleteCount: 0,
        segments, annotations: this.clipboard.content.annotations.map((annotation) => ({...annotation, id: makeId('annotation')})),
        rightId: options.rightId ?? makeId('segment')}];
      const result = applyAudioOperations(this.sequence, this.assets, operations);
      return this.acceptEdit(result.content, 'Paste audio', result.operations, result.steps);
    });
  }
  clearClipboard(): void {
    this.assertWritable(); this.busy = true;
    try {
      const clipboard = this.clipboard; this.clipboard = undefined;
      this.releaseAsset(clipboard); this.refresh();
    } finally {this.busy = false;}
  }

  /** The only edit operation that materializes PCM; the caller explicitly selects its bounded range. */
  async processRange(request: AudioProcessingRequest, options: {readonly signal?: AbortSignal} = {}): Promise<AudioProcessingResult> {
    let job: ProcessingJob | undefined;
    let inputLease: AudioAssetLease | undefined;
    let outputLease: AudioAssetLease | undefined;
    let removeAbort: (() => void) | undefined;
    let ownsBusy = false;
    try {
      this.assertWritable();
      const captured = snapshotAudioJson(request) as AudioProcessingRequest;
      this.checkGuard(captured);
      if (this.job) throw new AudioEditError('processing-busy', 'Only one materializing job may run per editor');
      const base = this.snapshot, rangeLength = captured.endFrame - captured.startFrame;
      frameRange(captured.startFrame, rangeLength, base.content.length);
      if (!rangeLength || typeof captured.assetId !== 'string' || !captured.assetId ||
          typeof captured.segmentId !== 'string' || !captured.segmentId) invalid('Processing requires a nonempty range and fixed output IDs');
      if (captured.tailPolicy !== undefined && !['trim', 'extend'].includes(captured.tailPolicy)) invalid('Invalid tail policy');
      const processor = this.processors.find((value) => value.id === captured.processorId && value.version === captured.processorVersion);
      if (!processor) throw new AudioEditError('unsupported-processor', 'Unknown processor ID/version');
      const store = this.ownedStore ?? this.asStore(this.assets);
      if (options.signal?.aborted) return Object.freeze({status: 'cancelled'});
      job = {controller: new AbortController(), revision: base.documentRevision, cancelled: false, superseded: false};
      this.job = job;
      const currentJob = job;
      const abort = () => {currentJob.cancelled = true; currentJob.controller.abort();};
      options.signal?.addEventListener('abort', abort, {once: true});
      removeAbort = () => options.signal?.removeEventListener('abort', abort);
      // External planning/read adapters cannot nest a command in preparation.
      this.busy = true; ownsBusy = true;
      const plan = snapshotAudioJson(processor.plan({rangeLength, sampleRate: base.content.sampleRate, channelLayout: base.content.channelLayout,
        parameters: captured.parameters, tailPolicy: captured.tailPolicy ?? 'trim'})) as ReturnType<AudioRangeProcessor['plan']>;
      this.assertAlive(); this.checkGuard(captured);
      for (const key of ['inputBefore', 'inputAfter', 'outputLength', 'latencyFrames', 'tailFrames'] as const) frameInteger(plan[key], key);
      const start = Math.max(0, captured.startFrame - plan.inputBefore);
      const end = Math.min(base.content.length, captured.endFrame + plan.inputAfter);
      const outputLength = rangeLength + (captured.tailPolicy === 'extend' ? plan.tailFrames : 0);
      if (plan.outputLength !== plan.latencyFrames + rangeLength + plan.tailFrames) invalid('Processor output must declare latency, selected length and tail');
      const splice = (segment: AudioSequenceSegmentInput): AudioEditOperation => ({type: 'splice', startFrame: captured.startFrame,
        deleteCount: rangeLength, segments: [segment], ...(captured.rightId ? {rightId: captured.rightId} : {})});
      // Registering output retires its asset ID; reject range/ID/rightId failures with a placeholder before DSP.
      applyAudioOperations(base.content, this.assets, [splice({kind: 'silence', id: captured.segmentId, length: outputLength})]);
      if (store.getDescriptor(captured.assetId)) throw new AudioEditError('duplicate-id', `Asset ID already identifies stored PCM: ${captured.assetId}`);
      this.assertAlive(); this.checkGuard(captured);
      const bytes = (end - start + plan.outputLength) * base.content.channelLayout.length * 4;
      if (!Number.isSafeInteger(bytes) || bytes > this.processingMaxBytes) throw new AudioEditError('resource-limit', 'Processing exceeds its allocation budget');
      if (job.superseded || job.cancelled) return Object.freeze({status: job.superseded ? 'superseded' : 'cancelled'});
      inputLease = retainAudioSequence(base.content, this.assets);
      this.assertAlive(); this.checkGuard(captured);
      const channels = base.content.channelLayout.map(() => new Float32Array(end - start));
      readAudioSequenceRange(base.content, this.assets, start, channels);
      this.assertAlive(); this.checkGuard(captured);
      this.busy = false; ownsBusy = false;
      this.refresh();
      if (job.superseded || job.cancelled) return Object.freeze({status: job.superseded ? 'superseded' : 'cancelled'});
      const output = await processor.process({channels, sampleRate: base.content.sampleRate,
        selectionOffset: captured.startFrame - start, selectionLength: rangeLength, parameters: captured.parameters, signal: job.controller.signal});
      if (job.superseded || this.snapshot.status === 'disposed' || this.snapshot.documentRevision !== job.revision) return Object.freeze({status: 'superseded'});
      if (job.cancelled || options.signal?.aborted) return Object.freeze({status: 'cancelled'});
      if (!output?.hasSamples || output.length !== plan.outputLength || output.sampleRate !== base.content.sampleRate ||
          output.numberOfChannels !== base.content.channelLayout.length) throw new AudioEditError('processing-failed', 'Processor output does not match its declared length/format');
      this.busy = true; ownsBusy = true;
      const retainedOutputBytes = (end - start) * base.content.channelLayout.length * 4 + retainedClipPcmBytes(output);
      if (!Number.isSafeInteger(retainedOutputBytes) || retainedOutputBytes > this.processingMaxBytes) throw new AudioEditError('resource-limit', 'Processor output backing exceeds its allocation budget');
      this.assertAlive(); this.checkGuard(captured);
      outputLease = store.registerClip(output, {id: captured.assetId, channelLayout: base.content.channelLayout});
      this.assertAlive(); this.checkGuard(captured);
      this.busy = false; ownsBusy = false;
      if (job.superseded || job.cancelled) return Object.freeze({status: job.superseded ? 'superseded' : 'cancelled'});
      // The command history stores the materialized result, never processor callbacks.
      this.job = undefined;
      return this.execute({version: 1, documentId: captured.documentId, expectedRevision: captured.expectedRevision,
        label: captured.label ?? `Process ${captured.processorId}`, operations: [splice({kind: 'asset', id: captured.segmentId,
          assetId: captured.assetId, sourceStart: plan.latencyFrames, sourceEnd: plan.latencyFrames + outputLength, gain: 1, envelope: []})]});
    } catch (error) {
      if (job?.superseded) return Object.freeze({status: 'superseded'});
      if (job?.cancelled || options.signal?.aborted) return Object.freeze({status: 'cancelled'});
      return failure(error);
    } finally {
      if (ownsBusy) this.busy = false;
      removeAbort?.(); this.releaseAsset(inputLease); this.releaseAsset(outputLease);
      if (job && this.job === job) this.job = undefined;
      if (job && this.snapshot.status !== 'disposed') this.refresh();
    }
  }
  cancelProcessing(): void {if (this.job) {this.job.cancelled = true; this.job.controller.abort();}}
  dispose(): void {
    if (this.snapshot.status === 'disposed') return;
    // Abort and lease cleanup may synchronously reenter the owner.
    const history = [...this.undoStack, ...this.redoStack], clipboard = this.clipboard;
    this.undoStack = []; this.redoStack = []; this.clipboard = undefined;
    this.snapshot = Object.freeze({...this.snapshot, status: 'disposed'});
    this.state = this.makeState(0);
    this.supersedeJob();
    for (const entry of history) this.releaseAsset(entry.lease);
    this.releaseAsset(clipboard);
    this.releaseAsset(this.currentLease); this.ownedStore?.dispose();
    this.state = this.makeState(0);
    for (const session of [...this.sessions]) session.dispose();
    this.publish();
  }
  private selectionContent(range: AudioFrameRange): AudioSequence {
    if (!range || typeof range !== 'object') invalid('Selection requires a frame range');
    frameRange(range.startFrame, range.endFrame - range.startFrame, this.sequence.length);
    const annotations = this.sequence.annotations.flatMap((annotation) => {
      if (annotation.endFrame === undefined) return annotation.startFrame >= range.startFrame && annotation.startFrame < range.endFrame ?
        [{...annotation, startFrame: annotation.startFrame - range.startFrame}] : [];
      const startFrame = Math.max(annotation.startFrame, range.startFrame), endFrame = Math.min(annotation.endFrame, range.endFrame);
      return endFrame > startFrame ? [{...annotation, startFrame: startFrame - range.startFrame, endFrame: endFrame - range.startFrame}] : [];
    });
    return createAudioSequence({...this.sequence, segments: sliceAudioSegments(this.sequence, range.startFrame, range.endFrame), annotations}, this.assets);
  }
  private makeClipboard(content: AudioSequence): AudioClipboard {
    const lease = retainAudioSequence(content, this.assets);
    return Object.freeze({content, assets: this.assets, assetIds: lease.assetIds,
      get released() {return lease.released;}, release: () => this.releaseAsset(lease)});
  }
  private asStore(reader: AudioAssetReader): AudioAssetStore {
    if (typeof (reader as Partial<AudioAssetStore>).registerClip !== 'function') throw new AudioEditError('unsupported-processor', 'Processing requires a writable asset store');
    return reader as AudioAssetStore;
  }
  private travel(direction: 'undo' | 'redo', guard?: AudioRevisionGuard): AudioEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (!this.historyEnabled) throw new AudioEditError('history-disabled', 'History is disabled');
      const source = direction === 'undo' ? this.undoStack : this.redoStack;
      const target = direction === 'undo' ? this.redoStack : this.undoStack;
      const entry = source[source.length - 1]; if (!entry) return this.noop();
      const root = direction === 'undo' ? entry.before : entry.after;
      const lease = retainAudioSequence(root.content, this.assets);
      try {this.assertAlive();} catch (error) {this.releaseAsset(lease); throw error;}
      const remaining = source.slice(0, -1), moved = [...target, entry];
      return this.commit(root, lease, direction, entry.label, [], direction === 'undo' ? inverseAudioSteps(entry.steps) : entry.steps,
        direction === 'undo' ? remaining : moved, direction === 'undo' ? moved : remaining);
    });
  }
  private acceptEdit(content: AudioSequence, label: string, operations: readonly AudioEditOperation[], steps: readonly AudioPositionStep[]): AudioEditResult {
    this.assertAlive(); if (sameAudioSequence(content, this.sequence)) return this.noop();
    const root = Object.freeze({contentId: makeId('audio-content'), content});
    const lease = retainAudioSequence(content, this.assets);
    let history: HistoryEntry | undefined;
    try {
      this.assertAlive();
      if (this.historyEnabled) history = {before: this.snapshot, after: root, label, steps,
        lease: this.assets.retain([...audioSequenceAssetIds(this.sequence), ...audioSequenceAssetIds(content)])};
      this.assertAlive();
    } catch (error) {this.releaseAsset(history?.lease); this.releaseAsset(lease); throw error;}
    return this.commit(root, lease, 'edit', label, operations, steps, history ? [...this.undoStack, history] : this.undoStack, []);
  }
  private commit(root: ContentRoot, lease: AudioAssetLease, origin: AudioDocumentChange['origin'], label: string,
    operations: readonly AudioEditOperation[], steps: readonly AudioPositionStep[], undo: HistoryEntry[], redo: HistoryEntry[]): AudioEditResult {
    const fromRevision = this.snapshot.documentRevision, toRevision = fromRevision + 1;
    const previous = new Set([...this.undoStack, ...this.redoStack]), next = new Set([...undo, ...redo]);
    const added = [...next].filter((entry) => !previous.has(entry));
    const discarded = [...previous].filter((entry) => !next.has(entry));
    let plan: HistoryPlan;
    let change: AudioDocumentChange;
    try {
      this.assertAlive();
      if (!Number.isSafeInteger(toRevision)) invalid('Revision limit exceeded');
      change = Object.freeze({origin, label, fromRevision, toRevision, operations: Object.freeze([...operations]),
        affectedRanges: Object.freeze([{startFrame: 0, endFrame: Math.max(this.sequence.length, root.content.length)}]),
        positionMap: createAudioPositionMap(this.snapshot.documentId, fromRevision, toRevision, steps)});
      // Account for the future ownership graph before mutating content or history.
      // A failed adapter read must leave the old root and redo branch available.
      plan = this.planHistory(undo, redo, [this.currentLease, ...discarded.map((entry) => entry.lease)]);
      this.assertAlive();
      this.undoStack = this.undoStack.filter((entry) => next.has(entry));
      this.redoStack = this.redoStack.filter((entry) => next.has(entry));
      for (const entry of discarded) this.releaseAsset(entry.lease);
      this.assertAlive();
      this.supersedeJob();
      this.assertAlive();
    } catch (error) {for (const entry of added) this.releaseAsset(entry.lease); this.releaseAsset(lease); throw error;}
    const snapshot: AudioDocumentSnapshot = Object.freeze({documentId: this.snapshot.documentId, documentRevision: toRevision,
      contentId: root.contentId, content: root.content, assets: this.assets, status: 'ready', change});
    const old = this.currentLease; this.currentLease = lease; this.snapshot = snapshot;
    this.undoStack = plan.undo; this.redoStack = plan.redo; this.trimmedCount += plan.pruned.length;
    this.state = this.makeState(plan.bytes);
    this.releaseAsset(old);
    for (const entry of plan.pruned) this.releaseAsset(entry.lease);
    this.updateHistoryState();
    for (const session of [...this.sessions]) session.documentChanged(change);
    this.publish(); return Object.freeze({status: 'committed', snapshot, change});
  }
  private planHistory(undo: readonly HistoryEntry[], redo: readonly HistoryEntry[], retiring: readonly AudioAssetLease[] = []): HistoryPlan {
    const plannedUndo = [...undo], plannedRedo = [...redo], pruned: HistoryEntry[] = [];
    const references = new Map<string, number>();
    const retired = new Map<string, number>();
    for (const entry of [...undo, ...redo]) for (const id of entry.lease.assetIds) references.set(id, (references.get(id) ?? 0) + 1);
    for (const lease of retiring) for (const id of lease.assetIds) retired.set(id, (retired.get(id) ?? 0) + 1);
    const historyOnly = new Map<string, number>();
    for (const [id, count] of references) {
      const total = this.assets.getReferenceCount(id); this.assertAlive(); frameInteger(total, 'asset reference count');
      const remaining = total - (retired.get(id) ?? 0);
      if (remaining < count) invalid('Asset reference count disagrees with retained history');
      if (remaining === count) {
        const descriptor = this.assets.getDescriptor(id); this.assertAlive();
        if (!descriptor) throw new AudioSequenceError('unknown-asset', `Unknown retained history asset: ${id}`);
        frameInteger(descriptor.byteLength, 'asset byte length'); historyOnly.set(id, descriptor.byteLength);
      }
    }
    const measure = () => [...historyOnly].reduce((bytes, [id, size]) => bytes + ((references.get(id) ?? 0) > 0 ? size : 0), 0);
    let bytes = measure();
    while (plannedUndo.length + plannedRedo.length > this.historyLimit || bytes > this.historyByteLimit) {
      const entry = (plannedUndo.length ? plannedUndo : plannedRedo).shift(); if (!entry) break;
      pruned.push(entry);
      for (const id of entry.lease.assetIds) references.set(id, references.get(id)! - 1);
      bytes = measure();
    }
    return {undo: plannedUndo, redo: plannedRedo, pruned, bytes};
  }
  private updateHistoryState(): void {
    if (this.snapshot.status === 'disposed') {this.state = this.makeState(0); return;}
    try {
      while (true) {
        const plan = this.planHistory(this.undoStack, this.redoStack);
        this.assertAlive();
        this.undoStack = plan.undo; this.redoStack = plan.redo; this.trimmedCount += plan.pruned.length;
        this.state = this.makeState(plan.bytes);
        for (const entry of plan.pruned) this.releaseAsset(entry.lease);
        if (!plan.pruned.length || this.getSnapshot().status === 'disposed') return;
      }
    } catch (error) {
      if (this.getSnapshot().status === 'disposed') return;
      // Cleanup callbacks can change accounting after adoption. Preserve that
      // committed root, but never retain history whose budget cannot be verified.
      const entries = [...this.undoStack, ...this.redoStack]; this.undoStack = []; this.redoStack = [];
      this.trimmedCount += entries.length; this.state = this.makeState(0);
      this.report(error);
      for (const entry of entries) this.releaseAsset(entry.lease);
    }
  }
  private releaseHistory(): void {
    const entries = [...this.undoStack, ...this.redoStack]; this.undoStack = []; this.redoStack = [];
    for (const entry of entries) this.releaseAsset(entry.lease);
  }
  private supersedeJob(): void {if (this.job) {this.job.superseded = true; this.job.controller.abort();}}
  private checkGuard(guard?: AudioRevisionGuard): void {
    if (guard === undefined) return;
    if (!guard || typeof guard !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(guard)) ||
        ['documentId', 'expectedRevision'].some((key) => {const data = Object.getOwnPropertyDescriptor(guard, key); return !data || !('value' in data) || !data.enumerable;})) invalid('Revision guards require plain own data properties');
    if (typeof guard.documentId !== 'string' || !Number.isSafeInteger(guard.expectedRevision) || guard.expectedRevision < 0) invalid('Invalid revision guard');
    if (guard.documentId !== this.snapshot.documentId) throw new AudioEditError('document-mismatch', 'Command targets another document');
    if (guard.expectedRevision !== this.snapshot.documentRevision) throw new AudioEditError('revision-conflict', 'Command revision is stale');
  }
  private assertAlive(): void {if (this.snapshot.status === 'disposed') throw new AudioEditError('disposed', 'Editor is disposed');}
  private assertWritable(): void {this.assertAlive(); if (this.busy || this.publishing) throw new AudioEditError('reentrant-command', 'Commands cannot nest or run during publication');}
  private run(action: () => AudioEditResult): AudioEditResult {
    try {this.assertWritable();} catch (error) {return failure(error);}
    this.busy = true; try {return action();} catch (error) {return failure(error);} finally {this.busy = false;}
  }
  private noop(): AudioEditResult {return Object.freeze({status: 'noop', snapshot: this.snapshot});}
  private makeState(historyOnlyBytes: number): AudioEditorState {
    return Object.freeze({document: this.snapshot, dirty: this.snapshot.contentId !== this.savedContentId,
      history: Object.freeze({enabled: this.historyEnabled, limit: this.historyLimit, assetByteLimit: this.historyByteLimit,
        historyOnlyBytes: this.snapshot.status === 'disposed' ? 0 : historyOnlyBytes, undoCount: this.undoStack.length, redoCount: this.redoStack.length,
        trimmedCount: this.trimmedCount, canUndo: this.snapshot.status === 'ready' && this.undoStack.length > 0,
        canRedo: this.snapshot.status === 'ready' && this.redoStack.length > 0}),
      clipboard: Object.freeze({length: this.clipboard?.content.length ?? 0, hasContent: Boolean(this.clipboard?.content.length)}),
      processing: this.snapshot.status !== 'disposed' && Boolean(this.job)});
  }
  private refresh(): void {
    const previous = this.busy; this.busy = true;
    try {this.updateHistoryState(); this.publish();} finally {this.busy = previous;}
  }
  private listen<T>(set: Set<(value: T) => void>, listener: (value: T) => void, value: T): () => void {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (this.snapshot.status !== 'disposed') set.add(listener);
    const previous = this.publishing; this.publishing = true;
    this.call(listener, value); this.publishing = previous;
    if (!previous && this.pending) this.publish();
    return () => {set.delete(listener);};
  }
  private publish(): void {
    this.pending = true; if (this.publishing) return; this.publishing = true;
    try {
      while (this.pending) {
        this.pending = false;
        const snapshot = this.snapshot, state = this.state;
        if (snapshot !== this.publishedSnapshot) {
          this.publishedSnapshot = snapshot;
          for (const listener of [...this.sourceListeners]) {
            if (snapshot !== this.snapshot) break;
            if (this.sourceListeners.has(listener)) this.call(listener, snapshot);
          }
        }
        for (const listener of [...this.stateListeners]) {
          if (state !== this.state) break;
          if (this.stateListeners.has(listener)) this.call(listener, state);
        }
      }
    } finally {this.publishing = false; if (this.snapshot.status === 'disposed') {this.sourceListeners.clear(); this.stateListeners.clear();}}
  }
  private call<T>(listener: (value: T) => void, value: T): void {try {listener(value);} catch (error) {this.report(error);}}
  private releaseAsset(lease?: AudioAssetLease): void {try {lease?.release();} catch (error) {this.report(error);}}
  private report(error: unknown): void {try {if (this.onListenerError) this.onListenerError(error); else console.error('AudioClipEditor subscriber failed', error);} catch { /* Error reporting cannot roll back a commit. */ }}
}
export function createAudioClipEditor(input: AudioClip | AudioSequence, options?: AudioClipEditorOptions): AudioClipEditor {return new AudioClipEditor(input, options);}
function invalid(message: string): never {throw new AudioEditError('invalid-command', message);}
function failure(error: unknown): AudioEditFailure {
  return Object.freeze({status: 'failed', error: error instanceof AudioEditError ? error : error instanceof AudioSequenceError ?
    new AudioEditError(error.code, error.message) : new AudioEditError('invalid-command', error instanceof Error ? error.message : String(error))});
}

class InteractionSession implements AudioInteractionSession {
  private snapshot: AudioInteractionSnapshot;
  private readonly listeners = new Set<(snapshot: AudioInteractionSnapshot) => void>();
  private draftLease?: AudioAssetLease;
  private busy = false;
  private publishing = false;
  private pending = false;
  constructor(private readonly editor: AudioClipEditor, private readonly release: (session: InteractionSession) => void,
    private readonly report: (error: unknown) => void) {
    this.snapshot = Object.freeze({documentId: editor.getSnapshot().documentId, selection: Object.freeze({startFrame: 0, endFrame: 0}), disposed: false});
  }
  getSnapshot(): AudioInteractionSnapshot {return this.snapshot;}
  subscribe(listener: (snapshot: AudioInteractionSnapshot) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (!this.snapshot.disposed) this.listeners.add(listener);
    const previous = this.publishing; this.publishing = true; this.call(listener, this.snapshot); this.publishing = previous;
    if (!previous && this.pending) this.publish();
    return () => {this.listeners.delete(listener);};
  }
  setSelection(range: AudioFrameRange): void {
    this.assertWritable(); this.busy = true;
    try {
      frameRange(range.startFrame, range.endFrame - range.startFrame, this.editor.sequence.length);
      this.assertAlive();
      this.snapshot = Object.freeze({...this.snapshot, selection: Object.freeze({startFrame: range.startFrame, endFrame: range.endFrame})}); this.publish();
    } finally {this.busy = false;}
  }
  preview(operations: readonly AudioEditOperation[]): AudioDraftResult {
    let lease: AudioAssetLease | undefined;
    let ownsBusy = false;
    try {
      this.assertWritable(); this.busy = true; ownsBusy = true;
      const base = this.editor.getSnapshot(), result = applyAudioOperations(base.content, base.assets, operations);
      this.assertAlive();
      if (this.editor.getSnapshot().documentRevision !== base.documentRevision) throw new AudioEditError('revision-conflict', 'Draft was superseded');
      lease = retainAudioSequence(result.content, base.assets);
      this.assertAlive();
      if (this.editor.getSnapshot().documentRevision !== base.documentRevision) throw new AudioEditError('revision-conflict', 'Draft was superseded');
      // Install ownership before retiring the old lease: cleanup may dispose
      // this session or invalidate it through a newer document revision.
      const previous = this.draftLease; this.draftLease = lease; lease = undefined;
      this.snapshot = Object.freeze({...this.snapshot, draft: Object.freeze({documentRevision: base.documentRevision, content: result.content, operations: result.operations})});
      this.releaseAsset(previous); this.assertAlive();
      if (this.editor.getSnapshot().documentRevision !== base.documentRevision) throw new AudioEditError('revision-conflict', 'Draft was superseded');
      this.publish(); this.assertAlive();
      if (this.editor.getSnapshot().documentRevision !== base.documentRevision) throw new AudioEditError('revision-conflict', 'Draft was superseded');
      return Object.freeze({status: 'preview', snapshot: this.snapshot});
    } catch (error) {return failure(error);}
    finally {this.releaseAsset(lease); if (ownsBusy) this.busy = false;}
  }
  commitDraft(label = 'Edit audio'): AudioEditResult {
    try {this.assertWritable();} catch (error) {return failure(error);}
    this.busy = true;
    let lease: AudioAssetLease | undefined;
    try {
      const draft = this.snapshot.draft; if (!draft) return Object.freeze({status: 'noop', snapshot: this.editor.getSnapshot()});
      // Keep draft assets alive until execute has retained the new committed root.
      lease = this.draftLease; this.draftLease = undefined;
      this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selection: this.snapshot.selection, disposed: false}); this.publish();
      this.assertAlive();
      return this.editor.execute({version: 1, documentId: this.snapshot.documentId, expectedRevision: draft.documentRevision, label, operations: draft.operations});
    }
    catch (error) {return failure(error);}
    finally {this.releaseAsset(lease); this.busy = false;}
  }
  cancelDraft(): void {
    this.assertWritable(); this.busy = true;
    try {
      if (!this.snapshot.draft && !this.draftLease) return;
      const lease = this.draftLease; this.draftLease = undefined;
      const hadDraft = Boolean(this.snapshot.draft);
      const snapshot = this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selection: this.snapshot.selection, disposed: false});
      this.releaseAsset(lease);
      if (hadDraft && this.snapshot === snapshot) this.publish();
    } finally {this.busy = false;}
  }
  documentChanged(change: AudioDocumentChange): void {
    if (this.snapshot.disposed) return;
    const wasBusy = this.busy; this.busy = true;
    try {
      const range = this.snapshot.selection;
      const startFrame = mapAudioPosition(change.positionMap, range.startFrame, 'right').frame;
      const endFrame = mapAudioPosition(change.positionMap, range.endFrame, range.startFrame === range.endFrame ? 'right' : 'left').frame;
      const lease = this.draftLease; this.draftLease = undefined;
      const snapshot = this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selection: Object.freeze({startFrame, endFrame: Math.max(startFrame, endFrame)}), disposed: false});
      this.releaseAsset(lease);
      if (this.snapshot === snapshot) this.publish();
    } finally {this.busy = wasBusy;}
  }
  dispose(): void {
    if (this.snapshot.disposed) return;
    const lease = this.draftLease; this.draftLease = undefined;
    this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selection: Object.freeze({startFrame: 0, endFrame: 0}), disposed: true});
    this.release(this); this.releaseAsset(lease); this.publish();
  }
  private assertAlive(): void {
    if (this.snapshot.disposed || this.editor.getSnapshot().status === 'disposed') throw new AudioEditError('disposed', 'Interaction session is disposed');
  }
  private assertWritable(): void {
    this.assertAlive();
    if (this.busy || this.publishing) throw new AudioEditError('reentrant-command', 'Interaction cannot nest during commands or publication');
  }
  private releaseAsset(lease?: AudioAssetLease): void {try {lease?.release();} catch (error) {this.report(error);}}
  private call(listener: (snapshot: AudioInteractionSnapshot) => void, value: AudioInteractionSnapshot): void {try {listener(value);} catch (error) {this.report(error);}}
  private publish(): void {
    this.pending = true; if (this.publishing) return; this.publishing = true;
    try {
      while (this.pending) {
        this.pending = false; const snapshot = this.snapshot;
        for (const listener of [...this.listeners]) {if (snapshot !== this.snapshot) break; if (this.listeners.has(listener)) this.call(listener, snapshot);}
      }
    } finally {this.publishing = false; if (this.snapshot.disposed) this.listeners.clear();}
  }
}
