# Choose an integration

Use the mode requested by the user or already used in the application. Different
modes can share an immutable `Score`; changing the view does not require
reparsing its file or inventing another musical state model.

## Web Components

Begin with the [Quick Start](https://koperative-lab.github.io/WebMusic/quick-start/)
and [component inventory](https://koperative-lab.github.io/WebMusic/score/element/).
Install compatible `@webmusic/score`, `@webmusic/kernel` and `@webmusic/ui`.
Import each chosen registration function through its documented `/element`
entry, then call it in the browser. Importing an `/element` entry alone does
not register a tag. `@webmusic/score/play/auto` registers Play elements; it does
not register View or Analyze elements.

For one piece with notation and a keyboard readout, follow the Quick Start's
`score-player`, `score-view` and `pitch-view` composition. Views can use their
documented `player` binding to follow the owner; do not assign duplicate `src`
URLs to each view. A keyboard readout is not a playable input: use
[note-input](https://koperative-lab.github.io/WebMusic/score/element/play/note-input/)
when the task needs input interaction.

Use attributes for documented scalar configuration and properties for `Score`,
controllers and other objects. Read the tag's precedence rules before mixing
`src` with object sources. Keep registration and mounting at the framework's
client boundary. Use public CSS variables, parts and handles; do not target
private implementation classes.

## Headless and framework applications

Use the [Headless inventory](https://koperative-lab.github.io/WebMusic/score/headless/)
to select an engine or controller. `@webmusic/score/play/headless` owns the
player and sound APIs; `/view/headless` and `/analyze/headless` supply stateful
following behavior without UI DOM. Audio operations still require their
documented Web Audio environment and resources.

For React, consult the [React entry](https://koperative-lab.github.io/WebMusic/score/api/react/)
when its provider/hooks/components fit the request; custom controls may instead
bind directly to a Headless object. Preserve the application's approach.
React components expect a `Score`; parsing remains a separate I/O step.
Check the chosen component's imports and optional peer requirements rather
than installing every peer listed in the Score manifest.

Create resources in the appropriate client lifecycle, retain their cleanup
functions, and handle source replacement and repeated mount/unmount. Async
construction that completes after unmount must release newly owned resources
instead of attaching them to an abandoned view.

## API-only work

Start at [the API inventory](https://koperative-lab.github.io/WebMusic/score/api/).
The package root contains the immutable `Score` and musical primitives.
[I/O](https://koperative-lab.github.io/WebMusic/score/api/io/) covers import and
export; [analysis](https://koperative-lab.github.io/WebMusic/score/api/analyze/)
covers stateless musical results. Install the required Score/Kernel packages,
without adding UI or audio resources to a parsing or analysis task.

Use detailed import results when a task needs diagnostics. Preserve rational
quarter-note positions and documented output units. Analysis rankings are
heuristics; do not describe them as calibrated confidence probabilities or
treat an empty score as positive evidence for a key.

## API + UI composition

Select the relevant [UI presenter](https://koperative-lab.github.io/WebMusic/uikit/)
and read its specific binding contract. Presenters work with structural ports
over application-owned state; they need no Score or Kernel model when the
application already supplies that state.

For example, [transport](https://koperative-lab.github.io/WebMusic/uikit/transport-time/transport/)
is imported from `@webmusic/ui/transport`. Its binding pulls a snapshot and
dispatches play/pause/fractional-seek commands to the existing owner. Its
required subscription tells it when to re-read that snapshot. Do not replace
an application store with a second player just to satisfy a presenter binding.

Mount into a caller-supplied host and keep the returned handle. Destroy the
presenter during cleanup; dispose an underlying player separately only if the
application owns it. Confirm the specific handle: some presenters have methods
other than the common `update()` shape.

## Optional resources

The built-in oscillator needs no SoundFont. Detailed sheet engraving, Tone.js
integration and `.sf2`/`.sf3` playback have distinct optional peers and resource
preparation requirements. See [Score setup](https://koperative-lab.github.io/WebMusic/score/#entries-and-optional-peers),
[Sound](https://koperative-lab.github.io/WebMusic/score/headless/play/sound/)
and [view API](https://koperative-lab.github.io/WebMusic/score/api/view/) for the
selected feature. A peer installed successfully does not establish that its
sample/worklet URL loads or that the requested browser supports it.
