# Shared Session clock and scheduling boundaries

**One music Session has one authoritative timeline.** Score and Audio schedulers
borrow its reference-time anchor; independent Sessions may share an audio context
without sharing transport authority. [DEC-048](../dev/DECISIONS.md#dec-048--session-scheduling-is-a-borrowed-anchor-projects-store-declarative-identity)
records the accepted protocol. [STATUS](../dev/STATUS.md) owns current verification;
the [Kernel API](../apps/doc/webmusic/src/content/docs/kernel/api.mdx) owns exact
public members.

## Layers and ownership

| Layer | Responsibility | Boundary |
|---|---|---|
| `TransportClock` | Pure affine reference-time/position math, pause and future origin. | It has no listeners and cannot retract submitted sound. |
| `TransportClockReader` | Read-only clock view. | A reader alone carries no invalidation protocol. |
| `TransportGroup` | Structural master/follower command sequencing and approximate reconciliation. | Existing callers retain their coordination contract. |
| `SessionTransport` | Source-free Session-seconds writer, preparation and participant lifetime. | A Session owns no source or borrowed player/context. |
| `SessionSchedulingBinding` | Authority identity, epoch, mapped anchor, invalidation and loop segments. | Borrowed schedulers cannot mutate its origin or dispose the authority. |
| Domain scheduler | Schedule and cancel its own notes/sources against an anchor. | Capabilities remain backend-specific. |

Source entry points are [session.ts](kernel/src/session.ts),
[session-scheduling.ts](kernel/src/session-scheduling.ts),
[Score scheduler](../packages/score/src/play/headless/score-player-scheduler.ts)
and [Audio buffer engine](../packages/audio/src/play/headless/engines/buffer-engine.ts).
Bridge owns domain-aware assembly; neutral shared time stays in Kernel.

## Reference time and position axes

`AudioContext.currentTime` is reference time; Session position locates the work.
Pause, seek and rate change their relationship. Context suspension freezes audio
time, so wall-clock timers and UI animation cannot establish that sound played.
Participants must use the same reference-time source as their authority.

Session positions use **Session seconds**. Score positions use **nominal Score
seconds** at the default tempo scale; Audio positions use **clip seconds**.
Registration names the local axis and maps it explicitly:

```text
localSeconds = offsetSeconds + sessionSeconds × positionScale
localRate = sessionRate × positionScale
```

Scale must be finite and positive. Shared scheduling permits a finite negative
offset, allowing an intro before a local source begins. Legacy followers retain
their nonnegative-offset restriction. Domain scheduling clips silent/out-of-range
local positions according to its own source contract.

Score quarters require `TimeMap`; Audio beats require `BeatGrid`; sample indices
require a sample rate. An affine mapping does not infer beat alignment between
performances or implement nonlinear rubato warping. Existing Bridge master/follower
factories retain their declared Score-master or Audio-master axes.

## One writer, explicit invalidation

Callers send play, pause, stop, seek, rate and loop commands to the Session.
`dispatch()` retains committed/superseded outcomes and failures. Participant
commands must not compete with the authority while attached. A scheduling
attachment lends a mapped read-only binding after preparation and returns a lease
that releases only that participant's scheduling relationship.

The binding's authority identity is stable. Its epoch changes when old work
becomes invalid, independently of UI/registry revisions. Notifications are
synchronous and ordered:

1. **Invalidate:** retract future voices, sources and automation derived from the
   previous anchor. Scope cancellation to owned occurrences and scheduled work.
2. **Anchor:** publish the new origin time/position, rate, paused/holding state and
   loop. The scheduler reads that coherent snapshot and arms replacement work.
3. **Dispose:** cancel owned work and detach observers. Borrowed engines and audio
   environments retain their original resource owners.

Scheduling callbacks must complete synchronously. Async preparation finishes
before attachment/start; late work checks its generation before publishing.
Removing a member unregisters it before cancellation, and pending work retains
its engine identity until its lease settles. No older cleanup may pause a newer
owner of the same engine.

A `TransportClock` object shared without this protocol would allow one engine's
seek to invalidate another engine's already submitted `source.start()` or note
onsets silently. The binding supplies one scheduling authority without handing
every engine the writable clock.

## Continuous time and loops

The binding's `clock` remains unwrapped. `positionAt(referenceTime)` folds into
the current loop; `segments(from, to)` divides a future reference-time interval
into local content intervals with explicit epoch and loop iteration. A future
start holds position until its origin time, and segments omit that pre-roll.
Native consumers can prepare the next pass before the current pass ends.

Score lookahead uses those intervals to identify each note occurrence/pass and
submit absolute audio times. Audio buffers can use native source looping where
the mapped loop fits the clip, and segmented scheduling for other supported
windows. Invalidating an anchor stops obsolete scheduled sources/voices before
re-entry. Backend release behavior and retained effects remain separate from
this time mapping.

Legacy `TransportGroup` looping still uses watcher reconciliation. A mixed
Session keeps its continuous native anchor while legacy participants reconcile
approximately. Native timing is not inferred from matching display positions.
The default watcher cadence and lead-in are configuration values, not a bound on
browser stalls or preparation time. A lookahead scheduler can still underrun if
its execution is suspended beyond the prepared horizon.

## Automation, modulation, latency and tails

Session-bound parameter automation uses Session seconds and an explicit repeat
or once loop policy. A seek rebuilds the trajectory at its new position; pause
holds its modeled base. Absolute audio-clock automation remains available for
work that intentionally continues independently of transport. Neither form
measures effective audio-rate values from `AudioParam.value`.

Session-bound cyclic modulation derives phase from the same anchor. Free-running
native modulation retains its independent audio-clock lifetime. The selected
policy must be part of a saved module's configuration, rather than inferred
from whether a panel happens to be visible.

Shared reference time aligns submitted work; it does not compensate arbitrary
plugin delay, external MIDI hardware or output-device latency. Media elements do
not gain future-start or cancellable sample-accurate scheduling through an
adapter. Consumers inspect declared timing capabilities and scheduling mode.

Pause/seek cancels source work, while retained delay/reverb graphs can continue
their tails. Disposal or project replacement may cut those tails. Graph edits
commit and retire at the logical level; Web Audio connection changes are not a
hardware transaction, automatic crossfade or guaranteed click-free switch.
Applications requiring tail drain or latency compensation need explicit backend
support rather than a scheduling claim.

## Acceptance and evidence

Verify real ScorePlayer and AudioClipPlayer integration in addition to pure time
math: non-unit rate and positive/negative offset, suspension/resume, preparation
crossing a proposed origin, repeated commands and observer re-entry, disposal
during async work, independent Sessions and commitments on both sides of loops.
Check epoch-specific cancellation before scheduling a replacement.

Automation and phase tests must distinguish pause/seek/loop behavior from their
free-running alternatives. Rendered sample positions or submitted absolute audio
times establish different evidence from UI notifications. Device/audible
measurement remains necessary for acoustic latency and hardware claims.

Project restore builds a fresh owned Session and graph from serializable state;
it does not restore active voices or transfer a live writable clock. Default
restore remains paused. See [the modular contract](../dev/design/MODULAR-COMPOSITION.md)
for graph ownership and [the runnable guide](../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx)
for application-owned storage and editing.
