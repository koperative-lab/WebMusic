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
The [component manifest](#component-manifest) is an accepted target
([DEC-081](../DECISIONS.md#dec-081--a-layer-is-a-contract-a-component-in-a-graph-is-an-object))
with no implementation yet.

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
| `createComponentPlugins(options)` | Every plugin a component may use: Bridge players and effects (the score player with its `source` outlet), `mc.` effects, Kernel objects, sampler and MIDI objects, the official components, WAMs when configured, and `extra` |
| `OFFICIAL_COMPONENTS`, `ComponentManifest`, `projectManifest` | The [component manifests](#component-manifest) of the official components a graph can hold, and a graph-authored component's derived ports |
| `ComponentSurfaces`, `SurfaceSlot` | One project plugin per manifest, and the slots the Elements borrow from |
| `createComponentElement`, `bindComponentElement`, `fitComponentElement`, `bindBufferView` | A component's Element made, bound and fitted to its box from its manifest (DEC-080); a shared buffer in a clip view |
| `migrateBufferViews` | An older project's presented `buffer` moved into a `clip` |
| `mountObjectControl`, `controlSize` | The UI Kit control of an interface object, filling its host, and its natural size |
| `resolveComponentAsset` | MIDI and MusicXML as a Score, audio files as an AudioClip, by URI |
| `mountComponent(host, project, options)` | Run a project and show its presentation under a UI Kit transport |
| `defineComponentElement(tag, project, options)` | A custom element that mounts the project in its shadow root while connected |
| `componentModuleSource`, `componentPageSource`, `componentResources` | Exported code: a module defining the element, a standalone page, and what either needs beyond the packages |

A mounted component shows the modules placed in the project's presentation,
or every official component and interface object at its editing position when
nothing is placed. Copies of a poly's voices are not shown. The first pointer
or key in the component resumes its AudioContext.

An exported module imports `@webmusic/bridge/component`, so a project that
installs the five packages can import it and write the element. An exported
page imports the published entry from jsDelivr's ESM build, so every package
loads once from the same URLs; it works only once the version it names is
published. Plugins outside the standard set (DSP processors such as Studio's
reference synth) are listed in the code as resources to supply through
`extra`; assets keep their URIs relative to the page.

## Component manifest

Status: in delivery under DEC-081 and DEC-084. The manifests, the official
components placed through them, the players and desks that borrow a graph's
Session and the split `buffer` are implemented in Bridge `/component` and
used by Studio. Apps built from components in the Library
are not ([STATUS](../STATUS.md), LAYER-01).

A component can be placed in a graph, where it is a box with ports. A
component built in Studio is a `component` object whose ports follow its edge
objects ([Organization](ORGANIZATION.md#nested-components));
`projectManifest(project, contextId?)` derives the same ports, `in<n>` and
`out<n>` by family, and lists the project's assets. An official component is
placed by its `ComponentManifest`, declared in Bridge `/component` beside the
Elements it names — the only layer that may import both domains and the UI
Kit:

| Part | Declares |
|---|---|
| `name`, `summary`, `tag`, `plugin` | The box's name, its Element and its project plugin |
| `ports` | Each port's ID, family and direction, and the Element member that carries it |
| `parameters` | The box's arguments by position: config key, kind, fallback, range, and the attribute it is written to or the shared buffer it names |
| `asset` | For a player: the project asset role its box loads (a Score or an AudioClip) and the Element property it is given to |
| `attributes`, `locked` | Attributes the Element starts with in a graph, which a setting may replace; and those a setting never writes |
| `width`, `fit` | Its natural width, and how it follows a resized box: a height token measured against a part, or its `height` attribute |
| `edits` | Set to `score` when the Element edits a Score through `.editor` and `editable`: its box is lent the document of the box its `source` cord comes from (DEC-086) |

A port is carried by a public member the Element already has. An audio input
is connected to an `AnalyserNode` that the host hands to `analyser`. A source
input hands the upstream module to `inputModule` (DEC-063). A note output
forwards the note port of the Element's `module`. `inputModule` names a player
or source module, not an audio signal, so an audio cord is never handed to it.
A value that is not a port — the clip view's buffer name — is a parameter the
host binds.

A player or desk plays inside the graph (DEC-084). Its audio output is bound
through `context`: the box lends the Element, on the box itself, a module
context with the graph's audio environment, Session and registry whose
default destination is the box's output bus, so a player's engine joins the
graph's Session and its own transport commands it. A desk's audio inputs are
bound through `admit`: each is one numbered channel, admitted through the
Element's `module`. A player's `source` output carries its own `module` to a
companion's `inputModule`. A host binds such an Element on its box before the
box is shown, and removes it before releasing the binding, so it never starts
a Session of its own. The host owns the graph's Session and preloads it as
members join (`keepComponentSessionPreloaded`, DEC-069). A note input is bound
through `inputModule`: the Element is handed a module whose `notes` output
repeats the notes cabled to the box. A panel's source input is bound through
`moduleTarget`: the upstream module, or explicit `null` without a cord. One
generic project plugin per manifest makes the ports, and one
generic binding connects the Element; nothing branches on which component it
is.

| Box | Element | Ports | Fit |
|---|---|---|---|
| `keys` | `<score-note-input>` | `notes` note out, from `module` | `--wm-note-height` |
| `roll` | `<score-grid-view>` | `source` source in, to `inputModule` | `height` |
| `scope` | `<audio-oscilloscope>` | `input` audio in, to `analyser` | `--wm-oscilloscope-height` |
| `meter` | `<audio-meter>` | `input` audio in, to `analyser` | `height` |
| `spectrum` | `<audio-spectrum-analyzer>` | `input` audio in, to `analyser` | `--wm-spectrum-height` |
| `level` | `<audio-level-analyzer>` | `input` audio in, to `analyser` | none: a resized box clips it |
| `clip` | `<audio-clip-view>` | — (its optional `buffer` parameter names a shared buffer; unnamed, it binds nothing) | `height`, measured |
| `sheet` | `<score-sheet-view>`, `layout="flow"` | `source` source in, to `inputModule` | `height` |
| `view` | `<score-view>`; `type` staff, piano-roll or waterfall | `source` source in, to `inputModule` | `height` |
| `pitch` | `<score-pitch-view>`; `type` keyboard, staff or fretboard | `source` source in, to `inputModule` | none |
| `chords` | `<score-chord-analysis>` | `source` source in, to `inputModule` | none |
| `intervals` | `<score-interval-analysis>` | `source` source in, to `inputModule` | none |
| `rhythm` | `<score-rhythm-analysis>` | `source` source in, to `inputModule` | none |
| `degrees` | `<score-scale-analysis>`; `scale`, then `tonic` | `source` source in, to `inputModule` | none |
| `transients` | `<audio-transient-analyzer>` | `input` audio in, to `analyser` | none |
| `live` | `<audio-live-view>`; `type` waveform or spectrogram | `input` audio in, to `analyser` | `height` |
| `player` | `<score-player>`, `controls="show"`; asset `source`, a Score | `output` audio out, through `context`; `source` source out, from `module` | none |
| `track` | `<audio-player>`, `controls="show"`; asset `source`, an AudioClip | `output` audio out, through `context` | none |
| `rack` | `<score-rack-control>` | `in1`–`in4` audio in, admitted as channels 1–4; `output` audio out, through `context` | none |
| `mixer` | `<audio-mixer>` | `in1`–`in4` audio in, admitted as channels 1–4; `output` audio out, through `context` | none |
| `recorder` | `<score-recorder>` | `notes` note in, to `inputModule`; `output` audio out, through `context` | none |
| `panel` | `<score-synth-panel>`, `sections="sound,envelope,effects"` | `target` source in, to `moduleTarget` | none |
| `wave` | `<audio-view>`; its `buffer` parameter names a shared buffer shown read-only; `type` waveform or spectrogram, computed by the host | `source` source in, lending the track as owner | `height` |
| `take` | `<audio-recorder>`; its `buffer` parameter names the shared buffer each take is written to; lent the graph's context | `player` source in, to `player` | none |
| `playlist` | `<audio-playlist>`; asset roles `entry1`, `entry2`, … as its entries | `player` source in, to `player`; `output` audio out, through `context` | none |
| `eq` | `<score-synth-panel mode="insert">`; `effects`, a comma-separated list of Score effect types, before its EQ | `input` and `output` audio, through `insert` | none |
| `effect` | `<score-effect>`; `type` | `target` source in, to `moduleTarget`: one insert on that player | none |
| `audio-effect` | `<audio-effect>`; `type` | `target` source in, to `moduleTarget`: one insert on that track | none |
| `part` | `<score-rack-part>` inside a `<score-rack-control>` of its own; `sound`; asset `source`, a Score | `output` audio out, through `context`; `source` source out, from `module` | none |

`level` is the first component outside the five view objects of DEC-078 and
was added with its manifest alone; the nine after `clip` were added the same
way. A `word` parameter may list its `choices`, and a box naming another is an
error that keeps the fallback. Every one of the sixteen draws its surface
before a cord brings its data (DEC-082). The four players and desks after
them borrow the graph's Session (DEC-084); Studio places them with Arabesque
No. 1 as their asset. `recorder` and `panel` were added with their manifests
and one binding each. `wave`, `take` and `playlist` complete the set: every
Component with an interface of its own is placed. A companion of an audio
player (`take`, `playlist`) has a source input bound through `player`: the
host hands it the Element of the box its cord comes from, and an explicit
link to no player without a cord, so it never plays by itself outside the
graph. A playlist plays into its own box, on the graph's AudioContext. A
parameter that names a shared buffer says how the Element uses it: `true`
edits it, `'clip'` shows it read-only, `'take'` writes each recorded take to
it. A manifest's `scope` lends the context to an Element with no audio output.
An Audio view's source input is bound through `owner`: its box lends a scope
whose `AUDIO_PLAYER_OWNER` is the upstream track, so the view follows it by
containment; `spectrogram` has the host compute the view's spectrogram from
the clip it shows. Audio ports bound through `insert` put the Element's
`input` and `output` between the box's ends, with the graph's `context`.
The effect and rack-part declarations
are placed too (DEC-089): an effect is one insert on the player its cord comes
from, and a part sits in a desk of its own, named by the manifest's
`container`. A manifest's word parameter may be a comma-separated `list`, and
its `configure` sets Element properties a config describes. Every Component of
the packages is now placed.

**The listing.** The studio site keeps one listing of components (DEC-081
rule 6, DEC-089): the official components from these manifests and the user's
component files. Studio's Component Library and Library both read it; a file
placed from it is followed by reference in Studio. A component made of objects
reaches every port family through its edge objects (see
[Organization](ORGANIZATION.md#nested-components)). Compatibility: the five keep their
`webmusic.surface.*` plugin IDs and configs, so saved projects and exported
components load unchanged. The kind-based functions of DEC-078 and DEC-080
(`createViewElement`, `bindViewElement`, `fitViewElement`, `viewWidth`,
`SurfaceKind`) are replaced by the manifest-based ones; the entry is not yet
published.

### Component settings

Status: implemented in Bridge `/component` under DEC-085 and used by Studio's
Inspector.

A component in a graph is set as it is on a page: by the attributes its
Element documents and the tokens it reads. Its module's config holds them in
two records, `attributes` (attribute name to value) and `style` (custom
property to value), beside the keys its box arguments write:

```json
{"low": 48, "high": 72, "attributes": {"velocity": "96"}, "style": {"--wm-note-key-min-width": "1.5rem"}}
```

`componentSettings(manifest, config)` reads the ones that may be applied, and
`configureComponentElement` writes them to the Element, in Studio and in an
exported component alike. A project file may come from anyone, so the Bridge
decides what is written, not the file:

| Setting | Written when | Never written |
|---|---|---|
| An attribute | The Element observes it (`settableAttributes(manifest)`) | Graph-owned names (`GRAPH_ATTRIBUTES`: sources, connections, identity); a box argument's attribute; a name in the manifest's `locked`; anything the Element does not observe, such as an event handler |
| A custom property | Its name starts with `--wm-` and its value loads nothing (`isStyleSetting`) | Other properties; a value with `url()`, an image function or a declaration separator |

A setting replaces an attribute the manifest gives the Element, and removing
the setting gives it back. While a resized box sizes the Element (DEC-080) a
setting for the height the fit writes waits, and returns with the natural
size. A setting never lends what the host does not: `editable="false"` turns
off a clip view's editing, and nothing turns on editing a host did not allow.
`keys` locks `layout` and `routing`. A `roll` or `sheet` is editable where its
author turns `editable` on ([below](#editing-a-score-from-a-view)).

A host that lets an author edit settings lists `settableAttributes(manifest)`
and describes each from the Element's own reference;
`withComponentSetting(config, kind, name, value)` writes or removes one.
Interface objects have no settings of this kind.

| ID | Scenario |
|---|---|
| SET-A1 | A config's unknown, graph-owned, argument-bound and locked attributes, and unsafe or non-`--wm-` properties, are not written to the Element |
| SET-A2 | A setting is written over the manifest's attribute and the manifest's value returns when the setting is removed |
| SET-A3 | A height setting waits while a resized box sizes the Element and returns at the natural size |
| SET-A4 | An exported component has the settings its project holds |
| SET-A5 | In Studio a setting made in the Inspector changes the box at once and is there when the component is reopened |

Bridge tests cover SET-A1–A4; SET-A5 is checked in Studio.

### Editing a score from a view

Status: implemented in Bridge `/component` and Score Play under DEC-086.

A `roll` or `sheet` follows the box its `source` cord comes from. With its
`editable` setting on it also edits what that box plays:

| Step | Who | What happens |
|---|---|---|
| The view asks | The view's binding, when its `editable` attribute is on | It calls its slot's `lender`, which the `source` cord offers |
| The score becomes a document | `ComponentSurfaces.document(id)` | One `ScoreEditor` is made from the source's score, the first time only, and kept |
| The source plays it | The `score` object's plugin, or a `player` component's binding | `setDocumentSource(editor)`, or the Element's `.editor` in place of `.score` |
| The view edits it | The Element | `.editor` is the document; its toolbar and gestures commit to it |
| An edit is applied | The player, through its Session member | The Session pauses, keeps its position and takes the new timeline; play is pressed again |

A manifest says `edits: 'score'` for an Element that edits through `.editor`
and `editable`. Every view cabled to one source shows the same document;
only those with `editable` on borrow it. Turning the setting off returns the
editor and the view follows the source as before; the source keeps playing
what was edited. The document belongs to the host's `ComponentSurfaces` and
lasts as long as its box is in the graph: a rebuilt graph plays it at once.
The view's own history undoes its edits, and the edited score is
[saved with its box](#saving-an-edited-score).

| ID | Scenario |
|---|---|
| EDIT-G1 | The first editing view makes one document for its source, and later views and rebuilds get the same one |
| EDIT-G2 | A `score` object plays the document its roll edits; a second roll without `editable` borrows none and follows the same source |
| EDIT-G3 | A `player` component is given the document in place of its score |
| EDIT-G4 | Turning `editable` on and off lends and returns the document without a new binding |
| EDIT-G5 | An edit while the graph plays pauses it at its position, and the next play is the edited music |

Bridge tests cover EDIT-G1–G4, a Score test the Session side of G5, and the
private runner's check O3 hearing it.

### Saving an edited score

Status: implemented in Bridge `/component` under DEC-087.

A component is one project document, so an edited score is saved inside it:
in the config of the box that plays it, under `document`.

```json
{"format": "webmusic.score+json", "encoding": "gzip+base64", "data": ["H4sIAAAA…", "…"]}
```

| Step | Who | What happens |
|---|---|---|
| An edit is committed | `ComponentSurfaces`, listening to the document | The Score's JSON is gzipped and written as base64 text, off the call, one edit at a time |
| The project is exported | The box's `exportConfig` | `withDocument` adds `document` to the config; a document that is still its asset adds nothing |
| The host saves | The host, told by `subscribe` | It exports the project as it does for any change; `settled()` or `ComponentHandle.save()` waits for the newest edit |
| The project is loaded | The box's plugin, before it makes the box | `revive` decodes `document` and starts the box with that document |
| The box plays | As under DEC-086 | The saved score, with or without a view that edits |

The asset is never written: it stays the original, and `revert(id)` gives it
back by replacing the document with a new one made from it. A document goes
when its box does. Each module of a box calls `enter(id)` and the function it
returns, so a rebuild keeps the document and a deleted box takes it along; a
host that shows another project in the same surfaces disposes the boxes it
shows first, or calls `forget()`.

A project file may come from anyone. The text may hold 1 000 000 characters
and inflate to 24 MB, both checked before the work is done, and the Score is
validated as it is read. A box whose saved score cannot be read stays
unresolved and keeps its config.

`documentState(id)` is `original`, `edited`, or `unsaved` for an edited score
that cannot be saved: one too large for a project, or a platform without
compression streams.

| ID | Scenario |
|---|---|
| SAVE-S1 | A score encodes to text the project schema accepts and decodes to the same notes and IDs |
| SAVE-S2 | An edit puts `document` in the box's config; undoing it in the view takes it out |
| SAVE-S3 | A project mounted again plays the saved score in a `score` object and in a `player`, with no view editing |
| SAVE-S4 | A saved score that cannot be read leaves its box unresolved with its config |
| SAVE-S5 | `revert` gives the asset back in place; a deleted box takes its document with it |
| SAVE-S6 | A document never edited gives way to a saved score; an edited one stays |
| SAVE-S7 | An edited score is heard after the component is closed and opened again |

Bridge tests cover SAVE-S1–S6; SAVE-S7 is the private runner's check O4 and
Studio's own reload.

**Buffers.** `buffer` is an object with no interface (DEC-081 rule 7). Its
waveform is `clip name`, bound to the buffer by name; with `editableBuffers`
in `mountComponent`, and always in Studio, an edit is rendered and written
back to the store. `migrateBufferViews` gives a buffer that an older project
placed in its presentation a `clip` beside it on the canvas and in its place
in the presentation; `mountComponent` and Studio's file reader apply it, and
a second run changes nothing. A buffer that was not presented gets no clip.

**Apps.** An app is a project whose boxes are all components, mounted and
exported through `mountComponent`. A companion is cabled from its player's
`module` to its own `inputModule` instead of being nested in the player's
markup. The players, desks and companions the Library offers now have
manifests, and a placed player joins the graph's Session (DEC-084). Under
DEC-091 an app is assembled in the same editor a component is: the App page
places nothing but components, takes them from the Library — whose page for
a component adds it with the settings it was shown with — cables a
companion to the app's one player and a listener to its one sound source,
and runs the result as the exported element. Under DEC-092 the app is
designed as a web page instead of a graph: boxes lay out text, images and
components, the tree is the project's `layout.page`, and a component's
connections are chosen in its inspector. `mountComponent` takes `place` for
such a host: it then draws no frame, transport or stage, puts each shown
box's Element in the element `place(record)` returns, shows nothing for a
box given none, and writes the theme on the host; the exported app is its
page as HTML and one call with `place`. The Library's own pages still
demonstrate one element at a time as nested markup.

| ID | Scenario |
|---|---|
| LAYER-A1 | A manifest derived from edge objects matches the `component` object's ports |
| LAYER-A2 | The five view objects are placed, bound and fitted through their manifests, with no branch on their kind |
| LAYER-A3 | An official Component outside the five is placed in a graph by adding only its manifest |
| LAYER-A4 | A project saved with `webmusic.surface.*` records loads and runs unchanged |
| LAYER-A5 | A project whose boxes are all components runs through `mountComponent` on one Session |
| LAYER-A6 | A `buffer` box shows nothing; a clip view bound to its name shows and edits it; a project with a presented `buffer` migrates to that pair |
| LAYER-A7 | A Library app of a player and its companions, cabled through `module` and `inputModule`, behaves as their nested markup did and exports as one component |

Bridge tests cover LAYER-A1–A4 and A6, and A5 for components that do not own
a player; the private runner's check O1 covers A3 and A6 in the browser. A5
for players and A7 wait for the player components above.

### Component theme

Status: implemented in Kernel, Bridge `/component`, Studio and the Library
under DEC-088.

A component is styled at three depths, the nearest winning as CSS has it:

| Where | Kept in | Written on |
|---|---|---|
| One box: an official component | Its config's `style` (DEC-085) | The Element |
| One box: an interface object | Its config's `style` | The box that holds its control |
| The whole component | The project's `layout.style` | The root `mountComponent` makes, or `:host` of a defined element |
| The whole app | The page that holds the components | The app's root, as one `:root` rule in the Library's code |

Each is a record of custom properties. Only names under `--wm-` with values
that load nothing are written (`isStyleSetting`), whoever wrote the project.
`THEME_TOKENS` lists the shared roles of the
[visual design](VISUAL-DESIGN.md#palette), the ones every display part falls
back to; a theme may also hold a part's own token, which then applies to
every such part in the component.

A theme at `:host` is the lowest declaration: a rule the page writes for the
element wins over it, and a value set only on an ancestor does not. A page or
an app that restyles a themed component sets its tokens on the component's
element.

**Whose style is shown** is chosen, not fixed (DEC-090). Each part shows its
`own` style or `inherit`s:

| Part | The choice | While it inherits |
|---|---|---|
| A box | `styling: 'inherit'` in its config | Its own `style` is not written; it takes the component's theme. Its attributes stay |
| A component | `styling="inherit"` on its element, `styling` in `mountComponent`'s options, or `ComponentHandle.setStyling` | Neither its theme nor any box's own style is written; it takes what the page or app sets |

`own` is the absence of the key. The style set aside stays in the project,
so choosing `own` again brings it back, and a component that inherits saves
its own theme and styles as they were. The change is made in place.

| ID | Scenario |
|---|---|
| THEME-A1 | Every listed role takes its fallback as a setting |
| THEME-A2 | A theme is read from `layout.style`, written one token at a time and removed when empty |
| THEME-A3 | A mounted component carries its theme on its root; a defined element at `:host` |
| THEME-A4 | An interface object carries its own style on its box, over the theme |
| THEME-A5 | A value that loads something is in neither a theme nor a style as applied |
| THEME-A6 | One theme restyles every component and control of a component, and of an app |
| THEME-A7 | A box that inherits shows the theme and keeps its own style in its record |
| THEME-A8 | A component that inherits shows neither its theme nor its boxes' styles, takes them back in place, and saves them either way |

Kernel and Bridge tests cover THEME-A1–A5, A7 and A8; A6 is the private
runner's check O5.

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
