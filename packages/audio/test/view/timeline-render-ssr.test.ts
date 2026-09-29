import {describe, expect, it} from 'vitest';

describe('@webmusic/audio/view/render timeline SSR', () => {
  it('evaluates without browser globals', async () => {
    expect(typeof document).toBe('undefined');
    const render = await import('../../src/view/render');
    const headless = await import('../../src/view/headless');
    expect(typeof render.mountAudioTimeline).toBe('function');
    expect(typeof render.createAudioTimelinePresenterBinding).toBe('function');
    expect(typeof render.bindAudioTimelineViewport).toBe('function');

    let snapshot = {
      offsetPixels: 0,
      viewportWidth: 200,
      pixelsPerSecond: 20,
      contentWidth: 200,
      durationSeconds: 10,
    };
    const subscribers = new Set<(value: typeof snapshot) => void>();
    const viewport = {
      get snapshot() {
        return snapshot;
      },
      setViewport(update: {offsetPixels?: number; pixelsPerSecond?: number}) {
        const pixelsPerSecond = update.pixelsPerSecond ?? snapshot.pixelsPerSecond;
        snapshot = {
          ...snapshot,
          pixelsPerSecond,
          contentWidth: snapshot.durationSeconds * pixelsPerSecond,
          offsetPixels: update.offsetPixels ?? snapshot.offsetPixels,
        };
        for (const subscriber of [...subscribers]) subscriber(snapshot);
      },
      subscribe(subscriber: (value: typeof snapshot) => void) {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
      },
    };
    const timeline = headless.createAudioTimeline({
      durationSeconds: 10,
      pixelsPerSecond: 100,
      offsetPixels: 50,
    });
    const binding = render.bindAudioTimelineViewport(timeline, viewport);
    expect(timeline.snapshot.viewportWidth).toBe(200);
    expect(viewport.snapshot.pixelsPerSecond).toBe(100);
    expect(viewport.snapshot.offsetPixels).toBe(50);
    binding.unsubscribe();
    expect(subscribers.size).toBe(0);
  });
});
