import {describe, expect, it} from 'vitest';
import {
  isDisposablePlayer,
  isRateControlledPlayer,
  isStatefulPlayer,
  isTimedPlayer,
  isVolumeControlledPlayer,
  type PlayerLike,
} from '../src/player';

const base = (): PlayerLike => ({
  play() {},
  pause() {},
  stop() {},
  seek() {},
  on() {
    return () => {};
  },
});

describe('player capability guards', () => {
  it('report every capability absent on the minimal contract', () => {
    const player = base();
    expect(isTimedPlayer(player)).toBe(false);
    expect(isStatefulPlayer(player)).toBe(false);
    expect(isRateControlledPlayer(player)).toBe(false);
    expect(isVolumeControlledPlayer(player)).toBe(false);
    expect(isDisposablePlayer(player)).toBe(false);
  });

  it('detect each capability from the current runtime shape', () => {
    const player: PlayerLike = {
      ...base(),
      seconds: 1.5,
      duration: 10,
      playing: false,
      setRate() {},
      setVolume() {},
      dispose() {},
    };
    expect(isTimedPlayer(player)).toBe(true);
    expect(isStatefulPlayer(player)).toBe(true);
    expect(isRateControlledPlayer(player)).toBe(true);
    expect(isVolumeControlledPlayer(player)).toBe(true);
    expect(isDisposablePlayer(player)).toBe(true);
  });

  it('require both position and duration for the timed capability', () => {
    expect(isTimedPlayer({...base(), seconds: 3})).toBe(false);
    expect(isTimedPlayer({...base(), duration: 3})).toBe(false);
  });

  it('narrow the type so capability members lose their optionality', () => {
    const player: PlayerLike = {...base(), seconds: 2, duration: 4};
    if (isTimedPlayer(player)) {
      const progress: number = player.seconds / player.duration;
      expect(progress).toBe(0.5);
    } else {
      expect.unreachable('player should be timed');
    }
  });
});
