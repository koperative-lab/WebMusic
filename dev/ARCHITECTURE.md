# WebMusic architecture

This document defines package dependencies, source layers, time models, resource
ownership and enforcement boundaries. Product scope belongs in
[PRODUCT.md](PRODUCT.md), component design in
[COMPONENT-DESIGN.md](design/COMPONENT-DESIGN.md), and the derived component inventory in
[COMPONENTS.md](COMPONENTS.md). Accepted decisions and their reasons belong in
[DECISIONS.md](DECISIONS.md); implementation progress belongs in
[STATUS.md](STATUS.md). Development commands live in
[dev/DEVELOPMENT.md](DEVELOPMENT.md). This document does not maintain release
status or a second task list. The complete documentation routing map lives in
[dev/DOCUMENTATION-MAP.md](DOCUMENTATION-MAP.md).

## Checkout and release boundary

DEC-021 limits the first release on `main` to Kernel, UI Kit and Score. This
development checkout adds Audio and Bridge as two package workspaces. Main owns
the Score and Agent Toolkit baseline: shared source, tests, references and
behavior follow it, with the explicitly approved documentation/demo exceptions
in DEC-032/033, the Score Analyze component-surface defaults in DEC-034,
the two-tool Score Analyze inventory in DEC-043, and domain-prefixed Score
Web Component tags in DEC-045.
Preserve those scoped exceptions during synchronization. Additional domain
functionality belongs to Audio and Bridge; shared Kernel/UI changes are limited to the compatibility those domains
need, with explicit contracts and regression coverage.

The five-package tree and site routes below describe local implementation, not
release readiness. Current verification belongs in STATUS. Historical migration
records retain their original scope and results without authorizing extra public
Score controllers, parked Element implementations or unrelated UI applications.

## Packages and deployment boundaries

WebMusic provides composable music interaction components. Score handles symbolic
music; Audio handles digital audio. Applications can use either independently or
combine them through Bridge to build DAWs, performance tools and musical
installations. A package may contain several capabilities; a source capability
boundary is not necessarily a separate npm package.

| Path | Package / responsibility |
|---|---|
| `platform/kernel` | `@webmusic/kernel`: domain-neutral events, lifecycle and worker utilities, playback/effect contracts, time math and synchronization. |
| `packages/ui` | `@webmusic/ui`: DOM presenters, structural bindings and semantic styling hooks; no workspace dependencies. |
| `packages/score` | `@webmusic/score`: immutable Score model, MIDI/MusicXML/MXL/ABC I/O, playback, analysis, views and React composition. |
| `packages/audio` | `@webmusic/audio`: AudioClip, decoding, playback, recording, analysis, views and React composition; format support depends on the selected decoder. |
| `bridges/score-audio` | `@webmusic/bridge`: Score/Audio synchronization, rendering and model conversion. |
| `apps/doc/webmusic` | Astro Starlight documentation app; content is organized under `kernel/`, `uikit/`, `bridge/`, `score/` and `audio/`. |
| `apps/doc/shared` | Shared documentation `ui.css`, `ui.ts` and `ui-catalog.ts`; not a separate workspace package. |
| `scripts/` | Package, source, component, documentation and release-manifest checks; `release-pipeline/` preserves historical release machinery. |

The following table lists **workspace edges only**. Third-party dependencies are
specified by each package manifest.

| Package | Workspace dependencies | Workspace peer dependencies |
|---|---|---|
| Kernel | None | None |
| UI | None | None |
| Score | None | Kernel required; UI optional |
| Audio | None | Kernel required; UI optional |
| Bridge | None | Kernel, Score and Audio required |

Required peers let the application select compatible Kernel/domain implementations
and keep those packages external to consumer builds. They do not allocate a shared
`AudioContext`, player or `TransportClock`, or replace checking actual package
resolution and object ownership. Headless paths do not reach UI. Applications
using visual Elements or a renderer that explicitly consumes UI install the
compatible UI peer; static optional-peer exceptions are enumerated per entry.

