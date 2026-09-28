# Bridge integration contracts

The reusable integration layer between `@webmusic/score` and `@webmusic/audio`.
The package at [`score-audio`](score-audio/) is named **`@webmusic/bridge`**.
Applications may also compose both domains through public entries; within the
publishable library graph, reusable cross-domain assembly belongs here.

This document specifies roles, timing, conversion and ownership for integrators.
Start with the [package README](score-audio/README.md) for the public capabilities.
Repository rules belong in [ARCHITECTURE.md](../dev/ARCHITECTURE.md), decision reasons
in [DECISIONS.md](../dev/DECISIONS.md), and delivery gaps in [STATUS.md](../dev/STATUS.md).

## 1. Position in the system

```
                    @webmusic/kernel          zero-domain: clocks, ticks,
                   (peer of the three below)     transport group, contracts
                      ▲       ▲       ▲
                      │       │       │
        @webmusic/score   @webmusic/audio      the two families —
              ▲                   ▲            they never import each other
              └────── peer ───────┘
                        │
                 @webmusic/bridge               the ONLY package that may
                (bridges/score-audio)           see both families at once
```

Three rules from [ARCHITECTURE.md](../dev/ARCHITECTURE.md) shape everything here:

1. **Domain isolation.** `score` and `audio` never depend on each other.
2. **The kernel knows no domain.** No `Note`, no `Score`, no `AudioClip`, no
   `BeatGrid` — contracts and pure logic only.
3. **Reusable cross-domain library code lives in `@webmusic/bridge`.**
   Applications and tests may compose both domains through their public entries.

*Enforced by*, not merely documented: the exact dependency tables in
[`scripts/package-policy.mjs`](../scripts/package-policy.mjs) and the
architecture checker, which reject an undeclared workspace import — including
a type-only one — anywhere outside this package.

**Both families are `peerDependencies`.** Applications select compatible versions,
and Bridge externalizes those dependencies rather than bundling private copies.
That package-level arrangement does not share player objects, AudioContexts or
TransportClock instances. Context identity and transport ownership must also be
correct at runtime; the convenience factories establish a common context.
---

## 2. What the package does

The public capability families are:

| Capability | Entry points | Direction |
|---|---|---|
| Synchronized playback | `createSyncedPlayback`, `ScoreAudioSync` | score drives, clip follows |
| Synchronized playback, reversed | `createAudioMasteredPlayback`, `clipAsMaster`, `scoreAsFollower` | recording drives, score follows |
| Offline render | `renderScoreToClip` | symbolic → audio |
| Timeline conversion | `beatGridFromTimeMap`, `timeMapFromBeatGrid` | either way |
| Score assembly | `scoreFromTranscription` | estimated note events → symbolic |

Source map:

| File | Role |
|---|---|
| `src/sync.ts` | Domain assembly for the score-mastered pairing + `ScoreAudioSync`, `createSyncedPlayback`, `renderScoreToClip` |
| `src/audio-master.ts` | Axis-translating adapters for the reversed pairing |
| `src/mapping.ts` | `TimeMap` ↔ `BeatGrid` conversion |
| `src/transcription.ts` | Transcribed note events → a validated `Score` |
| `src/transport-contracts.ts` | Compile-time pins: the real players satisfy the role contracts |

---

## 3. The layering: choreography in the kernel, assembly in the bridge

`TransportGroup` in [`@webmusic/kernel/sync`](../platform/kernel/src/sync.ts)
owns domain-neutral coordination. Bridge adapts real domain players onto its
roles; new pairings should reuse that machinery instead of creating another
command queue or drift monitor. The extraction boundary is recorded in
[platform/README.md](../platform/README.md).

The split today:

| Concern | Lives in |
|---|---|
| Command FIFO, generation guards, intent tracking, rollback | kernel `TransportGroup` |
| Scheduled joins, drift monitoring, loop watching, master-stop reconciliation | kernel `TransportGroup` |
| Mirror-clock fallback for clockless masters | kernel `MirrorClockMaster` |
| Which transport is master, which axis positions are on | bridge adapters |
| Nominal-vs-rate-scaled axis translation, clip offset direction | bridge adapters |
| Shared rate validation (0.25×–4×), construction validation, factories | bridge |

