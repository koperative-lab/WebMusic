# Archived package note

This document preserves its original package-era evidence. See the
[notes index](README.md) for current reference owners, and
[STATUS](../../../dev/STATUS.md) for this checkout.

<!-- docs:historical-body -->

# @webaudio/react

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current react API reference](../../../apps/doc/webmusic/src/content/docs/audio/api/react.mdx).
> See the [archive index](README.md) for scope, the
> [contributor index](../../../dev/README.md) for current rules, and
> [STATUS.md](../../../dev/STATUS.md) for active work.

<!-- docs:historical-body -->

---

Thin React hooks and components over the `@webaudio/*` packages. React is a peer dependency.

- **`useAudioClip(src)`** → `{ clip, loading, error }`
- **`useAudioClipPlayer(clip, options?)`** → `{ player, playing, seconds, duration, progress, play, pause, stop, seek, setRate, setVolume }`
- **`useAudioAnalysis(clip, tasks?)`** → `{ result, analyzing, error }`
- **`useAudioRecorder()`** → `{ recording, level, clip, start, stop }`
- **`<WaveformView clip player />`** — renders a waveform and (optionally) follows a player.

```tsx
import {useAudioClip, useAudioClipPlayer, WaveformView} from '@webaudio/react';

function Player({src}: {src: string}) {
  const {clip} = useAudioClip(src);
  const {player, playing, play, pause} = useAudioClipPlayer(clip);
  return (
    <div>
      <button onClick={playing ? pause : play}>{playing ? 'Pause' : 'Play'}</button>
      {clip && <WaveformView clip={clip} player={player} />}
    </div>
  );
}
```

MIT.
