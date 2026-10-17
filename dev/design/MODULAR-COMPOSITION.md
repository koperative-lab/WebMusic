# Modular Score and Audio composition

Status: accepted contract with opt-in composition, shared sound/modulation,
Session scheduling and versioned project APIs.
Current verification and remaining stages belong to [STATUS](../STATUS.md).
Related decisions: [DEC-047](../DECISIONS.md#dec-047--modular-composition-separates-resources-routing-and-session-authority)
and [DEC-048](../DECISIONS.md#dec-048--session-scheduling-is-a-borrowed-anchor-projects-store-declarative-identity).
Layers: neutral Kernel contracts, domain Headless runtimes, structural UI bindings,
and declarative Elements. Shared public entries are Kernel `/module`, `/session`,
`/effect` and `/element`; domain runtimes remain in their Play Headless entries.
Delivery owner: [STATUS](../STATUS.md), MOD-02 through MOD-12.

## User task and boundary

Start with one player, then add a mixing Rack, effects, sound controls and
analysis without duplicating its engine or parameter state. A Rack inspector,
an embedded panel and an external panel can edit the same running effect.
Headless applications and custom UI must have the same composition capabilities.

This contract fixes semantics for the modular redesign. `ModuleContext`,
`InsertChain`, `SessionTransport` and the opt-in attributes below are implemented
public surfaces. The [Kernel API](../../apps/doc/webmusic/src/content/docs/kernel/api.mdx)
and domain references own concrete signatures and defaults. Shared-anchor
scheduling and project restoration follow DEC-048; their backend limits remain
explicit. [Player binding](PLAYER-BINDING.md) retains
ownership of data/state attachment; [shared-clock injection](../../platform/shared-clock-injection.md)
retains ownership of the detailed clock consumption protocol.

## Composition and authority

Four relationships remain independent:

| Relationship | Determines | Invariant |
|---|---|---|
| DOM layout and scope | Presentation and implicit capability discovery | Containment does not grant disposal or scheduling rights |
| Resource ownership | Creation, retention and disposal | One owner per resource; ownership is acyclic |
| Port connections | Audio, notes, control and observations | Typed directed edges; binding a panel adds no audio edge |
| Session membership | Coordinated play, pause, seek, rate and loop | One command authority per coordinated Session |

Module IDs are immutable. DOM IDs, labels and registry path aliases can change;
resolved connections retain stable identity. DOM selectors and registry paths
are separate interfaces. A parent can access a nested Rack's exported ports and
parameters, not its private graph. Capabilities are optional: unavailable is
different from a valid zero, empty score, silent signal or paused player.

Source role (`owned`, `borrowed`, `none`) and Session ownership (`owned`,
`borrowed`) are independent dimensions. Borrowing source data does not imply
borrowing its player, scheduler or command authority. Runtime configuration
must declare those resource relationships separately and reject invalid
combinations before replacing a working instance.

## Inputs, outputs and units

Every port declares stable identity, direction, signal family, multiplicity,
schema version and readiness. Validate both endpoints before connecting.

| Family | Required semantics | Boundary |
|---|---|---|
| `audio` | Context identity, channel layout/conversion and declared latency | PCM routing; different contexts require explicit re-preparation or an adapter |
| `control` | Unit, range, polarity, supported rate and add/multiply/replace operation | No implicit Hz/dB/cents/normalized-value conversion |
| `note` | Unique occurrence ID, source identity, pitch representation/unit, velocity/gate, named time axis, timestamp and scheduling epoch | Note-off/cancel targets its occurrence; a display event is not a scheduling contract |
| `transport` | Session identity, named position axis, revision, read/command capabilities and command outcomes | Audio reference seconds and content position are different values |
| `source` | Domain/schema identity, coherent snapshot revision and subscription semantics | A multi-source Rack does not fabricate a single Score or AudioClip |

Audio ports may sum through a declared bus. A single-source input rejects
conflicting producers. Note-to-audio needs an instrument; audio-to-note needs
an explicit analysis adapter. Source observations and visual note notifications
do not create playback participants.

Neutral audio/control capabilities interoperate without Bridge or imports
between Score and Audio. Bridge supplies reusable composition that knows both
domain models, including domain time mappings and data conversion. A neutral
transport/source envelope alone does not require Bridge.

## Context discovery and binding

Headless composition receives an explicit ModuleContext. The browser adapter
uses one bubbling, composed `webmusic-context-request` capability request. Provider recognition uses capabilities, not tag names.
No per-component Element Adapter layer is introduced.

ModuleContext lends audio environment identity/readiness, revisioned default
route slots, a module scope, and optional Session/source capabilities. These
are separate capabilities; a destination AudioNode is not a Session. Rack
providers override local routing/scope and pass through the borrowed Session.
Player providers may add instrument/source capabilities without replacing the
upstream audio destination with their own instrument input. A player's implicit
panel target exposes its supported instrument parameters and local InsertChain;
the Rack provider does not silently promote that target to its master chain.

Binding rules:

1. Explicit object binding wins over an explicit unique selector, which wins
   over context discovery. An invalid explicit target never falls back.
2. Selectors resolve within the current Document or ShadowRoot. Cross-root
   binding uses an object or provider; composed events do not permit private
   shadow-tree scanning. An unset object permits defaults; explicit null unbinds
   and suppresses implicit resolution.
3. The nearest applicable provider claims a request once. Requester identity
   must survive event retargeting; a provider ignores its own upstream request.
4. A declared inner boundary that is pending or lacks a capability prevents
   accidental borrowing from an outer Session. Late custom-element upgrade
   must not temporarily connect through that boundary.
5. Synchronous discovery is followed by generation-aware subscription and
   revocation. Late insertion, upgrade, replacement and reconnect cannot revive
   stale bindings. Explicit replacement with the same selector creates a new
   binding generation, not an identity transfer.
6. Discovery creates/resumes no AudioContext, requests no device, and grants no
   close/dispose permission. Consumers own their binding subscriptions.

## Audio routing and default connections

Each source has its own local processing path. Rack member channels sum into
a real master bus; master effects process the sum once. Parent Racks register
only a child Rack's public output, never also its grandchildren's audio outputs.
AudioMixer has real channel/master nodes. Each Rack/Mixer channel exposes
`channelInserts(id)` after its fader; the master has a separate InsertChain.
An analyser borrows a named tap on this graph.

```text
source -> local inserts -> Rack channel -> master inserts -> upstream bus
                |                              |
                +-- explicit send              +-- analyser tap
```

The diagram omits fader stages. Existing Score/Audio `.effect` placement remains
after gain/pan. New pre/post stages must be named; migration must not silently
change the order. Sends declare pre/post-fader placement and mute/solo policy.

A player providing a Session is not implicitly an audio master. If it has its
own source and contains a Rack, its source and that Rack's master each use one
route to separate channels of the nearest upstream Rack, or to the audio
environment's declared default destination when no upstream Rack exists. The Rack
does not route into the parent player's source/effect input. The parent's `.effect` affects its own
source only; common processing requires an explicit outer Rack/bus. A source-free
aggregate player exposes no fabricated aggregate audio output; source-local
effect commands are unavailable until a compatible source is explicitly supplied.

Normalled connections are named default RouteSlots with observable owners and
revisions. A route arbiter owns their activation; the patch declarer owns its
connection lease.

| Operation | Required result |
|---|---|
| Default admission | One active default main path for that slot |
| Replace | Suppress only the named default path after candidate validation |
| Second replace claimant | Reject unless explicitly replacing the current connection ID/revision; no hidden stack |
| Send or tap | Add a distinct branch without suppressing the main path |
| Failed candidate | Preserve the previous valid route and state |
| Explicit unpatch | Restore the current default only if endpoints, scope and provider revision are valid |
| Declared patch target disappears | Become unresolved and silent on that route; do not restore speaker output automatically |
| Scope exit or disposal | Revoke old leases; late cleanup cannot reconnect the old parent |

The connection manager must account for shared physical edges: Web Audio
connections are not independent merely because two callers hold leases.
Deduplicate/reference-count a shared edge or reject duplicate ownership; one
lease must not disconnect another consumer. Never globally disconnect a borrowed
node to release a single connection.

Admission checks context identity and controlled output switching. Prefer
injecting context/destination before preparation. Moving an already connected
same-context player requires revoking its old default destination atomically
at the logical level; merely connecting its analyser to Rack would duplicate
output. A transport-only object is not an audio member. Cross-context migration
requires explicit pause/reprepare or a supported bridge, never an engine clone.

The first delivery rejects self-connections and cycles among managed audio
edges. It cannot inspect arbitrary internal connections in caller-supplied
AudioNode graphs. Note/control graph cycle validation belongs to their later
routing implementations; deliberate modular feedback needs a separately
reviewed delay, gain and stability contract. Existing effect-internal feedback
remains the effect backend's responsibility.

## Effects, parameters and panels

Effect definitions are reusable recipes. An EffectInstance owns one realized
graph in one context. Reusing a definition creates another instance; multiple
panels must bind the same instance ID to edit the same sound.

InsertChain owns stable same-context boundary ports, ordered slots, instance
identity, parameter handles and graph revision. It is the common target for
player, channel, master and standalone insert processing. Existing `.effect`
manages one reserved compatibility slot before explicit slots in its existing
post-fader stage; its setter changes only that slot and preserves player identity,
play state and position. Initial declarations establish order. Later layout-only
DOM moves do not reorder sound; an explicit chain command changes audio order.
Adding/removing declarations changes the corresponding configuration.

Unification must reconcile live/offline context support, candidate failure,
precise edge ownership, unsafe node overlap, borrowed nodes and repeated cleanup
before extracting shared implementation. Kernel's current
[effect contract](../../platform/kernel/src/effect.ts) deliberately leaves
different cleanup implementations in the domains. Keep public effect catalogs
compatible; do not move every DSP algorithm/dependency into Kernel by default.

ParamSurface enumerates ParamHandles; each handle owns parameter state, metadata,
commands and subscriptions. ParamMapping describes one controller's scaling,
depth, polarity and combination with the target. The parameter's legal range
is not its LFO depth or a macro's mapping range. Descriptors name unit, default,
range/scale, update timing and modulation capability. Base value and effective
readback are distinct; readback is unavailable, estimated or sampled with an
explicit timestamp/rate. UI receives structural projections, not a dependency
on Kernel or domain runtime types.

Synth Panel has two explicit ownership modes:

- Attached: borrow a target instance through context or explicit binding.
  Sections, collapse and unmount affect presentation only. A missing target
  remains unresolved, not a request to construct an independent insert.
- Standalone insert: the Element owns its Headless insert runtime and retains
  stable input/output and cleanup. Its existing sections-to-DSP behavior remains
  in the compatibility adapter; a pure presenter itself owns no DSP.

Sound capability determines which controls work. Native per-note ADSR belongs
to the instrument; a voice captures its envelope at onset and an early release
starts from its current level. Global envelopes and followers are independent
modulators. A logical CV bus is per backend/context/parameter, with explicit
current/future voice fan-out, unit conversion and base-value accounting.
Connected AudioParam inputs add to intrinsic values; `.value` is not total
effective readback. Callback, scheduled, k-rate and a-rate capabilities differ;
unsupported precision cannot silently downgrade.

`ParamHandle` owns the base and scheduled automation. A native control bus feeds
the oscillator's current and future voice AudioParams once; per-note velocity
and ADSR remain separate gain stages. `ControlLFO` produces an audio-rate signal,
and additive mappings declare their depth in the target's native unit.
`ParamMacro` maps a normalized gesture into explicit base-value ranges on those
same handles. Mapping ranges are neither parameter legal ranges nor effective
signal measurements. Legacy callback descriptors remain compatibility surfaces;
they do not acquire audio-rate capability by being shown beside native controls.

## Session time and commands

In the new opt-in composition, the outermost player provides Session authority;
nested players borrow the nearest Session unless explicitly independent.
Rack provides mixing and passes through that authority. A Rack without a Session
provider does not silently synchronize its independently owned players.

| Configuration | Source role | Session role | Scheduling |
|---|---|---|---|
| Standalone player with a source | Owned or explicitly borrowed data | Owned | Its engine is one participant |
| Nested player with a source | Owned or explicitly borrowed data | Borrowed | Its engine joins the ancestor Session |
| Source-free aggregate root | None | Owned | Headless SessionTransport conducts participants; no fake source/engine |
| Transport-only control view | None | Borrowed | Commands/readback only; not another participant |

The aggregate root uses a named Session-seconds axis and never chooses the
first DOM child as a hidden master. Duration follows mapped member ranges;
unloaded/live/unbounded members produce pending/unknown duration or an explicit
Session range. By default finite members all ending ends the Session; live or
unbounded members require stop. Explicit Session range/loop policy overrides
that default. An externally supplied master must declare its axis and removal
behavior; losing it pauses/reconfigures rather than silently electing another.

Commands extend DEC-018 and existing TransportGroup outcomes: committed,
superseded or failed. Only the authority writes coordinated intent. Internal
participant adapters call engines, not Element methods that delegate back to
the Session. Every leaf registers once, even under nested Racks. An independent
child Session stops ancestor participant traversal.

Every seek names its position axis; offset/rate mappings are explicit. Score
nominal seconds, rate-scaled seek seconds, clip seconds and reference time are
not interchangeable. Neutral coordination uses Kernel math; Bridge owns
Score/Audio semantic mappings. Shared starts do not align different recordings'
beats automatically. Preserve legacy Rack group-axis and nominal-seek rejection
contracts; new aggregate Session seconds do not redefine old methods.

Joining/rejoining establishes one coherent snapshot before scheduling. Leaving
cancels only that member's old future work and unregisters it before new authority
can schedule. It does not stop other members. Changing DOM scope cannot silently
switch a playing engine's Session. Inherited transport controls hide by default;
an explicitly shown extra control view still sends commands to the same authority.

Native module participants consume `SessionSchedulingBinding` after preparation.
One authority publishes invalidation before replacement anchors, and domain
schedulers cancel/re-arm only their own work. Its continuous mapped clock and
loop-folded future segments are separate reads. Session-relative automation and
LFO phase use that same anchor; absolute audio-clock automation and free-running
LFOs retain their independent role. Legacy/media participants remain explicitly
approximate. Graph revisions, binding generations and transport epochs have
different jobs; shared reference time does not establish measured device latency.

## State, resources and failure

Resolution uses observable unresolved/preparing/ready/error/detached states;
disposal is terminal. Playback and pending parameter commands have separate
state. State commits precede observer notifications; callbacks may re-enter.
Late async work validates generation before commit and releases only its own
resources. Retry is explicit after a failed operation; it cannot revive disposed
or superseded instances.

| Resource | Owner and release responsibility |
|---|---|
| AudioContext | Creator closes it; borrowed consumers never close it |
| Player, instrument or module | Declared runtime/Element owner; registration borrows unless transfer is explicit |
| Rack-created channels, buses and effects | Rack/runtime owner; external borrowed instances retain their owner |
| Effect graph and nodes | EffectInstance/chain contract; candidate cleanup preserves borrowed/live nodes |
| Route or registration | Its lease/arbiter; release is precise and idempotent |
| Panel/presenter | Its mount owns DOM/listeners/subscriptions; attached target outlives the panel |
| Voice, worker, stream and scheduled work | Creator or authorized scheduler; cancellation is scoped to owned work |

Unregistering a borrowed player does not dispose it, resume it or implicitly
restore an old destination. After output takeover, default detach leaves it
alive but unrouted; explicit restore validates the original target. Removing
an owning Element retains its owned-disposal contract. Persistent audio while
replacing its UI requires an application/Rack-owned runtime and borrowed views.

Graph edits use prepare, validate, logical commit and retire. Candidate failure
keeps the working graph. Cleanup continues after an individual release failure.
Web Audio connect/disconnect is not a hardware-atomic transaction: crossfades,
gain ramps, pause/rebuild, bypass state and cut/drain tails require explicit
backend policies. Same-scope layout moves can preserve identity; cross-scope
or cross-context migration does not promise uninterrupted sound.

`TransitionInsertChain` supplies an explicit whole-generation option: stable
outer ports, a linear crossfade and optional bounded outgoing tail. Each
replacement creates fresh owned effects and parameters; bindings do not migrate
implicitly. Old handles live only until their audio-clock retirement. Ordinary
InsertChain slot edits and player `.effect` setters retain their existing
immediate retirement/reuse behavior.

## Declarative composition and compatibility

The first delivery enables this composition through `composition="modules"`.
The opt-in isolates new discovery/routing from the legacy descendant-Rack
selection path; both must never run for one instance. Configure composition
and scope before connecting Elements. The MIDI URLs are application assets;
the [runnable guide](../../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx)
provides a complete demonstration.

```html
<score-player id="session" composition="modules">
  <score-rack-control id="desk">
    <score-player id="lead" src="lead.mid">
      <score-effect id="leadDelay" type="delay" time="0.25"></score-effect>
      <score-synth-panel sections="sound,envelope,effects"></score-synth-panel>
    </score-player>
    <score-rack-part id="bass" src="bass.mid"></score-rack-part>
    <score-effect slot="master" type="reverb"></score-effect>
  </score-rack-control>
</score-player>
<audio-spectrum-analyzer input="#desk" port="master"></audio-spectrum-analyzer>
<score-synth-panel target="#leadDelay" sections="effects"></score-synth-panel>
```

The root owns a source-free Session. Lead and the player represented by the
bass declaration register once each. Lead's delay feeds its desk channel; bass
feeds another. Desk's reverb processes their sum once. The spectrum analyser
taps desk's master without replacing its main route. Both the lead panel and
external effect panel edit the existing delay instance. A nested
`score-note-input` can additionally borrow the leaf instrument's note capability;
each occurrence belongs to its input source and exact note-off never targets a
different source merely because its pitch matches.

Audio uses the same ownership/routing rules with `audio-player` containing
`audio-mixer` and borrowed child players. An AudioPlayer facade must not implement
this by recursively borrowing another AudioPlayer facade. Output admission and
participant adaptation are separate capabilities. The new aggregate role uses
a Headless SessionTransport, while legacy clip/queue/mix facade selection still
adds no clock (DEC-029).

`session="local"` establishes an independent Session boundary;
`controls="auto|show|hide"` affects only transport visibility; `target` selects
an attached panel; `mode="insert"` explicitly selects a standalone insert;
analyser `input` plus `port` selects a tap. Explicit Rack registration changes
neither ownership nor Session membership. The object binding for an attached
panel is `.moduleTarget`; its older `.target` property retains the standalone
LFO target contract.

Keep the existing source and reference contracts in
[Score Play](PLAY-COMPONENTS.md) and [Audio Play](AUDIO-PLAY-COMPONENTS.md).
Do not revive retired tags or change current defaults to simulate target syntax.
Review public entries, dependency DAG, registration/composition policies, parameter
catalogs, types, examples and owning references together when implementing each
surface. Kernel's `ModuleProject` stores schema/plugin versions, stable IDs,
asset references, base parameters, mappings, connections, automation and Session
state separately from UI layout. It does not serialize AudioNodes, DOM objects,
functions, sample payloads or active voices. The application retains asset
resolution, persistence and undo policy.

`ModuleProjectRuntime` stages owned candidate modules and a new Session behind
an output gate, borrowing the supplied audio environment. Invalid documents or
failed factories/assets leave the active graph intact. Missing plugins and
unsupported endpoints remain explicit unresolved records, retained on export and
retry. An unresolved replacement owns a silent route; it never falls back to
speakers. Restore defaults to paused and can cut retired effects' tails. Layout
and label/order commands preserve current instances; connection/CV edits manage
precise leases without rebuilding all modules.

The Kernel editor adapter projects this graph into structural UI state. UI Kit's
`mountPatchEditor` borrows it and owns no graph, Session or project storage.
Native select controls, port buttons and connection-list actions cover wiring
without pointer-only gestures. Moving cards changes layout, never routing.

## Acceptance

### Shared-anchor and project acceptance

The precision delivery must state which participants consume the Session's
read-only anchor and which retain a coordinated fallback. An anchor contains
reference time, Session position, rate, running state and an invalidation epoch;
domain adapters map the named Session axis into their own units. An engine may
cancel and re-arm its work but cannot mutate an injected Session anchor. Pause,
seek, loop, rate changes and replacement invalidate stale preparations and
scheduled voices/sources before the new epoch becomes audible. Native-buffer
precision must not be attributed to a media element or an external MIDI device.

Session-relative automation and LFO phase use the same declared coordinate.
Their contracts distinguish pause/hold, seek re-evaluation, loop re-entry and
free-running control. Switching, lookahead, device latency and tail retention
need explicit policies and measured limits. A shared reference alone proves
neither a sample-exact group loop nor an inaudible graph replacement.

The project delivery separates a serializable document from its realized graph.
The document identifies its schema and each plugin version, stable module and
port identities, source asset references, base parameters, connections and
control mappings. Layout is a separate concern: renaming a label or moving a
module card cannot change its routes. AudioNodes, DOM objects, callbacks and
live context instances never appear in serialized state. Applications own asset
resolution, file/localStorage persistence and undo history.

Restoring a project validates its document before acquiring resources, stages
the new graph, and releases failed or superseded candidate work. Missing plugins
remain explicit unresolved modules with their configuration and connections
preserved for later recovery. Diagnostics distinguish missing modules/assets,
incompatible versions and rejected routes. Removing an editor view releases its
subscriptions; it does not dispose the project or borrowed audio environment.

Visual patch editing must expose the same commands through native keyboard
controls: choose source and destination ports, validate/create a connection,
and remove an identified connection. Visible lines supplement those controls;
they are not the only way to edit. Each module, port, connection and error has
an accessible name. Keyboard focus survives ordinary snapshot refreshes, and
pending/unresolved connections remain inspectable without pretending to carry
audio.

These are acceptance requirements, not a claim that every browser/device case
is covered. Each implementation step adds focused evidence; MOD-08 verifies
the combined first delivery. MC-16–17 cover sound/modulation; MC-18–19 cover
shared scheduling, explicit switching limits and recoverable project editing.
[STATUS](../STATUS.md) links dated evidence and its limits; documentation checks
alone prove neither runtime behavior nor audible precision.

| ID | Scenario and required observation | Evidence |
|---|---|---|
| MC-01 | Headless and custom UI obtain the same capabilities without DOM | Contract integration |
| MC-02 | Custom provider tags and Shadow DOM work; pending/late-upgrade boundaries do not borrow outer authority | Browser protocol tests |
| MC-03 | Explicit missing/ambiguous target never falls back; stale generations cannot attach after replacement | Binding failure/reentrancy tests |
| MC-04 | Borrowed player/context survive detach; repeated cleanup releases only owned resources/edges | Ownership and failure tests |
| MC-05 | Same-context admission revokes old destination once; different-context admission rejects or explicitly rebuilds | Graph counts and rendered signal amplitude |
| MC-06 | Nested Rack audio sums once and leaf transport registers once; independent child Session stops registration traversal | Graph and participant counts |
| MC-07 | Replace, tap and send coexist; failed candidate preserves old graph; unpatch restores only current valid default; lost target stays unresolved | Routing transactions and known signals |
| MC-08 | Source-owning root and child Rack have separate upstream routes; root effect never masquerades as common master | Graph counts and effect placement |
| MC-09 | Source-free root has transport but no fabricated Score/clip/audio output; pending/live duration remains explicit | Session capability tests |
| MC-10 | Owned-source/borrowed-Session member leaves without cancelling other members; no recursive command delegation | Scheduling and cancellation tests |
| MC-11 | Three panels edit one effect; collapse/unmount does not change graph, voices or playback position | Binding tests and audio render |
| MC-12 | Effect replacement keeps ports, player and position; failed construction/cleanup and late results preserve working resources | Fault injection and player integration |
| MC-13 | Legacy standalone panel ports/sections and .effect stage remain compatible; layout-only reordering does not reorder sound | Compatibility and ordering tests |
| MC-14 | Audio analyser taps Score through neutral ports; mixed Session commands use explicit axis/offset/rate adapters | Package boundary and integration tests |
| MC-15 | Old pages keep old discovery; opt-in Score and Audio target compositions each expose one default transport | Browser demos, keyboard and narrow-layout checks |
| MC-16 | Same-pitch occurrences release independently; held-note disconnect and ADSR early release affect only owned voices | Independent note fixtures and offline envelopes |
| MC-17 | Current/future voices connect to parameter buses; base values do not double; unsupported a-rate is explicit | Offline signal samples and capability tests |
| MC-18 | Seek/loop/pause invalidate old work; phase, latency, switching and tails meet declared backend limits | Offline plus browser/device timing evidence |
| MC-19 | Saved IDs/connections recover after rename/reorder; missing plugins remain unresolved; editor has keyboard equivalents | Schema round-trip and accessibility checks |

The first-step exit criterion is a consistent decision, contract, ownership table,
explained default graph, compatibility boundary and acceptance matrix reachable
through current documentation navigation. Runtime interfaces and tests are added
from MOD-02 onward; [STATUS](../STATUS.md) is the only progress ledger.
