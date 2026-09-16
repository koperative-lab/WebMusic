# Playback, state and cleanup

Read the owning reference for the selected implementation:

- [ScorePlayer engine](https://koperative-lab.github.io/WebMusic/score/headless/play/score-player/)
- [score-player element](https://koperative-lab.github.io/WebMusic/score/element/play/score-player/)
- [Shared playback source](https://koperative-lab.github.io/WebMusic/score/api/#shared-playback-observation)
- [Sound and synth backends](https://koperative-lab.github.io/WebMusic/score/headless/play/sound/)

## Keep a single owner for a composition

Parse once or let the owning player load its source. Related views and analysis
borrow that player's resolved score, snapshot and time through the documented
playback source. A follower subscribes and detaches; it does not dispose its
player. An immutable `Score` is data, not a disposable audio engine.

The `ScorePlayer` engine's `playback` source provides an immediate snapshot and
subsequent updates. Reading this source does not allocate an audio graph.
An element's stable `.playback` source can report loading, ready, failure or
unavailable data as its source changes. Render these states; a failed load is
not a successful empty score. Borrowed controller or Rack modes do not always
have one resolved native score, so check the reference before attaching a
companion that requires it.

Multiple independent pieces may have separate owners. Sharing an `AudioContext`
only shares an audio resource; it does not synchronize player transport state.
Do not claim a coordinated session clock merely because contexts are equal.

## Use the correct position axis

ScorePlayer transport seconds are scaled by playback rate; nominal seconds
refer to the original score timeline. Quarter notes are musical positions,
fractions are normalized positions, and AudioContext time is another axis.
Choose a command and state pair that describe the same axis. For a progress
bar, use the documented `progress` or matching transport seconds and duration.

The Headless `ScorePlayer.currentTime` is a musical `TimePosition`, whereas
the `score-player` element's `currentTime` is transport seconds. Avoid generic
field-name assumptions across these interfaces. Deprecated event aliases also
differ between engine and element; prefer the explicit named time fields.
For an observed nominal seek, the shared source's optional `seekNominal`
reports restart failure through rejection. Check command and error-channel
semantics before assuming a fulfilled direct seek means playback restarted.

## Make audio readiness visible

Begin or resume sound from a user action. Display file-fetch, parse and
backend-preparation errors, and catch failed async commands. An HTTP success
does not prove a sample/worklet is usable. Preloading can prepare resources;
it does not remove the browser's user-activation requirements.

`playScore()` returns a player once playback starts, not when the piece ends.
Retain it for controls and teardown. Use construction without automatic play
when the application needs a prepared player before the user presses Play.

## Track ownership at each boundary

Record who creates and releases the resources the task actually uses:

| Resource | Cleanup rule |
| --- | --- |
| Owned player or Headless controller | Release it when its composition ends or is replaced. |
| Injected audio context, synth or destination | Follow its documented borrowing/ownership option; do not close or globally disconnect another owner's resources. |
| Presenter handle | Destroy its owned DOM, listeners and subscription; the underlying state owner survives. |
| Follower or event subscription | Call its returned cleanup when detaching, even if the player remains alive. |
| Application-created worker, stream or input driver | Use that resource's documented termination/detach contract. |

For ScorePlayer, a supplied synth is borrowed by default; explicitly opt into
owned disposal when the application created it for that player. Its own
default oscillator and internally created context are owned. Native Elements
clean up owned playback when disconnected, while caller-supplied controllers,
racks, contexts and sounds retain their ownership contracts.

Guard async loads and resource preparation against late completion after
replacement or unmount. Release newly created abandoned resources. Ensure a
stale result cannot restore an old score or restart old playback. React
development remounts are useful for exposing cleanup gaps.

## Verify the changed behavior

For an interactive player, exercise valid load, invalid load, play, pause,
the requested seek/rate/loop behavior and unmount or source replacement. A
following view should update while attached and stop receiving updates after
detachment. Exercise keyboard and focus behavior when changing controls.

Compilation confirms imports and types. A browser run can confirm state,
errors and resource cleanup. State separately whether audible output, timing
accuracy and actual device permissions were observed.
