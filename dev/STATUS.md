# Implementation status and open work

> This checkout prepares the shared `0.3.0` modular release. A public registry
> query on 2026-10-15 (America/New_York) confirmed all five `0.2.0` packages
> already exist; the new module/Session entries require updated foundations.
> [Release instructions](release/0.3.0.md) own adoption and version-specific gates.
> The earlier integration at `eaa88af4` through
> [PR #25](https://github.com/koperative-lab/WebMusic/pull/25) and its
> [successful CI run](https://github.com/koperative-lab/WebMusic/actions/runs/36516020568)
> are historical evidence, not validation of this modular working tree.
> The original verified `0.1.0` Agent Toolkit release receipt is preserved;
> preparing `0.3.0` does not publish it or create a new verified receipt.
> This branch also carries the document editing, clip editing, beat grid and
> visual-design work merged from `dev` (EDIT-01, SHEET-01, AUDIOEDIT-01, VISUAL-01);
> the [editing migration guide](release/EDITING-MIGRATION.md) covers its upgrades.
> Product direction is accepted in [PRODUCT](PRODUCT.md) and [DECISIONS](DECISIONS.md).
> Historical plans and audit snapshots retain their recorded baselines.

## Checkout profile

This checkout contains the reviewed Kernel/UI/Score foundation plus Audio
and Bridge work. Inspect local and remote Git refs separately when describing
availability.

Score follows main except for explicitly requested Analyze component-frame
defaults (DEC-034), the four elementary Analyze tools and their readable metrical
inspection lanes (DEC-047–048), and
domain-prefixed Web Component tags (DEC-045). Public
references and parameter catalogs also retain the standalone Score Recorder
page/demo (DEC-032) and Analyze demo layout alignment (DEC-033).
Agent Toolkit behavior preserves the verified first-release baseline; its
five-package adapter identifies this checkout as a source snapshot. Audio/Bridge
retain their domain capabilities, including Audio timeline and synchronized
viewport bindings. Shared Kernel/UI differences are limited to required domain
compatibility with explicit source, contract and regression ownership.

DEC-050 makes the PitchView keyboard fit MIDI 48–71 without scrolling by
default. Its explicit `scroll` setting takes precedence over retained legacy
fitting configuration; fixed-width waterfall companions opt into scrolling.
Verification on 2026-10-07 passed `VITEST_MAX_WORKERS=2 npm run check`
(4,325 workspace tests) and `npm run docs:build` (112 pages). The Arabesque
demo fit all 24 keys into 527px and 303px containers at 937px and 390px browser
widths, without page overflow. Playback highlights, native keyboard panning
when enabled, offset reset when disabled, type switching and Reset passed;
the generated markup preserved explicit `scroll="false"`, and console errors
were absent. Automated tests verify clipboard serialization and legacy fallback.

DEC-067 adds four-direction keyboard, piano-roll and waterfall presentation,
with independently composed keyboards sharing one player. ScoreView Elements
hide advanced annotations by default while imperative renderer defaults remain
unchanged. Verification on 2026-10-08 under Node 26.8.1 passed all 4,489 workspace
tests, `npm run docs:build` (112 pages), and the individual lint, type, architecture,
documentation, license, package-artifact and release-manifest checks. The full
`npm run check` stopped in the existing development-server process test:
`process.kill(-pid, 0)` returned `EPERM` during process-group cleanup, replacing
the expected termination exit code 143. Its assertions and startup code were
not changed; the remaining gates ran separately. Regressions cover
four-direction geometry, exact keyboard/waterfall alignment, resize, scroll
following and virtualization, retained player state, annotation opt-in, and
scroll-region focus ownership and cleanup. The Arabesque demo composes two
opposed keyboards with one player. Browser tools were unavailable for this
change; rendered layout, native keyboard scrolling and visual playback alignment
remain unverified. Earlier DEC-050 browser evidence does not establish those
four-direction behaviors.

The earlier extra Score controllers, parked Elements and unrelated public UI
applications are removed from the current surface. UI documentation uses the
six canonical groups; Audio additions live in their owning presenter references.

The earlier `cfa90b2` integration and [2026-09-11 CI reconciliation](log/2026-09-11-dev-ci-reconciliation.md)
describe a historical source baseline. Their outcomes do not establish this
merged worktree's checks, remote CI or deployment. The root package scripts
and the current workflow determine today's executable gates.

The [Audio Player composition follow-up](audits/2026-09-26/AUDIO-PLAYER-COMPOSITION.md)
records the central `audio-player`, linked playlist/mixer/recorder and the then-
View meter migration. Source selection and disposal/late-load regressions are covered;
recording hardware and acoustic group timing remain separate acceptance work.
DEC-030 removes the temporary old Element aliases and routes; current demos
and exports use canonical names. The [development workflow](DEVELOPMENT.md#documentation-server-lifecycle)
defines reuse on ordinary startup and explicit stop/restart for rebuilds;
ordinary startup must not terminate another active terminal's server.
The later [Audio Play layout follow-up](audits/2026-09-26/AUDIO-PLAY-LAYOUT.md)
records DEC-031's canonical `audio-recorder` naming, full-width hosts and
Score-aligned spacing, including normal and 320px browser checks.

The [Score Recorder documentation follow-up](audits/2026-09-26/SCORE-RECORDER-PAGE.md)
records DEC-032's standalone recorder page, linked input demo and updated
navigation. Demo lifecycle tests and browser recording checks passed; the full
check at that recorded baseline retained the DEV-06 lint blocker.

The [Analyze demo alignment](audits/2026-09-26/ANALYZE-DEMO-ALIGNMENT.md)
records the common full-width composition, single type-controlled Audio result
demo, visible-host sizing and Histogram source recovery. All ten Element demos
were checked at ordinary and narrow widths; acoustic/device acceptance remains
separate. DEV-06 blocked the complete gate at that recorded baseline.
DEC-035 first replaced that Audio Analyze inventory with onset, beat and
live-pitch surfaces; DEC-036 superseded those interim tags with level, spectrum
and tuner tools. DEC-037 now selects five live Analyze tools, including the
returning meter, oscilloscope and transient analyzer, without a tuner. The dated
demo record remains evidence for its former baseline, not acceptance of the
new surfaces.
The five current Analyze demos passed desktop and 390px browser smoke checks;
the bundled WAV drove meter, oscilloscope and transient live readings. Real
device input, acoustic accuracy and screen-reader interaction remain unverified.
The 2026-10-08 presentation follow-up gives all five Audio Analyze Elements
achromatic defaults. Detailed tools retain fixed readout slots, compact square-corner
controls and actionable diagnostics while hiding routine transport prose.
Threshold, sensitivity, timebase and trigger reuse the UIKit horizontal fader
with actual-unit keyboard and ARIA values. Arabesque No. 1 MP3 browser checks
covered playback, pause, freeze, probe/control interaction and 390px layouts;
meter level and spectrum modes were both exercised. These UI checks do not
close the acoustic, device or screen-reader acceptance in AUDIO-ANALYZE-01.
The [frame and startup correction](audits/2026-09-26/ANALYZE-FRAME-AND-DEV-STARTUP.md)
supersedes that pass's acceptance of bare Score surfaces: DEC-034 restores the
shared component border and padding. Ordinary development starts now reuse the
tracked server; replacement is explicit.

DEC-043 parks the motif and rhythm-pattern Elements from DEC-040 for later
study; the local `archive/score-pattern-analysis-research` tag preserves that
snapshot after deletion of the redundant branch. Recurrence algorithms and projections
remain API/Headless capabilities. DEC-047 now
selects four elementary Score Analyze Elements: chord (score/live modes),
interval, explicit scale and grouped rhythm. This supersedes DEC-043's two-tag
inventory and DEC-042's dense, fixed half-bar chord aggregation. Score chord
inspection follows DEC-048: the Element defaults to explicitly labelled
metrical pitch collections, with exact simultaneous inspection still selectable.
API and Headless defaults remain simultaneous; live mode reads held notes.
Only complete spelled triads/sevenths receive names, and the lowest collected
pitch does not assert a structural harmonic bass. The earlier inventory was part
of the integrated `main` baseline; the reviewed `score-analysis-basics` work
is consolidated on `dev` and has not been merged into `main`.

Local verification on 2026-10-03 passed `npm run check`, including 4,246
workspace tests, and `npm run docs:build` (112 pages). The existing
development-server subprocess cleanup test
required execution outside the sandbox; it passed without changing its
assertions. Initial browser checks covered all four demos, score/live mode switching,
player-driven live C-major readings, keyboard seeking, explicit scale-context
errors and recovery, grouped-rhythm subdivision controls, Copy/Reset, and
390px layout without page overflow. Ruler labels no longer overlap at narrow
widths, and the live spelling caption leaves the chord symbol fully visible.
Automated cases cover source replacement, borrowed lifetimes, independent
companions and passage/note selection. Real MIDI devices, screen-reader use
and audible non-unit-rate timing remain unverified.

The demo-source follow-up replaces the temporary teaching score with the
existing Arabesque No. 1 MXL across all four Analyze demos and their examples.
Scale inspection explicitly starts with E major. AGENTS now requires existing
Arabesque assets or passages for musical demos; synthetic boundary cases remain
test fixtures. The initial C-major browser readings above describe the earlier
fixture, not a claim about a passage in Arabesque.
Follow-up browser checks verified all four MXL-backed Analyze surfaces,
score/live mode switching, copied/reset source attributes and the explicit E
major reference. The initial one-second demo windows keep written notes and
complete chord labels readable. Bridge checks verified real MIDI excerpt replacement (16 to
24 quarter-note beats), WAV-backed native loops, seek phases at master 4.25 s
(0.25 s and 1.25 s) and disposal.
UIKit's analysis, pitch, harmony and workbench demos now project the same MXL
opening instead of canned progressions. Browser checks verified source-derived
readings, relative passage selection and the Roots and basses view, without
console errors. These presenter demos use a visual inspection clock, not audio
playback. The editable API examples also load the existing MXL; their remote
sandbox preview remains disabled by default and was not executed.

Final follow-up verification passed `VITEST_MAX_WORKERS=2 npm run check`
(4,252 workspace tests) and `npm run docs:build` (112 pages). An earlier
unbounded run encountered module-import, worker-start and real-clock assertion
timeouts under load; the two affected Score files passed all 23 tests in an
isolated rerun, and the bounded full run passed without changing assertions or
production behavior.

The 2026-10-07 readability follow-up implements DEC-048's metrical chord
collections and expanded current readings. Real Arabesque regression cases
recognize the opening A/C# and G#m/B collections while retaining the fifth-bar
A/C#/D# collection without a chord name. All four lanes compact offscreen-only
rows, retain source evidence and prefer the selected overlapping row in the
current readout. Reserved primary/secondary line boxes persist across gaps.
`VITEST_MAX_WORKERS=2 npm run check` passed all 4,274 workspace tests, and
`npm run docs:build` built 112 pages. Browser checks at 1280px and 390px verified
all four readings without page overflow, score/simultaneous/live chord modes,
player-driven live names, keyboard navigation, harmonic interval `+` separation,
explicit scale-context removal/recovery, lower-row rest selection, rhythm
subdivision, and copied/reset chord markup. The existing Arabesque source is
unchanged. Browser console errors were absent; real MIDI hardware, screen-reader
acceptance and acoustic timing remain outside this verification.

The requested chord display refinement removes collection captions from visual
labels: named chords show their source note names below, including octaves;
unmatched sets leave the chord-name row empty and show their note names only in
the secondary row, in both the current readout and timeline. The live nameplate
keeps the same separation. Grouping evidence remains in `.analysis`.
Chord bands opt into wrapped labels with measured row height, preserving their
time coordinates. The initial chord demo window is now one second, matching
the other three demos and giving full labels more room.
Refinement verification passed `VITEST_MAX_WORKERS=2 npm run check` (4,278
workspace tests) and `npm run docs:build` (112 pages). Browser checks confirmed
named chords with notes below, note-only unmatched sets, and wrapped labels
without ellipsis or vertical clipping at the normal viewport and 390px, including
a denser four-second window. Dense narrow windows grow vertically to retain
their text; the default one-second window stays compact. Reset restores that
default, and browser error logs remained empty. The note-row clarification also
preserves unnamed-set selection and semantic index entries, and aligns empty
chord-name slots with neighbouring named chords.

The subsequent note-row correction passed `VITEST_MAX_WORKERS=2 npm run check`
(4,283 workspace tests) and `npm run docs:build` (112 pages). Browser verification
at the normal viewport and 390px used the actual Arabesque set
`B2 E3 F#4 G#4 B4`: the chord-name row remains empty while the complete note row
aligns with the next `C#m/E` chord's notes. The temporary viewport override was
reset and browser errors remained absent. Unit regressions also cover both
score grouping modes, live unnamed/named transitions and reduced-motion updates.

The live-display follow-up removes the MIDI-spelling caption from the component
and uses muted note text beneath the prominent chord name; the spelling limits
remain in the public reference. The reserved live rows and unabridged,
horizontally scrollable long readings are unchanged. `VITEST_MAX_WORKERS=2 npm
run check` passed all 4,283 workspace tests, and `npm run docs:build` built 112
pages. Actual Arabesque playback confirmed named (`F#m7`), unnamed and silent
states without the caption; their nameplate height remained 104px in the tested
default theme. Playback was paused and the preview left in live mode.

The interval, scale and rhythm readouts now use three fixed labeled fields
instead of a concatenated visual subtitle. Interval shows Notes, Motion and
Semitones; scale shows Note, Reference and Relation; rhythm shows Bar, Beat and
Duration (qn). Equal-width columns reserve the maximum heading and field heights
across supplied readings, so wrapped values and gaps retain their layout during
playback. Rest and tie readings retain their original written onset; an
out-of-range onset with incompatible beat grouping leaves Beat unavailable
without changing the original Bar or Duration. Invalid in-range grouping still
fails validation.
`VITEST_MAX_WORKERS=2 npm run check` passed all 4,295 workspace tests, and
`npm run docs:build` built 112 pages. Actual Arabesque playback and keyboard
navigation verified all three surfaces at the normal viewport and 390px,
including a wrapped melodic-minor reference, interval gaps, and rest/triplet
selection. Field widths and their offsets within the readout remained fixed;
browser error logs were empty. Playback was paused and the temporary viewport
override reset. This does not extend device, screen-reader or acoustic acceptance.

The [2026-10-07 dev consolidation review](log/2026-10-07-score-analysis-dev-closeout.md)
found and corrected two additional boundary cases: structured readouts now
collapse through gaps when `reservePinned` is omitted or false, and rhythm
Headless note selection no longer inherits accent evidence from excluded notes.
All six added regressions failed before their fixes and passed afterward.
Final local verification passed `VITEST_MAX_WORKERS=2 npm run check` (4,301
workspace tests) and `npm run docs:build` (112 pages). This records local
verification, not remote CI, publication or new browser/device acceptance.

The first [dev CI run](https://github.com/koperative-lab/WebMusic/actions/runs/37707309933)
passed the website build and both Node 22/24 full checks and external-install
checks. Its dependency audit failed with four high and ten moderate findings
in the unchanged baseline lockfile. The follow-up updates `devalue` to 5.9.4,
`http-cache-semantics` to 4.3.0, `sharp` to 0.35.5 and `source-map-js` to 1.2.2
within the existing manifest ranges, including Sharp's matching native packages.
The corrected lockfile passes the high-severity audit gate; the remaining ten
moderate findings belong to the PostCSS selector-parser chain tracked in DEP-02.
After a fresh `npm ci`, the corrected tree again passed all 4,301 workspace
tests in `npm run check`, the 112-page documentation build, external-install
verification and `npm run audit:dependencies` at its configured high threshold.

The moderate follow-up adds a root npm override so that
`@expressive-code/core` resolves `postcss-nested` 7.0.2 instead of 6.2.0. That
major only raised its selector parser to 7 and refined comment handling, so the
nested `postcss-selector-parser` 6.1.4 disappears and the site's build-time CSS
nesting uses the patched 7.1.6 already present for `eslint-plugin-astro`.
Starlight 0.42.5 and Expressive Code 0.44.2 are unchanged; `npm audit` reports
no findings at the moderate threshold. With the override, `VITEST_MAX_WORKERS=2
npm run check` passed (4,307 workspace tests), `npm run docs:build` and
`npm run pages:build` each built 112 pages with the site-notice check validating
350 emitted files, `npm run check:external-install` passed, and both audit
thresholds reported no vulnerabilities. A local `astro preview` of the rebuilt
site rendered the Analyze API page's 27 code frames with the same computed
frame styles, rule count and heights as the still-running development server,
without console errors. The override is a bridge until Expressive Code requires
the newer `postcss-nested` itself; see DEP-02.

The [2026-10-07 review corrections](log/2026-10-07-score-analysis-review-corrections.md)
implement DEC-049: wrapped chord bands narrower than 48px
hide their label stack instead of wrapping single glyphs, `beat-groups` accepts
one grouping per irregular numerator while conventional meters keep their
pulses, chord selections keep exact authored ends, the live nameplate no longer
exposes unnamed notes twice, Elements validate only observed attributes, and
the independent-loops demo caches its decoded opening excerpt. The harmonic
interval overlap introduced with DEC-047 is now a documented contract. The
independent review reproduced the 30-second chord window (10px bands, 486px
rows, a 580px component) on the local site before the correction; afterwards
the same window hides every label stack and keeps the component at 142px,
while the accepted four-second window is unchanged. After the corrections the
static checks, package build, documentation checks, typechecks, lockfile,
license, package and release-manifest checks and all workspace tests passed
locally on the tree that includes the merged dependency integration. None of
this is registry-publication, screen-reader or device evidence.

[The earlier inspection record](audits/2026-09-26/SCORE-ANALYZE-INSPECTION.md)
describes DEC-038's former five-tool tree and does not verify the current tools.
DEC-041's presentation boundary remains: candidates are available in `.analysis`
instead of Element buttons, and live alternate names are static text below the
symbol. Selection stays local to each component and creates no playback
authority. All four reuse the selected player's Score/time; missing musical
context remains explicit instead of triggering a key or function guess.

DEC-044 retires the three narrower Audio View Elements
`audio-clip-thumbnail`, `audio-minimap` and `audio-region-list`. Audio View now
exposes `audio-view` and `audio-live-view` as its current tags; lower-layer
clip/region and UI Kit capabilities remain available. The late-binding issue
formerly tracked as AUDIO-VIEW-01 applied to the removed companions.

DEC-045 gives all current Score Element and public demo tags a `score-` prefix,
matching Audio's existing `audio-` convention. It retires the old unprefixed
registrations and the deprecated `simple-score-player` alias; old documentation
routes redirect to the renamed Element pages. DEC-046 accepts this source
surface for the main integration.

DEC-052 adds shared square loading and source-waiting feedback across the current
Element inventory. The [component feedback review](audits/2026-10-08/COMPONENT-FEEDBACK.md)
records per-tag state coverage and bounded visual evidence. Ready input and valid
silence remain usable, and the nonvisual rack declaration reports through its desk.

AudioView also exposes a caller-owned `loading` flag for external decode and
worker analysis. Its main, waveform-configuration and multiband demos mark
their pending work explicitly, without visible loading placeholder prose;
readiness follows the selected drawing's usable input. Verification on
2026-10-09 under Node 26.8.1 passed `VITEST_MAX_WORKERS=2 npm run check`
(4,506 workspace tests, including the development-server process tests) and
`npm run docs:build` (112 pages). In the in-app browser at localhost:4324,
initial decode, requested spectrograms and channel analysis showed the animated
four-cell loader, then returned to their drawings. Offscreen examples waited
until activation; ordinary waveform variants became ready before the colour-map
spectrum. Parameter Reset restored the main waveform without a stuck loader,
and the browser reported no errors or warnings. Automated regressions additionally
cover pre-upgrade properties, internal pending requests, failure recovery,
superseded analysis, navigation cleanup and retained player position. This
bounded browser check does not establish cross-browser or device acceptance.

The [follow-up readiness audit](audits/2026-10-09/COMPONENT-READINESS.md) checks all
24 Elements and corrects the nested player omission in that initial AudioView
check. AudioPlayer, ScorePlayer and AudioMixer now accept external preparation
flags; selected playlist readiness propagates through the central owner, and
source replacement, analyser failures and recorder failure feedback are covered.
The current workspace passes 4,546 tests and all individual `npm run check`
gates; the final aggregate invocation hit an intermittent existing dev-server
process-exit test, which passed its isolated rerun. `npm run docs:build` passed
with 112 pages. Rebuilt browser checks at localhost:4324 verified simultaneous
player/view loading, ready recovery, spectrogram/channel analysis, parameter Reset,
mixer preparation and ordinary playlist pause. The audit records the exact scope,
remaining device/browser limits and screenshots.

Web Component reference pages now start with their main live demo immediately
after the page title, followed by the introduction and reference sections.
All 23 owning pages (covering 24 tags) follow the updated
[Element page template](docs/COMPONENT-PAGE-TEMPLATE.md); topic examples retain
their later explanatory sections. `check:docs` rejects visible body content
before the main demo. Verification on 2026-10-09 passed the complete
`VITEST_MAX_WORKERS=2 npm run check` (4,546 workspace tests) and
`npm run docs:build` (112 pages). Generated HTML for every owning page starts
with its live playground. Browser checks of ScoreView and AudioView at
localhost:4324 confirmed that the demos are visible on entry, with no new
console errors or warnings.

## How to read status

“Implemented” means a source path exists and its stated behavior was inspected. “Verified” names the checks or environment used. “Accepted target” states intended behavior that still requires design or implementation. An automated check is not proof of real audio, device, browser, remote publication, or complete API documentation.

The current public surface is generated in [COMPONENTS](COMPONENTS.md); documentation coverage is mapped in [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md). Versions and dependency ranges belong to manifests, not a copied status table.

## Capability readiness

| Area | Current evidence | Boundary |
|---|---|---|
| Models, APIs, Headless, Elements, UI presenters | Five source package workspaces, explicit public exports and element/presenter catalogs | Entry-specific environments and optional dependencies still apply; source presence is not registry publication |
| Score/Audio coordination | Session-owned shared scheduling anchors, mapped native Score/Audio readers, future loop segments and revisioned legacy group commands; measured native renders in the third modular delivery | Media/external participants remain approximate; bounded lookahead can starve, and device/plugin latency is not automatically compensated. A legacy clockless master without an observed forward position step cannot be safely inferred to have stopped from repeated samples alone. |
| Cross-domain conversion | Timeline mapping, score rendering, transcription-result assembly in Bridge | No lossless audio-to-score round-trip guarantee |
| Interaction and visual customization | UI bindings, presenter-owned resources/styles, public tokens and handles, composed Elements | Device, accessibility, and browser acceptance are not implied by unit tests |
| Analyze/View attachment to Play | Score core source contract, native Headless/Element `.playback`, borrowed Score data and snapshots in Analyze/ScoreView, optional Headless ScoreView binding | Controller/Rack single-score data remains unavailable; legacy event targets retain partial capabilities. PitchView follows held-note sources; readout/log tags and chord preview remain targets in [Player binding](design/PLAYER-BINDING.md) |
| Documentation organization | Product/design/decision/architecture owners, generated component/file indexes, four page templates, archived history, and a source-based pass across all Headless reference leaves | Semantic review, automated coverage, and demo/browser acceptance remain distinct; see the open checks below |
| Prior runtime repairs | [Repair record](audits/2026-09-05/FIXES.md): 197 test files / 2,205 tests, full check and docs build on local Node 22 | This is dated evidence; it is not a new Node 24/device/external-install result |

## Current work queue

The modular redesign's three deliveries (steps 1–12) are complete and locally
verified in the `modular-redesign` working tree. The
[first acceptance record](audits/2026-10-15/MODULAR-FIRST-DELIVERY.md) covers
composition, routing and shared controls. The
[second acceptance record](audits/2026-10-15/MODULAR-SECOND-DELIVERY.md) adds
complete per-voice ADSR, occurrence-owned note input, native CV/LFO, shared
macros and absolute audio-clock automation. The
[third acceptance record](audits/2026-10-15/MODULAR-THIRD-DELIVERY.md) covers
shared-anchor scheduling, seek/loop-relative automation and LFO phase, effect
generation transitions, versioned project restoration and accessible patch
editing. Each record owns the checks, measurements and limitations of its
stated baseline. Their contracts are
[DEC-063](DECISIONS.md#dec-063--modular-composition-separates-resources-routing-and-session-authority)
and DEC-064, with [Modular composition](design/MODULAR-COMPOSITION.md); current public usage
is in the [runnable guide](../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx).
The [2026-10-16 review follow-up](audits/2026-10-16/MODULAR-REVIEW-FIXES.md)
repairs 20 independently reproduced mixing, lifecycle, scheduling, control,
project transaction and focus defects. Its verification record supersedes any
inference that the earlier acceptance covered those boundary cases. The complete
check passed 4,620 tests, the documentation build passed, and final native/public
page checks verified the repaired behavior against the rebuilt outputs.

The subsequent [release-readiness repairs](audits/2026-10-15/MODULAR-RELEASE-FIXES.md)
close eight further defects and one adjacent mixer reentry defect, with 50 new
regressions. At that baseline the complete check passed 4,670 tests; documentation build,
independent `0.3.0` tarball installation and final native/public-page acceptance
also pass. Package versions and internal peer floors are prepared as `0.3.0` /
`^0.3.0`; an incompatible published `0.2.0` Kernel is rejected during installation.
These are local working-tree results, not a verified release-commit CI or registry
delivery receipt. The dated record owns reproduction details and finite test limits.

The next [release follow-up](audits/2026-10-16/MODULAR-RELEASE-FOLLOWUP-FIXES.md)
addresses twelve further project automation, readiness ownership, envelope,
lazy LFO, CommonJS identity and editor reentry findings, with 65 new regressions.
The complete check passes 4,735 tests across 371 files; documentation build,
independent tarball installation and final native/browser acceptance pass.
Installed CommonJS entry identity, automatic retry focus and manual-override
save/restore are now covered directly. The new record retains original failures
separately from the repaired behavior; final-commit CI and registry delivery
remain RELEASE-01.

The [release hardening follow-up](audits/2026-10-16/MODULAR-RELEASE-HARDENING.md)
closes two further initial-attachment/mixer reentry failures. The full check
passes 4,743 workspace tests plus eight original-media checks. DEP-02's remaining
ten reports are cleared; DEV-05's unresolved resources are replaced or removed.
Normal and Pages site builds and native/browser playback, resource, license and
narrow-layout checks pass. The dated record retains original failures, exact
artifact fingerprints and the final external-install checks separately from
the release-commit CI and registry work in RELEASE-01.

The subsequent [read-only candidate review](audits/2026-10-16/MODULAR-RELEASE-CANDIDATE-REVIEW.md)
revalidates the unchanged implementation and packed inputs but finds eight
additional defects: factory-disposal graph publication, stale natural-end
commands, mixed built-in mixer starts, lazy channel-ID collisions, sampler
capability forwarding, analyzer binding cleanup and error payloads, and combined
browser-global meter identity. The subsequent
[recovery and candidate repairs](audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md)
restore the uncommitted implementation from retained task history and close all
eight findings, including analyzer teardown/reconnection. Both fresh Node 22.22.3
and independent Node 24.19.0 full gates pass 4,833 tests across 373 files, with
90 added regressions. Final installed-package checks pass 174 runtime entries,
all declaration variants, 65 native browser cases and 36 Session/Group cases;
both dependency audits report zero vulnerabilities. New receipts and frozen
input hashes are retained with that record. Some older generated evidence was
not recoverable and is explicitly marked unavailable; earlier reports remain
historical rather than fresh verification.

| ID | Work and state | Acceptance | Owning reference |
|---|---|---|---|
| MOD-RC-01 | Closed locally: RC-01–08 repaired with 90 added regressions; dual-Node full gates and final installed public/native cases pass | Preserve the frozen-input and package receipts; remote final-commit CI and actual publication remain RELEASE-01 | [Candidate repairs and recovery](audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md), [original review](audits/2026-10-16/MODULAR-RELEASE-CANDIDATE-REVIEW.md) |
| MOD-11 | Implemented: shared-anchor native scheduling, future loop passes, relative automation/LFO and explicit effect crossfades/tails | MC-18; native render measurements and cancellation regressions in the third acceptance record. Media/external timing, device latency and scheduling starvation retain explicit limits | [Shared-clock design](../platform/shared-clock-injection.md), Modular composition, DEC-064 |
| MOD-12 | Implemented: versioned project save/restore and accessible audio/CV connection editing | MC-19; stable identity, transactional rollback, missing-plugin recovery and keyboard-equivalent editing; application retains persistence/undo | Modular composition, third acceptance record, DEC-064 |
| MOD-13 | Closed 2026-11-07 (MOD-15 round 5b): Audio and Score leaves and desks follow a provider's destination-only change in place | Give `ScorePlayerModule` and `ScoreRackModule` an in-place re-route, use `moduleScopeChange()` in the Score player and Rack Elements, and verify that a mixed root destination change keeps sounding notes and Rack levels | [Modular composition](design/MODULAR-COMPOSITION.md), DEC-065 |
| MOD-14 | Closed 2026-11-07 (MOD-15 rounds 5a and 6): Score editor documents play on the single module path, Audio document playback joins the Session through the player's inserts and module output, and the attached synth panel uses the shared status presenter | Covered by the round 5a and 6 regressions; browser playback of an edited document through a Rack remains VERIFY-01 | [Modular composition](design/MODULAR-COMPOSITION.md), [Editing contracts](design/EDIT-COMPONENTS.md), DEC-068 |
| MOD-15 | Delivered locally under DEC-068 (rounds 1–22 on `modular-redesign`; the owner accepted `3d81ef3` manually on 2026-11-09 and it is merged into `dev`): modular composition becomes the only model for every Element, Headless runtime and API; the [2026-11-06 coverage audit](audits/2026-11-06-modular-coverage-audit.md) lists the starting gaps (three missing port families, views/analysis/inputs/outputs outside modules, two composition paths). Round 1 (U0) is done: the [single composition model](design/MODULAR-COMPOSITION.md#single-composition-model) fixes roles, port fields, Element grammar, Session election and retired surfaces, with MC-20–27; seven earlier decisions and the Play/View/Analyze/Architecture/clock designs carry dated notes; the four page templates gain their composition sections. Round 2 (U1) is done: Kernel `/module` has all five port families (`AudioInputPort`, note output/input with occurrence-owned release, `SourcePublisher` with `SOURCE_SCHEMAS`, `createTransportPort` with lent commands and outcomes, `createControlPort`), `ModuleHandle.ports()` with `getModulePort`, the `ModuleSession` interface and `ModuleContext.transport`, `checkModuleConformance`, and `observeModuleInput` in `/element`, which Audio's port tap now uses. Round 3 (U2) is done: Kernel `RackModule` (module-ID channels with fader, pan, post-fader inserts and `channel:<id>` taps; master bus and inserts) now underlies `ScoreRackModule`; Sessions report each participant's `ParticipantTiming` and Score callback-only synths report `callback`; `createProviderScope` implements outermost-provider Session election; `DeviceSink`, `CaptureSink` and `createOfflineModuleEnvironment` add sinks. Provider Elements, `AudioMixer` and the render functions adopt these in rounds 4–6; the public `/sync` entry is removed with Bridge's sync family in round 8. Round 4 (U3.1–3.2 Headless) is done: `ScorePlayerModule` lists audio, note (`notes`), source (`webmusic.score` playback source), borrowed transport and control ports, re-routes in place with `retarget()` on a destination-only change (MOD-13's Headless half), plays borrowed documents with `setDocumentSource()` (MOD-14's Score Headless half), and passes the conformance kit with `ScoreRackModule`; `MidiNoteSource`, `MidiNoteSink` and `recordNoteOutput()` make Web MIDI input, MIDI output and recording note modules; `renderScoreToBuffer` renders in the offline module environment but still schedules its own graph without Racks or the Session. Round 4 left Score Elements for round 5. Round 5a is done: Score Play Elements have one path — every `score-player` is a module provider (outermost owns the Session, nested ones borrow it), its native engine is a `ScorePlayerModule` participant, its preset UI routes play/pause/stop/seek through the Session, editor documents, `.controller`, `.rack`, composed desks with a borrowed Headless Rack, custom `mountScore` handles and standalone synth panels all run on that path, `score-rack-control` is a module Rack unless a Headless Rack is assigned, and `composition` no longer affects Score. Element teardown follows the layout-move microtask. Round 5b is done: Score players and desks follow a destination-only scope change in place (MOD-13 closed for Score: engine, Session membership, desk output, channel levels and mute stay), DOM ids are the module and channel IDs of players and Rack parts, an effect inside a Rack part lands on that part's channel inserts (`slot="master"` keeps the desk master), and `LoopPlayer`, `AbPlayer`, `bindClock` and the `MidiPlayerController`/`Player` aliases are removed with their pages and demos. `TonePlayer` goes with Bridge's sync family in round 8; in-place `.sound`/`.score` replacement still rebuilds the engine. Round 6 is done: `composition` is inert everywhere (Kernel `isModularComposition()` always returns true; an undefined custom element is a pending boundary only inside a provider's scope); every `<audio-player>` is a module provider whose clip, editor document or borrowed `.player` is its Session participant, with `play(when)` deferring the Session start (`SessionTransport.play(when)`), Session rate and loop (validated against the source), and a player over an external queue/mix transport keeping that transport's own commands; an outermost `<audio-mixer>` owns a Session and its declared `.members` play as one participant, `player=`/`.player` keeps the mix-backend role, and DOM ids are module and channel IDs; nested playlist and recorder attach through the player's `AUDIO_PLAYER_OWNER` scope capability instead of `closest('audio-player')`, and recorder auditions go through the player element; `AudioRecorder` can capture in a borrowed context and exposes the microphone as an `output` port and `.module`; document playback flows through the player's inserts and module output with `setEffect` and ports available (MOD-14 closed with the synth panel's status presenter). Remaining Audio items: playlist as a Session queue source, channel taps on `audio-mixer`, offline module-graph render. Round 7 is done: views and analysis are companions — with no `player=` (or its new alias `input=`) they borrow the enclosing scope by containment: Score views and analysis read the `SCORE_PLAYBACK_OWNER` capability a `score-player` or `score-rack-part` lends (a Rack part now provides a scope and renders its children with `display: contents`), Audio views read the `AUDIO_PLAYER_OWNER` capability through one `observeCompanionTarget` helper, and tapped Audio analysers follow the scope's transport port so Session seek, pause and end reset their history. The three player-binding implementations still exist side by side (a shared Kernel source/transport observation is left for round 10's cleanup). Round 8 is done: Bridge's `ScoreAudioSync` family, its adapters, render provenance and `transport-contracts.ts` are removed in favour of `createScoreAudioSession` (one Session over a `ScorePlayerModule` and an `AudioPlayer`) and `registerAudioParticipant` (the shared `clip-seconds` adapter, also used by the project plugins — one axis name); `renderScoreToClip` stays a data function; Score's `TonePlayer` is removed; Kernel's public `/sync` entry is removed (`TransportGroup` and `MirrorClockMaster` are Session internals, their participant and command types are exported from `/session`); `ModuleProjectRuntime` connects `note` edges natively between module note ports; the patch editor already lists every port kind; Score React gains `useSessionSnapshot` and `useModulePorts`. The Bridge and independent-loop demos now run on Sessions. Bridge project buses still use Score's `ScoreRackModule` (itself the Kernel `RackModule`). Round 9 is done: every Element, Headless and API reference page has a "Ports and composition" section derived from source; documentation, demos, snippets, catalogs and package READMEs write `input=` instead of `player=`/`source=` (the catalogs keep those names only as retired aliases while the Elements still observe them), `<audio-recorder>` and `<audio-playlist>` read `input`, and the Bridge modular guide opens with the one composition model. Gaps found while documenting, for round 10: Audio `AudioPlayer.module` and `AudioMixer.module` answer `getPort` but do not enumerate `ports()`, and the mixer's `main` port ID is not accepted by its `getPort`; an outermost `score-rack-control` owns no Session; Score companions read no `port` or `.inputModule`; `score-recorder` joins no module scope; an Audio analyser linked only by `input` follows no transport and sees nothing behind a playlist or mixer backend; `<audio-mixer player=>` keeps its mix-backend role. Round 10 is done: no Element reads `player=` or `source=` (the mixer's backend link is `input=` too); `AudioPlayer.module`, the `<audio-player>` module and `AudioMixer.module` enumerate their `audio`, `source` (`webmusic.audio-clip`) and borrowed `transport` ports, accept `main`, and pass the conformance kit; Audio analysers and the meter tap the linked module, follow its Session transport and show the linked player's loading and error state (one `observeCompanionTarget` helper now serves Audio views and analysers); an outermost `score-rack-control` owns a Session (`sessionTransport`, MC-23); Kernel's `composition` boundary, `isModularComposition` and `MirrorClockMaster` are removed; `scripts/check-architecture.mjs` rejects the retired attributes, markup and exports (MC-27); the [0.3.0 notes](release/0.3.0.md#breaking-changes-from-02-dec-068-mod-15) list every breaking change. Rounds 11–16 (2026-11-07) closed the round 10 follow-ups: Score views and analysis share one companion follower in Score core, with Kernel `observeCompanionInput` discovery (`.inputModule`, `input`, containment; `port` follows a module's `webmusic.score` source port) also used by Audio companions; `score-note-input` publishes a `notes` note output and `score-recorder` records a selected note output, is a note Sink, and auditions inside a provider as a Session-free scope member; a playlist plays into one queue bus `output`, `AudioMixer` lists `channel:<id>` taps, and a player over either lists that group's output, so a linked analyser taps it; a borrowed queue is one Session participant on `queue-entry-seconds` whose player controls command the Session, which plays in the scope's AudioContext, re-anchors at each entry change and ends with the queue; `.score`/`.sound` replace a mounted Score engine in place (`SessionParticipantLease.refresh()` republishes the duration; a timing-class change still rebuilds); Kernel `renderModuleGraph()` renders a whole graph offline, ticking lookahead schedulers in rendered time — verified in Chromium with a real `OfflineAudioContext` (12 s of Arabesque through a Rack channel in about 60 ms, audible in every window; without ticks only the first window sounds; a Score + Audio graph admits both channels). Browser acceptance on the built site (Chromium, 2026-11-07): the playlist demo's Session tracks the entry (20.94 s against 21.0 s after a seek) and re-anchors at the next entry with one participant; the mixer demo lists `channel:track A`/`channel:track B` taps and a tap carries signal; the Quick Start player keeps its output port and Session membership across a `.score` assignment; no console errors. Round 17 (2026-11-07) closed the recorded limits: inside a provider a `score-recorder`'s live monitoring and audition share one `output` bus routed under its module ID (in a desk, its own Rack channel); Bridge `registerAudioParticipant` activates Session scheduling only for `sharedSessionClock` engines, so an `AudioPlayer` over an editor document no longer rejects at start; and the document-sequence scheduler takes the module environment's ticks, so an offline render includes an edited Audio document — verified in Chromium sample for sample against the source around a 1 s cut, and a recorder in a desk sounded live and in audition on one `rec` channel. Remaining by design: queue re-anchoring commits one Session seek per entry change; a playlist's entry advance in an offline render is unverified; UI, cursor and live-analysis timers stay on wall-clock time. Round 18 (2026-11-08) adds the [manual acceptance runner](../apps/test/README.md) (`apps/test`, `npm run test:manual`: 25 checks with their own compositions and a per-environment result record, outside the documentation site) and fixes what it found: assigning `.score` to a `score-player` during Session playback rejected with a direct-transport error; the engine now quiesces without commanding its Session-owned scheduler. Round 19 (2026-11-09) fixes the owner's first runner sitting (A1 frozen Session bar, D1 transport layout, D4 sound-change stall, E2/F3 playlist drift error, E4 silent edited document; details and checks in the audit): Session-root transports redraw every frame while playing, transport visibility keeps the presenter's inline layout, `replaceSynth` compares the connected sound, `AudioPlaylist.play(when)` and the streaming engine honour the Session start instant, and an editor document is an `<audio-player>`'s own Session source. Round 20 (2026-11-09) fixes the delivery process: the runner shows and reports the build's version, commit and working tree, is light and English only, gives every check (G1–G3 included) a live canvas of package components, and exports only a Markdown report kept outside Git; `npm run release:acceptance` verifies that report against the release commit, and [Development](DEVELOPMENT.md#version-workflow) and [Publishing](release/PUBLISHING.md#release-gates) fix the per-version and release gates. Round 21 (2026-11-09, DEC-069) preloads on mount: a Session's owning `<score-player>` or outermost `<score-rack-control>` and every `<audio-player>` prepare their members (a suspended context, engines, desk channels, inserts) so desks, effect panels and meters are live before the first play, with `preload="none"` as the lazy opt-out; parameter readouts keep one length and show physical units only; the runner spaces every canvas component by one gap and renders H1/H2 when they open. Round 22 (2026-11-09) makes manual acceptance a conversation: the owner reports failures, the agent fixes them in new rounds, and the owner's statement that acceptance is complete is gate 3; the report file and `npm run release:acceptance` are retired, and the runner's Markdown export is optional. | RELEASE-01 through its three gates, on the owner's instruction; later rounds hand off new runner checks under the [MOD-15 device acceptance audit](audits/2026-11-07-mod15-device-acceptance.md) | [Roadmap](plans/2026-11-06-unified-modular-composition.md), [Modular composition](design/MODULAR-COMPOSITION.md), DEC-068 |
| EDIT-01 | P0–P4 are implemented in this checkout. Under DEC-055 and DEC-057 editing ships inside View (operations in `/view`, editors and `loadScoreEditor`/`loadAudioClipEditor` in `/view/headless`, lent to Elements through `.editor`; no document Element) and Audio sequence export inside Play; there is no Edit capability or `/edit*` entry. Score has document-owned history, native playback binding and Element `.editor` binding. Under DEC-058 Score note editing is the `<score-grid-view>` piano-roll grid (toolbar, `tools` feature gating, draw/select tools, snap, velocity lane, zoom); `<score-view>` is read-only and staff entry (DEC-054) is removed. The grid's automated coverage and a local Chrome check are recorded with the change; touch, screen-reader and narrow-width acceptance of the grid toolbar remain open. Audio has immutable asset/sequence history, bounded segment playback, editor loading, waveform editing, local processing and WAV export; under DEC-061 waveform editing moved to `<audio-clip-view>` (AUDIOEDIT-01) and `<audio-view>` is read-only, so older evidence about `<audio-view editable>` describes the retired surface. The [interaction follow-up](audits/2026-10-15-editing-interaction-acceptance.md) reproduces and fixes the macOS dev-server cleanup race, records 50 consecutive passing startup suites and the final full check/site build, and verifies real mouse editing and 320/480 px layouts. Browser findings repaired upload-field overflow and missing piano-roll redraw after viewport expansion. The [review follow-up](audits/2026-10-15-editing-review-fixes.md) repairs six reproduced callback, lifecycle, shared-session, source-conflict and selection defects with targeted regressions. The [release follow-up](audits/2026-10-15-editing-release-follow-up.md) covers additional Audio interaction-session lease reentry and keyboard-only selection of existing piano-roll notes. The [2026-10-16 release review](audits/2026-10-16-editing-release-review.md) found five defects in shared selection targets, Audio commit atomicity, clipboard cleanup, playback attachment reentry and pending waveform numeric input; the [repair follow-up](audits/2026-10-16-editing-release-fixes.md) closes these with targeted regressions and browser verification. The [subsequent recheck](audits/2026-10-16-editing-release-recheck.md) reproduced four new P2 groups and a P3 segment-label defect. The [recheck repairs](audits/2026-10-16-editing-recheck-fixes.md) close these and the reproduced ScoreDocument/presentation counterparts with 58 new regressions; integrated verification and browser evidence are recorded there. The [post-fix review](audits/2026-10-16-editing-post-fix-review.md) reproduced two further P2 defects in waveform command targets across cancellation and Score playback snapshots after interaction-session replacement. The [target/session repairs](audits/2026-10-17-editing-target-session-fixes.md) close both, add 30 regressions, and fix the adjacent waveform disposal-command and Audio presentation-reentry paths; the integrated check, site build, external installation and production audit pass. The [2026-10-21 branch review repairs](audits/2026-10-21-editing-review-fixes.md) fix the clean-checkout `check:dev-docs` failure and the review's reproduced Score/Audio editing, playback, waveform and reference defects, and record the API naming and shared-pairing decisions left open. | Finish the bounded P0–P4 E1–E9 acceptance gaps below, then prepare the reviewed release commit under RELEASE-01; future notation/multi-track features and repeated unbounded global reviews are not additional exit criteria. Retain the documented desktop mouse/visual evidence; complete native select-popup keyboard navigation, touch/screen-reader, MusicXML download completion and acoustic/device checks; the eight-note MIDI import/edit/download path passed the 2026-10-16 review, and the recheck confirms native WAV file import followed by trim/gain editing. The recheck repairs also verify actual WAV download and PCM comparison within 16-bit quantization after trim/gain, plus browser segment-label updates through undo/redo. Alt-drag and held-pointer cancellation have automated rather than real-pointer coverage. Staff entry requires authored measures and its documented simple notation subset; full MuseScore-style authoring, seamless playback updates, spectral repair and multi-track/project work remain outside this delivery. Before the release commit, decide: whether players keep dispatching `webscore:documentstatechange`/`webaudio:documentstatechange` with details that differ from the declarations' events, and whether Score View's unprefixed `editpreview`/`editcommit`/`editerror` events become `webscore:edit*` like Audio; whether a rejected `commitDraft` keeps its draft in both domains; one slur-pairing rule shared by Score Edit and the staff renderer; keyboard-accessible read-only piano-roll selection; whether `AudioAssetStore` gains an ID probe so retired processing output IDs fail before DSP; whether the declared but never raised `document-disposed` application-error code is emitted or removed in both domains; and whether piano-roll, staff and waveform editing adopt the neutral UI item-grid/range-handle presenters the editing design describes or the design records the domain-owned SVG renderers as the accepted choice | [Editing contracts and roadmap](design/EDIT-COMPONENTS.md#implementation-and-reference-delivery), [Interaction verification](audits/2026-10-15-editing-interaction-acceptance.md), [P4 verification](audits/2026-10-15-staff-editing-p4.md), [P3 verification](audits/2026-10-15-audio-editing-p3.md), [P2 verification](audits/2026-10-15-score-editing-p2.md), DEC-053, DEC-054, DEC-055 and DEC-057 |
| SHEET-01 | Under DEC-060 `<score-sheet-view>` engraves justified systems on pages or in a column with the VexFlow engraver's system mode, without OpenSheetMusicDisplay, and with a borrowed editor edits notation through `set-pitches`, `notes-to-rests`, `tie-notes` and `write-notation`. Unit tests cover system justification, layouts, the operations and keyboard editing; a local Chrome check on Arabesque No. 1 (MXL) confirmed 27 justified systems on 8 pages, pitch keys on tuplet notes, refusal of a tuplet duration change and note input in measure 11. Zoom no longer re-engraves a page (CSS `zoom` over the engraved pages, a transform preview while pinching; flow re-breaks once a zoom settles): a zoom step on Arabesque fell from about 1.4 s to a pinch frame median of 8 ms, and a click on a notehead at 2.1× zoom selected it with its outline in place. `<score-grid-view>` zooms in proportion to wheel and pinch deltas once per frame (median 9–10 ms for time zoom); on 2026-11-05 the maintainer confirmed both views zoom smoothly on a real trackpad | Draw ties and slurs across system breaks; rewrite tuplet and grace rhythms; chord, voice and tuplet entry; re-breaking lines after an edit changes a measure's width (edits re-engrave only the touched systems and keep the breaks); pointer-drag, touch, screen-reader, narrow-width and playback-following acceptance in a browser | [Editing contracts](design/EDIT-COMPONENTS.md#score-sheet-editing), DEC-060, [Sheet View reference](../apps/doc/webmusic/src/content/docs/score/element/view/score-sheet-view.mdx) |
| AUDIOEDIT-01 | Under DEC-061 `<audio-clip-view>` (renderer `mountAudioClip`) edits a borrowed `AudioClipEditor` as a waveform clip editor modeled on Adobe Audition and DAW clip editors: icon toolbar, ruler with markers, channel lanes with segment boundaries, fade handles, gain lines, envelopes and a gain HUD; range split, delete, trim, silence, clipboard, amplify, curved fades, envelope points, markers (`set-annotations`), normalize/reverse/invert/remove-dc processing, zero-crossing and grid snap, zoom and history, each gated by `tools`. `<audio-view>` follows an editor read-only. Unit tests cover the edit builders, the renderer's gestures, keys, cards and lifecycle, the element and the demo. A 2026-11-04 local Chrome check on Arabesque No. 1 (WAV) confirmed a mouse range drag, the fade-in command (one commit, three segments), three HUD key steps to +3 dB, a marker, undo, and a 375 px layout without page overflow. Under DEC-062 a document beat grid (`set-beat-grid`) is drawn and edited in a Grid Edit toolbar mode (downbeat, BPM, tap, nudge, stretch, ×2/×½, meter, drag), with beat/bar snap, quantized seeks and beat jump; grid and marker revisions apply to a playing player without pausing, and the player exposes a Kernel `TempoClock`. Unit tests cover the Kernel grid math and clock, the operation and anchor mapping, in-place application and the Grid Edit tools. A 2026-11-05 local Chrome check on Arabesque No. 1 confirmed the seeded grid (bars, downbeat marker, empty history), the Grid Edit toolbar swap, two grid commits during playback without pausing (the player's `tempoGrid` and `tempoClock` followed), and a quantized ruler seek whose target kept the playing beat phase. Zoom repaints from aligned peak bins in the same frame as the scroll change, reads layout once per paint and keeps the clip's whole peak pyramid cached: on the documentation page a redraw fell from about 22 ms to 3.5 ms, every replayed pinch frame painted the final zoom and scroll of that frame, and pinch frames ran at a median of 8 ms and at most 17 ms from a cold page; on 2026-11-05 the maintainer confirmed pinch zoom feels smooth on a real trackpad | Dragging fade handles, gain lines, envelope points, markers and the beat grid with a real pointer; listening acceptance of grid alignment, tap tempo and quantized seeks while playing; touch and screen-reader acceptance; variable-tempo grids and beat-quantized group commands; crossfades between adjacent segments, spectral editing, multi-clip and multi-track arrangement are not offered | [Audio clip editing](design/EDIT-COMPONENTS.md#audio-clip-editing), DEC-061, [Clip View reference](../apps/doc/webmusic/src/content/docs/audio/element/view/audio-clip-view.mdx), DEC-062 |
| VISUAL-01 | DEC-059 makes [Visual design](design/VISUAL-DESIGN.md) required for all UI. `<score-grid-view>`, `<score-sheet-view>` and `<audio-clip-view>` conform. A 2026-11-05 audit of the other 23 Elements and the UIKit presenters they compose (source review plus a rendered-DOM scan of every Element page) found glyph/text buttons, a native select, visible scrollbars, visible hint/status prose, inverse plots, nested boxes, light-only fallbacks and per-pointermove layout work; these are fixed through a shared icon/scrollbar/visually-hidden helper (`packages/ui/src/internal/icons.ts`) and the recorder, playlist, mixer, note, analyzer, envelope/EQ/LFO/parameter/knob, status, stage, harmony flow-lane, workbench and pitch presenters, the Score renderers and `<audio-view>`/`<audio-live-view>`. The rescan finds no native select, glyph button, visible scrollbar, visible prose or off-height control on any Element page; demo canvases show only an error line. Deliberately unchanged: the transport (the documented reference for control geometry; it still wraps, a documented contract), a blanket `:where()` wrap of harmony rules (they rely on equal-specificity order), the `score-view` active-note token chain, and the pitch ghost-wash gradient | Keep new UI on the shared helper; extract a shared UIKit adjustment-card presenter when a second component needs one; decide whether the transport should become a single non-wrapping icon row; real-device touch, screen-reader and Safari pinch acceptance of the hardened presenters | [Visual design](design/VISUAL-DESIGN.md), DEC-059, [frontend workflow](../.agent/workflows/frontend-review.md) |
| DEP-02 | The October 27 main dependency review clears the high findings and patches the nested selector parser. Under DEC-070 (2026-11-11) the documentation site no longer uses Starlight or Expressive Code, so their `postcss-nested` override is removed with them. Three low reports remain in the Meyda → Rollup node-resolve → deepmerge chain. A later minimatch advisory now reports twelve moderate findings through the ESLint and typescript-eslint toolchain on the `minimatch` 10.2.6 shared by main and dev; it is not yet reviewed | Review supported parent repairs for the Meyda chain and the ESLint toolchain's `minimatch`; rerun full checks, both site builds, external-install and audit after any Astro or Meyda update. A forced Meyda downgrade is not an accepted migration. A 2026-11-11 audit also reports a low `fast-xml-parser` finding, not yet reviewed | [October dependency review](log/2026-10-27-dependabot-integration.md), [Review corrections](log/2026-10-07-score-analysis-review-corrections.md), [Development](DEVELOPMENT.md) |
| TIME-01 | Implemented for native participants: one Session scheduling authority with mapped readers, synchronous invalidation and borrowed participant lifetimes; legacy group authority remains supported | Third-delivery tests and native renders verify shared-anchor consumption and cancellation. Broader device/browser acceptance remains VERIFY-01 | [Shared-clock design](../platform/shared-clock-injection.md), DEC-018, DEC-064 |
| BIND-01 | Native Score data/state attachment is implemented; external controller/Rack and legacy event capabilities remain partial | Extend only explicitly supported source/part/activity capabilities; preserve readiness, source identity and borrowed lifetimes. Do not invent a single Score for a multi-source owner | [Player binding design](design/PLAYER-BINDING.md), DEC-011 and DEC-017 |
| BIND-02 | Readout/log tags and scored-chord preview remain targets; retained PitchView supports player/source binding | Resolve the spec's open member/unit choices; implement the supported modes, part/note identity and bounded logs; align public entries, presenters, catalogs, references and accessible demos | Player binding design and component/page templates |
| PLAY-01 | Algorithm/lifecycle and responsive UI source changes are implemented; earlier external-theme browser checks cover transparent surfaces, colors, radii, narrow/wide geometry and transport keyboard focus | Verify the merged Play demos' rendered state, keyboard and touch behavior at narrow/wide widths; measure device suspend/resume and MIDI separately | [Play design](design/PLAY-COMPONENTS.md), [implementation audit](audits/2026-09-09/SCORE-PLAY.md), [frontend source audit](audits/2026-09-09/SCORE-PLAY-FRONTEND.md), [styling review](audits/2026-09-10/SCORE-STYLING.md) |
| VIEW-01 | Written-time projection and VexFlow replace the quantized staffrender path. Timed Part clefs/directions, source tuplet visibility, no-source clef inference and independent slur/tie geometry are implemented. The ten-page, 107-measure PDF review also led to full-Part slur pairing, articulation/barline/rest-position preservation and compact ink packing; final automated and Chrome results are recorded in the contract | Cross-staff/cross-measure beams, nested tuplets, complete grace/expression/font fidelity, per-articulation placement, credits/labels and page/editor layout remain bounded or unsupported. The cross-staff curve collision solver is bounded and does not establish complete engraving parity. Complete cross-browser/accessibility acceptance, including keyboard access; MIDI notation remains inferred. Do not claim full MuseScore parity | [Staff notation contract and acceptance](design/STAFF-NOTATION.md#acceptance), [PDF coverage](design/STAFF-NOTATION.md#pdf-comparison), [ScoreView notation limits](../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx), DEC-024 |
| CHORDIO-01 | DEC-047's four elementary tools, explicit chord modes, catalog and Arabesque No. 1 demos are implemented; full automated checks and desktop/390px browser checks passed on 2026-10-03. DEC-049's review corrections (wrap minimum width, per-numerator beat groups, exact selection ends, nameplate accessibility) are implemented and the long-window chord demo was verified locally. Recurrence UI remains parked | Complete real MIDI-device, screen-reader and audible non-unit-rate seeking acceptance; do not treat local browser checks as device or acoustic evidence | [Analyze component design](design/ANALYZE-COMPONENTS.md), DEC-047, DEC-049 and owning Element/API pages |
| ANALYZE-01 | Deterministic regression cases cover key-profile rotations, triads and inference boundaries; empirical musical accuracy remains unmeasured | Evaluate an annotated real-music corpus with declared genres, ground truth, metrics and ambiguity policy before claiming accuracy percentages or calibrated confidence | [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md), [Analyze algorithm record](audits/2026-09-10/SCORE-HEADLESS-ANALYZE.md) |
| ANALYZE-02 | Elementary chord, interval and scale inspection now offer explicit written/sounding pitch basis, apply Part.transpose in sounding mode and retain notation/source evidence. Legacy key/chord segmentation, distributions, voice-leading, incremental sessions and their workers/projections still use stored written pitches | Extend the explicit pitch-basis contract and consistent normalization to those remaining legacy paths without changing the authored Score, double-transposing or overstating inference provenance; verify mixed piano/B♭ clarinet harmony and cross-part parallel-fifth fixtures | [API transposition finding](audits/2026-09-10/SCORE-API.md#open-transposing-instrument-contract), [public pitch basis](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#pitch-basis-and-transposing-instruments) |
| SCOREIO-01 | MIDI/MusicXML/ABC/MXL correctness repairs cover supported format subsets; full interchange and navigation fidelity remain limited | Define and test supported complex features before expansion: SMPTE timing, richer ABC syntax, cross-measure notation splitting and nested/alternative repeat routing. Preserve documented unsupported-input errors and lossy boundaries | [Score API review](audits/2026-09-10/SCORE-API.md), [IO detail](audits/2026-09-10/SCORE-API-IO.md), [repeat contracts](audits/2026-09-10/SCORE-API-MODEL.md) |
| DEV-05 | Under DEC-066 the repository owner restored Arabesque No. 1 (MXL, MIDI, WAV, MP3) and three SoundFonts in `apps/doc/webmusic/public/`, replacing the generated WebMusic Study media; every demo and example uses Arabesque, enforced by `check:demo-music`. The [public inventory](../apps/doc/webmusic/ASSETS.md) records the available evidence; creator, source and redistribution terms for these files are not established. The owner removed the former study's `public/licenses/` files; `apps/doc/webmusic/public.sha256` pins the approved folder contents | The owner reviews rights and notices for the restored files before any manual Pages deployment or release that ships them. Agents do not change the folder | [Asset inventory](../apps/doc/webmusic/ASSETS.md), DEC-066, [Development](DEVELOPMENT.md) |
| TIME-02 | Native Score/Audio future-loop scheduling and phase mapping are implemented and measured | Third-delivery native fixtures measure loop boundaries, seek, pause, rate edits and wider-loop silence at 48 kHz. Committed graph precision does not establish unlimited background scheduling or hardware latency | Shared-clock design, Bridge and third acceptance record |
| AUDIO-ANALYZE-01 | DEC-037 selects five live Analyze Elements: meter, level, spectrum, oscilloscope and transient. DEC-051 gives the meter seven type-selected canvas displays (VU, loudness, waveform, oscilloscope, spectrum, spectrogram, stereometer) with mono/colour themes and an owned stereo branch; unit coverage spans the reductions, painters, stereo-branch ownership and the element contract, and the 2026-10-08 browser check covered the demo's type/theme switching. Device, acoustic and calibrated-loudness acceptance remain | Verify exact five-tag canonical inventory and one idempotent legacy View meter alias; real player and explicit-analyser binding; meter tap and stereo-branch ownership, threshold/freeze/hold, spectrum probing, bounded oscilloscope trigger/timebase/probe and transient sensitivity/refractory behavior; pause/seek/end/source changes, graph loss and cleanup; normal/narrow layout, keyboard and device behavior. Distinguish the meter's windowed K-weighted estimate from gated EBU R128 loudness, sample peaks from true peak, FFT output from calibrated SPL, and transient cues from BPM or a beat grid. Verify beat-grid API/Headless output composed with `audio-view.regions` without a retired Analyze tag | [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md), DEC-051, owning Element/API/Headless pages |
| AUDIO-VIEW-02 | Live View retains a fixed number of caller-paced observations and paints them at equal spacing; `windowSeconds` is not a precise elapsed-time display at variable capture rates | Decide timestamp spacing versus an explicit fixed capture cadence; verify pause, background/foreground and high-refresh behavior without creating another playback clock | [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), owning live projection types and tests |
| DOC-02 | Headless demo/control catalog coverage remains partial; authored Related navigation is now the supported reference path | Implement missing object demos and catalog controls where meaningful, or document the input/environment needed to demonstrate them; validate options, commands, state, events, reset and cleanup against the authoring contract | [Headless template](docs/HEADLESS-PAGE-TEMPLATE.md) and source catalogs |
| DOC-04 | Public API and Headless completeness checks are narrower than the templates | Check actual member/reference ownership, types and target content where mechanical; retain manual review for semantics | Conventions and page templates |
| DOC-05 | Element/Headless/API page-shape and demo layout enforcement is incomplete | Define accepted exceptions, enforce applicable order/count rules, and align page-specific demo placement without breaking working demos | [Site plan](docs/DOCS-SITE-PLAN.md) |
| DOC-06 | The family start pages and the two form inventories are in place; `checkLinks` now rejects a repository link that only resolves through a redirect, but no check constrains the title or section shape of the two inventories, and the retired capability-Overview title rule was not replaced | Decide whether the inventories need a title/section-shape rule of their own, and whether the family element inventory's per-capability sections should be asserted the way its absence of demos already is | [Site plan](docs/DOCS-SITE-PLAN.md), [Conventions](docs/DOCS-CONVENTIONS.md), DEC-020 |
| DOC-07 | Under DEC-070 the documentation site renders in its own shell (`src/site/`) without Starlight: section tabs, left navigation, contents column, search dialog, monochrome code frames and asides, light only. Unit tests cover the navigation tree, order and pager; every anchor link in the built site resolves; a local preview was checked at 1440 px and 375 px with no console errors | Owner acceptance of the shell in a browser: keyboard path through the tabs, navigation and search, screen-reader landmarks, touch on the narrow navigation, and the demos on every family page | [Site plan](docs/DOCS-SITE-PLAN.md) §"Site shell", DEC-070 |
| DOC-08 | Under DEC-071 Web Component demos show only their default composition: `ElementDemo` replaces the playground, and the Parameters strip, markup readout, Copy/Reset and the effect, Rack-part and synth-panel property editors are removed with their client code and tests. The synth panel demo nests the panel and a note input in a player. Page prose and the design guidance no longer refer to Element Parameters. Headless and UI Kit presenter demos keep theirs | Owner browser acceptance of the Element pages, in particular the synth panel, Rack, score player and multiband waveform demos | [Component page template](docs/COMPONENT-PAGE-TEMPLATE.md), [Visual design](design/VISUAL-DESIGN.md), DEC-071 |
| VERIFY-01 | Source/package checks and dated browser evidence cover their stated scenarios; broader cross-browser/audio/MIDI/microphone acceptance, background timing and accessibility remain separate. The [manual acceptance runner](../apps/test/README.md) runs the owner's checks; acceptance is the owner's statement in the conversation, with no stored report. The owner accepted MOD-15 at `3d81ef3` on 2026-11-09 | Record actual environment, procedure and results separately; use the release gates for package delivery and device tests for acoustic/interaction claims | [Kernel release review](audits/2026-09-11/KERNEL-RELEASE.md), [Development](DEVELOPMENT.md), [Publishing](release/PUBLISHING.md) |
| RELEASE-01 | Shared `0.3.0` metadata and dependency floors are prepared; MOD-RC-01 is closed and fresh Node 22/24 local gates plus installed-package acceptance pass. The editing work merged from `dev` is part of this preparation. Publication and current registry state have not been reverified in this recovery task; prior release receipts remain unchanged | Verify remote CI for the final reviewed commit (GitHub API access currently returns 403), recheck registry versions and publisher rights, publish in dependency order, verify registry installation, then tag the producing commit and record delivery; site deployment remains separate | [Candidate repairs and recovery](audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md), [0.3.0 preparation](release/0.3.0.md), [Publishing](release/PUBLISHING.md), [Releasing](release/RELEASING.md) |
| LIB-01 | The component library built on `doc-web-ui` (2026-11-09 to 11) moved to the owner's private repository on 2026-11-11; this repository keeps only the package work it found. Fixed here (runner checks A5 and D5): a single insert's panel was titled "Effect" instead of its type (`score-effect` and `audio-effect` modules now carry the type as `label`); `Effect.distortion` and `Effect.bitcrusher` published no live parameters (now `drive`/`wet`/`dry` and `wet`/`dry`, defaults unchanged in sound); `<score-synth-panel>` showed explanatory sentences under its envelope and LFO sections (now `@webmusic/ui/panel` `describe()`, visually hidden, still read by assistive technology); and `<score-player>`'s surface seek drew no handle and a different time face from `<audio-player>` (the transport state stylesheet now draws the thumb's handle; the preset's time font is the transport's mono face). Open: the four Score analysis elements nested in a `<score-player>` stay at "Waiting for a score" while the same element linked by `input` analyses the piece, although their pages show the nested form | Owner's manual pass of A5 and D5; fix or document nested Score analysis | [Visual design](design/VISUAL-DESIGN.md), [Player binding](design/PLAYER-BINDING.md), [Acceptance runner](../apps/test/README.md) |
| APP-01 | Score/Audio playback reference and independent-loop examples are implemented; workstation/project scenarios remain product goals | Use the reference to validate new capabilities before expansion; project/global history, storage and installation deployment remain application-owned. Optional single-document history is available for Score and Audio; verification and remaining editing work are tracked in EDIT-01 | [Reference composition](../apps/doc/webmusic/src/content/docs/bridge/composition.mdx), [Product](PRODUCT.md), DEC-019, DEC-053 |

REPO-01 and DEV-06 are closed by the merged integration and successful remote CI
linked above. Their earlier failures and repairs remain in the
[local CI repair record](audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md).
That earlier deployment did not establish asset rights. DEV-05 now records the
original-media replacement in the current source; already deployed files are unchanged.

The prior dev-doc audit is [historical evidence](audits/2026-09-05/DEV-DOCS-REVIEW.md). Its stale-rule and ownership findings are addressed by this documentation reorganization. DOC-01's missing Headless reference sections have been completed: the leaf pages now have Import, grouped API, lifecycle/time responsibilities, and Related navigation, with public types routed through the family Headless inventory. This is source-based reference work, not proof from the value-name gate alone. Verification and the snapshot's limits are recorded in the [documentation reorganization record](audits/2026-09-05/DOCUMENTATION-REORGANIZATION.md); work requiring implementation or broader acceptance remains above.

The [code-alignment record](audits/2026-09-05/CODE-ALIGNMENT.md) records the
completed symmetric factory guards (TIME-03), expanded snippet checker and
explicit authoring boundary (DOC-03), and repairs to Score wrappers, Rack
effects and existing demo lifetimes. Missing Headless demo/catalog coverage
remains in the queue above; the third modular delivery implements the native
shared-clock protocol with separately stated legacy and device limits.

The [documentation synchronization record](audits/2026-09-06/DOCUMENTATION-SYNC.md) records the shared guidance update, preserved branch baselines and actual verification results.

The [design-contract record](audits/2026-09-08/DESIGN-CONTRACTS.md) records native
snapshot and nominal-seek acceptance (BIND-03), revisioned command authority,
mode configuration and runnable reference compositions. The remaining engine
clock injection, timing precision and companion capabilities stay in the queue.

## Retained Score evidence

The [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md) records the
2026-09-10 timing, identity, numerical and lifecycle repairs across Score's
public Headless entries and their shared foundations. Its regression evidence
does not close the browser/device, engraving or empirical-analysis gaps above.

The subsequent [Score API review](audits/2026-09-10/SCORE-API.md) records exact
arithmetic, PPQ conversion, model/edit/repeat, format interchange and stateless
capability corrections on top of that Headless baseline. Public API references
describe the implemented algorithms and their representational limits; this
does not establish full notation interchange or measured musical inference accuracy.

The [Audio visual alignment record](log/2026-09-25-audio-visual-alignment.md)
records shared neutral defaults, repaired theme inheritance and representative
rendered/keyboard checks. Broader device and accessibility acceptance remains
subject to the existing work queue.

The [Audio Play repair record](audits/2026-09-25/AUDIO-PLAY.md) records the
callback/lifecycle, source-binding, mixer/queue, recorder and meter corrections
and their bounded test evidence. [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md)
owns the accepted responsibilities. The third modular delivery adds measured
native clock precision; VERIFY-01 retains broader device and browser acceptance.

The [Audio View review](audits/2026-09-25/AUDIO-VIEW.md) records lazy shared demo
analysis, bounded spectrogram storage, cached data/readiness and interaction
repairs. CPU probes and browser DOM observations remain separate from measured
browser opening latency, visual screenshots and real-device acceptance.

The [main Score/Agent Toolkit synchronization](audits/2026-09-25/MAIN-SCORE-TOOLKIT-SYNC.md)
records local checks and browser observations for the earlier, broader
integration. Its retained-controller scope is superseded by the current main
authority above; the dated record remains unchanged and does not verify this
corrected tree.

The [main-authority follow-up](audits/2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md) records
the exact Score/Toolkit baseline, current workspace tests, site build, packaging,
external-consumer and browser checks. At that recorded baseline, full `check`
inherited the seven main lint findings; no rules or tests were disabled. The
[local CI repair](audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md) records the later
source fixes and their separate `dev` and `main` verification boundaries.

## Change discipline

Keep each open item here until acceptance has evidence, then link a dated record and remove it from the active queue. Historical completion descriptions stay in their dated records. New scope changes update the owning decision or contract as well as this queue; they do not silently turn a product goal into a shipped claim.
