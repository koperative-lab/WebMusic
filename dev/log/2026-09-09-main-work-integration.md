# Original main work integration — 2026-09-09

This follow-up integrates the original main draft work after the
[Score review workflow](2026-09-09-score-review-workflow.md). The user explicitly
requested committing that work after the first merge had preserved it separately.
The source snapshot is `734040824b1ebed88fa0520f13a5429843b6c228` on
`codex/main-drafts-20260909`, based on `364adf0`. The reviewed main baseline is
`74699f7f03827111f62a3070fd88fd903d3f8f2f`.

## Scope and reconciliation

The snapshot preserves all 162 original draft paths, including documentation
navigation, Score playback sources and configuration, Kernel/Bridge command
authority, UIKit interaction helpers and their reference examples. Its commit
records the original work before conflict resolution; it does not independently
certify that snapshot's browser or device behavior.

The merge retains the reviewed five live Analyze surfaces and three View
families. Shared nonvisual playback attachment is integrated into their retained
implementations; retired tags are not restored merely because the draft changed
their earlier implementations. Native source snapshots, explicit nominal seek
units, source identity and borrowed cleanup remain the governing contracts.

Focused merge regressions exercise a paused owner's occurrence cleanup,
custom mount transport-seek fallback, owner-settled map positions, renderer
configuration, and late registration/disposal of a native playback source.
Explicit URL data also needs identity reconciliation after its asynchronous load;
an initial snapshot alone cannot compare a local Score that has not resolved yet.

Family start pages and one Element/Headless inventory per family absorb the
retired capability overviews. Owning leaf/API pages retain detailed contracts;
repository links name the current owner, while redirects serve old bookmarks.
Responsive UIKit and external Parameters/Copy/Reset behavior remain compatible
with the draft's input helpers and composition examples.

The draft used DEC-013–DEC-016 for shared playback attachment, command authority,
composition/mode contracts and documentation navigation. Those records are now
DEC-017–DEC-020, preserving the reviewed Score decisions already on main. The
[original audit](../audits/2026-09-08/DESIGN-CONTRACTS.md) retains its historical
identifier context and test/browser evidence, with an explicit integration note.

## Verification and delivery

Environment: local macOS arm64, Node `22.14.0`, npm `10.9.2`. Results below apply
to the integrated source and its built declarations, not either parent snapshot.

| Gate | Result |
|---|---|
| `npm run check` | Passed: 250 workspace test files / 3,104 tests, 240 compiled documentation examples, source/test typechecks, lint, format, lockfile, architecture, documentation, licenses, 89 public entry checks and release manifests. |
| `npm run docs:build` | Passed: 108 built pages, 107 indexed English pages. The existing unset-site sitemap warning remains. |

The first full test run exposed an assertion still spying on the Element command
instead of the shared playback source. The corrected regression checks one native
command, advancement, the rate-scaled owner position and agreement between both
followers; the complete gate was rerun successfully. Astro reports two existing
Audio recorder deprecation hints, with no errors or warnings.
After finalizing this log, `docs:sync`, `check:dev-docs`, `check:docs` and
`check:format` were rerun for the final documentation changes.

Delivery keeps `7340408` reachable as the merge parent and restores the original
project directory to the integrated `main`. The isolated checkout retains the
integration branch. A normal push to `origin/main` is followed by checking that
the local and remote heads agree; the final handoff reports that outcome.

Browser rendering, audible timing, MIDI/microphone devices and a fresh Node 24
environment were not revalidated by this integration and require their own
evidence. A pushed commit does not establish remote CI completion.

The [current queue](../STATUS.md) owns the remaining product work. This log does
not start an Audio review, a release or a deployment.
