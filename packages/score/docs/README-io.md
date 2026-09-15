# @webscore/io

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current io API reference](../../../apps/doc/webmusic/src/content/docs/score/api/io.mdx).
> See the [archive index](README.md) for scope, the
> [contribution guide](../../../CONTRIBUTING.md) for setup and validation, and
> [Score architecture](../ARCHITECTURE.md) for current package boundaries.

<!-- docs:historical-body -->

---

Score-format import, export and loading for WebScore.

## Supported formats

- Standard MIDI files (`.mid`, `.midi`)
- MusicXML (`.xml`, `.musicxml`)
- Compressed MusicXML (`.mxl`)
- ABC notation (`.abc`)

```ts
import {
  detectFormat,
  loadScore,
  loadScoreFromUrl,
  parseMIDI,
  parseABCDetailed,
  parseMusicXML,
  parseMusicXMLDetailed,
  serializeABCDetailed,
  serializeMIDI,
  serializeMusicXML,
} from '@webscore/io';
```

`parseMusicXML()` is the compatibility wrapper for callers that only need a
`Score`. Use `parseMusicXMLDetailed()` at an import boundary when normalisation
must be inspectable:

```ts
const { score, diagnostics } = parseMusicXMLDetailed(xml);

for (const diagnostic of diagnostics) {
  // Stable code + severity + format, with a best-effort part/measure location.
  reportImportWarning(diagnostic.code, diagnostic.message, diagnostic.location);
}
```

The simple wrapper never logs parser warnings to the console. The same result
shape is available through `parseMXLDetailed()`, `loadScoreDetailed()`, and
`loadScoreFromUrlDetailed()`; MXL delegates the contained MusicXML result.
A missing diagnostic does not promise lossless input; it means the current
adapter did not detect a reportable normalisation. MIDI/ABC diagnostics and the
formats' remaining detailed coverage will expand independently. ABC detailed
parsing reports unsupported key/tempo/voice and notation features; MIDI
detailed parsing reports its measure-grid and selected meta/expression
normalisations. The parser Worker mirrors the direct contract through
`parseDetailed()` and `loadFromUrlDetailed()` while preserving its original
score-only methods.

URL and Worker calls accept `{signal, timeoutMs}`. The same cancellation scope
covers fetch, bounded body reading, parsing result activation, and Worker
requests:

```ts
const controller = new AbortController();
const pending = loadScoreFromUrlDetailed(url, {
  signal: controller.signal,
  timeoutMs: 15_000,
});
controller.abort();
await pending; // rejects with AbortError
```

`ScoreLoadTimeoutError` distinguishes a deadline from caller cancellation.
Synchronous parser code cannot be physically pre-empted, but a cancelled late
result is never returned or activated.

Parsing can be moved off the main thread with the explicit worker client:

```ts
import {
  ParserWorkerRemoteError,
  createParserWorker,
} from '@webscore/io/worker-client';

const parser = createParserWorker();

// Keep the old score-only API, or ask explicitly for normalisation details.
const { score, diagnostics } = await parser.parseDetailed(xml, 'musicxml');
```

Binary ownership is stable: `parse()` and `parseDetailed()` treat supplied
`ArrayBuffer` and `Uint8Array` values as caller-owned and never detach or
mutate them. The client checks `maxInputBytes` before allocation, snapshots the
exact byte range once at call time, then either transfers that private snapshot
to a real Worker or parses it in-process. Mutating the original after calling
`parse*()` therefore cannot change either route. `loadFromUrl*()` may transfer
the response buffer directly because that buffer is allocated and owned by the client.
SharedArrayBuffer-backed views are copied into transferable private memory;
the shared buffer itself is never placed in a transfer list.

In an ESM browser bundle, the default client resolves the published module
Worker automatically. The CommonJS entry intentionally uses the same
in-process Promise API by default because it has no stable module URL for a
browser Worker. Pass a Worker instance or factory explicitly for a custom
bundler setup; the default ESM path also falls back in-process if its Worker is
blocked or cannot be constructed.

Passing a Worker instance—or a factory that returns one—transfers its lifecycle
to `ParserWorker`; it is not a borrowed or shareable Worker.
`parser.dispose()` and terminal protocol failures terminate that Worker,
including one supplied by the caller. Create a dedicated Worker per parser
client and do not reuse it elsewhere.

The protocol is available at `@webscore/io/worker-protocol`; the
self-registering runtime entry is `@webscore/io/worker`. New messages use
`PARSE_WORKER_PROTOCOL_VERSION === 1`, structured `errorDetail`, and a
per-request `cancel` action; compatibility string errors remain available.
V1 requires both identity/version headers and structured details on failures;
only legacy v0 may omit both headers. Partial headers, malformed diagnostics,
and unknown response ids retire the Worker and reject pending work rather than
leaving a call unresolved. Known failures such as `ScoreInputLimitError`,
`ABCParseLimitError`, `MXLParseLimitError`, `ScoreLoadAbortError`, and
`ScoreLoadTimeoutError` keep their local error class and stable `code` across
the Worker boundary. Other structured remote failures reject with
`ParserWorkerRemoteError`, whose `code`, `operation`, and `retryable` fields
are safe for program logic; callers must still handle unknown future codes.

The MusicXML entry remains a stable parser/serializer facade. Internally its
preserve-order XML tree access, measure timing walk, Score construction, and
multi-voice serialization are isolated modules, so cursor semantics and
notation extensions can be tested independently.

For score-partwise MusicXML, the first Part owns the measure grid. Notes from
every other Part are aligned to those master starts even when a local measure
is short; detailed parsing reports the mismatch instead of shifting later
notes. Mid-measure time, key, and clef changes are reported and ignored: the current
Score model owns MBS coordinates through its real Measure grid, so relocating a
meter change into a partial bar would make quarter-to-MBS conversion
non-invertible.

ABC is intentionally a compact, single-voice subset. Quoted annotations such
as `"Cmaj7"` are skipped as text, never parsed as pitches. `serializeABC()` is
the compatibility string wrapper; use `serializeABCDetailed()` to inspect its
lossy projection. It writes explicit `z` rests for gaps and reports skipped
overlaps, grace/zero-duration notes, and additional Parts rather than retiming
them silently.

Playback consumes these public IO entries directly; it does not re-export file
formats or parser workers.
