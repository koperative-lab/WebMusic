# @webmusic/audio

**Digital audio for the web.** One package: an immutable `AudioClip` model,
WAV decoding in JavaScript and compressed-audio decoding through a supplied
context's native decoder with optional WASM fallbacks, playback and mixing,
waveform / spectrogram views, MIR analysis and
transcription, Web Components, and React bindings.

```bash
npm install @webmusic/audio
```

That installation keeps the model, API and Headless paths UI-free. Install the
optional presenter peer for Web Components and the default meter renderer:

```bash
npm install @webmusic/audio @webmusic/ui
```

Start playback:

```ts
import {loadClipFromUrl} from '@webmusic/audio/play';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';

const clip = await loadClipFromUrl('/song.wav');
const player = new AudioClipPlayer(clip);
await player.play();
// Later, when this player is no longer needed: player.dispose();
```

For compressed audio, pass `{context}` to `loadClipFromUrl` or `loadClip` to
try that context's `decodeAudioData` first. If native decoding fails, or no
context is supplied, decoding falls back to an installed decoder for the
format. Browser format support varies; WAV uses the pure-JavaScript path.
Retain players for the interaction lifetime and dispose them during teardown.

…or draw a waveform with a Web Component:

```ts
import '@webmusic/audio/view/auto';        // registers <audio-view> et al.
```

```html
<audio-view src="/song.wav" type="waveform"></audio-view>
```

The decoded `AudioClip` is the shared currency: decode once, then play,
render, and analyze the same immutable object — or ship it to a Worker.

## Documentation and contribution

Current usage and reference pages are maintained in the documentation site:

- [Getting started](../../apps/doc/webmusic/src/content/docs/audio/index.mdx)
- [Web Components](../../apps/doc/webmusic/src/content/docs/audio/element/index.mdx)
- [Headless](../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx)
- [API entries](../../apps/doc/webmusic/src/content/docs/audio/api/index.mdx)

[Historical package notes](docs/README.md) retain earlier technical material;
they are not the current runnable reference. For development, start at the
[contributor index](../../dev/README.md):
[product direction](../../dev/PRODUCT.md),
[design principles](../../dev/DESIGN-PRINCIPLES.md),
[component design](../../dev/design/COMPONENT-DESIGN.md) and the
[component index](../../dev/COMPONENTS.md) own the shared guidance.
Current work is tracked in [STATUS.md](../../dev/STATUS.md).

## Which entry do I import?

Subpaths follow a two-level grammar. The **first level is a capability** —
`play`, `view`, `analyze`, `react`; the package root is the core model. The
**second level is a form** of that capability: **`headless`** is stateful
code with no UI DOM (operations still have entry-specific environment and
resource requirements); **`element`** is Web
Components; **`render`** is imperative browser renderers; **`auto`**
registers all elements as an import side effect; **`global`** is the CDN
IIFE bundle; and **`worker`** / **`worker-client`** / **`worker-protocol`**
are the Worker trio — the self-registering Worker runtime, the main-thread
client, and the pure wire types. Each capability's *root*
(`@webmusic/audio/play`, `…/view`, `…/analyze`) is its stateless API: data
in, data out, no DOM, no engine state.

