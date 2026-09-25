# Player binding for Analyze and View

> Current design specification. The composition direction is accepted; the
> complete target syntax below is broader than the implemented binding surface.
> This document owns intended behavior and unresolved contract questions, not
> the current work queue. [STATUS](../STATUS.md) owns readiness and delivery;
> public reference pages and source own actual supported APIs.

Accepted on 2026-09-06 under [DEC-011](../DECISIONS.md).

On this checkout, DEC-015 consolidates the implemented View tags into
`score-view`, `pitch-view` and `sheet-view`; see [View families](VIEW-COMPONENTS.md).
The proposed composition below retains its original target vocabulary and is
not the current registration or attribute reference.

Implementation observations in this specification refer to the main baseline
recorded in [STATUS](../STATUS.md). Another branch may expose different bindings
only when its tracked source, reference pages and status establish them. The
accepted composition direction applies across branches without implying
identical delivered APIs.

## Purpose and accepted direction

Playback-connected Analyze and View components may attach to an existing Play
participant and borrow the data, state, time and exposed resources needed for
their task. A developer should be able to load and play a score once, then add
analysis, readouts and alternative views around that same performance.

Binding is optional. Static score views, data-only analysis, and independently
supplied musical input remain useful without a player. A capability does not
become a playback participant merely because another component on the page plays
music. Multiple independent sessions must remain isolated.

The same musical capabilities must be accessible through Web Components,
Headless composition and API + UI composition. The Element adds declarative
target resolution and presentation; it must not be the only place that can
obtain playback state or implement analysis behavior. Equivalent capability
does not require identical method names or a lifecycle on pure functions.

Binding follows [Product](../PRODUCT.md), [Component design](COMPONENT-DESIGN.md),
the accepted decisions in [DECISIONS](../DECISIONS.md), and the package and capability
rules in [Architecture](../ARCHITECTURE.md). It creates no second player, musical
clock or authoritative transport state. Derived analysis, display caches and
presentation update tasks are allowed; they remain projections of their inputs.

## Target composition syntax

The following is the maintainer's full proposed composition, preserved as target
syntax. It is **not a runnable example of the current public API**. Some tags,
type values and options in it are proposals. Their names, defaults, units,
registration and detailed behavior require a reviewed public contract before
implementation and publication.

<!-- prettier-ignore -->
```html
<score-player id="p" src="/scores/invention.mxl" time-control="off"></score-player>

<div class="row">
  <score-readout type="status"  player="#p"></score-readout>
  <score-readout type="time"    player="#p" show="elapsed total remaining"></score-readout>
  <score-readout type="measure" player="#p" show="measure beat subbeat total"></score-readout>
  <score-readout type="tempo"   player="#p"></score-readout>
</div>

<score-readout type="progress" player="#p" show="bar time percent"></score-readout>

<div class="row">
  <score-readout type="notes"  player="#p" show="name midi part" max="8"></score-readout>
  <analysis-view type="score-chord" player="#p" preview="2"></analysis-view>
</div>

<score-view    type="piano-roll" player="#p"></score-view>
<keyboard-view player="#p" labels="c-only"></keyboard-view>
<note-log      player="#p" columns="time kind name midi part" max-rows="20"></note-log>
```

The classes and row layout belong to the host application. The composition does
not prescribe a dashboard layout for every component. Disabling a player's own
time controls must not make observers create another transport or infer that
playback state is unavailable.

## Composition and boundaries

```text
Play owner: resolved data + playback state + authoritative time + resources
                         |
               explicit borrowed capabilities
                         |
          Analyze / View behavior and derived projections
                         |
            UI presenter or application-owned surface

Element: declarative connection and lifecycle composition around these roles
```

The contract must expose the capabilities a consumer needs without requiring
access to a private engine, DOM tree or audio graph. A static analyzer may only
need a score; a keyboard follower needs note activity; an interactive timeline
also needs a position mapping and an authorized seek operation. An unavailable
capability must remain distinguishable from a valid empty result or zero value.
An external controller or multi-part Rack cannot be assumed to expose the same
single-score data as a native player.

