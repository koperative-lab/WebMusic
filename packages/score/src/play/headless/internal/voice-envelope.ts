/** Per-occurrence linear ADSR in AudioContext seconds; settings are captured at onset. */
export interface VoiceEnvelopeSettings {
  attackSeconds: number;
  decaySeconds: number;
  sustainLevel: number;
  releaseSeconds: number;
}

export type VoiceEnvelopeOptions = Partial<VoiceEnvelopeSettings>;

export function envelopeSettings(options: VoiceEnvelopeOptions, attackSeconds: number, releaseSeconds: number): VoiceEnvelopeSettings {
  const settings = {
    attackSeconds: options.attackSeconds ?? attackSeconds,
    decaySeconds: options.decaySeconds ?? 0,
    sustainLevel: options.sustainLevel ?? 1,
    releaseSeconds: options.releaseSeconds ?? releaseSeconds,
  };
  for (const [key, value] of Object.entries(settings)) {
    if (!Number.isFinite(value) || value < 0 || (key === 'sustainLevel' && value > 1)) {
      throw new RangeError(`Invalid envelope ${key}: ${value}.`);
    }
  }
  return settings;
}

export class VoiceEnvelope {
  private releaseAt = Infinity;
  private releaseLevel = 0;

  constructor(
    private readonly param: AudioParam,
    readonly startTime: number,
    private readonly level: number,
    readonly settings: VoiceEnvelopeSettings,
    durationSeconds: number,
  ) {
    if (!Number.isFinite(startTime) || startTime < 0 || Number.isNaN(durationSeconds) || durationSeconds < 0) {
      throw new RangeError('Voice onset and duration must be nonnegative AudioContext seconds.');
    }
    this.scheduleGate(startTime + durationSeconds, startTime);
  }

  /** Scheduled envelopes cannot be read through AudioParam.value. */
  valueAt(time: number): number {
    if (time < this.startTime) return 0;
    if (time >= this.releaseAt) {
      if (this.settings.releaseSeconds === 0) return 0;
      return this.releaseLevel * Math.max(0, 1 - (time - this.releaseAt) / this.settings.releaseSeconds);
    }
    return this.gatedValueAt(time);
  }

  release(time: number): number {
    const level = this.valueAt(time);
    this.param.cancelScheduledValues(time);
    this.anchor(time, level);
    this.releaseAt = time;
    this.releaseLevel = level;
    const end = time + this.settings.releaseSeconds;
    if (end === time) this.param.setValueAtTime(0, time);
    else this.param.linearRampToValueAtTime(0, end);
    return end;
  }

  cancel(time: number): void {
    this.param.cancelScheduledValues(time);
    this.param.setValueAtTime(0, time);
    this.releaseAt = time;
    this.releaseLevel = 0;
  }

  retime(end: number, now: number): number | undefined {
    this.scheduleGate(Math.max(now, end), Math.max(this.startTime, now));
    return Number.isFinite(end) ? Math.max(now, end) + this.settings.releaseSeconds : undefined;
  }

  private gatedValueAt(time: number): number {
    const elapsed = Math.max(0, time - this.startTime);
    const {attackSeconds, decaySeconds, sustainLevel} = this.settings;
    if (time < this.startTime + attackSeconds) return this.level * elapsed / attackSeconds;
    if (time < this.startTime + attackSeconds + decaySeconds) {
      return this.level * (1 - (1 - sustainLevel) * (elapsed - attackSeconds) / decaySeconds);
    }
    return this.level * sustainLevel;
  }

  private anchor(time: number, value: number): void {
    if (time === this.startTime) {
      this.param.setValueAtTime(value, time);
    } else if (this.settings.decaySeconds === 0 && time === this.startTime + this.settings.attackSeconds && time <= this.releaseAt) {
      // Preserve the attack's peak before the instantaneous decay discontinuity.
      this.param.linearRampToValueAtTime(this.level, time);
      this.param.setValueAtTime(value, time);
    } else {
      this.param.linearRampToValueAtTime(value, time);
    }
  }

  private scheduleGate(end: number, from: number): void {
    const {attackSeconds, decaySeconds, releaseSeconds} = this.settings;
    this.param.cancelScheduledValues(from);
    this.anchor(from, this.gatedValueAt(from));
    const attackEnd = this.startTime + attackSeconds;
    const decayEnd = attackEnd + decaySeconds;
    if (attackEnd > from && attackEnd <= end) {
      this.param.linearRampToValueAtTime(this.level, attackEnd);
      if (decaySeconds === 0) this.param.setValueAtTime(this.level * this.settings.sustainLevel, attackEnd);
    }
    if (decaySeconds > 0 && decayEnd > from && decayEnd <= end) {
      this.param.linearRampToValueAtTime(this.level * this.settings.sustainLevel, decayEnd);
    }
    if (Number.isFinite(end) && end > from && end !== attackEnd && end !== decayEnd) {
      this.param.linearRampToValueAtTime(this.gatedValueAt(end), end);
    }
    this.releaseAt = end;
    this.releaseLevel = this.gatedValueAt(end);
    if (Number.isFinite(end)) {
      if (releaseSeconds === 0) this.param.setValueAtTime(0, end);
      else this.param.linearRampToValueAtTime(0, end + releaseSeconds);
    }
  }
}
