# Elementary Score analysis and view composition

Status: DEC-047 accepts four elementary tools; DEC-048 defines metrical chord
grouping and the readable lane presentation. [STATUS](../STATUS.md) owns
current delivery, verification and remaining acceptance work. DEC-038 through
DEC-043 retain the earlier design history.
Layer and public entry: Score Elements, `@webmusic/score/analyze/element`.
Related decisions: DEC-002, DEC-004, DEC-007, DEC-009, DEC-011 through DEC-015,
DEC-017, DEC-034, DEC-038 through DEC-043, DEC-045, DEC-047 and DEC-048.
Source and types: [Analyze barrel](../../packages/score/src/analyze/element/index.ts),
[shared composition](../../packages/score/src/analyze/element/internal/analysis-component.ts),
[Headless projection](../../packages/score/src/analyze/headless/basic-inspection.ts).
Owning references and demos: [Analyze inventory](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze).

## User task and boundary

Four components answer four elementary musical questions. Each owns one useful
surface, with display configuration outside it. A component must not create a
keyboard, staff, fretboard, second player, or settings workbench. Supporting
views are ordinary siblings selected by the application.

| Component | Musical task | Meaningful result |
|---|---|---|
| `score-chord-analysis` | What chord structure is present? | Score/live modes; complete spelled triad/seventh, bass, inversion and optional explicit-key degree |
| `score-interval-analysis` | What is the relationship between notes? | Written/sounding interval number, quality, direction, semitones and note provenance |
| `score-scale-analysis` | How do notes relate to a chosen scale? | Spelled degree and alteration against an explicit tonic and scale form |
| `score-rhythm-analysis` | Where does a written attack fall in meter? | Duration, measure, grouped beat and fractional subbeat |

The chord `mode` switches the data presentation of one musical task. Default
`score` mode collects source notes by metrical pulse (`grouping="beat"`);
`grouping="simultaneous"` reads exact note-boundary spans. `live` uses held MIDI
activity and is unaffected by score grouping. This replaces the former separate
live-chord tag. Metrical grouping follows the authored meter rather than
DEC-042's retired fixed half-bar projection. No other generic type-switching
Analyze component is introduced.

None of these tools guesses a key, harmonic function, cadence, voice-leading
intent or performance quality. Missing context is visible. Scale alterations
are descriptions, not musical errors. MIDI pitch spelling is inferred; a
written MusicXML note can preserve an enharmonic distinction that MIDI cannot.
Evidence `spellingInferred` identifies inference needed by analysis-time
transposition only; it does not identify an earlier importer's spelling choices.

Recurrence research remains parked under DEC-043. Motif and rhythmic-occurrence
algorithms, key estimation, whole-score reports, specialist Roman analysis and
voice-leading remain API/Headless capabilities. Historical research source and
dated evidence are not restored by this decision.

## Composition

A player produces Score data, note activity, state and authoritative time.
API/Headless performs inspection and produces plain evidence and lane models.
The Element maps attributes, observation and gestures to those operations and
to existing neutral Harmony/Workbench presenters. Custom UI uses the same
`projectBasicInspection` data rather than requiring a custom element.

Score input precedence is explicit `.score`, then `src`, then the selected
player's shared `ScorePlaybackSource` snapshot. Native observation owns readiness,
source identity and occurrence-aware activity. Targets without a source, or
reporting `unavailable`, retain the legacy resolved-data/event path. The live
chord mode borrows held notes without loading a Score. A local Score different
from the native player's Score suppresses incompatible activity and cannot seek
that owner. See [Player binding](PLAYER-BINDING.md) for discovery and commands.

## Inputs, outputs, and units

| Item | Type/unit | Default/empty | Owner |
|---|---|---|---|
| Score | Immutable `Score` or URL/format | Borrow player data or await input | Caller/player; Element owns explicit request |
| Player | Unique selector in current Document or ShadowRoot | Unbound for missing/invalid/ambiguous matches | Application selects; Element subscribes |
| Position | Quarter notes and nominal seconds | Initial snapshot or local initial position | Player is authoritative when bound |
| Pitch basis | `written` / `sounding` | Written; live MIDI is already sounding | Explicit analysis choice |
| Selection | Quarter-note region; exact note IDs for interval/scale | First available band; no invented evidence | Local Element/application state |
| Chord key | Explicit tonic plus major/minor | No degree without context | Application |
| Chord grouping | `beat` / `simultaneous` | Element: beat; API/Headless: simultaneous | Explicit inspection choice |
| Scale | Explicit tonic and major/minor form | Missing tonic asks for input | Application |
| Meter grouping | Positive denominator-unit groups | Conventional simple/compound; irregular requires input | Authored meter plus explicit choice |
| Result | Plain evidence, interpretation and source identities | Empty/uncertain/invalid stay distinct | Analyze API/Headless |

