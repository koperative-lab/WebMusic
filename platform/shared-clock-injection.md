# Shared session clock: injection and scheduling boundaries

**Accepted direction: one music session has one authoritative timeline, shared by
Score and Audio; multiple sessions may remain independent.** This note defines
the gap between current coordination and a same-instance clock contract. It is
not documentation for an already callable injection API. The
[platform ledger](README.md) records shared ownership; the
[Score architecture](../packages/score/ARCHITECTURE.md) and the unit definitions
below explain the timing boundaries. Source contracts and tests establish the
implemented behavior in this checkout. Only Kernel and Score portions are present
here; Audio and Bridge source, tests and public references have not been migrated.
References to their engines or factories below describe the accepted integration
target, not callable APIs in this checkout.

## Current implementation

| Concern | Implemented | Does not imply |
|---|---|---|
| Shared time math | Kernel `TransportClock`: explicit reference time, affine position, pause and future origin. | All players use the same object. |
| Readable authority | `TransportClockReader`, exposed by an owner to followers, groups and views. | Write authorization or anchor-invalidation notification. |
| Coordination | Kernel `TransportGroup` selects one structural master and coordinates N followers. | Bridge adapters or either Score/Audio master pairing in this checkout. |
| Command observation | Group `dispatch`, `snapshot` and `subscribe` expose revisioned invalidation and command outcomes. | Bridge forwarding, shared writable clock injection, acoustic success or sample-accurate loop boundaries. |
| Reference time | Kernel coordination accepts an injected reference-time reader. | A common `AudioContext` automatically means a common work position, or timestamps from separate contexts are interchangeable. |
| Live transports | The Score scheduler creates a clock; clockless masters can use a Kernel mirror. | An Audio buffer engine or shared transport instance in this checkout. |

Current source entry points:
[transport.ts](kernel/src/transport.ts), [sync.ts](kernel/src/sync.ts),
[score-player-scheduler.ts](../packages/score/src/play/headless/score-player-scheduler.ts).
The [cross-domain architecture](../dev/ARCHITECTURE.md) owns the future
Audio/Bridge boundary.

Same-instance injection would let both engines consume one session anchor instead
of private anchors requiring coordination. Current construction and scheduling
assume private ownership; replacing an object reference alone is insufficient.

## Reference time, session axis and domain mapping

`AudioContext.currentTime` is audio reference time; transport position locates the
work. Pause and seek change the relationship. Context suspension stops reference
time itself, so JS timeouts, UI animation or elapsed wall time cannot stand in for
played time.

Score clock positions are **nominal score seconds** at the default tempo scale.
Audio buffer clock positions are **unwrapped clip seconds**. Score quarters,
tempo and meter pass through `TimeMap`; Audio beat indices pass through `BeatGrid`;
sample indices also need a sample rate. These are not interchangeable bare numbers.

The Kernel command protocol uses the selected master's stable content axis, with an
explicit reference time, origin and rate. Score-mastered groups use nominal score
seconds; future Audio-mastered groups use clip seconds. New position/seek commands never
reinterpret that axis as duration divided by playback rate.

A follower can map this axis affinely: `local = offset + position * positionScale`,
with the same scale applied to its playback rate. The default scale is one.
Arbitrary nonlinear rubato alignment remains a separate mapping contract;
publishing `TimelineMapping` does not make it an input accepted by the group.

Session isolation does not require allocating a new hardware context per session.
Independent sessions may borrow one context, but must not accidentally share a
writable transport. Session identity, resource owner and command authority must
remain explicit.

## Command authority and observation

The existing `TransportGroup` is the session command authority; the intended
Bridge `ScoreAudioSync` delegates to it after migration. Callers use
`dispatch(command)` when they need a
settled result, and `subscribe()` for an initial snapshot and subsequent command
observations. A command result distinguishes committed work from work superseded
by a newer command or disposal. Failures use the documented rejection/error
channel. The [public Kernel reference](../apps/doc/webmusic/src/content/docs/kernel/api.mdx)
owns exact current event payloads; a future Bridge reference must document its
forwarding contract.

Invalidation is emitted before participant mutation. Existing participant commands
perform their own cancellation and re-arming; a successful command describes the
supported transport outcome rather than proving sound reached an output device.
Consumers use the committed snapshot, and distinguish pending feedback from the
owner's resulting position. Autonomous scheduling and native-device limitations
remain governed by the participant contract.

These additions keep one authority around the existing engines. They do not
replace their private clock instances, or make a pure clock reader capable of
cancelling sound. Direct commands to a participant bypass group arbitration and
must not compete with the group while it owns the coordinated session.

## Injection also requires invalidation

`TransportClock` has no listener, epoch or version; it is pure time math. The
Score engine commits sound ahead of its onset; the Audio integration target does
the same:

- Score submits absolute `audioStart` values inside its lookahead to backends
  supporting scheduled cancellation, retaining a record per voice occurrence.
- A future Audio buffer engine creates a buffer source and calls
  `source.start(when, offset)`.

Moving the anchor can invalidate future notes, source origins or releases computed
under the old anchor. The current Score engine mutates its own clock and retracts or
reschedules its own sound; the group coordinates participant commands. If two
engines directly share a writable object, A's seek/rate/pause can invalidate B's
commitments without notifying B. A more accurate clock read cannot retract work
already submitted to the audio system.

Same-instance injection therefore requires **one writer, invalidation delivery and
rescheduling in each engine**. The concrete combination of reader, epoch and
callback remains to be designed and verified. The accepted single-authority
session direction is no longer an undecided alternative.

## Required protocol properties

These are design and acceptance requirements, not methods already provided by
`TransportClock`.

