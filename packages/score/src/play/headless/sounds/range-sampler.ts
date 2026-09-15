import type {HeadlessSynth} from '../audio-contracts';
import type {SampleZone, SfzOptions} from './contracts';
import {
  cancelBinaryResponseBody,
  decodedAudioByteLength,
  mapWithConcurrency,
  positiveSafeIntegerOption,
  readBoundedResponse,
} from '../resource-loading';

interface LoadedZone extends SampleZone {
  buffer: AudioBuffer;
}

interface ActiveRangeSample {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startTime: number;
}

interface SfzLoadLimits {
  maxZones: number;
  maxConcurrentLoads: number;
  maxSampleBytes: number;
  maxTotalSampleBytes: number;
  maxDecodedSampleBytes: number;
  maxTotalDecodedSampleBytes: number;
}

/** Safe defaults for loading an SFZ from an untrusted URL. */
export const DEFAULT_SFZ_LOAD_LIMITS: Readonly<SfzLoadLimits> = Object.freeze({
  maxZones: 512,
  maxConcurrentLoads: 4,
  maxSampleBytes: 32 * 1024 * 1024,
  maxTotalSampleBytes: 128 * 1024 * 1024,
  maxDecodedSampleBytes: 64 * 1024 * 1024,
  maxTotalDecodedSampleBytes: 256 * 1024 * 1024,
});

