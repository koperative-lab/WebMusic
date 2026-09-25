# WebMusic project audit — 2026-09-05

> Editorial note (2026-09-05): translated to English and given portable file links during the documentation reorganization. Findings, measurements, and verification limits remain historical; cited source line numbers refer to the reviewed snapshot. Current work is tracked in [STATUS](../../STATUS.md). Raw evidence is unchanged; portable log copies are listed in [the evidence manifest](evidence/portable-evidence.json).

> This document preserves the pre-fix audit snapshot. Subsequent remediation status, compatibility notes and final verification are recorded in the [remediation record](FIXES.md).

The audit found that the project already had substantial architecture boundaries, build infrastructure and tests, but real defects remained at playback-lifecycle and component-composition boundaries. The recommended order was to stop the playlist's infinite retries, then repair asynchronous cancellation, resource ownership and cross-component state consistency before release acceptance.

The main list contains **15 verified findings: P1 × 1, P2 × 13, P3 × 1**. Explicit verification gaps and a small number of boundary improvements are listed separately, rather than counted as confirmed defects. No P0 issue was confirmed. The online dependency vulnerability scan was incomplete, so this report does not assert that there were no known dependency vulnerabilities.

## Scope and method

- The audit covered the working tree, not only HEAD or a single commit diff. It began with 197 modified, 5 deleted and 18 untracked status entries: 220 Git status records in total. An untracked directory entry is not a count of individual files.
- Coverage included `platform/kernel`, `packages/ui`, `packages/score`, `packages/audio`, `bridges/score-audio`, `apps/doc/webmusic`, and root check/CI/release scripts.
- Methods combined source review, the existing complete tests, build/type/export checks and independent minimal reproductions. Priority areas were asynchronous races, stop semantics, cleanup, input handling, UI instance isolation and public API contracts.
- Local environment: macOS, Node `22.14.0`, npm `10.9.2`, using existing `node_modules`. No fresh `npm ci` or Node 24 environment was tested.
- Audio and DOM reproductions used real project classes or current source, with observable AudioContext, source, clock and JSDOM doubles. No real audio device, microphone, MIDI device or browser-background transition was tested.
- Product source and configuration were not changed; only this report and evidence were added. Builds regenerated Git-ignored outputs. Before the report was added, Git status was identical to the audit's starting state.

P1 denotes a severe availability defect to prioritize. P2 denotes incorrect behavior in normal operation or an explicitly supported boundary, to address before releasing the affected feature. P3 denotes a lower-impact documentation or maintenance issue.

## Checks performed

| Check | Observed result |
| --- | --- |
| Five-package `build:packages` | Passed, including ESM/CJS/declarations and worker postprocessing |
| `npm test` | **195 files and 2,141 tests passed** |
| Workspace `typecheck` | Passed; Astro checked 111 files with 0 errors, 0 warnings and 2 deprecation hints |
| `typecheck:tests` | Passed; its include list did not cover kernel tests, as noted under verification gaps |
| `check:format` | Passed |
| `check:lockfile` | Passed: optional-dependency name completeness across 1,139 locked package records |
| `check:architecture` | Passed: 5 packages and 354 checked source modules |
| `check:docs` | Passed: 62 live-demo pages, 77 instances, 119 pages, 31 elements and 119 routes |
| `check:doc-snippets` | Passed: 153 TypeScript snippets compiled |
| `check:packages` | Passed: 86 public export entries |
| `check:licenses` | Passed the project's listed restricted-dependency rules |
| `check:release-manifests` | Passed: the five package versions and workspace ranges agreed at `0.1.0` |
| Production documentation build | Passed: 120 pages generated and 119 indexed for search |
| Original `npm run lint` | **Failed: 8 errors originated in copies under `.claude/worktrees`** |
| ESLint explicitly excluding `.claude/**` | Passed; used to identify the failure source, without changing configuration |
| Common secret-pattern scan | Scanned 879 working-tree text files; no matches for the tested private-key/GitHub/AWS/npm/OpenAI token patterns |
| Online npm vulnerability scan | Incomplete: the ordinary request failed DNS resolution and the elevated network request was rejected by automatic approval review |

