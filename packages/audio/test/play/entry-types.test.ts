import {describe, expectTypeOf, it} from 'vitest';
import type {AudioPlayerEvents, AudioPlayerOptions, AudioPlayerSourceDetail, AudioPlayerTransport} from '../../src/play';
import type * as Headless from '../../src/play/headless';

// `typecheck:tests` compiles this file: the documented `@webmusic/audio/play`
// table lists these Headless types as exports of that exact entry.
describe('@webmusic/audio/play type exports', () => {
  it('re-exports the player option, event, source and transport types', () => {
    expectTypeOf<AudioPlayerOptions>().toEqualTypeOf<Headless.AudioPlayerOptions>();
    expectTypeOf<AudioPlayerEvents>().toEqualTypeOf<Headless.AudioPlayerEvents>();
    expectTypeOf<AudioPlayerSourceDetail>().toEqualTypeOf<Headless.AudioPlayerSourceDetail>();
    expectTypeOf<AudioPlayerTransport>().toEqualTypeOf<Headless.AudioPlayerTransport>();
  });
});
