// ============================================================================
// transcribe — digital audio → family-neutral note events (audio → MIDI-style data).
//
// Its heavy dependencies are ALL optional peers, reached only through guarded
// dynamic `import()`:
//
//   - `@spotify/basic-pitch` + `@tensorflow/tfjs`  (default engine, ~10MB model)
//
// Because this lives at its own subpath (`@webmusic/audio/analyze/transcribe`) and
// imports those peers dynamically, consumers who never call it pay nothing, and
// the build/typecheck pass without any peer installed. Score assembly belongs
// to `@webmusic/bridge`, keeping this capability independent of `@webmusic/score`.
// ============================================================================

import type {AudioClip, BeatGrid} from '../../core';

export interface TranscribeOptions {
  /** Transcription engine. Default `'basic-pitch'`. */
  engine?: 'basic-pitch' | 'magenta-oaf';
  /** Note-onset probability threshold in [0, 1]. Default 0.5. */
  onsetThreshold?: number;
  /** Frame (sustain) probability threshold in [0, 1]. Default 0.3. */
  frameThreshold?: number;
  /** Drop notes shorter than this (seconds). Default 0.058 (~ basic-pitch default). */
  minNoteLength?: number;
  /** Quantize note times to a beat grid (the clip's, or one supplied). */
  quantize?: boolean;
  /** Beat grid to quantize against (defaults to `clip.beatGrid`). */
  beatGrid?: BeatGrid;
}

/** A single transcribed note event (pre-Score intermediate). */
export interface TranscribedNote {
  /** Start time in seconds. */
  startSeconds: number;
  /** End time in seconds. */
  endSeconds: number;
  /** MIDI pitch number. */
  midi: number;
  /** Velocity / amplitude in [0, 1]. */
  velocity: number;
}

export interface TranscriptionResult {
  /** The transcribed note events (quantized when a beat grid is available). */
  notes: TranscribedNote[];
  /** Overall confidence in [0, 1] (mean of note confidences). */
  confidence: number;
  /** Supplied beat-grid tempo, then clip beat-grid tempo, or 120 when neither exists. */
  bpm: number;
}

const PEER_HINT =
  'Install the optional peers: `npm i @spotify/basic-pitch @tensorflow/tfjs`.';

/** Build an Error with a `cause` (without relying on the ES2022 2-arg ctor). */
function peerError(message: string, cause: unknown): Error {
  const error = new Error(message);
  (error as Error & {cause?: unknown}).cause = cause;
  return error;
}

/**
 * Transcribe an {@link AudioClip} into note events.
 *
 * ```ts
 * import {transcribe} from '@webmusic/audio/analyze/transcribe';
 * const {notes, confidence, bpm} = await transcribe(clip, {quantize: true});
 * ```
 *
 * The result is family-neutral data. To build an `@webmusic/score` `Score`
 * from it, use `scoreFromTranscription` from `@webmusic/bridge` — cross-family assembly
 * deliberately does not live in this package.
 *
 * Throws a clear error if the optional peers are not installed.
 */
export async function transcribe(
  clip: AudioClip,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const channels = clip.channels();
  if (!channels || channels.length === 0) {
    throw new Error('transcribe: clip has no decoded samples');
  }

  const notes = await transcribeNotes(clip, channels, options);
  const confidence =
    notes.length > 0 ? notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length : 0;

  const beatGrid = options.beatGrid ?? clip.beatGrid;
  const quantized =
    options.quantize !== false && beatGrid ? quantizeNotes(notes, beatGrid) : notes;

  return {notes: quantized, confidence, bpm: beatGrid?.bpm ?? 120};
}

/** Run the chosen engine to get raw note events. */
async function transcribeNotes(
  clip: AudioClip,
  channels: Float32Array[],
  options: TranscribeOptions,
): Promise<TranscribedNote[]> {
  const engine = options.engine ?? 'basic-pitch';
  if (engine === 'magenta-oaf') {
    return transcribeWithMagenta(clip, channels, options);
  }
  return transcribeWithBasicPitch(clip, channels, options);
}

