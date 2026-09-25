# Product definition

> Accepted product direction, based on the maintainer's brief of 2026-09-05. This document owns positioning, users, integration choices, and scenario goals. Completion belongs to [STATUS](STATUS.md); implementation belongs to [Architecture](ARCHITECTURE.md).

## Release scope

The first release from `main` contains Kernel, UI Kit and Score. Score keeps its
Web Components, Headless and API + UI integration choices, including sound
playback. Audio and Bridge are deferred from this checkout; their implementation
and public references have not yet been migrated into the new repository's
published `dev` branch. The cross-domain scenarios below remain the long-term
product direction, outside this release. [STATUS](STATUS.md) owns the current
delivery boundary.

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
| Web Components | Tags, attributes and object properties, events, default interaction and presentation | Data and resources, connections, appearance, and permissions | Quick demos, embedded players, analysis tools, artwork prototypes |
| Headless components | Stateful players, controllers, sessions, models, and lifecycle contracts | UI, framework bindings, and project workflow | Custom music software and distinctive installation interactions |
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

## One session's time and data

Score represents symbolic music; Audio represents digital audio. Each retains its own data model and units. Static musical data does not need to own a running clock. Playback, recording, analysis followers, and views participating in one session should follow one authoritative transport timeline, mapped explicitly to beats, audio seconds, or sample positions.

Bridge owns work involving both domains: synchronization, timeline mapping, offline rendering, and assembly of transcription results. Score-to-audio rendering requires choices such as timbre and sample rate. Audio-to-score conversion involves estimation and quantization and can infer or lose information. Conversion contracts must state their assumptions and precision; lossless bidirectional round trips are not promised.

An application can run multiple independent sessions. Common timing applies to participants that must act together, rather than requiring every preview or artwork in a process to share a global singleton. The current coordination mechanism and the further injection design are described in [Architecture](ARCHITECTURE.md) and [Shared-clock injection](../platform/shared-clock-injection.md).

## Composition scenarios

| Scenario | Toolkit composition | Application responsibilities |
|---|---|---|
| Score audition and explanation | Score loading/building, player, view, analysis, transport UI | Content sources, teaching narrative, interaction sequencing |
| Sample editing and analysis demo | AudioClip, player, waveform, regions, analysis, meter | Asset management, edit history, operational layout |
| Synchronized notation and recording | Score, AudioClip, Bridge, views from both families | Alignment source, offsets, tempo/BeatGrid interpretation and calibration |
| Online music workstation | Parts/tracks, mixing, effects, recording, session time, composable controls | Arrangement/session project model, commands and undo, persistence, export workflow, plugin orchestration |
| Musical installation | Input drivers, interactive player, parameter mapping, score/audio data, arbitrary visual surfaces | Artistic rules, sensor integration, spatial and visual language, deployment conditions |

These are composition directions, not a list of completed application features. STATUS records capability readiness.

## Existing resources as building blocks

Reuse established formats, Web Audio/Web MIDI, timbres and samples, WASM algorithms, analysis libraries, and renderers. Integrate through explicit models, bindings, drivers, engines, and worker interfaces. The caller should know who loads a resource, when it becomes available, how failure is reported, and who releases it.

Keep baseline tasks useful with a small dependency set; choose heavier dependencies by entry or feature. Installation, environments, licenses, and resource costs belong to the integration contract. Browser capabilities and permission requests must remain visible to the application. Demos should show real loading, empty, denied-permission, and unavailable-capability states.

Current integration references are organized by the resource being connected:

| Resource | Contract to start with |
|---|---|
| Symbolic formats and score import/export | [Score I/O](../apps/doc/webmusic/src/content/docs/score/api/io.mdx) |
| Timbres, effects, and musical input | [Score playback](../apps/doc/webmusic/src/content/docs/score/api/play.mdx) and its Headless/driver links |
| Audio files, decoding, playback, and capture | [Architecture](ARCHITECTURE.md) and [status](STATUS.md); no Audio public entry in this checkout |
| Analysis engines and transcription | [Product direction](#one-sessions-time-and-data) and [status](STATUS.md); no Audio analysis reference in this checkout |
| Custom visuals and controls | [UI contracts](../packages/ui/README.md) and [Score views](../apps/doc/webmusic/src/content/docs/score/api/view.mdx); Audio view references await migration |
| Coordination and cross-domain conversion | [Shared-clock design](../platform/shared-clock-injection.md) and [Architecture](ARCHITECTURE.md); Bridge reference awaits migration |

For packages present in this checkout, public references and manifests own the
supported entries and dependency details. The Audio and Bridge rows describe
design direction, not callable entries here. An additional format, engine, or
sensor becomes supported through an implemented adapter and verified example;
the product ambition alone does not make it available.

## What improvement means

These are acceptance directions, not measured claims: fewer steps from example to audible/visible feedback; preservation of data and runtime objects when replacing a tag with custom UI; reuse of existing interfaces for new resources; consistent participants after play/pause/seek/rate/loop; understandable values and readiness states; and teardown or remount without lingering sound, subscriptions, or resources.

See [Decisions](DECISIONS.md) for accepted tradeoffs and [Design principles](DESIGN-PRINCIPLES.md) for interaction and visual constraints.
