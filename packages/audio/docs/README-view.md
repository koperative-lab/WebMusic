# Archived package note

This document preserves its original package-era evidence. See the
[notes index](README.md) for current reference owners, and
[STATUS](../../../dev/STATUS.md) for this checkout.

<!-- docs:historical-body -->

# @webmusic/audio/view

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current view API reference](../../../apps/doc/webmusic/src/content/docs/audio/api/view.mdx); [Current view Web Components](../../../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#view); [Current view Headless reference](../../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx#view).
> See the [archive index](README.md) for scope, the
> [contributor index](../../../dev/README.md) for current rules, and
> [STATUS.md](../../../dev/STATUS.md) for active work.

<!-- docs:historical-body -->

---

Code-level audio view models, browser renderers, and the five styled view
Web Components.

- **`/headless`** — `AudioTimeline`, waveform/spectrogram view models and meter
  calculations. These return data and update code state; they do not create or
  mutate a browser surface.
- **`/render`** — explicit browser adapters: Canvas waveform/spectrogram,
  loudness meter, Audio timeline chrome, viewport synchronization, pointer
  hit-testing and player binding.
- **capability root** — shared option/data contracts, colormaps and viewport math.
- **`/element`** — five styled Web Components with their packaged styles:
  `<audio-view type="waveform|spectrogram|meter">`, which owns its geometry
  privately and publishes it as `zoom` / `setZoom()` / `panTo()` /
  `visibleRange()`; `<audio-clip-thumbnail>`, `<audio-minimap>`,
  `<audio-live-view type="waveform|spectrogram">` and `<audio-region-list>`.

```ts
import {createWaveformViewModel, bindPlayerToAudioTimeline} from '@webmusic/audio/view/headless';
import {computePeaks} from '@webmusic/audio/analyze';

const peaks = computePeaks(clip.channels()!, clip.sampleRate);
const view = createWaveformViewModel(peaks, {viewportWidth: 800, pixelsPerSecond: 120});
const binding = bindPlayerToAudioTimeline(player, view.timeline, {followPlayhead: true});

drawColumns(view.columns()); // your framework/native/canvas renderer
binding.unsubscribe();
```

`<audio-view>` directly mounts `@webmusic/ui/stage` and composes its renderer
with one `AudioTimeline` it creates on first use and keeps for its whole life.
That timeline is private: callers reach it only through `zoom`, `setZoom()`,
`panTo()` and `visibleRange()`, and a subclass reseeds it by overriding the
protected `createTimeline()` hook. The `meter` type leaves the timeline dormant
and renders through the `AudioMeterController`-backed meter facade.

For an imperative browser surface, import `renderWaveformVisualizer` or
`renderSpectrogramVisualizer` and `bindPlayerToWaveform` from
`@webmusic/audio/view/render`. Both time-axis renderers report the window they
painted through `viewport()` and `onViewportChange()`, and take a new one
through `setOffset()` and `setZoom()` — drive a Headless `AudioTimeline` from
that pair to keep a separate overview in step. `mountAudioTimeline()`'s
optional `viewport` option and `bindAudioTimelineViewport()` speak the stricter
`AudioViewportHandle` contract instead: a measured-geometry adapter the caller
supplies, not the renderer handle above. The mounted accessible ruler, region
and seek chrome needs the optional `@webmusic/ui` peer — as does this entry's
loudness meter. The borrowed timeline and renderer must represent the same
duration; detach the binding before disposing the renderer. `<audio-view>` owns
a private timeline that no adapter can borrow, so pair standalone chrome with a
standalone renderer and keep one player/follow owner per composition.

MIT.
