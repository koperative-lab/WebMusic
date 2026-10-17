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
| `/element` | `HTMLElementBase`, `WebMusicElement`, `upgradeProperty/Properties`, attribute readers, `defineOnce` and scoped ModuleContext/target discovery. Implementation is `src/elements.ts`; public spelling is `/element`. | Shadow DOM presentation, themes, attributes, domain state and special teardown order. Discovery lends capabilities without preparing audio. |
| `/worker` | `WorkerLike`, `RequestTracker` correlation, and `dedicatedWorkerScope()` detection. | Protocol versions, cancellation, latest-wins, restart and replacement; Score analyze's session model remains distinct. |
| `/audio-context` | SSR-safe `getAudioContextConstructor` and `createWebAudioContext`. | Liveness, resume, creation versus borrowing, and closure; sharing the helper does not share a context instance. |
| `/player` | Structural `PlayerLike`, timed/stateful/rate/volume/disposable capability interfaces and guards. | Musical time, backends, loading and domain events; `InteractivePlayer` need not pretend to own a timeline. |
| `/effect` | `Effect` / `EffectNodes` over `BaseAudioContext`, plus the modular `InsertChain` and effect-instance lifecycle used by both domains. | Effect catalogs, DSP algorithms, backend-specific switching/tail policies and legacy chain adapters. Sharing a recipe does not share its live instance. |
| `/module` | Structural module/context/route/parameter contracts; versioned project schema, staged runtime, exact plugin registry and structural editor projection. | Domain models/factories, asset loading, instrument capabilities, parameter-to-DSP adapters, storage and undo. Registration does not grant disposal rights. |
| `/transport` | `TransportClock` affine anchors and `TimelineMapping`. | Score quarters/nominal seconds, Audio clip seconds/samples, duration clamping and loop policy. |
| `/tick` | Worker-backed wakeups and main-thread fallback. | Lookahead horizons, note commitments, boundaries and UI refresh cadence; each instance has an owner responsible for stopping it. |
| `/meter` | `AnalyserMeter`, byte-domain RMS/peak, subtractive peak hold and `aggregateSpectrumBars`, extracted from Score/Audio analyser taps. | Public frames, default scale/decay, spectrum-bar floors and error policy; Audio PCM `calculateLevelMeter` belongs in Audio when migrated. |
| `/sync` | `TransportGroup` roles, N followers, fixed offsets, rate/drift reconciliation, command serialization, generations and intent; `MirrorClockMaster` for clockless adaptation. | Score/Audio axis conversion, the shared rate's domain limits, model conversion and application session assembly. |
| `/session` | Source-free SessionTransport, mapped read-only scheduling anchors, invalidation epochs and Session-relative automation/phase. | Domain participant adapters, content/time conversions, audio routing and backend scheduling precision. A Session does not fabricate source data or an audio master output. |

`dedicatedWorkerScope()` serves Score `io`/`analyze` and Audio `play`/`analyze`
runtimes.
It prevents accidental registration on the main thread, during SSR or in
Shared/Service worker scopes. Protocol and request-completion policy remain
with each client.

Meter extraction unifies the algorithm and tap. Score's
`LevelMeterController` publishes `{level, peak, peakHold}`. The Audio adapter's
`{rms, peak, peakHold, level}` frame and PCM analysis's multiplicative retention
remain distinct from an analyser's absolute per-read peak decay.

The modular entries follow
[DEC-047](../dev/DECISIONS.md#dec-047--modular-composition-separates-resources-routing-and-session-authority)
and the [composition contract](../dev/design/MODULAR-COMPOSITION.md). Their
admission is based on the common contract used by Score and Audio, rather than
moving either domain's models into Kernel. The new InsertChain does not replace
every legacy effect helper: adapters preserve the existing effect stage, public
catalog and owned/borrowed cleanup policy. Audio environments close only contexts
they create; registries and Sessions do not dispose borrowed players. Graph
readiness, resource ownership and Session membership remain separate.

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
scheduler and Audio buffer engine retain private clocks for independent playback;
the legacy Bridge sync factories coordinate both master directions.

Modular composition also has a source-free SessionTransport conductor. It owns
the Session position axis and coordinates explicitly mapped participants without
selecting the first source as a hidden master. It does not connect their audio
outputs. Native participants borrow `SessionSchedulingBinding`: one mapped,
read-only authority with invalidation epochs and future loop segments. Domain-aware mappings still
belong in Bridge; sharing neutral audio/control ports does not require them.

`TransportClock` remains pure math; `SessionSchedulingBinding` supplies the
write-ownership/invalidation protocol around it. Native consumers retract and
re-arm their own submitted work, while media/external followers keep approximate
coordination. [The shared-clock design](shared-clock-injection.md) states loop,
lookahead, latency and tail boundaries. [DEC-048](../dev/DECISIONS.md#dec-048--session-scheduling-is-a-borrowed-anchor-projects-store-declarative-identity)
also adds versioned project restoration without moving domain factories or app
storage into Kernel. Evidence belongs in [STATUS.md](../dev/STATUS.md).