1. **One command authority.** A session owner handles play/pause/seek/rate/loop;
   participants and views submit commands or read time. Score or Audio can be
   master, but a session cannot have competing writers without arbitration.
2. **Identifiable commits.** Each anchor change has a generation/epoch or
   equivalent protocol, with its reference time and new mapping. Stale asynchronous
   work cannot overwrite newer state.
3. **Invalidate committed work.** Score cancels future voices and retimes releases;
   Audio cancels/replaces sources. Distinguish sounding and future work to avoid
   duplicate attacks or cancelling the wrong overlapping occurrence of a pitch.
4. **Order preparation and re-entry.** Resume, sample preload, external callbacks,
   disposal and interruption preserve the final user intent. A shared object does
   not replace command FIFO, generations or resource cleanup.
5. **Explicit lifetime.** Injected session clocks/contexts remain caller-owned
   unless an API explicitly transfers ownership. Detaching a follower cannot
   destroy its session. Closing a session cancels participant work and
   subscriptions without affecting another session.
6. **Visible capability differences.** Backends without future scheduling or
   cancellation, media elements and external clocks need explicit degraded
   contracts; coordination cannot confer buffer-engine timing precision on them.

A conductor/group wrapper around the pure clock can carry these responsibilities;
changing the clock itself is another implementation option whose effect on purity,
tests and public types must be assessed. Record the selected shared protocol and
its rationale alongside the owning public contract; keep domain integrations
consistent with that protocol.

## The two loop problems

Kernel `TransportGroup` currently detects a loop boundary on a watcher tick,
then schedules a shared re-entry through seek. A common origin can align
schedulable participants;
it cannot make an already passed boundary wrap on time. The default watcher
cadence is approximately 25 ms and lead-in 60 ms. These are nominal settings,
not an 85 ms worst-case bound under browser throttling, suspension or preparation.

Sample-accurate wrap requires committing the next pass before the boundary and
defining both sides of its mapping:

- Score lookahead across a boundary needs the next pass's own reference basis,
  with ties, crossing releases, seek/rate cancellation and re-entry accounted for.
- The Audio integration design uses native source looping inside the audio
  system, while its clock stays unwrapped and `currentTime` applies loop-window
  modulo. Reading
  the unwrapped clock as a wrapped session position introduces whole-loop errors.
- `TransportGroup` now accepts `FollowerOptions.loop` metadata for participants
  already configured to loop natively. The group maps its continuous master axis
  through `offsetSeconds` and positive `positionScale`, then folds at the local
  loop end. Join/seek targets use that phase; drift normalizes unwrapped or wrapped
  native clocks and compares circular phase error in master units. Each follower
  may have a different period. This does not configure native looping, schedule
  the group boundary in advance, or implement nonlinear warping.

The accepted Bridge factory contract for `createSyncedPlayback` and
`createAudioMasteredPlayback` rejects defined `clipOptions.loop` and
`clipOptions.rate` before acquiring resources and uses the group's `setLoop()`
and `setRate()` controls. These factories are not available here. This rule does
not establish a shared injected clock or sample-accurate cross-domain loops;
see the [cross-domain architecture](../dev/ARCHITECTURE.md).

## Implementation impact and acceptance evidence

| Owner | Responsibility to verify |
|---|---|
| Kernel | Session write protocol, read-only access, invalidation and isolation, retaining domain neutrality. |
| Score | No unauthorized anchor mutation after injection; retract/retime future voices; context freeze must not publish an onset merely because wall time advanced. |
| Audio | Source replacement consistent with the reference origin; explicit unwrapped/looped positions; stop/dispose cancels pending sources. |
| Bridge | Domain axes and offset/mapping, both master directions, compatibility with clockless adapters; reuse generic coordination. |
| UI / Element | Bind the chosen session's reads and commands; unmount must not reset borrowed playback rate or destroy the session. |

Acceptance needs real ScorePlayer and AudioClipPlayer integration as well as
isolated clock tests: non-1× rates, offsets in both start/seek directions, context
suspend/resume, preload crossing a proposed origin, repeated commands and callback
re-entry, asynchronous settlement during disposal, independent sessions, and
commitments on both sides of a loop. Audio precision needs submitted absolute times
and rendered/audible evidence; UI callback timing is not a substitute.

A shared anchor may reduce mirror and drift correction needs. It does not
automatically remove backend delay, external-clock error, preparation headroom or
concurrent cancellation. Deleting drift monitoring or lead-in negotiation is not
an unverified benefit to promise in advance.

## Observing reconciliation and independent native loops

The implemented authority publishes an initial coherent snapshot, command
invalidation and commit/error events. Background follower joins and drift
corrections also increment revision and emit `reconcile` invalidation/settlement;
`operation-error` exposes their failures alongside the existing callback. A master
stopping naturally without an active group loop is reconciled through the same
observed pause path; an active group loop wraps and restarts instead. Revision
identifies the latest group authority; it does not count arbitrary mutations made
directly on a participant. Display animation reads the current snapshot/clock;
subscribers are not a musical ticker.

Independent native loops preserve one continuous session coordinate while mapping
each follower to its own phase. Native-loop metadata is copied on registration;
its bounds must match the actual participant configuration. A non-unit local
scale requires rate control and applies to both future seek positions and rate.
The intended Bridge factory contract rejects clip-local loop overrides;
applications requiring separate periods use explicit Kernel follower adapters.
The current reference owner is [Kernel API](../apps/doc/webmusic/src/content/docs/kernel/api.mdx).

Fake-clock regression evidence covers non-unit-rate stable seeks, awaited startup
and pause reconciliation, stale-command/observer re-entry, failures, natural stops,
watcher group loops and differing native-loop periods. It does not establish audio
output precision, background browser/device behavior, nonlinear time stretching,
or same-instance engine clock injection.
