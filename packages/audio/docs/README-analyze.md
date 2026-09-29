# Archived package note

This document preserves its original package-era evidence. See the
[notes index](README.md) for current reference owners, and
[STATUS](../../../dev/STATUS.md) for this checkout.

<!-- docs:historical-body -->

# @webaudio/analyze

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current analyze API reference](../../../apps/doc/webmusic/src/content/docs/audio/api/analyze.mdx); [Current analyze Web Components](../../../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#analyze); [Current analyze Headless reference](../../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx#analyze).
> See the [archive index](README.md) for scope, the
> [contributor index](../../../dev/README.md) for current rules, and
> [STATUS.md](../../../dev/STATUS.md) for active work.

<!-- docs:historical-body -->

---

Reusable digital-audio analysis algorithms, code-driven analysis sessions and
styled Web Components.

- **`/core` (internal)** — stateless algorithms for peaks, loudness, spectrum,
  onsets, key, tempo, pitch and feature extraction.
- **`/api`** — one-shot analysis options/results, transcription and worker
  controls.
- **`/headless`** — `createAudioAnalysisSession` for incremental analysis and
  `createRealtimeAnalyzer` for code-controlled live measurements. They return
  analysis data and never create or style UI.
- **`/element`** — styled Web Components: the headless `<audio-analysis>`
  runner plus `<audio-analysis-view>`, `<audio-clip-summary>`,
  `<audio-analysis-timeline>` and `<audio-histogram>`.

```ts
import {createAudioAnalysisSession} from '@webaudio/analyze/headless';

const session = createAudioAnalysisSession(clip, {
  tasks: ['peaks', 'loudness', 'tempo', 'key'],
});
const result = await session.analyze();
console.log(result.tempo?.bpm, result.key, result.loudness.integratedLufs);
```

High-precision MIR, transcription and alternate engines remain optional peer
dependencies. MIT.
