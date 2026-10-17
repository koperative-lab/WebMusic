# Modular redesign review fixes

> Recovery notice (2026-10-17): The generated evidence marked unavailable below
> was not recovered. The results in this report describe the historical run,
> not current verification. Original artifact paths are retained as text.
> See the [recovery record](../2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md).

This follow-up repairs the 20 independently reproduced findings from the
2026-10-16 review of the `modular-redesign` working tree based on `ef8664d`.
It preserves the dated [third-delivery record](../2026-10-15/MODULAR-THIRD-DELIVERY.md)
and its earlier measurements. The environment is Node 24.19.0, npm 11.9.0 and
Chromium 151.0.7922.173 on Linux. No commit, remote push or publication is implied.

## Findings and changes

The numbering matches the independent review. P1 denotes the common playback
regression, P2 the conditional behavior/ownership/API failures, and P3 the
declaration-label issue. These were implementation defects within DEC-047/048,
not a change to package boundaries or an expansion of the modular design.

| ID | Finding | Repair and maintained regression owner |
| --- | --- | --- |
| 1, P1 | Lazy mixer preparation multiplied source and channel/master gains; pre-play mute could remain silent after unmute | Routable sources retain their application-owned gain; channel/master mixing applies once. [Mixer routing tests](../../../packages/audio/test/play/mixer-routing.test.ts) cover native/borrowed lazy preparation and mute recovery. |
| 2, P2 | A newly admitted modular channel ignored existing solo | Initialize the candidate's fader before routing and reconcile admission. Mixer routing tests cover the connected gain. |
| 3, P2 | Removing a soloed modular channel left surviving channels silent | Exact-owner lease cleanup clears departed solo and reconciles gains, including cleanup errors and replacement reentry. Mixer routing tests cover public removal and lease release. |
| 4, P2 | Root AudioContext/destination setters reused stale module configuration | Validate conflicts before mutation; replace the owned scope for a new reference context and republish same-context routes. [Score lifecycle tests](../../../packages/score/test/play/modular-score-lifecycle.test.ts) cover root and descendant rebinding and invalid-edit preservation. |
| 5, P2 | An in-flight rack-part reservation stayed in its former Session | Transfer pending/failed reservations with the current scope without restarting the fetch. Score lifecycle tests cover ready, pending and failed-source moves. |
| 6, P2 | A pending provider left old Score data and controls commanding its former Session | Revoke the old handle/subscription/source and publish unavailable readiness. Score lifecycle tests verify that old controls cannot start the former Session. |
| 7, P2 | A source-free root's requested loop was never applied after duration resolved | Reconcile whole-session loop bounds on membership/duration events. Score lifecycle tests cover late loading and changing durations. |
| 8, P2 | Paused CV edits released Session automation | Add committed-base-write identity (`ParamSnapshot.baseRevision`); mappings and trajectory notifications no longer impersonate manual base writes. [Session modulation tests](../../../platform/kernel/test/session-modulation.test.ts) cover connect/depth/disconnect while paused. |
| 9, P2 | A superseded queued seek could schedule its old position in the latest epoch | Preserve FIFO clock mutations while guarding native anchor publication with the command-current callback. [Session tests](../../../platform/kernel/test/session.test.ts) cover blocked joins, seek/rate and seek/loop ordering. |
| 10, P2 | Reentrant Session commands suppressed later dispose listeners | Terminal disposal reaches all remaining listeners even if the epoch changes. [Scheduling tests](../../../platform/kernel/test/session-scheduling.test.ts) cover native LFO cancellation. |
| 11, P2 | Attachment failures left public participant readiness pending | Reject readiness from the complete preparation/activation/attachment chain. Session tests cover every failure stage. |
| 12, P2 | Interrupted no-tail effect fades amplified a unity signal | Hand off all active no-tail contributions at one new anchor, preserving intentional tails and rolling back every touched ramp on failure. [Transition tests](../../../platform/kernel/test/transition-insert-chain.test.ts) cover repeated, immediate and failed changes. |
| 13, P2 | Future global envelope edits at instantaneous stages changed earlier CV | Preserve the incoming left limit separately from the new right-hand level. [Control tests](../../../platform/kernel/test/param-modulation.test.ts) cover zero-attack/decay boundaries. The per-voice amplitude envelope is a separate implementation. |
| 14, P2 | An awaiting attached LFO start migrated to a newly selected parameter | Capture the exact parameter and invalidate pending intent/settings when selection changes. [Panel modulation tests](../../../packages/score/test/play/synth-panel-modulation.test.ts) cover selection away/back and replacement handles. |
| 15, P2 | Live route commands reported failure after changing the graph | Validate prospective snapshots before commit/release; return and notify with the captured result. [Project tests](../../../platform/kernel/test/module-project.test.ts) cover exporter/descriptor failures for audio and CV commands. |
| 16, P2 | Topology hook reentry overwrote newer graph edits | Hold the edit guard before validation/plugin calls, then check graph generation. Project tests cover reentry, rollback and guard release. |
| 17, P2 | Editor rejection lost keyboard focus; async success stole moved focus | Track command focus ownership and restore only while the user has not moved focus. [Editor tests](../../../packages/ui/test/patch-editor.test.ts) cover connect/move/disconnect outcomes and teardown. |
| 18, P2 | Demo busy fieldsets broke consecutive keyboard seeking | Restore the initiating control only when disabling displaced it. [Demo tests](../../../apps/doc/webmusic/test/modular-project-demo-client.test.ts) cover seek/rate and delayed operations. |
| 19, P2 | Documented Score sessionTransport getter was absent | Expose the current borrowed/owned Session read-only with pending/teardown semantics. Score lifecycle tests cover availability. |
| 20, P3 | Rack labels used generated runtime IDs instead of declarations | Project declaration labels/order through the stable module mapping. Score lifecycle tests cover reverse load completion, rename and retained channel mix. |

