# Score View component families

> Current design, accepted in DEC-015 and refined for staff notation in DEC-024. Source and public leaf pages own exact
> members; STATUS owns delivery and verification gaps.

## Purpose and boundaries

View components offer alternative representations of the same input. A type
selects one surface within a family; it does not assemble several surfaces or
create playback. Applications compose several instances around one player when
they need simultaneous representations.

| Component | Input and task | Types |
|---|---|---|
| `score-view` | A complete Score, optionally with a borrowed playback position | `piano-roll`, `staff`, `waterfall`, `map`, `thumbnail` |
| `pitch-view` | Currently held MIDI pitches from one selected note source | `keyboard`, `staff`, `fretboard` |
| `sheet-view` | Page engraving using an optional OSMD renderer | Separate engraving lifecycle; no type selector |

Score staff includes musical time. Pitch staff depicts only sounding notes.
Map is a whole-score navigation surface. Thumbnail is a static, fitted preview;
it does not acquire the full visualizer or expose seeking just because another
type supports it. Page engraving remains independent because its optional
engine, injection points and asynchronous layout differ from the scrolling
staff renderer.

## Data, time and state

ScoreView preserves `.score`, then `src`, then player-data precedence. Switching
types changes presentation of the resolved score without fetching it again or
restarting its player. The shared core `ScorePlaybackSource` initializes data,
readiness, nominal position and active occurrences; legacy event targets remain
available when native observation is absent or reports `unavailable`.
Map converts its quarter-note axis through the score TimeMap; seeks use the
source's nominal command or the legacy owner's declared command/rate mapping.
The committed cursor comes from the owner's resulting position, including loop
wrapping. Stale failures cannot overwrite a newer cursor or replacement owner,
and a view with a different explicit Score cannot seek the native owner.

`configure(ScoreViewConfiguration)` validates the three full-renderer modes and
their compatible option keys before replacing them atomically. The lightweight
map/thumbnail modes retain their Element type/attribute/property interface;
they do not expand the render entry's mode union. SheetView retains its separate
explicit-data and event-following contract.

PitchView keeps one ActiveNoteTracker and one binding while switching types.
Duplicate held pitches retain their counts; note-off, stop and replacement clear
only the state specified by the existing input contract. Instrument, range and
spelling options project that state without changing the source or playing notes.

Full-score renderers can project nominal seconds directly with `redrawAtTime`.
Sounding spans use a half-open interval: onset is active, end is inactive.
Staff parts share written-onset columns, a scroll position and playhead;
separate compact layouts cannot establish cross-staff alignment. The cursor integrates
the complete tempo map, including beat units. Staff rendering preserves source
staff assignments within each part by default. The external `split-staves`
setting can combine those staves for display without merging parts, mutating
the source score or restarting playback. MusicXML is a supported source for
this structure; the default demo uses the existing two-staff piano XML fixture.
Staff notation reads the original Score's rational written time, rests,
spelling, voices, measure boundaries and authored clefs rather than recovering
them from a sounding-note sequence. Part `clefChanges` carry exact positions,
including changes within a measure; each note and the fixed header use the
effective source clef. Readability inference applies only to a staff without
source clefs and avoids changing clef inside a continuing musical group.
Part `directions` preserve timed text, dynamics, metronome, pedal and wedge
marks, including their source staff and supported placement/visibility fields.
Text such as `rit.` remains notation rather than an invented playback command.

The core projection and beam grouping stay DOM-free; the browser adapter uses
VexFlow for glyphs, stems, beams and tuplets. Independent slur/tie helpers pair
source endpoints and calculate tapered curves from actual glyph geometry.
Source beam marks take precedence over automatic metric groups, and source
tuplet bracket/number visibility applies to the drawing. The supported subset
does not imply cross-staff beam layout, complete expression/font fidelity or
a notation editor and page-layout engine. Full-part curve pairing, supported
articulations, bar styles, rest positions and compact packing passed the
automated and Chrome checks recorded in the staff contract.
The [staff contract](STAFF-NOTATION.md) owns the inspected MuseScore comparison,
resource boundary, MIDI fallback, the ten-page PDF comparison and remaining
notation limits.