Preserve the capability DAG. Score Play, Analyze and View remain siblings that
do not import one another. An Element may compose a structural connection without
importing a sibling's concrete player class. A reusable nonvisual connection
uses the Score core `ScorePlaybackSource` contract, exposed through the existing
Score model entry. It is not an exception allowing sibling Headless imports.
The source owns a coherent `ScorePlaybackSnapshot`, subscription ordering and an
optional nominal-position seek capability; native Play and browser Elements
produce the same nonvisual contract. See DEC-017 and the owning public reference
for members. Review all applicable policies when extending it.

UI presenters continue to receive domain-neutral structural values and commands;
they import neither domain nor Kernel types. Kernel must not acquire Score or
Audio models to host this design. Audio bindings may share suitable neutral
roles, but do not inherit Score-specific payloads or units by implication.
Cross-domain model conversion and synchronization remain Bridge responsibilities.

## Data authority and source selection

A player-bound component must be able to observe the data actually selected by
the playback owner, including successful asynchronous resolution. Reading an
attribute or an explicitly assigned property alone is insufficient if the owner
has loaded a different resolved value. Binding must not independently fetch the
same URL merely to reconstruct the player's data.

The owner remains authoritative for its source and its replacement lifecycle.
Followers derive analysis and rendering from the selected data without modifying
the player's model. Data identity or revision and replacement ordering must be
observable sufficiently to reject stale analysis and refresh projections.

The source-selection policy is explicit:

| Situation | Contract |
|---|---|
| Both a player and local `.score` or `src` are supplied | Explicit `.score` wins, then explicit `src`, then borrowed player data. Native bindings require the exact same Score object for playback projection and navigation. A different explicit Score remains static: unrelated time/notes are ignored and seeks reject. URL or geometric equality does not establish identity; omit a companion's `src` to borrow the resolved Score. |
| A bound owner has no score yet | Represent empty, loading, unavailable and error separately. A failed explicit source must not silently fall back to another source. |
| Source replacement is pending or fails | Publish source revision and readiness. Never label the previous successful source as the successfully loaded replacement; each component documents whether it retains or clears the old projection. |
| Several parts or scores belong to the playback owner | Expose only supported capabilities. A controller or Rack without a single resolved score reports that capability as unavailable; do not choose an arbitrary part. |
| Live input and score-derived analysis coexist | The owning tracker or analyzer declares its input. Source changes and discontinuities reset stale occurrence-derived state; future preview/log components still need their own retention policy. |

Independent static usage retains its own declared input contract. Attaching and
detaching must not silently change who owns that data or discard a caller's
assignment. The precedence choice and migration rules must be shared by the
Element and programmatic usage paths.

## Attachment and lifecycle

Attachment needs both an initial snapshot and subsequent updates. A component
attached after loading, during playback or while paused must show the current
state without waiting for the next note or time event. Snapshot/subscription
ordering must prevent a change between those operations from being lost or
applied twice. `ScorePlaybackSource.subscribe()` registers before synchronously
delivering the initial snapshot, then delivers ordered revisions. Reentrant
publication must not deliver an older revision after a newer one. Unsubscription
releases observation without disposing the source.

| Situation                                                         | Intended guarantee and remaining contract choice                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid target is ready                                             | Acquire the required capabilities and a coherent initial state, then follow updates.                                                                    |
| Target exists but is loading or not yet upgraded                  | Represent readiness and join when usable; do not treat temporary absence of data as successful empty playback. Specify how readiness is signaled.       |
| Selector is invalid, matches nothing, or matches multiple targets | Define scope, validation, error reporting and selection rules. A malformed or ambiguous connection must not silently bind an arbitrary musical session. |
| Target is inserted later                                          | Define late discovery and its bounded lifetime, including how callers can retry or explicitly attach.                                                   |
| Target is removed or replaced under the same selector             | Define detection and reconnection policy; never retain a stale target as though it were the replacement.                                                |
| Binding changes from A to B                                       | Invalidate A's pending work and subscriptions, clear or identify A-derived state, and initialize B before reporting B as ready.                         |
| Follower disconnects or is disposed                               | Release its subscriptions, pending work and owned presentation resources; do not stop or dispose the borrowed player.                                   |
| Follower reconnects                                               | Create one fresh attachment and snapshot, with no duplicate listeners or stale updates.                                                                 |
| Owner is disposed or loses a capability                           | Expose the loss and invalidate dependent work; define the resulting view state and retry path.                                                          |

