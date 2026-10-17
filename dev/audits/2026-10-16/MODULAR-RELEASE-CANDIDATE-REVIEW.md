# Modular release candidate review

The reviewed candidate is **not ready to publish**. Eight independently
reproduced correctness or public-contract defects remain: one P1 and seven P2
findings. The passing repository gates do not cover these cases. No product
source, maintained tests, package metadata or shared build output was changed
in this review; only this record, evidence and current navigation/status are
updated.

This follows the [release hardening record](MODULAR-RELEASE-HARDENING.md).
Baseline: `modular-redesign`, HEAD
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, including the existing uncommitted
implementation. This is working-tree evidence, not acceptance of that HEAD
alone. The audit directory retains the preceding pass's America/New_York date;
raw execution timestamps are UTC on 2026-10-17. The
[evidence index](release-candidate-review-evidence/README.md) identifies original
failures, positive controls, exact inputs and reproduction scripts.

## Confirmed findings

P1 means a lifecycle failure that can leave an uncontrolled live output after
the owner has been disposed. P2 means a reproducible supported-path correctness
or public-contract failure with a bounded trigger. Both require repair before
claiming this modular candidate ready for release. These priorities describe
the observed scope; they do not imply every use of a component fails.

### RC-01 — P1: AudioClipPlayer publishes a graph after factory-triggered disposal

Owner: [player.ts](../../../packages/audio/src/play/headless/player.ts),
`ensureGraph()`, lines 773 and 791–796.

During `preload()`, an effect's public `createAudioNodes()` callback can dispose
its player. The outer graph construction resumes, connects the candidate to
the destination and stores the engine, inserts and output port without checking
that ownership is still live. The first disposal cannot release these resources
because they were not committed at that time.

A native Chromium probe measures an unreleased effect, a live public output
port and nonzero PCM after disposal. The root reviewer independently rewrote
the signal as a 440 Hz oscillator: peak 0.1000000015, RMS 0.0707106635, zero
effect releases. The same callback on the `AudioPlayer` facade releases once,
publishes no port and renders exact silence. This is digital output evidence,
not a physical listening test. A second explicit disposal cleans up, but callers
must not have to discover and repeat a completed terminal cleanup.

Repair acceptance: after any externally implemented factory callback, validate
the candidate's lifetime before connecting or publishing it; release abandoned
nodes exactly once. Cover owner disposal and recursive graph acquisition, and
retain the successful facade control. Evidence: `audio/native-results.json`
and independent `root-cross/native-results.json`.

### RC-02 — P2: natural Session completion overwrites newer commands

Owners: [session.ts](../../../platform/kernel/src/session.ts), lines 493–498;
[sync.ts](../../../platform/kernel/src/sync.ts), lines 727–731.

At natural completion, `#reconcile()` invalidates scheduling, invoking public
observers, then continues writing the old clock state and returns `stalled`.
It does not check whether an observer has issued a newer command or disposed
the Session. The group also acts on that stale verdict.

With range `[0, 1]`, a completion observer calling `stop()` immediately sets
position to 0, but the older completion writes 1 afterward. The stop promise
then reports **committed** with position 1. Calling `seek(0.2)` instead is also
overwritten to 1 and paused. Two reviewers independently reproduced these
public API cases using a controlled reference clock. The previous initial-
attachment H-01 regressions still pass; this is a different completion path.

Repair acceptance: a newer command retains its anchor, position and playing
state; a stale reconciliation must neither mutate nor trigger another pause.
Guard both invalidation and terminal-anchor callbacks, including disposal.
Evidence: `kernel/natural-end-minimal.json`, `score/kernel-cross-review.json`.
The aggregate review assigns P2 because this requires completion-observer
reentry; the Score review's preliminary P1 recommendation is retained as
historical reviewer evidence.

### RC-03 — P2: AudioMixer discards the built-in AudioPlayer's common start time

Owner: [mixer.ts](../../../packages/audio/src/play/headless/mixer.ts), line 599.

The mixer passes `when` only to `instanceof AudioClipPlayer`. A built-in
`AudioPlayer` facade also supports a scheduled buffer start, but receives no
argument and starts immediately. Mixing the two over one native context at
48 kHz produces first nonzero frames `[0, 2880]`, a **60 ms difference** on
initial play and restart after seek. The two-clip control produces
`[2880, 2880]`.

