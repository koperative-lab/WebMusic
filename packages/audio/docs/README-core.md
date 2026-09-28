# Archived package note

This document preserves its original package-era evidence. See the
[notes index](README.md) for current reference owners, and
[STATUS](../../../dev/STATUS.md) for this checkout.

<!-- docs:historical-body -->

# @webaudio/core

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current core API reference](../../../apps/doc/webmusic/src/content/docs/audio/api/index.mdx).
> See the [archive index](README.md) for scope, the
> [contributor index](../../../dev/README.md) for current rules, and
> [STATUS.md](../../../dev/STATUS.md) for active work.

<!-- docs:historical-body -->

---

Immutable foundation for the [WebAudio](https://github.com/mrsteamedbun/WebMusic/tree/main/packages/audio) packages.
Zero dependencies.

- **`AudioClip`** — immutable digital-audio clip. Holds per-channel `Float32Array`s (transferable across workers, never an `AudioBuffer`). Zero-copy `slice`, `withRegions`/`withBeatGrid`/`withMetadata`, `toJSON()` (sample-free, structured-clone safe) + `clipFromJSON`.
- **`Region`** — labelled marker/loop span.
- **`BeatGrid`** — beat ↔ seconds mapping (the digital analogue of WebScore's `TimeMap`).
- **`ClipEditSession`** — non-destructive editing (cut / gain / fade / normalize / reverse / insert).
- **`AudioPeaks`** — multi-resolution 8-bit min/max pyramid type + readers + BBC `waveform-data` interop.
- **`EventEmitter`** — tiny typed pub/sub.

```ts
import {AudioClip, createClipEditSession} from '@webaudio/core';

const clip = new AudioClip({sampleRate: 44100, channelData: [left, right]});
const trimmed = createClipEditSession(clip).cut(0, 2).fadeOut(1).normalize(0.98).apply();
```

MIT.
