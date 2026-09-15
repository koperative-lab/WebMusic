# `@webmusic/score` — architecture and design notes

This document defines Score's internal responsibilities, time axes, ownership and
extension boundaries. The [README](README.md) is the package usage guide.
The [contribution guide](../../CONTRIBUTING.md) owns setup and validation;
[platform contracts](../../platform/README.md) and the [UI Kit](../ui/README.md)
own their respective shared boundaries. The [public component reference](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx)
links to each Element's behavior and composition contract.

---

## 1. The shape in one paragraph

Score is one npm package containing five **capabilities** — `io`, `view`,
`play`, `analyze`, `react` — over one shared **`core`** model. Each
capability has a source boundary and public subpaths. The concrete `play`, `view`
and `analyze` capabilities have the four-layer stack (`@webmusic/score/play`,
`/play/headless`, `/play/element`, …); `io` and `react` do not duplicate that stack.
Nothing in the package depends on `@webmusic/audio`. Its workspace edges are the
required `@webmusic/kernel` peer and the optional `@webmusic/ui` peer, reachable
only from reviewed visual opt-in entries. Third-party dependencies remain listed
in the package manifest.

```
                       ┌──────────── react ────────────┐
                       │  (pure composition layer)     │
                       └───┬────────┬────────┬─────────┘
                           │        │        │
                     ┌─────▼──┐ ┌───▼───┐ ┌──▼──────┐
                     │  view  │ │ play  │ │ analyze │   ← capabilities
                     └─────┬──┘ └───┬───┘ └──┬──────┘
                           └────────┼────────┘
                                    │
                                 ┌──▼──┐
                                 │ io  │      ← parse / serialize
                                 └──┬──┘
                                    │
                                 ┌──▼──┐
                                 │core │      ← the Score model
                                 └─────┘
```

`view`, `play` and `analyze` are **siblings that never import each other**.
That is the single most load-bearing constraint in the package, and §4
explains what it buys.

---

## 2. `core` — the immutable model

Everything else is a function of `core`. It holds no I/O, no audio, no DOM.

| Piece | File | Why it exists |
|---|---|---|
| `Rational` | `core/primitives/Rational.ts` | Notated durations and quarter positions use reduced fractions instead of repeated floating-point accumulation (for example, `0.1 + 0.2 !== 0.3`). Performed timing and audio seconds remain separate numerical representations. |
| `Pitch`, `Duration` | `core/primitives/` | Value objects, so equality and transposition are total and testable. |
| `Score`, `Part`, `Measure`, `Note` | `core/model/` | Immutable, id-addressed. A `Score` is a value you can hold, share between a player and three views, and hash. |
| `ScoreBuilder`, `ScoreEditSession` | `core/model/` | Supported construction/editing helpers producing a new immutable value; the public `Score` constructor also accepts model data. |
| `TimeMap` | `core/time/TimeMap.ts` | The one authority on musical time ⇄ seconds. Tempo and meter entries in quarters; conversions precompute float projections so every lookup is a binary search, not a scan. |

**Immutability is the reason the rest of the design works.** Because a
`Score` never changes underneath anyone, the player can build a sorted
performance snapshot once, three views can share one converted note
sequence via a `WeakMap` cache, and the analysis session can key incremental
caches on note identity. Those value caches do not need to observe in-place Score mutation. Resource
loading, live graphs and asynchronous playback still need their own invalidation
and lifetime protocols.

`TimeMap` carries one subtlety worth knowing: a tempo entry has an optional
`unit` (the quarter-note value of the beat the bpm refers to), so
"half note = 60" is representable. Seconds-per-quarter is
`60 / (bpm × unit)` — anything deriving a tempo from a map must fold `unit`
in, or it will contradict the map's own beat spacing.

---

## 3. The four-layer contract inside each capability

Every concrete capability (`play`, `view`, `analyze`) has the same four
source directories. Arrows below mean "imports", from higher to lower layers:

```
element → api → headless → core
   higher layers may also import lower layers directly
```

