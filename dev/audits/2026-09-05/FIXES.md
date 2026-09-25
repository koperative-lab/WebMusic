# WebMusic audit remediation record

> Editorial note (2026-09-05): translated to English and given portable file links during the documentation reorganization. Findings, measurements, and verification limits remain historical; cited source line numbers refer to the reviewed snapshot. Current work is tracked in [STATUS](../../STATUS.md). Raw evidence is unchanged; portable log copies are listed in [the evidence manifest](evidence/portable-evidence.json).

2026-09-05: audit findings A01–A15 were fixed in code or documentation, together with the supplementary Stage reentrant resource leak. Changes already present before remediation were preserved. No commit, publication or deployment was performed.

## Remediation scope

| Finding | Implementation outcome | Main files |
| --- | --- | --- |
| A01 Infinite failure loop | Each play request tries at most one pass; exhaustion ends playback and permits explicit retry; retry from the end event uses a new request | [playlist.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts) |
| A02 Concurrent play leaks resources | Play requests in the same generation are merged, with the Promise published before external callbacks; stale requests cannot replace a newer instance | Same as above |
| A03 Mixer resumes after stop | Validate the latest intent and member identity around resume, preload and asynchronous start; reapply stop/pause to a late start | [mixer.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/mixer.ts) |
| A04 Queue state migration | Preserve the state object for the same id and source; rebuild the player when the source changes; deletion invalidates old loads; renaming preserves pending state updates | [playlist.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts) |
| A05 Failed effect graph leaks resources | Track nodes, connections and restored parameters in a temporary graph, then swap on success; roll back failures while retaining the old graph; continue remaining cleanup when one cleanup fails | [synth-panel-audio.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/synth-panel-audio.ts), [synth-panel.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/synth-panel.ts) |
| A06 Notes start early while the audio clock is suspended | Note starts and public noteOn events wait for the audio clock; recheck when not yet due, with pause/stop able to cancel | [score-player-scheduler.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/score-player-scheduler.ts) |
| A07 Borrowed controller rate reset | Separate attribute initialization from an explicit `.rate` command; preserve the caller's rate on mount and reconnect | [score-player.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts) |
| A08 Disposed Rack retained after desk removal | Reselect the actual desk on mount, render and subtree changes; fall back to score/src after removal | Same as above |
| A09 Missing public Rack controls | Forward time and seeking consistently through the transport handle; Rack supports seeking in seconds and clamps to member durations | [preset-player.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/internal/preset-player.ts), [rack-transport.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/rack-transport.ts) |
| A10 Bridge context has no closing owner | The returned sync owns a factory-created context and releases it in dispose's finally block; construction failure rolls back; shared contexts remain open | [owned-context.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/owned-context.ts), [sync.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/sync.ts), [audio-master.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/audio-master.ts) |
| A11 False lead-in drift | Skip correction until the follower's actual start; continue checking other followers and resume checks after the start | [sync.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/platform/kernel/src/sync.ts) |
| A12 Keyboard hits cross instance boundaries | Scope queries to the current board and validate pointer hits with board.contains | [note.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/note.ts) |
| A13 Missing stylesheet forwarding | macro, macroRack and canvasStage forward the style policy to child presenters | [macro.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/macro.ts), [stage.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/stage.ts) |
| A14 Lint scans hidden worktrees | ESLint explicitly excludes `.claude/**`; no developer working copies need deletion | [eslint.config.mjs](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/eslint.config.mjs) |
| A15 Stale styling prose | Updated 13 UI Kit documentation pages to align the option, composed styles and related contracts | [UI Kit documentation](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/uikit/index.mdx) |
| Supplementary Stage reentrant leak | Recheck host ownership after external render/cleanup/subscribe callbacks and immediately release late resources | [stage.ts](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/stage.ts) |
| Supplementary kernel test typecheck | Added kernel tests to the test tsconfig and fixed a callback that incorrectly returned an array length | [tsconfig.test.json](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/tsconfig.test.json) |

## Compatibility and documentation

- `PresetPlayerHandle` gains optional `currentTime`, `duration`, `seek` and `seekFraction`; existing custom handles can continue using the player fallback.
- `RackTransportController` gains `seek(seconds)`; fractional seeking uses the same policy.
- Bridge retains the `{sync, scorePlayer, clipPlayer}` return shape and uses the existing `sync.dispose()` to release factory-created contexts. Externally supplied contexts are not closed.
- Clarified the existing behavior whereby a manually constructed ScoreAudioSync invokes participants' optional disposers, and corrected documentation that omitted the context constructor argument.
- Documented explicit retry after an entirely failed playlist pass and source replacement under the same id.

## Verification

The final `NODE_OPTIONS=--max-old-space-size=6144 npm run check` **passed with exit code 0**. This executed the complete original check chain, including the repaired lint configuration, rather than separate commands bypassing a failure.

| Workspace | Test files | Passing tests |
| --- | ---: | ---: |
| kernel | 9 | 85 |
| audio | 53 | 553 |
| score | 100 | 1,170 |
| UI | 24 | 259 |
| bridge | 6 | 98 |
| Documentation client | 5 | 40 |
| **Total** | **197** | **2,205** |

Compared with 2,141 before remediation, this is a net increase of **64 regression tests**. Coverage focuses on bounded failure passes, concurrent/reentrant starts, stop/source replacement while waiting, graph-construction rollback, frozen audio versus wall clocks, real Rack interfaces, context ownership, two-instance interaction and composed styles.

The full chain also passed format, lockfile, architecture, documentation structure, five-package builds, 153 documentation snippets, source and test typechecks, license rules, 86 public export entries and release-manifest consistency. Higher-risk Score and Bridge/kernel changes received an additional independent read-only agent review.

`npm run build -w webmusic-doc` also passed against the final package outputs, generating 120 pages with 119 in the search index. Format, documentation structure and diff whitespace checks passed again after the report and supplementary documentation were written.

- [Final complete check log](repair-evidence/check.log.txt)
- [Final documentation build log](repair-evidence/docs-build.log.txt)
- [Pre-fix audit and reproduction evidence](README.md)

Verification still used local Node 22. It did not include real audio-device/MIDI/microphone acceptance, a fresh Node 24 installation or an online dependency vulnerability scan; passing unit tests must not be taken as evidence that those checks were completed. Existing documentation-build warnings about large chunks and skipped sitemap generation without DOCS_SITE were outside this remediation scope.