`ScoreAudioSync` wraps a `TransportGroup`. The group serves one required-clock
master and N followers; this package's convenience API constructs a two-player
pair. Its interfaces are structural. The role contracts and coordinator share a
Kernel home, while musical axes and conversion stay here.
---

## 4. The sync design

### 4.1 Roles, not families

The group is defined by role: **one master** whose clock is the timeline, and
**N followers** that join it. Nothing in the kernel knows which family a
participant belongs to; the bridge decides that by construction. Positions are
always on the **master's axis**. This is the current authority for that group;
it is not a process-wide singleton or one TransportClock object injected into all
participants. Independent sessions may use different groups, including groups
sharing one AudioContext reference without sharing work positions:


- score-mastered → nominal score seconds (rate-invariant, the rendered-clip timeline);
- audio-mastered → clip seconds.

This is why reversing the direction needed no second engine — see §5.

### 4.2 The clock is the contract

A master **must** expose a kernel `TransportClockReader`. The group anchors by
*reading* that clock: it is the exact affine map the transport actually plays
by, avoiding estimation from sampled positions. An armed scheduled start is
visible through `holding`. This says how a position is read; audio scheduling
precision still depends on the backend and on committing work before its deadline.

A transport without a clock (TonePlayer, third parties) is wrapped in
`MirrorClockMaster`, which dead-reckons a mirror clock across the command
surface and reconciles it against the transport's real position at drift checks,
or about every 250 ms when follower drift checks are disabled. After the
transport has reported forward movement, a position held long enough to exceed
its observed position step plus tolerance indicates a likely stop; the adapter
reports `'stalled'`. With no observed movement, position alone cannot establish
a stop. A moving transport that diverged re-anchors the mirror — **including its slope**,
not just its intercept, because a transport that clamped or refused the shared
rate would otherwise drift away again before the next check, turning one rate
mismatch into an endless correction loop.

One important integration detail: a master's clock can **appear after construction** (`AudioClipPlayer`
builds its buffer-engine clock on first play), so the adapter reads
`score.clock ?? mirror.clock` live rather than snapshotting — otherwise such a
master would be pinned to the sampled path for life.

### 4.3 Starting: one shared armed origin

```
   t0            t0 + leadIn (0.06 s default)
   │                     │
   ├── play() ──────────►│
   │   master.play(when) │  master arms its clock at `when` (holding)
   │   follower.play(when)  follower schedules its source at `when`
   │                     │
   └── silence ─────────►├──── both use this transport origin ────►
                         │
```

`play()` proposes `now + leadIn` to the master. A master that supports
scheduled starts arms there; the join then takes that armed origin **as-is**,
even inside the lead-in horizon, because the master has not sounded yet. A
master that ignores the proposal starts immediately and followers join a
lead-in later, exactly as before — the group tells the two apart by observing
`clock.holding`, never through a declared capability flag. Seeks and loop
wraps run the same protocol. A common origin is the scheduled transport origin,
not a promise of equal first nonzero samples: the score may begin with a rest, a
backend may only support just-in-time attacks, or preparation may finish after a
proposed timestamp. Use scheduling-capable backends and verify readiness when
sample-level alignment is required.

### 4.4 The join dance

Each (re)join, for every targeted follower:

