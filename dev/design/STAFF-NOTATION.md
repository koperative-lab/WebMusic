# Scrolling staff notation

Status: the scrolling backend and the supported timed-notation, expression
and PDF-driven layout corrections passed the automated and Chrome checks
recorded below. Broader engraving coverage and browser/accessibility acceptance
remain open; this is not full MuseScore parity.

Layer and public entry: Score View core projection and browser `/render`
adapter, composed by `<score-view type="staff">`.

Related decisions: DEC-015, DEC-024.

Source and public types: [notation projection](../../packages/score/src/view/core/staff-notation.ts),
[beam grouping](../../packages/score/src/view/core/staff-beaming.ts),
[timed notation model](../../packages/score/src/core/model/notation.ts),
[slur/tie geometry](../../packages/score/src/view/render/renderers/staff-curves.ts),
[expression drawing](../../packages/score/src/view/render/renderers/staff-directions.ts),
[SVG renderer](../../packages/score/src/view/render/renderers/staff.ts),
[renderer options](../../packages/score/src/view/core/types.ts).

Owning reference page and demo: [ScoreView](../../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx),
[View API](../../apps/doc/webmusic/src/content/docs/score/api/view.mdx),
[MusicXML demo](../../apps/doc/webmusic/src/components/ScoreViewDemo.astro).

## User task and boundary

A developer supplies a Score or attaches a view to a player and obtains readable,
scrolling notation: written note values, beam groups, tuplets, rests, voices,
timed clefs, supported expressions and measure boundaries. The existing `staff` type owns this result; no
additional Element, renderer-selection option or embedded control is needed.
`sheet-view` retains its separate optional OSMD page-engraving workflow.

The previous renderer reduced notation to pitch and quantized note lengths.
It could not reconstruct the source's written eighth-note triplets or clefs
from that reduced input. Adding beams to those already incorrect glyphs would
leave their rhythm, voice and staff interpretation wrong.

## Composition

MusicXML/MIDI/ABC import or application construction produces an immutable
Score. An internal pure projection reads its written notes and measure grid;
an independent beam-grouping function reads written rhythm. The `/render`
adapter uses VexFlow 4.2.5 for SVG notation glyphs, stems, beams and tuplets.
Independent helpers pair source slurs/ties and calculate their tapered curves;
the browser adapter supplies actual glyph bounds and draws the resulting paths.
The Element mounts that renderer in the shared UIKit Stage.

The existing Headless ScoreView and cached sounding-note sequence remain the
playback/activity path. Staff engraving additionally reads the original Score
because a sounding-note sequence omits rests and much of the written notation.
This projection creates no DOM and does not introduce another musical model
or transport. Follow [player binding](PLAYER-BINDING.md) for source precedence,
initial snapshots, replacements and borrowed lifetimes.

## Inputs, outputs, and units

| Item | Type/unit | Default/empty state | Limits | Owner |
|---|---|---|---|---|
| Written notes | `Note`, `Duration`, rational quarter positions | Supplied by Score | Import fidelity applies before rendering; unsupported durations require a readable fallback | Score Core and I/O |
| Measures | Stored onset, duration, meter and key | Generate missing measures from the TimeMap; initial meter 4/4 | Projection is bounded; overlapping or unsupported source structure produces internal diagnostics | View core |
| Layers and voices | Part, staff and string voice identity | Source staves retained; `splitStaves: false` combines staves inside each part | Combining staves does not merge parts or rewrite source voices | View core |
| Clefs | Part `clefChanges` at rational quarters; legacy Measure `clef` / `clefs` | Carry forward authored declarations, including changes within a measure | Infer only for a staff without source clefs; never replace an authored clef just because ledger notes are high or low | Score Core and View core |
| Expressions | Part `directions` at absolute rational quarters | Words, rehearsal marks, dynamics, metronome marks, pedal and wedge endpoints; omitted staff means staff 1 | Supported source placement, visibility and offsets are retained; this is not the complete MusicXML direction vocabulary | Score Core and I/O, View core and render adapter |
| Beam groups | Written base, duration, tuplet ID and optional source beam marks | Automatic metric grouping | One staff, voice and measure per group | View core |
| Drawing | SVG, pixel dimensions | `noteHeight` remains 6 px | Width includes space required by accidentals, flags and other glyphs | Render adapter |
| Activity and cursor | Note IDs and nominal seconds | No highlight without position; half-open sounding spans | Playback rate does not change written positions | Borrowed playback and Headless state |