## Cross-package rules

1. **Score and Audio do not depend on each other.** Audio analysis emits
   domain-neutral note events; assembling them into a `Score` belongs in Bridge.
2. **Kernel knows no domain model.** No `Note`, `Score`, `TimeMap`, `AudioClip` or
   `BeatGrid`. Extraction requires existing duplicated implementations that drift,
   or a contract both domains implement. See the [platform ledger](../platform/README.md).
3. **Reusable cross-domain library logic belongs in Bridge.** It is the current
   publishable package that depends on both domains. Applications, examples and
   tests may compose both through public entries; this rule does not prohibit
   application-level workspaces.
4. **UI owns presentation.** Its small structural bindings do not import domain
   types or Kernel. It owns no domain scheduling, parsing, audio graph or custom
   element registration. Importing a UI entry must not access DOM globals;
   mounting a presenter may operate on a caller-provided DOM surface.

Before extending the system, inspect existing controllers, presenters, clock
contracts, worker utilities and effect recipes. Prefer configuring or composing
an existing resource when its responsibility fits. Add a module or public entry
when its contract differs. This does not move every shared-looking policy into
Kernel: context closure, parser cancellation and effect replacement remain with
their domain owners.

## Three usage levels and source layers

Consumers choose Web Components, Headless, or API + UI. These paths share domain
behavior; they are not three independent playback implementations or mandatory
wrapper stages. Their composition rules are defined in
[COMPONENT-DESIGN.md](design/COMPONENT-DESIGN.md).

The concrete `play`, `view` and `analyze` capabilities use four source
responsibilities. I/O, the domain root model and React composition do not each
have this complete four-directory structure.

| Source layer | Responsibility | Public form |
|---|---|---|
| Capability `core/` | Stateless algorithms, contracts and transforms; cannot depend on a higher layer. | Internal implementation, selectively exposed through API. |
| `headless/` | UI-free engines, sessions, controllers and state machines; may use non-visual resources such as Web Audio. | `/headless` |
| `api/` | Supported functions, options, result types and selected Headless facades. | Capability root, e.g. `/play`; no `/play/api` entry. |
| `element/` | Browser composition of attributes, events, ownership, Headless and UI presenters. | `/element`; import does not register tags. |

Dependencies point **from higher to lower layers**:
`element → api → headless → core`. Higher layers may directly reach lower ones;
Headless never depends back on API, and none of those three layers reaches Element.
Core/API/Headless do not create, accept or manipulate DOM/canvas/SVG UI or carry
markup and visual styles. Serializable color or dimension options are not a
packaged visual implementation.

Technical adapters are separate; imperative code is not automatically Headless:

- `/render`: DOM/canvas/SVG view renderers.
- Score `/play/drivers`: browser scroll, pointer, orientation and similar input
  mapped to transport; Audio has no corresponding driver entry.
- `/worker-client`, `/worker-protocol`, `/worker`: client, protocol and runtime.
- `/auto`, `/global`: Element registration and browser distribution forms.
- `/demos`: explicitly published teaching material, checked against its actual
  reachable dependencies.

The capability DAG is enforced by `capabilityDependencies` in
[scripts/package-policy.mjs](../scripts/package-policy.mjs).

| Score capability | May depend on |
|---|---|
| `core` | None |
| `io` | `core` |
| `view`, `play`, `analyze` | `core`, `io`; the three siblings do not import one another |
| `react` | All Score capabilities |

| Audio capability | May depend on |
|---|---|
| `core` | None |
| `play` | `core` |
| `view`, `analyze` | `core`, `play` |
| `react` | All Audio capabilities |