1. `pause()` — retract whatever was scheduled;
2. **match the slope** (`setRate` to the master clock's current rate) — a join
   that only seeks leaves a rate mismatch intact and the drift it just fixed
   starts growing back immediately;
3. `seek(offset + clock.positionAt(when))` — exact by construction, computed
   from the same affine map the master plays by;
4. `play(when)` — sample-accurate on the buffer engine.

### 4.5 Drift monitoring

One Kernel tick source requests a wakeup every 25 ms. Worker backing reduces
reliance on main-thread timers, but suspension and message delivery can still delay
it. Each delivered tick checks master-stop reconciliation and loop boundaries;
`driftCheckIntervalMs` controls drift checks (250 ms by default).
Setting it to `0` skips follower drift measurements and automatic drift
re-joins. The lightweight watcher still runs while the group is playing to
observe a naturally stopped master and any group loop boundary; it idles after
pause, stop, natural completion or disposal.

Per follower, at reference time `now`:

- **Prefer the follower's own clock** over sampling — an exact read at `now`,
  and `paused` is authoritative where the optional `running` getter may be
  absent entirely.
- Hold off while a scheduled join is still pending: the follower's position
  deliberately parks at its offset through the pre-roll, and reading that as
  drift would cause a correction storm at start.
- **A rate mismatch counts as divergence in its own right**, even at zero
  positional error — otherwise the position correction lands and immediately
  re-diverges.
- Drift is *reported* for every member, running or not (a paused follower is a
  real divergence a caller may want to see), but only corrected for running
  ones.
- **Non-convergence backstop:** each correction restarts a follower audibly.
  After 3 consecutive corrections that fail to bring it into tolerance, the
  group stops re-joining that follower and reports through `onOperationError`
  instead of stuttering forever. Any explicit command, or one check back in
  tolerance, re-arms corrections.

### 4.6 Looping

The loop region lives on the master axis and is enforced **consumer-side**:
a tick watcher detects the boundary and wraps through `seek()`, inheriting the
shared re-entry origin, so both sides leave the boundary together with no
master-only opening per cycle.

The shared re-entry timestamp can align schedulable participants, but the wrap
instant is detected after the boundary rather than committed across it. Nominal
watcher cadence is about 25 ms plus the configured lead-in (60 ms by default);
this is not a worst-case browser latency bound. Browser suspension, delayed tick
delivery and preparation can extend it. Sample-accurate wrap requires a boundary
scheduling and local-loop mapping contract; see §7.

Both `createSyncedPlayback` and `createAudioMasteredPlayback` reject defined
`clipOptions.loop` overrides before allocating a context or constructing players.
A clip looping natively exposes an unwrapped clock while its audible position
wraps, so current adapters cannot treat both as one group axis. Use the factory's
top-level `loop` option or `sync.setLoop()` for group-controlled wrapping.

### 4.7 Reconciling a master that stops by itself

A score player finishing at its natural end pauses and rewinds its own clock,
which can precede the group's boundary watcher. A self-stopped clock while the group means to play either **wraps** (loop
active — the loop's continuation intent outranks the transport's own finish)
or **settles** into the paused state and idles the watcher.

A related asymmetry the group also absorbs: `seekPosition` may resolve with
the transport still paused, because `ScorePlayer` swallows a failed restart
after re-anchoring. The group treats "was running, came back paused" as a
failed resume — it pauses the followers and reports `'resume after seek'`,
rather than seeking a still-running follower out from under a silently dead
master.

### 4.8 The concurrency model

Transport commands are asynchronous (context resume, sample preload), so a
late settlement must never be able to reorder state. Four mechanisms combine:

| Mechanism | Purpose |
|---|---|
| Command FIFO | Serializes commands. The *first idle* command runs synchronously so `master.play()` stays inside the browser's transient user-activation stack; only commands with an async predecessor actually queue. |
| Generation counter | Invalidates work whose command was superseded. Every await re-checks it. |
| `pendingTransitions` | Makes in-flight transitions visible, so `pause`/`stop` can schedule one final reconciliation *behind* an outstanding join and a late `play()` settlement cannot revive playback. |
| Intent | The last user-expressed state (`playing`/`paused`/`stopped`), re-applied when an older async command settles late. |

Legacy controls and background work report asynchronous failures through
`onOperationError(operation, error)` and `operation-error` events. Revisioned
`dispatch()` commands also expose failure through their returned promise. A
failure that still owns the current authority attempts to pause participants;
a superseded failure cannot pause a newer command. Cleanup continues after an
adapter throws, but cannot guarantee that a failing adapter actually paused.
Observer exceptions are swallowed — an observer must never disturb
transport-state handling.