Selector lookup belongs to the browser connection layer. The implemented helper
resolves a unique target within the host's Document or ShadowRoot and observes
late insertion, replacement, removal and custom-element upgrade. Ambiguous or
invalid selectors do not choose a target. Explicit source composition connects
across those boundaries; a Headless consumer requires no selectors or DOM globals.
The owning public references document readiness attributes and discovery details.

Every asynchronous load, analysis or resource acquisition must be associated with
the current attachment and source. Late results from an older attachment cannot
replace the current view or reconnect an obsolete resource. Cleanup must tolerate
repeated calls and continue releasing owned resources after one release fails.
Callbacks can re-enter detach, rebind or commands; resumed work must re-check its
authority before committing state.

## Time, notes and command delegation

Binding carries explicit time meaning. Audio hardware time, session transport
position, Score quarter positions and nominal score seconds are distinct. The
selected owner's rate, tempo map, offset, pause state and loop behavior determine
the mapping; a follower must not infer it from wall time or a display timer.

A readout must name the axis it presents. An interactive view must convert its
position into the command owner's documented units before delegating a seek.
For example, nominal score seconds cannot be forwarded unchanged to an operation
that expects rate-scaled transport seconds. Seeking, changing rate or wrapping a
loop must produce consistent readouts, highlights and analysis context.

Commands go to the existing authority. Binding does not grant observers permission
to create playback, resume an AudioContext, or issue transport commands merely to
obtain state. A read-only component stays read-only; any seek or other interaction
must be an explicit public capability with failure and asynchronous completion
semantics. A failed command must not leave the UI claiming a successful new
position. The Score source's optional `seekNominal` command uses unscaled score
seconds; compatibility event targets may require an explicit rate conversion.
Group commands use the authority in DEC-018. Each presenter distinguishes pending
interaction from the owner's resulting state.

Note activity must distinguish overlapping occurrences, including equal MIDI
pitches in different parts and repeated notes during sustain. Pitch alone is not
a note-instance identity. The connection needs enough identity, part attribution
and lifecycle information to remove the correct active occurrence, initialize
held notes on attachment, and clear or reconstruct state after seek, stop, loop,
source replacement or owner loss. Public note identifiers and payload types are
not defined by this document.

Score-derived chord context and live chord detection have different inputs. The
former analyzes score material around a musical position; the latter observes
heard or held notes according to its tracker contract. A score preview must not
silently become live detection when its requested source is unavailable.

This design does not complete shared-clock injection. Binding a follower to one
owner avoids a second clock in that composition; coordinating separate Score and
Audio engines remains the accepted session-clock direction described in
[Shared-clock injection](../../platform/shared-clock-injection.md). Sharing an
AudioContext alone does not share transport state or establish sample-accurate
visual updates, seeking or looping.

## Readouts, analysis and presentation contracts

The proposed modes express user tasks, not finalized API definitions:

