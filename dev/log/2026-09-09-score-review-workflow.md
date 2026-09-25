# Score review workflow — 2026-09-09

This record describes the Analyze, View and Play review on
`claude/analysis-view-chord-design-693b7b`, in the
`.claude/worktrees/debug-branch-db7bf5` checkout. Existing uncommitted work was
preserved. The sequence below distills repeated user reviews and corrections
into a process for a future Audio task; it does not start Audio implementation.

**Play frontend verification reached source inspection and DOM tests only.**
No Play screenshots, rendered-layout, touch or real-device acceptance were
completed. Earlier Analyze/View browser probes do not establish Play acceptance.

## Owners and evidence

Use [Product](../PRODUCT.md), [Design principles](../DESIGN-PRINCIPLES.md),
[Architecture](../ARCHITECTURE.md) and [Development](../DEVELOPMENT.md) as current
guidance. The [component design template and lifecycle matrix](../design/COMPONENT-DESIGN.md)
own design questions; [Decisions](../DECISIONS.md) records accepted choices.
[STATUS](../STATUS.md) owns current gaps; this log does not reproduce its queue.

Resulting contracts belong to [Analyze](../design/ANALYZE-COMPONENTS.md),
[View](../design/VIEW-COMPONENTS.md), [Play](../design/PLAY-COMPONENTS.md) and
[player binding](../design/PLAYER-BINDING.md). The dated
[Play implementation audit](../audits/2026-09-09/SCORE-PLAY.md) and
[frontend source audit](../audits/2026-09-09/SCORE-PLAY-FRONTEND.md) hold verification
results. Their totals are not a current capability inventory. Temporary local
screenshots are not durable, portable acceptance evidence.

## 1. Decide responsibilities and simplify components

Read each user task together with its Element, domain behavior, presenter,
exports and demo. Compare data, state and resource ownership before grouping tags.

- Analyze extraction evolved from an omnibus workbench into five distinct tasks:
  progression, current chord, key changes, Roman harmony and voice leading.
  Whole-score summary, distribution and rhythm reports remained in existing
  API/Headless workflows; retiring tags did not move DOM into Headless.
- View grouped representations sharing input/lifecycle into `score-view` and
  `pitch-view` types. `sheet-view` retained its separate engraving lifecycle.
  A static thumbnail remained appropriate to View; Analyze's live-only selection
  rule was not imposed on every capability.
- Play retained transport, mixing, performance input, capture and sound editing
  as distinct roles, plus its nonvisual rack-part declaration. Shared transport
  behavior did not justify an omnibus Play component.

**Deliverable and acceptance:** a responsibility table, retain/merge/remove
reasoning and migration map. Verify real lifecycle differences; align exports,
registration, policies, catalogs and navigation without duplicate runtime tags.

## 2. Inspect algorithms and external comparisons

