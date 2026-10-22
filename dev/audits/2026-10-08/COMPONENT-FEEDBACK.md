# Component loading and waiting feedback

## Baseline and scope

Reviewed on 2026-10-08 on `component-loading-animations`, starting from
`ef8664dbb68ece9dc8c1d328141989a0ae86f888` plus this task's working-tree changes.
Environment: macOS, Node 26.8.1, npm 11.19.0 and the Codex in-app browser.
The browser's exact engine version was not exposed by the UI tooling.

This pass covers every tag in the explicit Element composition catalog, following
[DEC-052](../../DECISIONS.md#dec-052--loading-and-source-waiting-use-shared-square-animations).
It extends the shared loading/waiting work to queue rows, mixers, recorders,
configuration panels, meters and native player followers. UI Status owns the
four-square loading animation and outlined-square waiting animation. Loading and
waiting descriptions remain accessible; errors and meaningful settled state remain
visible. No animation introduces a second musical clock or source loader.

## Integration note

The original branch numbered the feedback decision DEC-047; integration with `dev`
renumbered it DEC-052 to retain the existing Score Analyze decisions. The matrix and
verification below describe the original 22-tag baseline. The integrated catalog
contains 24 tags: chord score/live modes share one Element, with interval, scale and
rhythm analysis using the same loading/waiting presenter. The integrated meter
retains the seven canvas displays from DEC-051.

## Per-tag outcome

| Element | Loading | Waiting and settled behavior |
|---|---|---|
| `score-player` | Current source request | Missing score; ready transport retained |
| `score-rack-control` | Child source requests | Missing members; existing strips and failures retained |
| `score-rack-part` | Readiness reported to its desk | Nonvisual declaration, so no independent visual animation |
| `score-recorder` | Starting take playback | Idle capture is immediately usable; no artificial waiting |
| `score-note-input` | No asynchronous prerequisite | Immediately usable local input remains interactive |
| `score-synth-panel` | No asynchronous configuration prerequisite | Missing sound, effects, macros or EQ configuration; ready envelope/LFO editors remain usable |
| `score-view` | Owned request or borrowed native readiness | Missing score; explicit standalone data remains supported |
| `score-pitch-view` | Borrowed native readiness | Missing/unresolved/disposed source; valid silence retains the pitch view |
| `score-sheet-view` | Source request and asynchronous engraving | Missing score; engraving failures stay visible |
| `score-chord-analysis` | Source/native readiness | Missing score; meaningful empty analysis remains a settled result |
| `score-live-chord-analysis` | Source/native readiness | Missing score or input; settled analysis remains available |
| `audio-player` | Current source fetch/decode | Missing source; publishes readiness for companions |
| `audio-playlist` | Each pending entry, including prefetch | Missing entries/owner; preserves rows, focus and errors |
| `audio-mixer` | Member assignment is synchronous | Missing members/owner; usable strips remain visible |
| `audio-recorder` | Pending microphone startup | Missing requested owner when idle without a take; standalone capture remains ready |
| `audio-view` | Owned data request or borrowed source readiness | Missing drawable data; explicit data retains priority |
| `audio-live-view` | Borrowed source readiness | Missing analyser or first frame; observes late insertion and replacement |
| `audio-meter` | Borrowed source readiness | Missing graph; a valid silent graph displays zero level |
| `audio-level-analyzer` | Borrowed source readiness | Missing/known-empty source; pause, freeze and silence remain settled |
| `audio-spectrum-analyzer` | Borrowed source readiness | Missing/known-empty source; pause, freeze and silence remain settled |
| `audio-oscilloscope` | Borrowed source readiness | Missing/known-empty source; pause, freeze and silence remain settled |
| `audio-transient-analyzer` | Borrowed source readiness | Missing/known-empty source; pause, freeze and silence remain settled |

## Verification procedure and evidence

Source review followed each Element through its presenter, source binding and
cleanup. Regressions cover source replacement, cancellation, stale results, native
readiness propagation, recorder pending operations, retained queue rows, valid silent
meters, reentrant replacement and cleanup. Presenter demos expose the added readiness
states and reset them without leaving pending demo work active.

A local browser fixture mounted the real Element implementations in four groups,
including the hidden rack declaration. Its source controls remove `src`, request an
intentionally pending local URL, or return a local HTTP 404. This exercises actual
Element requests and notifications. Inspection traversed both light DOM and open
shadow roots. All visual tags were rendered; the nonvisual declaration was checked
through its desk. The rendered checks cover waiting, representative pending/error
propagation, light/dark parents, and 320px containing cards. Screenshots show layout
and geometry; computed CSS confirmed the loading animation on all seven Audio View/
Analyze followers. These are source-bundle checks, not published-package or device
acceptance.

- [Score View/Analyze loading](evidence/score-view-loading.jpg)
- [Audio View/Analyze waiting in a dark parent](evidence/audio-analysis-waiting-dark.jpg)
- [Audio Play waiting in 320px cards](evidence/audio-play-waiting-320.jpg)
- [Built documentation: Audio Live View waiting](evidence/audio-live-view-waiting.jpg)

The final built documentation route `/audio/element/view/audio-live-view/` was
also checked on port 4324: initial loading appeared in the player and its view,
the ready silent analyser rendered normally, an unresolved source selector showed
only the waiting square visually, and Reset restored the ready view with status
hidden. The preview was left on its original demo source.

The initial full gate found duplicate analyser sampling in the Meter render adapter:
the new immediate status paint also sampled data before the adapter's explicit draw.
The correction paints readiness immediately while preserving first-frame sampling
for animated meters. Cross-review also removed a duplicate polite live region in the
Synth EQ composition.

Final integrated results:

- `VITEST_MAX_WORKERS=2 npm run check`: passed, including 4,242 workspace tests,
  typechecking, architecture, documentation, license, package and release-manifest gates.
- `npm run docs:build`: passed; 110 pages built, public references, local search
  and site license verification completed.
- Documentation typechecking reports three existing `keyCode` deprecation hints;
  no errors or warnings.

The user's original `localhost:4321` page belonged to a different checkout. The
current branch's built documentation is previewed separately on `localhost:4324`.
Real microphone permission, acoustic timing, assistive-technology reading and
physical-device input are outside this visual-feedback pass; no hardware acceptance
is implied.
