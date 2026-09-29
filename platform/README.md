# Platform: shared contracts and implementation ownership

`platform/kernel` is the source and build boundary of `@webmusic/kernel`. This
ledger records extracted capabilities, their consumers and policies that remain
with the domains. Package usage belongs in [kernel/README.md](kernel/README.md).
The [Score architecture](../packages/score/ARCHITECTURE.md) describes the domain's
composition and timing boundaries. Cross-package rules live in
[ARCHITECTURE.md](../dev/ARCHITECTURE.md), decision reasons in
[DECISIONS.md](../dev/DECISIONS.md), and delivery gaps in
[STATUS.md](../dev/STATUS.md).

## Admission and extension

Kernel admits the common part of existing duplicated implementations that drift,
or a contract Score and Audio both implement. Reuse an existing module before
introducing another mechanism for time, events or resource correlation. Being
domain-neutral is necessary; a hypothetical future consumer alone is insufficient.

Kernel knows no `Note`, `Score`, `TimeMap`, `AudioClip` or `BeatGrid` and has no
workspace or third-party dependencies. Domain packages use its public subpaths;
UI remains independent of Kernel. The zero-domain dependency boundary is checked
by [package-policy.mjs](../scripts/package-policy.mjs) and
[check-architecture.mjs](../scripts/check-architecture.mjs). Admission still needs
review; an import check cannot prove the justification for an extraction.

## Extracted capabilities and retained boundaries

Former `@webscore/*` and `@webaudio/*` names describe historical origins only;
current consumers use `@webmusic/*`. This is an extraction record, not an unfinished
migration checklist.

| Kernel entry | Shared capability / origin | Policy retained by domains or callers |
|---|---|---|
| `/events` | Typed `EventEmitter`, unified from the hardened Score implementation; Score core re-exports it. | Event names, payloads and the choice of `emit` versus `emitSafely`. |
| `/element` | `HTMLElementBase`, `WebMusicElement`, `upgradeProperty/Properties`, attribute readers and `defineOnce`, replacing local element helpers. Implementation is `src/elements.ts`; public spelling is `/element`. | Shadow DOM, themes, attributes, presenters, domain state and special teardown order. |
| `/worker` | `WorkerLike`, `RequestTracker` correlation, and `dedicatedWorkerScope()` detection. | Protocol versions, cancellation, latest-wins, restart and replacement; Score analyze's session model remains distinct. |
| `/audio-context` | SSR-safe `getAudioContextConstructor` and `createWebAudioContext`. | Liveness, resume, creation versus borrowing, and closure; sharing the helper does not share a context instance. |
| `/player` | Structural `PlayerLike`, timed/stateful/rate/volume/disposable capability interfaces and guards. | Musical time, backends, loading and domain events; `InteractivePlayer` need not pretend to own a timeline. |
| `/effect` | `Effect` / `EffectNodes` over `BaseAudioContext`, allowing a recipe to serve live or offline graphs. | Effect catalogs, chain/insert helpers, parameters, replacement, rollback and release. Shared recipes do not imply shared live nodes. |
| `/transport` | `TransportClock` affine anchors and `TimelineMapping`. | Score quarters/nominal seconds, Audio clip seconds/samples, duration clamping and loop policy. |
| `/tick` | Worker-backed wakeups and main-thread fallback. | Lookahead horizons, note commitments, boundaries and UI refresh cadence; each instance has an owner responsible for stopping it. |
| `/meter` | `AnalyserMeter`, byte-domain RMS/peak, subtractive peak hold and `aggregateSpectrumBars`, extracted from Score/Audio analyser taps. | Public frames, default scale/decay, spectrum-bar floors and error policy; Audio PCM `calculateLevelMeter` belongs in Audio when migrated. |
| `/sync` | `TransportGroup` roles, N followers, fixed offsets, rate/drift reconciliation, command serialization, generations and intent; `MirrorClockMaster` for clockless adaptation. | Score/Audio axis conversion, the shared rate's domain limits, model conversion and application session assembly. |

`dedicatedWorkerScope()` serves Score `io`/`analyze` and Audio `play`/`analyze`
runtimes.
It prevents accidental registration on the main thread, during SSR or in
Shared/Service worker scopes. Protocol and request-completion policy remain
with each client.

Meter extraction unifies the algorithm and tap. Score's
`LevelMeterController` publishes `{level, peak, peakHold}`. The Audio adapter's
`{rms, peak, peakHold, level}` frame and PCM analysis's multiplicative retention
remain distinct from an analyser's absolute per-read peak decay.

## Keeping contracts aligned

Public shims re-export Kernel implementations instead of maintaining a second copy.
Objects that need a shared shape rather than a shared base class use type-only
`*-contract.ts` assertions:

- [Score playerlike-contract](../packages/score/src/play/headless/playerlike-contract.ts)
  and [Audio playerlike-contract](../packages/audio/src/play/headless/playerlike-contract.ts)
  pin the capability tiers implemented by real players.
- [Bridge transport-contracts](../bridges/score-audio/src/transport-contracts.ts)
  pins ScorePlayer/TonePlayer's master interface and AudioClipPlayer's follower interface.
- Reverse composition adapts domain positions in
  [audio-master.ts](../bridges/score-audio/src/audio-master.ts); real-player
  integration tests cover the behavior.

Public type imports/exports keep these assertions in the checked
reachability graph without runtime code. Structural compatibility does not
establish timing accuracy, cleanup or concurrency ordering; those require
behavioral tests.

The `/sync` extraction originated in cross-domain coordination work, not two
historical copies. It resides in Kernel together with the structural
master/follower roles. Bridge adapters reuse these roles and the group rather
than copying queues and drift monitors.

## Session-time contract boundary

The accepted rule is one authoritative timeline per session, with independent
sessions. The current Kernel group reads one structural master as its position
authority and coordinates participants against one reference clock. The Score
scheduler and Audio buffer engine each own a private `TransportClock`; Bridge
factories coordinate both master directions.

`TransportClock` has no anchor-change event, epoch or write-ownership protocol.
Same-instance injection, invalidation/rescheduling of committed audio, and
sample-accurate loop wrap are specified as technical gaps in
[shared-clock-injection.md](shared-clock-injection.md). They are implementation
and acceptance gaps within the accepted direction, not a reason to describe that
direction as undecided. Progress belongs in [STATUS.md](../dev/STATUS.md).
