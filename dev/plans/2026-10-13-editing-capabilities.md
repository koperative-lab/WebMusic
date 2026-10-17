# Editing capabilities: design proposal and implementation sequence

> Promotion note, 2026-10-13: P0 produced the accepted
> [editing contract](../design/EDIT-COMPONENTS.md) and
> [DEC-047](../DECISIONS.md#dec-047--document-owned-editing-and-borrowed-playback).
> The original proposal below is retained as dated evidence, including its then-open
> choices. STATUS owns current progress; runtime implementation is still pending.

> Roadmap update, 2026-10-14: the [current five-phase roadmap](../design/EDIT-COMPONENTS.md#implementation-and-reference-delivery)
> keeps P0 and P1, combines original P2–P3 into current P2 (Score workflow),
> original P4–P6 into current P3 (Audio workflow), and maps original P7 to current
> P4 (staff editing). Original P8 remains future work. The historical body below
> is unchanged; consult [STATUS](../STATUS.md), EDIT-01, for implementation.

Date: 2026-10-13. Status: proposed; implementation has not started.
Source baseline: `ef8664d`, on the `editing-capabilities` planning branch.
Related decision: [DEC-047, proposed](../DECISIONS.md#dec-047--document-owned-editing-and-borrowed-playback-proposed).
Current delivery tracking belongs to [STATUS](../STATUS.md), EDIT-01.

This records the merged Score/Audio editing discussion and its source review.
It follows the [component design template](../design/COMPONENT-DESIGN.md).
Names, markup and interfaces below are proposed contracts, not installed APIs.
The dated phase sequence is a planning baseline; STATUS remains the current
queue. On acceptance, promote the contract into `dev/design/EDIT-COMPONENTS.md`
and update the existing owners together, preserving this proposal as evidence.

## User task and boundary

Enable piano-roll note editing, single-file audio editing and later notation
editing through Web Components, Headless objects and API + UI composition.
The first useful Score milestone is MIDI import, note editing, undo/redo,
matching staff display, playback of the applied revision, and MIDI export.
The first Audio milestone is a single-file sequence with selection, structural
edits, gain/fades, undo/redo, matching playback and WAV export.

The initial release does not promise live seamless content replacement,
complete MIDI event preservation, MuseScore engraving parity, spectral repair,
multi-track project editing, collaboration or project persistence. These are
separate increments with their own contracts, not implied by an editable View.

### Existing capabilities to reuse

| Capability | Source baseline | Missing responsibility |
|---|---|---|
| Immutable Score transactions | [ScoreEditSession](../../packages/score/src/core/model/ScoreEditSession.ts) | Persistent editor, semantic commands, history, draft and selection |
| Score playback observations | [Core playback contract](../../packages/score/src/core/playback.ts) | Document identity and applied content revision, separate from existing observation revisions |
| Score scheduling | [ScorePlayer](../../packages/score/src/play/headless/score-player.ts), [scheduler](../../packages/score/src/play/headless/score-player-scheduler.ts) | Explicit paused content replacement; existing immutable timeline and rate retuning do not provide it |
| Score rendering | [View design](../design/VIEW-COMPONENTS.md), [piano-roll layout](../../packages/score/src/view/core/layout.ts) | Musical-axis editing geometry, stable hit targets and draft overlays |
| Immutable audio and transforms | [AudioClip](../../packages/audio/src/core/model/AudioClip.ts), [ClipEditSession](../../packages/audio/src/core/model/ClipEditSession.ts) | Reference-based editable sequence and bounded history; applying a batch currently materializes PCM |
| Audio playback facade | [AudioPlayer](../../packages/audio/src/play/headless/audio-player.ts) | Segment-aware playback; replacing one AudioClip currently resets its source position |
| Audio drawing and gestures | [Audio View design](../design/AUDIO-VIEW-COMPONENTS.md) | Editable document binding; annotation alone does not modify audio |
| Audio loading and offline processing | [Play API](../../packages/audio/src/play/api/index.ts), [export helpers](../../packages/audio/src/play/api/export.ts) | Explicit adapters for document loading, local processing and sequence export |
| Neutral presentation | [timeline](../../packages/ui/src/timeline.ts), [envelope](../../packages/ui/src/envelope.ts) | Reusable item/selection gestures and separate discrete-value/automation semantics |

## Composition and authority

| Owner | Owns | Borrows or delegates |
|---|---|---|
| `ScoreEditor` / `AudioClipEditor` | Current immutable document, monotonic content revision, transactions and optional local history | Loaders/processors through explicit ports; never a player or clock |
| Domain Core | Data, identity, pure transforms, document read/command contracts and position maps | No Edit, Play, View or DOM implementation |
| Play document binding | Preparing and applying content revisions, playback graph, transport and audible state | Read-only document source; never edits the document |
| View | Geometry, viewport, focus, tool interaction and draft presentation | Document state/commands, optional player state and time |
| Nonvisual declaration Element | Creation/loading and disposal of its editor | Domain resource adapters; no hidden visual editor |
| Application | Project workflow, cross-document history and persistence | Domain editors and players through public contracts |
| Bridge | Reusable cross-domain mapping and coordination | Domain contracts; no application project or history ownership |

Only the editor commits authoritative document content. History roots, drafts
and the player's last applied snapshot may coexist without becoming competing
document owners. Selection may be shared through an editor interaction session;
viewport, hover and focus remain local to a View. Selection and viewport changes
do not increment the content revision or mark musical content dirty.

### Proposed dependency and entry shape

- Score `edit` uses Core and I/O; Play, View and Analyze consume Core document
  ports and do not import the concrete editor. Renderers remain in View.
- Audio `edit/headless` uses Core and injected asset-reader/loader/processor
  ports. Audio has no current I/O capability: its loaders and effects live in
  Play. Play implements sequence playback and processing adapters against Core
  contracts, without importing Edit.
- For declarative Audio `src` loading, the recommended first integration is a
  narrowly reviewed browser-declaration adapter to the existing Play loader.
  This needs an explicit layer-scoped policy exception; it does not authorize
  general Edit-to-Play or Edit-to-View imports. Resolve this in P0 before adding
  the declaration. A future I/O extraction is a separate architectural change.
- Proposed entries are domain `/edit`, `/edit/headless`, and `/edit/element`
  where implemented. Add registration entries only with real declarations.
  Do not create `/edit/render` merely for symmetry: the first surfaces reuse
  View renderers and their structural editor binding.
- UI owns domain-neutral geometry, controls and gestures; snapping, pitch,
  time conversion and legal edits belong to domain bindings. Do not extract a
  Kernel history abstraction before both implementations establish a concrete
  shared contract and ownership requirements.

Review the complete [executable policy table](../ARCHITECTURE.md#executable-policy-and-documentation-authority)
for every new entry: manifests, build mappings, optional peers, registration
side effects, layer/capability policy, composition rules, catalogs and references.
No manifest or policy is changed by this planning task.

## Inputs, outputs and units

| Contract | Meaning and proposed rule |
|---|---|
| Document identity | Stable `documentId` across edits and undo; a replacement document has distinct identity |
| Document revision | Monotonically increasing committed content version; undo/redo creates a new revision even when restoring an old root |
| Expected revision | Commands and asynchronous work identify their base revision; stale work fails or is superseded, never silently rebased |
| Score position | Rational quarters for musical editing; nominal seconds for current Play boundaries, converted through the appropriate TimeMap |
| Score pitch | Written pitch stored in Score; an explicitly selected concert-pitch display applies and reverses Part transposition once |
| Audio source position | Integer source frames at the asset's declared sample rate, using half-open ranges |
| Audio document position | Integer frames at the document's declared output sample rate; seconds are a display/Play boundary conversion |
| Commit result | New content identity/revision, semantic operations, affected IDs/ranges and an old-to-new position mapping |
| Playback application result | Applied, superseded or failed for a requested document revision; distinct from the document commit result |

Preserve existing Score playback `revision` (snapshot publication) and
`sourceRevision` (playback source replacement). Add separately named document
identity/revision fields without repurposing those counters. Existing static
sources remain usable without claiming an editable document identity.

### Score musical policies

P0 must make the following choices executable before gesture implementation:

- Musical move/resize/quantize commands explicitly synchronize written and
  performed timing under the selected policy. Imported MIDI's existing
  `performed` override must not make an edit disappear in playback or export.
  Performance-only editing and preservation of microtiming offsets are separate
  options, not inferred from the current drawing.
- Define velocity edits for notes without a performed overlay without silently
  freezing tempo-derived timing. Do not migrate public Note fields incidentally
  while adding a velocity lane.
- Commands target authored note IDs in the first release. Repeated playback
  occurrences keep separate occurrence IDs; changing one repeated occurrence
  independently is outside the first release.
- Specify copied/split-note identity, ties, overlap selection, inverse pitch
  transposition and snapping. MIDI-origin polyphony must not be normalized into
  fully filled notation voices as a side effect of piano-roll editing.
- Tempo, meter and repeat-structure authoring can follow the first note-editing
  milestone, but replacement must handle existing variable-tempo/repeated input
  with a declared position policy or explicitly report unsupported structures.

### Audio document and asset policies

Use an immutable sequence of asset references and explicit silence spans from
the first Audio editor. An asset retains its source sample rate/channel layout;
a segment identifies its asset, source range and any gain/fade parameters.
The single-file sequence has ripple deletion/insertion semantics. It can share
primitives with a later arrangement without inheriting arbitrary multi-track
overlap, routing or automation behavior.

Recommended initial format policy: the first asset establishes document output
sample rate and channel layout. Cross-format paste is rejected with an actionable
result until an explicit normalization adapter is selected. Never add source
frame counts from different sample rates or silently discard channels.

Structural edits and their history share PCM. Gain/fades can be segment
parameters. Materialized DSP processes only the selected range plus declared
pre-roll, latency and tails, creates a new asset, and commits its reference.
Reuse ClipEditSession for appropriate bounded processing rather than document
storage. Full sequence rendering is an explicit export/analysis operation, not
the ordinary edit-commit or undo path.

Every structural command maps selection, playback position, loops, regions and
beat-grid data. Distinguish markers attached to content from markers at fixed
document positions, and define what happens when their content is deleted.
Source peaks can be reused for structural projection; processed samples,
resampling and spectral windows at splice boundaries require invalidation.

## State, commands and history

Use semantic operations such as note move/resize and audio delete/trim/paste,
not DOM mutations as commands. A gesture begins at an expected revision, updates
a local draft, and commits once on release. Escape, pointer cancellation,
source replacement or conflicting external revision cancels the draft. Invalid,
canceled and no-op commands do not create history entries.

Separate preview, content-commit, selection and failure notifications. Retain
the domain event prefixes. A subscriber may synchronously edit, rebind or dispose;
subsequent notification work must re-check revision and ownership. The first
history implementation can restore immutable document roots with bounded
retention; it need not invent inverse commands for every operation.

Local history is optional. Application-owned history receives complete atomic
transaction boundaries and can restore content without feeding another local
undo stack. History ownership, saved-content identity, clipboard lifetime and
selection restoration are explicit; cross-document transactions and storage
remain application responsibilities.

## Session time and revision application

The first player integration uses paused application, not seamless live edits:

1. A document commit publishes its new revision and position map. The Play
   binding invalidates prior preparation work and pauses old playback if needed.
2. Prepare the candidate scheduling snapshot using borrowed resources. Keep
   document commit success independent from playback preparation success.
3. Apply the candidate revision, mapped position, rate and valid loop state as
   one coherent playback update. Only then report that revision as applied.
4. Leave the player paused by default. An optional resume-previous-intent policy
   can be added only with a generation check so a later stop/pause always wins.
5. On failure, preserve the edited document, retain the last applied revision
   as diagnostic state, expose an error and gate ordinary playback until retry
   succeeds or the caller explicitly detaches. Never silently play stale content.

Candidate preparation also records a transport-command generation. At apply
time, a newer stop, seek, rate or loop command invalidates the captured transport
state even when playback will remain paused. Preserve the latest command intent
using its declared coordinate/revision, or supersede and prepare again when that
intent cannot be mapped safely. In particular, stop-to-origin must remain at the
origin; an obsolete candidate cannot restore an earlier nonzero playhead.

The first Score application path targets the native single-Score owner backed
by ScorePlayer. Reject conflicting external-controller/Rack configurations before
changing a working binding; these modes do not currently provide one native
Score playback source. Other player modes/backends gain document binding only
with explicit capability and replacement tests, not by inheriting an attribute.

Expose a way to await one document revision's playback application. A later
revision, replacement source or disposal settles obsolete requests; they cannot
hang indefinitely or claim success for a different revision.

Views may show newly committed content while Play prepares it, but must withhold
incompatible active-note overlays and seek commands until revisions match or an
explicit mapping is available. Analysis outputs also carry source identity and
revision so late reports cannot overwrite new content.

Preserve musical position under rate changes, and use the commit's position map
for insertion/deletion. Repeats need occurrence-aware mapping or a documented
reset policy. Re-clamp loops after shortening content. Score's existing retune
logic is a useful cancellation reference, not a content-replacement solution.
Keep one transport authority and keep context/synth ownership visible.

Position maps must compose from the player's last applied revision to the target,
including skipped/superseded revisions and undo/redo. If Play remains at revision
1 while revision 2 fails and revision 3 commits, the latest 2-to-3 map alone is
insufficient. Retain the required mapping chain while consumers need it, or use
an explicit documented reset when no valid mapping remains. Deleted positions
need a defined boundary result; an undo map is not automatically an invertible
arithmetic transformation.

For Audio, add a segment-aware Play engine consuming Core sequence snapshots.
It must schedule source ranges without rendering the whole sequence per commit,
seek or undo. Initial decode and reusable playback caches are separately budgeted;
reference-based history alone does not establish bounded long-file decoding.

Extend Audio source observation to identify a sequence document and its applied
revision independently of the transport object and optional current AudioClip.
The existing clip-only source notifications cannot identify a new sequence
revision on the same transport. Do not present the sequence's first asset as
the entire edited content. Clip-only companions report unavailable data or use
an explicit materialization adapter; graph-based monitors may continue borrowing
the playback graph under their existing contract.

## Interaction and declarative composition

The first editable surfaces are existing `score-view type="piano-roll"` and
`audio-view type="waveform"`. Other types remain useful followers without an
automatic editing promise. A staff input prototype will determine whether its
keyboard/focus contract fits `score-view type="staff"` or needs another Element.

Illustrative declaration syntax; these tags and attributes do not exist yet:

```html
<score-document id="piece" src="/example.mid"></score-document>
<score-player id="player" editor="#piece"></score-player>
<score-view type="piano-roll" editor="#piece" player="#player" editable></score-view>
<score-view type="staff" editor="#piece"></score-view>
```

The nonvisual declaration owns its editor and exposes a read-only `.editor`
reference. Object-property injection supports Headless/application-owned editors.
Player consumes a read-only port even if the convenience property is `.editor`.
The markup does not make a View the lifetime owner of shared content.

| Configuration | Proposed result |
|---|---|
| Editor bound, `editable` absent | Display committed editor content; no document mutation gestures |
| Editor bound, `editable` present, supported type | Enable supported commands and local keyboard interaction |
| `editable` without a ready editor | Explicit unavailable state; no implicit private editor or fallback source |
| Editor plus independent explicit data/`src` | Configuration conflict reported before replacing a working binding |
| No editor | Preserve existing data precedence and player-following behavior |
| Incompatible player document/revision | Keep content visible, expose mismatch/pending state, gate incompatible interaction |

Use the existing same-root selector discovery rules: unique target, late
insertion/upgrade, removal/replacement, reconnect and stale-load invalidation.
Disconnecting a borrower releases its subscriptions and drafts, not the editor,
player or AudioContext. Removing an owning declaration invalidates borrowers;
an external editor supports a lifetime independent of visible DOM.

Each primary-pointer gesture has one owner. In edit mode, item drag and selection
must not also issue seek/scrub/annotation commands. Keep explicit tools for these
operations; mode changes cancel in-progress gestures. Define keyboard operations,
focus, screen-reader feedback, text-input exclusions and application shortcut
override. Existing View modes keep their original behavior by default.

UI work should first reuse timeline, stage and selection mechanisms. Extract
an item-grid gesture presenter only around demonstrated shared geometry; expose
domain callbacks for snapping and legality. Discrete note velocity values and
continuous/stepped automation curves have separate data semantics. Staff glyph
layout and musical input semantics remain in Score.

## Resources and failure

| Resource | Lifetime and failure rule |
|---|---|
| Immutable document roots | Retained by current state/history; pruning history does not invalidate live consumers |
| Audio assets | Retained while referenced by document, history, clipboard, playback or a task; release after the last lease |
| Load/processing jobs | Carry source identity, expected revision and cancellation generation; stale output is released without committing |
| Player/context/synth | Play owns created resources and preserves borrowed-resource contracts during replacement |
| Renderers/presenters | View owns DOM, drawing caches and listeners; unmount cancels local gestures |

Candidate construction and cleanup must handle reentrancy, repeated disposal,
partial failure and context readiness. Asset readers must support bounded ranges
without using full-channel copies for ordinary structural edits. Export may
materialize output explicitly, with its own memory/cancellation contract.

## Implementation sequence

Each increment includes its source, regression coverage and owning reference.
The steps below are dependency boundaries suitable for separate reviewable PRs;
they are not claims that any implementation has been completed.

| Phase | Deliverables and owning surfaces | Dependencies | Exit evidence |
|---|---|---|---|
| P0: finalize contracts | Resolve the decision table below; accept/refine DEC-047; promote the design; reconcile Product, Architecture, binding/View owners and entry policy with implementation scope | This proposal | One unambiguous source/ownership contract, command schema, time policy and compatibility plan; no invented public API in existing references |
| P1: Score editor foundation | Core read/command ports and position maps; `/edit/headless` owner around ScoreEditSession; semantic note commands, selection, draft transactions and optional bounded history | P0 | Stable IDs; atomic edits; cancel/no-op behavior; monotonic undo revisions; written/performed consistency; stale/reentrant command tests; DOM-free imports |
| P2: Score playback and declaration | Native single-Score Play revision application and acknowledgements; candidate prepare/apply/failure lifecycle with transport generations; nonvisual owner, object and selector bindings in Play/View | P1 | One load shared by multiple consumers; version-aware seek; failed preparation preserves edits; newer stop/rate/loop commands win over late preparation; incompatible controller/Rack modes fail explicitly; reconnect/replace releases only owned resources |
| P3: piano-roll workflow | Musical-axis projection, stable hit targets, visible-window rendering, select/draw/move/resize/delete/copy/paste, snap, velocity controls, keyboard and gesture preview | P1-P2 | First Score milestone below, narrow/wide and keyboard/pointer checks, overlapping-note selection, local focus, one undo per gesture |
| P4: Audio sequence foundation | Core assets/segments/sequence and position maps; editor/history/clipboard; output format policy, asset leases and injected resource ports | P0; informed by P1 protocol tests | Structural edits share PCM; ripple/marker/loop mappings correct; history pruning and canceled tasks release assets correctly; explicit cross-format failure |
| P5: Audio playback and declaration | Segment-aware Play engine, sequence-aware source observation and revision acknowledgement, bounded reads/caches; decoder adapter and nonvisual declaration; existing player facade integration | P4; protocol behavior from P2 | Commit/undo/seek does not fully render output; same-transport revisions notify consumers; clip-only consumers expose unavailable data; segment boundaries and loops render expected samples; stale work cannot resume playback; source and document axes agree |
| P6: waveform workflow and local processing | Editable audio-view binding, selection/tools, segment waveform projection, gain/fades, bounded local DSP, explicit WAV export | P4-P5; suitable gestures from P3 | First Audio milestone below, allocation instrumentation, processing cancellation/failure, affected-cache invalidation, keyboard/channel-selection acceptance |
| P7: notation input | Prototype cursor/voice/duration entry; choose the Element boundary; implement rests, spelling, measure rules, ties and local reflow in small reviewed subsets | P3 and a separate notation contract | Note identity shared with piano roll; defined overwrite/insert semantics; music fixtures verify voice durations and cross-measure ties; no engraving-parity claim |
| P8: later project capabilities | Multi-track arrangement, cross-domain project transactions, seamless live revision application, CC/bend lanes, automation, spectral repair and page editing as separately scoped work | Relevant preceding phases and further decisions | Each capability gets its own contract and measured evidence; a mixer offset or MIDI track alone does not establish a DAW |

Execute P0-P3 first to prove the complete Score path. P4 can be researched in
parallel after P0, but stabilize revision/failure semantics in P1-P2 before
duplicating the public protocol. UI extraction follows a real consumer; do not
make a universal grid or Kernel history a prerequisite for the first editor.

### Decisions to close in P0

| Choice | Recommended starting point | Must be resolved before |
|---|---|---|
| Declaration names and selectors | Nonvisual `score-document` / `audio-document`, borrowed `.editor` and `editor="#id"`; names remain provisional | P2/P5 public registration |
| Score timing and velocity | Explicit synchronized musical edits; preserve velocity; define overlay handling and precision before adding commands | P1 |
| Play implementation seam | Stable public Play owner with candidate preparation and internal timeline replacement; reuse existing scheduler/graph behavior | P2 |
| Playback update policy | Pause on content update, apply atomically, remain paused; expose applied/superseded/failed and retry | P2/P5 |
| Repeat and position policy | Edit authored notes; explicitly map surviving occurrences or reset to a declared boundary | P2 |
| Local history and application integration | Bounded immutable roots; history opt-out with complete transaction output; separate saved-content identity | P1/P4 |
| Audio sample/channel policy | First asset sets output format; explicit conversion adapter or rejection for incompatible paste | P4 |
| Audio loader dependency | Narrow browser-declaration adapter to existing Play loading; keep Headless Core-only | P0 policy design, implemented with P5 |
| Staff Element boundary | Decide from a keyboard/focus prototype; preserve read-only staff and sheet behavior | P7 |

## Acceptance

### First Score milestone

Import MIDI into one editor; attach a piano roll, a read-only staff View and one
player. Move/resize a note and change velocity. Both views show the same committed
content; one undo restores a gesture. Await player revision application, then
audition and re-import the exported MIDI. Timing/pitch/velocity match the selected
policy within the declared MIDI resolution. Notation inferred from MIDI is not
compared as authored MusicXML engraving.

Force candidate playback preparation to fail: edits and export remain available,
the playback version is not falsely advanced, and stale sound is not played.
Stop while preparing, supersede the revision, undo while preparing, and disconnect
the owner; none may cause a late restart or stale acknowledgement. Include variable
tempo, non-unit rate, repeated notes and explicit data/editor conflicts.
Assert that stop retains position zero and later rate/loop commands retain their
values after preparation completes, not merely that sound stays paused.
Verify position/loop mapping from the last applied revision across multiple
skipped commits and undo/redo, including the declared reset fallback.

### First Audio milestone

Load one asset, make structural edits, apply gain/fades, undo/redo, play the
sequence, and export WAV. Compare deterministic offline samples with the expected
edit result, including splice/channel boundaries and mapped regions/loops.
Separate audible browser acceptance from deterministic render evidence.

Instrument an asset reader/allocator using a fixed asset and repeated structural
edits plus undo/redo. Retained PCM must not grow by full-source length per history
step; playback application must not invoke full-sequence render. Measure initial
decode, reusable AudioBuffer caches, local DSP output and export separately.
Local processing allocation scales with its range, required tails and bounded
concurrency. Verify that assets remain alive for clipboard/playback/jobs after
history pruning, then become reclaimable after their final consumer releases.

### Verification and documentation delivery

Use focused Core/Edit/Play tests for semantics and failures, then built public
entry and optional-dependency checks. Use browser tests for selection, shortcuts,
focus, screen-reader semantics, touch/pointer cancellation and multiple views.
Record actual audio continuity, memory/latency observations and device behavior
separately from static checks.

For each implementation increment, update the applicable Element, Headless, API
and UIKit references using [the owning templates](../docs/README.md); add catalogs
and runnable demos only for implemented members. Follow [Development](../DEVELOPMENT.md)
for focused checks, `npm run check`, and `npm run docs:build` when site source
changes. Rebuild packages before declaration consumers. Update STATUS from actual
evidence and retain dated audit results without treating them as future acceptance.

## Compatibility and design promotion

The proposed decision refines DEC-001's application-owned undo boundary for
optional single-document history and extends DEC-011/015/017 for document-bound
editing. It does not retrospectively change those accepted records. P0 updates
the owning Product/Architecture and Score/Audio View/Play/binding contracts with
explicit accepted-target versus implemented boundaries. Existing passive views,
standalone players and source precedence stay compatible outside editor mode.

The planning branch contains documentation only. No public editing tags, exports,
renderers, processing engines or playback guarantees are delivered by this file.