The staff drawing connects the system start and groups staves within the same
part with a brace and continuous barlines. Active state covers noteheads and
their shared stems, flags and beams, retaining a shared glyph while any associated
note sounds. The styled Element reads its specific `--wm-score-view-active-note`
token, then the shared `--wm-accent`, then its existing red default. The
imperative renderer keeps its separate neutral defaults. One full-height divider bounds the fixed signature area;
scrolling notes are clipped at that boundary instead of covering signatures.
These visual connections and clipping add no controls.

## Interaction and presentation

Each instance mounts only its selected surface. The Element has no type switch,
settings toolbar, extra keyboard or embedded player. Parameters belongs to the
documentation/application and shows the options relevant to the selected type.
Changing type preserves other attribute values, so returning to it restores its
configuration. Copy includes the player connection; Reset restores the initial
attributes of both displayed elements.

UIKit owns the shared pitch, stage and timeline presentation. Score owns score
layout, pitch spelling, instrument projection and renderer adapters. Hosts fit
their container, may shrink in flex/grid layouts, honor native `hidden`, and
permit application CSS overrides. Wide musical content scrolls within its own
surface; it must not enlarge the page or cover controls and labels.

Fitting the host must not shrink text or pitch marks below a readable size.
UIKit pitch viewports keep minimum key and fret geometry, expose keyboard
panning only while they overflow, and extend staff lines or fret spacing into
available width. PitchView's keyboard reveals newly sounding notes; ordinary
repaints and releases preserve a user's manual pan. Display labels remain
bounded by their keys, with complete text available to assistive technology.

UIKit Stage provides a minimum drawing-surface width independently of its
shrinkable host. SheetView uses that capability for readable engraving and
scrolls inside the stage on small screens. Its paper color is explicit so dark
application backgrounds do not obscure OSMD's ink. Width, height and follow
settings update the current engraving without another source load.

Waterfall's Element composes the existing UIKit keyboard through a structural
render port. The Score renderer owns numeric pitch-column geometry and time;
UIKit owns the keyboard DOM. The explicit render API remains usable without
UIKit through its fallback keyboard. Element defaults fit the occupied octaves
to the container; explicit key widths keep a manually pannable scale. Resizing
preserves the current view position and keeps the keyboard within the height.
Default Score colors resolve through public theme tokens, while explicit
renderer colors remain authoritative. Empty and failed full-score renders use
the shared Status presenter instead of leaving an unexplained blank surface.

## Resources and compatibility

The application owns the player, synthesis and musical clock. Views own and
release their presenters, renderers, subscriptions and pending source loads.
Changing type releases the previous presenter without replacing borrowed state.
Disconnect, late source completion, player replacement and repeated cleanup
retain their existing cancellation guarantees. SheetView keeps its optional
OSMD loading, injection and failure contract.

The five superseded tags and their registration helpers are removed. Migrate
`keyboard-view`, `staff-view` and `fretboard-view` to the corresponding PitchView
type; migrate `score-map` and `score-thumbnail` to ScoreView types. Low-level
Headless/API/render helpers remain available. The three visualizer types stay
unchanged in the lower-level `ScoreViewType`; the Element's additional modes use
`ScoreViewElementType`.

## Acceptance

- Register exactly three View tags, with no compatibility duplicates.
- Switch each type while paused and playing, preserving score identity, held
  note counts and the player's cursor without duplicate subscriptions or loads.
- Retain standalone Score use, native player-data borrowing, invalid/late/
  replaced target handling and cleanup.
- Keep map seek units correct at non-unit rate and recover from rejected seeks.
- Keep thumbnail passive and avoid full-score playback-view computation.
- Verify all types at narrow and wide widths, two simultaneous instances,
  keyboard interaction, type-specific Parameters, Copy and Reset.

Owning references: [View overview](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#view),
[player binding](PLAYER-BINDING.md), and [component design template](COMPONENT-DESIGN.md).
