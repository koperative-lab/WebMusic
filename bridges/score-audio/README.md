# @webmusic/bridge

Compose `@webmusic/score` and `@webmusic/audio` through synchronized playback,
offline rendering and timeline/note conversion. Score and Audio remain independent
packages; Bridge supplies the integration between them.

## Playback

- `createSyncedPlayback(score, clip)` / `ScoreAudioSync`: Score drives a decoded
  audio clip on the nominal score-seconds axis.
- `createAudioMasteredPlayback(score, clip)`: a recording or an offline-rendered
  clip with an effect tail drives the Score player on the clip-seconds axis.
  `clipOffsetSeconds` places score-zero inside a recording; the score waits
  through material before that point. Use `scorePlayer.setVolume(0)` when only
  the clip should sound.
- `clipAsMaster` / `scoreAsFollower`: structural adapters for explicit composition.

The factories provide one AudioContext reference to both players and use the
buffer engine. The group coordinates scheduled starts, seek, rate and drift using
the master's readable clock. Players still own separate TransportClock instances;
the same-instance session-clock injection protocol is not yet implemented.
Independent sessions can have separate groups, even when they share a context.

A common scheduled origin allows audio-clock alignment when backends support
future scheduling and are ready before that origin. It does not guarantee UI
callback precision or sample-accurate loop wrap. Group loop boundaries are currently
detected by a tick and followed by a scheduled re-entry. Clockless or just-in-time
backends have weaker timing behavior. See the [integration contracts](../README.md).

Issue transport commands through `sync.play()`, `pause()`, `stop()`, `seek()`,
`setRate()` and `setLoop()`. `setRate()` accepts finite values from 0.25× through
4× and rejects values outside that range. Both factories reject defined
`clipOptions.loop` and `clipOptions.rate` overrides, including `false` and `1`,
before allocating a context or constructing players. Supply a group loop through
`options.loop` or `sync.setLoop()` and change the shared rate with `sync.setRate()`.
Both also reject non-buffer engine/media-adapter overrides and URL-only clips.
These pair factories do not expose independent native-loop phase mapping. Use
Kernel's group with explicitly configured looping participants for that contract.
The buffer engine changes clip pitch when playback rate changes;
`clipOptions.preservesPitch` does not apply to these factories.

`renderScoreToClip(score)` includes a short tail by default, or a longer effect
tail when an effect is selected. Pair that output with
`createAudioMasteredPlayback(score, clip)` so the clip plays through its end.
To keep Score as master, render with `{tailSeconds: 0}`. The Score-master factory
rejects a Bridge-rendered clip with a positive tail instead of silently
stopping it early. Both factories require the original Score instance used for
that render and reject a `tempo` override that changes its time axis;
render at the Score's base tempo and use `sync.setRate()` for coordinated speed
changes. This provenance check applies to the original AudioClip object
returned by one render call; copying or serializing it does not carry that
identity through the API.

For repeated notation, call `expandRepeats(score)` first, then render and pair
that expanded Score instance. `scoreOptions.expandRepeats` would expand only
the player timeline, so the factories reject it for Bridge-rendered clips.

## Conversion

| API | Output and information boundary |
|---|---|
| `renderScoreToClip(score)` | Offline audio samples in an `AudioClip`; notation metadata is not recoverable from samples in general. |
| `beatGridFromTimeMap` | Exact evaluation at sampled beat positions; intervening tempo changes may be lost. |
| `timeMapFromBeatGrid` | Per-interval tempo segments with quarter zero at second zero; callers retain absolute grid offset separately. Original meter is not recovered. |
| `scoreFromTranscription(notes)` | Validated Score from estimated note events, preserving supplied performed timing while quantizing notation; cannot restore information missing from transcription. |

These conversions do not guarantee lossless Audio ↔ Score round-trips. Timeline
sampling is bounded by `maxBeats` (1,000,000 by default); transcription assembly
uses `maxNotes` and `maxMeasures` to bound work.

## Ownership and dependencies

Call the returned `sync.dispose()` to release factory-created players and request
closure of a factory-created context. A context passed in `options.context` stays
caller-owned. Direct `ScoreAudioSync` construction invokes participants' optional
`dispose()` methods when the group is disposed; use non-owning adapters when needed.

Kernel, Score and Audio are required peers. Install compatible versions in the
application; Bridge externalizes them. Sharing package implementations does not
itself share live clocks, contexts or players. Detailed lifetime, fallback and
concurrency contracts live in [bridges/README.md](../README.md). Accepted session
time requirements and remaining injection work are described in the
[clock design note](../../platform/shared-clock-injection.md) and
[STATUS.md](../../dev/STATUS.md).

## License

MIT

## Observing and commanding one session

`ScoreAudioSync.snapshot`, `subscribe(listener)` and `dispatch(command)` expose
Kernel's revisioned command protocol through the existing group. New callers can
await actual play/seek/rate settlement and distinguish failures or superseded
work. Seek positions remain on the stable master axis at every rate. Existing
control methods remain available. The complete contracts and migration boundaries
are in the [ScoreAudioSync reference](../../apps/doc/webmusic/src/content/docs/bridge/headless/score-audio-sync.mdx).

Independent native clip loops are available through explicitly configured Kernel
follower adapters with local offset/scale/loop metadata. The pair factories retain
their clip-loop restrictions; their top-level loop remains coordinated, tick-watched
re-entry. See [Kernel mappings](../../apps/doc/webmusic/src/content/docs/kernel/api.mdx).
