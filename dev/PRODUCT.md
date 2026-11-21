# Product definition

> Accepted product direction, based on the maintainer's brief of 2026-09-05. This document owns positioning, users, integration choices, and scenario goals. Completion belongs to [STATUS](STATUS.md); implementation belongs to [Architecture](ARCHITECTURE.md).

## Release scope

DEC-021 describes the original three-package release of Kernel, UI Kit and
Score. DEC-046 accepts integration of the current five-package source tree into
`main`, including Audio and Bridge. This changes the repository's development
surface; registry publication of changed or additional packages is a separate
manual release. [STATUS](STATUS.md) records this checkout's verification and
remaining delivery gaps.

## Product promise

WebMusic provides composable musical data, runtime behavior, and interactive presentation. A working demo should be able to grow into music software or a web-based installation using the same contracts. Developers choose how much to reuse while keeping control of their interface, input mechanisms, and artistic expression.

Long-term applications include an online music workstation comparable in ambition to Ableton Live, and musical installations driven by gestures, sensors, notation, samples, and visuals. These describe the complexity the toolkit should support. They do not imply that this repository already ships a complete DAW, project editor, undo system, collaboration service, or installation-authoring platform.

## Users and tasks

| User | Starting point | Task |
|---|---|---|
| Interactive demo author | An audio clip, MIDI/MusicXML file, or short score | Quickly obtain real playback, input, viewing, or analysis |
| Music software developer | An application framework, project model, and workflow | Reuse engines and models while composing editing, playback, mixing, recording, and visualization |
| Creative coder or installation artist | Pointer, scroll, MIDI, sensor, or custom events | Map input to musical time and parameters, with coordinated sound and visuals |
| Researcher or educator | An algorithm, dataset, experiment, or lesson | Exchange data and connect parameters and results to audible or visible changes |

Their common needs are a manageable starting cost, replaceable layers, reliable lifecycle behavior, and explicit time semantics. Advanced use should retain the models and runtimes used in the first prototype.

## Three integration choices

| Choice | WebMusic supplies | The application supplies | Typical use |
|---|---|---|---|
| Components | Tags, attributes and object properties, events, default interaction and presentation | Data and resources, connections, appearance, and permissions | Quick demos, embedded players, analysis tools, artwork prototypes |
| Headless classes | Stateful players, controllers, sessions, models, and lifecycle contracts | UI, framework bindings, and project workflow | Custom music software and distinctive installation interactions |
| API + UI | Data operations, parsing/analysis/rendering functions, and independent presenters | Capability selection and structural bindings to application-owned state and commands | Deep customization, algorithm visualization, or replacement of one layer |

These choices can coexist in one application. APIs can be used without UI; presenters can bind to the caller's own model. React and other integration adapters do not change the underlying ownership or capability contracts. Environment support remains entry-specific.

Playback-connected Analyze and View components should be able to attach to a
Play component and reuse its loaded data, current state, and timeline. A developer
should load a piece once, then compose independent readouts, analysis, and views
around its player. Custom Headless and API + UI integrations should expose the
same underlying behavior. Static analysis and views can still use explicit data
without playback. This is the accepted composition direction in
[Player binding](design/PLAYER-BINDING.md), not a claim that every current Element already
supports the target syntax; delivery gaps belong to [STATUS](STATUS.md).

Editing adds a document owner shared by these same integration choices. Under
DEC-053, editing uses a persistent domain editor that commits content
and can provide bounded history for one document. Play borrows its current
content and reports the revision actually applied for playback; View borrows
content and edit commands. Score notes are edited on a dedicated DAW-style
piano-roll grid View whose features the application can switch on or off; the
waveform View gains optional editing interaction. Applications load or create the editor through the
Headless API and lend it to those Elements; there is no document Element.
The [editing design](design/EDIT-COMPONENTS.md) specifies this contract;
[STATUS](STATUS.md), EDIT-01, records delivery. Score editing, native document-bound playback, editor loading and piano-roll
interaction are documented in the [Score View API](../doc/src/content/docs/score/api/view.mdx)
and [Score grid View](../doc/src/content/docs/score/element/view/score-grid-view.mdx).
Audio sequence editing, local processing and WAV export are documented in
the [Audio View API](../doc/src/content/docs/audio/api/view.mdx),
[Audio Play export](../doc/src/content/docs/audio/api/play.mdx) and
[Audio View](../doc/src/content/docs/audio/element/view/audio-view.mdx).
Staff and notation editing are not part of the current contract (DEC-058).

