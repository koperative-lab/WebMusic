# Score editing P2

## Baseline and scope

2026-10-15, Node 26.8.1, branch `editing-capabilities`, HEAD `ef8664d` plus
the uncommitted P0–P2 working tree. This record covers P2 on top of the earlier
Score Core/Edit work. It does not transfer the earlier P1 full-check result to
this larger tree. No commit, npm publication or deployment is established here.

The current roadmap has five phases, P0–P4. P2 delivers native Score playback
revision application, declarative HTML ownership/binding and optional piano-roll
editing. [Editing contracts](../design/EDIT-COMPONENTS.md) and DEC-047 own the
accepted design; [STATUS](../STATUS.md), EDIT-01, owns current delivery and gaps.

## Delivered behavior

- A `ScoreEditor` remains the document authority. The native player borrows its
  Core read source, distinguishes requested and applied document identity/revision,
  and reports applied, superseded or failed preparation attempts. Edits pause
  playback, cancel scheduled voices, prepare and adopt content, and remain paused.
  Player, scheduler, clock and synth identities survive successful updates.
- Position and loop maps compose through skipped or failed revisions and undo.
  Later transport intent takes precedence over preparation-time snapshots.
  Unmappable or expanded-repeat playback explicitly resets to the origin and
  disables document-coordinate interaction. Stale preparation cannot adopt content.
- Nonvisual `score-document` owns the connected editor and loads its source.
  Score Player and Score View accept object `.editor` bindings or same-root
  `editor="#id"` declarations. Explicit conflicts and invalid or unavailable
  targets do not silently fall back. Borrowers do not dispose the editor.
- Existing Score View offers piano-roll selection, move/resize, insertion/deletion,
  exact numeric editing, scoped keyboard commands and undo/redo. A gesture previews
  locally and commits once. External document replacement and cancellation discard
  drafts. Staff stays a read-only rendering of the same edited document.
- Playback overlays and mapped seeks require the exact applied document revision
  and a supported coordinate map. Editable interaction is separately enabled by
  `editable`; setting it without an editor exposes an unavailable state.
- Public exports, build mappings, side effects, architecture policies, catalogs,
  references and demos include the delivered Score Edit declaration and bindings.
  Audio Edit and staff-input editing remain later phases.

The integrated demo is on the
[Score View reference](../../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx),
under “Piano-roll editing.” Its generated eight-note
[MIDI fixture](../../apps/doc/webmusic/public/midi/Editing.mid) uses 120 quarter
notes per minute. One declaration supplies a native player, editable piano roll
and read-only staff view. File import, MIDI export and configured-source reload
belong to the demo workflow rather than a second document model.

## Automated verification

The following results were obtained during P2. The full workspace run precedes
the last demo error-state and narrow file-input layout fixes; affected tests,
lint and typechecks were rerun afterward. Counts from those separate runs do not
represent a second complete workspace run.

| Command or surface | Recorded result |
|---|---|
| `npm run build:packages` | Passed for the five source packages. |
| `npm run check:format`, `npm run check:lockfile`, `npm run lint` | Passed. |
| `npm run check:architecture` | Passed, including the precise editing-surface focus exception and its regression coverage. |
| `npm run check:docs`, `npm run check:dev-docs`, `npm run check:site-notices` | Passed at the checked tree. |
| `npm run check:doc-snippets` | 258 examples compiled against stable built declarations. This does not execute the examples. |
| `npm run typecheck`, `npm run typecheck:tests` | Passed. Astro reported zero errors/warnings and three existing `keyCode` hints. |
| `npm test` | 4,310 tests passed: Kernel 163, UI 653, Score 2,228, Audio 847, Bridge 182 and documentation 237. |
| Final documentation workspace and affected checks | All 239 documentation tests in 29 files passed, including seven editing-demo tests. Repository lint and test typechecking passed again; Astro reported zero errors/warnings and the same three existing hints. Combined with the earlier unchanged workspace runs, this represents 4,312 passing tests, not a complete-suite rerun. |
| `npm run check:licenses`, `npm run check:packages`, `npm run check:release-manifests` | Passed: built exports/receipts for five packages and shared 0.2.0 metadata checked. |
| `npm run docs:build` | Passed again after the final demo/documentation fixes: five packages rebuilt, 113 pages built, 111 public Markdown references and the agent catalog verified; site notices verified 74 records across 354 files. |
| `npm run check:external-install` | Passed in a fresh non-workspace consumer: 176 runtime entries imported, Score composition exercised in ESM/CommonJS, and 92 ESM/browser plus 88 CommonJS declaration entries checked without `skipLibCheck`. |
| `npm run audit:production` | Zero vulnerabilities reported. This excludes development dependencies. |
| `npm run check` | Failed in the dev-server tests; the complete gate is not green. The later gates listed above were run independently. |