The notation projection retains stored `Rational` onsets and durations; it does
not round them through seconds or a 1/16-quarter grid. Sounding/performed timing
does not determine the written glyph. Source rests, hidden spacing notes,
spelling, voices, beam marks, tuplet ratios and up/down stem choices survive the
projection. Exact supported duration fragments crossing a measure boundary
are drawn with ties without changing the source Note.

Each projected event carries the clef effective at its exact onset. The layer
retains the complete source clef and direction streams, and each measure also
exposes its starting clef and local changes. End-position direction marks are
retained so a final pedal or hairpin can close. MusicXML offsets become absolute
quarter positions; engraving offsets retain MusicXML tenths. Written `rit.`
or `cresc.` text does not itself create a playback tempo or velocity command.

For MIDI/application notes without source clefs, a separate inference helper
balances ledger-line cost against a change penalty and sustained register.
Changes require a suitable rhythmic boundary and avoid continuing ties, beam
groups and tuplets. These independent heuristics improve readability but do
not recover the composer's intended notation. An explicit per-part clef stream
takes precedence over the legacy measure fields, including an empty stream
that prevents borrowing another part's clefs.

## State and commands

The renderer is synchronous. The existing `redraw`, `redrawAtTime`,
`clearActiveNotes` and `dispose` handle remains authoritative. No beam-editing
command or notation-editor state is added. Applications edit or replace their
Score, then let the existing view replacement path create a new drawing.

Type or source replacement releases the previous drawing and keeps playback
with its owner. Loading, cancellation, retry and accessible failure feedback
continue to belong to the Element and its existing source loader. Repeated
disposal is safe; callbacks from a released renderer cannot reclaim the host.

## Session time

Notation is a static projection and a passive playback follower. All staff
layers align the same written onset columns and share a scroll position and
playhead. Nominal seconds pass through the complete tempo map and interpolate
between engraved onset positions. Changes of tempo or playback rate do not
turn a written triplet into a different note value.

Page, note and bar following retain their public modes. Manual panning and
`redrawAtTime(time, false)` do not request following. Resizing retains the latest
position and applicable following intent. No player, clock or scheduling
resource is allocated by the renderer.

## Interaction and visuals

VexFlow supplies the glyph geometry and beam/stem layout. WebMusic supplies
measure-aware grouping, source identity, aligned onset columns, compact staff
spacing, fixed signatures, clipping, coloring and playback positioning.
Source beam begin/continue/end marks override automatic groups. Automatic
groups stop at rests and temporal gaps, retain separate voices, and distinguish
simple, compound and additive meters. Supported source secondary breaks and
hooks refine the same group.

Tuplet ratios and source group IDs drive numbers and brackets. Source bracket,
above/below and `showNumber` preferences apply when available; hiding a number
does not remove its notes, beam or an explicitly requested bracket. A complete
beamed group normally needs only its number. Ties and numbered slurs use source
relationships rather than guessing from nearby pitches. Their independent
geometry considers noteheads, stem tips, voice side, authored placement and
interior ink; compact spacing must use the curve's local occupied shape rather
than treating its entire bounding rectangle as solid ink.

Timed clefs are drawn at their written positions, including silence gaps, and
the fixed header uses the clef at the visible position. Key and meter changes
follow the stored measure grid. Braces and connected barlines group staves
belonging to one part. Pedal and wedge endpoints pair across measures; hairpins
leave room for adjacent dynamics. Expressions retain their source staff and
above/below side, so a grand-staff pedal can correctly appear between staves.

The host remains shrinkable and wide notation scrolls within the stage.
Staff packing measures offscreen glyphs and curves as well as visible ones.
Sloping beams and curves contribute narrow ink strips instead of solid bounding
rectangles. Adjacent pedal spans reserve separate sign and line space, avoiding
cumulative downward displacement while preserving their source staff.
Existing public note/active-note colors, host size and UIKit frame tokens
remain the customization surface; VexFlow's private SVG selectors are not a
public contract. The timeline uses native horizontal scrolling, and the staff
adds no editing or playback controls. Keyboard access and accessible music
reading require separate acceptance.

## Resources and failure

