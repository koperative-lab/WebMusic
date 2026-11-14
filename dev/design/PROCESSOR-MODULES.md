# Processor modules: authored DSP

Status: accepted direction, in delivery ([DEC-073](../DECISIONS.md#dec-073--authored-dsp-is-a-kernel-processor-module-contract)).
Steps 0 and 1 below are implemented; later steps are targets, not current API.
Layer and public entry: Kernel `/processor` (main thread) and
`/processor-worklet` (audio thread); domain adapters stay in Score and Audio.
Source: [platform/kernel/src/processor/](../../platform/kernel/src/processor/).
Owning reference: [Kernel API](../../doc/src/content/docs/kernel/api.mdx).
Delivery owner: [STATUS](../STATUS.md), DSP-01.

The [2026-11-12 proposal](../plans/2026-11-12-authored-dsp-modules.md) keeps
the full problem statement, alternatives and the acceptance scenarios
DSP-A1–A12. This document owns the accepted contract, the points where
building changed the proposal, and the development sequence.

## Contract

A developer writes per-sample DSP once and uses it as a module: patched to a
Rack channel or insert, driven by notes, modulated by control signals, saved in
a project and rendered offline. Authored DSP adds no second graph model,
parameter model or clock; it produces the existing
[port families](MODULAR-COMPOSITION.md#port-families).

```text
ProcessorDefinition (shared data)
   ├─ main thread:  prepareProcessor(context, definition, source)   async, once per context
   │                createProcessorModule(...)  -> ModuleHandle
   └─ audio thread: defineProcessor(definition, implementation)      in the author's worklet file
```

| Rule | Reason |
|---|---|
| One definition object is shared by both threads | Ports and parameters cannot drift between the node and its processor |
| The worklet location is a separate `ProcessorSource`, not part of the definition | A definition stays serializable data that a worklet bundle can import |
| Preparation is asynchronous and separate from creation | `InsertChain` graph edits stay synchronous; every wait happens first |
| The same `id@version` with a different contract is rejected | Web Audio cannot unregister a processor; a change needs a new version |
| A failed preparation is forgotten | Retry is explicit and the working graph is untouched |
| Every parameter is an `AudioParam`; `audio-rate` is a-rate, anything else k-rate | Automation and modulators reach the processor already summed, through the existing `ParamHandle` path |
| `process` receives one reused block and must not allocate | The audio thread has no time for garbage collection |
| A throwing processor reports once, goes silent and stops | Web Audio stops calling it; the module must not pretend otherwise |
| No `ScriptProcessorNode` fallback | An unavailable capability is reported, not imitated |
| Processor code is trusted | Same trust as project plugin factories; loading a URL is the application's choice |

Ownership: the audio context and its worklet registry belong to the context's
creator. A processor module will own its node, message port and parameter
bindings, and nothing else.

## Changes from the proposal

| Proposal | Built contract | Why |
|---|---|---|
| Entry `/processor/worklet` | `/processor-worklet` | Kernel is a flat package; its entry and reference checks expect one-segment names |
| `module` and `register` fields in the definition | A separate `ProcessorSource` argument | The worklet file imports the definition, so it cannot contain that file's own URL |
| `prepareProcessor(environment, …)` | `prepareProcessor(context, …)` | Registration is per `BaseAudioContext`; an environment only wraps one |
| `modulation: 'none'` set by message | k-rate `AudioParam` | One parameter path; a handle that forbids modulation simply maps none |
| A single import-free kit file | A small dependency-free entry the author's bundler includes | The author's worklet file is bundled anyway; the built entry pulls in only definition code |

Open choices adopted from the proposal's recommendations: the runtime lives in
Kernel; voice management and WASM memory are author-owned; a late note plays
at the next block and is counted. Two remain open and are settled in the step
that needs them: offline note delivery (step 3) and where the author guide
lives (step 7).

## Step 1 as built

`createProcessorModule(context, definition, options)` in
[module.ts](../../platform/kernel/src/processor/module.ts). Choices made while
building it:

| Choice | Reason |
|---|---|
| Each input gets an explicit-channel-count entry `GainNode` | `AudioWorkletNode` has one `channelCount` for all inputs; the entry node gives each bus its declared count and a stable target for producers |
| Each output gets its own exit `GainNode` | `AudioOutputPort` connects output 0 of its node; an exit per bus gives every output a port and precise disconnection |
| Only the first output is routed by default | Matches other modules' one main route; further outputs are for explicit patching |
| `audio-rate`/`control-rate` parameters bind through `ParamHandle.bindAudioParam` (lazy); others subscribe and write `setValueAtTime` | Native modulation needs a supported rate; an unmodulated parameter still needs its writes to reach the node |
| Definitions requesting note input or transport are rejected | A module silently lacking its declared input would be a fake success; steps 3 and 4 lift this |
| The module registers in its scope's registry | Same as other module factories; disposal releases it |

Not covered yet: closing or replacing the audio context does not move the
module to `detached`; that waits for real-context evidence in step 2.

## Development sequence

Each step is one reviewable change. It ends with its tests failing without the
change, `npm run check` passing, the owning reference updated, and — where the
result is audible — a manual check in the private acceptance runner. Steps
build in order; none starts a later one's surface early.

| Step | Deliverable | Main work | Proves |
|---|---|---|---|
| 0 — done | Entries, definition, protocol, preparation, kit core | `definition.ts`, `protocol.ts`, `prepare.ts`, `worklet.ts`; manifest, build and policy entries; Kernel API sections | Validation, per-context preparation, block adaptation and failure reporting (unit tests) |
| 1 — done | Audio-only processor module | `createProcessorModule(context, definition, options)`: `AudioWorkletNode`, audio input/output ports, a `ParamSurface` bound to the node's `AudioParam`s, readiness, error reports, disposal; declared latency published on its ports | DSP-A6, A7, A9 |
| 2 | Processor as an insert effect | `processorEffect(definition)` for `InsertChain` and `.effect`; offline realization through `renderModuleGraph`; first browser check with a gain or soft-clip processor on Arabesque No. 1 | DSP-A1, A2 |
| 3 | Notes on the audio thread | Main-thread note bridge (occurrence integers, frame conversion); kit event queue with sample-offset dispatch, `cancel`, epochs and a late counter; decide offline note delivery by measurement | DSP-A3, A4 |
| 4 | Transport and Session membership | Anchor messages, `block.transport`, participant registration with the real timing mode, invalidation on seek, pause and loop | DSP-A5 |
| 5 | Reference instrument | A polyphonic reference processor to copy; Score `Sound.processor(definition)` over `HeadlessSynth`; allocation harness and the first benchmark against `OscillatorSynth` | DSP-A10, A11, A12 |
| 6 | Projects | `processorPlugin(definition)`; save, restore and unresolved recovery | DSP-A8 |
| 7 | Author guide | One self-contained page: worklet file, definition, module, panel on its `ParamSurface`, element recipe, project registration; Headless reference page and demo | A third party can follow it without design history |
| 8 | WASM and shared memory | Compiled-module handoff; optional ring buffer reported as a capability when `crossOriginIsolated` | Capability reporting with and without isolation |

Before starting a step, read the proposal's matching section and the Kernel
types it touches. Step 1 starts from
[`ModuleHandle`](../../platform/kernel/src/module/registry.ts),
[`AudioOutputPort` and `AudioInputPort`](../../platform/kernel/src/module/audio-port.ts),
[`ParamHandle.bindAudioParam`](../../platform/kernel/src/module/parameter.ts)
and [`checkModuleConformance`](../../platform/kernel/src/module/conformance.ts).

Outside this sequence, each needing its own proposal: saving a patched
subgraph as a module, latency compensation across parallel routes, a beat-based
Session axis, isolated loading of untrusted processors, and off-main-thread
view rendering.

## Verification boundary

Unit tests run the kit and preparation against structural fakes. They do not
load a real `AudioWorklet`, so they prove contracts and failure handling, not
sound. Real worklet loading, offline rendering and timing are first exercised
in step 2 and need browser evidence from that step on.
