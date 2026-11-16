# Messages, objects and controls

Status: accepted direction, in delivery
([DEC-075](../DECISIONS.md#dec-075--messages-are-a-kernel-port-family-objects-and-controls-build-on-them)).
Layers and public entries: Kernel `/module` (the `message` port family and
message clocks), Kernel `/objects` (the object library as project plugins) and
UI Kit `/controls` (single-value controls).
Source: [platform/kernel/src/module/message.ts](../../platform/kernel/src/module/message.ts),
[platform/kernel/src/objects/](../../platform/kernel/src/objects/) and
[packages/ui/src/controls.ts](../../packages/ui/src/controls.ts).
Owning references: [Kernel API](../../doc/src/content/docs/kernel/api.mdx) and
[UI Kit controls](../../doc/src/content/docs/uikit/parameters-gestures/controls.mdx).
Delivery owner: [STATUS](../STATUS.md), MSG-01.

Max patches are mostly made of messages: objects pass bangs, numbers, symbols
and lists, and logic objects such as `metro`, `counter`, `select` and
`trigger` decide what happens next. WebMusic's five port families carried
audio, notes, parameter modulation, transport and data sources, but no
general value. This contract adds that family, the objects that use it, and
the UI controls a component's objects show (DEC-074 names the layers).

## Message values

A message is a selector and a list of atoms:

```text
Message = { selector, atoms, time? }
Atom    = int | float | symbol | dict | array
```

| Message | Selector | Atoms |
|---|---|---|
| bang | `bang` | none |
| int / float | `int` / `float` | one number atom |
| symbol | `symbol` | one symbol atom |
| list | `list` | two or more atoms, or one leading number |
| anything else | the first word, for example `set` | the remaining atoms |

Ints and floats stay distinct, as in Max: `3` is an int and `3.` or `3.0` is
a float, so `expr`, `/` and `counter` behave predictably. `dict` and `array`
atoms carry JSON values for structured data. `parseMessage` and
`formatMessage` convert to and from message-box text; `$1`…`$9` substitute
the atoms of the message that triggered a message box.

`time` is the logical time of the event in AudioContext seconds. A timed
event (a `metro` tick, a `delay`) carries its scheduled time; an untimed event
(a click, a typed value) has none and means "now". Objects copy the time of
the message that caused an output onto that output, so everything an event
triggers shares its time.

## Ports and order

`MessageOutputPort` and `MessageInputPort` are the `message` family. An output
delivers each message **synchronously and depth first**: the first connected
input, and everything it triggers, finishes before the second input receives
anything. Inputs receive in connection order, which a project records, so the
order is deterministic and saved; `trigger` makes an order explicit, emitting
its outlets from right to left as in Max.

Each object follows Max's hot and cold inlets: the left inlet triggers output,
other inlets store a value for the next trigger. Nested deliveries deeper than
512 stop with a `MessageStackOverflowError`, reported to the port's error
sink, instead of overflowing the JavaScript stack.

A project connection of kind `message` joins two message ports. A `message`
connection to a parameter endpoint (`param:<id>`) sets that parameter's base
value from the first number of each message, at the message's time.

## Clocks and priority

Timed objects schedule on a `MessageClock`:

| Event | Source | Delivery |
|---|---|---|
| High priority | `metro`, `delay`, `pipe`, `line` | The clock delivers it ahead of its time, within a lookahead window, carrying `time` |
| Low priority | Pointer, keyboard and programmatic input | Delivered at once, without `time` |

`createAudioMessageClock(context)` reads the AudioContext clock and delivers
events up to 50 ms early, in time order; `ManualMessageClock` advances by hand
for tests and offline rendering. Objects that make sound use the carried time
exactly: `sig` and `ramp` set a `ConstantSourceNode` with `setValueAtTime` and
`linearRampToValueAtTime`, so their output changes on the scheduled sample. A
`message` connection to a parameter applies at the message's time on the main
thread, so it is accurate to a scheduler period, not a sample.

Timers run on the AudioContext clock, not on Session position: a running
`metro` keeps time whether the transport plays or not. Transport-locked timers
and musical time values (`4n`) need tempo in the Session and are later work.

## Objects

Kernel `/objects` registers each object as a project plugin
`webmusic.object.<name>@1.0.0`. The record's `config` holds the arguments
(`args`) and, for stateful objects, the live `state`, so an edit that rebuilds
a graph keeps counters, toggles and running timers, and a saved component
reopens as it was. A plugin's module is activated only after its graph
commits: `loadbang` fires and timers start then, and a candidate graph that
never commits never emits.

| Group | Objects |
|---|---|
| Time | `loadbang`, `metro`, `delay`, `pipe`, `line` |
| Logic | `counter`, `select`, `route`, `gate`, `switch`, `trigger`, `pack`, `unpack`, `expr`, `scale`, `random`, `print` |
| Message to sound | `sig`, `ramp` (control outputs for modulation cords) |
| Interface | `button`, `toggle`, `number`, `slider`, `dial`, `message`, `menu`, `tab`, `multislider`, `matrix` |

Interface objects hold the value a control shows and expose it through an
`ObjectInterface` (`snapshot`, `subscribe`, `input`). A `set` message changes
the value without output, as in Max. `expr` evaluates a parsed expression and
never calls `eval`.

## Controls

UI Kit `/controls` draws one value each: `mountButton`, `mountToggle`,
`mountNumber`, `mountSlider`, `mountDial`, `mountMessage`, `mountMenu`,
`mountTabs`, `mountMultislider` and `mountMatrix`. Each takes a structural
binding (`snapshot`, a command, optional `subscribe`) and imports no Kernel
type, so the same control works over an object's interface, a store or a
framework. Slider and dial reuse the kit's fader and knob. All follow
[Visual design](VISUAL-DESIGN.md): square, monochrome, one control height,
pressed states inverted, a visible focus ring, no prose. A menu opens its
choices as an adjustment card over a scrim inside a host the caller names, or
steps through them in place when there is none.

## Acceptance scenarios

| ID | Scenario |
|---|---|
| MSG-A1 | `metro 250` → `counter 7` → `select 0` → `button` flashes on every eighth tick, at the tick's time |
| MSG-A2 | `trigger b i f` emits right to left; a fan-out delivers in connection order, depth first |
| MSG-A3 | A message → `filter` frequency cord changes the parameter at the message's time |
| MSG-A4 | `sig` and `ramp` change a modulated parameter on the scheduled sample in an offline render |
| MSG-A5 | A rebuild keeps a running `metro`, a `counter`'s count and a `toggle`'s value; a failed rebuild emits nothing |
| MSG-A6 | Every control is operable by pointer and keyboard, announces its value and follows the visual checklist |
| MSG-A7 | A recursive patch stops with `MessageStackOverflowError` instead of hanging |
