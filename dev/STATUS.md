# Implementation status and open work

> Release preparation: the five-package integration is on `main` at `eaa88af4`
> through [PR #25](https://github.com/koperative-lab/WebMusic/pull/25).
> Its [CI run](https://github.com/koperative-lab/WebMusic/actions/runs/36516020568)
> passed Node 22/24 quality checks, the website build and Pages deployment.
> This checkout prepares shared `0.2.1` metadata. Registry and remote-tag queries
> on 2026-10-07 confirmed all five packages at `0.2.0`; `0.2.1` was unused.
> Publication remains a separate manual step. The
> [0.2.1 preparation notes](release/0.2.1.md) own this update's scope;
> [Publishing](release/PUBLISHING.md) owns delivery and verification.
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

## How to read status

“Implemented” means a source path exists and its stated behavior was inspected. “Verified” names the checks or environment used. “Accepted target” states intended behavior that still requires design or implementation. An automated check is not proof of real audio, device, browser, remote publication, or complete API documentation.

The current public surface is generated in [COMPONENTS](COMPONENTS.md); documentation coverage is mapped in [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md). Versions and dependency ranges belong to manifests, not a copied status table.

## Capability readiness

| Area | Current evidence | Boundary |
|---|---|---|
| Models, APIs, Headless, Elements, UI presenters | Five source package workspaces, explicit public exports and element/presenter catalogs | Entry-specific environments and optional dependencies still apply; source presence is not registry publication |
| Score/Audio coordination | Revisioned group commands/snapshots, Bridge delegation, affine follower mapping and explicit native-loop phase mapping | Engines still own separate clocks; group loop boundaries depend on watcher delivery and native timing belongs to the selected backend. A clockless master without an observed forward position step cannot be safely inferred to have stopped from repeated samples alone. |
| Cross-domain conversion | Timeline mapping, score rendering, transcription-result assembly in Bridge | No lossless audio-to-score round-trip guarantee |
| Interaction and visual customization | UI bindings, presenter-owned resources/styles, public tokens and handles, composed Elements | Device, accessibility, and browser acceptance are not implied by unit tests |
| Analyze/View attachment to Play | Score core source contract, native Headless/Element `.playback`, borrowed Score data and snapshots in Analyze/ScoreView, optional Headless ScoreView binding | Controller/Rack single-score data remains unavailable; legacy event targets retain partial capabilities. PitchView follows held-note sources; readout/log tags and chord preview remain targets in [Player binding](design/PLAYER-BINDING.md) |
| Documentation organization | Product/design/decision/architecture owners, generated component/file indexes, four page templates, archived history, and a source-based pass across all Headless reference leaves | Semantic review, automated coverage, and demo/browser acceptance remain distinct; see the open checks below |
| Prior runtime repairs | [Repair record](audits/2026-09-05/FIXES.md): 197 test files / 2,205 tests, full check and docs build on local Node 22 | This is dated evidence; it is not a new Node 24/device/external-install result |

## Current work queue

| ID | Work and state | Acceptance | Owning reference |
|---|---|---|---|
| DEP-02 | The reviewed dependency updates clear the high audit findings. The ten moderate reports in the documentation site's PostCSS selector-parser chain are cleared by a root npm override that resolves `postcss-nested` 7.0.2 under `@expressive-code/core`, so the nested selector parser deduplicates to the patched 7.1.6; the audit reports no findings at the moderate threshold | Remove the override once `@expressive-code/core` itself requires `postcss-nested` 7 or later, and rerun full checks, both site builds, external-install and audit after any Starlight or Expressive Code update. The audit's suggested Starlight downgrade is not an accepted migration | [Review corrections](log/2026-10-07-score-analysis-review-corrections.md), [Dependabot integration review](log/2026-10-07-dependabot-integration.md), [Development](DEVELOPMENT.md) |
| TIME-01 | Group command authority, revisioned observation and participant re-entry are implemented; same-instance clock injection remains open | Specify/verify engine consumption of one shared anchor if introducing injection; preserve the existing command outcome, cancellation and participant ownership guarantees | [Shared-clock design](../platform/shared-clock-injection.md), DEC-018 |
| BIND-01 | Native Score data/state attachment is implemented; external controller/Rack and legacy event capabilities remain partial | Extend only explicitly supported source/part/activity capabilities; preserve readiness, source identity and borrowed lifetimes. Do not invent a single Score for a multi-source owner | [Player binding design](design/PLAYER-BINDING.md), DEC-011 and DEC-017 |
| BIND-02 | Readout/log tags and scored-chord preview remain targets; retained PitchView supports player/source binding | Resolve the spec's open member/unit choices; implement the supported modes, part/note identity and bounded logs; align public entries, presenters, catalogs, references and accessible demos | Player binding design and component/page templates |
| PLAY-01 | Algorithm/lifecycle and responsive UI source changes are implemented; earlier external-theme browser checks cover transparent surfaces, colors, radii, narrow/wide geometry and transport keyboard focus | Verify the merged Play demos' rendered state, keyboard and touch behavior at narrow/wide widths; measure device suspend/resume and MIDI separately | [Play design](design/PLAY-COMPONENTS.md), [implementation audit](audits/2026-09-09/SCORE-PLAY.md), [frontend source audit](audits/2026-09-09/SCORE-PLAY-FRONTEND.md), [styling review](audits/2026-09-10/SCORE-STYLING.md) |
| VIEW-01 | Written-time projection and VexFlow replace the quantized staffrender path. Timed Part clefs/directions, source tuplet visibility, no-source clef inference and independent slur/tie geometry are implemented. The ten-page, 107-measure PDF review also led to full-Part slur pairing, articulation/barline/rest-position preservation and compact ink packing; final automated and Chrome results are recorded in the contract | Cross-staff/cross-measure beams, nested tuplets, complete grace/expression/font fidelity, per-articulation placement, credits/labels and page/editor layout remain bounded or unsupported. The cross-staff curve collision solver is bounded and does not establish complete engraving parity. Complete cross-browser/accessibility acceptance, including keyboard access; MIDI notation remains inferred. Do not claim full MuseScore parity | [Staff notation contract and acceptance](design/STAFF-NOTATION.md#acceptance), [PDF coverage](design/STAFF-NOTATION.md#pdf-comparison), [ScoreView notation limits](../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx), DEC-024 |
| CHORDIO-01 | DEC-047's four elementary tools, explicit chord modes, catalog and Arabesque No. 1 demos are implemented; full automated checks and desktop/390px browser checks passed on 2026-10-03. DEC-049's review corrections (wrap minimum width, per-numerator beat groups, exact selection ends, nameplate accessibility) are implemented and the long-window chord demo was verified locally. Recurrence UI remains parked | Complete real MIDI-device, screen-reader and audible non-unit-rate seeking acceptance; do not treat local browser checks as device or acoustic evidence | [Analyze component design](design/ANALYZE-COMPONENTS.md), DEC-047, DEC-049 and owning Element/API pages |
| ANALYZE-01 | Deterministic regression cases cover key-profile rotations, triads and inference boundaries; empirical musical accuracy remains unmeasured | Evaluate an annotated real-music corpus with declared genres, ground truth, metrics and ambiguity policy before claiming accuracy percentages or calibrated confidence | [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md), [Analyze algorithm record](audits/2026-09-10/SCORE-HEADLESS-ANALYZE.md) |
| ANALYZE-02 | Elementary chord, interval and scale inspection now offer explicit written/sounding pitch basis, apply Part.transpose in sounding mode and retain notation/source evidence. Legacy key/chord segmentation, distributions, voice-leading, incremental sessions and their workers/projections still use stored written pitches | Extend the explicit pitch-basis contract and consistent normalization to those remaining legacy paths without changing the authored Score, double-transposing or overstating inference provenance; verify mixed piano/B♭ clarinet harmony and cross-part parallel-fifth fixtures | [API transposition finding](audits/2026-09-10/SCORE-API.md#open-transposing-instrument-contract), [public pitch basis](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#pitch-basis-and-transposing-instruments) |
| SCOREIO-01 | MIDI/MusicXML/ABC/MXL correctness repairs cover supported format subsets; full interchange and navigation fidelity remain limited | Define and test supported complex features before expansion: SMPTE timing, richer ABC syntax, cross-measure notation splitting and nested/alternative repeat routing. Preserve documented unsupported-input errors and lossy boundaries | [Score API review](audits/2026-09-10/SCORE-API.md), [IO detail](audits/2026-09-10/SCORE-API-IO.md), [repeat contracts](audits/2026-09-10/SCORE-API-MODEL.md) |
| DEV-05 | The [public asset inventory](../apps/doc/webmusic/ASSETS.md) lists nine site files; eight binary resources still lack verified redistribution terms. They are excluded from npm tarballs. Pages deployment is now an explicit manual dispatch; existing deployed files are unchanged | Confirm exact sources, authors, licenses, required notices and hashes, or replace the files before selecting `deploy_pages` or distributing a release containing them | [Development](DEVELOPMENT.md), [Contributing](../CONTRIBUTING.md) |
| TIME-02 | Native follower loops have explicit phase mapping; sample-accurate cross-domain group loop behavior still needs evidence and scheduler work | Verify next-pass scheduling before group boundaries and measure actual discontinuities; native loop metadata alone does not prove acoustic precision | Shared-clock design and Bridge |
| AUDIO-ANALYZE-01 | DEC-037 selects five live Analyze Elements: meter, level, spectrum, oscilloscope and transient. DEC-051 gives the meter seven type-selected canvas displays (VU, loudness, waveform, oscilloscope, spectrum, spectrogram, stereometer) with mono/colour themes and an owned stereo branch; unit coverage spans the reductions, painters, stereo-branch ownership and the element contract, and the 2026-10-08 browser check covered the demo's type/theme switching. Device, acoustic and calibrated-loudness acceptance remain | Verify exact five-tag canonical inventory and one idempotent legacy View meter alias; real player and explicit-analyser binding; meter tap and stereo-branch ownership, threshold/freeze/hold, spectrum probing, bounded oscilloscope trigger/timebase/probe and transient sensitivity/refractory behavior; pause/seek/end/source changes, graph loss and cleanup; normal/narrow layout, keyboard and device behavior. Distinguish the meter's windowed K-weighted estimate from gated EBU R128 loudness, sample peaks from true peak, FFT output from calibrated SPL, and transient cues from BPM or a beat grid. Verify beat-grid API/Headless output composed with `audio-view.regions` without a retired Analyze tag | [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md), DEC-051, owning Element/API/Headless pages |
| AUDIO-VIEW-02 | Live View retains a fixed number of caller-paced observations and paints them at equal spacing; `windowSeconds` is not a precise elapsed-time display at variable capture rates | Decide timestamp spacing versus an explicit fixed capture cadence; verify pause, background/foreground and high-refresh behavior without creating another playback clock | [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), owning live projection types and tests |
| DOC-02 | Headless demo/control catalog coverage remains partial; authored Related navigation is now the supported reference path | Implement missing object demos and catalog controls where meaningful, or document the input/environment needed to demonstrate them; validate options, commands, state, events, reset and cleanup against the authoring contract | [Headless template](docs/HEADLESS-PAGE-TEMPLATE.md) and source catalogs |
| DOC-04 | Public API and Headless completeness checks are narrower than the templates | Check actual member/reference ownership, types and target content where mechanical; retain manual review for semantics | Conventions and page templates |
| DOC-05 | Element/Headless/API page-shape and demo layout enforcement is incomplete | Define accepted exceptions, enforce applicable order/count rules, and align page-specific demo placement without breaking working demos | [Site plan](docs/DOCS-SITE-PLAN.md) |
| DOC-06 | The family start pages and the two form inventories are in place; `checkLinks` now rejects a repository link that only resolves through a redirect, but no check constrains the title or section shape of the two inventories, and the retired capability-Overview title rule was not replaced | Decide whether the inventories need a title/section-shape rule of their own, and whether the family element inventory's per-capability sections should be asserted the way its absence of demos already is | [Site plan](docs/DOCS-SITE-PLAN.md), [Conventions](docs/DOCS-CONVENTIONS.md), DEC-020 |
| VERIFY-01 | Source/package checks and dated browser evidence cover their stated scenarios; broader cross-browser/audio/MIDI/microphone acceptance, background timing and accessibility remain separate | Record actual environment, procedure and results separately; use the release gates for package delivery and device tests for acoustic/interaction claims | [Kernel release review](audits/2026-09-11/KERNEL-RELEASE.md), [Development](DEVELOPMENT.md), [Publishing](release/PUBLISHING.md) |
| RELEASE-01 | Shared `0.2.1` metadata, bundled notices and prepack guards are prepared with the review corrections. Registry queries confirmed all five packages at `0.2.0`; no `0.2.1` publication is claimed | Validate the exact prepared commit and its CI; when publication is requested, authenticate the publisher, publish in dependency order, verify registry installation, then tag the producing commit and record delivery | [0.2.1 preparation](release/0.2.1.md), [Publishing](release/PUBLISHING.md), [Releasing](release/RELEASING.md) |
| APP-01 | Score/Audio playback reference and independent-loop examples are implemented; workstation/project scenarios remain product goals | Use the reference to validate new capabilities before expansion; application project/undo/storage and installation deployment remain application-owned concerns | [Reference composition](../apps/doc/webmusic/src/content/docs/bridge/composition.mdx), [Product](PRODUCT.md), DEC-019 |

REPO-01 and DEV-06 are closed by the merged integration and successful remote CI
linked above. Their earlier failures and repairs remain in the
[local CI repair record](audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md).
The completed deployment does not resolve the separate DEV-05 asset evidence gap.

The prior dev-doc audit is [historical evidence](audits/2026-09-05/DEV-DOCS-REVIEW.md). Its stale-rule and ownership findings are addressed by this documentation reorganization. DOC-01's missing Headless reference sections have been completed: the leaf pages now have Import, grouped API, lifecycle/time responsibilities, and Related navigation, with public types routed through the family Headless inventory. This is source-based reference work, not proof from the value-name gate alone. Verification and the snapshot's limits are recorded in the [documentation reorganization record](audits/2026-09-05/DOCUMENTATION-REORGANIZATION.md); work requiring implementation or broader acceptance remains above.

The [code-alignment record](audits/2026-09-05/CODE-ALIGNMENT.md) records the
completed symmetric factory guards (TIME-03), expanded snippet checker and
explicit authoring boundary (DOC-03), and repairs to Score wrappers, Rack
effects and existing demo lifetimes. Missing Headless demo/catalog coverage
and the shared-clock protocol remain in the queue above.

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
owns the accepted responsibilities; VERIFY-01 and TIME-01/TIME-02 retain the
remaining device, browser and clock precision acceptance.

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
