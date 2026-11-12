# Authored DSP modules — 2026-11-12

Status: proposed. Nothing in this document is an implemented or accepted API.
Layer and public entry: proposed Kernel `/processor` (main thread) and
`/processor/worklet` (audio thread); domain adapters stay in Score and Audio.
Related decisions: [DEC-006](../DECISIONS.md#dec-006--reuse-through-explicit-resource-ports),
[DEC-063](../DECISIONS.md#dec-063--modular-composition-separates-resources-routing-and-session-authority),
[DEC-064](../DECISIONS.md#dec-064--session-scheduling-is-a-borrowed-anchor-projects-store-declarative-identity),
[DEC-068](../DECISIONS.md#dec-068--modular-composition-is-the-only-composition-model).
Acceptance needs a new decision; see [Decision to record](#decision-to-record).
Source baseline: `d96f105` on `doc-web-ui`.
Delivery owner once accepted: [STATUS](../STATUS.md), DSP-01.

## User task and boundary

A developer has a signal-processing idea — an FM voice, a waveshaper, a
physical model, a research algorithm — and wants to hear it inside a WebMusic
graph: patched to a Rack channel, driven by a Score player or note input,
modulated by an LFO, saved in a project and rendered offline. Today they cannot
write the per-sample code. They can only assemble native Web Audio nodes.

Observed at the baseline:

- No package registers its own `AudioWorkletProcessor`, and none ships WASM DSP
  or a shared-memory audio path. Worklets appear only inside optional
  third-party dependencies such as SpessaSynth.
- [`Effect.createAudioNodes`](../../platform/kernel/src/effect-chain.ts) is
  synchronous and returns native nodes, so an effect cannot wait for
  `audioWorklet.addModule()`.
- [`OscillatorSynth.noteOn`](../../packages/score/src/play/headless/oscillator-synth.ts)
  creates four nodes and four parameter bindings per note. The cost grows with
  polyphony and note density, and the voice architecture is fixed.
- [`createWebMusicProjectPlugins`](../../bridges/score-audio/src/project.ts)
  lists six trusted factories. `checkModuleConformance` exists for third-party
  modules, but no reference explains how to write one.
- `AudioInputPort` accepts a declared `latencySeconds`; nothing consumes it.

This proposal adds one authoring path: **a processor definition plus a worklet
file becomes a module** with the existing audio, note and control ports. It
reuses `ModuleHandle`, `ParamHandle`, `InsertChain`, `ModuleProject` and
`renderModuleGraph`. It does not add a second graph model, a second parameter
model or a second clock.

Out of scope, each needing its own proposal: saving a patched subgraph as a
reusable module, latency compensation across parallel routes, a beat-based
Session axis, loading untrusted third-party code in isolation, and moving view
rendering off the main thread.

## Composition

```text
ProcessorDefinition (data) ──┐
worklet file (author's DSP) ─┼─> prepareProcessor(environment)   async, once per context
                             └─> createProcessorModule(context)  ModuleHandle
                                   ├─ audio  in/out ports   -> routes, Racks, inserts
                                   ├─ note   input port     -> queued, sample-offset events
                                   ├─ control ParamSurface  -> AudioParams of the node
                                   └─ transport (optional)  -> anchor copied to the audio thread
```

| Resource | Owner | Borrowed by |
|---|---|---|
| `AudioContext` and its worklet registry | The audio environment's creator | Every processor module in that context |
| `AudioWorkletNode`, its message port and parameter bindings | The processor module | Routes and panels through leases |
| Worklet module registration (per context and URL) | Kernel's per-context preparation cache | All instances of that definition |
| Compiled `WebAssembly.Module` | The preparation cache for that context | Each node instance, which owns its own memory |
| Session anchor | The Session authority | The module, read-only |

The module creates no context and resumes none. Disposal disconnects its node,
closes its message port, releases its leases and cancels its held occurrences;
it never unregisters the worklet module, because Web Audio cannot.

## Inputs, outputs and units

### Processor definition

A definition is serializable data plus one resource location. It is the unit a
project stores by `id` and `version`.

| Field | Type or unit | Default | Limits | Notes |
|---|---|---|---|---|
| `id`, `version` | Trimmed strings | Required | Same rules as `ProjectPluginReference` | One processor name per `id@version` |
| `module` | URL of the worklet file | Required unless `register` is given | Same-origin or CORS-enabled | The application or its bundler supplies it, as with `Soundfont2Options.workletUrl` |
| `register` | `(context) => Promise<void>` | None | Called once per context | Escape hatch for applications that load worklets themselves |
| `audioInputs`, `audioOutputs` | Port ID and channel count each | One stereo output | Fixed for the node's life | Zero inputs makes an instrument or generator |
| `noteInput` | Boolean | `false` | One note input | Enables the note queue |
| `params` | `ParamDescriptor[]` | Empty | IDs unique within the definition | `modulation` selects the `AudioParam` rate: `audio-rate` → a-rate, `control-rate` → k-rate, `none` → message-set value |
| `latencySamples` | Samples | `0` | Nonnegative integer | Declared, not measured; published on the module's ports |
| `tailSeconds` | Seconds | `0` | Finite or `Infinity` | How long output continues after input and notes end |
| `wasm` | URL | None | Optional | Compiled on the main thread, instantiated in the processor |
| `transport` | Boolean | `false` | — | Requests the Session anchor on the audio thread |

Parameter units and ranges are the definition's. No layer converts Hz, dB,
cents or normalized values implicitly, as the
[modular contract](../design/MODULAR-COMPOSITION.md#inputs-outputs-and-units)
already requires.

### Audio-thread authoring kit

`/processor/worklet` is a single self-contained file with no imports and no
import-time side effects. The author's worklet file calls it explicitly:

```ts
// Proposed shape; names are not final.
defineProcessor('acme.fm-voice@1.0.0', {
  create(setup) { /* allocate all state here: voices, tables, WASM instance */ },
  process(state, block) { /* fill block.outputs; never allocate */ },
  note(state, event) { /* event.frameOffset is within the current block */ },
  message(state, data) { /* non-real-time configuration */ },
});
```

| Callback input | Unit | Guarantee |
|---|---|---|
| `block.inputs`, `block.outputs` | `Float32Array` per channel, one render quantum | Reused objects; valid only during the call |
| `block.params[id]` | One value (k-rate) or one per frame (a-rate) | Already includes automation and connected modulators |
| `block.frame`, `block.sampleRate` | Absolute context frame; Hz | `frame / sampleRate` is audio reference time |
| `event.frameOffset` | Frames from the block start | Events arrive in time order; an event is split across blocks only by the kit |
| `event.occurrence` | Small integer | Stable for one held note; `off` and `cancel` name it |
| `block.transport` | Session seconds, rate, playing, epoch | Present only when requested; same affine formula as `TransportClock` |

Rules for author code: allocate only in `create`; no strings, closures or
arrays created in `process` or `note`; no `postMessage` per block. The kit
enforces what it can and the acceptance harness measures the rest.

### Main-thread surface

| Function (proposed) | Returns | Failure |
|---|---|---|
| `prepareProcessor(environment, definition)` | Promise, idempotent per context and definition | Rejects with the load, registration or WASM compile error; a retry is explicit |
| `createProcessorModule(context, definition, options)` | A module with `ModuleHandle`, ports, `ParamSurface` and `dispose()` | Throws if the definition is not prepared in that context |
| `processorEffect(definition, options)` | An `Effect` recipe for `InsertChain` and `.effect` | `createAudioNodes` throws if not prepared; it never falls back to a bypass |
| `processorPlugin(definition)` | A `ProjectPluginFactory` | An unprepared or missing processor stays an unresolved project module |

Preparation is separate from creation for the same reason discovery is separate
from preparation in the
[context binding rules](../design/MODULAR-COMPOSITION.md#context-discovery-and-binding):
the synchronous graph transaction of `InsertChain` stays synchronous, and all
waiting happens before it.

## State and commands

| State | Meaning | Leaves by |
|---|---|---|
| `unresolved` | Definition known, not prepared in this context | `prepareProcessor` |
| `preparing` | Worklet module or WASM loading | Success, failure or abort |
| `ready` | Node exists; ports and parameters usable | Processor error or disposal |
| `error` | Preparation failed or the processor threw | Explicit retry creates a new instance |
| `detached` | Disposed; terminal | — |

These are the existing port readiness values. An exception inside `process`
stops that node permanently in Web Audio; the module reports `error`, releases
its held notes and keeps its routes so the graph stays valid and silent on that
branch. It does not restart itself.

Parameter writes use the existing `ParamHandle` path and
`bindAudioParam`. Base value, scheduled automation and connected modulators
keep their current meaning; the processor sees their sum.

## Session time and notes

A processor module is a scheduling participant only when it has a note input
or requests transport. Otherwise it is a plain audio processor with no time
role.

- **Notes.** The note input accepts `NoteEvent`s on the
  `audio-context-seconds` axis. The main thread converts time to an absolute
  frame, maps the string `occurrenceId` to an integer, and posts the event
  ahead of its due time. The audio thread keeps a sorted queue and dispatches
  each event at its frame offset. An event that arrives after its frame plays
  at the next block start and increments a `lateEvents` counter the module
  exposes; it is never dropped silently.
- **Invalidation.** `cancel` removes a queued event or silences a sounding
  occurrence without a release. On a Session epoch change the producer cancels
  its own occurrences, as today; the module additionally discards queued events
  of older epochs.
- **Timing mode.** The module reports `shared-anchor` when it accepts future
  events and exact cancellation, which the kit provides by default. A
  definition that opts out reports `callback`.
- **Transport.** On each anchor publication the module posts origin time,
  origin position, rate, running state, loop and epoch. The processor derives
  position per block from `block.frame`. It cannot write the anchor.

The lookahead limits recorded in
[shared-clock injection](../../platform/shared-clock-injection.md) still apply:
a starved main thread delivers events late. Moving the lookahead scheduler
itself to the audio thread is a possible later step, not part of this proposal.

## Data channels

| Channel | Availability | Use |
|---|---|---|
| `AudioParam` | Always | Continuous control and modulation |
| Message port | Always | Notes, configuration, transferred buffers, bounded-rate observations |
| Shared ring buffer | Only when `crossOriginIsolated` is true | High-rate observation or sample streaming |

The shared channel is a reported capability. A definition that requires it
fails preparation with an explicit reason on a page without cross-origin
isolation; the documentation site on GitHub Pages is such a page, so the
reference demos must work on the message port alone.

Observations from a processor (levels, a scope buffer) are for its own
presentation and Headless API. They are not a port family, consistent with
[module roles](../design/MODULAR-COMPOSITION.md#module-roles).

## Resources and failure

| Case | Required result |
|---|---|
| Worklet URL fails to load | `prepareProcessor` rejects; the previous graph is untouched |
| Same definition prepared twice, or by two modules at once | One load per context; both callers settle together |
| Two definitions register the same processor name | The second preparation rejects before `addModule` |
| Module disposed while preparing | The late result is discarded; nothing is connected |
| Context closed or replaced | Modules become `detached`; a new context needs a new preparation |
| Insert slot replaced | Existing `InsertChain` and `TransitionInsertChain` rules; the old node retires on their schedule |
| `AudioWorklet` unavailable | Preparation rejects with an unavailable-capability error; no `ScriptProcessorNode` fallback |

Definitions and worklet files are trusted code, exactly as project plugin
factories are today. Choosing which URLs to load is the application's decision.

## Composition, extension and compatibility

- **Score.** A proposed `Sound.processor(definition)` adapter implements
  `HeadlessSynth` over a processor module with `supportsNoteOccurrences`,
  scheduled cancellation and scheduled duration. `OscillatorSynth` and the
  other backends stay as they are; nothing migrates in this proposal.
- **Audio.** `processorEffect` works in any existing insert position.
- **Bridge.** `createWebMusicProjectPlugins` is unchanged. An application adds
  `processorPlugin(definition)` to its registry.
- **Elements.** No new tag is required. An author who wants a tag extends
  `WebMusicElement`, creates the module from the provided context and mounts
  an existing UI Kit presenter on its `ParamSurface`. The author guide shows
  this once; a generator can follow when the pattern is stable.
- **Offline.** `renderModuleGraph` builds the same module on an
  `OfflineAudioContext`. Preparation must complete inside `build` before
  rendering starts.

No existing public member changes. The proposal adds entries, so it touches
every surface listed under
[public entries and build contracts](../ARCHITECTURE.md#public-entries-and-build-contracts):
manifest exports, tsup mappings, `expectedPublicEntries`, DOM-free
reachability for both entries, and the Kernel API page.

## Open choices

| Choice | Options | Recommendation |
|---|---|---|
| Where the runtime lives | Kernel entries, or a new neutral platform package | Kernel: every type it touches is already a Kernel port type |
| Offline note delivery | Post all events before rendering, or step rendering with `suspend()` | Measure first; message order relative to offline rendering is not guaranteed and decides this |
| Voice management | Author-owned, or a kit-provided voice pool | Author-owned in the first delivery, with a reference polyphonic processor to copy |
| WASM memory | Author-owned, or a kit allocator | Author-owned; Kernel passes the compiled module only |
| Late events | Play at block start, or drop | Play and count, as specified above |
| Guide location | Kernel documentation section, or a top-level "Write a module" guide | One self-contained page a third party can follow without reading design history |

## Acceptance

Automated evidence unless marked otherwise. Fixtures in tests may be synthetic;
every demo uses Arabesque No. 1.

| ID | Scenario and required observation |
|---|---|
| DSP-A1 | A gain processor as an insert renders offline to the expected amplitude; replacing it keeps ports, player and position |
| DSP-A2 | A parameter declared `audio-rate` follows a connected LFO per frame; `control-rate` follows per block; base value is not doubled |
| DSP-A3 | A note scheduled at an exact frame starts at that frame in an offline render |
| DSP-A4 | Same-pitch occurrences from two sources release independently; `cancel` before onset produces silence |
| DSP-A5 | Seek, pause and loop leave no sounding or queued note from the old epoch |
| DSP-A6 | Unprepared creation throws; failed preparation leaves the working graph and reports the reason |
| DSP-A7 | Disposal during preparation, repeated disposal and context replacement release only owned resources |
| DSP-A8 | A project containing a processor saves, restores and keeps an unresolved record when the processor is unavailable |
| DSP-A9 | The processor module passes `checkModuleConformance` |
| DSP-A10 | A harness runs the kit and reference processors for many blocks without heap growth |
| DSP-A11 | Benchmark, recorded not gated at first: the reference polyphonic processor against `OscillatorSynth` at equal polyphony, reporting render time per block and node count |
| DSP-A12 | Browser and device: a processor instrument plays Arabesque No. 1 from a Score player through a Rack; late-event count stays zero under normal load |

DSP-A11 introduces the repository's first performance measurement. Its numbers
become a budget only after they are observed on real devices.

## Delivery phases

| Phase | Content | Exit |
|---|---|---|
| P0 | Decision recorded; open choices resolved | Accepted contract moves to `dev/design/` |
| P1 | Definition, preparation, audio-only module, `processorEffect`, offline | DSP-A1, A2, A6, A7, A9 |
| P2 | Note input, transport block, reference polyphonic processor, `Sound.processor` | DSP-A3–A5, A10–A12 |
| P3 | `processorPlugin`, author guide, element recipe | DSP-A8; a third party can follow the guide alone |
| P4 | WASM handoff and the optional shared channel | A WASM reference processor; capability reporting verified with and without isolation |

## Decision to record

If accepted, record one decision stating: authored DSP is a Kernel module
contract over `AudioWorklet`; preparation is asynchronous and separate from
synchronous graph edits; processors expose only the existing port families;
shared memory is optional and reported; processor code is trusted. Promote the
accepted sections into `dev/design/` and track delivery as DSP-01 in STATUS.

## Documentation delivery

Kernel API page for the two entries; a Headless-template page for the module;
one author guide with a complete worklet file, definition, module creation,
panel and project registration; a demo that plays Arabesque No. 1 through the
reference processor. No Element page until a tag exists.
