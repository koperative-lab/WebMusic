# @webmusic/ui

Accessible, domain-neutral DOM presenters for music software.

```text
caller-owned state (a Headless object, a store, a controller)
        + a small structural binding
        + a @webmusic/ui mount* presenter
        = accessible, styleable music UI
```

The package knows no Score, Audio, kernel or framework types. It registers no
Custom Elements and owns no audio resource. It ships neutral default presenter
styles, but no application brand theme, palette presets or theme provider.
A presenter receives a structural binding, mounts into a caller-supplied
`HTMLElement` or `ShadowRoot`, and returns an explicit cleanup handle.

Its most common specialization inside this repository is the Web Component
equation:

```text
domain Headless object + @webmusic/ui presenter
             composed by the concrete Element class
                          = Web Component
```

There is no per-component Element Adapter layer. The browser needs an
`HTMLElement` class; that concrete class is the composition root, mapping its
own attributes, properties, events and resource ownership straight into a
presenter's binding.

This document explains **why the layer is shaped this way**. For per-entry API
reference and runnable examples see the [UI Kit documentation][docs] and
[presenter catalog][docs-presenters]. The
[Score architecture](https://github.com/koperative-lab/WebMusic/blob/main/packages/score/ARCHITECTURE.md)
describes domain composition, and this README defines the presenter contracts.

For setup, changes and validation, use the
[contribution guide](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md).
Use the public presenter references and source types to establish implemented behavior.

---

## 1. Why this layer exists

Music UI usually arrives in one of two unhappy shapes. Either the controls are
welded into a component library — you inherit its framework, its markup and its
theme, and you cannot reuse the logic underneath — or there are no controls at
all, and every application rebuilds knobs, transports and meters, usually
without keyboard or screen-reader support.

Three groups of consumers want incompatible things from the same code:

- an application author who wants working music components today;
- an application author who wants their own UI on top of trustworthy domain
  logic;
- an integrator who wants our markup and accessibility, but their own element
  API, tag names and styling.

Satisfying all three requires that presentation and domain be separable at a
seam that is **an interface, not an inheritance chain**. That seam is the
structural binding. Everything else in this package follows from it.

## 2. Position in the architecture

`@webmusic/ui` sits beside the domain families, never underneath them:

| Package | Role | May depend on ui? |
|---|---|---|
| `@webmusic/kernel` | zero-domain contracts and pure logic | no |
| `@webmusic/ui` | DOM presenters and presenter-owned styles | — |
| `@webmusic/score` | symbolic music domain | yes, optional peer |
| `@webmusic/audio` (`dev` only) | digital audio domain | yes, optional peer |
| `@webmusic/bridge` (`dev` only) | score ↔ audio synchronization | no |

`ARCHITECTURE.md` rule 4 states the constraint the package lives under: UI is a
presenter, not a domain — it owns reusable styles, small structural presenter
contracts and disposable DOM presenters, may apply caller-supplied `--wm-*`
values, has no dependency on kernel, score or audio, and must not touch
`window`, `document` or `customElements` merely on import.

**ui is an optional peer of both families.** A headless-only install never pulls
the presenter package. "Optional" describes installation, not runtime
degradation: the family entries that compose presenters (`/element`, `/auto`,
the visible analysis elements, Audio's `/view/render` and React adapter) import
ui statically, so opting into them means installing one compatible
`@webmusic/ui` explicitly. The build gate enforces exactly this — a build entry
may reach an optional peer only if the policy allowlist names it.

## 3. The core contract

Every presenter is one function and one handle:

```ts
const handle = mountX(host, binding, options);

handle.element;   // the presenter's root node inside the host
handle.update();  // re-read binding.snapshot() and repaint
handle.destroy(); // remove this presenter's nodes, listeners and subscription
```

### The binding is a port, not a model

```ts
import {mountTransport, type TransportBinding} from '@webmusic/ui/transport';

const binding: TransportBinding = {
  snapshot: () => ({
    playing: player.playing,
    progress: player.progress,
    seconds: player.seconds,
    duration: player.duration,
  }),
  play: () => player.play(),
  pause: () => player.pause(),
  seekFraction: (value) => player.seekFraction(value),
  subscribe: (notify) => {
    const off = [player.on('timeupdate', notify), player.on('end', notify)];
    return () => off.forEach((dispose) => dispose());
  },
};

const view = mountTransport(host, binding, {label: 'Transport'});
// Later: view.destroy(); dispose the player separately if you own it.
```

Three deliberate choices are visible here:

**Pull, not push.** The presenter asks for a `snapshot()`; it is never handed
props to store. There is therefore no second copy of the truth to drift, no
diffing of state the domain already owns, and no ordering question about who
updates first. `subscribe(notify)` only says *when* to re-ask.

**Structural, not nominal.** A binding is an object literal satisfying an
interface. No base class, no registration, no framework adapter — a Headless
object, a Redux selector, a signal, or a hand-written mock all qualify equally.

**Commands may be async.** Most commands return `void` or a `Promise`; the
presenter awaits, repaints from the authoritative snapshot, and routes failures
to `onError`.

Bindings are minimal by design and optional members change what renders: a
timeline without `seek` hides its seek control, a mixer without `setMuted`
renders no M/S row, a recorder without `togglePlayback` renders no play button.
Subscriptions are optional wherever exposed. Without one, call the retained
handle's update method after external state changes. Transport requires only
snapshot/play/pause; missing seek or time data does not produce a fake control.
Meter accepts a level-only or spectrum-only reader for its selected mode.

### Localization without remounting

`createUILocalization` from the root entry creates a caller-owned text source.
Pass it as `options.localization` to presenters that generate text, and call
`localization.update({messages, formatters})` when the application's language
changes. Related presenters can share the same object; there is no global locale.
The public [localization reference][docs-localization] owns the complete API;
presenter pages list their message keys and interpolation values.

Messages replace whole phrases, including visible text and ARIA. Number,
percentage and time formatters receive numbers; they never change machine
attributes, CSS geometry or the binding's units. Existing explicit label and
formatter options retain precedence. Application labels, musical spellings,
unit identifiers and errors remain application data.

Language notifications update existing controls and release with their mounts.
They do not recreate players, trigger commands or reset focused inputs. One-shot
analysis renderers read localization when called; their owning application
rerenders the report. The retained histogram instead updates its existing
buttons and releases its observer through destroy.

### The handle owns nodes, never domain objects

`destroy()` removes what the presenter created and nothing else: its own root
and style nodes, its listeners, timers and animation callbacks, and the binding
subscription. It never disposes a player, controller, analyser or
`AudioContext`, and it never touches caller DOM that was already in the host.

### Named node accessors are the stable route into presenter DOM

Presenters expose significant nodes on their handles — transport
(`controls.play/track/seek?/fill?/time?`), lfo (`controls`, nine nodes), parameter
(`itemElement(id)`, `inputElement(id)`, `emptyElement()`), eq (`svg`,
`emptyElement()`), timeline (`ruler`, `lane`, `seek`, `regionElement(id)`),
stage (`surface`, or `canvas` for a canvas stage), note (`board`), minimap
(`canvas`, `brush`), status (`message`), the compound panel (`slot(id)`) and
macro rack (`item(index)`). Analysis exposes a controller handle whose
`update(quarters)` owns span discovery, active paint and scrolling.

This exists because decorating presenter output is a legitimate need and
`querySelector('.wui-lfo__rate')` is not a contract. Class-name internals and
node order may change in any release; the handle and the `part` tokens may not.

### Where the canonical shape deliberately bends

| Entry | Deviation | Why |
|---|---|---|
| `/meter` | `redraw()` instead of `update()`; binding is a pull port (`readLevel`, `readSpectrum`), no `snapshot`, no `subscribe`; drives its own `requestAnimationFrame` loop unless `animate: false` | per-frame audio data must not round-trip through a change notification |
| `/note` | `mountNoteSurface(host, binding, options)` accepts optional `binding.interaction` pitch/octave ports; the presenter owns pointer, chord, QWERTY, focus, pressed/ARIA and release lifecycle. The same entry also exports the lower-level `PointerSurface` primitive | musical mapping stays Headless while the reusable presenter owns input DOM behavior |
| `/analysis` | one-shot `render*(data, root)` helpers plus `createAnalysisPlayhead(root)`, whose handle owns span discovery, active paint and scrolling | analysis output remains caller-selected while playhead presentation stays UI-owned |
| `/panel` | `mountSectionPanel(host, sections, options)` receives section descriptors and returns stable slots; the caller owns child mounts | a layout skeleton has no domain snapshot or commands |
| `/stage` | `mountStage` binding pushes `render(surface)` instead of `snapshot()`; `mountCanvasStage` owns canvas sizing, DPR, resize, optional animation and status; `mountSurfaceSlider` adds domain-neutral pointer/keyboard/ARIA behavior to an existing surface | callers can provide arbitrary markup, a draw-only canvas port or a hit-test/value port without rebuilding lifecycle machinery |

## 4. Design principles

Each principle below is a rule the package actually holds itself to, followed by
the reason and, where one exists, the mechanism that keeps it true.

### 4.1 Domain-neutral by construction

No workspace dependency, no music-domain type in any signature. Levels arrive
as `ArrayLike<number>`, analysis results as plain objects, positions as plain
numbers — so Score can format a timeline in beats while Audio formats the same
presenter in seconds. *Enforced:* the dependency policy declares ui's workspace
dependencies and peers as empty in both directions; any added edge fails the
architecture gate.

### 4.2 Presenters, not components

The package never calls `customElements.define` and never subclasses
`HTMLElement`. It cannot own a tag name, an upgrade lifecycle or a registry —
those belong to the consumer, who may use Web Components, a framework, or
neither. *Enforced:* a source scan rejects `customElements` references (bare,
`globalThis.`, or property access) and `HTMLElement` subclassing anywhere in
`packages/ui/src`.

### 4.3 Borrow, never own

A presenter owns only what it created. This is what makes the same presenter
safe inside a Web Component that owns its `AudioContext` and inside an
application that shares one context across a page. Ownership questions are
answered once, at the composition root, not per presenter.

### 4.4 The binding is authoritative; the presenter is optimistic

A drag should feel instant, but the domain decides what actually happened. The
mature presenters paint the expected value immediately, invoke the command, and
repaint from the authoritative snapshot when it settles. Superseded commands are
tracked by revision so a late settlement cannot overwrite a newer frame, and a
failed command rolls its optimistic paint back.

### 4.5 A presenter never throws at its caller

Event handlers do not throw. `onError` is the single sink for snapshot failures,
caller formatter failures, `subscribe()` setup failures, synchronous command
throws, command rejections, structural rebuild failures and cleanup failures
during destroy. Without an `onError` those failures are absorbed silently and
the presenter keeps its last good frame. The rationale is blunt: a UI failure in
a music application must not take down the audio thread's owner.

### 4.6 One presenter per host

Each module keeps a `WeakMap` from host to handle; mounting the same kind of
presenter into the same host destroys the previous one first, while unrelated
caller DOM in that host is preserved. Re-rendering a component is therefore
idempotent instead of accumulating duplicate racks. The most re-entrancy-
sensitive first-release presenters (parameter, envelope and lfo) claim
ownership *before* destroying the previous mount and re-check ownership after
every user callback, so a callback that remounts the same host cannot produce
two trees.

### 4.7 Accessible by construction, not by audit

Where a control is a pointer gesture over a drawing, a **real native control
drives the same command**:

- envelope renders four visually-hidden `<input type=range>` — one per ADSR
  stage — that submit through the same path as dragging the curve;
- EQ's visually hidden frequency/gain ranges remain in tab order and announce
  hertz or decibels. Focus outlines the actual band point and identifies its
  axis in the readout below the graph;
- parameter and transport's default mode go further and make the native control *be* the
  gesture: the knob's drag surface is a transparent full-size range input over
  the decorative SVG, and the transport's seek bar is a styled range whose own
  `input` event issues the command. Transport also offers `seekControl: 'surface'`
  for compatibility layouts; that surface owns an ARIA slider, pointer capture,
  Home/End/Arrow handling and its progress fill;
- minimap's brush and `mountSurfaceSlider` expose the same pointer and keyboard
  interaction through an ARIA slider, while note owns pointer, chord and QWERTY
  focus/pressed state on behalf of its headless mapping.

Decorative graphics are `aria-hidden` with `focusable="false"`; composite
controls announce themselves through `role="group"` with an overridable label;
`aria-valuetext` turns raw slider numbers into domain-meaningful announcements,
fed by the same formatter that produces the visible readout. Live regions are
used sparingly and deliberately: status uses a polite status for loading/empty
messages and an assertive alert for errors, while transport's clock is
explicitly `aria-live="off"` so a moving playhead does not flood a screen
reader.

These are implementation mechanisms, not evidence of a completed library-wide
assistive-technology or device audit. Validate the composed interaction,
keyboard behavior, focus, labels and custom styling in the target browser and
assistive technology. Report the environments actually verified and any
remaining gaps when submitting a change.

### 4.8 Styleable without a theme system

See §6. Presenters include neutral default styles with customization hooks.
They do not provide application theme presets, a provider, registry or theme
store.

### 4.9 Public parts, private internals

`part` tokens and handle accessors are contract; `wui-block__element` class
names are not. *Enforced:* string and template literals outside `packages/ui`
may not embed a `wui-*__` fragment. The scan is a literal-level tripwire against
real selector usage, not a sandbox — a runtime-composed selector still slips
through, and it deliberately leaves block-level names such as `.wui-transport`
alone, since those are the documented hook for compatibility stylesheets.

### 4.10 SSR-safe at import

No module reads a browser global while being imported; every presenter derives
its `Document` from `host.ownerDocument` at mount time. *Enforced twice:* a
Node-environment test imports the whole source graph and asserts `document` is
undefined, and the package-export check imports every built ESM and CJS entry in
plain Node.

### 4.11 One entry per presenter

Twenty-one public subpaths plus the root barrel, `"sideEffects": false`, zero
runtime dependencies. Importing `@webmusic/ui/eq` pulls the EQ presenter and
its shared chunk, nothing else; because no entry registers anything on
evaluation, a bundler may drop every presenter an application does not name.
*Enforced:* exports, build entries and the side-effect declaration are
cross-checked in both directions.

## 5. Runtime model

The mature presenters (parameter, envelope and lfo) implement the full model
described here; it is the target every presenter converges on (see §9).

**Mount.** Build the style and root nodes, claim host ownership, append, wire
listeners, subscribe, paint the first frame. If anything in the mount tail
fails, a rollback tears down everything already created, releases ownership, and
rethrows — a half-mounted presenter is never left behind.

**Paint.** Read `snapshot()`, apply any in-flight optimistic overlay, compute
formatted text, then commit the whole frame at once. Each paint carries a
revision that is re-checked after every caller callback, so a formatter that
re-enters and produces a newer frame cannot be overwritten by the older one in
flight. A throwing snapshot or formatter leaves the last committed frame intact
and reports the error; when there is no last-good frame yet, the presenter
commits a hard-coded disabled fallback painted with the built-in formatters, so
a broken caller formatter cannot break the fallback too.

**Command.** Optimism is keyed by command kind, with one monotonic revision per
kind and at most one in-flight command each. A command superseded during its own
optimistic paint is never handed to the binding. On failure, that kind's overlay
is dropped and the presenter repaints from the binding while other kinds stay
optimistic. Stale settlements are discarded rather than repainting.

**Update re-entrancy.** `update()` is latched: a nested call sets a pending flag
and returns; the outer call drains it in a bounded loop. Failure to stabilize is
reported once as a synthetic `Error`, with the latch held closed during
reporting so an `onError` that calls `update()` again cannot loop.

**Destroy.** Idempotent. Bumps paint and command revisions so in-flight work is
neutralized, runs every cleanup even if one throws (the first error is retained
and reported once at the end), and releases host ownership.

## 6. Styling model

Three layers, with different contract strength:

| Layer | Example | Contract |
|---|---|---|
| Block class | `.wui-transport`, `.wui-meter` | public hook, safe to select |
| `part` token | `::part(play)`, `[part~="curve"]` | public, caller-extensible |
| Element class | `.wui-transport__play` | **private**, may change any release |
| Custom property | `--wm-transport-fill` | public, the intended styling surface |

Custom properties follow `--wm-<presenter>-<role>` and resolve through a
fallback chain to a shared semantic `--wm-<role>` token and finally to a
literal, so setting `--wm-accent` once re-themes many presenters while
`--wm-lfo-thumb` re-themes exactly one.

Customization paths, in increasing invasiveness: declare `--wm-*` in CSS; add
your own class names and part tokens through the `classNames` / `parts` options;
select `::part()` on an open shadow root; reach a specific node through the
handle's named accessors.

Most mounts accept `classNames`/`parts`; each owning reference lists the named slots.
Analysis helpers, Note and Recorder have fixed public hooks. Workbench's `frame`
part names its painted box, while `root` names the unpainted query container.

All visible presenter families accept the outer-surface quartet:
`--wm-<presenter>-surface-background`, `-border`, `-padding`, and `-radius` resolve
through `--wm-component-background`, `-border`, `-padding`, and `-radius`, then
existing presenter and semantic fallbacks. `--wm-component-border` is a complete
border shorthand; `--wm-border` is a colour. Backgrounds accept `transparent`.
Harmony and Pitch retain unframed defaults; Workbench's `chrome: 'bare'` retains
zero border/padding unless a caller explicitly supplies surface tokens.

Set shared `--wm-surface`, `--wm-foreground`, `--wm-foreground-muted`,
`--wm-accent`, `--wm-accent-foreground`, `--wm-border` and `--wm-control-radius`
on the containing element. Specific surface/paint tokens and historical
compatibility prefixes retain their existing override positions. Selected text
uses an explicit accent foreground, never a background: the former Analyze
background-as-text fallback and LFO surface-as-text fallback were removed so
transparent surfaces do not erase labels. Musical role palettes and inverse
surfaces retain separate public colour tokens. Envelope, EQ and LFO graph surfaces
pair `--wm-surface-inverse` with `--wm-foreground-on-inverse`; generic surface
and foreground values do not recolor those inverse plots. Set both inverse
tokens when replacing that palette. Use `--wm-font-family` for UI text and
`--wm-font-mono` for fixed-width readouts; component-specific overrides and
legacy `--wm-font` fallbacks remain entry-specific.

A compound owner should paint one outer frame. Harmony and Pitch mounts accept
`surface: 'none'` to leave their background, border, padding and radius to that
owner; marks, internal controls and palette remain independent. This option also
works with `stylesheet: false`. It avoids repeated borders and alpha blending.

`stylesheet: false` skips stylesheet installation and propagates to children
owned by compound presenters. Harmony, Pitch, Workbench and Transport retain
inline declarations; other mounts require caller-supplied exported styles or
replacement CSS. Inline styles cannot replace pseudo states, native range
pseudo elements, focus rules or container queries. Private `--wui-*` data and
resolution properties are not a second public theme system.

**Forced colors and focus.** Seven stylesheets carry a
`@media (forced-colors: active)` block using system color keywords or
`forced-color-adjust`. Focus is a 2px `var(--wm-focus, …)` outline applied with
`:focus-visible`, or `:focus-within` where a visually-hidden native input backs
a custom surface. Disabled states are reduced opacity plus a default cursor
rather than a color change, so they survive forced-colors mode.

**The legacy-compatibility pattern.** A migrated domain element keeps one
memoized `<style>` element in its own shadow root that maps its historical
variable prefix onto the presenter's `--wm-*` names — `--meter-*`, `--synth-*`,
`--rc-*`, `--wap-*` and friends. The legacy variable comes first in the chain,
so an application's existing declarations keep working. Where such a sheet
must select presenter internals it uses `[part~="token"].alias`, never
`wui-*__*`.

### The transport stylesheet is private

Transport consumes its canonical stylesheet as an internal implementation
dependency. That stylesheet source is not a published entry: consumers import
the transport presenter and customize it through its block class, `part` tokens
and `--wm-*` properties, just like every other first-release presenter.

## 7. Ownership rules

| Question | Answer |
|---|---|
| Who creates the host? | the caller, always |
| Who owns nodes inside the host? | the presenter owns only what it appended |
| Who owns the domain object? | the caller; `destroy()` never disposes it |
| Who owns an `AudioContext`? | whoever created it — never a presenter |
| What does remounting do? | destroys that entry's previous handle for that host, preserves unrelated DOM |
| What does `destroy()` guarantee? | idempotent teardown, cleanup errors reported not thrown |

## 8. Deliberate non-goals

- **No application theme system.** Neutral default presenter styles are included; application brand themes, palette presets, providers and theme context are not.
- **No state management.** No store, no reducer, no event bus of our own.
- **No framework bindings.** No React/Vue/Svelte wrappers in this package; the
  mount/destroy pair fits any lifecycle.
- **No domain semantics.** No `AudioParam`s, automation curves, scheduling,
  playback maps or note models.
- **No universal parameter system.** The parameter rack is a scalar rotary rack.
  Envelope, LFO and EQ are separate presenters precisely because their
  interactions are not the same interaction.
- **No visual skinning of other DAWs.** Workflow patterns may be familiar;
  the visual language is WebMusic's own, and applications restyle it.

## 9. Where the kit is not yet uniform

The following notes describe package-specific compatibility boundaries.
They establish the behavior callers should account for, not a prioritized backlog.

- **Lifecycle machinery differs by module.** parameter, envelope and lfo
  implement the full §5 model. Other first-release presenters use a smaller
  subset suited to their input and rendering model. Notably transport has no
  command revisions, so an out-of-order settlement repaints unconditionally;
  stage and minimap do own their resize observers, subscriptions and animation
  cleanup. Mixer, Macro (including MacroRack) and Recorder contain subscription
  failures and finish releasing their owned resources even when a disposer or
  error callback throws. A subscription returned after synchronous replacement
  is released immediately; destroyed handles ignore pending command results.
- **Optimistic isolation is an lfo guarantee, not a package guarantee.** In eq
  and parameter any update repaints every control from the authoritative
  snapshot, discarding a sibling's in-flight optimistic paint.
- **`classNames`/`parts` are not yet universal across every presenter.** This
  pass added stable hooks for Score/Audio element compatibility styling,
  including mixer, stage, minimap, panel, macro and LFO. Presenters
  without a current composition need may still expose only canonical classes.
- **Motion policy is entry-specific.** Workbench and participating Harmony
  surfaces resolve `motion: 'auto'` from ancestor `data-motion` and then the
  reduced-motion preference at mount. Meter and canvas stage offer explicit
  `animate: false`; other drawing loops do not inherit Workbench's policy.
  Inspect the owning entry when deciding whether animation should run.
- **`/analysis` reads a global `document` when called.** Import stays safe, but
  `createAnalysisRoot()` and `renderAudioAnalysisCard()` default to the global
  at call time; pass a `Document` explicitly outside a browser.
- **`analysisStyle` is exported but never installed** by the analysis helpers,
  which style their nodes inline; a consumer wanting those class hooks must
  inject the sheet.

## 10. Entry map

The six documentation groups describe UI responsibilities. Grouping does not
change the npm subpath or require a Score Element consumer.

| Entry | Purpose |
|---|---|
| `@webmusic/ui` | complete stable surface (barrel over all 21 published subpaths) |
| **Transport and navigation** | |
| `@webmusic/ui/transport` | play/pause/seek presenter with named controls |
| `@webmusic/ui/timeline` | domain-neutral ruler, regions, loop, selection, playhead |
| `@webmusic/ui/minimap` | DPR-aware overview canvas with draggable, keyboard-accessible range brush |
| `@webmusic/ui/playlist` | playlist transport, track selection and per-entry state |
| `@webmusic/ui/track-list` | accessible index of named rows, one of them current |
| **Parameters and modulation** | |
| `@webmusic/ui/parameter` | rotary rack with per-item node accessors |
| `@webmusic/ui/macro` | macro control, compound macro rack and destination readouts |
| `@webmusic/ui/envelope` | ADSR editor |
| `@webmusic/ui/lfo` | oscillator controls and waveform |
| `@webmusic/ui/eq` | EQ response curve and draggable bands |
| **Mixing and capture** | |
| `@webmusic/ui/mixer` | master and channel faders |
| `@webmusic/ui/meter` | level and spectrum meter (self-driven) |
| `@webmusic/ui/recorder` | record/play/export controls |
| **Note input** | |
| `@webmusic/ui/note` | piano/grid/chord surface with presenter-owned pointer/chord/QWERTY interaction, plus reusable `PointerSurface` |
| **Views and analysis** | |
| `@webmusic/ui/analysis` | analysis cards, timelines, summaries and playhead controller |
| `@webmusic/ui/pitch` | keyboard, grand stave and fretboard read-outs coloured by caller-supplied tone roles |
| `@webmusic/ui/harmony` | flow lane, nameplate, chip strip and wheel: read-outs for material that is still arriving |
| **Layout and feedback** | |
| `@webmusic/ui/panel` | compound section/slot skeleton for composing specialized presenters |
| `@webmusic/ui/stage` | generic surface, DPR/resize/rAF-owned canvas stage, status overlay and reusable surface-slider interaction |
| `@webmusic/ui/status` | shared ready/loading/empty/error status surface |
| `@webmusic/ui/workbench` | tabbed shell, stable content hosts and a shared presentation clock |

Canonical `part` tokens per presenter, plus every semantic custom property, are
listed in the [presenter reference][docs-presenters].

## 11. Choosing a layer

- **Ready-made browser UI** — install a domain package plus `@webmusic/ui`,
  import the domain's `/auto` entry, use its Web Components, and theme with
  `--wm-*`.
- **Your own UI on our domain logic** — import a domain package's `/headless`
  entry. This path never reaches `@webmusic/ui` or Custom Elements.
- **Our markup, your element API** — import a domain package's side-effect-free
  `/element` entry, subclass an exported Element class, override its protected
  controller/binding/mount hooks, register your own tag.
- **Presenters without Web Components** — mount `@webmusic/ui` directly against
  anything satisfying a binding: a store, a controller, a signal, a mock.

## 12. Invariants and their enforcement

| Invariant | Mechanism |
|---|---|
| zero workspace dependencies and peers | dependency policy table, exact-match both directions |
| no `customElements`, no `HTMLElement` subclass in ui source | `checkUiWebComponentFreedom` source scan |
| `wui-*__` internals never referenced outside ui | `checkWuiInternalNamespace` literal scan |
| code-only domain layers never import ui | per-file workspace-import audit in the layer gate |
| every published entry imports safely in Node | built-entry import check + Node-environment SSR test |
| `sideEffects: false` is true | side-effect policy cross-check |
| exports ↔ build entries agree | export/build mapping check |
| optional-peer reach is allowlisted | static reachability check per build entry |

These checks participate in the root `npm run check` chain. The root
[package.json](https://github.com/koperative-lab/WebMusic/blob/main/package.json) owns the command definitions;
[CONTRIBUTING.md](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md) explains the active CI scope and
verification workflow.

## License

MIT

[docs]: ../../apps/doc/webmusic/src/content/docs/uikit/index.mdx
[docs-presenters]: ../../apps/doc/webmusic/src/content/docs/uikit/catalog.mdx
[docs-localization]: ../../apps/doc/webmusic/src/content/docs/uikit/api.mdx#localization

For source contributions and release verification, see the
[contribution guide](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md).