| Entry | What it is |
|---|---|
| `@webmusic/audio` | The core model: immutable `AudioClip`, regions, edit sessions, `BeatGrid`, peaks, events, JSON. Zero DOM. |
| `@webmusic/audio/play` | Stateless loading, decoding (WAV pure-JS; compressed formats prefer a supplied context, then optional WASM fallback), export and worker controls. |
| `@webmusic/audio/play/headless` | `AudioPlayer`, `AudioClipPlayer`, `AudioPlaylist`, `AudioMixer`, `AudioRecorder`, effects and playback engines — code-only. |
| `@webmusic/audio/play/element` | `<audio-player>`, `<audio-playlist>`, `<audio-mixer>`, `<audio-recorder>`. |
| `@webmusic/audio/play/worker-client` | Main-thread client for worker-offloaded decoding (`createDecoderWorker`). |
| `@webmusic/audio/play/worker-protocol` | The decode-worker wire types, engine-free. |
| `@webmusic/audio/play/worker` | The self-registering decode Worker runtime. |
| `@webmusic/audio/view` | Layout and view models for waveform / spectrogram views. |
| `@webmusic/audio/view/headless` | Stateful code-only views, `AudioMeterController` and PCM metering helpers. |
| `@webmusic/audio/view/render` | Imperative browser visualizers. |
| `@webmusic/audio/view/element` | `<audio-view>` and `<audio-live-view>`; retains a legacy `<audio-meter>` import/registration alias. |
| `@webmusic/audio/analyze` | One-shot MIR analysis: key, tempo, pitch, loudness, onsets, spectrogram, summaries. |
| `@webmusic/audio/analyze/headless` | Stateful analysis sessions and live trackers. |
| `@webmusic/audio/analyze/element` | Canonical live `<audio-meter>`, `<audio-level-analyzer>`, `<audio-spectrum-analyzer>`, `<audio-oscilloscope>` and `<audio-transient-analyzer>` tools; offline onset, beat and whole-clip reports use Analyze API/Headless entries. |
| `@webmusic/audio/analyze/transcribe` | Audio→note transcription emitting family-neutral note events (assemble a `Score` with `@webmusic/bridge`). |
| `@webmusic/audio/analyze/worker-client` / `…/worker-protocol` / `…/worker` | The analysis Worker trio. |
| `@webmusic/audio/react` | React hooks and components over the other capabilities (optional `react>=18` peer). |
| `@webmusic/audio/{play,view,analyze}/auto` | Import-side-effect element registration per capability. |
| `@webmusic/audio/{play,view,analyze}/global` | CDN `<script>` IIFE per capability (`WebMusicAudioPlay` / `…View` / `…Analyze` globals). |

## Optional engines stay optional

Everything heavy is an optional peer, reached only when you use the feature:
WASM decoders (`mpg123-decoder`, `ogg-opus-decoder`, `@wasm-audio-decoders/*`),
metadata (`music-metadata`, `mediabunny`), time-stretch
(`signalsmith-stretch`, `@soundtouchjs/audio-worklet`), and analysis engines
(`essentia.js`, `@tensorflow/tfjs`, `@spotify/basic-pitch`, `aubiojs`,
`pitchfinder`, `realtime-bpm-analyzer`, `webfft`, `@magenta/music`). Install
none of them and WAV decoding, playback, views and the pure-JS analyzers
still work.

`@webmusic/ui` is also optional. Package roots and `/headless` entries never
reach it; install it only for `/element`, `/auto`, visible analysis elements,
`view/render`'s meter presenter, or the React entry that imports that renderer.

## Workers

`createDecoderWorker()` / `createAnalysisWorker()` spawn the bundled module
workers with a statically analyzable `new URL(...)`. Confirm that the consumer's
bundler emits the worker asset at the expected URL. Pass your own `Worker` or a
factory to control spawning; classic `<script>` consumers get the worker URL
from the `/auto` entry automatically.

## Architecture

The following notes explain Audio-specific contracts and implementation
tradeoffs. Current walkthroughs live in the site references above;
[docs/](docs/README.md) preserves historical package notes. Repository-wide
rules and their enforcement are owned by
[ARCHITECTURE.md](../../dev/ARCHITECTURE.md), with accepted design decisions
linked from the contributor index.

### The one idea: decode once, share the object

Every capability in this package consumes the same immutable `AudioClip`.
Decoding is the expensive, format-specific step, so it happens once and its
result becomes plain data that playback, rendering, analysis and Workers all
read without re-deriving anything:

```
bytes ──decode──▶ AudioClip ──┬──▶ play     (engines, mixer, recorder)
                              ├──▶ view     (waveform, spectrogram, meter)
                              ├──▶ analyze  (key, tempo, onsets, transcribe)
                              └──▶ postMessage to a Worker (structured clone)
```

`AudioClip` is immutable and its mutators return new instances (`slice`,
`withRegions`, `withBeatGrid`, `withMetadata`). Sample accessors
(`channelData`, `channels`) hand back **defensive copies**, so no consumer can
reach in and corrupt a clip another consumer is reading — the property that
makes it safe to share one clip across a renderer, an analysis session and a
Worker at the same time. `toAudioBuffer(context)` is memoized per clip and
context, because that conversion is the one place the model has to touch Web
Audio.

