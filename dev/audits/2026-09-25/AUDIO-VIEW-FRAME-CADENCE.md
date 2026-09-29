# Audio View frame cadence and demo density — 2026-09-25

## Scope and baseline

Follow-up in the local `dev` working tree based on `ae0742a`, preserving staged
migration and prior repairs. The maintainer continued to report stepped waveform
motion and requested a visibly fuller waveform with less vertical space.
The [waveform raster audit](AUDIO-WAVEFORM-RASTER.md) establishes its recorded
alpha measurements and layout baseline; it does not establish display-frame
sampling or the revised authored demo density. Earlier audit bodies are retained.

The [current View design](../../design/AUDIO-VIEW-COMPONENTS.md) owns presentation
cadence and amplitude boundaries. Play continues to own position and audio time.

## Source findings and repair scope

The old binding painted in response to transport `timeupdate` events. The native
player's default 50 ms event interval is approximately 20 Hz, and waveform redraw
could then queue another RAF. Stable alpha and equal padding alone do not make
that observation cadence match display frames.

- `ViewPlayerBinding` adds optional live read-only `playing` and `scratching`
  flags. With activity capability and RAF, the binding samples borrowed
  `player.seconds` while active and the page is visible; it does not predict time.
- Legacy sources without those flags, or environments without RAF, retain the
  source's event cadence. A source should notify activity changes so an idle
  binding can start observing. No transport event-rate default is changed.
- `RenderedAudioVisualizer.redrawFrame?` allows immediate painting within the
  already scheduled display frame. Waveform implements it; the fallback remains
  `redraw`. Element timeline, slider and viewport follow that same sampled value.
- Hidden pages and unsubscribe stop observation; visibility restoration reads
  the current player position. An end notification retains zero across visibility
  changes until a new time update. Unchanged values avoid unnecessary repainting;
  binding revisions retire reentrant replacements during the initial projection.
- The main AudioView demo authors `height="96"` and `amplitude="1.6"`. This fixed
  visual preset fills more of the compact drawing area and may crop tall peaks;
  PCM, playback volume and public API defaults remain unchanged. Parameters,
  copied markup and Reset derive from those attributes. Type changes retain the
  same explicit height, following existing option semantics.
- The height parameter catalog uses `min=1, step=1`. Its old `step=8` with a
  minimum of 1 rejected values such as 80 and 96 through HTML input validity,
  leaving the view unchanged. Integer CSS-pixel values now commit normally.

## Verification record

### Native presentation-cadence comparison

The root reviewer ran the retained
[three-path probe](evidence/waveform-cadence-native-probe.astro.txt) in Chrome 154
on macOS using the in-app browser at approximately 120 Hz. The
[recorded output](evidence/waveform-cadence-native-output.json) contains the full
precision measurements. Each path uses a real `AudioContext` with the same Player
behavior with a muted destination and a roughly two-second observation window.

The event-only adapter omits activity flags; the direct live-clock path exposes
the Player's getters; the Element path composes the actual AudioClipPlayer and
AudioView Elements. Paint counts intercept the visible canvas `drawImage` call,
while a separate RAF callback counts display-frame opportunities. Counts are not
inferred from the number of transport events.

| Path | Elapsed ms | Display frames | Canvas paints | Paints/second | Time updates | Median paint interval ms |
|---|---:|---:|---:|---:|---:|---:|
| Event-only | 2005.4 | 243 | 40 | 19.946 | 40 | 50.1 |
| Direct live-clock | 2000.7 | 242 | 234 | 116.959 | 40 | 8.3 |
| Element composition | 2006.9 | 242 | 236 | 117.594 | 40 | 8.3 |

The table rounds elapsed/interval values and paint rates; the linked JSON retains
exact readings. Both live-reader paths painted between the same 40 transport
events. They sampled the player's position rather than generating a second time
axis. Each path performed **one additional paint during the two RAF opportunities
after pause**, recording the final paused projection.

This establishes approximately 117 paints/second for the two live-reader paths
in this fixture and environment, compared with approximately 20 for event-only
observation. It does not promise a fixed frame rate on every device or establish
physical audio quality/latency; the real AudioContext output was muted.

### Automated verification

- Focused View suites: 114 cases passed across binding, waveform renderer,
  viewport, Element and dragging. Independent `typecheck:tests`, scoped ESLint
  and `git diff --check` passed.
- The first `npm run check` reached workspace tests but three Audio suites timed
  out during Vitest module fetching; this was a suite-loading failure, with no
  failing test assertion. The source/build/typecheck stages had passed.
- Re-running `npm run check` with `VITEST_MAX_THREADS=4`,
  `VITEST_MIN_THREADS=1`, `VITEST_MAX_FORKS=4`, `VITEST_MIN_FORKS=1` passed:
  311 test files and 4157 tests, including all 64 Audio suites and 827 Audio
  cases. Formatting, lockfile, lint, architecture, docs, declarations, snippets,
  typechecks, licenses, 112 public package entries and release manifests passed.
  Both runs used Node 24.21.0 and `NODE_OPTIONS=--max-old-space-size=6144`.

### Documentation build and final page acceptance

`npm run docs:build` passed: 182 pages built and 181 indexed. The local build
retains the existing sitemap warning because no deployment `site` is configured.

After rebuilding, the primary demo was checked through the browser UI:

- The waveform at 15.999 s rendered a 552 by 96 CSS-pixel canvas in a 117.1875 px
  high host with `amplitude="1.6"`; visual inspection confirmed fuller peaks.
  Final computed styles confirmed root padding of 9.6 px on all sides and no
  additional surface padding.
- Changing height to 80 and amplitude to 1.2 updated the attributes and generated
  copy-source markup. Keyboard activation of Reset restored 96 and 1.6.
  The generated copy source was inspected; clipboard transfer was not retested.
- Switching to meter retained the explicit height. Reset returned to waveform
  with the compact preset; keyboard seeking and Play/Pause operated normally.
  Playback advanced from approximately 16.19 to 25.89 s before being paused.
  This checks the built component integration; the quantified cadence fixture
  above separately counts completed paints.
- No browser error log entries were observed in the final session. Preview
  startup found stale IPv6 and fresh IPv4 Astro processes sharing port 4321;
  both were retired and one `--host localhost --port 4321` process was started.
  The reloaded page then initialized and played normally.

Previous alpha/spectral checks are separate evidence. The one-line catalog step
repair followed the full gate and received final scoped documentation checks and
another documentation workspace build using the already verified package output.

Acceptance also covers active/paused/ended states, scratch release, finite live
readers, legacy event sources, hidden-page resume, unchanged-value suppression,
unsubscribe and reentrant replacement; same-frame painting and timeline/ARIA
projection; and authored height/gain through type changes. Keep command results
and page observations distinct from the native cadence measurements above.
