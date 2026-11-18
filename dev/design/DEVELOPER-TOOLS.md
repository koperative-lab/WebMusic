# Developer tools: observing, scripting, plugins and export

Status: accepted direction, in delivery
([DEC-078](../DECISIONS.md#dec-078--observing-scripting-plugins-and-exporting-components)).
Layers and public entries: Kernel `/module` (`observe`, `probeSignal`,
`MessageDebugger`, clock `hold`/`resume`/`step`, `wamPlugin`), Kernel
`/objects` (`ScriptSandbox`, `js`) and Bridge `/component`.
Source: [observe.ts](../../platform/kernel/src/module/observe.ts),
[project-runtime.ts](../../platform/kernel/src/module/project-runtime.ts),
[message.ts](../../platform/kernel/src/module/message.ts),
[script.ts](../../platform/kernel/src/objects/script.ts),
[wam.ts](../../platform/kernel/src/module/wam.ts) and
[bridges/score-audio/src/component/](../../bridges/score-audio/src/component/).
Owning references: [Kernel API](../../doc/src/content/docs/kernel/api.mdx) and
[Bridge API](../../doc/src/content/docs/bridge/api.mdx).
Delivery owner: [STATUS](../STATUS.md), DEVX-01 and LAYER-01.

This is the fourth group of Max features: what a developer needs to see a
component work, to write code inside one, to host plugins, and to take a
component out of Studio as portable code (the component layer of DEC-074).

## Observing a running project

`runtime.observe(listener)` reports a `ProbeEvent` for every message or note
about to cross a cord of the active graph:

| Field | Meaning |
|---|---|
| `kind` | `message` or `note` |
| `connectionId`, `from`, `to` | The project connection and its endpoints |
| `message` / `event` | The value, as the receiver will get it |
| `depth` | For messages: 1 for a send from outside delivery, more for each nested send |
| `sequence` | One more per observed delivery of the runtime |

The runtime installs a tap on each source port just before the cord, so a
listener runs before the receiver, in delivery order, even among several cords
from one outlet. Delivery is unchanged; a listener cannot stop or alter it and
its errors are reported, not propagated. Observers survive rebuilds.

`runtime.probeSignal({moduleId, port}, {fftSize})` gives an analyser that
listens to an audio output (as a send) or a control output, reconnected after
every rebuild; `connected` says whether the endpoint exists now. The probe
owns the analyser.

Editor cords carry `recordId`, the project connection they show, so an editor
can place probe values on its own cords without knowing adapter IDs.

## Watchpoints

Message clocks (`AudioMessageClock`, `ManualMessageClock`) can `hold()`,
`resume()` and `step()`. Holding stops scheduled events after the event being
delivered finishes; untimed messages (clicks, typed values) still flow and
audio keeps playing. `resume()` moves held events later by the time spent
holding, so a metro continues its rhythm rather than catching up. `step()`
delivers one held event now.

`new MessageDebugger(runtime, clock)` holds watchpoints `{id, connectionId,
mode: 'trace' | 'break', condition?}`. Every hit is reported to `onHit`; a
`break` also holds the clock. `continue()`, `step()` and `paused` drive a
debugger view. A break holds the shared clock of the AudioContext, so every
runtime on that context pauses its timed objects together.

## Scripts

`ScriptSandbox` runs user code in a Worker made from a Blob URL. The host
offers functions as `<namespace>.<name>(…)`, called by message and answered
with a promise; the script writes with `post(…)` and, as an object, sends with
`outlet(index, …values)`. `evaluate(code)` runs REPL input in the Worker's
global scope; input with `await` runs as a browser console runs it, keeping
top-level declarations and returning the last expression. `terminate()`
stops the thread and rejects pending calls.

The `js` object (`js [inlets] [outlets]`, code in `config.state.code`) calls
the function named by a message's selector (`bang`, `msg_int`, `msg_float`,
`list`, or any word), else `anything(selector, …values)`, with `inlet` and
`messagename` set. Its outputs arrive asynchronously and untimed.

Isolation: a script cannot reach the page, the editor or the audio graph
except through what it is given, and an endless loop stalls only its thread.
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `importScripts` are
removed as a convenience, but a dynamic `import()` still reaches the network:
this is not a security boundary for untrusted code.

## Web Audio Modules

`wamPlugin({hostGroup, load?, allow?, id?})` makes `webmusic.wam` modules
from `config.url`. `hostGroup(context)` returns the group ID from
`initializeWamHost` of `@webaudiomodules/sdk`, called once per AudioContext;
`load(url)` defaults to a dynamic import; `allow(url)` defaults to http(s) and
same-site paths. A module has `input` and `output` when the WAM declares
audio, `notes` when it takes MIDI (sent as `wam-midi` events at the note's
time), one Kernel parameter per WAM parameter, and lends `WAM_MODULE` with the
plugin's own GUI. `config.state` passes to `createInstance` and is refreshed
after parameter changes. A WAM that fails to load leaves the module
unresolved with the reason. A WAM's code runs in the page: load only plugins
you trust.

## Components outside Studio

`@webmusic/bridge/component` needs `@webmusic/ui` installed and provides:

| Export | Role |
|---|---|
| `createComponentPlugins(options)` | Every plugin a component may use: Bridge players and effects (the score player with its `source` outlet), `mc.` effects, Kernel objects, sampler and MIDI objects, view objects, WAMs when configured, and `extra` |
| `ComponentSurfaces`, `webmusic.surface.keys`/`scope`/`meter`/`spectrum`/`roll` | View objects: their plugins and the slots their elements borrow |
| `createViewElement`, `bindViewElement`, `bindBufferView` | The packages' Elements for views and buffers, bound to their slots |
| `fitViewElement`, `viewWidth` | A view as tall as its box, and its natural width (DEC-080) |
| `mountObjectControl`, `controlSize` | The UI Kit control of an interface object, filling its host, and its natural size |
| `resolveComponentAsset` | MIDI and MusicXML as a Score, audio files as an AudioClip, by URI |
| `mountComponent(host, project, options)` | Run a project and show its presentation under a UI Kit transport |
| `defineComponentElement(tag, project, options)` | A custom element that mounts the project in its shadow root while connected |
| `componentModuleSource`, `componentPageSource`, `componentResources` | Exported code: a module defining the element, a standalone page, and what either needs beyond the packages |

A mounted component shows the modules placed in the project's presentation,
or every view, interface object and buffer at its editing position when
nothing is placed. Copies of a poly's voices are not shown. The first pointer
or key in the component resumes its AudioContext.

An exported module imports `@webmusic/bridge/component`, so a project that
installs the five packages can import it and write the element. An exported
page imports the published entry from jsDelivr's ESM build, so every package
loads once from the same URLs; it works only once the version it names is
published. Plugins outside the standard set (DSP processors such as Studio's
reference synth) are listed in the code as resources to supply through
`extra`; assets keep their URIs relative to the page.

## Studio

Studio builds on these:

- **Probes and watchpoints:** a probe on a selected cord shows its last value or level at the cord.
- **Illustration mode:** replays deliveries on the cords of the open view, one every 320 ms, with their nesting depth.
- **Console and REPL:** the Output panel's console takes REPL input with `patch.add`, `connect`, `retype`, `remove`, `send`, `objects`, `cords`, `move`, `select`, `undo`, `redo`, `tempo`, `play`, `stop` and `print`. Every call is an ordinary, undoable command.
- **Editing js objects:** a js object's code is edited in the inspector.
- **WAM objects:** `wam url` objects need the SDK installed.
- **Export card:** writes the module and the page.
- **Library:** holds several component files in the browser, templates that use Arabesque No. 1, user templates and snippets of objects.

## Ownership

| Resource | Created by | Released by |
|---|---|---|
| Observation taps | The runtime, per cord | The cord's lease |
| Signal probe analyser | `probeSignal` | The probe's `release` or the runtime's disposal |
| Clock hold | `MessageDebugger` on a break | `continue`, or the debugger's `dispose` |
| Script Worker and Blob URL | `ScriptSandbox` | `terminate` (the `js` object's disposal) |
| WAM instance and node | `wamPlugin` | The module's disposal (`destroy`) |
| Component runtime, elements, bindings | `mountComponent` | `destroy`, or the element's disconnection |

## Acceptance

| ID | Scenario |
|---|---|
| DEVX-A1 | Observers see each delivery before the receiver, in order and depth, and delivery is unchanged |
| DEVX-A2 | A signal probe follows its endpoint across rebuilds and disconnects when it goes |
| DEVX-A3 | A break holds timed objects at the hit; step delivers one event; continue resumes without a burst |
| DEVX-A4 | A js object answers by selector, sends from its outlets, and a stuck script leaves the page responsive |
| DEVX-A5 | REPL input keeps its declarations and returns values; host calls are undoable commands |
| DEVX-A6 | A WAM exposes ports, parameters, notes and state; a failed load leaves it unresolved |
| DEVX-A7 | An exported component runs as its element with the packages alone, shows its presentation and rebuilds when re-added |
| DEVX-A8 | A standalone page loads the published packages once and runs the component |

Automated tests cover DEVX-A1–A7 against fakes and jsdom; the private
runner's M1–M3 and the owner's checks cover the browser. DEVX-A8 waits for a
published release; a WAM is unverified until a host installs the SDK.