| Target surface                      | User outcome                                     | Contract questions still to resolve                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `score-readout` status              | Understand readiness and playback state          | State vocabulary; loading/error versus paused/stopped/ended; accessible announcements.                                                                                                               |
| `score-readout` time                | Read elapsed, total and remaining time           | Nominal or transport axis; formatting and precision; behavior under rate changes, loops, unknown duration and count-in.                                                                              |
| `score-readout` measure             | Locate the performance in notation               | Measure numbering, pickups and repeats; beat unit and subdivision; meaning of total and positions outside the score.                                                                                 |
| `score-readout` tempo               | Read the relevant tempo                          | Notated versus effective tempo; beat unit; rate and tempo-map changes; absent tempo information.                                                                                                     |
| `score-readout` progress            | Understand position visually and numerically     | Whole-work versus region scope; normalization, time axis, unknown totals; read-only display versus explicit seek interaction.                                                                        |
| `score-readout` notes               | Inspect relevant notes and their parts           | Active versus scheduled or upcoming notes; occurrence identity; ordering, truncation and overflow for `max`; naming and spelling.                                                                    |
| `analysis-view` score-chord preview | See score-derived harmonic context near playback | Meaning of `score-chord`; whether `preview` counts chord segments, changes, onsets, beats or measures; inclusion of the current segment; gaps, rests, repeats, loops and end-of-score behavior.      |
| `score-view` piano-roll             | Follow the selected score and position           | Part selection, viewport following, held-note display and any delegated seeking; preserve independent data-only rendering.                                                                           |
| `keyboard-view` labels              | Relate active pitches to a keyboard              | Meaning of `c-only`, octave and naming conventions, display range, part overlap and any explicit input interaction.                                                                                  |
| `note-log`                          | Inspect an intelligible history of note activity | Event kinds, time axis, occurrence/part identity, chronological versus arrival ordering, newest-first versus oldest-first display, retention and reset rules, and behavior during seek/replay/loops. |

The numeric examples `preview="2"`, `max="8"` and `max-rows="20"` do not establish
units, defaults or validation ranges. The proposed `show` and `columns` tokens
also need a documented grammar, ordering, unknown-token behavior and formatting
contract. A bounded log needs both a visible-row policy and a retained-data policy;
hiding old rows alone must not imply unbounded accumulation is acceptable.

Readouts must distinguish missing information from zero and provide meaningful
labels and units without depending on color alone. High-frequency time and note
updates must not flood assistive announcements. Any interactive progress or note
surface needs keyboard operation, focus behavior and semantic roles appropriate
to its actual function. Styling uses public tokens, parts and handles, and custom
surfaces preserve the same state and interaction meaning. The exact announcement
cadence and visual formatting remain design choices for the owning components.

## Resource ownership

| Resource                                         | Binding responsibility                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Player, controller, Rack and authoritative clock | Borrow the owner's exposed capabilities. Attachment does not transfer disposal or mutation authority.                                                  |
| Resolved score or other domain data              | Reuse the selected input under its model contract; derived results do not become a second authoritative source.                                        |
| AudioContext, synth, live route or stream        | Borrow only an explicitly exposed capability with a declared lifetime. Do not allocate a second playback graph or request permissions just to observe. |
| Subscriptions and readiness/target observation   | The attachment releases what it registers and invalidates callbacks when it ends.                                                                      |
| Derived analysis, worker and presentation tasks  | The creator manages cancellation and disposal. Shared workers or caches need their own borrowing contract.                                             |
| Presenter and DOM surface                        | Release owned listeners, drawing tasks and DOM according to the mount contract; do not destroy borrowed playback resources.                            |

Candidate attachment failure must release resources acquired for that candidate.
If an existing working attachment is retained during replacement, it must remain
usable and correctly identified until the replacement is committed. The choice
to retain or clear it is explicit; neither path permits mixed-source state.

## Acceptance scenarios

These define observable acceptance for the eventual contract, not claims that
current code passes them. Final API decisions must make each relevant scenario
testable without relying on a private player implementation.

