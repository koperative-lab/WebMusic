# Code alignment — 2026-09-05

This dated record covers implementation alignment with the product, architecture,
ownership and reference contracts mapped by [AGENTS](../../../AGENTS.md).
[STATUS](../../STATUS.md) remains the owner of current work. The starting local
`main` checkout already contained substantial uncommitted changes from earlier
work; this record describes this pass, not every difference from Git HEAD.

## Repairs

| Area | Mismatch and resulting behavior | Owning source/reference |
|---|---|---|
| Bridge factories | The audio-mastered factory accepted clip-side loop/rate overrides that the score-mastered factory rejected. Both now share validation and restricted option types, reject defined overrides before acquiring resources, and direct callers to group loop/rate commands. Existing construction rollback and context ownership are retained. | [Factory validation](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/bridges/score-audio/src/factory-clip-options.ts), [Bridge reference](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/bridges/score-audio/README.md) |
| AbPlayer | Synchronous sound preparation could pause startup before its pending Promise was stored; the cancelled Promise then overwrote a retry. Generation checks now keep cancellation and retry independent. | [AbPlayer](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/ab-player.ts), [reference](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/score/headless/play/ab-player.mdx) |
| LoopPlayer | A live region edit could move playback backward and consume a finite repeat. Explicit position changes now refresh the baseline, and synchronous cursor callbacks cannot count the same wrap twice. | [LoopPlayer](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/loop-player.ts), [reference](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/score/headless/play/loop-player.mdx) |
| Rack membership | Removing the final soloed member, including a failed replacement, could leave other channels muted. Remaining member gains are now reapplied. | [Rack](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/packages/score/src/play/headless/rack.ts), [reference](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/content/docs/score/headless/play/rack.mdx) |
| Rack effects | A setter called from initial effect construction could report a recipe different from the committed graph. Reentrant changes now reject. Reusing the exact active EffectNode retains its route/disposer; distinct bundles sharing active endpoints reject before rewiring because their opaque cleanup cannot be separated safely. Failed fresh candidates are released. | Rack source and reference above |
| Demo lifetimes | Existing demos could retain contexts, players, sounds, listeners or an editor after removal. A shared resource scope now handles removal/navigation, late async results and independent cleanup. Rack demos own their created sounds; InteractivePlayer awaits readiness; Rack progress reads fresh member snapshots after lazy player creation; Sound reuses and releases timbres; the recorder releases replaced playback. The Headless controller invalidates pending factories and releases its instance even when unsubscription throws. The API editor unmounts its React root and no longer lists an import subpath as an npm dependency. | [Demo scope](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/components/demo-lifecycle.ts), [Headless controller](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/lib/headless-playground-client.ts), [sandbox client](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/apps/doc/webmusic/src/components/api-sandbox-client.ts) |
| Documentation examples | JavaScript, JSX, inline module scripts and literal sandbox code could bypass the old TypeScript-fence scan. The expanded compiler check exposed missing type imports, untyped Element access and a custom synth route returning an AudioNode instead of a cleanup function; the examples now use the actual contracts. | [Checker](https://github.com/mrsteamedbun/WebMusic/blob/6506225b772f6777cc1ae5aa5561ab79342d52df/scripts/check-doc-snippets.mjs), [Conventions](../../docs/DOCS-CONVENTIONS.md) |

The demo scope covers 11 programmatic and 11 Headless component files, including
the ScorePlayer playground factory, plus the shared controllers and sandbox.
This repairs existing demonstrations; it does not add every missing Headless
object or control to the catalog.

The checker uses isolated temporary directories, reports compiler-level errors
and exceptions, rejects type-check suppressions and unsupported computed package
code exports, and preserves missing-constructor/import-typo errors. Its tests
exercise invalid imports, real body/type errors in each supported carrier,
source locations, cleanup and overlapping runs. Literal MDX examples are
self-contained; fragment placeholders and other explicit limits remain in
Conventions. Passing compilation does not prove example execution.

## Verification

Environment: local macOS arm64, Node v22.14.0, npm 10.9.2, installed workspace
dependencies and the uncommitted checkout described above.

| Check | Result and evidence |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=6144 npm run check` | Passed: 201 workspace test files / 2,275 tests, 9 snippet-checker regressions, 235 compiled documentation examples, source/test types, format, lockfile, lint, architecture, documentation, licenses, 86 built public entries and release manifests. [Full output](evidence/code-alignment-check.txt). |
| Demo lifetime regression coverage | 16 tests across 3 files passed in the full workspace result. Tests exercise actual Astro client bodies with mocked package boundaries. The final Rack regression models lazy construction and stale add snapshots. [Focused Rack/demo output](evidence/code-alignment-rack-demo-tests.txt). |
| Strict check of 23 affected Astro client scripts | No diagnostics. [Output](evidence/code-alignment-demo-script-types.txt). The full Astro check also passed: 115 files, no errors or warnings and two deprecated-type hints in an existing recorder demo. |
| `NODE_OPTIONS=--max-old-space-size=6144 npm run docs:build` and final `npm run build -w webmusic-doc` using packages from the final full check | Passed: 120 output pages and 119 indexed English pages. [Full build](evidence/code-alignment-docs-build.txt), [final site build](evidence/code-alignment-final-docs-build.txt). |
| Local in-app browser smoke | Rack progress and pause, InteractivePlayer beat feedback, ScorePlayer playback/events/option replacement, navigation back and lazy API-editor mounting were observed. No warning/error console entries were captured for those actions. [Procedure and observations](evidence/code-alignment-browser-smoke.json). This does not establish audible output, timing accuracy, device behavior or complete accessibility. |

The full-check log includes intentional error-path output from tests. The final
exit status was zero. The site build retains bundler size/directive and redirect
index warnings; a site origin was not configured, so sitemap generation was
skipped. These are local build results, not deployment evidence.

The browser smoke found the additional Rack snapshot bug after the first green
integration run. The final full check and site build include its repair and
regression, and the repaired readout was rechecked in the browser. Final
repository documentation checks cover 175 indexed documents. Retained evidence
files have byte sizes and SHA-256 hashes in the
[evidence manifest](evidence/code-alignment-evidence.json).

## Scope boundary

This pass aligns existing implementations and their development checks. It
does not implement the pending shared-session-clock injection protocol or the
application project/session/undo/storage layer. A common AudioContext and
Bridge coordination still do not establish that all engines share one clock
instance or that cross-domain loops are sample-accurate.

The remaining cross-browser/device, audible timing, accessibility, fresh
Node 24/external consumer install and remote release checks remain in STATUS.
Earlier audit evidence has been preserved without rewriting its counts or
claims as current results.
