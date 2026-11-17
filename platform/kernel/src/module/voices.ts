// ============================================================================
// Voice allocation (DEC-077): which of N voices plays each held note, as Max's
// poly and poly~ assign them. Pure bookkeeping by occurrence key.
// ============================================================================

export type VoiceSteal = 'oldest' | 'none';

export interface VoiceAssignment {
  /** The voice that now plays the key, or undefined when every voice is busy and stealing is off. */
  readonly voice: number | undefined;
  /** The key that lost its voice to this one, when a voice was stolen. */
  readonly stolen?: string;
}

/** Assigns held notes to a fixed number of voices; a new note takes a free voice or steals the oldest. */
export class VoiceAllocator {
  readonly voices: number;
  readonly steal: VoiceSteal;
  readonly #held = new Map<string, number>();
  readonly #order: string[] = [];
  #next = 0;

  constructor(voices: number, steal: VoiceSteal = 'oldest') {
    if (!Number.isInteger(voices) || voices < 1 || voices > 256) throw new RangeError('A voice allocator needs 1 to 256 voices.');
    this.voices = voices;
    this.steal = steal;
  }

  /** Keys currently holding a voice, oldest first. */
  get held(): readonly string[] { return [...this.#order]; }
  /** The voice playing `key`, if any. */
  voiceOf(key: string): number | undefined { return this.#held.get(key); }

  /** Give `key` a voice: a free one in turn, or the oldest held voice when all are busy. */
  noteOn(key: string): VoiceAssignment {
    const existing = this.#held.get(key);
    if (existing !== undefined) return {voice: existing};
    const busy = new Set(this.#held.values());
    for (let offset = 0; offset < this.voices; offset++) {
      const voice = (this.#next + offset) % this.voices;
      if (busy.has(voice)) continue;
      this.#next = (voice + 1) % this.voices;
      this.#held.set(key, voice);
      this.#order.push(key);
      return {voice};
    }
    if (this.steal === 'none') return {voice: undefined};
    const stolen = this.#order.shift()!;
    const voice = this.#held.get(stolen)!;
    this.#held.delete(stolen);
    this.#held.set(key, voice);
    this.#order.push(key);
    return {voice, stolen};
  }

  /** Free the voice of `key`; returns it, or undefined when the key held none. */
  noteOff(key: string): number | undefined {
    const voice = this.#held.get(key);
    if (voice === undefined) return undefined;
    this.#held.delete(key);
    this.#order.splice(this.#order.indexOf(key), 1);
    return voice;
  }

  /** Free every voice. */
  clear(): void { this.#held.clear(); this.#order.length = 0; this.#next = 0; }
}