/** Key/velocity-ranged, pitch-shifting sampler used by `Sound.sfz()`. */
export class RangeSampler implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  private readonly output: GainNode;
  private zones: LoadedZone[] = [];
  private readonly active = new Map<number, Set<ActiveRangeSample>>();
  /** Sources remain owned until onended, including voices in their release tail. */
  private readonly sources = new Set<ActiveRangeSample>();
  private readonly byId = new Map<number, {midi: number; voice: ActiveRangeSample}>();
  private nextId = 1;
  private readonly roundRobin = new Map<string, number>();
  private readonly attackSeconds: number;
  private readonly releaseSeconds: number;
  private readonly loadLimits: SfzLoadLimits;
  private readonly loadControllers = new Set<AbortController>();
  private loadGeneration = 0;
  private disposed = false;

  constructor(private readonly context: AudioContext, options: SfzOptions = {}) {
    this.loadLimits = resolveSfzLoadLimits(options);
    this.output = context.createGain();
    this.attackSeconds = options.attackSeconds ?? 0.004;
    this.releaseSeconds = options.releaseSeconds ?? 0.12;
  }

  connect(destination: AudioNode): () => void {
    if (this.disposed) throw new Error('RangeSampler has been disposed.');
    this.output.connect(destination);
    return () => {
      try {
        this.output.disconnect(destination);
      } catch {
        // The route may already have been removed by an owning graph teardown.
      }
    };
  }

  disconnect(): void {
    this.output.disconnect();
  }

  async loadZones(zones: SampleZone[], context: AudioContext): Promise<void> {
    if (this.disposed) throw new Error('RangeSampler has been disposed.');
    // Snapshot the caller-owned list and descriptors before the first await so
    // later mutations cannot add work after the zone-count preflight.
    const zoneSnapshot = zones.map((zone) => ({...zone}));
    if (zoneSnapshot.length > this.loadLimits.maxZones) {
      throw new RangeError(
        `SFZ resource limit exceeded: ${zoneSnapshot.length.toLocaleString()} zones (maxZones is ${this.loadLimits.maxZones.toLocaleString()})`,
      );
    }

    const generation = this.beginLoadGeneration();

    const cache = new Map<string, Promise<AudioBuffer>>();
    let reservedSourceBytes = 0;
    let decodedBytes = 0;
    const decode = (url: string) => {
      let pending = cache.get(url);
      if (!pending) {
        pending = (async () => {
          const controller = new AbortController();
          this.loadControllers.add(controller);
          try {
            const response = await fetch(url, {signal: controller.signal});
            if (!this.isLoadCurrent(generation)) {
              throw new Error('RangeSampler load was superseded.');
            }
            if (!response.ok) {
              cancelBinaryResponseBody(response.body, `SFZ sample request failed for ${url}`);
              throw new Error(`SFZ sample request failed for ${url} (${response.status})`);
            }

            const source = await readBoundedResponse(
              response,
              this.loadLimits.maxSampleBytes,
              `SFZ resource limit exceeded: sample ${url}`,
              'maxSampleBytes',
              controller.signal,
            );
            if (!this.isLoadCurrent(generation)) {
              throw new Error('RangeSampler load was superseded.');
            }
            const sourceBytes = source.byteLength;
            if (sourceBytes > this.loadLimits.maxSampleBytes) {
              throw new RangeError(
                `SFZ resource limit exceeded: sample ${url} is ${sourceBytes.toLocaleString()} bytes (maxSampleBytes is ${this.loadLimits.maxSampleBytes.toLocaleString()})`,
              );
            }
            if (reservedSourceBytes + sourceBytes > this.loadLimits.maxTotalSampleBytes) {
              throw new RangeError(
                `SFZ resource limit exceeded: samples exceed maxTotalSampleBytes (${this.loadLimits.maxTotalSampleBytes.toLocaleString()})`,
              );
            }

            reservedSourceBytes += sourceBytes;
            try {
              const buffer = await context.decodeAudioData(source.slice(0));
              if (!this.isLoadCurrent(generation)) {
                throw new Error('RangeSampler load was superseded.');
              }
              const bufferBytes = decodedAudioByteLength(buffer, 'SFZ resource limit exceeded');
              if (bufferBytes > this.loadLimits.maxDecodedSampleBytes) {
                throw new RangeError(
                  `SFZ resource limit exceeded: decoded sample ${url} is ${bufferBytes.toLocaleString()} bytes (maxDecodedSampleBytes is ${this.loadLimits.maxDecodedSampleBytes.toLocaleString()})`,
                );
              }
              if (decodedBytes + bufferBytes > this.loadLimits.maxTotalDecodedSampleBytes) {
                throw new RangeError(
                  `SFZ resource limit exceeded: decoded samples exceed maxTotalDecodedSampleBytes (${this.loadLimits.maxTotalDecodedSampleBytes.toLocaleString()})`,
                );
              }
              decodedBytes += bufferBytes;
              return buffer;
            } catch (error) {
              // The source bytes are only retained for successfully decoded
              // samples; release this reservation when decode/validation fails.
              reservedSourceBytes -= sourceBytes;
              throw error;
            }
          } finally {
            this.loadControllers.delete(controller);
          }
        })();
        cache.set(url, pending);
        void pending.catch(() => cache.delete(url));
      }
      return pending;
    };
    try {
      const loaded = await mapWithConcurrency(
        zoneSnapshot,
        this.loadLimits.maxConcurrentLoads,
        async (zone) => ({...zone, buffer: await decode(zone.sample)}),
      );
      if (this.isLoadCurrent(generation)) this.zones = loaded;
    } catch (error) {
      // A newer load or dispose() owns the current state; its AbortError must
      // not resurrect or fail the retired generation.
      if (!this.isLoadCurrent(generation)) return;
      // One failed sample makes this generation unusable. Abort sibling fetches
      // immediately instead of letting their network/decode work continue after
      // the caller has already received the failure.
      this.invalidateLoads();
      throw error;
    }
  }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): number | undefined {
    if (this.disposed) throw new Error('RangeSampler has been disposed.');
    const zone = chooseZone(this.zones, midi, velocity, this.roundRobin);
    if (!zone) return;

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = zone.buffer;
    source.playbackRate.value = playbackRateFor(zone.rootKey, midi, zone.tuneCents ?? 0);

    const level = (velocity / 127) * dbToLinear(zone.volume ?? 0);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, level),
      time + this.attackSeconds,
    );
    source.connect(gain).connect(this.output);
    source.start(time);
    source.stop(time + durationSeconds + this.releaseSeconds);

    let voices = this.active.get(midi);
    if (!voices) {
      voices = new Set();
      this.active.set(midi, voices);
    }
    const voice = {source, gain, startTime: time};
    voices.add(voice);
    this.sources.add(voice);
    const id = this.nextId++;
    this.byId.set(id, {midi, voice});
    source.onended = () => {
      voices?.delete(voice);
      this.sources.delete(voice);
      if (voices?.size === 0) this.active.delete(midi);
      this.byId.delete(id);
    };
    return id;
  }

  noteOff(midi: number, time: number): void {
    const voices = this.active.get(midi);
    if (!voices) return;
    for (const voice of voices) this.releaseVoice(voice, time);
    voices.clear();
    this.active.delete(midi);
    for (const [id, record] of this.byId) if (record.midi === midi) this.byId.delete(id);
  }

  noteOffById(handle: unknown, time: number): void {
    this.releaseById(handle, time);
  }

  cancelScheduledNote(handle: unknown, time: number): void {
    this.releaseById(handle, time);
  }

  retimeScheduledNote(handle: unknown, time: number): void {
    const record = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!record) return;
    try {
      record.voice.source.stop(time + this.releaseSeconds);
    } catch {
      // The source has already ended.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateLoads();
    const now = Number.isFinite(this.context.currentTime) ? this.context.currentTime : 0;
    for (const voice of this.sources) this.hardStopVoice(voice, now);
    this.active.clear();
    this.sources.clear();
    this.byId.clear();
    this.zones = [];
    this.roundRobin.clear();
    this.disconnect();
  }

  private releaseById(handle: unknown, time: number): void {
    const record = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!record) return;
    this.byId.delete(handle as number);
    const voices = this.active.get(record.midi);
    voices?.delete(record.voice);
    if (voices?.size === 0) this.active.delete(record.midi);
    this.releaseVoice(record.voice, time);
  }

  private releaseVoice(voice: ActiveRangeSample, time: number): void {
    if (time <= voice.startTime) {
      this.hardStopVoice(voice, time);
      return;
    }
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), time);
    const stopTime = time + this.releaseSeconds;
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);
    try {
      voice.source.stop(stopTime);
    } catch {
      // The source has already ended.
    }
  }

  private hardStopVoice(voice: ActiveRangeSample, time: number): void {
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(0, time);
    try {
      voice.source.stop(time);
    } catch {
      // The source has already ended.
    }
  }

  private beginLoadGeneration(): number {
    this.invalidateLoads();
    return this.loadGeneration;
  }

  private invalidateLoads(): void {
    this.loadGeneration += 1;
    for (const controller of this.loadControllers) controller.abort();
    this.loadControllers.clear();
  }

  private isLoadCurrent(generation: number): boolean {
    return !this.disposed && generation === this.loadGeneration;
  }
}

