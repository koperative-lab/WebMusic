import {ParamHandle, ParamSurface} from '@webmusic/kernel/module';
import {envelopeSettings, type VoiceEnvelopeOptions, type VoiceEnvelopeSettings} from './voice-envelope';

const KEYS = ['attackSeconds', 'decaySeconds', 'sustainLevel', 'releaseSeconds'] as const;

export function createEnvelopeParameters(options: VoiceEnvelopeOptions, attack: number, release: number): ParamSurface {
  const settings = envelopeSettings(options, attack, release);
  return new ParamSurface(KEYS.map((id) => new ParamHandle({
    id, label: `${id === 'sustainLevel' ? 'Sustain' : id.replace('Seconds', '')} (next notes)`,
    unit: id === 'sustainLevel' ? 'ratio' : 's',
    range: {min: 0, max: id === 'sustainLevel' ? 1 : Math.max(60, settings[id])},
    displayRange: {min: 0, max: id === 'sustainLevel' ? 1 : id === 'releaseSeconds' ? 5 : 2},
    defaultValue: settings[id], step: id === 'sustainLevel' ? 0.01 : 0.001,
    updateTiming: 'synchronous', modulation: 'none',
  })));
}

export function readEnvelopeParameters(params: ParamSurface): VoiceEnvelopeSettings {
  return Object.fromEntries(KEYS.map((key) => [key, params.get(key)!.snapshot.baseValue])) as unknown as VoiceEnvelopeSettings;
}