| Layer | What belongs there | Published as |
|---|---|---|
| `core/` | Stateless algorithms, contracts, data transforms owned by that capability. | **Nothing.** Deliberately internal — implementation helpers must not become permanent semver surface. |
| `headless/` | Code-only domain components: engines, sessions, controllers, state machines. They **never** create, accept or manipulate DOM/canvas/SVG, and carry no visual styles. | `/…/headless` |
| `api/` | The supported code-facing facade — functions, option bags, result types selected from `core` and, where useful, `headless`. | **The capability root.** `/play` *is* the API; there is no `/play/api` subpath. |
| `element/` | Styled Web Components compose Headless with a UI presenter; reviewed declaration/behavior elements may render nothing. | `/…/element` (import-only, registers nothing) |

Consumers can use Web Components, Headless, or API + UI. These reuse the same
domain resources; the four source directories are not four required usage stages.
Prefer existing controllers and presenters before adding another engine or
per-variant tag. Three consequences matter for implementation:

- **`headless` never depends on `api`.** `api` may expose a deliberate
  headless convenience facade; the arrow does not point back.
- **`core`, `headless` and `api` are DOM-free.** Not "should be" — the gate
  rejects any reference to element/canvas/SVG surface types, node creation,
  or embedded markup in those directories. A headless player may schedule
  and play a score from pure code; an imperative canvas renderer is an
  explicit `/render` adapter instead.
- **Web Audio is not DOM.** `play/headless` legitimately touches
  `AudioContext` and `AudioNode`. The DOM-free rule is about *user-interface*
  surface, not about being pure.

Two technical layers sit outside this contract because they are neither
domain logic nor a component:

- **`view/render/`** — imperative DOM/canvas/SVG adapters (staff, piano-roll,
  waterfall, SVG). Published as `/view/render`, kept strictly separate from
  the surface-free `view/headless`.
- **`play/drivers.ts`** — browser transport adapters (scroll, pointer,
  orientation, value → transport). It is `/render`'s play-side counterpart:
  it binds playback to caller-owned DOM, which is exactly why it may not
  live in `play/headless`. It imports nothing from the package; it only
  declares the structural `PlaybackTransport` that `ScorePlayer` satisfies.

---

## 4. The capability DAG, and the one edge that is deliberately missing

```
core → io → { view, play, analyze } → react
```

`react` may use everything. `view`, `play` and `analyze` may use `core` and
`io`, and **may not use each other**.

The obvious question is: how does a view follow playback, then? Through a
**DOM CustomEvent seam**, not an import. `<score-view>` listens for
`webscore:noteon` / `webscore:end`; the player elements dispatch them. So:

- `@webmusic/score/view` never pulls the audio engine into a bundle that
  only wanted to draw a staff;
- a caller can drive the view from *their own* engine by dispatching the
  same events;
- and the two capabilities can be tested, versioned and reasoned about
  separately.

Event names and payload compatibility form a runtime integration contract;
TypeScript does not prove that two independently bound DOM elements agree on it.
Preserve the documented events and their integration tests when extending a view
or player. Application composition does not require a forbidden sibling import.

---

## 5. Playback: reference time and session authority

A session has one authoritative timeline, but audio reference seconds, Score
musical positions and the player's reported seconds have different meanings.

### 5.1 Engines and time axes

| Engine | Clock | Role |
|---|---|---|
| `ScorePlayer` (`play/headless/score-player.ts`) | Owns a kernel `TransportClock` over `AudioContext.currentTime`, exposed read-only as `TransportClockReader` | The primary engine |
| `TonePlayer` (`play/headless/tone-player.ts`) | No Kernel clock reader — runs on the injected Tone transport | The documented **clockless fallback** for callers already living in Tone.js |

`ScorePlayer` deliberately splits into three files, and the split is the
design:

- `score-timeline.ts` — the **immutable** performance snapshot. Merges ties,
  skips grace notes, resolves sounding pitch including part transposition,
  sorts once, and owns the binary searches. Built lazily, then never changed.
