# Audio Play review and repairs — 2026-09-25

## Baseline, scope and authority

Reviewed the restored five-package migration in the local `dev` working tree at
`ae0742a`, following guidance alignment with main `1e0fb7b` and the preceding
Audio visual pass. Preserved existing staged/unstaged work. Main was used as a
design reference; its three-package implementation scope was not expanded.
This record covers ClipPlayer, Mixer, Playlist, Recorder, Meter and their direct
View/UI/resource bindings. It is not an Audio Analyze or Bridge clock audit.

Retain all five roles: single-clip transport, simultaneous mixing, sequential
queueing, capture and monitoring have different state/time/resource owners.
[Audio Play design](../../design/AUDIO-PLAY-COMPONENTS.md) and DEC-025 now own the
accepted contracts. Public leaf references own their actual API details.

The initial Audio Play suite passed 24 files / 333 tests, but callback, replacement
and lifetime probes exposed the following untested defects. Regression tests now
exercise the contracts with deterministic clocks, deferred operations, structural
players, channel fixtures and DOM harnesses. The reference for native scheduling,
loop bounds, suspension and channel behavior was the
[Web Audio 1.0 Recommendation, 17 June 2021](https://www.w3.org/TR/2021/REC-webaudio-20210617/).
Source fixtures do not measure audible synchronization or native device capture.

## Findings and repair evidence

| ID | Confirmed failure | Repair and regression |
|---|---|---|
| AP-01 | A `load` listener could pause/stop while the outer play still started a source | Recheck lifecycle intent after graph-ready callbacks; [player lifecycle tests](../../../packages/audio/test/play/player-lifecycle.test.ts) |
| AP-02 | Region/time callbacks could recursively enter the same region or publish stale observations | Commit region state first; invalidate superseded observation batches; player lifecycle tests |
| AP-03 | Looping seek reported regions at the requested rather than accepted position | Read normalized engine seconds for region transitions; player lifecycle tests |
| AP-04 | Seeking before a scheduled Buffer start began playback early | Preserve the future absolute origin; start failure parks at the accepted target; [Buffer tests](../../../packages/audio/test/play/buffer-engine.test.ts) |
| AP-05 | A disposed Buffer engine could create sources again | Terminal disposal guards; Buffer tests |
| AP-06 | Unusable Media range loops suppressed natural end and left a watcher running | Validate ranges, snapshot caller input and finish normally when metadata removes the playable span; [Media tests](../../../packages/audio/test/play/media-engine.test.ts) |
| AP-07 | A borrowed player exposed stale/missing clip data to companion views | Public readonly clip, committed `sourcechange`, initial read and replacement/clear/disconnect invalidation; [Element tests](../../../packages/audio/test/play/clip-player-element.test.ts), [View tests](../../../packages/audio/test/view/elements.test.ts) |
| AP-08 | Mixer Element volume/mute/solo maps diverged from Headless | Frozen Headless snapshots and change invalidation; [Mixer Element tests](../../../packages/audio/test/play/mixer-element.test.ts) |
| AP-09 | Removing the solo member left remaining members silent | Clear its solo identity and reapply gains; [Mixer tests](../../../packages/audio/test/play/mixer.test.ts) |
| AP-10 | One cleanup failure prevented remaining mixer resources from releasing | Detach ownership before best-effort cleanup; preserve first failure and idempotence; Mixer tests |
| AP-11 | Unknown IDs/fractional indices destroyed valid playlist selection | Reject invalid explicit selection before mutation; [Playlist tests](../../../packages/audio/test/play/playlist.test.ts) |
| AP-12 | Recorder reported success with a suspended context | Await running readiness, own pending resources and cancel late completion; [Recorder lifecycle tests](../../../packages/audio/test/play/recorder-lifecycle.test.ts) |
| AP-13 | Input level ignored the right channel | RMS over the retained channel/frame energy, including right-only and opposite-phase fixtures; Recorder lifecycle tests |
| AP-14 | Recorder error handlers could not immediately retry | Publish idle state and release the failed operation before failure notification; [Recorder Element tests](../../../packages/audio/test/play/recorder-element.test.ts) |
| AP-15 | Meter tuning replaced public ports and broke the caller's audio route | In-place configuration, validation/rollback and failed replacement preservation; [Kernel meter tests](../../../platform/kernel/test/analyser-meter.test.ts), [Meter Element tests](../../../packages/audio/test/view/audio-meter-element.test.ts) |

Related alignment includes queue-preserving policy setters and autoplay edits,
short naturally-ended mixer members rejoining a backwards seek while independent
pauses remain respected, and synchronous mixer commands superseding older member
iterations. The corresponding Headless/Element references describe these rules.

Native recording remains fixed-stereo ScriptProcessor capture in 4096-frame
blocks. Stop has no final partial-block flush; a retained-data ceiling aborts and
discards an unfinished take. The live meter's scaled-RMS, per-read peak hold and
the pure PCM helper's sample-peak hold remain explicit compatibility behavior.
No Worklet, LUFS, true-peak, gapless playlist or shared-engine-clock claim was added.

## Verification

Environment: local macOS, Node 24.21.0 with the restored lockfile, jsdom and the
repository's Vitest suites. Package builds are coordinated with the preview server.

- Player/engine focused suite: 4 files / 67 tests passed.
- Source binding/Element/View focused suite: 3 files / 46 tests passed.
- Recorder/meter focused suite: 5 files / 66 tests passed; a temporary source alias
  exposed the new Kernel method before the coordinated package build. Focused
  TypeScript verification also passed.
- Mixer/Playlist focused suite: 4 files / 113 tests passed. Independent callback
  probes also confirmed that nested seek and stop-to-seek leave both members at
  the latest requested position.
- Legacy style/state suite: 1 file / 3 tests passed after converting its private
  duplicate-state assertions into public membership/snapshot assertions.
- Integration exposed an overly optional test-double method type and the obsolete
  private-state assertion above; both were corrected before the final gate.
- `npm run check`: passed. The six workspace test suites passed 306 files /
  3,985 tests (Kernel 155, Audio 681, Score 1,969, UI 955, Bridge 154, docs 71).
  Architecture, format, lockfile, maintained-doc routing, 258 compiled examples,
  source/test typechecks, dependency-license policy, 112 public export entries
  and release-manifest consistency all passed.
- `npm run docs:build`: passed; 182 pages built. Existing Sandpack directive,
  bundle-size and missing sitemap `site` warnings remain informational. No new
  capture/browser/audio acceptance is implied by a static site build.
- `git diff --check`: passed. The pre-existing 1,125 staged files remain staged;
  this repair remains local and uncommitted on dev. Main remains clean at its
  original baseline.

## Remaining boundaries

Current gaps remain owned by [STATUS](../../STATUS.md): real microphone/device
acceptance, audible timing, background suspension, full accessibility and remote
CI are not established by these tests. DEP-01 dependency audit and TIME-01/TIME-02
shared-clock/precision work remain separate. This repair does not publish, deploy,
merge or certify the earlier migration.
