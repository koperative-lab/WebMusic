# Design contracts and reference compositions — 2026-09-08

This dated record covers the implementation requested after the overall design
review. The starting checkout was clean local `main` at `364adf0`; the changes
described here are uncommitted. [STATUS](../../STATUS.md) owns remaining work.
The Chordio worktree's concurrent changes and the retained branch histories were
preserved. This record does not claim that the implementation was merged into
other branches or published.

**Later integration note (2026-09-09):** the draft described here was preserved
as commit `7340408` and integrated after the Score component review. Its local
decision identifiers DEC-013, DEC-014 and DEC-015 correspond to current DEC-017,
DEC-018 and DEC-019; the original identifiers below retain their dated context.
The retired ScoreMap implementation's attachment and seek contracts now belong
to the map mode of [ScoreView](../../../packages/score/src/view/element/score-view.ts).
Current verification belongs to the [main integration log](../../log/2026-09-09-main-work-integration.md),
not this earlier test or browser snapshot.

## Resulting contracts

| Area | Change | Owning source or reference |
|---|---|---|
| Command authority | Kernel and Bridge expose revisioned snapshots, subscriptions and awaited command outcomes on a stable content-position axis. Reentrant observers, superseded commands, failed starts and late joins retain the current authority. | [Kernel synchronization](../../../platform/kernel/src/sync.ts), [shared-clock design](../../../platform/shared-clock-injection.md), DEC-014 |
| Participant mapping | Followers support affine offset/scale and explicit native-loop phase mapping. Differing native loop lengths can follow a continuous master; native engine configuration remains caller-owned. | [Kernel API](../../../apps/doc/webmusic/src/content/docs/kernel/api.mdx) |
| Borrowed playback | Score core defines a nonvisual source. Native Headless and Element players expose resolved Score data, readiness, position and occurrence-aware active notes. Analyze, ScoreView, ScoreMap and Headless ScoreView consume that contract without importing Play. | [Source contract](../../../packages/score/src/core/playback.ts), [player binding design](../../design/PLAYER-BINDING.md), DEC-013 |
| Browser attachment | Unique same-root selector discovery follows late insertion, replacement and upgrade. Disconnect releases discovery/subscriptions; pending definitions cannot retain the host callback indefinitely. Legacy events remain available only when native observation is absent or unavailable. | [Element discovery](../../../platform/kernel/src/elements.ts), [Analyze connection](../../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze) |
| Source identity and seeks | Explicit data retains precedence. Native followers reject navigation and suppress incompatible activity for a different Score object. Nominal seeks preserve rate-independent units, report failed restarts and use the resulting owner position after loop wrapping. | Historical `packages/score/src/view/element/score-map.ts` at `7340408`; [Score playback reference](../../../apps/doc/webmusic/src/content/docs/score/headless/play/score-player.mdx) |
| View configuration | A discriminated configuration validates mode and supported option keys before atomic replacement. Existing property setters remain available. Exact catalog membership and dependency checks replace redundant fixed-count assertions. | [View configuration](../../../packages/score/src/view/core/configuration.ts), [architecture checker](../../../scripts/check-architecture.mjs), DEC-015 |
| Reference use | Audible beginner examples and a runnable Score/Audio composition exercise shared commands, late views, rate, seek, replacement and cleanup. A second composition demonstrates independent native loop phases. | [Playback composition](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/apps/doc/webmusic/src/content/docs/bridge/composition.mdx), [Quick Start](../../../apps/doc/webmusic/src/content/docs/quick-start.mdx) |

The docs distinguish full Chordio/MVMNT experiences from reusable capabilities;
this pass does not implement those complete experiences. Existing demos now omit
duplicate companion sources when borrowing a player's resolved Score. The agent
guide maps the accepted contracts, and `CLAUDE.md` remains a relative symlink to
`AGENTS.md`.

## Verification

Environment: local macOS arm64, Node v22.14.0, npm 10.9.2, installed workspace
dependencies. Tests use real contracts where practical and fake clocks/adapters
for deterministic asynchronous timing and failure scenarios.

| Check | Recorded result |
|---|---|
| `npm run check` | Passed after the final compatibility fix: 208 workspace test files / 2,335 tests, 238 compiled snippets, source/test typechecks, lint, format, lockfile, architecture, documentation, licenses, 86 public export checks and release manifests. |
| `npm run docs:build` | Passed after the final compatibility fix: 121 built pages, 120 indexed English pages. Existing redirect-index, bundle/directive and missing-site-origin sitemap warnings remain. |
| Legacy renderer regression | An actual protected custom mount without a native `.player` retains Analyze/View events, rate-2 nominal seek conversion and teardown. The final focused compatibility suite passed 5 files / 71 tests. |
| Browser composition smoke | In-app browser at `/bridge/composition/`: load succeeded; positions advanced during playback; both late views became ready without a companion `src`; a paused midpoint seek at 2× settled at 4.00 Score seconds and 4.00 clip seconds; detach/reattach restored ready projections; replacement produced the descending phrase and ready views; disposal removed views and reported no active session. |
| Browser native-loop smoke | After pause and a master seek to 4.25 s, the 1 s and 1.5 s players showed 0.25 s and 1.25 s. The same positions were observed at 2×. Disposal completed; no warning/error console entries were captured for these actions. |
| Final static-build smoke | Repeated load/play/pause, late attachment, the 2× midpoint seek, replacement, disposal and both native-loop rate cases against `astro preview` after the final build. Positions and ready views matched the development smoke; the final tab captured no warning/error console entries. |

The full check includes the unavailable-port compatibility and source/command
regressions. The development documentation inventory contains 180 indexed files;
generated links, documentation conventions and formatting checks passed.

## Remaining boundaries

One command authority does not imply one shared writable clock instance. Engine
clock injection and sample-accurate cross-domain group-loop scheduling remain
open. Local-loop phase observations do not measure acoustic timing or guarantee
gapless audio. Browser smoke did not establish audible output, cross-browser or
background behavior, device permissions, complete accessibility, a fresh Node 24
installation or external package installation.

Controller/Rack modes still cannot expose a single resolved Score by inference.
Readout/log tags, keyboard player binding and chord preview remain targets.
Mode configuration validates option compatibility, not every renderer value or
range. Project files, undo/storage and workstation workflows remain application
responsibilities. No remote release, deployment, commit or branch mutation was
performed by this implementation pass.
