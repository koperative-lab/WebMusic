# Archived package note

This document preserves its original package-era evidence. See the
[notes index](README.md) for current reference owners, and
[STATUS](../../../dev/STATUS.md) for this checkout.

<!-- docs:historical-body -->

# @webaudio/play

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current play API reference](../../../apps/doc/webmusic/src/content/docs/audio/api/play.mdx); [Current play Web Components](../../../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#play); [Current play Headless reference](../../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx#play).
> See the [archive index](README.md) for scope, the
> [contributor index](../../../dev/README.md) for current rules, and
> [STATUS.md](../../../dev/STATUS.md) for active work.

<!-- docs:historical-body -->

---

Decode, load, play, mix, record and export digital audio, plus styled playback
Web Components.

- **`/core` (internal)** — reusable codecs, format detection and audio-graph
  contracts.
- **`/api`** — loading, decoding, export and worker controls/options.
- **`/headless`** — code-driven playback components: `AudioClipPlayer`,
  `AudioPlaylist`, `AudioMixer`, `AudioRecorder`, effects and playback engines.
  They operate on audio data/graphs and never create or mutate UI nodes.
- **`/element`** — styled `<audio-clip-player>`, `<audio-playlist>`,
  `<audio-mixer>`, `<audio-clip-recorder>` and `<audio-meter>` components.

```ts
import {loadClipFromUrl} from '@webaudio/play/api';
import {AudioClipPlayer} from '@webaudio/play/headless';

const clip = await loadClipFromUrl('/song.wav');
const player = new AudioClipPlayer(clip);
await player.play();
```

The buffer engine is fully code-driven and sample accurate. Streaming playback
uses a host-supplied `mediaAdapterFactory`; the styled Web Component installs
its browser adapter automatically. This keeps the headless package independent
of any particular UI runtime while preserving long-file streaming.

Heavy decoders, metadata and time-stretch engines remain optional peers. MIT.