Audio Play exposes a stable `AudioPlayer` command facade over its selected clip,
queue or mix backend. Linked playlist/mixer/recorder Elements compose with that
owner; they do not add another transport presenter or clock. View retains the
nonvisual `AudioMeterController` and the `audio-view type="meter"` projection.
The independent `audio-meter` tag is a compact Analyze monitor beside sampled
level dynamics, frequency-spectrum probing, time-domain oscilloscope inspection
and transient-cue inspection. These tools borrow the same player graph without
creating another player or clock. The canonical Analyze meter Element facade
may import the existing View meter implementation through one reviewed
compatibility adapter; legacy View Element imports may still register the same
tag. This is not a blanket Analyze-to-View dependency or permission for other
Analyze layers to import View. See [Audio Play](design/AUDIO-PLAY-COMPONENTS.md),
[Audio Analyze](design/AUDIO-ANALYZE-COMPONENTS.md), DEC-029 and DEC-037.

## Time: one authority per session

**Accepted rule: one music session has one authoritative timeline.** Score,
Audio, views and input controls in that session must agree on it. Multiple sessions
may play, pause and seek independently; a process-wide transport singleton must
not couple unrelated works. Sessions may share a hardware context while retaining
independent transports.

Four time layers must remain distinct:

| Layer | Representation | Boundary |
|---|---|---|
| Audio reference time | `AudioContext.currentTime`, seconds | Absolute audio scheduling reference; stops advancing when the context is suspended. It is neither work position nor wall time. Different contexts do not provide interchangeable timestamps. |
| Session transport time | `TransportClock` / `TransportClockReader` | Maps reference time to position, rate, pause state and a future origin. Kernel math does not assign domain units; a session must name its axis. |
| Score musical time | Rational quarter positions, beats, `TimeMap`, nominal seconds | `TimeMap` maps musical positions through tempo/meter; playback rate then maps nominal seconds onto reference time. |
| Audio media time | Clip seconds, sample index, `BeatGrid` | Sample indices need a sample rate; a BeatGrid beat index is not automatically a Score quarter position. |

Implemented shared contracts are `TransportClock`, its read-only reader,
`TimelineMapping`, `TickSource` and `TransportGroup`. Bridge uses one
`AudioContext` reference, selects a master reader as the group's position
authority, and coordinates starts, rates, seeks and drift. Both Score-mastered
and Audio-mastered pairings exist.

**Players currently retain separate `TransportClock` instances.** The
[Score scheduler](../packages/score/src/play/headless/score-player-scheduler.ts) and
[Audio buffer engine](../packages/audio/src/play/headless/engines/buffer-engine.ts)
each construct one. A reader provides neither shared write ownership nor
invalidation notification or same-instance injection. These implemented contracts
support the accepted direction; they do not mean the complete shared-session-clock
design has shipped. Injection and rescheduling requirements are specified in
[platform/shared-clock-injection.md](../platform/shared-clock-injection.md), with
delivery status in [STATUS.md](STATUS.md).

A running `TransportClock` uses:

```text
position(t) = originPosition + (t - originTime) * rate
```

Pause holds position; `startAt` holds a scheduled origin until reference time reaches
`when`. `start`, `pause`, `seekTo` and `setRate` accept reference time explicitly,
without accumulating JS ticks. `timeAt` rejects paused states and positions that
cannot be mapped during a scheduled hold.

Ticks wake schedulers. Score backends supporting future attacks and cancellation,
and the Audio buffer engine, can submit absolute timestamps to Web Audio.
Readers, worker timers and UI events alone do not guarantee sample accuracy.
Workers reduce main-thread timer throttling effects, but browser suspension,
message delivery and preparation can still delay scheduling. Synchronized loops
currently detect a boundary on a tick before rejoining; sample-accurate loop wrap
is not an implemented guarantee.

## Bridge conversion boundaries

Bridge owns domain adaptation; Kernel owns domain-neutral roles and coordination:

- `TransportGroup` provides revisioned commands, command FIFO, generations,
  intent recovery, multiple followers, affine offset/scale mapping, native-loop
  phase mapping and drift correction.
- `ScoreAudioSync` selects domain axes and restricts the shared rate; reverse
  adapters translate clip offsets and Score nominal seconds.