## Objects, components and apps

WebMusic has three product layers (DEC-074). Every maintained document, Studio
and the Library use these names for them. A layer is the contract a thing
meets, not where it came from or how large it is (DEC-081).

| Layer | Max counterpart | Contract | Package counterpart | Who makes it | Where it runs |
|---|---|---|---|---|---|
| Object | Object | A typed box with inlets and outlets that runs only inside a graph, backed by one Kernel module from a project plugin | API functions, Headless classes and UI Kit presenters | The packages and Studio | Inside a component |
| Component | Patch, or a hosted plugin | Self-contained, portable code with its own interface: copy it into a web project, install the WebMusic packages, and it runs alone on a page | Components | The packages (official components), Studio users and the community | Any web project; inside a graph, as a box with ports |
| App | — | A web page of boxes, text, images and components chosen in the Library; its components share one Session and are connected by choice (DEC-092) | — | Users | The browser, as a page or an installation |

The test between an object and a component is whether the thing is useful
alone on a page. A slider, a dial or a button is not, so interface objects
are objects; a keyboard, an oscilloscope or a piano roll is, so each is a
component. `score` and `sample` are Headless players with no interface and
are objects. A `buffer` holds named samples and shows nothing; its waveform is
the official component `<audio-clip-view>`, bound to the buffer by name.

A component is authored in one of two ways under the same contract. The
packages' Components are written in code from a Headless class and
presenters; they are sealed and cannot be opened in Studio. A component built
in Studio is a graph of objects and can be opened. Only components run in an
app, whose page also holds boxes, text and images (DEC-092); a graph-authored
component is made of objects and of other
components; a code-authored component is made of the packages' public
entries.