Scale forms are major, natural minor, harmonic minor, ascending melodic minor
and descending melodic minor. The two melodic directions are explicit reference
choices. Interval inspection respects diatonic spelling and part transposition;
ambiguous polyphonic attacks interrupt a melodic line until exact note selection
resolves it. Tied continuations are not new melodic or rhythmic attacks.

Chord score inspection matches complete spelled triads and seventh chords;
doublings are allowed, omitted/rootless tones and respellings are not inferred.
Beat grouping includes every selected source note overlapping each half-open
metrical pulse, including notes sustained from a prior pulse. It retains passing
tones and other pitches even when they prevent a chord match. The lowest
collected source pitch determines the displayed bass/inversion; it does not
establish the passage's structural harmonic bass. Simultaneous grouping instead
uses only pitches overlapping each exact note-boundary span. An explicit key
provides a relative degree and figure, not a harmonic-function verdict. Live
MIDI uses chosen/inferred spelling and exposes that limitation.

`inspectScoreChords()` keeps `grouping: 'simultaneous'` as its default;
`projectBasicInspection()` likewise requires `chordGrouping: 'beat'` to opt in.
The Element passes its beat default explicitly. Result and span metadata name
the grouping, and source evidence preserves original note onsets and offsets.
Grouping is independent of the visible `window` in seconds.

Rhythm uses one denominator unit for simple 2/3/4 meters and groups of three
for 6/9/12 compound meters. Beat-grouped chords use the same pulse definition.
Other numerators require explicit grouping such as
`2+3` in 5/8. One grouping must be valid for every inspected meter. Pickups begin
at the authored boundary without inventing missing leading beats. Subdivision
is relative to the grouped pulse; durations remain quarter-note units.