---

## 5. The reverse direction: audio as master

`createAudioMasteredPlayback` drives from a real recording with the notation
following it (score-following, transcription review). It adds **no transport
machinery**: the sync is role-based, and both families now hold both
primitives — `AudioClipPlayer` exposes the buffer engine's clock and arms it
on `play(when)`, `ScorePlayer` accepts scheduled starts and re-anchors.

What the reversal needs is **axis translation**, which is all the two adapters
in `audio-master.ts` do:

1. **Rate-invariant positions.** `ScorePlayer.seek()`/`seconds` are
   rate-scaled; a score follower routes through `seekNominal`/`nominalSeconds`
   instead, or the pairing would silently diverge at any rate but 1×.
2. **Offset direction flips.** `clipOffsetSeconds` is clip time at score-zero.
   With a clip master the follower sits at `masterPosition − offset`, so the
   adapter absorbs the offset (and presents a shifted view of the score clock,
   or every drift check would report the offset itself as drift).
3. **The lead-in region.** A recording may hold material before score-zero — a
   count-in, an anacrusis, room tone — where the score has *no position at
   all*. A scheduled start is deferred by exactly the remaining lead-in, so the
   score enters when the recording actually reaches score-zero instead of
   running the whole take that much early.

One more asymmetry handled there: a clip master's scheduled re-anchor is
expressed as pause → seek → `play(when)`, because the engine's `seek` restarts
immediately while playing and its `play` is a no-op unless paused.

---

## 6. Invariants callers must respect

| Invariant | Why | How it is enforced |
|---|---|---|
| Both players share **one** `AudioContext` reference | Absolute `when` values must have one reference basis | Both factories pass their selected context to the constructed players; direct `ScoreAudioSync` users must ensure compatible participants |
| Buffer engine only | Only it honors `play(when)` sample-accurately and holds a real clock; the media engine accepts and ignores `when` | Factories force `engine: 'buffer'` and **throw** on a conflicting override |
| Clip must carry decoded samples | The buffer engine cannot play a streaming (URL-only) clip | `clip.hasSamples` checked at construction, with an actionable message |
| Group controls looping and rate | Native clip loop positions differ from the group's wrapped axis; independent clip rates bypass group coordination | Both factories omit `loop` / `rate` from their clip option types and reject any defined `clipOptions.loop` / `clipOptions.rate` at runtime, including `false` / `1`, before context/player construction. Use top-level `loop`, `sync.setLoop` and `sync.setRate` |
| Transport commands go through the sync | The returned raw players are for volume/pan/inspection | Documented; direct `setRate` on a player would bypass shared rate validation and group coordination |
| Shared rate stays within 0.25×–4× | The audio engine clamps there; the kernel only requires finite > 0 | `ScoreAudioSync.setRate` rejects values outside that range with `RangeError`; this is domain policy |

The pair factories use the audio buffer engine so both sides can accept a
scheduled start. Its playback-rate control also changes the clip's pitch;
`clipOptions.preservesPitch` does not apply to that engine. The pair coordinates
transport positions, not a pitch-preserving time-stretch algorithm or a shared
audio mixing route. Callers choose which player sounds or where each routes.

The score-master factory also validates its initial `scoreOptions.tempo` against
the shared rate range before allocating a context. In the audio-master factory,
the group owns the initial rate, so a `scoreOptions.tempo` override is rejected
instead of silently being replaced. A clip returned by `renderScoreToClip` for
the same Score carries in-memory render provenance: both factories require
that original Score instance and reject a tempo override that changes the
clip's time axis; the score-master factory also rejects a positive render tail.
Use the audio-master factory when that tail must play to completion. Copying
or serializing the AudioClip loses this provenance, so the caller must then
maintain the alignment contract.

For repeated notation, call `expandRepeats(score)` before rendering and pair
the returned Score instance; `scoreOptions.expandRepeats` expands only the
player timeline and is rejected for Bridge-rendered clips.

