# Centered Audio View scratching — 2026-09-25

## Scope and baseline

Follow-up in the local `dev` working tree based on `ae0742a`, preserving the
staged migration and prior uncommitted repairs. The previous
[track-drag audit](AUDIO-VIEW-DRAG.md) records position-only scrubbing and remains
unchanged. Its passing measurements do not verify the audible scratch extension.

The maintainer clarified the desired behavior: a fixed center playhead, normal
playback suspended while held, forward/reverse scratch sound driven by gesture
speed, and restoration of the prior playing/paused state on normal release.
[DEC-027](../../DECISIONS.md) and
[Audio View design](../../design/AUDIO-VIEW-COMPONENTS.md) own the new contract.

## Implementation scope

- Play owns an optional decoded-PCM scratch session and the existing audio route.
- View borrows the session, maps gesture movement and terminates it on release
  or cancellation; no-capability sources retain position-only behavior.
- Shared time-axis renderers keep the playhead centered with blank edge padding;
  hit tests and public windows remain bounded to real clip coordinates.
- Public references, parameter copy and demos describe supported sound behavior,
  fallback behavior and the difference between release and cancellation.

## Algorithm references

The Web Audio specification defines
[buffer source start scheduling](https://www.w3.org/TR/webaudio/#dom-audiobuffersourcenode-start)
and [continuous AudioParam gain ramps](https://www.w3.org/TR/webaudio/#dom-audioparam-linearramptovalueattime).
Those primitives support scheduled, gain-windowed grains; citing the primitives
does not establish this implementation's audible quality or timing. A reversed
PCM path avoids relying on browser-specific negative-rate playback behavior;
this is not a claim that the specification prohibits negative rates.

## Verification record

The coordinated checks below completed on 2026-09-25 in the same dirty `dev`
working tree. Browser checks used the Codex in-app browser on macOS
(`Chrome/154.0.0.0`) against the local documentation server.

### Automated gates

| Command | Recorded result |
|---|---|
| `npm run check` | Passed: 310 test files, 4,102 tests; format, lint, source/test types, architecture, documentation, snippets, package exports, license and release-manifest gates passed. |
| `npm run docs:build` | Passed: 182 pages built and 181 pages indexed. |

The test total comprises Kernel 155, UI 772, Score 1,969, Audio 972, Bridge 154
and documentation 80. Local command logs are
`/private/tmp/webmusic-scratch-check.log` and
`/private/tmp/webmusic-scratch-docs-build.log`.

The regression suite covers supported/unsupported scratch sessions, paused and
playing starts, silent positioning, forward/reverse PCM, active-loop boundaries,
120 Hz velocity and stationary holds, release/cancellation cleanup, late or
failed readiness, external-command invalidation, reentrancy and source
replacement. View/renderer coverage includes borrowed-session ownership,
centered geometry, blank boundaries, mode changes and legacy fallback. These
checks exercise contracts without establishing physical-device sound quality.

### Native Web Audio output samples

The retained [probe source](evidence/audio-scratch-native-probe.astro.txt) renders
through the implemented `ScratchEngine` in a native `OfflineAudioContext` at
48,000 Hz, using a two-channel ramp with opposite polarity. The temporary
`/scratch-qa/` page was removed after verification. The
[recorded output](evidence/audio-scratch-native-output.json) contains the full
results and reproduction instructions.

Here, early/late are mean left-channel sample values over 12–20 ms and 28–36 ms;
energy is the sum of squared left-channel samples in the 200 ms output, not a
physical energy measurement.

| Mode | Early mean | Late mean | Sum of squared samples | Result |
|---|---:|---:|---:|---|
| Forward | 0.4583750000068297 | 0.4954563801487289 | 623.2000852147614 | Positive slope; passed |
| Reverse | 0.3816166666802019 | 0.34234780810462945 | 313.5274694693171 | Negative slope; passed |
| Silent positioning | 0 | 0 | 0 | No output; passed |
| Disposed before rendering | 0 | 0 | 0 | No output; passed |

All four rows have a peak absolute sample value of **0 after 70 ms** and a
maximum stereo polarity error `abs(left + right)` of **0**. This establishes
forward/reverse output, preserved stereo alignment, silence for those two
non-audible cases and a bounded tail in this native sample render. It is not a
physical-device listening test.

### Browser interaction

- Waveform Home at `0` and End at `319.981134` kept the playhead transform at
  `272px` in a `544px` renderer, with blank padding visible at both boundaries.
- A 90 px leftward waveform drag advanced `3.199811` to `4.199811` seconds;
  a 90 px rightward drag moved back by one second. The previously paused player
  stayed paused after release.
- Starting while playing, a drag released with the transport showing **Pause**
  and `pressed=true`, confirming restoration of the playing state. Playback was
  then manually paused.
- Spectrogram Home at `0` kept the same centered line; a 90 px leftward drag
  advanced to `1` second.
- No console errors were captured during these checks.

The browser drag action was atomic, so it did not separately observe the
mid-hold paused state. Unit tests cover that held-session state. Audio-device
latency and audible quality, touch interaction and screen-reader behavior remain
unverified; the native output probe and automated checks do not establish them.

## Erratum — 2026-09-25: workspace labels

The automated-gates paragraph above interchanged the Audio and UI workspace
labels. Reading the original command log by its workspace headers gives **Audio:
63 files / 772 tests** and **UI: 55 files / 972 tests**. The recorded aggregate of
310 files / 4,102 tests and all other workspace totals are unchanged. The original
body and measurements are retained; this correction does not reclassify the
results as verification of the later inertia backend.
