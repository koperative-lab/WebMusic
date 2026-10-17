import type {AudioClip} from './model/AudioClip';
import type {AudioAssetLease, AudioAssetReader, AudioEnvelopePoint, AudioSequence, AudioSequenceSegmentInput, AudioSequenceAnnotation} from './sequence';

export interface AudioFrameRange {readonly startFrame: number; readonly endFrame: number}
/** Splice boundary duplication uses an explicit rightId; replay never creates IDs. */
export type AudioEditOperation =
  | {readonly type: 'splice'; readonly startFrame: number; readonly deleteCount: number; readonly segments: readonly AudioSequenceSegmentInput[]; readonly annotations?: readonly AudioSequenceAnnotation[]; readonly rightId?: string}
  | {readonly type: 'split'; readonly segmentId: string; readonly frame: number; readonly leftId: string; readonly rightId: string}
  | {readonly type: 'trim'; readonly startFrame: number; readonly endFrame: number}
  | {readonly type: 'insert-silence'; readonly frame: number; readonly length: number; readonly id: string; readonly rightId?: string}
  | {readonly type: 'set-gain'; readonly segmentIds: readonly string[]; readonly gain: number}
  | {readonly type: 'set-envelope'; readonly segmentId: string; readonly points: readonly AudioEnvelopePoint[]};
export interface AudioRevisionGuard {readonly documentId: string; readonly expectedRevision: number}
export interface AudioEditCommand extends AudioRevisionGuard {
  readonly version: 1; readonly label: string; readonly operations: readonly AudioEditOperation[];
}
export type AudioEditErrorCode = 'invalid-command' | 'invalid-sequence' | 'invalid-range' | 'unknown-asset' |
  'incompatible-audio-format' | 'unknown-segment' | 'duplicate-id' | 'revision-conflict' | 'document-mismatch' |
  'disposed' | 'reentrant-command' | 'history-disabled' | 'invalid-checkpoint' | 'transaction-aborted' |
  'clipboard-empty' | 'processing-busy' | 'processing-failed' | 'resource-limit' | 'unsupported-processor';
export class AudioEditError extends Error {
  constructor(readonly code: AudioEditErrorCode, message: string) {super(message); this.name = 'AudioEditError';}
}
export type AudioPositionStep =
  | {readonly type: 'splice'; readonly startFrame: number; readonly deleteCount: number; readonly insertCount: number; readonly length: number}
  | {readonly type: 'reset'; readonly length: number};
export interface AudioPositionMap {
  readonly documentId: string; readonly fromRevision: number; readonly toRevision: number;
  readonly steps: readonly AudioPositionStep[];
}
export interface AudioMappedPosition {readonly frame: number; readonly deleted: boolean; readonly positionPolicy: 'preserve-frame' | 'reset-origin'}
export interface AudioDocumentChange {
  readonly origin: 'edit' | 'undo' | 'redo' | 'restore'; readonly label: string;
  readonly fromRevision: number; readonly toRevision: number;
  readonly operations: readonly AudioEditOperation[];
  readonly affectedRanges: readonly AudioFrameRange[];
  readonly positionMap: AudioPositionMap;
}
export interface AudioDocumentSnapshot {
  readonly documentId: string; readonly documentRevision: number; readonly contentId: string;
  readonly content: AudioSequence; readonly assets: AudioAssetReader;
  readonly status: 'ready' | 'disposed'; readonly change?: AudioDocumentChange;
}
export interface AudioDocumentSource {
  getSnapshot(): AudioDocumentSnapshot;
  subscribe(listener: (snapshot: AudioDocumentSnapshot) => void): () => void;
}
export interface AudioEditorState {
  readonly document: AudioDocumentSnapshot; readonly dirty: boolean;
  readonly history: {readonly enabled: boolean; readonly limit: number; readonly assetByteLimit: number;
    readonly historyOnlyBytes: number; readonly undoCount: number; readonly redoCount: number;
    readonly trimmedCount: number; readonly canUndo: boolean; readonly canRedo: boolean};
  readonly clipboard: {readonly length: number; readonly hasContent: boolean};
  readonly processing: boolean;
}
export type AudioEditFailure = {readonly status: 'failed'; readonly error: AudioEditError};
export type AudioEditResult =
  | {readonly status: 'committed'; readonly snapshot: AudioDocumentSnapshot; readonly change: AudioDocumentChange}
  | {readonly status: 'noop'; readonly snapshot: AudioDocumentSnapshot} | AudioEditFailure;