A clip may also carry **no samples at all**: a streaming clip holds a
`sourceUrl`, `length` and `numberOfChannels`, and `hasSamples` is false. That
single flag is what lets a 3-hour podcast and a 2-second drum hit travel
through the same API — the playback layer picks an engine from it rather than
the caller picking a code path.

### Four layers, one direction

Each capability directory (`play`, `view`, `analyze`) repeats the same
internal structure, and imports only ever point one way:

```
core ──▶ headless ──▶ api ──▶ element
  ▲          │         │
  └──────────┴─────────┘   (higher layers may reach core directly)
```

| Layer | Holds | May it touch the DOM? |
|---|---|---|
| `core/` | Stateless algorithms, contracts, data transforms. Internal — never a published entry, so helpers do not become permanent semver surface. | No |
| `headless/` | Stateful, code-only components: engines, sessions, controllers, view models. | No |
| `api/` | The supported code-facing facade the capability root re-exports. **The capability root is the API**; `api/` is its implementation. | No |
| `element/` | Styled Web Components. Each class composes a Headless object with a `@webmusic/ui` presenter. | Yes — it is the only layer that may |

`core`, `headless` and `api` are **code-only**: they cannot reference DOM,
canvas or SVG types, cannot create or mutate nodes, and cannot carry markup or
packaged styles. This is not a convention — `scripts/check-architecture.mjs`
parses every module and fails the build on a violation, and the DOM-free entry
list in `scripts/package-policy.mjs` additionally forbids any runtime
`window` / `document` / `customElements` reference from the public roots,
`/headless`, and the Worker client and protocol entries.

The payoff is that `/headless` runs unchanged in Node, in a Worker and under
SSR. Imperative browser renderers are not smuggled into that layer; they are
an explicit `/render` adapter instead.

### Which capability may see which

```
core ◀── play ◀── view
       ▲       ◀── analyze
       └──────────── react (may use all)
```

`view` and `analyze` may depend on `core` and `play`; `play` never depends on
either. The existing meter's `view/headless/meter.ts` and
`view/render/meter.ts` reuse the play-side `AudioMeterController` rather than
growing a second one. The canonical Analyze Element meter facade has one
reviewed compatibility adapter to the existing View meter implementation;
this is not permission for arbitrary Analyze-to-View imports or a second meter
class. The checker enforces this narrow edge and the rest of the table, so the
DAG cannot quietly acquire a cycle.

Across packages the rule is starker: **`@webmusic/audio` never imports
`@webmusic/score`, in either direction, no exceptions.** Anything needing both
families lives in `@webmusic/bridge`. That is why transcription
(`/analyze/transcribe`) emits a family-neutral `TranscribedNote`
(`{startSeconds, endSeconds, midi, velocity}`) instead of a `Score` — the
symbolic assembly step is the bridge's job, and this package stays unaware
that `Score` exists.
### What the kernel provides, and why

`@webmusic/kernel` is a **required** peer, not a dependency. Element identity
and transport contracts only work if every package in the graph shares exactly
one instance, so the build externalizes it and the consumer's copy wins. The
admission rule for putting anything in there is deliberately strict: two
drifting copies must already exist, or it must be a contract both families
implement. Audio reaches it in exactly eight places:

| Kernel entry | Used by | For |
|---|---|---|
| `/transport` | `buffer-engine.ts`, `timeline-mapping.ts` (and `player.ts`, type-only) | `TransportClock` affine anchor math; `TimelineMapping` |
| `/tick` | `media-engine.ts` | Throttle-resistant loop watching |
| `/player` | `player.ts`, `playerlike-contract.ts` | The `PlayerLike` control contract and its capability tiers |
| `/effect` | `play/core/effect.ts` | `Effect` / `EffectNodes` over `BaseAudioContext` |
| `/audio-context` | player, mixer, recorder | One AudioContext construction path |
| `/meter` | `view/headless/meter.ts` | The shared analyser-meter core both families read frames through |
| `/events` | `core/events/EventEmitter.ts` | The hardened emitter (a one-line re-export shim) |
| `/element`, `/worker` | element bases, Worker runtimes and clients | Connected-lifetime cleanup; `WorkerLike` + `RequestTracker` + `dedicatedWorkerScope()` |