An independent probe puts the same facade/clip pair under Session shared
scheduling and obtains `[2880, 2880]`. This finding is limited to Mixer command
dispatch; it does not establish a failure of Session native anchors or claim
exact timing for streaming/custom backends. Offline timing cases override only
the context's state getter to bypass realtime resume; clocks, nodes, start
times and rendering remain native.

Repair acceptance: pass the common time to every supported built-in scheduled
transport, preserving documented approximate paths. Cover mixed-member play
and seek. Evidence: `audio/native-results.json`, `kernel/audio-mixer-peer.json`.

### RC-04 — P2: a lazy member bypasses an occupied mixer channel ID

Owner: [mixer.ts](../../../packages/audio/src/play/headless/mixer.ts),
lines 307–308; resulting incomplete removal at lines 339–347.

After `admitAudio('voice', port)`, adding an unprepared `AudioPlayer` with the
same ID succeeds because the duplicate-channel check runs only when its output
already exists. `remove('voice')` then removes that member but leaves the direct
channel: `ids()` still contains `voice`, its lease is active and its signal
still reaches the output. No callback reentry is needed. Preparing the player
first correctly rejects the collision and removal clears the direct lease.

Repair acceptance: validate occupancy independently of output readiness before
publishing membership; retain legitimate member replacement. Lazy and prepared
cases must reject the same conflicting channel, with complete removal and
silence afterward. Evidence: `audio/native-results.json`.

### RC-05 — P2: the modular sound-font adapter drops native sampler capabilities

Owner: [lazy-module-soundfont.ts](../../../packages/score/src/play/element/internal/lazy-module-soundfont.ts),
returned facade at lines 42–94.

The URL-template adapter omits `params`, `supportsScheduledDuration` and
`supportsScheduledRetiming` even though its native backend implements them.
After explicit module preparation, an attached envelope panel has no ADSR
parameters. During a two-second sample note, changing Session rate to 2
allocates another native sample source (1 → 2), restarting the note instead of
retiming the existing occurrence. Explicit `Sound.samples` under the same
conditions keeps one source (1 → 1).

These are two symptoms of one adapter omission. Repair acceptance: forward the
real native capabilities and parameter surface without making observation
eagerly prepare audio. Test an actual modular Element using `sound-font`, a
live ADSR edit and uninterrupted rate retiming. Evidence: `score/results.json`.

### RC-06 — P2: analyzer setup can retain subscriptions and taps after removal

Owners: [module-input.ts](../../../packages/audio/src/play/element/internal/module-input.ts),
lines 39–48 and 68–69;
[audio-spectrum-analyzer.ts](../../../packages/audio/src/analyze/element/audio-spectrum-analyzer.ts),
line 174, and the equivalent Level, Oscilloscope and Transient setup paths.

Each Element installs its returned disposer after synchronous binding setup.
If reading a module output fails and the application's public `webaudio:error`
handler removes the Element, disconnect has no disposer yet. Setup returns and
stores a live subscription on the detached host. This normal error-handler
fallback leaves subscribe/release counts at 1/0 for all four analyzers, versus
1/1 in the ordinary-removal controls.

Additional synchronous replacement/removal probes retain native taps or
overwrite the newer binding's cleanup. Twenty-four native/public cases include
sixteen lifecycle failures and eight cleanup controls. Native connect/disconnect
wrappers only count and forward operations; borrowed outputs are disposed after
measurement so their cleanup cannot hide the leaks.

Repair acceptance: guard the Element setup handoff and shared helper with the
current connected generation; immediately release a late obsolete disposer or
candidate tap. Removal and replacement during public callbacks must leave no
subscription/tap and must not dispose the borrowed module. Evidence:
`elements/native-results-public.json`.

### RC-07 — P2: modular analyzer failures break the documented error payload

Owner: [player-binding.ts](../../../packages/audio/src/analyze/element/internal/player-binding.ts),
line 54.

The modular branch dispatches `detail: error`, while all four public analyzer
references and their ordinary error paths use `detail: {error}`. A normal
listener reading `event.detail.error` gets `undefined`. The retained-error
controls keep the Element mounted and verify this independently of RC-06;
normal later removal releases their resources correctly.

Repair acceptance: normalize and wrap the error in the documented shape, and
retain exactly-once delivery plus safe removal/rebinding from that callback.
Evidence: `error-retain` cases in `elements/native-results-public.json`.

