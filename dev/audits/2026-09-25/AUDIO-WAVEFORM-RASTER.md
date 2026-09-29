# Audio waveform raster and spacing — 2026-09-25

## Scope and baseline

Follow-up in the local `dev` working tree based on `ae0742a`, preserving the
staged migration and earlier uncommitted work. The maintainer supplied a gray
waveform screenshot, reported continuing flicker, and requested vertical spacing
consistent with the sides.

The previous [inertia and spectral stability audit](AUDIO-VIEW-INERTIA.md)
records spectrogram canvas observations and its own test baseline. Its
spectrogram evidence does not verify waveform opacity stability. That audit's
body and evidence remain unchanged. The
[current View design](../../design/AUDIO-VIEW-COMPONENTS.md) owns the corrected
drawing and spacing contract.

## Confirmed cause and pre-fix measurements

The waveform paints adjacent bars separately with source-over compositing.
Fractional horizontal coordinates antialias each bar boundary independently;
partial coverages at a shared edge do not add back to fully opaque coverage.
As the viewport moves, these opacity seams vary even for opaque source colors.
Fractional device-pixel ratios can introduce the same effect at an integer CSS
offset. This is separate from spectrogram stripe caching.

The root reviewer's native probe of the actual pre-fix renderer recorded these
8-bit interior alpha values at DPR 1:

| Fractional CSS offset | Alpha |
|---|---:|
| `0` | 255 |
| `0.125` | 227 |
| `0.25` | 208 |
| `0.375` | 196 |
| `0.5` | 192 |
| `0.75` | 208 |

At DPR 2 and offset `0.25`, observed alpha ranged from 192 to 255. At DPR 1.25,
even offset `0` ranged from 191 to 255. These measurements establish the
pre-fix opacity variation; they are not post-fix acceptance evidence.

Spacing has two distinct contributions. Stage already applies equal four-sided
padding. The waveform added a separate 3 CSS px vertical inset, and the primary
demo's `min-height: 160px` left unused space below its approximately 149.2 px
waveform Stage. Lower PCM amplitude also naturally leaves space within the
128 px drawing area; it is data, not additional CSS padding.

## Repair scope

- Draw waveform bars onto integer CSS columns in a bounded offscreen raster,
  retain vertical device resolution, and composite the raster once at the
  fractional viewport offset. Keep the existing bounded viewport allocation.
- Remove the waveform's extra 3 px inset so shared Stage padding owns the frame.
- Remove the demo-only minimum height that reserves extra unused space.
- Preserve real peak amplitudes and the explicit `amplitude` setting. Do not
  normalize the current viewport or change vertical scale as playback moves.
- Align the owning Styling reference and current design with that boundary.

## Verification record

### Native Canvas alpha verification

The root reviewer ran the retained
[actual-renderer probe](evidence/waveform-raster-native-probe.astro.txt) in Chrome
154 on macOS. The [native summary](evidence/waveform-raster-native-summary.json)
retains both the pre-fix readings above and the post-fix results.

The fixture uses constant `±0.5` peaks, a `200 × 40` CSS px viewport,
`100` pixels/second, and a playhead at `1.5` seconds. A 100 CSS px interior row
crosses the dark/light progress boundary. Native Canvas pixels were read at DPR
`1`, `1.25` and `2`, each with fractional CSS offsets
`0`, `0.125`, `0.25`, `0.375`, `0.5` and `0.75`.

| Paint | Combinations | Minimum alpha in every case | Maximum alpha in every case | Result |
|---|---:|---:|---:|---|
| Opaque waveform/progress colors | 18 | 255 | 255 | Passed |
| Explicit `rgba(..., 0.5)` waveform/progress colors | 18 | 128 | 128 | Passed |

All **36 post-fix combinations passed**. The opaque interior retains full
coverage across fractional movement, while explicitly translucent paint retains
its authored opacity. These are measurements from the actual renderer on native
Canvas, covering the progress-color boundary as well as adjacent waveform bars.
They establish the repaired fixture's alpha stability, not every animated frame
for arbitrary audio or displays.

### Automated gates

The final `npm run check` exited with code `0`: **311 test files and 4,144 tests
passed**. The local log is `/private/tmp/webmusic-waveform-check.log`. Format,
lockfile, lint, architecture, documentation, package builds, source/test types,
258 declaration-backed snippets, 112 public exports, licenses and release
manifests passed.

| Workspace | Files | Tests |
|---|---:|---:|
| Kernel | 13 | 155 |
| Audio | 64 | 814 |
| Score | 161 | 1,969 |
| UI | 55 | 972 |
| Bridge | 7 | 154 |
| Documentation | 11 | 80 |

The focused waveform suite passed **25 tests**: rendering 13 and viewport 12.
The final Region fixture uses the public `createRegion({label: 'Region', ...})`
factory; its correction passed focused tests and test typechecking before the
recorded full run. The automated results and the 36 native Canvas combinations
above verify different layers of the repair.

### Documentation-site build

The final `npm run docs:build` exited with code `0` at 21:23:35 on 2026-09-25:
**182 pages built and 181 pages indexed**. The local log is
`/private/tmp/webmusic-waveform-docs-build.log`.

### Final browser layout and playback

The root reviewer checked the page against the final built packages. While
paused at `38.397736` seconds, the measured host was
`649.515625 × 149.1875` CSS px. Stage height was `149.1875` px, the drawing surface
height was `128` px, and host `min-height` was `0`. Computed Stage padding was
`9.6px` on all four sides.

Including the border, the drawing area's top, bottom and left insets measured
`10.59375` px; the right inset was `10.921875` px. The approximately `0.328` px
horizontal remainder comes from integer canvas `clientWidth` rounding. The
extra waveform vertical inset and demo-only minimum-height gap were absent.

Playback evidence came from a fresh visible in-app-browser tab 9. Between
readings at `38.749736` and `57.896403` seconds, the visible canvas remained
`1104 × 256` backing pixels, with `left: 0`, parent scroll `0`, and playhead
`translateX(276px)`. These are two observations of dimensions and positioning;
node identity was not tracked. Playback was then paused at `57.896404` seconds.
Captured console errors were an empty array.

The screenshots show the gray waveform within the evenly padded frame. They do
not establish per-frame alpha stability; that conclusion for the tested fixture
comes from the native Canvas measurements above. Real PCM retains its original
amplitude, including natural vertical space below full scale.

### Evidence boundaries

Automated regressions, native pixel reads and browser layout/playback observations
cover distinct parts of this repair. Static screenshots do not inspect every
animation frame on every display, and the recorded native results apply to the
specified DPR/offset/paint fixture.