Any component can be placed in a graph, where it is a box with ports. The
`component` object does this for graph-authored components. The official
components — `keys`, `roll`, `scope`, `meter`, `spectrum`, `level` and
`clip` so far — are placed by their
[component manifests](design/DEVELOPER-TOOLS.md#component-manifest), which
declare their ports, parameters and size, so a graph holds any component
that has one ([STATUS](STATUS.md), LAYER-01). An app's components are a project
whose boxes are all components, with the same ports and Session as any
graph; its page is designed as a web page is, in boxes that lay out text,
images and those components, and what a component follows or hears is chosen
in its inspector (DEC-092). The App editor builds apps this way, from the
same listing of official and the user's own components as Studio's
libraries; community components have no place that holds them yet.

Each layer keeps its contract when it moves up: an object behaves the same in
every component, and a component behaves the same whether it is pasted into a
web project, placed in a graph or placed in an app.

A component's portability is its defining requirement. Its code depends only
on public package entries: no Studio runtime, private source or hosted
service. Its media and other resources are declared, so the receiving project
knows what to serve. The packages' own Components — `<score-player>`,
`<audio-oscilloscope>` and the rest — are the official components. A
component built from objects in Studio meets the same contract: Studio
exports it as a module or a standalone page over `@webmusic/bridge/component`
(DEC-078). Running one in a fresh project that installs only the packages is
not yet verified ([STATUS](STATUS.md), LAYER-01).

Earlier names are retired in current writing. The packages' tags are
*Components*, not *Web Components*; a graph of objects is a *component*, not a
*patch*; the code-only classes behind Components are *Headless classes*, and
one running one is a *Headless instance*, never a *Headless object* or
*Headless component*. *Custom element* names the browser technology a
Component is built on. Some words keep a technical meaning beside the layers:
a *module* is the Kernel runtime unit behind an object, a *project* is the
serialized Kernel document a component's graph is saved as, an *Element* is
the class behind a Component's tag, and a *presenter* is a UI Kit renderer.
Dated records, earlier decisions and public API names such as `/element`,
`define…Element` and `@webmusic/ui/patch-editor` keep their wording.

## One session's time and data

Score represents symbolic music; Audio represents digital audio. Each retains its own data model and units. Static musical data does not need to own a running clock. Playback, recording, analysis followers, and views participating in one session should follow one authoritative transport timeline, mapped explicitly to beats, audio seconds, or sample positions.

Bridge owns work involving both domains: synchronization, timeline mapping, offline rendering, and assembly of transcription results. Score-to-audio rendering requires choices such as timbre and sample rate. Audio-to-score conversion involves estimation and quantization and can infer or lose information. Conversion contracts must state their assumptions and precision; lossless bidirectional round trips are not promised.

An application can run multiple independent sessions. Common timing applies to participants that must act together, rather than requiring every preview or artwork in a process to share a global singleton. The current coordination mechanism and the further injection design are described in [Architecture](ARCHITECTURE.md) and [Shared-clock injection](../platform/shared-clock-injection.md).

An editing document does not own a playback clock. Its committed revision and
the player's applied revision are separate observable states. The first editing
workflow pauses while preparing changed content and remains paused after applying
it. A failed playback update leaves the edit available for correction and export;
the player must not present older content as the current revision.

## Composition scenarios

| Scenario | Toolkit composition | Application responsibilities |
|---|---|---|
| Score audition and explanation | Score loading/building, player, view, analysis, transport UI | Content sources, teaching narrative, interaction sequencing |
| Sample editing and analysis demo | AudioClip, player, waveform, regions, analysis, meter, document editor and optional local history | Asset persistence, project/global history, operational layout |
| Synchronized notation and recording | Score, AudioClip, Bridge, views from both families | Alignment source, offsets, tempo/BeatGrid interpretation and calibration |
| Online music workstation | Parts/tracks, mixing, effects, recording, session time, composable controls; domain edit commands and local history | Arrangement/session project model, project commands and cross-document undo, persistence, export workflow, plugin orchestration |
| Musical installation | Input drivers, interactive player, parameter mapping, score/audio data, arbitrary visual surfaces | Artistic rules, sensor integration, spatial and visual language, deployment conditions |

These are composition directions, not a list of completed application features. STATUS records capability readiness.

Single-document history is optional: an application may own its history policy
and integrate editor transactions into a larger command system. Project-wide
undo, persistence and collaboration remain application responsibilities. Audio
editing starts with retained assets and an immutable contiguous sequence of
segment references, so ordinary edits and undo do not copy complete PCM buffers.
This single-file model does not itself supply multi-track arrangement or mixing.

## Existing resources as building blocks

Reuse established formats, Web Audio/Web MIDI, timbres and samples, WASM algorithms, analysis libraries, and renderers. Integrate through explicit models, bindings, drivers, engines, and worker interfaces. The caller should know who loads a resource, when it becomes available, how failure is reported, and who releases it.

Keep baseline tasks useful with a small dependency set; choose heavier dependencies by entry or feature. Installation, environments, licenses, and resource costs belong to the integration contract. Browser capabilities and permission requests must remain visible to the application. Demos should show real loading, empty, denied-permission, and unavailable-capability states.

Current integration references are organized by the resource being connected:

| Resource | Contract to start with |
|---|---|
| Symbolic formats and score import/export | [Score I/O](../doc/src/content/docs/score/api/io.mdx) |
| Timbres, effects, and musical input | [Score playback](../doc/src/content/docs/score/api/play.mdx) and its Headless/driver links |
| Audio files, decoding, playback, and capture | [Audio playback](../doc/src/content/docs/audio/api/play.mdx) and its Headless links |
| Analysis engines and transcription | [Audio analysis](../doc/src/content/docs/audio/api/analyze.mdx) |
| Custom visuals and controls | [UI contracts](../packages/ui/README.md), [Score views](../doc/src/content/docs/score/api/view.mdx), and [Audio views](../doc/src/content/docs/audio/api/view.mdx) |
| Coordination and cross-domain conversion | [Bridge](../bridges/score-audio/README.md) |

Those references and manifests own the supported entries and dependency details.
An additional format, engine, or sensor becomes supported through an implemented
adapter and verified example; the product ambition alone does not make it available.

## What improvement means

These are acceptance directions, not measured claims: fewer steps from example to audible/visible feedback; preservation of data and runtime objects when replacing a tag with custom UI; reuse of existing interfaces for new resources; consistent participants after play/pause/seek/rate/loop; understandable values and readiness states; and teardown or remount without lingering sound, subscriptions, or resources.

See [Decisions](DECISIONS.md) for accepted tradeoffs and [Design principles](DESIGN-PRINCIPLES.md) for interaction and visual constraints.