export interface AudioEditTransaction {add(operation: AudioEditOperation): void}
export interface AudioCheckpoint extends AudioAssetLease {readonly documentId: string; readonly contentId: string; readonly content: AudioSequence}
export interface AudioClipboard extends AudioAssetLease {readonly content: AudioSequence; readonly assets: AudioAssetReader}
export interface AudioInteractionSnapshot {
  readonly documentId: string; readonly selection: AudioFrameRange; readonly disposed: boolean;
  readonly draft?: {readonly documentRevision: number; readonly content: AudioSequence; readonly operations: readonly AudioEditOperation[]};
}
export type AudioDraftResult = {readonly status: 'preview'; readonly snapshot: AudioInteractionSnapshot} | AudioEditFailure;
export interface AudioInteractionSession {
  getSnapshot(): AudioInteractionSnapshot;
  subscribe(listener: (snapshot: AudioInteractionSnapshot) => void): () => void;
  setSelection(range: AudioFrameRange): void;
  preview(operations: readonly AudioEditOperation[]): AudioDraftResult;
  commitDraft(label?: string): AudioEditResult;
  cancelDraft(): void;
  dispose(): void;
}
/** A processor declares all materialization before any input allocation. */
export interface AudioRangeProcessor {
  readonly id: string; readonly version: number;
  plan(request: {readonly rangeLength: number; readonly sampleRate: number; readonly channelLayout: readonly string[];
    readonly parameters: unknown; readonly tailPolicy: 'trim' | 'extend'}): {
      readonly inputBefore: number; readonly inputAfter: number; readonly outputLength: number;
      readonly latencyFrames: number; readonly tailFrames: number;
    };
  process(input: {readonly channels: readonly Float32Array[]; readonly sampleRate: number;
    readonly selectionOffset: number; readonly selectionLength: number; readonly parameters: unknown;
    readonly signal: AbortSignal}): Promise<AudioClip>;
}
export interface AudioProcessingRequest extends AudioRevisionGuard, AudioFrameRange {
  readonly processorId: string; readonly processorVersion: number; readonly parameters: unknown;
  readonly assetId: string; readonly segmentId: string; readonly rightId?: string;
  readonly tailPolicy?: 'trim' | 'extend'; readonly label?: string;
}
export type AudioProcessingResult = AudioEditResult | {readonly status: 'cancelled' | 'superseded'};
export interface AudioClipEditorPort extends AudioDocumentSource {
  getState(): AudioEditorState;
  subscribeState(listener: (state: AudioEditorState) => void): () => void;
  execute(command: AudioEditCommand): AudioEditResult;
  transaction(label: string, build: (transaction: AudioEditTransaction) => void, guard?: AudioRevisionGuard): AudioEditResult;
  undo(guard?: AudioRevisionGuard): AudioEditResult;
  redo(guard?: AudioRevisionGuard): AudioEditResult;
  markSaved(): void; clearHistory(): void;
  createCheckpoint(): AudioCheckpoint;
  restoreCheckpoint(checkpoint: AudioCheckpoint, guard?: AudioRevisionGuard): AudioEditResult;
  createInteractionSession(): AudioInteractionSession;
  /** Caller owns the returned lease; editor retains a separate clipboard until replacement/clear/dispose. */
  copy(range: AudioFrameRange): AudioClipboard;
  cut(range: AudioFrameRange, guard?: AudioRevisionGuard): AudioEditResult;
  paste(frame: number, options?: {readonly segmentIds?: readonly string[]; readonly rightId?: string}, guard?: AudioRevisionGuard): AudioEditResult;
  clearClipboard(): void;
}
export function isAudioDocumentSource(value: unknown): value is AudioDocumentSource {
  try {
    if (!value || typeof value !== 'object') return false;
    const source = value as Partial<AudioDocumentSource>;
    if (typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') return false;
    const snapshot = source.getSnapshot();
    return Boolean(snapshot && typeof snapshot.documentId === 'string' && snapshot.documentId &&
      typeof snapshot.contentId === 'string' && snapshot.contentId && Number.isSafeInteger(snapshot.documentRevision) && snapshot.documentRevision >= 0 &&
      ['ready', 'disposed'].includes(snapshot.status) && snapshot.content && Number.isSafeInteger(snapshot.content.length) &&
      snapshot.content.length >= 0 && Number.isFinite(snapshot.content.sampleRate) && snapshot.content.sampleRate > 0 &&
      Array.isArray(snapshot.content.channelLayout) && snapshot.content.channelLayout.length > 0 &&
      Array.isArray(snapshot.content.annotations) && Array.isArray(snapshot.content.segments) && snapshot.assets &&
      typeof snapshot.assets.getReferenceCount === 'function' && typeof snapshot.assets.read === 'function' && typeof snapshot.assets.retain === 'function' && typeof snapshot.assets.getDescriptor === 'function');
  } catch {return false;}
}
export function isAudioClipEditorPort(value: unknown): value is AudioClipEditorPort {
  if (!isAudioDocumentSource(value)) return false;
  try {
    return (['getState', 'subscribeState', 'execute', 'transaction', 'undo', 'redo', 'markSaved', 'clearHistory',
      'createCheckpoint', 'restoreCheckpoint', 'createInteractionSession', 'copy', 'cut', 'paste', 'clearClipboard'] as const)
      .every((key) => typeof (value as Partial<AudioClipEditorPort>)[key] === 'function');
  } catch {return false;}
}