Two patterns keep those seams honest. **Re-export shims**: the public
`EventEmitter` is a header comment plus one `export … from` line, so the API
is unchanged while the implementation lives in the kernel. **Type-level
contract assertions**: `play/headless/playerlike-contract.ts` pins
`AudioClipPlayer` against `PlayerLike` and each capability tier it advertises
using a `Satisfies<T extends U, U>` alias. It emits no runtime code and is
imported from a public entry solely so the reachability gate sees it; if the
player ever drifts from the contract, `typecheck` fails instead of a consumer
discovering it at runtime.

### The transport clock

Position bookkeeping is the part of a playback engine that most often rots, so
it is not hand-rolled here. There is exactly one reference time domain —
`AudioContext.currentTime` — and one abstraction over it, the kernel's
`TransportClock`:

```
position(t) = paused ? originPosition
                     : originPosition + (t - originTime) * rate
```

Pure affine math over an injectable clock. Every mutator takes the reference
time explicitly, so nothing samples a clock behind the caller's back, and
every anchor mutator rejects non-finite input rather than silently poisoning
every later read.

`BufferEngine` owns one and exposes it read-only as a `TransportClockReader`.
That reader gives a coordinator the engine's reference mapping. The kernel's
`TransportGroup` — which `@webmusic/bridge` drives to run a score and a clip
as one transport — anchors the follower by *reading* the exact affine map the
engine plays by and handing the result to a sample-accurate
`source.start(when)`, rather than sampling `player.seconds` and chasing the
difference. Each engine still owns its own transport clock; a common context
and scheduled start alone do not prove audible synchronization. This package
neither knows nor cares that the group exists; it only has to expose an honest
clock.

Two invariants are worth knowing because they are load-bearing:

- **The clock's position axis is UNWRAPPED under loop.** It advances
  monotonically past the loop end and `currentTime` applies the loop-window
  modulo at read. Every stop point (pause / stop / seek / natural end / live
  loop change) normalizes the paused position back into the window, because
  that value feeds the next `source.start(at, offset)` and a native offset
  past `loopEnd` would never re-enter the loop.
- **A scheduled start is modeled, not faked.** `startAt(t, position)` arms the
  clock at a future instant and holds the position through the pre-roll, which
  is what makes `play(when)` sample-accurate and makes a rate change during
  the pre-roll alter only the post-start slope.

### Two engines behind one contract

`PlaybackEngine` is the seam that lets one player serve both a 2-second sample
and a 3-hour stream:

| | `BufferEngine` | `MediaEngine` |
|---|---|---|
| Source | `AudioBufferSourceNode` | Host-supplied streaming adapter |
| Needs decoded samples | Yes | No — streams from a URL |
| Sample-accurate `play(when)` | Yes | Accepts and ignores it |
| Native gapless loop | Yes (`loopStart`/`loopEnd`) | Range loops polled on a kernel tick |
| Exposes a `clock` | Yes | No — a buffered media clock cannot sync |

`AudioClipPlayer` picks between them (`engine: 'auto'` → decoded and ≤10 min
takes the buffer engine, otherwise the media engine) and owns the graph tail
that is identical either way:

```
engine.output ─▶ gain ─▶ panner ─▶ [effect] ─▶ analyser ─▶ destination
```

`MediaEngine` deliberately owns **no browser surface**. A host adapter supplies
the streaming source and its graph connection, so the engine is testable in
Node and a non-browser runtime can inject its own implementation; the element
layer supplies the browser adapter. The `clock` being optional on the contract
is honest rather than convenient: consumers feature-test for it, and the
bridge refuses to build a synced player on any engine that lacks it instead of
pretending the sync will hold.
### Rendering: view models and adapters are separate on purpose

The `view` capability splits in two, and the split is the point:

- **`/view/headless`** computes *what* to draw — window ranges, column
  geometry, playhead position — and returns values. No canvas, no DOM.
- **`/view/render`** is an explicit imperative adapter that paints onto a
  caller-owned surface. It is a `/render` entry precisely so it can never be
  mistaken for a headless component.

