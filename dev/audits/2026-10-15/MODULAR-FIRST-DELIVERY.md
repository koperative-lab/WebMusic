# Modular composition: first delivery

> Recovery notice (2026-10-17): The generated evidence marked unavailable below
> was not recovered. The results in this report describe the historical run,
> not current verification. Original artifact paths are retained as text.
> See the [recovery record](../2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md).

Baseline: the uncommitted `modular-redesign` working tree based on `ef8664d`.
Environment: Linux cloud workspace, Node 24.19.0, npm 11.9.0 and Chromium
151.0.7922.173. Node 22.23.3/npm 10.9.9 was also used during diagnosis. This record describes local source and built-package acceptance;
it does not establish a remote commit, release, publication or deployment.

## Delivered behavior

Steps 1–8 implement [DEC-047](../../DECISIONS.md#dec-047--modular-composition-separates-resources-routing-and-session-authority)
and the [modular contract](../../design/MODULAR-COMPOSITION.md) through opt-in
`composition="modules"`:

| Step | Result |
| --- | --- |
| 1 | Explicit ownership, independent context/audio/Session relationships, compatibility and acceptance contract. |
| 2 | DOM-free ModuleContext, stable module views, scope registry, capability keys, connection leases and shared numeric parameter handles. |
| 3 | Stable InsertChain boundaries and realized effect identity; `.effect` changes its compatibility slot without rebuilding the player. |
| 4 | Real Score Rack and Audio mixer channel/master buses, independent channel inserts, controlled default admission and explicit replace/send/tap. |
| 5 | Source-free Session conductor, named local axes, unique participant leases, scoped cancellation and pending-source reservations. |
| 6 | Composed context requests, custom providers, Shadow DOM/slot discovery, explicit selectors/objects and generation-aware rebinding. |
| 7 | Nested Score/Audio players, original Score RackPart declarations, shared effect declarations, attached panels and neutral analyser taps. |
| 8 | Public reference/catalog integration and a runnable mixed-domain composition; combined verification is recorded below. |

The [public guide](../../../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx)
contains a source-free root, Rack, Score and Audio sources, a RackPart declaration,
two master effects, two panels borrowing one effect and an analyser tap.
Source-local, channel and master inserts remain distinct processing stages.

## Verification

`npm run check` (unavailable: `evidence/full-check.json`) passed as one complete command on Node 24.19.0 (exit 0),
including source policy, formatting, lint, architecture, documentation, all five
package builds, 252 compiled documentation examples, type checks, licenses,
package verification and release manifests. The workspace suites passed 352
files and 4,345 tests:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| Kernel | 19 | 253 |
| UI | 36 | 653 |
| Score | 188 | 2,141 |
| Audio | 74 | 885 |
| Bridge | 7 | 182 |
| Documentation | 28 | 231 |

`npm run docs:build` (unavailable: `evidence/docs-build.json`) also passed as one complete
command (exit 0), including the five-package rebuild, 113 generated pages,
111 public search/Markdown references and the site license verification.
The built-page acceptance below includes the Audio upgrade repair and was
followed by both complete passing commands.

Source regression suites cover transactions and failure compensation, precise
lease release, same-context takeover, stale cleanup, borrowed lifetimes, late
preparation/play cancellation, failed source loading, custom tags, closed-shadow
slots, same-scope moves, explicit missing targets, shared handles and legacy
standalone behavior. They use test doubles where native browser behavior is not
the subject of the test.

The existing full-score Quick Start test initially exceeded its 20-second budget
on both supported Node versions during the complete suite.
CPU sampling (unavailable: `evidence/quick-start-cpu.txt`) located repeated jsdom Document named
property scans as the dominant cost within one VexFlow staff render. Staff now
captures the standard SVG node factory once per owned drawing context. This
retains real SVG nodes and their namespace, independent view lifetimes and the
original complete fixture, assertions and timeout. The complete Node 24
documentation suite then passed all 231 tests in 25.64 seconds. A regression
covers sibling views, seek, disposal and unchanged shared context factories.

### Native browser

Browser observations (unavailable: `evidence/browser.json`) use a bundle resolved from public
built entries, without source aliases. Both Score and Audio fixtures passed:

- The empty root has two real participants and one visible transport.
- Merely composing already supplied data and an analyser allocates no GainNode.
- Three attached panels initially show one shared effect value; removing one
  leaves the other two and the DSP alive.
- A range input updates both remaining views to `0.45`; ArrowRight updates the
  shared handle to `0.46`.
- Replacing `.effect` retains the output port and does not reset Session position.
- Pause and seek commit `0.25` Session seconds.
- Desktop (1280px) and narrow (320px) layouts have no page overflow. Mixer
  channels retain the existing internal horizontal scrolling behavior.
- Removing the composition leaves its injected AudioContext open.
- The cross-domain spectrum tap produces visible FFT output; page errors are empty.

The browser pass found an inherited transport whose `hidden` attribute was
overridden by presenter `display:flex`. Modular visibility now applies an
explicit display override and restores it when controls are shown. It also
exposed unusable native AudioParam extrema in effect controls. Built-in recipes
now provide recommended display ranges, intersected with actual backend limits,
without narrowing legal parameter values or inventing modulation readback.

### Built documentation pages

Public-page observations (unavailable: `evidence/public-demo.json`) use the generated site and
its real MIDI, WAV and MusicXML assets in Chromium. The mixed composition has
three channels, a source-free root and two master inserts. Both attached room
panels update to `0.25`; there is one visible transport, a committed seek to
`0.5` seconds and no page overflow at 320px. The spectrum shows the mixed output.
Page errors and module error events are empty.

This pass exposed an Audio custom-element upgrade race: existing `src`
attributes run before `connectedCallback` even when the HTML is already
connected. Loading then allocated a standalone context before module discovery.
Audio now waits for mount/context readiness, resolves modular mode before
upgrading preassigned properties and avoids duplicate initial loads. Regression
coverage includes markup before registration, pending foreign providers,
preassigned clips, legacy loading and rejected foreign borrowed players.
The original mixed declaration passed after the repair.

The real Quick Start page also passed: 1,615 notes, 37 keyboard keys, 6,189 SVG
paths, a view borrowing the player's Score and a committed nominal seek to `2.4`
seconds. The desktop (unavailable: `evidence/public-demo-desktop.png`),
narrow composition (unavailable: `evidence/public-demo-narrow.png`) and
staff (unavailable: `evidence/quick-start.png`) screenshots were inspected and retained.

### Native offline audio

Offline results (unavailable: `evidence/offline-audio.json`) and
built-entry fingerprints (unavailable: `evidence/build-fingerprints.json`) record 12 native
OfflineAudioContext scenarios. The recorded public-entry fingerprints also
match the final package build. All passed with no browser errors: 24 steady-state
windows, 46,080 samples, maximum absolute error `6.25e-8`, tolerance `2e-6`.

The cases cover both domain mixers, nesting in both cross-domain directions,
single summing, channel/master processing order, default takeover, explicit
replacement, independent send/tap branches, shared physical edges, failed
cross-context replacement and stale-scope cleanup. A nonlinear square stage
distinguishes processing order; gain multiplication alone would not prove it.
The dynamic-routing sequence measures `0.2 → 0.3 → 0.14 → 0.14 → 0.4 → 0.3 → 0`,
including unpatch and release of an old admission after a new route is active.

## Scope and remaining work

Configure composition before connecting a subtree. Existing legacy children do
not automatically migrate when an ancestor is changed into a modular provider.
Rack channels become available when their audio ports are prepared; discovery
does not create a graph just to show faders. Scope/context migration does not
promise uninterrupted audio. Cycle detection covers managed routing edges;
arbitrary internal AudioNode graphs remain the backend owner's responsibility.
Domains map their stable seconds axes explicitly
with default offset zero and scale one; this does not align separately authored
recordings to musical beats. Bridge remains the owner of semantic time mappings.

Supported oscillator parameters and existing attack/release controls are real
shared handles. Most oscillator changes apply to subsequent notes. Complete
ADSR, note routing, LFO/CV, macros and automation remain steps 9–10. Shared-clock
precision, persistence/recovery and the patch editor remain steps 11–12.
Offline graph amplitude and browser controls do not prove device latency,
sample-exact scheduling, complete synthesis/decoding correctness, cross-browser
behavior, screen-reader acceptance or physical-device listening.