- `score-player-scheduler.ts` — **all mutable state**: the transport clock,
  the rolling lookahead, loop endpoints, rate changes, per-voice release.
- `score-player.ts` — the stable public API and audio-graph coordinator.

### 5.2 The scheduling model

The scheduler keeps a **sorted cursor** into the timeline snapshot and
commits only the notes inside a lookahead horizon. The important part is
what "commit" means:

> The real lookahead hands the synth backend an **absolute future
> `AudioContext` timestamp** (`transport.timeAt(position)`), not a JS timer
> callback. The JS tick only decides *when to think*, never *when to sound*.

This path requires a backend that supports future attacks and their cancellation;
backends without that capability receive just-in-time note-on instead. A Kernel
`TickSource` reduces reliance on throttled main-thread intervals, but cannot
prevent browser suspension or delayed message delivery. An affine clock and worker
timer alone do not guarantee audible sample accuracy. Pending onset/release timers
also check the audio reference time: while an AudioContext is suspended, elapsed
wall time must not advance the musical event.

Transport operations are all **re-anchoring**, never accumulation:

- `seek` → `clock.seekTo(position, now)`
- rate change → `clock.setRate(r, now)`, re-anchored so the position is
  continuous across the change
- loop wrap → fold the current position through the region (preserving
  phase, so lateness stays bounded by one wake instead of accumulating)
- scheduled start → `clock.startAt(when, position)`, which holds the
  position through the pre-roll, mirroring a sample-accurate `play(when)`

Because every mutation passes the reference time explicitly, the clock is
pure affine math and the whole thing is testable against an injected counter.

### 5.3 Re-entrancy is a first-class concern

Application code runs *inside* the scheduler tick — a `timeupdate` listener
can call `pause()` mid-tick. A paused `TransportClock` maps no reference
time to a position (`timeAt` throws by contract), so every host callback
inside the tick is treated as a re-entry point: `playing` is re-checked
after the cursor emit, after each note commit and before arming the
boundary timer, and a commit that lands on a frozen clock retires its record
instead of throwing out of the tick callback.

### 5.4 One session authority; separate clocks today

Score's scheduler clock is on the **nominal score-seconds** axis. `TimeMap` maps
rational quarter positions to nominal seconds; playback rate maps those onto
`AudioContext.currentTime`. `ScorePlayer.seconds`, `duration` and `seek()` are
rate-scaled, while `nominalSeconds` / `seekNominal()` retain the default-speed
position axis. Cross-domain synchronization uses the latter to avoid changing
alignment when the rate changes.

The accepted architecture gives each music session one authority for transport
commands and position. Multiple sessions may remain independent, including when
they borrow one AudioContext. Current Bridge groups select a master reader and
coordinate followers, but Score's scheduler and Audio's buffer engine still create
private TransportClock instances. Clockless masters can use a mirror adapter.
This is shared clock math and coordinated session authority, not completed
same-instance injection.

[platform/shared-clock-injection.md](../../platform/shared-clock-injection.md)
defines the missing writer/invalidation/rescheduling protocol. Injecting one object
without retracting notes already scheduled against the old anchor would be unsafe.
Group loops currently detect boundaries on ticks; they do not promise sample-accurate
wrap. The source contracts and tests establish the implemented boundary.

### 5.5 Sound backends

`HeadlessSynth` is the backend contract. A backend may opt into
`supportsScheduledCancellation`, which is what unlocks the audio-clock
lookahead: the scheduler can hand it a future attack and still retract that
exact voice on a seek, loop or rate change. Backends without it get
just-in-time note-on gated by the logical onset, subject to timer delivery latency.
Voice identity is per-occurrence (`voiceId`), so two overlapping C4s can
never release each other.

### 5.6 Rack effects have two explicit tiers

The rack graph keeps per-instrument colour separate from processing the final
mix:

```
member player → member effect → channel gain ┐
member player → member effect → channel gain ├→ master gain → rack effect → destination
member player → member effect → channel gain ┘
```