Both time-axis renderers share the same two constraints. **The canvas is
viewport-sized and static**: scrolling redraws its contents at a new offset
rather than moving the layer, which keeps it off sub-pixel composite positions
(that shimmer) and safely under the ~16384px backing cap that would otherwise
upscale a long clip into blur. **The playhead is a separate overlay** moved by
`transform`, so a cursor tick never repaints the image beneath it.

Beyond that the two diverge by what they cost:

- The **waveform** paints only the visible columns, always. Playhead updates
  coalesce onto one animation frame, peaks are read straight from the level's
  `Int8Array`, and the fill colour is memoized across each run of columns that
  share it — a repaint at a 20 Hz cursor rate must not allocate per column.
- The **spectrogram** rasterizes a stripe: the colormap is packed once into a
  256-entry RGBA lookup table, the frequency→bin map is resolved once per
  paint, and the stripe leaves in a single `putImageData` through a
  `Uint32Array` view. Region outlines live on their own canvas, so editing a
  region never re-rasterizes the image. `virtualization` bounds the stripe to
  the visible area plus its buffer screens; set it `false` to force a
  full-clip paint.

`AudioPeaks` is a **pyramid**, not a flat array: the renderer picks the
coarsest level that still has at least one peak per pixel column, so zooming
changes which level is read rather than how much work a paint does.

### Workers: three entries, never two

Both offloadable capabilities ship the same trio, and the split exists so the
pure parts stay importable everywhere:

| Entry | Purity |
|---|---|
| `…/worker-protocol` | Wire types **and the pure handler**. No worker globals — unit-testable in plain Node. |
| `…/worker-client` | Main-thread client. Constructs a `Worker` only when asked. |
| `…/worker` | The runtime. A **declared side-effect entry**: evaluating it registers the message handler. |

Registration is guarded by the kernel's `dedicatedWorkerScope()`, which
requires a real `DedicatedWorkerGlobalScope` — Service and Shared worker scopes
inherit from `WorkerGlobalScope` but lack the dedicated worker's global
`postMessage` channel, so a looser check would register in the wrong realm.
Importing a worker runtime from Node, SSR or the main thread is therefore a
harmless no-op, which is what keeps the pure handler beside it testable.

Messages carry a protocol identity and version. A stray message from another
library, or a client left over from a different release, fails with a protocol
error instead of surfacing as a confusing decode or analysis failure. The
header is optional for legacy senders and validated when present.

Sample transfer is zero-copy in both directions: channel buffers are
transferred rather than cloned, and responses clone any array the incremental
session still caches *before* transferring it, so offloading analysis does not
detach the cache it depends on.

### Web Components: composition, not inheritance

A domain Web Component here is one equation:

```
Headless object + @webmusic/ui presenter, composed by the Element class
```

The Element class is the browser composition root. It translates attributes,
properties and events, decides resource ownership, and supplies the small
structural binding the presenter needs — and that mapping stays *in the
class*, not in a separate adapter layer. `<audio-meter>` is the reference
shape: `createMeterController`, `createMeterBinding`, `mountMeterUI` and
`onMeterError` are `protected`, so an application can subclass, override one
hook and register its own tag. Analyze is its canonical Element entry; the
former View import remains a compatibility alias for the same implementation.

This is why there are three independent consumer paths rather than one blessed
one: import `/auto` and get registered components; import `/headless` and
render a completely custom UI with no presenter package in the build; or
import the side-effect-free `/element` classes and register your own tags.

`@webmusic/ui` stays an **optional** peer because of that middle path — roots
and `/headless` never reach it. One documented exception: `view/render/meter.ts`
imports it statically, so a `/view/render` consumer resolves the presenter peer
even when only the canvas waveform or spectrogram is wanted.

### Optional engines stay out of the graph

Everything heavy — WASM decoders, ML transcription, analysis engines — is an
optional peer reached through a **guarded dynamic import** written as
``await import('pkg' as string)``. The `as string` is deliberate: it defeats
bundler static analysis so an uninstalled optional peer is never a build
error, and the architecture gate additionally forbids any entry from
*statically* reaching an optional peer. Types come from `analyze/shims.d.ts`
rather than from the packages themselves.