## Verification

The implementing agents ran focused owning suites and typechecks. Original
Session reproductions now pass, and the first ten new project expectations
were also run against the broken implementation before repair. Tests exercise
behavior and ownership rather than only matching private state.

Native checks against isolated exact-source bundles passed for mixer gains,
interrupted crossfades and global envelope boundaries. The mixer probe temporarily
reports the offline context as running during preparation, then restores its
native state before rendering; nodes, routes, schedules and output samples are
native. The separate per-voice ADSR matrix remains 504/504. An exact-source browser
probe passes 19 focus cases, including outside/shadow focus and consecutive seeks.

The complete `npm run check` (unavailable: `fix-evidence/full-check.json`) passed as one
command (exit 0), including source/test typechecks, five package builds, compiled
documentation snippets, licenses, exports and release manifests. Its workspace
suites passed **370 files / 4,620 tests**, adding 72 regressions to the previous
baseline: Kernel 380, UI 681, Score 2,211, Audio 912, Bridge 192, documentation 244.
Raw output and isolated native/browser probes are retained in
[the evidence directory](fix-evidence/README.md).

The subsequent `npm run docs:build` (unavailable: `fix-evidence/docs-build.json`) passed
(exit 0), generating 114 pages. Against those final package outputs, all
11 native scheduling/effect cases (unavailable: `fix-evidence/final-native-results.json`)
passed with no browser errors. A separate
interrupted-fade render (unavailable: `fix-evidence/public-effect-results.json`) imported the
rebuilt public effect entry and measured peak `1.0000004768371582` and maximum
unity error `9.5367431640625e-7`, below the `2e-6` tolerance.

The built public-page checks (unavailable: `fix-evidence/final-project-docs-results.json`)
passed playback/pause, keyboard editing, save/restore/import/export, missing-plugin
recovery, invalid-import preservation and 320 px layout with no browser errors.
The consecutive-seek check (unavailable: `fix-evidence/public-demo-keyboard-results.json`)
retained focus for both key presses, advanced from `0.05` to `0.10` seconds and
then reached the natural `4.00 s` end. Final SHA-256 verification matched all
15 implementation sources, six public entries, the native fixture bundle and
43 served client assets; see verification (unavailable: `fix-evidence/final-verification.json`).

## Boundaries

The fixes preserve separate context/audio/transport buses, borrowed resource
ownership and the application-owned storage/undo boundary. Native offline samples
do not establish physical device latency, external instrument timing or every
browser's behavior. Existing media/backend limits and lookahead starvation remain
explicit. No new audio device, microphone or deployment permission was required.
