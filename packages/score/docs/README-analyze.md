# @webscore/analyze

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current analyze API reference](../../../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx); [Current analyze Web Components](../../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze); [Current analyze Headless reference](../../../apps/doc/webmusic/src/content/docs/score/headless/index.mdx#analyze).
> See the [archive index](README.md) for scope, the
> [contribution guide](../../../CONTRIBUTING.md) for setup and validation, and
> [Score architecture](../ARCHITECTURE.md) for current package boundaries.

<!-- docs:historical-body -->

---

Headless musical **analysis** for WebScore. It reads immutable `Score` objects
from [`@webscore/core`](../core) and returns plain data — score summaries,
chord timelines, key detection, chord segmentation, Roman numerals, motif
search, rhythm patterns, and voice-leading checks — plus drop-in analysis
Web Components that render those results as HTML.

The APIs have no DOM dependency, so they run in Node, workers, browsers,
tests, import pipelines, and batch jobs. It does not play audio or render
notation — those live in [`@webscore/play`](../play) and
[`@webscore/view`](../view).

```bash
npm install @webscore/analyze   # @webscore/core comes along
```

> **Note:** not yet published to npm — clone the monorepo and use the workspace
> packages locally until then.

`@webscore/io` is an **optional** peer — only needed when a Web Component
loads a file from a `src` attribute. Chord naming is powered by the bundled
`@tonaljs/chord-detect` and `@tonaljs/chord`.

## Package layout

`@webscore/analyze` separates pure analysis, stateful resources and UI:

- **`@webscore/analyze/api`** — the stateless **API** (data in / data out): all
  analysis functions (`summarizeScore`, `chordTimeline`, `detectKey`,
  `segmentChords`, `identifyChord`, `identifyChordFromMidi`, `romanNumerals`,
  `findMotifs`, `rhythmPatterns`, `voiceLeading`). No DOM, no engine state.
  (The package root mirrors this entry, so
  `import {detectKey} from '@webscore/analyze'` also works.)
- **`@webscore/analyze/headless`** — code-only analysis components you
  instantiate and drive: `createAnalysisSession`, `createLiveChordTracker`,
  `createLiveKeyTracker`, and the Worker client. They consume scores or note
  events and publish domain results; they never create UI or touch the DOM.
- **`@webscore/analyze/worker-client`** — the stateful main-thread Worker
  client with explicit `dispose()` lifecycle.
- **`@webscore/analyze/worker-protocol`** — pure protocol constants and wire
  types for custom hosts; importing it never registers a listener.
- **`@webscore/analyze/worker`** — the self-registering Worker runtime.
- **`@webscore/analyze/element`** — **Web Components**: one independent
  component per analysis function, registered with `define*`.

Component loading, DOM event binding, playhead state and DOM renderers are
private modules under `src/element/internal`; they are implementation details,
not a second public API. The UI-independent live trackers live in `/headless`
and are shared by those elements.

The root still forwards `/api`; `/session` forwards the session subset of
`/headless`; and `/elements` aliases `/element` for existing consumers.

### Worker client, protocol, and compatibility

ESM browser consumers can call `createAnalysisWorker()` with no arguments; the
published ESM entry resolves and starts the adjacent module Worker. The CommonJS
entry deliberately uses the same in-process Promise API by default, because it
has no stable module URL from which to resolve a browser Worker. A CommonJS
consumer that has its own bundler-specific Worker URL can still pass a Worker
instance or factory explicitly. If an ESM default Worker is blocked by CSP or
cannot be resolved by a deployment, it takes the same in-process fallback;
passing an explicit Worker/factory keeps that setup under the caller's control.

```ts
import {
  AnalysisWorkerRemoteError,
  createAnalysisWorker,
} from '@webscore/analyze/worker-client';

const client = createAnalysisWorker();
try {
  const initial = await client.analyze(score, {windowQuarters: 2});
  const updated = await client.update(editedScore);
  void initial;
  void updated;
} catch (error) {
  if (error instanceof AnalysisWorkerRemoteError) {
    console.error(error.code, error.operation, error.causeCode);
  }
  throw error;
} finally {
  client.dispose();
}
```

The current wire contract is protocol v1. Requests and responses carry
`protocol: '@webscore/analyze/worker'`, `protocolVersion: 1`, and a
non-negative safe-integer `id`. Requests use `action: 'analyze' | 'update'`;
successful responses contain `result`. Failed responses retain a plain
`error` string for display compatibility and add `errorDetails` with
`version`, `code`, `operation`, `message`, `retryable`, and optional
`causeCode`. Import `ANALYSIS_WORKER_PROTOCOL`,
`ANALYSIS_WORKER_PROTOCOL_VERSION`, and custom-host wire types from the pure
`@webscore/analyze/worker-protocol` entry rather than copying their values or
importing the self-registering runtime.

The client validates the response envelope, protocol identity/version,
correlated request id, complete `AnalysisResult` shape, success/error
discriminant, and structured failure fields at runtime. A malformed,
mis-correlated, or incompatible response is a terminal Worker failure: all
pending promises reject, owned Workers terminate, and listeners are detached
when the Worker exposes `removeEventListener`. The operation is a closed v1
value and an optional `causeCode` must be a string; `code` is deliberately an
open string for forward compatibility. A remote structured failure rejects with
`AnalysisWorkerRemoteError`; code that switches on `error.code` should still
handle unknown future codes generically.

Ownership is explicit. A ready-made Worker instance is borrowed and is not
terminated by `dispose()`; a Worker created by the default path or a supplied
factory is owned and is terminated. Custom borrowed `AnalysisWorkerLike`
objects should implement the optional `removeEventListener` method so disposal
can release listener closures as well as ignore future callbacks.

**Current cancellation boundary:** analysis v1 has no `AbortSignal`, timeout,
or `cancel` message. Latest-wins `update()` coalesces scores that are still
queued, but it does not interrupt an update already running in the Worker.
The in-process fallback preserves the Promise-shaped API but computes
synchronously and returns local errors rather than remote-error wrappers.
Callers needing supersession should ignore stale application results and still
call `dispose()` when the whole client is no longer needed.

Analysis options are validated before computation: `windowQuarters` must be
finite, and `motifLength` / `minOccurrences` must be positive safe integers.
The same validation applies to session, Worker, and fallback paths, so invalid
options reject instead of producing `NaN` fields in an apparent success.

```ts
import {
  summarizeScore,
  chordTimeline,
  detectKey,
  segmentChords,
  romanNumerals,
  findMotifs,
  rhythmPatterns,
  voiceLeading,
} from '@webscore/analyze/api';

const summary = summarizeScore(score);          // metadata, counts, duration, tempo, key, range
const chords = chordTimeline(score, {windowQuarters: 1}); // zero-config chord scan
const key = detectKey(score);                   // {tonic, mode, confidence, scores}
const segments = segmentChords(score, {windowQuarters: 4}); // Tonal-powered chord labels
const roman = romanNumerals(score, key);        // I, IV, V7 … relative to the key
const motifs = findMotifs(score, {length: 4, minOccurrences: 2});
const rhythms = rhythmPatterns(score, 4);
const issues = voiceLeading(score);             // large leaps, parallel fifths/octaves
```

Every function takes a `Score` (from an importer or built with
`@webscore/core`) and returns plain serializable data, so analysis slots into
any pipeline between loading and rendering/exporting.

## Web Components

Custom elements ship from the `/element` subpath so the main entry stays
DOM-free. Registration is explicit:

```ts
import {defineAllAnalysisElements} from '@webscore/analyze/element';
defineAllAnalysisElements();
```

**One element per analysis function** — bind any of them to a
`<score-player>` with `player="#id"` and it reacts to playback:

```html
<score-player id="p" src="song.mid"></score-player>
<live-chord player="#p"></live-chord>                            <!-- chord sounding RIGHT NOW -->
<key-detector src="song.mid" player="#p"></key-detector>         <!-- live key tracking -->
<chord-timeline src="song.mid" player="#p"></chord-timeline>     <!-- playhead-following segments -->
<roman-analysis src="song.mid" player="#p"></roman-analysis>     <!-- playhead-following numerals -->
<motif-list src="song.mid" player="#p"></motif-list>             <!-- motifs light up as they play -->
<voice-leading src="song.mid" player="#p"></voice-leading>       <!-- issues light up under the playhead -->
<score-analysis src="song.mid"></score-analysis>                 <!-- static summary card -->
```

Each element is an **independent component** in its own module — no
inheritance between them. They all compose the shared building blocks of
private responsibility-based modules (score resolution, player event binding,
playhead highlighting, and DOM renderers) plus the public code-only live chord
/ key trackers, so every behaviour has exactly one implementation. The consolidated
`<analysis-view type="key|chords|roman|motifs|voice-leading|live-chord">`
composes the same core into one multi-view tag and can switch views at
runtime. `type="live-chord"` needs no score at all — it tracks `webscore:noteon` /
`noteoff`, names the sounding chord live (`identifyChordFromMidi`), and
dispatches `webscore:chordchange` whenever it changes. Every element accepts a
`src` URL (MIDI / MusicXML / MXL / ABC, loaded through the optional
`@webscore/io` peer) or a `Score` assigned to the `.score` property, and is
styled through `--webscore-analyze-*` CSS custom properties. Each `define*`
function takes an optional custom tag name.

## Documentation

Full API docs live in the monorepo's documentation site
([`apps/doc/webmusic-score`](../../../apps/doc/webmusic-score), `npm run docs:dev:score`) — see the **Analyze API**
page.

## License

MIT