The decoding ladder is explicit in `src/play/core/decode.ts`: WAV uses the
pure-JavaScript parser, including in Node and Workers. For compressed formats,
a supplied context's `decodeAudioData` is tried first; failure or absence of a
context falls through to format-specific optional WASM decoders. Installing a
decoder is not required when the supplied native decoder succeeds. Analysis
also offers pure-JavaScript estimators alongside optional engines; consult the
analysis reference for the options each engine implements.

The licensing consequence is the real motive: copyleft and MPL engines can only
ever be optional peers, and `npm run check:licenses` fails the build if one
becomes a hard dependency.

### What the build guarantees

- **Public entries are reviewed explicitly.** Entry changes must reconcile the
  package manifest, build configuration and applicable policies described in
  [ARCHITECTURE.md](../../dev/ARCHITECTURE.md).
- **`sideEffects` is an explicit list**, not `false` and not absent: exactly
  the two Worker runtimes and the three `/auto` bundles. Everything else must
  be pure, so a bundler can drop what an app does not import.
- **Every export maps to a build entry and back** — no orphan builds, no
  exported target that does not exist on disk or in the `npm pack` file list.
- **The built packages are checked, not just the sources**: every ESM target
  imports and every CJS target requires under Node, each browser IIFE
  evaluated in a VM sandbox exposes its global and registers its elements, and
  CommonJS worker clients fall back without constructing a `Worker`.
### Trade-offs and known edges

The design buys its properties with real costs. The honest list:

- **Defensive copies cost memory.** `channels()` copies every channel, so a
  caller that holds the result alongside the clip doubles resident PCM. The
  incremental analysis session used to retain exactly such a copy for the
  lifetime of the session and now diffs against the clip it already holds;
  callers doing the same should follow suit.
- **`AudioClip` immutability makes edits allocate.** `slice` and the `with*`
  mutators build new instances. `ClipEditSession` exists for edit-heavy flows
  so a sequence of edits is described rather than materialized one clip at a
  time.
- **`engine: 'auto'` guesses.** Decoded and ≤10 minutes takes the buffer
  engine; anything else streams. The threshold is a heuristic about memory,
  not a statement about your clip — pass `engine` explicitly when you know
  better, and note that only the buffer engine can join a sync
  sample-accurately.
- **The media engine has no clock.** Range loops are polled, and the wrap is
  bounded by the tick interval rather than being sample-accurate. That is a
  property of `HTMLMediaElement`'s buffered clock, not something the engine
  can paper over.
- **The spectrogram's `virtualization` is on by default** and repaints on
  scroll. Turning it off gives one full-clip paint and no scroll cost, which
  is the better trade only for short clips.
- **Type-level contract assertions are compile-time only.** They catch drift
  in this repository's `typecheck`; a JavaScript consumer implementing
  `PlayerLike` by hand gets no such guardrail, which is why the runtime
  `is*Player()` guards exist alongside them.

### Reading the source

| Question | Start at |
|---|---|
| What is a clip? | `src/core/model/AudioClip.ts` |
| How does playback stay in time? | `src/play/headless/engines/buffer-engine.ts` |
| How do two engines look alike? | the `PlaybackEngine` interface, same file |
| How does the player wire its graph? | `src/play/headless/player.ts` |
| How is a component composed? | `src/view/element/audio-meter.ts` |
| How does a renderer stay cheap? | `src/view/render/waveform.ts` |
| How is analysis offloaded? | `src/analyze/api/worker-protocol.ts` |
| What is enforced, and where? | `scripts/package-policy.mjs` |

## The WebMusic ecosystem

| Package | What it is |
|---|---|
| [`@webmusic/kernel`](https://github.com/mrsteamedbun/WebMusic) | The zero-domain contracts every package shares. |
| `@webmusic/ui` | Optional domain-neutral presenters used by Audio Web Components and the meter renderer. |
| [`@webmusic/score`](https://github.com/mrsteamedbun/WebMusic) | Symbolic music: MIDI / MusicXML / MXL / ABC scores. |
| `@webmusic/audio` | This package. |
| [`@webmusic/bridge`](https://github.com/mrsteamedbun/WebMusic) | Score ↔ audio: synchronized playback, score→clip rendering, transcription assembly. |

MIT.