/** Select a key/velocity zone, rotating equally matching alternates. */
export function chooseZone<
  Zone extends {loKey: number; hiKey: number; loVel: number; hiVel: number},
>(
  zones: ReadonlyArray<Zone>,
  midi: number,
  velocity: number,
  roundRobin: Map<string, number> = new Map(),
): Zone | undefined {
  const coversKey = (zone: Zone) => midi >= zone.loKey && midi <= zone.hiKey;
  const pool: number[] = [];
  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    if (coversKey(zone) && velocity >= zone.loVel && velocity <= zone.hiVel) {
      pool.push(index);
    }
  }
  if (pool.length === 0) {
    for (let index = 0; index < zones.length; index += 1) {
      if (coversKey(zones[index])) pool.push(index);
    }
  }
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return zones[pool[0]];

  const key = pool.join(',');
  const count = roundRobin.get(key) ?? 0;
  roundRobin.set(key, count + 1);
  return zones[pool[count % pool.length]];
}

/** Resampling ratio from a zone root key to the requested MIDI pitch. */
export function playbackRateFor(rootKey: number, midi: number, tuneCents = 0): number {
  return Math.pow(2, (midi - rootKey) / 12) * Math.pow(2, tuneCents / 1200);
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function resolveSfzLoadLimits(options: SfzOptions): SfzLoadLimits {
  return {
    maxZones: positiveSafeIntegerOption('SFZ', 'maxZones', options.maxZones, DEFAULT_SFZ_LOAD_LIMITS.maxZones),
    maxConcurrentLoads: positiveSafeIntegerOption(
      'SFZ',
      'maxConcurrentLoads',
      options.maxConcurrentLoads,
      DEFAULT_SFZ_LOAD_LIMITS.maxConcurrentLoads,
    ),
    maxSampleBytes: positiveSafeIntegerOption('SFZ', 'maxSampleBytes', options.maxSampleBytes, DEFAULT_SFZ_LOAD_LIMITS.maxSampleBytes),
    maxTotalSampleBytes: positiveSafeIntegerOption(
      'SFZ',
      'maxTotalSampleBytes',
      options.maxTotalSampleBytes,
      DEFAULT_SFZ_LOAD_LIMITS.maxTotalSampleBytes,
    ),
    maxDecodedSampleBytes: positiveSafeIntegerOption(
      'SFZ',
      'maxDecodedSampleBytes',
      options.maxDecodedSampleBytes,
      DEFAULT_SFZ_LOAD_LIMITS.maxDecodedSampleBytes,
    ),
    maxTotalDecodedSampleBytes: positiveSafeIntegerOption(
      'SFZ',
      'maxTotalDecodedSampleBytes',
      options.maxTotalDecodedSampleBytes,
      DEFAULT_SFZ_LOAD_LIMITS.maxTotalDecodedSampleBytes,
    ),
  };
}