| Resource | Ownership and release |
|---|---|
| Source Score, player and clock | Borrowed; never disposed or mutated by the view |
| Derived projection and glyph objects | Owned by the renderer; replaced with the drawing |
| SVG, fixed header and playhead | Owned by the renderer; removed on disposal or failed construction |
| Scroll listener and resize observation | Owned; detached during disposal |
| VexFlow | MIT-licensed runtime dependency of the browser render path; no caller-installed optional engine required |

Core/API/Headless must not import VexFlow or SVG implementation. Public render
factories pass the original Score to the staff adapter. A direct legacy
sequence constructor remains a lossy compatibility path: without the original
Score it cannot recover source rests, spelling, tuplets, authored beams or
clef changes. Its durations retain their timeline positions while glyphs may
use a nearest readable value. MIDI without written notation has the same
inference boundary.

## Composition, extension, and compatibility

`<score-view type="staff">` and `renderStaffVisualizer` retain their names,
source/player binding and options. Default spacing is notation-aware; a positive
`pixelsPerSecond` requests rhythmic space using the initial tempo, with extra
width when glyphs need it. It is not an exact linear pixel/time ruler.
`defaultKey` is a chromatic major-key index, C = 0, rather than a fifths count.

The new path is conventional scrolling notation, not MuseScore page-layout
parity or a notation editor. Cross-staff and cross-measure beams, nested tuplet
layout, complete grace-note engraving, lyrics, the full expression vocabulary,
font fidelity and page/system justification remain outside the supported staff
surface. The PDF comparison below distinguishes missing data from drawing
limits; supported articulations, bar styles, positioned rests and cross-staff
slurs use the original notation metadata. Retaining metadata does not establish that every stored
mark is drawn. OSMD remains available for page engraving; its import and
conversion limits remain separately documented.

## Upstream comparison