Both tiers consume the same lazy `Effect` recipe contract. Built-in recipes and
`Effect.custom(factory)` share no live AudioNodes when reused across a
`ScorePlayer`, an `InteractivePlayer`, or several racks: each graph realises
its own nodes in its own AudioContext. `Effect.custom(existingNodePair)` is an
explicit escape hatch and must not be mounted concurrently or across contexts.

`RackAddOptions.effect` selects the per-member tier when `rack.add()` constructs
that member. `Rack.effect` / `Rack.setEffect()` control only the summed
master-bus tier. A live master replacement builds its candidate route before
disposing the previous one, so construction failure leaves the old route
authoritative; a successful replacement preserves member player identities,
mix state, and transport position.

---

## 6. Views: virtualize, don't redraw

`view/headless/score-view.ts` is a pure state machine over
`view/core/windowing.ts` — visible-range binary search, active-note
candidate ranges, buffered scroll ranges — and returns frozen snapshots. It
owns no element and no canvas.

`view/headless/score-map.ts` owns the whole-score navigation projection and
command settlement; `view/headless/pitch-view.ts` owns occurrence-aware held
pitch state and source replacement. Both accept the shared core playback
source without importing Play. Map and pitch Elements reuse these models,
while selectors and legacy events remain browser adapters. Stateless pitch
spelling and staff/fret projection are public through the View API.

The renderers under `view/render/` are the imperative half: the SVG
visualizer diffs previous and next index ranges and mounts only the delta;
the piano-roll canvas keeps its backing store viewport-sized with a sticky
stage plus spacer; scroll redraws are coalesced through a single scheduled
frame. `scoreToNoteSequence` is memoized per `Score` identity in a `WeakMap`,
so mounting three views on one score converts it once.

---

## 7. Analysis: incremental by identity

`analyze/core/` is pure functions — chords, key, roman numerals, motifs,
voice leading, pitch classes. `analyze/headless/session.ts` layers
incremental caching on top, keyed on note identity in `WeakMap`s, so unchanged note-derived values can be reused across edits. Total work depends
on the selected analysis and affected structure; this is not a general O(edit)
bound for every analysis. Live key trackers are constant-space: the
key tracker is a fixed 12-bin histogram with O(1) note-on updates.

`analyze/headless/follower.ts` combines a session with source readiness,
position and note activity, and exposes navigation outcomes on explicit axes.
The follower and Analyze Elements share nonvisual playback reconciliation and
native seek execution. Live-only Elements do not run a whole-score session to
observe notes; frame prediction and gesture feedback remain presentation work.

Heavy analysis can be moved off the main thread through the
`worker-client` / `worker-protocol` / `worker` triple. The protocol carries
an identity/version envelope, and the runtime guards its message-handler
registration behind the kernel's `dedicatedWorkerScope()` check, so
importing the module on the main thread or during SSR is harmless.

---

## 8. Elements: Headless + presenter, composed by the class

The target pattern, and what "no Element Adapter layer" means:

```
domain Headless object  +  @webmusic/ui presenter
              composed by the concrete Element class
                    = the Web Component
```

The Element class is the browser composition root: it translates attributes,
properties and events, chooses resource ownership, and supplies the small
structural binding the presenter needs. That mapping stays **in the class** —
a separate per-component adapter module is not an architectural layer here.

