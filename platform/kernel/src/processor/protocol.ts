// Messages between a processor module (main thread) and its processor (audio
// thread). Types and constants only: both sides import this file, and it
// must stay free of runtime dependencies.

/** Bumped when a message shape changes incompatibly; the two sides must match. */
export const PROCESSOR_PROTOCOL_VERSION = 1;

/** `frame` of a note that plays as soon as possible: a live gesture with no scheduled time. */
export const PROCESSOR_IMMEDIATE_FRAME = -1;

/** `processorOptions` handed to the processor's constructor. */
export interface ProcessorNodeOptions {
  readonly protocol: number;
  /** The `id@version` the node was created for. */
  readonly name: string;
  /** Author-defined, structured-cloneable initial configuration. */
  readonly config?: unknown;
}

/** Author-defined configuration; never used for per-block control. */
export interface ProcessorConfigMessage {
  readonly type: 'config';
  readonly data: unknown;
}

/**
 * One gate change of one note occurrence, already converted for the audio
 * thread: an absolute context frame instead of seconds, an integer occurrence
 * instead of a string ID.
 */
export interface ProcessorNoteMessage {
  readonly type: 'note';
  readonly gate: 'on' | 'off' | 'cancel';
  readonly occurrence: number;
  readonly midi: number;
  readonly cents: number;
  /** Normalized 0–1. */
  readonly velocity: number;
  /**
   * Absolute frame on the context's sample clock, or {@link PROCESSOR_IMMEDIATE_FRAME}
   * for a live gesture that plays at the next block without counting as late.
   */
  readonly frame: number;
  readonly epoch: number;
}

/** A Session anchor copied to the audio thread. The processor cannot write it. */
export interface ProcessorTransportMessage {
  readonly type: 'transport';
  /** Absolute frame at which `originSeconds` holds. */
  readonly originFrame: number;
  /** Session seconds at `originFrame`. */
  readonly originSeconds: number;
  readonly rate: number;
  readonly running: boolean;
  readonly loop: Readonly<{startSeconds: number; endSeconds: number}> | null;
  readonly epoch: number;
}

/** Everything the main thread can post to a processor. */
export type ProcessorMessage = ProcessorConfigMessage | ProcessorNoteMessage | ProcessorTransportMessage;

/** The processor threw; Web Audio has stopped calling it. Sent once. */
export interface ProcessorErrorReport {
  readonly type: 'error';
  readonly message: string;
}

/** Note events that arrived after their frame since the last report. Posted at most four times a second. */
export interface ProcessorLateReport {
  readonly type: 'late';
  readonly count: number;
}

/** Author-defined observation, posted at a bounded rate. */
export interface ProcessorDataReport {
  readonly type: 'data';
  readonly data: unknown;
}

/** Everything a processor can post to the main thread. */
export type ProcessorReport = ProcessorErrorReport | ProcessorLateReport | ProcessorDataReport;
