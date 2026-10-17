# Modular release-readiness repairs

This follow-up addresses the eight defects reproduced in the release-readiness
review after the [earlier twenty repairs](../2026-10-16/MODULAR-REVIEW-FIXES.md).
The branch is `modular-redesign`, based on `ef8664d`, with the existing modular
working-tree changes preserved. The date uses America/New_York; raw command
timestamps retain UTC. This record does not assert a commit, publication or
deployment.

## Scope

The repair covers the eight reported defects and one adjacent mixer ownership
defect independently found during cross-review. The original failure evidence
is preserved beside the repaired behavior; the earlier report's passing tests
did not cover these additional boundaries.

| Finding | Repair and maintained regression owner |
| --- | --- |
| Real-time Session automation cancels itself as native time advances | One captured planning reference across scheduling layers, elapsed trajectory evaluation and bounded native submission reconciliation. [Parameter/modulation tests](../../../platform/kernel/test/param-modulation.test.ts) and [Session modulation tests](../../../platform/kernel/test/session-modulation.test.ts) preserve invalid-input checks and authored ramp endpoints. |
| Borrowed group facade ignores outer gain/mute | Apply fallback gain to the borrowed backend, preserve the facade's source volume and reconcile source transitions. [Mixer routing tests](../../../packages/audio/test/play/mixer-routing.test.ts) retain earlier lazy-source/solo coverage. |
| Pending LFO configuration migrates to another module | Scope queued commands to target identity and connected lifetime while preserving same-target readiness and explicit pre-mount intent. [Panel tests](../../../packages/score/test/play/synth-panel-modulation.test.ts) cover both replacement paths. |
| Connector retirement changes state without notifying project subscribers | Keep the prevalidated commit result, then publish uncaptured configuration changes as a later revision. Later export failures remain contained. [Project tests](../../../platform/kernel/test/module-project.test.ts) include base writes, modulation depth and immediate automation. |
| Successful serialization produces text its parser rejects | Check encoded text after escaping/indentation against the parser's bound and throw before returning oversized output. Project tests cover escaped and indented data plus valid compact roundtrips. |
| Explicit meter player selector stops following targets in module scope | Use the same binding precedence for observation and resolution. [Meter tests](../../../packages/audio/test/view/audio-meter-element.test.ts) cover late insertion, replacement and removal. |
| Editor snapshot failure leaves controls busy and masks the error | Separate command outcome from refresh outcome and restore DOM interactivity using the last valid view. [Editor tests](../../../packages/ui/test/patch-editor.test.ts) cover successful/rejected commands and focus movement. |
| Initial Open button remains active and overwrites a ready project | Honor its hidden state, disable it after initialization and guard its handler; explicit Reset remains available. [Demo tests](../../../apps/doc/webmusic/test/modular-project-demo-client.test.ts) and styled-browser probes cover the distinction. |
| Cross-review: lazy channel admission publishes before member ownership | Commit the channel and member lease before notifications, protecting removal, disposal and same-ID replacement. Mixer routing tests retain the failing reproduction and ownership assertions. |

The shared package version and internal peer floor are prepared as `0.3.0` /
`^0.3.0`. Public registry evidence confirms all five `0.2.0` versions already
exist. The published Kernel lacks the new module/Session entries, so the former
peer range admitted an incompatible installation. The manifest preparation and
lockfile refresh changed only the six workspace records, with no external
dependency changes. [Migration and release guidance](../../release/0.3.0.md)
describes the new compatibility boundary.

## Verification

All checks below ran after the final implementation changes on Node `24.19.0`,
npm `11.9.0`, and Chromium `151.0.7922.173`. The
[reproduction directory](release-fix-evidence/README.md) retains commands,
receipts, before/after probes, input fingerprints and final screenshots.
The 1,150 recorded implementation/test/documentation/build inputs stayed
unchanged from the start of the complete check through artifact acceptance.

| Gate | Result |
| --- | --- |
| `npm run check` | Passed, exit 0: format, lockfile, lint, architecture, references, snippets, builds, types, licenses, package exports/artifacts and release manifests. Six workspace suites passed 4,670 tests across 370 files, including 50 additional regressions since the preceding repair baseline. |
| `npm run docs:build` | Passed, exit 0: 114 pages built, 112 public references verified, local search and site notices generated. |
| `npm run check:external-install -- --keep` | Passed from five actual `0.3.0` tarballs in an independent consumer: 174 ESM/CJS runtime entries, 91 ESM/browser and 87 CJS declarations, strict `node16`/`nodenext`/`bundler` checks and Score model composition. |
| Actual tarball and negative peer checks | All five tarballs contain only `dist/`, README, LICENSE and package metadata. Explicit published Kernel/UI `0.2.0` plus candidate Audio `0.3.0` now fails with the expected `ERESOLVE` on Kernel `^0.3.0`. No peer bypass flags were used. |
| Dependency audits | Production: zero findings. Full dependency audit: zero high/critical, ten existing moderate reports in the site's PostCSS chain; exit 0 at the declared high threshold. DEP-02 remains in STATUS. |
| Public native automation | All 20 real-time trials retain active leases without scheduling errors. Six offline linear/exponential/loop-reset scenarios pass 36 sampled PCM comparisons, including deliberate stale submission anchors; maximum absolute sampled error is `0.0000020981` against tolerance `0.0001`. |
| Public Audio regression probes | Ten native/DOM scenarios pass with zero browser errors: borrowed gain/mute, source transitions and explicit meter targets. Twelve sampled amplitude comparisons verify the six audio-output cases. |
| Shared scheduling/effect acceptance | All eleven existing native cases pass against the final public outputs, covering shared anchors, loop/seek/rate behavior, modulation and effect transitions/tails. |
| Public editor and built documentation | Eleven focused editor checks pass. The actual guide's HTML, 43 JavaScript files and three CSS files match the current build bytes. The wider guide/UI Kit flow also passes save/import/export, keyboard editing, missing-plugin recovery, rejected-import preservation and 320px layout checks, with zero page errors. |

The complete suite passed on its first integrated run. During earlier focused
Audio work, one existing cancellation test timed out under an eight-worker run;
the unchanged suite then passed alone and with two workers. Both that log and
the later successful complete run are retained. The independent automation
retirement probe also passes after the final project fix, including its
unchanged `baseRevision` assertion.

These finite Chromium checks do not establish hardware latency, audible quality,
mobile behavior or immunity to scheduling starvation. Native submission repair
is bounded to three attempts; persistent stalls remain an underrun boundary.
The offline fixtures document their readiness/clock adapters and compare the
stated samples or windows, rather than every rendered frame.

## Remaining delivery conditions

Publication still requires a clean reviewed release commit, the same commit's
CI results, publisher authentication, registry installation verification and an
accurate release receipt. Website deployment additionally requires resolving
the eight public media assets in [ASSETS](../../../apps/doc/webmusic/ASSETS.md).
These files are not part of the npm tarballs. No new media rights are inferred
from this code repair.