- Domain adapters `timeMapMapping` / `beatGridMapping` implement `TimelineMapping`;
  Bridge pair adapters expose constant offsets. Kernel follower mappings do not
  implement arbitrary nonlinear score-to-recording alignment.
- `beatGridFromTimeMap` evaluates sampled beat positions exactly; tempo changes
  between those positions may not be recoverable.
- `timeMapFromBeatGrid` reconstructs interval tempos without preserving original
  meter or automatically retaining the grid's absolute start offset.
- `renderScoreToClip` produces samples; `scoreFromTranscription` constructs notation
  from estimated note events. Neither implies lossless Audio ↔ Score round-trips.

Calls, axis translations, limits and error behavior are detailed in
[bridges/README.md](../bridges/README.md).

## Ownership and lifetime

Creation, borrowing, replacement and disposal must be visible in an API contract.
Mounting UI must not silently create a second transport; synchronization should
reuse the domain engines and graphs already responsible for playback.

| Resource | Ownership rule |
|---|---|
| `AudioContext` | The creator manages closure; injected contexts remain caller-owned. Kernel only supplies construction utilities. |
| Player / Controller / Rack | Ownership normally follows creation. APIs supporting borrowing detach their bindings on unmount without destroying borrowed domain objects; exceptions must be explicit. |
| Effect recipe | Reusable across graph instances; live nodes and edges belong to a specific context/graph. |
| Presenter / DOM | A mount handle releases its subscriptions, listeners, drawing tasks and owned DOM; it does not thereby own the domain object. |
| Worker / TickSource | The creator stops and disposes each instance; a shared contract does not mean one worker for the entire page. |

Graph replacement validates a candidate before committing it. Failure preserves
the old graph and releases candidate-owned resources without removing nodes or
edges already shared with the live graph. Pause, disposal, property changes and
external callbacks may re-enter asynchronous work; resumed work must re-check its
generation and state before claiming ownership.

Kernel `WebMusicElement` owns only a connected-lifetime cleanup scope: a fresh scope
per connection, reverse cleanup order, once-only cleanup and continued release
after an individual failure. It owns no Shadow DOM, theme, domain graph or presenter.
Components requiring special release order or error routing may retain explicit
teardown. The choice of base class does not itself prove lifecycle correctness.

## Element and UI composition

Playback-connected Analyze and View should be able to borrow Play's loaded data,
state, and timeline through the [player binding design](design/PLAYER-BINDING.md).
This is an accepted target; [STATUS](STATUS.md) records the current partial
bindings and missing contracts. A companion owns its projection and subscriptions;
Play retains playback mutation and resource ownership. Data-only analysis and
static views remain usable without a player.

Implement the binding within the capability DAG: Score's View and Analyze must
not import Play implementation or types. The shared Score playback-source
contract belongs in Score core and its existing model export; Play implements it
and Analyze/View consume it. DOM selector discovery belongs to the browser
adapter. Use structural contracts and explicit composition; domain-neutral shared
primitives may live in Kernel only when they
satisfy its existing boundary. UI receives domain-neutral bindings. Following one
player's state does not create another clock and is separate from the multi-engine
shared-clock injection protocol.

```text
domain Headless object + @webmusic/ui presenter
               composed directly by the Element class
                         = Web Component
```

The Element maps public attributes/properties/events, selects ownership and builds
a structural binding. This mapping lives in the class and its protected hooks,
without a separate per-component Element Adapter layer. An existing public
imperative mounter may remain as a compatibility facade over the same presenter.
Behavior/declaration elements may have no visual presenter when explicitly listed
in the composition policy.

Internal `wui-*__` classes are not UI API. Consumers use `[part~="…"]`, semantic
CSS tokens and public control references on presenter handles. Parameter racks
represent scalar rotary controls; automation, `AudioParam`, scaling and effect
graphs stay with the domain. Mixer, envelope and LFO have dedicated presenters.
Timeline uses a domain-neutral numeric axis whose binding supplies the meaning.
The presenter inventory belongs in [COMPONENTS.md](COMPONENTS.md) and the
[UI README](../packages/ui/README.md).

