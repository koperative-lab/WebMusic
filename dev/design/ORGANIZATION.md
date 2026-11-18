# Organization: nesting, presentation, presets and mappings

Status: accepted direction, in delivery
([DEC-076](../DECISIONS.md#dec-076--components-nest-layout-presets-and-mappings-are-project-data)).
Layers and public entries: Kernel `/module` (project schema, `PresetBank`,
`ControlMappings`), Kernel `/objects` (`component`, `inlet`, `outlet`, `inlet~`,
`outlet~`, `preset`, `nodes`), Score `/play/headless` (`MidiControlSource`) and
UI Kit `/controls` (`mountPresetGrid`, `mountNodes`, `mountMappingOverlay`).
Source: [platform/kernel/src/objects/component.ts](../../platform/kernel/src/objects/component.ts),
[preset.ts](../../platform/kernel/src/module/preset.ts),
[mapping.ts](../../platform/kernel/src/module/mapping.ts) and
[control-source.ts](../../packages/score/src/play/headless/control-source.ts).
Owning references: [Kernel API](../../doc/src/content/docs/kernel/api.mdx) and
[UI Kit controls](../../doc/src/content/docs/uikit/parameters-gestures/controls.mdx).
Delivery owner: [STATUS](../STATUS.md), ORG-01.

This builds the second group of Max features on the message family of
[DEC-075](MESSAGE-OBJECTS.md) and the layers of DEC-074: a component made of
components, a presentation of its controls, stored and blended values, and
controllers mapped straight to parameters.

## Nested components

A project already nests contexts. A nested component is a `component` object
(`webmusic.object.component`) that owns a child context; the modules of that
context are its contents. Its `childContext` lends a `ComponentBoundary` under
the `COMPONENT_BOUNDARY` capability, with one channel per inlet and outlet:

```text
outer cord → component in0 ──▶ boundary inlet 0 ──▶ inlet 0 → contents → outlet 0 ──▶ boundary outlet 0 ──▶ component out0 → outer cord
```

| Object | Inside the component | Port |
|---|---|---|
| `inlet n` | Messages arriving at inlet n | message `out0` |
| `outlet n` | Messages to send out of outlet n | message `in0` |
| `inlet~ n` | Audio arriving at inlet n | audio `out0` |
| `outlet~ n` | Audio to send out of outlet n | audio `in0` |

The shell's `config.inlets` and `config.outlets` list each channel's kind in
order, and its ports follow them. An editor keeps the config, the edge objects'
indexes and the outer cords in step. Contents keep the parent's destination
and admission, so an audio object not wired to an `outlet~` sounds through the
parent's default route, as every Studio object does. An edge object with no
enclosing component does nothing. A component shown inside its box (Max's
bpatcher) is an editor choice stored as `config.embed`.

## Layout

`layout.presentation` lists the modules the presentation view shows and where;
`layout.comments` holds text notes per context; `layout.groups` lists modules
selected and moved together (a module belongs to at most one group).
A position in `layout.modules` or `layout.presentation` may carry `width` and
`height` in canvas pixels: the size a user gave the box, which its element
fills; without them the box takes its natural size
([DEC-079](../DECISIONS.md#dec-079--a-layout-records-a-resized-boxs-size)).
Grid snapping, keeping boxes apart and arranging them by their cords are
editor behavior, not project data.

A box sizes what it holds
([DEC-080](../DECISIONS.md#dec-080--a-box-sizes-what-it-holds)). A control
fills its box: the whole box is the button, the track or the dial. A view is
as wide as its box and, in a box with a recorded size, draws as tall as the
box, with its readouts and tools kept. The Bridge's `controlSize` and
`viewWidth` give the natural sizes an editor and `mountComponent` both use,
so an interface looks the same where it is designed and where it runs. A dial
turns by dragging: up or right raises the value.
`ModuleProjectRuntime.updateLayout` changes any of them without rebuilding.

## Presets and interpolation

`PresetBank` stores values by key in numbered slots and recalls one, blends
two (`between`) or blends any by weight (`interpolate`): numbers and equal-
length arrays blend linearly, anything else takes the heaviest slot's value.
`captureParameters` and `applyParameters` read and write every parameter of a
set of modules as `moduleId.parameterId`.

The `preset` object captures every parameter and every value-holding
interface object of its own component — the other modules of its context's
registry — and recalls them; recalling an interface object makes it output, as
in Max. It takes a slot number to recall, `store n`, `clear n`, `interp a b f`
and `weights …`, and saves its slots in its state. `nodes` places nodes on a
unit square; moving its cursor outputs one weight per node, which `weights`
turns into a blend.

## Mappings

`project.mappings` maps a source — a MIDI controller (`cc`, with an optional
channel), `pitchbend`, `program` or a computer `key` — to a parameter endpoint,
with an optional range. `ControlMappings` applies `ControlEvent`s: a controller
or bend sets the parameter across the range, a key flips it between the ends.
`learn(target)` maps the next event to a target, replacing its previous
mapping. `ModuleProjectRuntime.updateMappings` stores the list without a
rebuild. Score's `MidiControlSource` turns a Web MIDI input into control events
and into `cc`, `bend` and `program` messages on its `controls` port.

## Acceptance scenarios

| ID | Scenario |
|---|---|
| ORG-A1 | A number into a component's inlet, doubled inside and sent out of its outlet, arrives doubled |
| ORG-A2 | Audio passes through `inlet~` and `outlet~`; an unwired object inside still sounds |
| ORG-A3 | Encapsulating three objects keeps every message and audio path working |
| ORG-A4 | Presentation shows only the placed controls, operable, without ports or cords |
| ORG-A5 | Two stored presets recall their values and output; `interp` and `nodes` blend them |
| ORG-A6 | Learning a controller or key and moving it drives the parameter across its range |
| ORG-A7 | Copy, paste, align, group and comments keep their results through save and reopen |
