# @webmusic/bridge

Compose `@webmusic/score` and `@webmusic/audio` under one Session, with offline
rendering and timeline/note conversion. Score and Audio remain independent
packages; Bridge supplies the integration between them.

## Playback

`createScoreAudioSession(score, clip, options?)` puts a Score engine and an Audio
clip player under one `SessionTransport` — the single command authority of
modular composition (DEC-068). Each engine is a Session participant mapped onto
its own axis (`score-nominal-seconds`, `clip-seconds`) with explicit
`scoreOffsetSeconds`/`scorePositionScale` and
`clipOffsetSeconds`/`clipPositionScale`. Command it through `session.play(when?)`,
`pause()`, `stop()`, `seek()`, `setRate()`, `setLoop()` or `dispatch(command)`;
`dispose()` releases both engines, the Session and a context it created.
`registerAudioParticipant(session, player, options)` registers any Headless Audio
engine on the shared `clip-seconds` axis.

The former `ScoreAudioSync` master/follower family (`createSyncedPlayback`,
`createAudioMasteredPlayback`, `clipAsMaster`, `scoreAsFollower`) is removed in
0.3.0. Native buffer participants schedule from the Session's shared anchor;
other engines follow its commands with explicit timing limits.

`renderScoreToClip(score)` includes a short tail by default, or a longer effect
tail when an effect is selected; render with `{tailSeconds: 0}` when the clip
must end with the score. A `tempo` override changes the clip's time axis — set
`clipPositionScale`, or render at the base tempo and change speed with
`session.setRate()`. For repeated notation, call `expandRepeats(score)` first and
compose that expanded Score.

## Modular projects

`createWebMusicProjectPlugins()` returns exact-version trusted factories for
Score players, Audio players, Rack, bus, effects and Session-relative LFO modules.
Register them in Kernel's `ProjectPluginRegistry` and supply an application asset
resolver to `ModuleProjectRuntime`. The runtime owns a staged graph and Session,
borrows the audio environment, preserves missing-plugin specifications and
restores paused by default. File storage, asset retrieval and undo remain with
the application.

Native participants consume mapped read-only Session anchors with invalidation
epochs and future loop segments. Backend lookahead, media fallback, effect tails
and device latency retain explicit limits. The
[public factory reference](../../apps/doc/webmusic/src/content/docs/bridge/api.mdx)
owns exact IDs, configuration and ports; the
[runnable guide](../../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx)
shows save/load, missing-plugin recovery and keyboard-accessible patch editing.

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

`dispose()` on the composition releases the engines it created and an owned
context. A context passed in `options.context` stays caller-owned.

Kernel, Score and Audio are required peers. Install compatible versions in the
application; Bridge externalizes them. Sharing package implementations does not
itself share live clocks, contexts or players. Bridge boundaries live in
[bridges/README.md](../README.md). Accepted session
time requirements and remaining injection work are described in the
[clock design note](../../platform/shared-clock-injection.md) and
[STATUS.md](../../dev/STATUS.md).

## License

MIT
