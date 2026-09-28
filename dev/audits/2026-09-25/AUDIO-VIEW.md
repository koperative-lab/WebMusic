# Audio View review and opening performance — 2026-09-25

## Baseline and scope

Reviewed the restored five-package `dev` working tree at `ae0742a`, following
main `1e0fb7b` guidance and the preceding Audio Play repairs. Existing staging
and unrelated local changes were preserved. Main was not modified. Scope:
AudioView, Thumbnail, Minimap, LiveView, RegionList, their Headless/render
helpers, and the `/audio/element/view/audio-view/` reference demos.

[Audio View design](../../design/AUDIO-VIEW-COMPONENTS.md) owns current roles and
performance/lifecycle expectations. [STATUS](../../STATUS.md) owns unresolved
binding and live-time display contracts. These repairs do not add a new player,
clock, implicit STFT calculation, or automatic companion data protocol.

## Confirmed findings and repairs

| ID | Finding | Repair and regression coverage |
|---|---|---|
| AV-01 | Opening the page eagerly decoded and analyzed a long fixture in several examples, including unused spectral modes | One reference-counted fixture uses public decoder/analysis workers; one initial waveform pyramid; spectrum and channel requests are cached on selection. Lower examples activate near visibility or keyboard interaction. Navigation aborts pending work and releases workers. [Demo fixture tests](../../../apps/doc/webmusic/test/audio-view-demo-fixture.test.ts) exercise the actual Astro scripts and shared helper |
| AV-02 | Spectrogram virtualization still owned full-song image and region canvases; a hidden host could allocate the whole song | Independent full-width scroll spacer and bounded viewport canvases; zero-width virtual hosts allocate 1×1 without painting; explicit nonvirtual mode retains full-surface semantics. [Render](../../../packages/audio/test/view/spectrogram-render.test.ts) and [viewport](../../../packages/audio/test/view/spectrogram-viewport.test.ts) tests |
| AV-03 | Follow ticks repeatedly rebuilt identical spectral/region pixels | Reuse the buffered stripe while the visible window remains inside it; cursor moves do not repaint unchanged image/region layers; unchanged ResizeObserver reports are ignored |
| AV-04 | Uniform index arithmetic misprojected caller-supplied nonuniform time/frequency axes | Paint nearest timestamp/frequency centers from the supplied axes; renderer fixtures verify actual sample placement |
| AV-05 | Source readiness and repeated same-clip assignments copied PCM and rescanned peaks or remounted the surface | Reuse immutable clip-derived peaks and retain renderer/viewport on unchanged readiness; rebind playback and read its current position, including legacy wrappers. [Element tests](../../../packages/audio/test/view/elements.test.ts) |
| AV-06 | Thumbnail resolved overrides could poison its derived-clip cache; Minimap rescanned an unchanged clip on rebind | Separate derived cache identity from the selected override; cache only completed computations, preserve caller array ownership and abort stale loads. [Overview Element tests](../../../packages/audio/test/view/new-elements.test.ts) |
| AV-07 | Empty decoded PCM invented a nonzero duration; a nonfinite zoom anchor contaminated the timeline | Keep zero samples/duration distinct from unavailable streaming PCM; use the playhead for invalid anchors. [Headless tests](../../../packages/audio/test/view/headless.test.ts) |
| AV-08 | Low-level pointer binding sought on both down and up; canceled annotation could commit; failure during subscription setup leaked cleanup | One primary gesture yields one seek or committed region; cancel is terminal; partial setup cleans up. [Binding tests](../../../packages/audio/test/view/render-binding.test.ts) |
| AV-09 | Split waveform hit testing could return an invisible third/fourth channel | Hit testing follows the two rendered lanes. [Waveform tests](../../../packages/audio/test/view/waveform-render.test.ts) |

Demo alignment also fixes Multiband rate configuration through the real `rate`
attribute, coherent reset, loading/failure feedback, and superseded async mode
completion. Existing neutral UI tokens and presenter ownership are retained.

## Performance evidence and limits

The actual demo WAV is 56,444,750 bytes, 319.9811 seconds, 44.1 kHz stereo
(14,111,168 frames per channel). Decoded Float32 PCM is 112,889,344 bytes.

