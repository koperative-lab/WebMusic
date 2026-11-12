# Status history — recorded until 2026-11-12

This record preserves, verbatim, the dated verification narratives that
[STATUS](../STATUS.md) carried until 2026-11-12: its checkout profile, the
modular release narrative that preceded its work queue, and its retained
evidence notes. Only relative link paths were adjusted for this location.
Test totals, page counts, Node versions and browser observations describe the
date each paragraph names. They are not current verification.

Current work is the [STATUS work queue](../STATUS.md#current-work-queue).
Dated findings live in [audits](../audits/README.md); accepted choices live in
[DECISIONS](../DECISIONS.md).

## Checkout profile narrative

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

The earlier `cfa90b2` integration and [2026-09-11 CI reconciliation](2026-09-11-dev-ci-reconciliation.md)
describe a historical source baseline. Their outcomes do not establish this
merged worktree's checks, remote CI or deployment. The root package scripts
and the current workflow determine today's executable gates.

The [Audio Player composition follow-up](../audits/2026-09-26/AUDIO-PLAYER-COMPOSITION.md)
records the central `audio-player`, linked playlist/mixer/recorder and the then-
View meter migration. Source selection and disposal/late-load regressions are covered;
recording hardware and acoustic group timing remain separate acceptance work.
DEC-030 removes the temporary old Element aliases and routes; current demos
and exports use canonical names. The [development workflow](../DEVELOPMENT.md#documentation-server-lifecycle)
defines reuse on ordinary startup and explicit stop/restart for rebuilds;
ordinary startup must not terminate another active terminal's server.
The later [Audio Play layout follow-up](../audits/2026-09-26/AUDIO-PLAY-LAYOUT.md)
records DEC-031's canonical `audio-recorder` naming, full-width hosts and
Score-aligned spacing, including normal and 320px browser checks.

The [Score Recorder documentation follow-up](../audits/2026-09-26/SCORE-RECORDER-PAGE.md)
records DEC-032's standalone recorder page, linked input demo and updated
navigation. Demo lifecycle tests and browser recording checks passed; the full
check at that recorded baseline retained the DEV-06 lint blocker.

The [Analyze demo alignment](../audits/2026-09-26/ANALYZE-DEMO-ALIGNMENT.md)
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
The [frame and startup correction](../audits/2026-09-26/ANALYZE-FRAME-AND-DEV-STARTUP.md)
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

The [2026-10-07 dev consolidation review](2026-10-07-score-analysis-dev-closeout.md)
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

The [2026-10-07 review corrections](2026-10-07-score-analysis-review-corrections.md)
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

[The earlier inspection record](../audits/2026-09-26/SCORE-ANALYZE-INSPECTION.md)
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
Element inventory. The [component feedback review](../audits/2026-10-08/COMPONENT-FEEDBACK.md)
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

The [follow-up readiness audit](../audits/2026-10-09/COMPONENT-READINESS.md) checks all
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
[Element page template](../docs/COMPONENT-PAGE-TEMPLATE.md); topic examples retain
their later explanatory sections. `check:docs` rejects visible body content
before the main demo. Verification on 2026-10-09 passed the complete
`VITEST_MAX_WORKERS=2 npm run check` (4,546 workspace tests) and
`npm run docs:build` (112 pages). Generated HTML for every owning page starts
with its live playground. Browser checks of ScoreView and AudioView at
localhost:4324 confirmed that the demos are visible on entry, with no new
console errors or warnings.

## Modular release narrative

The modular redesign's three deliveries (steps 1–12) are complete and locally
verified in the `modular-redesign` working tree. The
[first acceptance record](../audits/2026-10-15/MODULAR-FIRST-DELIVERY.md) covers
composition, routing and shared controls. The
[second acceptance record](../audits/2026-10-15/MODULAR-SECOND-DELIVERY.md) adds
complete per-voice ADSR, occurrence-owned note input, native CV/LFO, shared
macros and absolute audio-clock automation. The
[third acceptance record](../audits/2026-10-15/MODULAR-THIRD-DELIVERY.md) covers
shared-anchor scheduling, seek/loop-relative automation and LFO phase, effect
generation transitions, versioned project restoration and accessible patch
editing. Each record owns the checks, measurements and limitations of its
stated baseline. Their contracts are
[DEC-063](../DECISIONS.md#dec-063--modular-composition-separates-resources-routing-and-session-authority)
and DEC-064, with [Modular composition](../design/MODULAR-COMPOSITION.md); current public usage
is in the [runnable guide](../../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx).
The [2026-10-16 review follow-up](../audits/2026-10-16/MODULAR-REVIEW-FIXES.md)
repairs 20 independently reproduced mixing, lifecycle, scheduling, control,
project transaction and focus defects. Its verification record supersedes any
inference that the earlier acceptance covered those boundary cases. The complete
check passed 4,620 tests, the documentation build passed, and final native/public
page checks verified the repaired behavior against the rebuilt outputs.

The subsequent [release-readiness repairs](../audits/2026-10-15/MODULAR-RELEASE-FIXES.md)
close eight further defects and one adjacent mixer reentry defect, with 50 new
regressions. At that baseline the complete check passed 4,670 tests; documentation build,
independent `0.3.0` tarball installation and final native/public-page acceptance
also pass. Package versions and internal peer floors are prepared as `0.3.0` /
`^0.3.0`; an incompatible published `0.2.0` Kernel is rejected during installation.
These are local working-tree results, not a verified release-commit CI or registry
delivery receipt. The dated record owns reproduction details and finite test limits.

The next [release follow-up](../audits/2026-10-16/MODULAR-RELEASE-FOLLOWUP-FIXES.md)
addresses twelve further project automation, readiness ownership, envelope,
lazy LFO, CommonJS identity and editor reentry findings, with 65 new regressions.
The complete check passes 4,735 tests across 371 files; documentation build,
independent tarball installation and final native/browser acceptance pass.
Installed CommonJS entry identity, automatic retry focus and manual-override
save/restore are now covered directly. The new record retains original failures
separately from the repaired behavior; final-commit CI and registry delivery
remain RELEASE-01.

The [release hardening follow-up](../audits/2026-10-16/MODULAR-RELEASE-HARDENING.md)
closes two further initial-attachment/mixer reentry failures. The full check
passes 4,743 workspace tests plus eight original-media checks. DEP-02's remaining
ten reports are cleared; DEV-05's unresolved resources are replaced or removed.
Normal and Pages site builds and native/browser playback, resource, license and
narrow-layout checks pass. The dated record retains original failures, exact
artifact fingerprints and the final external-install checks separately from
the release-commit CI and registry work in RELEASE-01.

The subsequent [read-only candidate review](../audits/2026-10-16/MODULAR-RELEASE-CANDIDATE-REVIEW.md)
revalidates the unchanged implementation and packed inputs but finds eight
additional defects: factory-disposal graph publication, stale natural-end
commands, mixed built-in mixer starts, lazy channel-ID collisions, sampler
capability forwarding, analyzer binding cleanup and error payloads, and combined
browser-global meter identity. The subsequent
[recovery and candidate repairs](../audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md)
restore the uncommitted implementation from retained task history and close all
eight findings, including analyzer teardown/reconnection. Both fresh Node 22.22.3
and independent Node 24.19.0 full gates pass 4,833 tests across 373 files, with
90 added regressions. Final installed-package checks pass 174 runtime entries,
all declaration variants, 65 native browser cases and 36 Session/Group cases;
both dependency audits report zero vulnerabilities. New receipts and frozen
input hashes are retained with that record. Some older generated evidence was
not recoverable and is explicitly marked unavailable; earlier reports remain
historical rather than fresh verification.

## Closed items and earlier records

REPO-01 and DEV-06 are closed by the merged integration and successful remote CI
linked above. Their earlier failures and repairs remain in the
[local CI repair record](../audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md).
That earlier deployment did not establish asset rights. DEV-05 now records the
original-media replacement in the current source; already deployed files are unchanged.

The prior dev-doc audit is [historical evidence](../audits/2026-09-05/DEV-DOCS-REVIEW.md). Its stale-rule and ownership findings are addressed by this documentation reorganization. DOC-01's missing Headless reference sections have been completed: the leaf pages now have Import, grouped API, lifecycle/time responsibilities, and Related navigation, with public types routed through the family Headless inventory. This is source-based reference work, not proof from the value-name gate alone. Verification and the snapshot's limits are recorded in the [documentation reorganization record](../audits/2026-09-05/DOCUMENTATION-REORGANIZATION.md); work requiring implementation or broader acceptance remains above.

The [code-alignment record](../audits/2026-09-05/CODE-ALIGNMENT.md) records the
completed symmetric factory guards (TIME-03), expanded snippet checker and
explicit authoring boundary (DOC-03), and repairs to Score wrappers, Rack
effects and existing demo lifetimes. Missing Headless demo/catalog coverage
remains in the queue above; the third modular delivery implements the native
shared-clock protocol with separately stated legacy and device limits.

The [documentation synchronization record](../audits/2026-09-06/DOCUMENTATION-SYNC.md) records the shared guidance update, preserved branch baselines and actual verification results.

The [design-contract record](../audits/2026-09-08/DESIGN-CONTRACTS.md) records native
snapshot and nominal-seek acceptance (BIND-03), revisioned command authority,
mode configuration and runnable reference compositions. The remaining engine
clock injection, timing precision and companion capabilities stay in the queue.

## Retained Score evidence

The [Score Headless review](../audits/2026-09-10/SCORE-HEADLESS.md) records the
2026-09-10 timing, identity, numerical and lifecycle repairs across Score's
public Headless entries and their shared foundations. Its regression evidence
does not close the browser/device, engraving or empirical-analysis gaps above.

The subsequent [Score API review](../audits/2026-09-10/SCORE-API.md) records exact
arithmetic, PPQ conversion, model/edit/repeat, format interchange and stateless
capability corrections on top of that Headless baseline. Public API references
describe the implemented algorithms and their representational limits; this
does not establish full notation interchange or measured musical inference accuracy.

The [Audio visual alignment record](2026-09-25-audio-visual-alignment.md)
records shared neutral defaults, repaired theme inheritance and representative
rendered/keyboard checks. Broader device and accessibility acceptance remains
subject to the existing work queue.

The [Audio Play repair record](../audits/2026-09-25/AUDIO-PLAY.md) records the
callback/lifecycle, source-binding, mixer/queue, recorder and meter corrections
and their bounded test evidence. [Audio Play design](../design/AUDIO-PLAY-COMPONENTS.md)
owns the accepted responsibilities. The third modular delivery adds measured
native clock precision; VERIFY-01 retains broader device and browser acceptance.

The [Audio View review](../audits/2026-09-25/AUDIO-VIEW.md) records lazy shared demo
analysis, bounded spectrogram storage, cached data/readiness and interaction
repairs. CPU probes and browser DOM observations remain separate from measured
browser opening latency, visual screenshots and real-device acceptance.

The [main Score/Agent Toolkit synchronization](../audits/2026-09-25/MAIN-SCORE-TOOLKIT-SYNC.md)
records local checks and browser observations for the earlier, broader
integration. Its retained-controller scope is superseded by the current main
authority above; the dated record remains unchanged and does not verify this
corrected tree.

The [main-authority follow-up](../audits/2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md) records
the exact Score/Toolkit baseline, current workspace tests, site build, packaging,
external-consumer and browser checks. At that recorded baseline, full `check`
inherited the seven main lint findings; no rules or tests were disabled. The
[local CI repair](../audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md) records the later
source fixes and their separate `dev` and `main` verification boundaries.
