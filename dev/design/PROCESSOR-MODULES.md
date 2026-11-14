# Processor modules: authored DSP

Status: accepted direction, in delivery ([DEC-073](../DECISIONS.md#dec-073--authored-dsp-is-a-kernel-processor-module-contract)).
Steps 0–4 below are implemented; later steps are targets, not current API.
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

## Step 2 as built

`processorEffect(definition, options)` in
[effect.ts](../../platform/kernel/src/processor/effect.ts); node construction
and report handling are shared with the module in
[node.ts](../../platform/kernel/src/processor/node.ts).

| Choice | Reason |
|---|---|
| The node is the slot's input and output | An insert has one path; entry and exit nodes would add two nodes per slot for nothing |
| The first input bus fixes the node's channel count (`explicit`) | Producers are mixed to the declared count, as in the module |
| Undeclared modulation is stated as `none` in the recipe's descriptors | `InsertChain` would otherwise infer `control-rate` from a k-rate `AudioParam` and accept modulation the definition did not declare |
| Failure goes to `onError`, once per realization | An `Effect` has no state channel; the slot stays in place and silent |

Browser evidence (2026-11-13, in-app Chromium, private acceptance runner,
checks I1–I3, on the reference gain and soft-clip processors written with the
public kit):

- **DSP-A1:** offline, Arabesque through a Score player insert at gain 0.5
  measured a wet ÷ dry level of 0.5000, and 0.5000–0.5000 across 16
  half-second windows. Two 8 s renders took 96 ms together.
- **DSP-A2:** a 2 Hz `ControlLFO` on the a-rate gain swept the 10 ms ratio
  from 0.000 to 1.000; the largest gain change inside one 128-frame block
  measured 0.0181 against a predicted 0.0182 (a k-rate parameter reads 0).
- **Live:** a soft-clip `<score-effect>` on a playing `<score-player>`
  realized an `AudioWorkletNode`; its synth panel showed Drive with the
  declared range, and Drive 22.1 set from the keyboard reached the node's
  `AudioParam`. No console errors.
- The production runner build bundles the author's worklet file as one
  self-contained 5.3 kB module.

Not established: audible quality and click-free parameter changes (the
owner's manual check I3), other browsers, devices, and the step 1 gap on
context closure.

## Step 3 as built

The module's note bridge (`ProcessorNoteBridge` in
[module.ts](../../platform/kernel/src/processor/module.ts)) and the kit's
`NoteQueue` in [worklet.ts](../../platform/kernel/src/processor/worklet.ts).

| Choice | Reason |
|---|---|
| The kit calls `note()` with a frame offset before `process`, rather than splitting the block | Splitting would need per-segment views of every buffer; an offset lets the author start a voice mid-block with no allocation |
| All queue allocation happens on message arrival; dispatch only advances an index and updates a `Set` | `process` stays allocation-free apart from the `Set`'s own growth |
| ~~A newer epoch withdraws older queued onsets~~ — replaced in step 4 by an explicit Session flush | Comparing epochs across sources silenced live gestures once a scheduler advanced |
| A release that names an earlier time than its onset takes the onset's frame | The author never sees an `off` before its `on` |
| Live `performance-seconds` gestures post with an immediate frame | They have no scheduled time; playing them at the next block is not lateness |
| A late `cancel` is not counted | Releasing a producer cancels its held notes with their past onset times; that is "stop now", not a scheduling failure (found in the live browser check) |
| Other axes are rejected unless `noteTime` maps them | A wrong mapping would play at the wrong time without any error; step 4 supplies the Session mapping |
| Late counts reach the main thread at most four times a second | Reporting is the only message the audio thread sends during normal running |

**Offline note delivery, decided by measurement.** The proposal left open
whether notes must all be posted before an offline render or can come from a
lookahead scheduler that `renderModuleGraph` ticks in rendered time. Both work:
in check I4 the first 45 Arabesque onsets landed on their exact sample either
way, with no stray markers and no late notes. A lookahead shorter than the
tick step (5 ms ahead, 25 ms ticks) produced 76 late changes and moved 39
onsets, so a scheduler only needs to look further ahead than one tick, as live
schedulers already do. No separate offline path is needed.

Browser evidence (2026-11-14, in-app Chromium, private runner checks I4–I5,
with a polyphonic sine "note-probe" instrument written with the public kit):

- **DSP-A3:** 45/45 onsets on their exact frame offline, in both delivery modes.
- **DSP-A4** is covered by unit tests (same-pitch occurrences from two
  sources, cancel before onset); the live check additionally showed no hanging
  notes after restarting the schedule twice.
- **Live:** a 25 ms tick, 150 ms lookahead scheduler on the main thread played
  the opening of Arabesque with 0 late notes in the foreground, including after
  two restarts.

Not established: background-tab timing (part of manual check I5), other
browsers and devices, and audible quality.

## Step 4 as built

`followSession` in [module.ts](../../platform/kernel/src/processor/module.ts),
the kit's `flush` and `block.transport` in
[worklet.ts](../../platform/kernel/src/processor/worklet.ts), and the
`flush` message in [protocol.ts](../../platform/kernel/src/processor/protocol.ts).

| Choice | Reason |
|---|---|
| A processor borrows the Session's scheduling binding instead of registering as a participant (changed from the plan) | A participant declares a content duration; an instrument has none, and registering it would make the Session's end unknown. Session-relative automation and `SessionLFO` already borrow the binding the same way |
| Invalidation is an explicit `flush` from the module, not an epoch comparison in the kit (changed from step 3) | Epochs belong to each producer. Comparing them across sources would silence a live keyboard (epoch 0) once a scheduler advanced its epoch |
| Flush withdraws queued *scheduled* onsets and cancels sounding scheduled notes; immediate gestures continue | A seek must not cut a note the player is holding on a keyboard |
| No epoch filtering on the main thread either | It would silently drop notes from a scheduler that does not follow the Session; a Session-aware scheduler stops emitting inside the same synchronous invalidation, and anything already posted is flushed |
| Released notes keep their release tail through a flush | A tail is the author's sound design, not a stale note; the reference probe's 80 ms release fades out after a pause and then reads exactly zero |
| `block.transport` is derived per block from the last anchor, folded into the loop | One message per anchor; no per-block traffic |
| Effects still reject `transport` and `noteInput` | An insert has no Session or note path; the error points to `createProcessorModule` |

Browser evidence (2026-11-14, in-app Chromium, private runner checks I6–I7,
with a Session-aware lookahead scheduler and a "session-probe" instrument
written with the public kit):

- **DSP-A5 offline (I6):** 10 s of a Session with a seek at 3 s, a pause at
  5 s and a 22–24 s loop from 6 s. 56 scheduled onsets heard on their exact
  frame, 0 missing, 0 stray. Of the onsets queued when a schedule was
  invalidated, 0 of 4 were heard: a small sample. While paused, the
  output reached 0.0059 in the first 10 ms (release tails of notes already
  ended) and exactly 0 after 100 ms. Two loop passes were scheduled.
- **Transport:** 33 processor position reports matched the Session anchor
  current at their frame to 0.000 ms, including loop passes.
- **Live (I7):** play, pause, resume, seek +10 s, a 4 s loop and leaving it:
  0 late notes, and the processor followed the Session to 0.00 ms.

Observed outside DSP-01: leaving a loop resumes the Session at its unwrapped
position (about 30 s after ten seconds in a 16–20 s loop), not where the loop
was. The processor follows that correctly; whether the Session should behave
so is an existing `SessionTransport` contract question.

Not established: background-tab timing, other browsers and devices, and
audible quality.

## Step 5 as built

[`createProcessorInstrument`](../../platform/kernel/src/processor/instrument.ts),
Score's [`Sound.processor`](../../packages/score/src/play/headless/sounds/processor.ts),
and the reference polyphonic processor in
[`doc/shared/processors/`](../../doc/shared/processors/poly-synth-dsp.ts): its
definition, its DSP and its worklet file, written only with the public kit.

| Choice | Reason |
|---|---|
| `Sound.processor` is built on a new Kernel `ProcessorInstrument`, not on a processor module (changed from the plan) | A synth backend speaks AudioContext seconds and occurrence handles and needs no ports, registry or Session; a module's note port allows one terminal gate per occurrence, but a player schedules a release with the onset and may later move or cancel it |
| A later release replaces one still queued in the kit | Gives exact scheduled durations that a pause, rate change or loop can still retime, earlier or later, until the release is reached; the note port sends one release per occurrence, so modules are unaffected |
| `cancelScheduledNote` withdraws a voice before its onset and releases a sounding one | Matches `OscillatorSynth`: a pause or seek fades held notes instead of clicking |
| A release at or after a voice's scheduled end is ignored | The player's timer-driven note-off arrives a little after the exact end the onset already scheduled |
| A borrowed parameter surface survives reconnection; the instrument binds and releases only its own bindings | `Sound.params` is created once and must keep driving each new node |
| `source` lets `Sound.processor` prepare itself on first connection; readiness waits for it | A player element creates its context lazily, so the application cannot always prepare first. Without `source`, connecting unprepared throws, as for effects |
| Disposal posts `close`; the kit returns `false` from `process` from then on | A disconnected node otherwise keeps rendering until garbage collection |
| The reference lives in `doc/shared/processors/` as copyable source, not a package export | It is an example for authors (step 7's guide uses it), tested by the documentation workspace and imported by the private runner through its checkout link |
| The reference voice is one PolyBLEP sawtooth, a TPT state-variable lowpass and an ADSR; 32 voices; stealing fades the old note up to the new onset | Comparable with `OscillatorSynth`'s sawtooth, lowpass and envelope; all state lives in typed arrays allocated in `create` |

Evidence:

- **DSP-A10 (automated, `doc/test/processor-reference.test.ts`):** 10 minutes
  of dense polyphony through the kit and the reference, with forced
  collection: retained heap growth under 64 kB. With no collection in
  between, 40,000 further blocks add under 128 kB to the used heap; a fixed
  30–50 kB is measurement overhead at any block count, and a deliberate
  per-block allocation in `process` raised it to 1.17 MB in 20,000 blocks.
- **DSP-A11 (browser, recorded and not gated; I9, 2026-11-14, in-app
  Chromium on the development Mac):** 30 s of Arabesque No. 1 rendered offline,
  median of 3, peak polyphony 7 per channel. One channel: `OscillatorSynth`
  172 ms (16.6 µs per block, 833 nodes), processor 159 ms (15.4 µs, 13 nodes),
  ratio 0.92. Four Rack channels (28 voices): 648 ms (62.7 µs, 3,323 nodes)
  against 523 ms (50.6 µs, 43 nodes), ratio 0.81. Node counts include the
  Rack's and Sounds' own gains; the processor adds one worklet node per
  channel. These numbers are not a budget until they are observed on devices.
- **DSP-A12 live (I8):** Arabesque through a Rack channel on
  `Sound.processor(polySynth, {source})`: prepared on first play, 10 s
  played with 0 late notes and peak 0.11 at the channel bus, silent 600 ms
  after pause, sounding again after a seek to 40 s.

Not established: realtime CPU load (the benchmark is offline), background-tab
timing, other browsers and devices, and audible quality.

## Step 6 as built

[`processorPlugin`](../../platform/kernel/src/processor/plugin.ts) and
`ProjectModuleUnavailableError` in
[project-types.ts](../../platform/kernel/src/module/project-types.ts), honoured
by the project runtime's restore.

| Choice | Reason |
|---|---|
| A factory can declare its module unavailable; the runtime keeps that record unresolved instead of failing the restore (new, general) | Before, only a missing plugin stayed unresolved and any factory error rejected the whole project. An unprepared processor is the same situation as a missing plugin: the document is valid, this environment cannot build that module yet |
| Only that error type is downgraded; every other factory error still rejects | A broken factory or bad saved data must not be silently hidden |
| The plugin prepares from `source` when given; otherwise an unprepared processor is unavailable | Applications that preload processors keep control; others let restoration load them |
| The record's `config` is the processor's `create` config; parameters use the existing save and restore of the parameter surface | No processor-specific schema |
| Registered under the definition's `id` and `version` | A project saved with another processor version stays unresolved instead of loading an incompatible processor |
| `retryMissing()` recovers an unresolved processor | It re-restores from the export, which keeps the unresolved record, its parameters and its connections |

Evidence (2026-11-14, in-app Chromium, private runner check I10): a project
with Arabesque No. 1 from a Bridge Score player routed through a soft-clip
processor module restored with the processor unprepared — the module and its
connection unresolved, with the reason, and the saved drive 6 kept. After
`prepareProcessor` and `retryMissing()` the module was ready with drive 6 and
nothing unresolved; setting drive 20, exporting to JSON and restoring gave 20
saved and live. Unit tests cover the same paths plus a failed source load, a
version mismatch, note connections and report relaying.

Not established: audible quality of the restored chain, other browsers.

## Step 7 as built

The site page [Write a processor](../../doc/src/content/docs/kernel/processors.mdx)
(`/kernel/processors/`), its demo
[ProgrammaticProcessorDemo](../../doc/src/components/programmatic/ProgrammaticProcessorDemo.astro),
and Score's `Effect.from`.

| Choice | Reason |
|---|---|
| One guide page under Kernel, not a Headless group | The site plan gives Kernel no Headless group; the guide routes to the member references in the Kernel API and Score `Sound` pages instead of copying them |
| The demo is the reference processor playing Arabesque No. 1 as a `ScorePlayer` instrument, with a `<score-synth-panel>` on its parameter surface | It shows the whole path a reader will build, using the shipped reference and no invented notes |
| Snippets use `declare` stand-ins for the reader's own files | The snippet checker compiles each example alone and cannot resolve local imports |
| Score gains `Effect.from(recipe)` (new) | Writing the guide showed that Score's `Effect` slots are typed as Score's own class, so a Kernel `processorEffect` recipe could not be passed there, and the Rack master realizes effects with Score's `build()`. The adapter makes a Kernel recipe a Score `Effect` everywhere; the step 2 wording that claimed direct use in Score slots is corrected |

Evidence (2026-11-14, in-app Chromium on the docs dev server): the page
renders under Kernel in the navigation; the demo loads the worklet file
through Vite's `?worker&url`, plays Arabesque No. 1 (time advancing, pause
holding), the panel binds eight controls (bus gain and the seven processor
parameters), there are no console errors, and the layout fits a 375 px viewport
without horizontal overflow. All page snippets compile against built
declarations.

Not established: the Element recipe and the project snippet are compiled, not
run on the page; a third party following the guide unaided; audible quality.

## Step 8 as built

`source.wasm` and compilation in
[prepare.ts](../../platform/kernel/src/processor/prepare.ts), the definition's
`wasm` and `sharedRing`, [`ProcessorRing` and
`processorCapabilities`](../../platform/kernel/src/processor/ring.ts), the
kit's `setup.wasm` and `setup.ring`, and the WebAssembly reference processor
in [`doc/shared/processors/wasm-gain*.ts`](../../doc/shared/processors/wasm-gain.ts).

| Choice | Reason |
|---|---|
| The binary is part of the `ProcessorSource`, not the definition (changed from the proposal's `wasm` URL field); the definition only says `wasm: true` | Same rule as the worklet URL: the definition stays data a worklet imports. The flag still enters the signature, so a definition that needs a binary cannot be prepared without one |
| Compiled once per context during preparation, before the worklet registers; each node gets the module, and the processor owns its instance and memory | Compilation is the slow, fallible part and belongs with the other waiting; a broken binary leaves nothing registered |
| The shared ring is declared by the definition, created per node, and given only where `processorCapabilities().sharedMemory` is true | One processor works on isolated and non-isolated pages; `required: true` turns its absence into a preparation failure with the reason, as the proposal specified |
| The ring is a single-producer, single-consumer `float32` ring; a full ring drops and counts | The audio thread must never block or allocate |
| Insert effects get no ring | No owner of an `InsertChain` slot could read it |
| The kit's processor class is created once per worklet scope, with a thin subclass per definition | One copy of the per-block code however many processors a worklet file defines |
| The reference passes only integers to WebAssembly and keeps floats in its memory | Measured: with two or more instances, one JS call site passing a fractional argument to their exports allocated about 16 bytes per call (V8 boxes the double); integer arguments allocated none. Every node owns an instance, so two nodes already trigger it |

Evidence:

- **Automated:** unit tests for the ring (order across the wrap, the empty
  slot, drop counting, two views of one buffer), capabilities, compilation from
  bytes, a URL and a compiled module, rejection of a missing or broken binary
  without registering, the required-ring rejection, per-node rings on modules
  and none on inserts, and the kit's handoff. The WebAssembly reference
  renders 40,000 blocks with two nodes and a ring under 128 kB of used-heap
  growth (the argument pattern above measured 1.3 MB).
- **Browser (2026-11-14, in-app Chromium, private runner check I11):** as a
  normal page, `crossOriginIsolated` false, `sharedMemory` false, the
  ring-requiring processor rejected with the isolation reason, no ring, and
  peak reports over messages. Reopened with COOP/COEP headers,
  `crossOriginIsolated` true, `sharedMemory` true, the strict processor
  prepared, and the ring carried the output at about 44,000 samples a second
  (context 44,100 Hz) with 0 dropped. On both, Arabesque No. 1 rendered
  offline through the WebAssembly gain at 0.5000 of the dry level and played
  live.

Not established: other browsers and devices, ring throughput under load, and
the documentation site's behaviour, which is never isolated on GitHub Pages
(the guide says so).

## Development sequence

Each step is one reviewable change. It ends with its tests failing without the
change, `npm run check` passing, the owning reference updated, and — where the
result is audible — a manual check in the private acceptance runner. Steps
build in order; none starts a later one's surface early.

| Step | Deliverable | Main work | Proves |
|---|---|---|---|
| 0 — done | Entries, definition, protocol, preparation, kit core | `definition.ts`, `protocol.ts`, `prepare.ts`, `worklet.ts`; manifest, build and policy entries; Kernel API sections | Validation, per-context preparation, block adaptation and failure reporting (unit tests) |
| 1 — done | Audio-only processor module | `createProcessorModule(context, definition, options)`: `AudioWorkletNode`, audio input/output ports, a `ParamSurface` bound to the node's `AudioParam`s, readiness, error reports, disposal; declared latency published on its ports | DSP-A6, A7, A9 |
| 2 — done | Processor as an insert effect | `processorEffect(definition)` for `InsertChain` and `.effect`; offline realization through `renderModuleGraph`; first browser check with a gain or soft-clip processor on Arabesque No. 1 | DSP-A1, A2 |
| 3 — done | Notes on the audio thread | Main-thread note bridge (occurrence integers, frame conversion); kit event queue with sample-offset dispatch, `cancel`, epochs and a late counter; decide offline note delivery by measurement | DSP-A3, A4 |
| 4 — done | Transport and Session following | Anchor messages, `block.transport`, participant registration with the real timing mode, invalidation on seek, pause and loop | DSP-A5 |
| 5 — done | Reference instrument | A polyphonic reference processor to copy; Score `Sound.processor(definition)` over `HeadlessSynth`; allocation harness and the first benchmark against `OscillatorSynth` | DSP-A10, A11, A12 |
| 6 — done | Projects | `processorPlugin(definition)`; save, restore and unresolved recovery | DSP-A8 |
| 7 — done | Author guide | One self-contained page: worklet file, definition, module, panel on its `ParamSurface`, element recipe, project registration; Headless reference page and demo | A third party can follow it without design history |
| 8 — done | WASM and shared memory | Compiled-module handoff; optional ring buffer reported as a capability when `crossOriginIsolated` | Capability reporting with and without isolation |

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