## Public entries and build contracts

Each package exports `.` and `/package.json`. Score/Audio capability roots are
APIs; `/element` is the only element spelling. `/elements`, `/api` and `/session`
are not public aliases. Kernel exports `/events`, `/element`, `/worker`,
`/audio-context`, `/player`, `/effect`, `/meter`, `/transport`, `/tick` and `/sync`.
Bridge currently exports its capabilities from its package root. Exact entry sets
are reconciled between manifests and `expectedPublicEntries`.

Non-IIFE entries use nested conditions:

```text
import:  { types: *.d.ts,  default: *.js  }
require: { types: *.d.cts, default: *.cjs }
```

`/global` is a browser IIFE of `/auto`, with `types` + `default` only, not ESM/CJS
conditions. Score play exposes `WebMusicScorePlay`; Audio exposes
`WebMusicAudioPlay`, `WebMusicAudioAnalyze` and `WebMusicAudioView`. These entries
register elements on evaluation and declare side effects. Worker runtimes also
declare registration effects, guarded by `dedicatedWorkerScope()` so SSR and
main-thread imports register no worker handler. Other public entries remain free
of import-time side effects.

Packages use composite TypeScript projects, with root solution references matching
workspace dependencies. tsup builds the artifacts; family `moduleEntries` map
source to output, with split ESM and unsplit CJS passes. CJS worker clients use the
defined fallback without `import.meta.url`. Kernel explicitly splits both formats
so its root and capability entries share runtime class identity within each
module format. Build entries and exports must match
in both directions. Relative source imports stay inside their package; cross-package
imports use public subpaths.

## Executable policy and documentation authority

Architecture is enforced by several explicit sources. A change can be architectural
without changing `package-policy.mjs`.

| Contract being changed | Sources to review |
|---|---|
| Packages, entries, dependencies, layers, side effects, DOM-free/optional-peer reachability | [scripts/package-policy.mjs](../scripts/package-policy.mjs) |
| Element-to-presenter composition and behavior-only exceptions | [scripts/element-composition-policy.mjs](../scripts/element-composition-policy.mjs) |
| Element/catalog membership, UI information classes and AST rules | Composition policy and [architecture checker](../scripts/check-architecture.mjs); the main UI information classes and reviewed membership determine the catalog |
| Installed API and type/runtime paths | Each package's `exports`, dependencies/peers and `sideEffects` in `package.json` |
| Output layout and source mapping | Package tsup configurations / build scripts; family `moduleEntries` |
| Documentation structure, examples and component presentation | [scripts/check-docs.mjs](../scripts/check-docs.mjs), [scripts/check-doc-snippets.mjs](../scripts/check-doc-snippets.mjs), documentation catalog |
| Packed artifacts and release manifests | [scripts/check-package-exports.mjs](../scripts/check-package-exports.mjs), [scripts/release-manifests.mjs](../scripts/release-manifests.mjs) |

`check:architecture` also checks cycles, orphan sources, the TypeScript solution,
application public imports and UI custom-element freedom. Static boundaries do not
prove runtime lifetimes, synchronization or conversion correctness; type contracts,
domain regressions and real-player integration tests cover those behaviors.

`check:packages` verifies build and `npm pack` contents, ESM imports, CJS requires,
IIFE globals/registration and worker fallbacks. The authoritative command graph and
CI jobs are [package.json](../package.json) and
[.github/workflows/ci.yml](../.github/workflows/ci.yml); operational guidance lives in
[dev/DEVELOPMENT.md](DEVELOPMENT.md), without another copied command chain here.

## Scope of shared compatibility changes

Audio and Bridge use the existing domain-neutral public foundations. For a shared
change, identify the concrete consumer, keep the main Score behavior compatible,
and verify the consumer and the shared contract. A renderer gesture, lifecycle or
numeric-axis capability belongs in its existing owning entry when reusable;
it does not justify a second application framework or a broader export surface.
The public UI reference follows main's canonical `/uikit` routes and six groups.