Trace normalization, matching/estimation, ranking, units and boundaries. Use
small reproducible inputs, expected outputs, ambiguous cases and counterexamples.
The live-chord comparison inspected Chordcat at
[commit 863c147999266b26ec06058c7766d5830b561fd6](https://github.com/shriramters/chordcat/tree/863c147999266b26ec06058c7766d5830b561fd6),
including finite templates, matching and MIDI state. Its scope does not make it
an oracle for key, Roman or voice-leading analysis. Repository reputation,
agreement or template self-consistency cannot establish an accuracy percentage.
Reference code/probes stayed outside WebMusic source.

View investigation measured simultaneous note positions and scrolling across
staves. A shared quarter-note axis and exact nominal-time active intervals fixed
alignment; they did not establish complete engraving fidelity. Quantization,
inferred-clef and changing-meter limitations remained explicit.

**Deliverable and acceptance:** source/version provenance, assumptions,
reproducible probes, counterexamples and evaluation limits. Separate contract
correctness from empirical quality on a representative, documented dataset.

## 3. Verify state, time and resources

Map producer → API/Headless state → binding → presenter. Name the clock owner;
a shared AudioContext alone does not establish a common transport epoch.
Score follower work made source precedence, initial snapshots, late/replaced
selectors and cleanup explicit for supported modes. Nominal seconds, transport
seconds and quarters remain distinct, particularly when seeking at non-unit rate.

Regression cases included suspended clocks and reentrant transport commands;
FIFO recorder unisons and source replacement; canceled capture versus completed
takes; atomic Synth DSP replacement, stable/dormant ports and stale parameter
failures; and OSMD reverse seek after reset replaces its iterator. Queued cursor
scrolls must also stop when following is disabled or the active cursor clears.

**Deliverable and acceptance:** units/ownership tables and lifecycle regressions
covering loading cancellation, replacement failure, stale completion, reentrancy
and repeated disposal. Check observable effects and preserve borrowed resources.
Do not infer a uniform Rack/controller snapshot from a `player` attribute.

## 4. Reuse UIKit and review container layout

Keep domain algorithms/time out of UIKit and drawing/DOM out of Headless.
Elements use existing presenters through public options, tokens, parts and handles.
Analyze/View leaf demos isolate the current component and required player/data
owner; optional multi-component arrangements have an explicit composition example.

Put configuration in external Parameters while retaining direct musical actions
on their surfaces. Show only effective type-specific settings, preserve hidden
configuration values, and verify instance targeting, Copy and Reset.
Test the assigned container width in block, flex and grid embedding. Public hosts
must honor `hidden` and shrink without relying on demo CSS. Readable keys, notes
or engraving may need local scrolling instead of indefinite scaling.

Score examples include Sheet's independent minimum drawing width/paper color,
plot readouts moved below envelope/EQ SVGs, and pointer coordinates remaining tied
to the plot. EQ native ranges became focusable with band/axis and physical-unit
feedback. Knob groups and macro labels wrap; explicit legacy Synth theme values
still win, while unset legacy values allow inherited UIKit themes through.

**Deliverable and acceptance:** presenter-reuse map and responsive/interaction
matrix. DOM tests can establish bindings, focus state and coordinate calculation;
rendered clipping, contrast, touch and screen-reader behavior need separate evidence.

## 5. Use real demos and distinguish evidence

Choose fixtures that exercise the result. A mostly monophonic MIDI example was
replaced by an original MusicXML block-chord progression for live chord naming;
parsed simultaneous notes and recognized chords were checked. Staff's default
uses an existing public MusicXML fixture with source staff structure.
Synth's selectable sections received real effect/EQ/LFO/macro wiring, while its
initial display remains sound/envelope. Its demo oscillator applies attack/release
only; editable decay/sustain values do not prove those stages are audible.
Demos own their routing, async input guards, resources and cleanup.

| Evidence | Record | Does not establish |
|---|---|---|
| Source/probe | Ref, paths, input/units, expected/actual result, counterexample | General algorithm accuracy or rendered appearance |
| Unit/DOM | Reproduction, operation order, state/resource assertions, command result | Browser layout, touch or audible latency |
| Browser | Browser/version, container/theme, actions, screenshots and measurements | Every device or accessibility environment |
| Audio/device | Backend/device, permission path, measurement method and result | Other devices or background conditions |
| Integration gates | Exact commands, source revision, outcome and artifact location | Unrun manual acceptance |

For moving views, capture time samples, note/playhead coordinates and scroll
offsets alongside screenshots. Include pause/seek, empty/error, two instances,
source replacement, dark embedding and keyboard focus. Play's browser tool was
unavailable: source/DOM progress continued, but an unrun alternative browser path
was not claimed as acceptance. Preserve this boundary when applying the process.

## 6. Reconcile documentation and integrate

Use the owning [Element](../docs/COMPONENT-PAGE-TEMPLATE.md),
[Headless](../docs/HEADLESS-PAGE-TEMPLATE.md), [UIKit](../docs/UIKIT-PAGE-TEMPLATE.md) and
[API](../docs/API-PAGE-TEMPLATE.md) templates. Align migrations, runnable examples,
catalogs and Parameters with real attributes, defaults and effective modes.
Freeze writers before coordinated builds: package builds replace `dist/` used by
snippets and the site. Run `docs:sync`, the required `check`, and `docs:build`
under current Development instructions; preserve unrelated work during conflicts.
The merge handoff records source/target revisions, included changes, checks and
conflict resolutions, then verifies resulting Git history and target state.
A local merge proves neither remote publication nor missing browser/device
acceptance. This workflow record itself is not evidence that a merge occurred.

## Integration record

The integration combines main `364adf04626c585e990d89c7cf6d1599259224fd` with
the review snapshot `bc91f1747bc1aa828f1759be47c796db38c54e92`. Conflicts were
resolved in an isolated checkout before advancing local main.

- Main's canonical `score-player` and the `simple-score-player` compatibility
  subclass share one implementation. Rack identity/effect handling and Synth's
  LFO, ranges and transactional graph safeguards remain intact.
- The integrated Synth contract retains main's stable input/output dry bypass
  when DSP is disabled. Earlier review evidence about dormant ports describes
  the source branch; [DEC-016](../DECISIONS.md)
  and the [Play contract](../design/PLAY-COMPONENTS.md) explain the reconciliation.
- UIKit integration preserves instance isolation and reentrant Stage cleanup.
  Sheet's minimum drawing width and follow scrolling use the same scrollport.
  Demos retain main's property editors, lifecycle cleanup and dynamic Reset
  alongside the reviewed Parameters, Copy and responsive component changes.
- On Node `22.14.0` / npm `10.9.2`, `npm run check` passed, including 241 test
  files / 3,035 tests, 238 documentation examples, architecture, licenses,
  package exports and release manifests. `npm run docs:build` also passed,
  producing 121 pages. The build's unset-site sitemap warning does not affect
  local page generation. Final log edits and duplicate-script cleanup were
  followed by the format, lockfile and documentation gates again.

The original main checkout also contained 162 paths of unrelated draft work,
including documentation navigation and clock/binding changes. Those drafts
remain uncommitted in the original directory on `codex/main-drafts-20260909`,
at their original baseline. Their file contents and staged/unstaged changes
are preserved rather than replayed over retired components. Integrated main
uses `.claude/worktrees/main-score-review-20260909`. This separation is a local
worktree arrangement, not an additional product contract or a remote push.

The user subsequently requested committing the preserved main work as well.
That follow-up and its final checkout arrangement are recorded in the
[main work integration log](2026-09-09-main-work-integration.md); the paragraph
above describes the first handoff only.

## Copyable Audio execution brief

~~~text
Review the agreed Audio capability in the agreed checkout; preserve dirty work.
1. Read current owners, STATUS, decisions, scripts and actual public types.
   Inventory task/data/resource differences; propose bounded component changes.
2. Trace algorithms and units. Pin references; make reproducible probes and
   counterexamples. State scope and quality limits without invented accuracy.
3. Implement accepted contracts with explicit state/time/resource ownership.
   Regress cancellation, replacement failure, stale completion and cleanup.
4. Reuse UIKit; check container width, readable geometry, focus, theme and hidden.
   Keep configuration in external Parameters; verify mode/instance, Copy, Reset.
5. Wire real supported demo paths. Record source, DOM, browser and device evidence
   separately; state exactly which environment was unavailable or untested.
6. Align owning docs, policies/catalogs and dated evidence. Freeze, run required
   gates and prepare authorized integration with actual revisions/results.
Do not copy Score's catalog, invent Audio APIs or start unrelated implementation.
~~~

Resolve these domain differences from Audio source/types before implementation:

| Dimension | Questions |
|---|---|
| PCM/sample rate | Representation/range; copy, borrow or transfer; decode/resample owner? |
| Time/samples | Frames, samples, seconds or window centers; rounding, offsets, latency, rate and endpoints? |
| Amplitude/dB | Amplitude or power; reference such as dBFS; peak/RMS, silence floor, clipping and aggregation? |
| Windows | FFT/window/hop, window function, resolution, padding, causal delay and streamed versus whole-clip output? |
| Channels | Select, preserve or downmix; rule and phase-cancellation effects? |
| Permissions/resources | Contexts, streams/tracks, workers/worklets and buffers; denial, removal, suspension and disposal? |
| UI axes | Time/sample and frequency/amplitude mapping, zoom/pan, dB labels and channel readability? |
| Cross-domain | Does reusable Score interpretation/conversion belong in Bridge, with stated assumptions? |

Use known tones/impulses, silence, boundaries and channel differences where
relevant. Keep deterministic signal checks, listening judgments and permission/
device tests separate. The workflow transfers; the model and expected data do not.
