# Atomic musical analysis and view composition

Status: DEC-043 narrows the Element inventory to two chord surfaces; DEC-040
through DEC-042 record the earlier four-tool design. Browser pointer, audio and
accessibility acceptance remain open.
Layer and public entries: Score Elements, `@webmusic/score/analyze/element` and `@webmusic/score/view/element`.
Related decisions: DEC-002, DEC-004, DEC-007, DEC-009, DEC-011, DEC-012, DEC-013, DEC-014, DEC-015, DEC-017, DEC-038 through DEC-043, and DEC-045.
Source and types: [Analyze barrel](../../packages/score/src/analyze/element/index.ts), [View barrel](../../packages/score/src/view/element/index.ts), [analysis composition](../../packages/score/src/analyze/element/internal/analysis-component.ts).
Owning references and demos: [Analyze](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze) and [View](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#view).

## User task and boundary

The application chooses each musical inspection surface and places it
explicitly. An analyzer must not construct a keyboard, staff, fretboard,
configuration bar or second workbench. Those are separate reusable components.
Musical gestures stay with the surface that interprets them; display
configuration belongs to attributes and application-owned controls.

| Component | One surface | Musical operation |
|---|---|---|
| `score-live-chord-analysis` | Current sounding chord nameplate | Read the primary chord and any secondary interpretations without editing the notes |
| `score-chord-analysis` | Harmonic progression lane | Select a passage, inspect its chord evidence and key-relative degree, and seek |
| `score-pitch-view type="keyboard"` | Current piano keys | Passive held-note display |
| `score-pitch-view type="staff"` | Current staff pitches | Passive held-note display |
| `score-pitch-view type="fretboard"` | Exact-MIDI fret positions | Passive held-note display |

Analyze Elements are performance surfaces: their meaningful state follows
playback position, sounding notes or accumulated performance evidence. Adding a
playhead or active-row highlight to a whole-score report does not make the report
a performance surface.

Whole-score summaries, distributions and rhythmic vocabulary belong to the
Headless/API workflow. The former `score-analysis`, `analysis-histogram` and
`rhythm-patterns` tags and registration helpers are removed. Their algorithms
remain available through `createScoreReport`, `distributions` and
`rhythmPatterns`; application-owned UI may render that data.

DEC-043 parks the two recurrence Elements from DEC-040 for further research.
Their code and demos remain on the research branch, not in this checkout's
public Element inventory. `detectKey`, `analyzeIntervals`,
`inspectScoreRhythm`, `findMotifs`, `findRhythmPatternOccurrences` and
`rhythmPatterns` remain API/Headless capabilities for application-owned
analysis. Roman-numeral and voice-leading algorithms likewise remain
available for specialist compositions.
Selected evidence remains available through `.analysis` and a nonvisual
status rather than an under-lane text panel. Tonal wheels and heard-chord
histories remain application-owned compositions. The generic
`analysis-view` alias and `analysis-timeline` remain retired. The removed
history wrapper's bounded trail was Element-owned; an application needing
history retains tracker updates and timestamps itself.

## Composition

A player produces data and state. Each Element connects its own API/Headless
projection to one UI surface. The explicit markup is player + selected Analyze
surface + optional View/Analyze siblings. Source-level implementation reuse may
share lifecycle and presenter infrastructure; it must not cause hidden companion
views or their computation to run inside each core component.

The selected player owns score, sound, engine and timeline. Components borrow
according to [Player binding](PLAYER-BINDING.md). Score-based input precedence is
explicit `.score` → `src` → the player's shared `ScorePlaybackSource` snapshot.
Native observation owns readiness, source identity and occurrence-aware activity.
Targets without native observation, or explicitly reporting `unavailable`, retain
the legacy resolved-data/event path (`.resolvedScore`, or structural `.score`
only when that capability is absent). Note-only views and live surfaces borrow
held notes without loading a score. A local Score that differs from the native
owner suppresses incompatible activity and cannot navigate that owner.

## Inputs, outputs, and units

| Item | Type/unit | Default/empty | Owner |
|---|---|---|---|
| Score | `Score`, or URL/format | Borrow player data or await input | Caller/player; Element owns explicit URL request |
| Player | Unique selector in current Document or ShadowRoot | Unbound for missing/invalid/ambiguous matches | Application selects; Element subscribes |
| Score position | Nominal seconds and quarters | Snapshot or initial position | Player is authoritative |
| Held notes | Counted occurrences of MIDI pitches | Empty note state | Player/source owns activity |
| Inspection selection | Quarter-note passage | Local current passage; empty until selected | Element or explicit caller input |
| Inspection result | Plain evidence and possible readings | Empty/uncertain result, not a fabricated answer | Score Analyze API/Headless |
| Configuration | Surface-specific attributes | Owning page defines defaults | Application and each element |
| Visibility | Native HTML `hidden` on an explicit sibling | Visible unless hidden | Application/external controls |

Every tag exposes only applicable attributes. Pitch ranges, clefs and fret
tuning belong to View components. The chord `window` is a visible
duration in seconds rather than an analysis horizon.
Roman degrees in the chord probe are relative to an explicit or estimated key;
they are not a contextual harmonic-function verdict. No Analyze tag has
`show`, `shell`, `range` or `tuning` attributes.

## State and commands

The chord lane supports standalone local inspection and bound seek commands. A
selected band or passage exposes its detailed evidence through `.analysis` and
nonvisual selection status, while the lane marks the visual selection. Changing a
inspection scope is local selection state and does not change the Score or
sibling components. Chord candidate readings remain available in
`.analysis` for application-owned inspectors, without candidate controls in the
Element. The nameplate reacts to held-note input, clears on playback resets,
and displays alternate readings as secondary text rather than choices; it has
no score loader or history lane. None constructs another player, synth,
AudioContext or playback scheduler.

Initial native snapshots hydrate position and held notes. Late/replaced targets,
source changes, pause/seek/stop/end and overlapping equal pitches follow the
binding contract. Explicit data keeps precedence. Superseded loads cannot restore
old input; errors/empty data are displayed by the affected surface. Cleanup
releases owned work and leaves borrowed playback with its owner.

## Session time

The chord lane converts quarters through the score map and emits nominal-seconds seek
requests. They use `seekNominal` when available, or divide by current rate for a
transport-seconds `seek`. Failed commands restore local position unless newer
state has arrived. Native snapshots remain authoritative after discontinuities.

The current-chord nameplate follows note activity without a moving lane or
animation clock. Presentation does not complete shared Score/Audio
transport-clock injection.

## Interaction and visuals

Each surface retains its own meaningful gesture and accessible representation:
chord-lane keyboard/pointer navigation and passage selection. A selection
is not merely a moving playhead: its current readout and selected band remain
visible, and its details remain available through `.analysis` and a nonvisual
status. The chord lane does not append a visible prose/evidence section
beneath the lane. The chord lane has no candidate-button row. The live nameplate
places alternate readings as plain text below the primary chord, without a
redundant temporal caption or a selection affordance. Nonvisual selection
feedback must not repeat on every passive playback tick. Reusable pitch views remain passive labeled siblings.
The chord lane groups written pitches into at most two beat-aligned cells per
measure; notes in one cell may sound successively rather than simultaneously.
Its default two-bar viewport keeps those readings legible, and its pinned
readout reserves height across empty and active states. Selecting a cell exposes
the same aggregate through `.analysis`, while a custom region keeps midpoint
sampling and raw API/Headless chord segments remain unchanged.
Recurrence search results and detailed occurrence evidence remain available
through Headless/API for application-owned visualizations.
Current staff and fretboard are MIDI readouts, not score engraving or inferred
guitar voicing. Whole-score notes use a sibling `score-view`; the core chord
lane disables its optional embedded roll.

All demo configuration controls are in external Parameters. Each Score Analyze
tag-owned live demo and basic import example contain one `score-player`
and the current component. The family Element inventory's Analyze section owns
the optional composition example; tag pages link to it and related components. Copy reflects
the displayed pair, and Reset restores its initial attributes and connection.

Composition demos that include optional siblings can provide named Parameters
groups and a Visible checkbox using native `hidden`. Copied markup and Reset
preserve each target’s attributes and visibility. Hiding one sibling does not
create or dispose the player. Responsive layout and public tokens apply per host.

Responsive geometry belongs to UIKit's `mountFlowLane`: the chord Element supplies a
`visibleSpan` in seconds instead of assuming a pixel width. Resizing preserves
that duration and recomputes pointer coordinates without replacing the player,
clock or presenter host. Track labels, the ruler and the current readout occupy
separate space. Weight changes affect a band's visual fill rather than reducing
its readable text height. Each Score Analyze Element owns one neutral component
surface: background, border, radius and equal padding, using the same defaults
as Score Play. The outer `surface` part exposes the public component/workbench
surface tokens. Inner lanes and nameplates remain unframed, and bare workbench
chrome omits configuration controls. It must not remove the Element's outer
frame or spacing. Full-width sibling composition and its `0.5rem` gap belong to
the demo layout; component padding belongs to the reusable Element (DEC-034).

## Resources and failure

| Resource | Ownership | Release |
|---|---|---|
| Player, sound and audio context | Borrowed; never allocated by a follower | Player owner decides |
| Explicit URL request | Owned by score-based Element | Abort/invalidate on input change/disconnect |
| Analysis session/tracker | Element-owned derived state | Reset/drop with its declared lifetime |
| Player subscription and target observer | Element-owned | Release on rebind/disconnect |
| Presenter/DOM/frame subscription | Element-owned | Destroy on remount/disconnect |

Missing input remains distinguishable from load failure. Optional playback/device
requirements belong to Play, and merely mounting a follower does not request them.

## Composition, extension, and compatibility

Fixed tags identify the musical task; there is no generic type-switching
Analyze Element. Existing callers select the corresponding retained tag and
compose supporting views explicitly. The retired Roman and voice-leading
Element pages redirect to the code-only analysis workflows; their algorithms
and projections remain. Other retired diagnostic and specialist pages continue
to redirect to Headless/API references. Public registration includes exactly
the two Analyze tags in the table, with no compatibility aliases. Former
key, interval, rhythm, motif and rhythm-pattern Element bookmarks redirect
to their retained API algorithms.

Headless `projectNameplate` supports the current name without computing pitch
views. `projectProgression(..., {roll: false})` produces only chord bands; its
existing API default still includes the roll. UI's workbench presenter remains
available for application-owned compositions; its full chrome is not a primitive
Analyze element's product interface.

## Acceptance

Automated contracts cover exact tags/exports/attributes, one active core
surface, absence of internal pitch views, selection and nonvisual candidate data,
initial/replaced bindings, source precedence, cancellation,
equal-pitch occurrences, rate-correct seeking, standalone interaction, live
note resets and cleanup. An omitted voice or unsupported analysis must never
produce a misleading clean verdict. External Parameters need distinct-target
checks: changing/hiding staff cannot mutate the main analysis or keyboard, and
Reset restores player links and visible states.

Browser acceptance checks actual controls, copied composition, layout and
multiple followers of one player. Audible timing and devices require separate
evidence. Uniform Rack/controller snapshots and shared cross-domain clock
injection remain outside this implementation.

For the chord lane, visual acceptance also checks that no explanation
section appears below the lane, no chord candidate controls appear above it,
and selected details remain screen-reader accessible without a visible report
panel (DEC-039 and DEC-041). For the live nameplate, alternate readings are static
secondary text below the primary symbol and no temporal caption is shown.

## Documentation delivery

Tag-owned pages follow the [component template](../docs/COMPONENT-PAGE-TEMPLATE.md).
Observed-attribute catalogs match source order; effective properties/events and
units belong to the owning page. Each Analyze live demo isolates the current tag
with one player, external Parameters and truthful Copy/Reset behavior. Reusable
compositions belong to the overview and related references. Catalogs and generated
inventories describe this branch; historical workbench plans remain unchanged.
