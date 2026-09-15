# @webmusic/kernel

The domain-neutral contracts and runtime utilities used by `@webmusic/score`
and custom WebMusic integrations. It knows nothing about scores or clips —
no `Note`, no `Score`, no `AudioClip`, no `BeatGrid`.

```text
@webmusic/score ── required peer ──→ @webmusic/kernel
                                         ↑
custom players, effects and timelines ────┘
```

Zero dependencies, zero peer dependencies, ESM + CJS, `sideEffects: false`,
one subpath export per module. Score declares it as a required
peer so applications select a compatible shared implementation. UI does not depend
on Kernel. Package resolution does not allocate shared runtime objects: a shared
Kernel package, an AudioContext and a session TransportClock are three distinct
things. See the [session-clock design boundary](https://github.com/koperative-lab/WebMusic/blob/main/platform/shared-clock-injection.md).

The first-release packages are Kernel, UI and Score. Audio and Bridge continue
on the [`dev` branch](https://github.com/mrsteamedbun/WebMusic/tree/dev);
the cross-domain examples below describe those shared contracts.

## Install and use

```sh
npm install @webmusic/kernel
```

Node.js 22 or later is supported. Import a subpath for the capability you need;
the root re-exports all ten modules. CommonJS uses the same paths with `require()`.
Importing the package creates no context, worker, timer or custom-element
registration. Browser operations still require their corresponding Web APIs.

```ts
import {TransportClock} from '@webmusic/kernel/transport';

const clock = new TransportClock();
clock.start(0, 4);            // Reference time 0, content position 4.
clock.setRate(2, 1);          // Position remains 5 at reference time 1.
console.log(clock.positionAt(2)); // 7
clock.pause(2);              // Position now holds at 7.
```

The clock allocates no resource and needs no disposal. In contrast, owners of
tick sources, transport groups and analyser taps must call their `dispose()`.
TypeScript declarations for browser contracts use DOM types; pure `/events`
and `/transport` imports also work with an ES-only TypeScript `lib`.

## What qualifies as kernel code

The admission rule, enforced by review against the ledger in
[`platform/README.md`](https://github.com/koperative-lab/WebMusic/blob/main/platform/README.md):

> Code qualifies for the kernel only if **two drifting copies of it already
> exist**, or it is a **contract both domains must implement**.

Review new work against existing modules before adding another shared mechanism.
The ledger records the extraction boundary, including the role-contract basis for
`kernel/sync`. Keep an extraction's justification and retained domain policies in that ledger.

The counterpart rule matters as much: **policy that legitimately differs
between the families stays with the families.** The kernel carries the
`AudioContext` constructor lookup but not ownership, liveness validation or
close-on-dispose; the `Effect` shape but not chain/insert helpers, whose
dispose and rollback semantics differ by design; the `WorkerLike` surface and
request correlation but not protocol versioning, cancellation or restart
policy. Pulling those in would not remove duplication — it would force one
family's semantics onto the other.

## Module map

| Entry | Contract |
|---|---|
| `@webmusic/kernel/events` | Hardened typed `EventEmitter` |
| `@webmusic/kernel/element` | `WebMusicElement` connected-lifetime cleanup plus SSR-safe attribute and registration helpers |
| `@webmusic/kernel/worker` | `WorkerLike`, `RequestTracker` correlation plumbing, `dedicatedWorkerScope()` |
| `@webmusic/kernel/audio-context` | SSR-safe AudioContext construction |
| `@webmusic/kernel/player` | `PlayerLike` playback control contract, capability tiers + guards |
| `@webmusic/kernel/effect` | `Effect`/`EffectNodes` over `BaseAudioContext` |
| `@webmusic/kernel/meter` | `AnalyserMeter` tap, RMS/peak with peak hold, `aggregateSpectrumBars` |
| `@webmusic/kernel/transport` | `TransportClock` affine anchor math + `TimelineMapping` |
| `@webmusic/kernel/tick` | Throttling-resistant tick delivery for lookahead schedulers |
| `@webmusic/kernel/sync` | `TransportGroup` master/follower choreography + `MirrorClockMaster` |

Internally the kernel is almost entirely flat: every module is a leaf except
`sync`, which composes `transport` and `tick`.

```text
transport ──┐
            ├──→ sync          events   element   worker
tick ───────┘                  audio-context   player   effect   meter
```

That shape is intentional. A module that imports a sibling has taken a
position on how the sibling is used; nine independent leaves let a consumer
adopt the parts it needs — and let a third party implement the contracts
without inheriting the machinery.

## Design principles

These recur across the modules and explain most of the local decisions.

**Player, effect and mapping contracts are structural.** Consumers satisfy these
interfaces by shape without inheriting a shared domain base class. The optional
`WebMusicElement` lifecycle base serves a separate browser composition concern. `AudioClipPlayer`
and `ScorePlayer` satisfy `PlayerLike` without either knowing the other
exists; an `Effect` crosses families because it has `createAudioNodes`. Two
consequences are load-bearing: contract members use method-shorthand syntax
so that method bivariance lets a typed-emitter `on<K extends keyof E>(…)`
satisfy the loose `on(event: string, …)` (arrow-property signatures would
reject every typed-emitter implementer under `strictFunctionTypes`), and
families pin their conformance in type-only `*-contract.ts` modules so drift
fails at the definition site rather than at some distant call.

**Optional capability, named and guarded.** `PlayerLike`'s optional members
are the lowest common denominator both families can always promise. Each
optional capability is *named* by an interface — `TimedPlayerLike`,
`StatefulPlayerLike`, `RateControlledPlayerLike`, `VolumeControlledPlayerLike`,
`DisposablePlayerLike` — and feature-tested through an exported `is*Player()`
guard. Implementers advertise a capability by making its members
non-optional; consumers narrow once with a guard instead of poking optional
members everywhere, and a failed guard means "absent", never "error".

**Purity, with time injected.** `TransportClock` never reads a clock unless
one is handed to it; every mutator takes the current reference time
explicitly. `TransportGroup` takes `now()` as a constructor argument and is
Web-Audio-free. `RequestTracker` is bookkeeping with no worker attached.
`aggregateSpectrumBars` is a pure function beside the live meter. This is what
makes the timing core testable against a counter and reusable against
`AudioContext.currentTime`, `performance.now()/1000`, or an offline render.

**Numbers in, numbers out — units are the consumer's.** The clock is
unit-agnostic: it maps a monotonic reference axis onto a position axis and
takes no view on whether positions are media seconds, nominal seconds or
samples. Clamping to a duration is domain policy. Loop is out of scope
(a consumer can wrap with `seekTo(loopStart, t)`, or maintain a separately mapped
local loop phase). The kernel's job is to be the one place the affine math is
correct, not to decide what the axis means.

**SSR-safe at import.** `HTMLElementBase` resolves to `HTMLElement` where it
exists and a plain class elsewhere, so an element module can be imported in
Node without a `ReferenceError`; `defineOnce` is a no-op outside a browser;
`getAudioContextConstructor()` returns `undefined` rather than throwing;
`dedicatedWorkerScope()` returns `undefined` outside a real dedicated worker,
so a worker runtime's registration is inert when the same module is imported
from Node, SSR or the main thread. Importing any entry has no side effects.

**Degrade transparently, never silently.** The tick source falls back from a
worker to a main-thread interval when `Worker`/`Blob`/`URL` are missing, when
CSP rejects the blob worker synchronously, and when the worker fails
asynchronously after construction — same surface either way, with
`workerBacked` telling the truth about which path is live. What the kernel
avoids is the failure mode where a component reports success and then does
nothing.

## The clock spine

`transport` + `tick` + `sync` are the part of the kernel the rest of the
project's alignment rests on. They are three separate concerns: what time
*is*, how work gets *woken up*, and how several transports *agree*.

### TransportClock — one affine anchor

```text
position(t) = paused ? originPosition
                     : originPosition + (t - originTime) * rate
```

Four numbers (`originTime`, `originPosition`, `rate`, `paused`) and a handful
of transitions that all preserve position continuity:

- `start(t, position?)` anchors and unpauses; re-anchoring while playing is
  idempotent for the position at `t`.
- `pause(t)` folds elapsed time into `originPosition`.
- `seekTo(position, t)` re-anchors while preserving the paused/playing state.
- `setRate(r, t)` re-anchors at `t` first so the position is continuous
  across the slope change. `r` must be finite and `> 0`.

Every anchor mutator rejects non-finite input. A `NaN` reference time or
position would otherwise flow into the anchor and poison every later
`positionAt` read with no error at the source — the kind of corruption that
surfaces three layers away from its cause.

`timeAt` is the inverse, and it throws rather than inventing an answer where
none exists: while paused, no reference time maps to a position at all.

### Scheduled starts and the pre-roll hold

`startAt(t, position)` arms a *scheduled* start: the clock is unpaused, but
the position holds at `position` until `t` arrives — the clock-side mirror of
a sample-accurate `source.start(when)`, which sounds nothing before `when`.
The hold is what lets a follower join a master at an instant that has not
happened yet.

Transitions during the pre-roll keep the armed origin: `setRate` changes the
slope after `t` without collapsing the hold (naively re-anchoring at `t` here
is the engine bug this mode exists to prevent), `seekTo` re-arms the held
position, and `pause` cancels the pending start. `timeAt` refuses positions
below the armed origin, because a holding clock never passes through them —
extrapolating backwards would hand a follower a confident, schedulable, wrong
answer.

### TransportClockReader — sharing without ownership

```ts
type TransportClockReader = Pick<TransportClock,
  'state' | 'rate' | 'paused' | 'holding' | 'positionAt' | 'timeAt'>;
```

The reader is what a transport *owner* exposes to consumers: a sync group,
a view, a follower can anchor against its affine map without estimating that map
from sampled positions. The reader exposes no mutator in its TypeScript surface;
it is not an immutable snapshot or a runtime access-control boundary. It also
provides no anchor-change notification. Exact mapping reads do not confer audio
scheduling precision on a backend, timer or UI callback.

The accepted architecture is one timeline authority per session, with independent
sessions. Today's `TransportGroup` supplies a master-based authority while each
engine retains its private clock. Same-instance injection and invalidation of
already committed audio are not implemented by this reader.

### TimelineMapping — the musical-axis seam

`TransportClock` is affine, so it cannot express tempo curves, and it should
not try. `TimelineMapping` is the two-function seam where a musical axis
(quarters, beats — the consumer names the unit) meets media seconds:

```ts
interface TimelineMapping {
  positionToSeconds(position: number): number;
  secondsToPosition(seconds: number): number;
}
```

Implementations should be total over the reals and monotonic non-decreasing;
they may clamp negatives and may quantize, so round-trips are approximate by
the mapping's own policy. Both families ship an adapter (`timeMapMapping`
over score's `TimeMap`, `beatGridMapping` over audio's `BeatGrid`), which is
what makes the two musical axes interoperable through seconds.

### TickSource — keeping schedulers fed

The tick source uses an inline Blob worker to reduce reliance on main-thread
intervals under background throttling. It posts a bare tick on an interval and
needs no separate asset. This is a wakeup mechanism, not a real-time guarantee:
worker suspension, delivery to the main thread and browser lifecycle policy can
still delay scheduling. Environments without `Worker`/`Blob`/`URL`, or with a CSP
that forbids blob workers, fall back to a main-thread interval.

The surface is deliberately tiny: `start(onTick)` / `stop()` / `dispose()`,
plus `running` and `workerBacked`. It delivers ticks; it holds no opinion
about what the tick does.

### TransportGroup — master, followers, and the join dance

`sync` is the choreography the score↔audio bridge proved out, hoisted once
its class body turned out to reference only kernel types. One **master** whose
clock is the group's timeline, N **followers** that join it, all positions on
the master's axis against one shared reference clock.

```text
master.clock (TransportClockReader)          ← the timeline, read never written
   │
   ├─ join:   when = armed origin if it is still ahead, else now + leadIn
   │          follower.setRate(clock.rate * positionScale)
   │          follower.seek(localPhase(offset + clock.positionAt(when) * positionScale))
   │          follower.play(when)            ← sample-accurate on a real engine
   │
   ├─ drift:  every driftCheckIntervalMs, compare each follower against
   │          mapped local phase; re-join past master-unit tolerance
   │
   └─ loop:   every tick, wrap at the boundary through the same join dance
```

The role contracts encode the design:

- The master **must** expose a `TransportClockReader`. There is no clockless
  code path inside the group — a transport without a clock is wrapped in
  `MirrorClockMaster` instead, so the fallback exists once as an adapter
  rather than as a second branch through every method.
- Scheduled-start support is **observed, not declared**. The group proposes
  `now + leadIn` to `master.play(when)`; a master that can arm does, and the
  group notices through `clock.holding`. A master that ignores the proposal
  starts immediately and followers join a lead-in later. No capability flag
  to keep honest.
- `master.seekPosition` may resolve with the transport left *paused*, which
  the group reads as a failed resume: it pauses the followers, settles into
  the paused state, and reports it — rather than leaving a master stalled
  while followers play on.
- `master.reconcile(now)` is the optional hook an adapter uses to say the
  master stopped on its own (`'stalled'`), which the group handles exactly
  like an observed stop.
- Followers honor future `play(when)` for scheduled alignment, carry an `offsetSeconds`,
  and may expose their own clock — when they do, drift is read from the clock
  instead of sampled.

A join aligns the **slope before the intercept**: it hands the follower the
clock's current rate and only then seeks and schedules. Seeking alone would
leave a rate mismatch intact, so the drift just corrected starts growing back
immediately — the same reasoning that makes `MirrorClockMaster` re-learn a
rate rather than only a position.

Two safeguards keep corrections from becoming pathologies. Drift checks hold
off until a scheduled join's origin has passed, because a follower parked at
its offset through a pre-roll is not drifting. And after
`MAX_CONSECUTIVE_DRIFT_JOINS` (3) corrections that fail to bring a follower
into tolerance, the group stops re-joining it and reports instead — each
correction restarts a follower audibly, so a mismatch corrections cannot fix
must not stutter forever. Any explicit command re-arms the corrections.

The same group now exposes a revisioned command protocol: `dispatch(command)`
returns an observable `TransportCommit`, `snapshot` reads one coherent state, and
`subscribe(listener)` delivers the initial state before following invalidation,
settlement, background reconciliation and errors. Existing controls remain
migration surfaces. Strict dispatch checks observable failures and distinguishes
superseded commands; the engines cancel and re-arm through their existing methods,
retaining their private clocks. See the complete
[command contract](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/kernel/api.mdx).

`FollowerOptions.positionScale` adds a positive constant local-axis scale to the
offset, applied to both positions and rates. Optional `loop` metadata maps into
an already configured native loop; followers can retain independent periods while
the master continues. Drift compares local phase and reports master-axis seconds.
The group does not configure native loops, consume nonlinear mappings or perform
audio warping. Group-level loop re-entry still waits for a delivered watcher tick.

### MirrorClockMaster — the sampled fallback, once

A transport with no readable clock is adapted into the required-clock role by
dead-reckoning a mirror `TransportClock` across the command surface and
reconciling it against the transport's actual position on every drift check:

- two identical position samples while the mirror advanced past tolerance
  mean the transport stopped on its own (ended, clamped, paused out of band):
  pause the mirror and report `'stalled'`;
- a moving transport that diverged re-anchors the mirror — **slope as well as
  intercept**. Correcting only the position leaves a transport that refused or
  clamped the shared rate drifting away again before the next check, which is
  precisely how a rate mismatch turns into an endless correction loop.

## Error and lifetime policy

**Two delivery modes, chosen by the owner.** `emit` propagates a listener's
exception to the caller — the historic behavior, and the right one for code
that wants to know. `emitSafely` isolates subscribers, reports synchronous
throws and rejected promises through an observer, and swallows the observer's
own failures: a diagnostic hook must never become a second path out of a
scheduler callback. Both snapshot their subscribers at dispatch start, so a
listener registered mid-dispatch is not delivered the in-flight event (with
live-set iteration, the ordinary self-rearming `once` idiom is an infinite
loop). `once` also stays single-fire when a listener recursively dispatches the
same event before the outer subscriber snapshot reaches it.

**Generations bound every asynchronous lifetime.** `WebMusicElement` gives
each connected lifetime a fresh cleanup scope, so a cleanup returned by an
`onMount` that synchronously disconnected and reconnected is released against
the lifetime it belonged to rather than attached to the new one; cleanups run
once, in reverse order, and failures are collected and routed through
`onLifecycleError` instead of aborting the rest. `TransportGroup` applies the
same discipline to commands: a FIFO serializes them, a generation counter
invalidates superseded work, and a recorded intent (`playing`/`paused`/
`stopped`) is re-applied when an older async command settles late — so a
`pause()` issued during an in-flight `play()` stays authoritative.

**Fire-and-forget work gets an observer.** Drift and rate re-joins, loop
wraps and stop reconciliation run behind the command queue with no caller
promise to reject; on failure they settle the group into a paused state.
`onOperationError(operation, error)` is how that settlement becomes visible
rather than silent.

## What the kernel deliberately does not do

Recorded so the boundaries are visible rather than discovered:

- **No non-positive running rate.** `rate` must be finite and `> 0`.
  Reverse playback is not represented by a negative rate. Pause holds position;
  applications can implement scrubbing through explicit seeks.
- **No mutable-clock injection.** `TransportClock` remains pure time math with
  no event surface. `TransportGroup` now publishes command invalidation and
  settlement, but each engine still owns its clock; direct mutations outside
  the group are not automatically versioned. See
  [`platform/shared-clock-injection.md`](https://github.com/koperative-lab/WebMusic/blob/main/platform/shared-clock-injection.md).
- **No nonlinear mapped alignment.** `TimelineMapping` is published and both
  families ship adapters. The group consumes constant offset/scale and optional
  native-loop phase, not nonlinear rubato or audio-warp mappings.
- **No shared tick.** `TickSource` is single-callback by contract, so each
  consumer owns a worker; several transports in one page mean several
  workers.
- **No loop inside the clock.** Wrapping is `seekTo(loopStart, t)` at the
  consumer, where the domain's boundary policy lives. Group loops currently
  detect boundaries on ticks and do not promise sample-accurate wrap.

## Using the kernel from outside

Third parties implementing a WebMusic-compatible player, effect, or timeline
mapping should depend on this package and implement the structural contracts.
For players, implement the `PlayerLike` base plus whichever capability tiers
you can honestly advertise (`TimedPlayerLike`, `StatefulPlayerLike`,
`RateControlledPlayerLike`, `VolumeControlledPlayerLike`,
`DisposablePlayerLike`); consumers discover capabilities through the
exported `is*Player()` guards, never by poking optional members.

To take part in synchronized playback, implement `SyncFollowerTransport`
(honor `play(when)` sample-accurately) or `SyncMasterTransport` (expose a
`TransportClockReader`; wrap a clockless transport in `MirrorClockMaster`).

## Gates

The multi-entry build explicitly enables code splitting for both module formats.
This keeps root/subpath re-exports identical within ESM and within CommonJS,
including the `TransportClock` created by `MirrorClockMaster`. ESM and CommonJS
remain separate module instances; cross-format constructor identity is not promised.

The kernel is a first-class checked package: its policy declares zero
workspace dependencies, so any domain import inside `platform/kernel` fails
the architecture gate. Public entries are verified against the export map,
and the whole repository runs `npm run check`. The current command graph is in
[root package.json](https://github.com/koperative-lab/WebMusic/blob/main/package.json); development instructions are in
[CONTRIBUTING.md](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md). The executable architecture sources
include [package-policy.mjs](https://github.com/koperative-lab/WebMusic/blob/main/scripts/package-policy.mjs),
[element-composition-policy.mjs](https://github.com/koperative-lab/WebMusic/blob/main/scripts/element-composition-policy.mjs) and
[check-architecture.mjs](https://github.com/koperative-lab/WebMusic/blob/main/scripts/check-architecture.mjs), each with a distinct
scope. Check the exported contracts and relevant behavioral tests when changing them.

The extraction ledger — what moved here, from where, what it replaced, and
what deliberately stayed per-family — lives in
[`platform/README.md`](https://github.com/koperative-lab/WebMusic/blob/main/platform/README.md).

## License

MIT

For source contributions and release verification, see the
[contribution guide](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md).