A local Node 24 source probe measured roughly 101 ms WAV parse, 21 ms clip copy,
99 ms peaks computation, and 767 ms first / 765 ms warm STFT at FFT 1024 / hop
256. The STFT contains 55,118 frames and 113,102,136 magnitude bytes. A CPU
profile identifies FFT/magnitude loops as the dominant spectral cost. These are
process measurements, **not browser opening latency or a device guarantee**.
Run the retained [data probe](evidence/view-data-probe.mjs) from the repository
root with `node dev/audits/2026-09-25/evidence/view-data-probe.mjs`; it uses the
installed esbuild and a temporary source bundle. The [profile summary](evidence/view-data-profile-summary.json)
preserves the sampled function attribution; generated bundle line numbers are
specific to that run.

The change removes this unused initial STFT, shares the fixture, and moves
selected decode/analysis work into existing workers; it does not claim that all
PCM transfer/copy or later rendering work is free.

Before repairs, browser DOM inspection found a 572.8125 px host but two
16,384×512 canvases, each CSS width 28,799 px: 64 MiB combined RGBA backing.
A recorded-canvas jsdom probe additionally found:

| Scenario | Before | After |
|---|---|---|
| Hidden 60 s / 100 px-per-second spectrum, height 256, DPR 2 | 6.144 million painted pixels; about 95 ms | No painted pixels; about 17 ms setup |
| Twenty follow ticks in a stationary 0–4 s window | 20 image writes, 16.384 million pixels; about 346 ms | No image writes or pixels; under 1 ms in this probe |
| One primary click | Two seek commands | One seek command |

The retained [canvas probe](evidence/view-render-probe.mjs) accepts the checkout path
as its first argument: `node dev/audits/2026-09-25/evidence/view-render-probe.mjs "$PWD"`.
It uses a test double, not a browser raster benchmark. Regression
tests assert allocation/paint counts and geometry instead of fragile timing
thresholds. Screenshot capture was unavailable in the connected browser; DOM
and interaction observations must not be presented as screenshot acceptance.

## Remaining contracts

- AudioView can draw player-borrowed data without exposing it through its current
  public `.clip`/`.peaks` getters. Minimap and RegionList also miss some late data
  changes. The references now use explicit shared data and readiness ordering;
  a general resolved-source notification remains AUDIO-VIEW-01 in STATUS.
- Live projection stores a fixed count of caller-paced observations and paints
  equal column spacing. It does not guarantee an exact elapsed `windowSeconds`
  at variable refresh/capture rates; AUDIO-VIEW-02 retains that display decision.
- Screenshot, touch, screen-reader, high-refresh/background and real-device audio
  behavior require their own acceptance. CPU savings do not establish audible
  timing, total browser memory use, or end-to-end opening latency.

## Verification

- `npm run check` passed on Node 24.21.0: 308 test files / 4,013 tests,
  typechecks, 258 documentation snippets, architecture/docs checks, licenses,
  112 public package entries and release-manifest consistency.
- Focused data, renderer, Element and demo regressions passed during implementation.
- `npm run docs:build` passed: 182 generated pages (181 search-indexed pages).
  Local build retained the expected missing `site` sitemap warning.
- Connected in-app browser, `http://localhost:4321/audio/element/view/audio-view/`:
  initial main waveform loaded with all five optional View canvases absent;
  selecting spectrogram showed `Preparing spectrum…`, then completed with no
  captured warning/error logs. Its 565.3125 px host / 544 px plot used two
  2176×512 canvases: 8.5 MiB combined RGBA backing (the earlier 64 MiB baseline
  had a slightly wider 572.8125 px host). This is canvas storage only.
- Keyboard End reached 319.981134 seconds and moved the buffered stripe to
  clip-relative left 27,710 px while keeping bounded 2178×512 backing; Home
  restored zero. Returning to waveform mounted one canvas. Keyboard focus in the
  Multiband controls activated its previously dormant example; Right channel
  completed and speed ArrowRight set the player `rate` attribute to 1.05.
- Native select automation left a popup expanded during one switch; selecting
  its actual accessibility menu item completed the switch. No app failure was
  observed from that tooling timeout. Screenshot capture remained unavailable.
- Local preview was restored at port 4321. Main remained clean at `1e0fb7b`. No commit, push, merge or deployment is part of this pass.