Regression coverage includes native revision adoption, stale/failing preparation,
retry, reentrant callbacks, source replacement, cleanup, transport intent and
position-map composition in
[document-binding tests](../../packages/score/test/play/document-binding.test.ts).
[Player Element tests](../../packages/score/test/play/editor-element.test.ts),
[document declaration tests](../../packages/score/test/edit/) and
[Kernel discovery tests](../../platform/kernel/test/element-source.test.ts)
cover binding ownership, conflicts, late targets and lifecycle behavior.
[Editing tests](../../packages/score/test/view/editing.test.ts) and
[player/view integration tests](../../packages/score/test/view/editor-player-integration.test.ts)
cover gestures, commands, cancellation, revision gating and retained passive modes.
[Demo workflow tests](../../apps/doc/webmusic/test/score-editing-demo.test.ts)
cover load races, replacement, cleanup and export checkpoint ownership.

### Full-gate failure

The existing test “interrupting a build stops its process tree before another
start” in [docs-dev.test.mjs](../../scripts/docs-dev.test.mjs) expects exit 143
after SIGTERM but intermittently receives exit 1. Repeated complete-gate attempts
stopped there. A focused reproduction passed five times before failing on its
sixth attempt.

Inspection and reproduction identified `drainProcessGroup()` in
[docs-dev.mjs](../../scripts/docs-dev.mjs): `process.kill(-pid, 0)` can throw
`EPERM`. Cleanup runs in `finally`, so that error can replace the intended
SIGTERM result. The dev-server implementation and test were not changed in P2.
The observation does not establish an environment-only cause or excuse the
failure; it remains an unresolved repository verification issue.

## Browser interaction evidence

The in-app browser loaded the working-tree site at `http://localhost:4322`.
The other local site at port 4321 was not used as evidence for this checkout.
Checks used the integrated Score View demo, desktop width 1280 pixels, and
narrow viewport overrides of 480×900 and 320×900.
After the final rebuild the worktree server started at `http://localhost:4323`;
the browser again reported eight notes and matching ready revision 0 there.

- Pure HTML composition loaded eight notes with the player applied to revision 0.
  The editable piano roll and staff displayed the same document.
- Arrow-right nudged a selected note to onset 1/4 quarter and published revision 1
  to both document and player. Pointer move changed onset/pitch in one revision;
  an edge drag changed duration to 3/2 quarters in one revision.
- Scoped undo and redo restored/reapplied the duration change. The numeric form
  applied onset 1/3, duration 2/3, written MIDI pitch 65 and velocity 97 together
  as one committed revision, and the staff view updated.
- The transport entered its playing state. A subsequent edit was observed with
  the new revision applied and the transport paused. This observation does not
  measure the pause's acoustic timing.
- At width 480, the editor viewport and its scroll width both measured 393 pixels;
  the larger note grid scrolled locally. At width 320, the numeric form remained
  readable. A native file-input overflow was repaired; its container then measured
  233 pixels for both width and scroll width, with a 320-pixel document body.
- The export action reported that download was requested. Browser automation did
  not receive a download-completion event, so file persistence is not verified.
  MIDI bytes and reimported timing were checked separately as described below.

Later native input attempts timed out in the browser's `Input.dispatchMouseEvent`
command while accessibility-tree reads remained available. Those attempts are
not evidence that double-click insertion, Alt-drag drawing or further native
input checks passed. Automated regressions cover these contracts, but they do
not replace browser/device acceptance.

## Browser PCM and MIDI measurement

A temporary browser harness used the public Score editor/player, I/O and offline
rendering APIs. It loaded `Editing.mid`, attached the native player to the editor,
waited for each exact revision to become applied/ready, rendered its Score through
the browser's actual `OfflineAudioContext`, serialized MIDI and reloaded it.
It then moved the first note by `[1, 2]` written quarters and repeated the
measurement, followed by undo. The edit removes that note's imported absolute
performed timing, so the test exercises the intended written-time edit path.

At 120 quarter notes per minute the expected shift is 0.25 seconds. PCM onset is
the first sample exceeding magnitude `1e-7`, at sample rate 44,100 Hz, with a
3-millisecond comparison tolerance. Each render contained 183,016 frames and
peak magnitude 0.947404682636261.

| State | Applied revision | Score onset (s) | PCM onset (s) | Reimported MIDI onset (s) | MIDI bytes |
|---|---:|---:|---:|---:|---:|
| Original | 0 | 0 | 0.000022675736961451248 | 0 | 141 |
| Moved half a quarter | 1 | 0.25 | 0.25002267573696146 | 0.25 | 143 |
| Undo | 2 | 0 | 0.000022675736961451248 | 0 | 141 |

The observed PCM shift was 0.25 seconds and undo restored the original onset.
This is actual rendered browser audio data plus MIDI round-trip evidence. The
offline renderer is not the live scheduler: these measurements do not establish
live scheduling jitter, physical-output latency or human listening acceptance.
The temporary harness was removed from public assets; it is not a shipped demo
or public API.

## Acceptance boundaries

Human listening, physical audio-device behavior, touch, screen readers, wider
cross-browser coverage, live scheduler timing, browser file-chooser import and
download completion were not verified by this record. Escape during a live drag,
Alt-drag drawing and double-click insertion retain automated coverage without a
completed native-browser pass here. The applied-revision and PCM evidence must
not be described as sample-accurate live replacement.

P3 Audio assets/sequences, structural history and waveform editing, and P4
staff-input prototype/editing, remain future implementation. Seamless replacement,
spectral repair and multi-track/project editing remain beyond the five phases.