Reference inspection used MuseScore revision
[`480c923626df6093e67bae05b8e2fbbe22bcabd7`](https://github.com/musescore/MuseScore/tree/480c923626df6093e67bae05b8e2fbbe22bcabd7).
This is a behavioral comparison, not a source translation. MuseScore's GPL
implementation is not included in this package.

| Reference | Observed rule and WebMusic alignment |
|---|---|
| [Meter groups](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/dom/groups.cpp#L53-L258) | Use written duration and measure-relative position; respect authored beam modes. Plain 4/4 eighths can group by half-bar, shorter subdivisions change the boundary, and compound meters use dotted beats. WebMusic implements these grouping behaviors independently. |
| [Beam construction](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/rendering/score/beamlayout.cpp#L622-L804) | Construct groups per track and measure, with explicit treatment of rests and grace notes. WebMusic isolates voices/staves; cross-measure joins and complete grace beaming remain unsupported. |
| [Beam geometry](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/rendering/score/beamtremololayout.cpp#L602-L788) | Stem clearance, interior notes and endpoint constraints affect slope. WebMusic delegates geometry to VexFlow, whose heuristics differ; matching group membership does not imply identical slopes or collision decisions. |
| [Tuplet brackets](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/dom/tuplet.cpp#L204-L270) | Beam structure can replace a bracket when it identifies the complete tuplet. WebMusic preserves simple group ratios, source bracket preferences and number visibility; nested and cross-staff layouts are not equivalent. |
| [Timed clefs](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/dom/staff.cpp#L382-L432) | Read an authored clef map before applying an instrument default. WebMusic preserves an absolute per-part/staff clef stream and applies it at each written onset, including mid-measure changes. |
| [MIDI clef inference](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/importexport/midi/internal/midiimport/importmidi_clef.cpp) | Clef inference considers register, ledger lines and the cost of changing clef. WebMusic implements a separate bounded heuristic only when source clefs are absent; its thresholds are not claimed to match MuseScore. |
| [Slur/tie layout](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/rendering/score/slurtielayout.cpp) | Endpoints, stem direction, multiple voices, curvature and collisions have separate roles. WebMusic independently pairs source relationships and solves tapered curves using glyph bounds; its layout is not a translation of MuseScore's engine. |

Upstream [beam tests](https://github.com/musescore/MuseScore/blob/480c923626df6093e67bae05b8e2fbbe22bcabd7/src/engraving/tests/beam_tests.cpp#L64-L158)
include glyph-position and stem-direction fixtures but also disabled
cross-measure cases. Their existence is not local verification. WebMusic uses
independent fixtures and tests its own implemented behavior.

## PDF comparison

On 2026-09-11, all ten pages of the maintainer-supplied `demo.pdf` were inspected
against the repository's [107-measure MusicXML demo](../../apps/doc/webmusic/public/xml/demo.xml)
and the model/import/render paths. The PDF was exported by MuseScore Studio
4.7.4; the XML identifies MuseScore 3.5.2 and a 2020 encoding date. Its explicit
page breaks at measures 21, 43, 69 and 91 differ from the PDF's reflow. This
comparison verifies which notation is present, not pixel or page-layout parity.

| Present in the PDF | Source and implementation finding | Acceptance boundary |
|---|---|---|
| Written notes, chords, rests, beams, triplets, key/meter and clef changes | The XML has 1,615 notes/rests, 23 clef declarations and authored voice/staff/beam/tuplet data. Written-time projection and timed clef drawing consume that data. | Cross-staff beam joins and complete nested-tuplet/grace engraving remain outside the supported subset. |
| Tempo/expression words, dynamics, pedals and hairpins | All 442 XML directions belong to the supported vocabulary: 87 words, 50 dynamics, 212 pedal endpoints and 93 wedge endpoints. | Import/projection and drawing are implemented. Browser checks cover the complete source and representative pedal/dynamic/tempo passages; this does not establish every possible mark collision. |
| Staccato, tenuto and accents | At inspection, the importer dropped 30 XML articulations although Note already had an articulation field; the renderer did not draw them. Staccato occurs in measures 35–36; tenuto in 16, 42, 58, 75, 86 and 106; accents in 53–54. | All 30 source marks survive import/export and are drawn. The supported vocabulary also includes marcato and staccatissimo; individual source articulation placement is not retained. |
| Double and final barlines | XML specifies `light-light` at measures 38 and 70 and `light-heavy` at 107; the initial model/import/render path reduced these to ordinary bars. | All three source styles survive import/export and are drawn consistently across the grand staff. Other supported MusicXML bar-style values use the same boundary renderer. |
| Cross-staff beams and slurs | Voice/staff and source endpoints exist. Cross-staff beams are visible in measures 31, 33, 95, 97, 98 and 103. | Per-staff beam grouping cannot reproduce these beam joins. Slurs now pair across the complete Part and draw after staff placement; repeated slur numbers no longer leave stale cross-staff starts. This bounded collision solver is not full engraving parity. |
| Positioned rests | XML specifies one E4 rest position in measure 28 and two F5 rest positions in measure 89. | All three positions survive import/export as `Note.restDisplay` and set rest glyph height without changing sounding pitch. |
| Title, subtitle, composer, instrument label and measure numbers | XML has `work-title`, `creator`, credits, `part-name` and measure numbers. The inspected parser only reads `movement-title` for the title and omits the other credits; part name and measure numbers survive but are not drawn. | Full metadata/credit import and presentation are not part of the current scrolling surface. |
| Parenthesized pedal continuations, cautionary signatures, page numbers and page/system layout | PDF line breaks generate continuation/courtesy marks. The XML contains no independent `(Ped.)` text or pedal-parenthesis field. | These are page-layout behaviors, not missing pedal events; the scrolling renderer does not reproduce the PDF's pagination. |

The pedal at quarters 128–133 and 133–144 (measures 33–36) belongs to staff 1
and is visibly between the two staves in the PDF. At quarters 144–152
(measures 37–38), it belongs to staff 2 and is below the complete grand staff.
Compact packing must preserve this distinction; moving every pedal to the
bottom would contradict the source. The PDF contains no lyrics, trills or
repeat/volta passages, so it cannot establish support for those categories.

## Acceptance

Automated coverage belongs to [notation projection tests](../../packages/score/test/view/staff-notation.test.ts),
[beam grouping tests](../../packages/score/test/view/staff-beaming.test.ts),
[timeline tests](../../packages/score/test/view/staff-timeline.test.ts),
[highlight tests](../../packages/score/test/view/staff-highlights.test.ts),
[system tests](../../packages/score/test/view/staff-system.test.ts),
[staff-splitting tests](../../packages/score/test/view/staff-splitting.test.ts) and
[MusicXML notation tests](../../packages/score/test/io/musicxml-notation.test.ts).
Later regression coverage is maintained in
[timed model tests](../../packages/score/test/core/timed-notation.test.ts),
[MusicXML direction tests](../../packages/score/test/io/musicxml-directions.test.ts),
[expression/timed-clef tests](../../packages/score/test/view/staff-expressions.test.ts),
[curve tests](../../packages/score/test/view/staff-curves.test.ts) and
[spacing tests](../../packages/score/test/view/staff-spacing.test.ts) and
[engraving regressions](../../packages/score/test/view/staff-engraving-regressions.test.ts).

The earlier 2026-09-11 backend acceptance, before the timed-expression and PDF
corrections, completed `npm run check`, including
1,961 Score tests. Regression coverage verifies exact written triplets and
dotted values, rests and hidden notes, named voices, source clefs, note identity,
authored/automatic beam groups, rest interruptions, mixed subdivisions and
compound meters. It also covers pickups and variable measure lengths,
cross-staff onset alignment, supported tied fragments, mixed-value tuplets,
shared-stem/beam highlighting, source replacement, scrolling, resize and
disposal. These tests exercise the implemented subset; they do not assert
MuseScore engraving parity.

For that baseline, an isolated Chrome CDP session verified the piano MusicXML demo on
`/score/element/view/score-view/`:

- The drawing contained 321 beam groups, 236 tuplet groups and 1,545 noteheads.
  First-measure triplet onsets retained exact thirds, and both initial source
  clefs were treble. Beams, tuplet marks and ordinary slurs were visible.
- Playback and nominal seeking updated note highlights. Seeking to 90 seconds
  followed the score, and returning to zero restored the beginning.
- A 390 px viewport had no page-level horizontal overflow; notation remained
  inside its scrolling surface. The drawing also worked with `noteHeight: 9`,
  after hidden-to-visible layout, and when disabling and restoring staff
  splitting.
- Light and dark rendering, individual overrides of all five public background
  tokens, and transparent composition passed actual browser assertions.

The later 2026-09-11 timed-notation and PDF corrections passed `npm run check`
with 2,022 Score, 572 UI, 111 Kernel and 63 documentation-app tests, followed by
`npm run docs:build` with 69 pages. New regressions cover exact mid-measure clefs,
header changes, no-source clef inference, immutable metadata/edit/repeat/JSON
preservation, direction spans, hairpin/dynamic clearance, hidden tuplet numbers,
full-Part slur pairing, source articulation/barline/rest placement and packing
that preserves the notehead size.

Final isolated Chrome checks on the complete demo established:

- All 209 authored slur starts and 209 stops pair into 209 relationships,
  including 14 cross-staff slurs. Repeated starts on one note retain both curves;
  no stale start produces a many-measure false tail.
- The drawing has 321 beam groups, 50 visible tuplet groups, 1,545 noteheads and
  264 tie/slur paths. Source number visibility accounts for the change from the
  earlier 236 tuplet groups. All 442 directions and the 30 articulations, three
  special bar styles and three rest positions survive MusicXML round trips.
- At the same 6 px `noteHeight` and desktop viewport, the complete component
  height fell from 394.2 px before packing repairs to 336.2 px, about 15 percent.
  This includes the restored long slurs; glyph size is unchanged. Actual SVG
  bounds show no vertical ink clipping. Staff-1 pedals at quarters 128–144
  remain between staves, and staff-2 pedals remain below the grand staff.
- Representative clef, tempo, articulation, pedal and final-bar passages were
  inspected. Light/dark themes and a 390 px viewport passed overflow checks.
  Seeking to 90 nominal seconds updated five active noteheads and followed the
  timeline; returning to zero restored the beginning.

These results validate the supported subset, not every source-specific
collision or MuseScore's complete engraving system.

Cross-browser, accessibility and audible-synchronization acceptance remain
separate from these Chrome checks. Current remaining work belongs to
[STATUS](../STATUS.md#current-work-queue); the supported subset and PDF findings
above retain their engraving and page-layout boundaries.

## Documentation delivery

The Element page owns behavior, attributes and styling; the View API owns render
handles/options and the distinction between notation and sounding sequences.
The Headless page retains its code-only state contract and directs drawing to
`/render`. The existing MusicXML demo proves the primary source/player/view
composition. Core and I/O references own notation metadata and interchange
limits rather than duplicating their complete member tables here.