The method is deliberately bounded: arpeggios can express chords, but harmonic
rhythm need not change once per pulse, and non-chord-tone classification requires
melodic context. The pulse union is therefore an inspectable collection, not an
automatic harmonic reduction. See *Music Theory for the 21st-Century Classroom*:
[Arpeggiated Accompaniments §14.3.1](https://musictheory.pugetsound.edu/mt21c/ArpeggiatedAccompaniments.html),
[Harmonic Rhythm §9.2](https://musictheory.pugetsound.edu/mt21c/HarmonicRhythm.html)
and [Introduction to Non-Chord Tones §10.1](https://musictheory.pugetsound.edu/mt21c/NonChordTonesIntroduction.html).

## State and commands

Clicking a score band selects its evidence and seeks. Keyboard navigation and
pointer drag retain the lane's established semantics. `selectRegion()` chooses
local inspection without commanding playback; interval/scale `selectNotes()`
chooses source IDs without seeking. Neither changes the Score or siblings.
The lane retains a full current readout even when a short band cannot fit its
label. `.analysis` retains detailed provenance and candidates, accompanied by a
nonvisual selection status; a separate report panel is not appended below it.

Changing chord mode remounts the owned presentation and relevant observation
without changing playback state. Live mode updates its nameplate immediately,
keeps fixed reading rows through empty states, and emits a named chord only
after the configured stability delay. Reset, changed notes, mode/source change
or disconnect cancels a pending notification. Unclassified notes remain literal
pitches rather than a fabricated chord.

Initial native snapshots hydrate data, position and held-note occurrences. Late
and replaced targets, source replacement, pause/seek/stop/end, overlapping equal
pitches and reconnect follow the binding contract. Failed explicit loading does
not fall back to borrowed data. Superseded work cannot restore old input.

## Session time and ownership

The lanes convert quarters through the Score's time map and emit nominal-seconds
seek requests. Commands use `seekNominal` when available or divide nominal time
by the current rate for transport `seek`. Failed commands restore local position
unless newer state has arrived. Native snapshots remain authoritative after
seek, rate or source discontinuities. Live chord mode has no moving lane or
score seek. None creates an audio clock or completes cross-domain clock injection.

| Resource | Ownership | Release |
|---|---|---|
| Player, synth and AudioContext | Borrowed; never allocated by Analyze | Player owner decides |
| Explicit URL request | Element-owned | Abort/invalidate on replacement or disconnect |
| Derived inspection/projection | Element-owned or caller-owned plain data | Replace with input/configuration |
| Target discovery/subscriptions | Element-owned | Rebind/disconnect |
| Presenter/DOM/frame subscription | Element-owned | Remount/disconnect |

## Interaction and visuals

Each score lane is a named slider with keyboard/pointer interaction and a semantic
ordered list. A prominent current reading and quieter configuration context make
the musical result legible without depending on a tiny band's text. Named chords
show their symbol above source pitch names with octaves; unmatched sets leave
the symbol row empty and retain pitch names in the note row below. This applies
to the score readout, timeline and live nameplate. Grouping belongs in settings and inspection details,
not a repeated collection caption. Chord timeline labels wrap and their row
height grows to fit instead of truncating with ellipses. Melodic interval pairs
use an arrow; harmonic pairs use `+`. Rhythm labels
use compact duration and beat notation, with exact units retained in evidence.
Interval, scale and rhythm place their secondary facts in three fixed,
equal-width readout slots: Notes/Motion/Semitones, Note/Reference/Relation and
Bar/Beat/Duration (qn), respectively. Rest and tie-continuation rhythm readings
retain the same slots; unavailable values are empty. Full-band data determines
the space needed by the primary heading and each wrapped field on content or
geometry changes. Playback updates values without measuring or resizing the
readout; gaps retain field labels and slot heights while clearing values.
These structured fields replace the visual secondary sentence for those three
tools. The chord symbol/note hierarchy stays unchanged.
Passive playback does not repeatedly announce a local selection. Selection
details remain in `.analysis`; no hidden sibling analysis or pitch view runs
inside the core tool.

Responsive geometry belongs to UIKit's `mountFlowLane`: the Element supplies a
visible duration in seconds, and resize preserves that duration while updating
pointer coordinates. Track labels, ruler and reserved current readout have
separate space. Score lanes hide tracks whose material is outside the viewport,
retaining one empty row through gaps instead of reserving rows for overlap
elsewhere in the score; this changes only layout, never identities or evidence.
The live chord nameplate starts with the prominent chord name and quieter
source notes below. It omits explanatory captions from the performance surface;
MIDI spelling provenance remains in the owning reference. Reserved reading
rows stay stable through silence, unnamed sets and named chords. Long readings
remain available by horizontal scrolling without ellipses. Alternate readings
are secondary text with no candidate buttons or redundant time caption.

Each component retains one neutral frame using public surface, padding, border
and radius tokens (DEC-034). Inner presenters remain unframed. Light-DOM public
parts and named handles remain the styling seams; private presenter selectors
are not public API. External demo Parameters own configuration. The demo's
full-width sibling composition and `0.5rem` gap do not alter component geometry.

## Compatibility and documentation

Register exactly the four tags above. Migrate old live callers to
`score-chord-analysis mode="live"`; its old reference URL redirects to the
merged page without registering an alias. Interval and rhythm bookmarks route
to their new domain-prefixed pages. Retired recurrence and specialist bookmarks
continue to their API owners. API/Headless key and report algorithms remain
available, but their estimates do not silently fill these components' context.

Each tag has one [template-complete page](../docs/COMPONENT-PAGE-TEMPLATE.md),
parameter catalog and real one-player demo. All four load the existing
`public/mxl/Arabesque No.1.mxl` asset and inspect its actual written notes and
meter; no substitute teaching score or generated notes are used in the demos.
Scale starts with an explicit E-major reference, not a key estimate. Exact
synthetic theory cases remain test fixtures rather than replacements for the
demo piece. All four demos start with a one-second viewport to leave room for
written notes and full chord labels. These viewport choices
do not change analysis grouping. Copy includes the actual source and Reset restores initial
attributes. Optional supporting views belong to the family composition example.

## Acceptance

Verify exact tags/exports/catalog attributes; complete/ambiguous chord sets,
strict API defaults, metrical arpeggio collection, sustained overlaps, passing
tones, irregular meter validation and grouped bass provenance;
inversions with explicit major/minor key; interval spelling/transposition;
explicit scale degrees and all minor forms; ties, simple/compound/additive meter,
invalid/missing context, exact note selection and standalone region inspection.
Then exercise source precedence, initial/replaced bindings, cancellation,
overlapping equal pitches, rate-correct seek, mode changes and repeated cleanup.

Browser acceptance covers all four controls, copied markup, Reset, normal/narrow
layout, keyboard/pointer navigation and multiple followers of one player.
For interval/scale/rhythm, compare field positions and readout height across
short/long values, rests, ties and gaps; geometry changes may recompute the
reserved space, ordinary playback must not. Record
actual evidence in dated audits, and leave audible timing, real MIDI devices and
screen-reader acceptance open until measured. Historical passing checks do not
establish this tree's behavior.
