# Score View component families

> Current design, accepted in DEC-015 and refined for staff notation in DEC-024.
> DEC-045 owns the domain-prefixed tags. Source and public leaf pages own exact
> members; STATUS owns delivery and verification gaps. DEC-053 adds the accepted
> document-bound editing below; DEC-058 moves Score note editing to the
> dedicated `<score-grid-view>` and makes `<score-view>` read-only.

## Purpose and boundaries

View components offer alternative representations of the same input. A type
selects one surface within a family; it does not assemble several surfaces or
create playback. Applications compose several instances around one player when
they need simultaneous representations.

| Component | Input and task | Types |
|---|---|---|
| `score-view` | A complete Score, optionally with a borrowed playback position; read-only | `piano-roll`, `staff`, `waterfall` |
| `score-grid-view` | A complete Score on a DAW-style piano-roll grid; with a borrowed editor and `editable`, note editing | One grid; `tools` selects editing features |
| `score-pitch-view` | Currently held MIDI pitches from one selected note source | `keyboard`, `staff`, `fretboard` |
| `score-sheet-view` | Page engraving using an optional OSMD renderer | Separate engraving lifecycle; no type selector |

Score staff includes musical time. Pitch staff depicts only sounding notes.
Under DEC-056 `score-view` has no map or thumbnail type; applications compose
the Headless `createScoreMapView` with the UI timeline, or the `/view/render`
thumbnail renderer, when they need navigation or a static preview. Only the
staff type draws score annotations. Page engraving remains independent because its optional
engine, injection points and asynchronous layout differ from the scrolling
staff renderer.

## Data, time and state

ScoreView preserves `.score`, then `src`, then player-data precedence. Switching
types changes presentation of the resolved score without fetching it again or
restarting its player. The shared core `ScorePlaybackSource` initializes data,
readiness, nominal position and active occurrences; legacy event targets remain
available when native observation is absent or reports `unavailable`.
A view with a different explicit Score never follows or seeks the native owner.

`configure(ScoreViewConfiguration)` validates the three modes and their
compatible option keys before replacing them atomically; `showAnnotations` is
a staff-only key. SheetView retains its separate
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
this structure; the default demo uses a two-staff piano MusicXML fixture.
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

## Document-bound editing

[Editing contracts](EDIT-COMPONENTS.md) and
[DEC-053](../DECISIONS.md#dec-053--document-owned-editing-and-borrowed-playback)
own the accepted editing behavior. [STATUS](../STATUS.md), EDIT-01, tracks
implementation and verification. `.editor` and `editable` are documented in the
owning public `<score-view>` and `<score-grid-view>` references.

An editor-bound View borrows committed content and commands from `ScoreEditor`
through Core structural ports. The editor remains the content and history owner;
View owns rendering, viewport, focus and local gesture previews. It reuses View
renderers; the editors and their URL loaders are View Headless pieces under
DEC-055 and DEC-057, lent to Elements through `.editor`. Content history
does not restore selection; each selection session remaps or prunes its current
IDs. Viewport and focus remain local and outside content history.

Under [DEC-058](../DECISIONS.md#dec-058--score-editing-moves-to-a-dedicated-grid-view)
`<score-view>` is read-only: with `.editor` it draws the editor's visible content,
including a shared session's draft, through its normal piano-roll, staff or
waterfall renderer. Note editing belongs to `<score-grid-view>`, a separate
Element because it adds a toolbar, piano keys, a ruler, a velocity lane and
editing settings that none of the read-only types share. Its feature gating and
gesture contract belong to [Editing contracts](EDIT-COMPONENTS.md#score-grid-editing).
Staff, sheet and waterfall have no editing capability. On the grid, `editable`
without a ready editor reports unavailable instead of creating a private editor. Independent `.score`
or `src` alongside an editor is a configuration conflict, reported before
replacing a working binding. Without an editor, existing data precedence and
player following remain unchanged.

Editing geometry uses rational quarter positions and stable authored note IDs.
Each gesture has one owner, previews locally and commits one semantic transaction;
cancel, mode/source replacement or a conflicting content revision discards the
preview. Item editing must not also seek or scrub. Keyboard commands remain
local to the focused surface and honor application shortcut overrides.

The player supplies time and sounding occurrences, not document authority.
Newly committed content can be visible before playback applies it; incompatible
active-note overlays and seeks are withheld until revisions and coordinate
projections agree. Repeat-expanded playback without an authored-to-occurrence
mapping resets to origin on revision application and provides no document seek
or occurrence overlay. Disconnect releases the View's subscriptions and drafts,
not the borrowed editor, player or AudioContext.

Acceptance must cover two Views sharing one editor, one undo per gesture,
overlapping-note selection, keyboard/pointer cancellation, source conflicts and
pending/failed playback application. Existing passive-renderer checks do not
establish these editing outcomes.

## Interaction and presentation

Each instance mounts only its selected surface. Passive Elements have no type
switch, settings toolbar, extra keyboard or embedded player. The editable grid's
toolbar appears only while editing and offers only the features its `tools`
attribute lists; it provides local musical input and accessible numeric alternatives; custom UI may
use the same Headless controllers without the supplied controls. Parameters belongs to the
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
UIKit pitch viewports retain their minimum-geometry defaults and expose keyboard
panning only while they overflow. DEC-050 makes the PitchView Element's keyboard
fit MIDI 48–71 to the container by default, without horizontal scrolling.
Explicit `scroll="true"` restores minimum/fixed key widths and optional
new-note following; ordinary repaints and releases preserve a user's manual
pan. Staff and fretboard sizing is unchanged: staff lines or fret spacing extend
into the available width. Display labels remain bounded by their keys, with
complete text available to assistive technology.

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
type. The `score-view` `map` and `thumbnail` types published in 0.2.0 were removed by
DEC-056; their Headless/API/render helpers remain available.
`ScoreViewElementType` equals the lower-level `ScoreViewType`.

## Acceptance

- Register exactly three View tags, with no compatibility duplicates.
- Switch each type while paused and playing, preserving score identity, held
  note counts and the player's cursor without duplicate subscriptions or loads.
- Retain standalone Score use, native player-data borrowing, invalid/late/
  replaced target handling and cleanup.
- Accept only the three types; draw annotations only on staff.
- Verify all types at narrow and wide widths, two simultaneous instances,
  keyboard interaction, type-specific Parameters, Copy and Reset.

Owning references: [View overview](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#view),
[player binding](PLAYER-BINDING.md), and [component design template](COMPONENT-DESIGN.md).