Composition contracts are explicit in
[element-composition-policy.mjs](../../scripts/element-composition-policy.mjs).
Play retains five interactive roles: `<score-player>`, `<synth-panel>`,
`<rack-control>`, `<note-input>` and `<score-recorder>`. The existing
`<simple-score-player>` compatibility tag reuses the same transport implementation.
`<rack-part>` is a nonvisual declaration, not another player. One transport
supports a native Score, a borrowed Rack or a borrowed Headless
`PlayerController`; built-in facades share seek/readback without adding a clock.
Borrowed controllers retain their rate and are not disposed on unmount.
Input layout and Synth sections configure a role without multiplying tags.
The [Play element reference](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#play)
and composition policy define the supported roles.

`WebMusicElement` provides a generation-guarded connected lifetime: a fresh
cleanup scope per connection, once-only reverse release, and cleanup returned
by a disconnected mount is released against its original lifetime. Some
components retain `HTMLElementBase` and explicit teardown. A base-class count
is not a lifecycle acceptance criterion. Recorder disconnection releases
subscriptions and pending capture without disposing a borrowed source.

The Synth Panel directly composes the Headless LFO controller and UIKit
presenter. Hiding its section preserves active modulation; disconnecting stops
and releases it. Same-context DSP edits preserve input/output port identities,
including a dry bypass with no active effects or EQ. Context replacement
requires the caller to reconnect. Candidate failure preserves the usable graph
and releases only newly owned nodes/edges. Shared custom effects and external
graph callbacks require rollback and reentrancy guards.

Presenter DOM is reached through **part tokens** (`[part~="…"]`), never
through `@webmusic/ui`'s internal `wui-*__` class names — a source scan
enforces this, because those internals are not API.

---

## 9. What Score borrows from the kernel, and how

Score declares `@webmusic/kernel` as a **required** peer and externalizes it, so
applications select a compatible shared package implementation. This does not
create one global context or TransportClock. Two patterns keep the seam aligned.

**Re-export shims.** A public module re-exports the kernel implementation
instead of keeping a copy — `core/events/EventEmitter.ts` is a header
comment plus one export statement. The public API is unchanged; only the
implementation moved.

**Type-level contract assertions.** Where a Score type must *satisfy* a
kernel contract without importing kernel code at runtime, a pure type module
pins it (`play/headless/playerlike-contract.ts`,
`play/headless/effects/kernel-contract.ts`). They emit no runtime code and
are imported from a public entry solely so the reachability gate sees them;
drift fails `typecheck`.

Current kernel surface Score consumes: `/element`, `/worker`, `/tick`,
`/effect`, `/transport`, `/player`, `/meter`, `/audio-context`, `/events`.

---

## 10. Dependency discipline

**Optional peers cost nothing until you opt in.** `tone`,
`opensheetmusicdisplay`, `spessasynth_lib`, `react` and `@webmusic/ui` are
all optional peers, and the gate's rule is that **no build entry may
*statically* reach one** except the entries explicitly allowlisted in
`staticOptionalPeerEntries`. Three different mechanisms satisfy that, each
picked for its dependency:

| Peer | Mechanism |
|---|---|
| `@webmusic/ui`, `react` | Statically imported, but only from the enumerated opt-in entries (`*/element/index.ts`, `play/element/auto.ts`, `play/demos/index.ts`, `react/index.tsx`). Importing `/headless` never reaches them. |
| `opensheetmusicdisplay` | A literal, lazy `await import('opensheetmusicdisplay')` lets browser bundlers emit a dependency chunk. Loading occurs only when engraving is requested; callers may inject a constructor or instance. |
| `spessasynth_lib` | A literal dynamic import loads the optional 4.x peer only when a SoundFont route connects. Consumer bundlers can resolve it into a lazy module; applications separately supply the AudioWorklet URL or registration callback. |
| `tone` | Not imported at all. `TonePlayer` takes the Tone namespace as a constructor option — the caller who already has Tone hands it over. Injection, not loading. |

The model, I/O and Headless paths do not require opt-in visual, React or external
synth peers merely to import them. Actual bundle contents still depend on chosen
entries, their algorithms and bundler behavior; built-in playback code is not absent
just because an external synth peer is optional.

**Loading can remain lazy.** ScorePlayer URL loading and the relevant player/view
Element load paths use dynamic imports of `io/load`. Assigning an existing `.score`
avoids that parse path. Explicit I/O entries and other import choices can still
include parser dependencies; this is not a guarantee about every consumer bundle.

**Side effects are declared, not incidental.** `sideEffects` lists exactly
the `/auto` + `/global` bundles and the `io` / `analyze` worker runtimes.
Everything else is pure and tree-shakeable.

**Runtime identity is shared within each module format.** Both ESM and CJS
builds use code splitting, so an object returned by the I/O entry uses the same
Score model constructors as the package root in that format. CJS worker clients
retain their in-process fallback without `import.meta.url`. Mixing ESM and CJS
still creates distinct module graphs; cross-format constructor identity is not
promised. The external tarball consumer checks I/O-to-root composition and
declarations without skipping dependency type checks.

---

## 11. Enforcement sources

Architecture has several executable authorities, not one policy file:

| Contract | Source |
|---|---|
| Public entries, dependencies, capability DAG, required layers, DOM-free/optional-peer reachability and side effects | [package-policy.mjs](../../scripts/package-policy.mjs) |
| Each Element's presenter composition and behavior-only exceptions | [element-composition-policy.mjs](../../scripts/element-composition-policy.mjs) |
| AST rules, `EXPECTED_ELEMENTS`, `uiPresenterClassPolicy`, TypeScript references and graph checks | [check-architecture.mjs](../../scripts/check-architecture.mjs) |
| Installed exports, dependencies and runtime artifacts | [package.json](package.json), [tsup.config.mjs](tsup.config.mjs), package-export checks |

The gate checks type-only and dynamic capability edges, code-only layers, private
presenter selectors, public exports against builds, orphan sources and import
cycles. Static optional-peer reachability is allowed only for entries explicitly
listed in `staticOptionalPeerEntries`; the exceptions are part of the contract.
A rule change may need updates to several of these sources and the corresponding
behavioral tests. Changing architecture is not equivalent to changing only
`package-policy.mjs`.

Run checks according to [CONTRIBUTING.md](../../CONTRIBUTING.md). The command
graph in [root package.json](../../package.json) is authoritative; this document
does not duplicate its sequence. Passing static gates does not establish audio
precision, conversion fidelity or cleanup correctness.

## 12. Implementation boundaries

The current contract includes the shared nonvisual playback-source seam (with
legacy event adapters), the injected Tone
transport alternative, technical `/render` and `/drivers` entries, and explicit
`/demos` reachability exceptions. Optional peers are defined by the manifest, not
by claims of universal bundle size.

Same-instance session-clock injection and cross-boundary loop scheduling require
the protocol described above. The [public component reference](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx)
and package export map identify delivered surfaces. Keep architectural rationale
with the owning contract and describe unverified behavior in change reviews.

---

## 13. Where to look first

| If you are changing… | Start at |
|---|---|
| the model, durations, or musical time | `core/primitives/Rational.ts`, `core/time/TimeMap.ts` |
| how a file becomes a `Score` | `io/load.ts`, `io/formats/` |
| when a note sounds | `play/headless/score-player-scheduler.ts` |
| what a note sounds like | `play/headless/audio-contracts.ts`, `play/headless/sounds/`, `play/headless/synth.ts` |
| what is drawn | `view/core/windowing.ts`, `view/render/renderers/` |
| what is analysed | `analyze/core/`, `analyze/headless/session.ts` |
| a Web Component's behaviour | `<capability>/element/`, plus the `@webmusic/ui` presenter it composes |
| an architectural rule | the policy sources listed in §11 and the platform ledger |

### Shared playback-source contract

Score core exports `ScorePlaybackSource` and its snapshot/note/readiness/state
contracts through the existing model entry. Play implements the source; Analyze
and View consume it without sibling imports. `observeScorePlayback` supports
custom nonvisual composition. Browser selector discovery is a neutral Kernel
Element helper; it does not move musical models into Kernel.

Native observations use nominal position independent of playback rate, resolved
Score identity, source revisions and sounding occurrence IDs. Optional nominal
seek commands report failure. The owning [public model reference](../../apps/doc/webmusic/src/content/docs/score/api/index.mdx)
and [Headless reference](../../apps/doc/webmusic/src/content/docs/score/headless/index.mdx)
define members and composition.
