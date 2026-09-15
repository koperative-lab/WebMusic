import type {InternalRackMember} from './contracts';

export interface RackMixState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export function clampRackVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Effective member gain after volume, mute, and rack-wide solo gating. */
export function rackMemberGain(state: RackMixState, anySolo: boolean): number {
  const gate = state.muted || (anySolo && !state.solo) ? 0 : 1;
  return state.volume * gate;
}

/** Push current mixer state onto all realised member gain nodes. */
export function applyRackMemberGains(members: Iterable<InternalRackMember>): void {
  const list = [...members];
  const anySolo = list.some((member) => member.solo);
  for (const member of list) {
    if (member.gain) member.gain.gain.value = rackMemberGain(member, anySolo);
  }
}