---

## 7. Mapping and timing boundaries

**One session authority is the accepted direction.** The current implementation
coordinates privately owned transport clocks through one master reader. Injecting
the same TransportClock into both engines is not implemented: moving its anchor
would invalidate already scheduled sound in another engine without notification.
The required ownership and invalidation protocol is described in
[platform/shared-clock-injection.md](../platform/shared-clock-injection.md).
`TransportGroup` is reusable coordination, not proof that instance injection or
sample-accurate loop wrap has shipped. Delivery status belongs in
[STATUS.md](../dev/STATUS.md).

**Bridge pair adapters use a constant offset.** Kernel's `TransportGroup` also
supports affine position/rate scaling and explicit native-loop phase metadata
for appropriately configured participants. Kernel publishes `TimelineMapping`
and both domains implement adapters, but arbitrary rubato or nonlinear
score-to-recording alignment is not implemented by the group.

**Conversions have explicit information limits.** `beatGridFromTimeMap` evaluates
chosen beat positions exactly, but tempo changes between sample points may be
lost. `timeMapFromBeatGrid` makes one tempo segment per inter-beat interval; its
quarter zero is second zero, so the caller retains `grid.beats[0]` separately.
It supplies 4/4 meter rather than recovering original notation. Timeline sampling
is bounded by `maxBeats` (default 1,000,000).

`renderScoreToClip` renders samples, not a reversible notation container.
`scoreFromTranscription` quantizes estimated note events into a validated Score
and retains their supplied performed timing on notes. It cannot recover information
missing from the transcription or guarantee reconstruction of the original
recording/notation. `maxNotes` / `maxMeasures` bound assembly work. Audio ↔ Score
is therefore an integration/conversion seam, not a general lossless round-trip.

**Synchronization roles extend beyond `PlayerLike`.** A readable clock, scheduled
start and settling seek have additional requirements, and Bridge positions use
the master's axis rather than `PlayerLike`'s rate-scaled Score seconds. Compile-time
assertions pin the relevant real-player surfaces; runtime integration tests verify
behavior.

---

## 8. How the contracts are held

| Layer | Mechanism |
|---|---|
| Compile time | `src/transport-contracts.ts` pins `ScorePlayer` and `TonePlayer` to the master role and `AudioClipPlayer` to the follower role |
| Family suites | The load-bearing behaviors (ScorePlayer's transport clock surface, BufferEngine's scheduled start and pre-roll hold) are marked **CONTRACTUAL** with a pointer back here, so a family maintainer sees the coupling before changing them |
| Bridge suites | `test/sync.test.ts` drives the full behavioral matrix through fakes (clocked and clockless, loop, lifecycle races, rate reconciliation); `test/player-contracts.test.ts` and `test/audio-master.test.ts` run the **real** players through the sync so the fakes cannot silently encode yesterday's contract |
| Kernel suite | `platform/kernel/test/sync.test.ts` covers the group directly, including multi-follower cases the bridge's single pairing cannot reach |

---

## 9. Ownership and integration scope

Factory-created players belong to the returned sync. `sync.dispose()` releases
both players and requests closure of a context created by the factory. A context
supplied in `options.context` remains caller-owned. Construction failure releases
partially created resources; background failures are reported through
`onOperationError`. For a directly constructed `ScoreAudioSync`, group disposal
invokes the participants' optional `dispose()` methods; use non-owning adapters
when the application must retain those participants.

Returned raw players support inspection and per-player sound controls. Issue
transport commands through the sync to preserve the group's authority. A borrowed
view or presenter should attach to that transport rather than create a new player.

The Bridge convenience API assembles one pair; Kernel supports N followers.
Current group roles command a master and do not implement a follow-only mode for
external MIDI/video clocks. Pair-adapter alignment and tick-detected group-loop
wrap have the limits described above. Track extensions centrally in
[STATUS.md](../dev/STATUS.md), with their reasons in [DECISIONS.md](../dev/DECISIONS.md).