Complete test distribution: kernel 84, audio 526, score 1,157, UI 249, bridge 85 and documentation client 40. Total: 2,141. Independent reproductions and hidden-worktree tests are not counted again.

Because the original lint command failed, these individual results cannot be described as a fully green `npm run check`. The documentation build also reported chunks over 500 kB and skipped sitemap generation because `site` was not configured. Redirect-page search-index notices were not confirmed functional defects in this audit.

## Findings

### A01 · P1 · A looping playlist with every entry failing starves the event loop

Locations: [playlist.ts:369](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts#L369), [playlist.ts:436](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts#L436).

`skipFailed` is enabled by default. A load failure enters `advance → goTo → play`, and `loop:true` returns to failed entries, without an end condition after one failed pass or asynchronous backoff. An immediately rejecting loader, missing loader or missing source can trigger it.

**Reproduction:** with one URL entry and an immediately rejecting loader, an independent subprocess printed "1000 errors before event loop yielded" before a 300 ms timeout. A previously scheduled 10 ms timer containing `queue.stop()` never executed, and the subprocess was terminated with SIGTERM. This was continuous microtask occupation of the event loop, not simply excessive logging.

**Impact:** page input, rendering and timers may stop running; a failing list can make its host page unresponsive.

**Recommendation:** end a pass with no playable entries and report a clear failure once. Retry through an explicit operation or a task with backoff, not recursive microtasks. Regression coverage should bound error counts, prove timers execute and verify responsive stopping.

### A02 · P2 · Concurrent play creates two queue players, while stop controls only the last

Location: [playlist.ts:363](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts#L363).

`ensurePlayer()` checks `this.player` before awaiting, but neither checks again afterward nor merges an in-flight creation task. Two `play()` calls can share one load result and still create separate players. The later instance overwrites the earlier player and its subscription disposer.

**Reproduction:** `await Promise.all([queue.play(), queue.play()])` produced 2 sources and 2 trackchange events. After `queue.dispose()`, stopped was `[false, true]` and 1 cursor interval remained.

**Impact:** a rapid double click or simultaneous starts from two controls can produce duplicate sound, with audio and timers surviving stop/disposal.

**Recommendation:** share the in-flight player-creation Promise and revalidate generation, entry identity and the published player after awaiting. Check before publishing an instance and dispose any result that has become stale.

### A03 · P2 · An asynchronous Mixer start overrides a later stop

Location: [mixer.ts:226](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/mixer.ts#L226); related: [mixer.ts:138](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/mixer.ts#L138).

After awaiting preload, `startAligned()` plays the original member snapshot without checking for an intervening stop, pause or member replacement. Seeking during playback also enters this asynchronous restart path.

**Reproduction:** `const p = mixer.play(); mixer.stop(); await p` created a still-running source after stop. `await mixer.play(); mixer.seek(1); mixer.stop()` also added a second running source after microtasks were flushed.

**Impact:** audio can restart after the user has stopped it. The demonstrated path is stop; the evidence does not establish that every dispose path also fails.

**Recommendation:** introduce a playback-intent generation and check it after every asynchronous stage. Stop, pause and member removal must invalidate old work. Cover play→stop, seek→stop and delayed preload.

### A04 · P2 · Replacing queue entries can make playback disagree with public state

Locations: [playlist.ts:132](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts#L132), [playlist.ts:147](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts#L147), [playlist.ts:349](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/audio/src/play/headless/playlist.ts#L349).

These cases share `setEntries()` state-migration faults: deleting the current entry does not advance the generation; replacing a source under the same id does not replace the playing player; a same-source update copies the state object and retains its loading Promise, whose resolution still writes the old object.

**Three demonstrations:**

1. Delete an old loading entry and replace it with a 3-second clip. When the old request returns a 1-second clip, `current.id` identifies the new entry and `currentClip.duration=3`, but `activePlayer.duration=1`.
2. Retain the id and replace a 1-second clip with a 3-second clip: the public clip is again 3 seconds while the active player is 1 second.
3. Change only the label during loading: playback works after completion, but public state remains `loading` and `currentClip` is empty.

**Recommendation:** use both id and source to decide whether to preserve a player; source changes and deletion must invalidate old tasks. Retain object identity for same-source state, or make pending resolution explicitly update current state. Cover the three cases separately.

### A05 · P2 · Failed effect-chain rebuilds leak new nodes after dismantling the working chain

Location: [synth-panel-audio.ts:94](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/synth-panel-audio.ts#L94).

`options.effects.map(effect => effect.build(context))` assigns `this.effectNodes` only if every build succeeds. If the second build throws, the first new effect node has already been allocated but is not recorded. The old chain was dismantled earlier.

**Reproduction:** install a working old effect, then build `[successful effect, throwing effect]` and tear down: the old effect's dispose count was 1, while the first effect in the new chain had dispose count 0.

**Impact:** a failed edit disrupts the old audio route. Allocated effects escape subsequent normal cleanup, and active nodes may continue consuming resources.

**Recommendation:** record allocations individually in a temporary graph and swap only after the complete chain connects successfully. On failure, clean up the temporary graph and retain the old route.

### A06 · P2 · Wall-clock timers trigger future notes before a suspended audio clock reaches them

Locations: [score-player-scheduler.ts:689](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/score-player-scheduler.ts#L689), [score-player-scheduler.ts:718](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/score-player-scheduler.ts#L718).

`startRecord()` does not verify that the audio clock has reached `record.audioStart`. After a future note is queued, AudioContext can suspend while setTimeout continues, causing an immediate backend to send noteOn at the frozen currentTime. The audio-clock-scheduled path can also emit public note events early.

**Reproduction:** schedule a note at 0.1 s, set the context to suspended with currentTime=0, and advance wall time by 150 ms: `noteOn(62,80,0,0.5)` is received.

**Impact:** note timing and visual events disagree after resume. Immediate backends such as MIDI may also trigger external sound while audio is suspended. Real-device behavior still requires testing.

**Recommendation:** determine whether a start is due using the audio clock, as the note-release path does. Continue waiting when it is not due, without marking it started or emitting events early.

### A07 · P2 · Mounting UI with a borrowed controller resets its existing rate to 1

Locations: [score-player.ts:337](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts#L337), [score-player.ts:365](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts#L365).

During mounting, `syncKnobAttributes()` calls setRateValue with the default rate of 1, then applyRate writes it to the external controller. The comments and property contract instead assign borrowed-controller state to its caller, with only explicit `.rate` assignments delegated as writes.

**Reproduction:** set a real PlayerController's rate to 1.5, assign it to a disconnected element, then append the element: controller.rate becomes 1.

**Recommendation:** distinguish internal default initialization from explicit user commands. On mounting in borrowed mode, read the controller snapshot rather than writing defaults back. Cover first connection and reconnection.

### A08 · P2 · Removing a composed rack-control leaves a reference to its disposed Rack

Locations: [score-player.ts:479](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts#L479), [score-player.ts:524](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts#L524).

`composedRack` updates only when a Rack is found or received, and is not cleared when the child is removed. Disconnecting the child disposes its owned Rack, but the parent still prefers that old reference.

**Reproduction:** mount real `<score-player><rack-control><rack-part>` elements, remove the desk, and assign a valid Score to the parent: `play()` still rejects with `Rack has been disposed`.

**Recommendation:** track the actual desk identity and subtree changes. Clear the composition reference and reselect inputs on removal, including reinsertion and replacement cases.

### A09 · P2 · Rack mode lacks forwarding for public element seek and time access

Locations: [score-player.ts:415](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts#L415), [score-player.ts:428](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/element/score-player.ts#L428).

These public methods delegate only to `externalController` or `handle.player`. The Rack handle has no player. Its internal RackTransportController has the required state and seeking capability, but the outer API does not reach it.

**Reproduction:** preload a real Rack/ScorePlayer and seek(.5): the member has seconds=.5 and duration=2, while the element has currentTime=0 and duration=0. Calling element.seek(1) and seekFraction(.5) leaves the member seek-call count at 0.

**Impact:** built-in UI can work while external progress displays, shortcuts or synchronization code fail when using the element's public API.

**Recommendation:** expose seek, seekFraction and time snapshots through a consistent transport handle instead of assuming every mode contains one player.

### A10 · P2 · Bridge-created AudioContexts have no owner responsible for closing them

Locations: [sync.ts:435](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/sync.ts#L435), [audio-master.ts:221](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/audio-master.ts#L221).

Without a supplied context, both factories create one and pass it to the players as externally borrowed. Sync disposal cleans up only the group; the factory provides no combined cleanup entry point responsible for closing its own context.

**Reproduction:** call both factories and individually dispose every returned object: created=2, closed=0.

**Impact:** repeated creation and disposal of playback groups leaves audio contexts behind. The path where the application supplies a shared context is outside this finding.

**Recommendation:** make context ownership explicit and provide idempotent combined disposal that closes only factory-created contexts, including rollback on construction failure.

### A11 · P2 · A valid recording lead-in is reported as nonconverging drift

Locations: [audio-master.ts:151](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/audio-master.ts#L151), [sync.ts:482](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/platform/kernel/src/sync.ts#L482).

When a recording contains lead-in before score zero, scoreAsFollower delays the actual score start, but its translated clock holds at the offset while waiting. Sync excludes waiting only through the generic joinAt, which does not cover the score's later actual start, and treats this valid hold as drift.

**Reproduction:** with clipOffsetSeconds=2, now=.25 reports drift=1.81 s; .5/.75 s restart the score again; at 1 s it reports "4 consecutive drift corrections failed to converge", although the legitimate score start is still 2.06 s.

**Impact:** unnecessary rejoins and errors occur before the score begins, temporarily suppressing correction. This is separate from the documented lack of fully sample-accurate loop wrap.

**Recommendation:** expose the follower's actual holding interval to sync, or make the lead-in adapter clock express a comparable virtual position. Do not count failed corrections before the lead-in ends.

### A12 · P2 · Multiple keyboard presenters can hit keys across instance boundaries

Locations: [note.ts:211](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/note.ts#L211), [note.ts:224](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/note.ts#L224), [note.ts:350](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/note.ts#L350).

In light DOM, root is the whole Document. Pitch-node lookup returns the first matching key, and pointer hit-testing does not check whether the result belongs to the current board.

**Reproduction:** when the second piano receives a QWERTY key, binding B receives `[60,true]`, but firstPressed=true and secondPressed=false. Dragging from keyboard A to B then sends B's pitch 72 to binding A.

**Impact:** pressed-key visuals cross instances; pointer capture can also make the wrong instance play a pitch.

**Recommendation:** scope queries to the current board and validate hits with board.contains(element). Cover two instances in the same Document and ShadowRoot, plus cross-board dragging.

### A13 · P2 · Composite presenters do not forward stylesheet:false to children

Locations: [macro.ts:168](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/macro.ts#L168), [macro.ts:232](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/macro.ts#L232), [stage.ts:628](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/ui/src/stage.ts#L628).

After the parent disables stylesheet injection, child mounts still use the default stylesheet=true.

**Reproduction:** macro still injects parameter styles; macroRack injects macro and parameter; canvasStage with status still injects status.

**Impact:** components insert global rules despite the caller choosing to manage CSS, potentially affecting other presenters or violating host integration constraints.

**Recommendation:** forward the style policy. Test that the entire composed subtree contains no style element, rather than checking only the top-level style.

### A14 · P2 · Root ESLint scans hidden worktrees and breaks the standard check chain

Locations: [eslint.config.mjs:9](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/eslint.config.mjs#L9), [eslint.config.mjs:47](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/eslint.config.mjs#L47).

The root script runs `eslint .`, but its ignore list omits `.claude/`, which .gitignore already excludes. React files in hidden worktrees match generic rules without matching the root React-hooks plugin path configuration. Existing disable comments therefore report an unknown rule.

**Observed result:** standard lint failed with 8 undefined `react-hooks/exhaustive-deps` errors across 4 hidden worktrees. `eslint . --ignore-pattern '.claude/**'` passed.

**Impact:** local `npm run check` stopped at lint. A clean CI checkout may not contain these directories, so this does not establish the same remote CI failure.

**Recommendation:** explicitly exclude nested worktrees or scope scans to project-owned source paths. Deleting developers' working copies is not the remedy.

### A15 · P3 · UI styling prose contradicts the API on the same page

Example locations: [note.mdx:169](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/uikit/notes/note.mdx#L169), [eq.mdx:109](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/uikit/parameters-gestures/eq.mdx#L109), [timeline.mdx:208](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/uikit/transport-time/timeline.mdx#L208).

Several Styling sections still say there is no stylesheet option or that every mount always installs styles, while current source and the same pages' parameter tables support stylesheet:false. The note/recorder descriptions of classNames and parts also need review.

**Impact:** readers can make incorrect light-DOM, theming or style-integration choices from stale prose. Existing structure and snippet-compilation checks do not detect these natural-language contradictions.

**Recommendation:** update the Styling sections consistently and add targeted consistency checks for frequently changing key contracts.

## Architecture and engineering assessment

Well-established areas include the five packages' responsibilities and dependency boundaries, the separation of kernel and UI foundations, and the Bridge connection between Score and Audio. Public exports, ESM/CJS declarations, SSR import safety, worker fallback, documentation snippets and cross-package versions already have checks. Source uses strict TypeScript and has substantial input-limit and lifecycle regression coverage. These judgments come from code and passing checks, not only README claims.

The main gap is **coverage of combined state transitions**. Existing tests extensively cover a single success, a single failure and explicit disposal, yet concurrent starts, stop or replacement while waiting, child removal and failure partway through construction can still escape resource boundaries. A02–A11 show why a large test count does not replace coverage of critical operation sequences.

Retain the package boundaries and prioritize consistent internal conventions for resource ownership, operations that invalidate asynchronous results, and public transport capabilities. There is no evidence that the project needs a full rewrite or another monorepo split.

## Security, performance and verification boundaries

- **Inputs and DOM:** reviewed major loading/parsing limits and dynamic text/attribute construction. Reviewed UI dynamic text mainly uses textContent; no DOM XSS was confirmed. The audit did not fuzz every format or complete dependency vulnerability matching.
- **Secret patterns:** no tested common-token pattern matched across 879 files. This does not cover Git history, arbitrary credential forms or deployed environments.
- **Dependencies and licenses:** every non-link resolved address in the lockfile used the official npm registry. The license gate is a known-package-name rule set, not a complete transitive-dependency license-compliance determination. No legal assessment was made.
- **Online audit blocked:** the ordinary npm audit request failed DNS resolution. A subsequent elevated network request was rejected by automatic approval review because npm audit sends dependency metadata to npm's official service and the reviewer considered that transmission insufficiently authorized. Specific authorization was requested from the user; no alternative route was used to bypass the rejection before authorization arrived.
- **Measured performance scope:** A01 demonstrated event-loop starvation; A02/A05/A10 showed observable resource omissions. Real-device latency, long-duration memory profiles and Core Web Vitals were not measured.
- **Build size:** the documentation output included api-sandbox-client at about 621.18 kB (gzip 210.14 kB) and OSMD at about 1,223.48 kB (gzip 322.39 kB). ApiSandbox dynamically imports near the viewport, so these sizes are not necessarily the initial homepage download. Measure actual per-route requests before setting a size budget.
- **Real-browser verification:** the environment prohibited binding a localhost port when a local static server was attempted. Real-browser end-to-end interaction and listening acceptance were not completed; JSDOM and successful builds do not substitute for them.
- **Installation/release:** check:packages validated package files and workspace imports. The fresh non-workspace consumer installation required by the documentation, check:external-install, was not completed. No publication, deployment or remote CI trigger occurred.
- **CI scope:** ci.yml configures Node 22/24, but this audit ran only Node 22. audit:production was not referenced by npm run check/CI. tsconfig.test.json did not include platform/kernel/test, so kernel tests passed execution without inclusion in that test-typecheck lane.

One additional, less frequent lifecycle boundary was reproduced: when Stage's binding.render synchronously mounts a replacement Stage on the same host, the old render's late cleanup and subsequent subscribe are no longer reclaimed by the old destroy. After both handles were destroyed, oldSubscriptions=1, oldCleanup=0 and oldUnsubscribe=0; see the UI reproduction log. Recheck host ownership after external callbacks and immediately run late cleanup functions. This supplementary item is not counted among the 15 main findings.

Documented behaviors, such as releasing held notes on note-surface refresh and Bridge loop wrap not being fully sample-accurate, were not counted again as new defects. EQ keyboard accessibility and error-callback consistency warrant focused improvement, but this audit did not perform a complete WCAG review.

## Remediation order and acceptance

1. **Restore controllable playback:** A01, A02, A03. Any failure combination must yield the event loop; repeated play must not create a second active instance; stale starts must not occur after stop.
2. **Establish consistent state and cleanup:** A04, A05, A08, A10. The current entry must match the audio source; replacement/removal must invalidate old tasks; failed constructions and owned contexts must be releasable.
3. **Correct clocks and public controls:** A06, A07, A09, A11. Use controllable audio and wall clocks to cover suspension, lead-in, rate and Rack mode, then perform real-browser audio/MIDI acceptance.
4. **Complete composed UI and the check chain:** A12, A13, A14, A15. Cover two instances on one page and stylesheet suppression across the composed tree; restore standard lint and align the documentation.
5. **Complete environment verification before release:** perform the online dependency scan as authorized, fresh installation, Node 24 and real-browser verification. Add a small set of valuable regressions for the missing sequences before running the existing complete checks; do not duplicate implementation details merely to increase test counts.

## Evidence index

The local `evidence/` directory preserves original check logs, machine-readable results and reproduction source text. Passing reproduction assertions mean **the audited incorrect behavior was confirmed**, not that a fix passed.

- [Complete test log](evidence/webmusic-audit-test.log.txt)
- [Build log](evidence/webmusic-audit-build.log.txt)
- [Documentation build log](evidence/webmusic-audit-docs-build.log.txt)
- [Original lint failure log](evidence/webmusic-audit-lint.log.txt)
- [Audio, Bridge and infinite-retry evidence](evidence/runtime-repros.log.txt)
- [Six Score reproduction assertions](evidence/score-repros.log.txt)
- [UI reproduction log](evidence/ui-repro.log.txt)
- [Audio reproduction source](evidence/audio-repro.ts.txt)
- [Bridge reproduction source](evidence/bridge-repro.ts.txt)
- [Score reproduction source](evidence/score-repro.test.ts.txt)
- [UI reproduction source](evidence/ui-repro.cjs.txt)
- [Infinite-retry reproduction source](evidence/playlist-loop-repro.ts.txt)

Reproduction source is stored as `.txt` to keep default project lint/test scans from treating it as product code. It uses this checkout's absolute paths and existing local dependencies; another machine requires path adjustments. Always run the infinite-retry script in a subprocess with a termination timeout, never unbounded in the main task execution environment.