/** basic-pitch (default): CNN audio→MIDI, requires tfjs. */
async function transcribeWithBasicPitch(
  clip: AudioClip,
  channels: Float32Array[],
  options: TranscribeOptions,
): Promise<TranscribedNote[]> {
  let bp: any;
  try {
    bp = await import('@spotify/basic-pitch' as string);
    // tfjs is a transitive peer basic-pitch needs at runtime.
    await import('@tensorflow/tfjs' as string);
  } catch (error) {
    throw peerError(`transcribeToScore: @spotify/basic-pitch is not installed. ${PEER_HINT}`, error);
  }

  const BasicPitch = bp.BasicPitch ?? bp.default?.BasicPitch ?? bp.default;
  if (!BasicPitch) throw new Error('transcribeToScore: unexpected @spotify/basic-pitch shape');

  // basic-pitch expects 22050 Hz mono. Resample/mix down here.
  const mono = monoMixResample(channels, clip.sampleRate, 22050);
  const model = new BasicPitch();

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await model.evaluateModel(
    mono as Float32Array,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    () => {},
  );

  const noteEvents =
    bp.noteFramesToTime?.(
      bp.addPitchBendsToNoteEvents?.(
        contours,
        bp.outputToNotesPoly?.(
          frames,
          onsets,
          options.onsetThreshold ?? 0.5,
          options.frameThreshold ?? 0.3,
          Math.round((options.minNoteLength ?? 0.058) * (22050 / 256)),
        ) ?? [],
      ) ??
        bp.outputToNotesPoly?.(
          frames,
          onsets,
          options.onsetThreshold ?? 0.5,
          options.frameThreshold ?? 0.3,
        ) ??
        [],
    ) ?? [];

  return noteEvents.map((n: any) => ({
    startSeconds: n.startTimeSeconds ?? n.start ?? 0,
    endSeconds: n.endTimeSeconds ?? n.end ?? 0,
    midi: n.pitchMidi ?? n.midi ?? 0,
    velocity: clamp01(n.amplitude ?? n.velocity ?? 0.7),
  }));
}

/** @magenta/music Onsets & Frames (narrow: solo piano). */
async function transcribeWithMagenta(
  clip: AudioClip,
  channels: Float32Array[],
  _options: TranscribeOptions,
): Promise<TranscribedNote[]> {
  let mm: any;
  try {
    mm = await import('@magenta/music' as string);
    await import('@tensorflow/tfjs' as string);
  } catch (error) {
    throw peerError(`transcribeToScore: @magenta/music is not installed. ${PEER_HINT}`, error);
  }
  const OnsetsAndFrames = mm.OnsetsAndFrames ?? mm.default?.OnsetsAndFrames;
  if (!OnsetsAndFrames) throw new Error('transcribeToScore: unexpected @magenta/music shape');

  const model = new OnsetsAndFrames(
    'https://storage.googleapis.com/magentadata/js/checkpoints/transcription/onsets_frames_uni',
  );
  await model.initialize();
  const mono = monoMixResample(channels, clip.sampleRate, 16000);
  const ns = await model.transcribeFromAudioBuffer(asAudioBufferLike(mono, 16000));
  model.dispose?.();
  return (ns?.notes ?? []).map((n: any) => ({
    startSeconds: n.startTime ?? 0,
    endSeconds: n.endTime ?? 0,
    midi: n.pitch ?? 0,
    velocity: clamp01((n.velocity ?? 80) / 127),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snap note start/end times to the nearest beat-grid subdivision. */
function quantizeNotes(notes: TranscribedNote[], grid: BeatGrid): TranscribedNote[] {
  const snap = (seconds: number): number => {
    const beat = grid.secondsToBeat(seconds);
    const quantizedBeat = Math.round(beat * 4) / 4; // sixteenth-note grid
    return grid.beatToSeconds(quantizedBeat);
  };
  return notes.map((n) => {
    const start = snap(n.startSeconds);
    let end = snap(n.endSeconds);
    if (end <= start) end = start + grid.secondsPerBeat() / 4;
    return {...n, startSeconds: start, endSeconds: end};
  });
}

/** Mix channels to mono and linearly resample to `targetRate`. */
function monoMixResample(channels: Float32Array[], sourceRate: number, targetRate: number): Float32Array {
  const length = channels[0].length;
  const mono = new Float32Array(length);
  const inv = 1 / channels.length;
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < length; i++) mono[i] += ch[i] * inv;
  }
  if (sourceRate === targetRate) return mono;
  const ratio = targetRate / sourceRate;
  const outLength = Math.max(1, Math.round(length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(length - 1, i0 + 1);
    const frac = srcPos - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return out;
}

/** A minimal AudioBuffer-like object for Magenta's transcribe-from-buffer API. */
function asAudioBufferLike(mono: Float32Array, sampleRate: number): any {
  return {
    sampleRate,
    length: mono.length,
    numberOfChannels: 1,
    duration: mono.length / sampleRate,
    getChannelData: () => mono,
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