### RC-08 — P2: combined Audio globals expose an unregistered meter constructor

Owners: [tsup.config.mjs](../../../packages/audio/tsup.config.mjs), independent
View/Analyze IIFEs at lines 37–45 and 77–79;
[audio-meter.ts](../../../packages/audio/src/view/element/audio-meter.ts),
registration at lines 463–465.

The public CDN example loads both View and Analyze. Both expose
`AudioMeterElement`, but their independent bundles embed separate classes.
The second bundle keeps the existing `<audio-meter>` registration while
exporting its own unregistered constructor. Creating that class throws
`Illegal constructor`; an existing meter also fails its `instanceof` check.
Native Chromium reproduces both load orders from the final installed tarballs.
Each bundle alone works, and combined declarative rendering/playback works.

Repair acceptance: both namespaces expose the registered, constructible meter
class in both supported orders, while standalone and custom-tag registration
continue working. The existing export checker uses isolated VMs and misses
this combination. Evidence: `delivery/global-meter-identity.json`.

## Validation and release boundary

| Check | Result and scope |
| --- | --- |
| Baseline integrity | All 1,181 previously validated inputs match. Independent review also verifies 261 retained evidence files and 1,136 files across the five final tarballs. |
| Node 22 fresh installation/full gate | Fresh `npm ci` and `npm run check` pass on Node 22.23.3/npm 10.9.9 in an isolated exact working-tree copy. Full gate: 371 workspace test files, 4,743 tests, plus script checks; exit 0 in 439.153 seconds. |
| Previous Node 24 gate | Preserved hardening results apply to unchanged implementation inputs; no claim of a new Node 24 full run. |
| Fresh focused maintained suites | Score: 54 tests; Kernel project/editor: 75; Bridge factories: 10, all pass. These overlap the full suite and are not additional unique test totals. |
| Fresh dependency audits | Full and production audits report zero vulnerabilities. |
| Package consumers | Existing independently installed tarball consumer: 174 runtime entries and ESM/CJS/type checks pass; isolated no-UI/no-React consumer: 88 applicable imports pass. Optional visual UI dependency behaves as documented. |
| Positive native checks | Independent ADSR values, equal-pitch occurrence release and reusable LFO lifecycle pass. Project restore preserves all 2,048 PCM samples and serialized state. Ten DOM context/keyboard cases pass. Combined four-global nested playback, shared Session/context and master tap pass. |
| Public registry | All five packages still list `0.2.0` as latest; `0.3.0` is not published. This environment's `npm whoami` returns `ENEEDAUTH`. No publication was attempted. |

The first registry metadata query failed because npm used an unwritable default
cache; sourcing the existing setup environment corrected the cache location and
all five read-only queries then succeeded. Both attempts are retained. This is
an environment invocation issue, not a registry connectivity or package defect.

The Node 22 check covers the implementation baseline before this report and
evidence were added. Final documentation inventory, public-documentation,
format and whitespace checks validate the review-only additions separately.
Node 22.23.3 is within the supported range; this is not a run on CI's exact
22.22.3 floor or remote CI for a final release commit. The isolated build did
not replace the shared public output used by the native probes and tarballs.

The native tests use Linux Chromium 151.0.7922.173. They establish digital
rendering and the named browser behaviors, not physical listening, device
latency, Web MIDI hardware, third-party SF2 worklets, a complete accessibility
audit or a broader browser matrix. Existing normal/Pages build evidence is
retained, not described as a fresh site build in this read-only review.

Two lower-priority observations remain separate: the AudioMixer Headless and
Element references still say no aggregate analyzer exists despite the delivered
master analyzer; async `TransportGroup` observers differ from Session rejection
handling, but their `void` callback contract does not explicitly promise async
support. Neither is counted among the eight findings. Arbitrary programmatic
insert topology is also outside the documented built-in project factory export
configuration; no unsupported persistence scenario is counted as a defect.

Before publication, repair RC-01–08 and add regressions against their actual
public routes, then rerun integration, native and combined-package acceptance
on the rebuilt candidate. Final reviewed release-commit CI, authenticated scope
rights, publication in dependency order and post-publication registry consumer
verification remain required by the [publishing runbook](../../release/PUBLISHING.md).
No commit, push, tag, npm publication or site deployment was performed here.