| Scenario                                                   | Required evidence                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Load once and attach several followers                     | All selected projections use the owner's resolved data; no duplicate player, source fetch, audio graph or transport clock is created by attachment.          |
| Attach after ready, during playback and while paused       | Initial data, position, state and held-note information are correct before another playback event occurs.                                                    |
| Static use without a player                                | Data-only analysis and rendering remain functional and allocate no playback resources.                                                                       |
| Supply local data and a player together                    | The selected precedence/conflict policy is deterministic, documented and consistent across integration levels.                                               |
| Late target, late upgrade and source readiness             | The selected discovery/readiness policy reaches the declared state, can be canceled, and does not leak observers or retry indefinitely without a contract.   |
| Invalid, ambiguous or out-of-scope selector                | The declared resolution/error policy is observable and does not bind an unrelated player.                                                                    |
| Replace source or rebind A to B while work is pending      | Late A results and callbacks cannot alter B; the selected old-view policy is respected.                                                                      |
| Remove/replace the owner, then reconnect the follower      | Owner loss is visible; a new attachment obtains fresh state and registers each subscription once.                                                            |
| Seek at rates other than 1 through an interactive view     | The intended musical location matches player position, readouts and analysis after the documented unit conversion; failure does not falsely commit the view. |
| Pause, resume, stop, rate change and loop                  | Every follower applies the declared state/history policy without drifting onto its own timeline.                                                             |
| Overlapping equal pitches and multiple parts               | Ending one occurrence does not erase another; held-note initialization and part labels remain correct.                                                       |
| Chord preview and log at boundaries                        | The chosen counting, ordering, retention and reset rules hold across rests, repeats, seek, loops, replacement and end.                                       |
| External controller or Rack has only some capabilities     | Supported projections work; unavailable score, part or note information is represented explicitly.                                                           |
| Disconnect, reentrant callback and partial cleanup failure | Borrowed playback continues; owned resources are released and canceled work cannot restore an old attachment.                                                |
| Two independent sessions on one page                       | Each set of followers reflects only its selected authority and cannot seek or clear the other session.                                                       |
| Replace an Element with Headless or API + UI composition   | The same data, time, state and command behavior is available without adopting an Element or duplicating playback logic.                                      |
| Keyboard, assistive technology and custom styling          | Readouts remain understandable; interactions retain focus and keyboard semantics; frequent updates remain usable.                                            |

Use contract and integration tests for state, unit conversion, cancellation and
ownership; browser evidence for target discovery, connection lifecycle and
interaction; and audible/device evidence where a claim concerns actual musical
timing. Static checks alone do not establish these outcomes. Verification workflow
belongs to [DEVELOPMENT](../DEVELOPMENT.md).

## Current implementation and reference owners

Consult [STATUS](../STATUS.md) for the consolidated current readiness assessment and
remaining work. This design does not enlarge the supported surface by itself.
The following sources and references are starting points for implementation and
compatibility review; they do not independently define the target contract:

| Area                                              | Source and public reference                                                                                                                                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Score player and its current data/events/commands | [Play Element sources](../../packages/score/src/play/element/), [Play references](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#play); use this branch's exported player tag and owning leaf page |
| Analyze attachment and score loading              | [Player binding](../../packages/score/src/analyze/element/internal/player-binding.ts), [score source](../../packages/score/src/analyze/element/internal/score-source.ts), [Analyze reference](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze) |
| Interactive analysis position                     | [Analyze lane source](../../packages/score/src/analyze/element/internal/analysis-component.ts), [chord-analysis reference](../../apps/doc/webmusic/src/content/docs/score/element/analyze/chord-analysis.mdx)                                                                         |
| Score and keyboard views                          | [View Elements](../../packages/score/src/view/element/), [View reference](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#view)                                                                                                                     |
| Nonvisual behavior and custom composition         | [Play API](../../apps/doc/webmusic/src/content/docs/score/api/play.mdx), [Analyze API](../../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx), [View API](../../apps/doc/webmusic/src/content/docs/score/api/view.mdx)                                         |
| Shared timing and cross-domain boundaries         | [Architecture](../ARCHITECTURE.md), [shared-clock design](../../platform/shared-clock-injection.md), [current migration status](../STATUS.md#first-release-boundary)                                                                                                                     |

Audio counterparts require their own component-specific connection contracts.
Their source and public references are not in this checkout; use
[Architecture](../ARCHITECTURE.md) for the accepted boundary and
[STATUS](../STATUS.md) for migration state. Review the target branch's tracked
source and references before describing Audio behavior as implemented.

When implementation changes a public contract, update its owning reference and
demo using the applicable [page template](../docs/README.md).
Record shared decisions in [DECISIONS](../DECISIONS.md) and delivery state in STATUS;
do not turn this specification into a parallel backlog or API member inventory.
