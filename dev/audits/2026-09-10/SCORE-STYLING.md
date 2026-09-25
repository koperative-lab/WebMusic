# Score and UIKit external styling review — 2026-09-10

## Baseline and scope

The user requested external styling for every Score Web Component and its UIKit
presenters, including transparent backgrounds, colors and radii. The working
checkout was `main` at `f074cd8b5f7cdf8f288c77d988384a359c873cfb`, with prior
uncommitted Score Headless/API reviews. Concurrent first-release scope edits
were also present; this review preserves that work and does not infer acceptance
for removed packages from earlier test totals.

Scope includes all public Play/Analyze/View tags, their representation modes,
the compatibility player alias, six exported demo wrappers, and every public
UIKit presenter entry. `rack-part` is a nonvisual declaration. Algorithms,
transport/resource ownership and the previously recorded transposing-instrument
analysis limitation are outside this presentation change.

The public owners are the [Score element theming guide](../../../apps/doc/webmusic/src/content/docs/score/element/index.mdx),
the individual element pages, and [UIKit styling](../../../packages/ui/README.md).
This dated report records verification, not a second theme specification.

## Findings and repairs

| Area | Finding | Repair |
| --- | --- | --- |
| Note input | Host compatibility defaults bypassed shared key/accent colors; black-key labels/borders and held piano labels had incomplete styling paths. | Preserve inherited modern tokens, then apply explicit legacy overrides. Add independent alternate/active label paint and shared semantic fallbacks. |
| Recorder | Host defaults masked the shared recording accent and accent foreground. | Read `--wm-accent` and `--wm-accent-foreground` before existing red/white defaults. |
| Player | Compatibility volume width ignored the already-public UIKit width token. | Preserve legacy width first, then `--wm-transport-volume-width`. |
| Synth/LFO | Button and selected-chip text used the surface background as a fallback. Setting the surface transparent erased labels. | Decouple accent foreground from background; align the Element bridge and UIKit palette chains. |
| Analyze | Workbench and its child lane could both paint translucent surfaces; missing outer-frame hooks prevented consistent border/radius overrides. | Workbench owns one configurable surface; inner Harmony presenters use explicit `surface: 'none'`. Add public light-DOM part aliases across all five tags. |
| UIKit | Pitch/Harmony/Workbench lacked the shared outer-surface contract; some direct paints skipped shared semantic colors. | Extend the existing surface helpers and public tokens, including stylesheet-free paths and optional unpainted embedded surfaces. |
| View | Sheet paper/ink, Canvas notes and some map/thumbnail paint did not consistently consume external colors. | Bridge default OSMD SVG ink to CSS, expose paper paint, sample Canvas CSS during redraw, and preserve explicit renderer-color precedence. |

There is no new theme provider or component settings UI. Applications style a
host or ancestor with public CSS variables; existing explicit legacy options
retain their documented precedence. Inner keys, plots and musical band palettes
have separate controls from outer frames. Component-border values are full CSS
border shorthands; shared control-border values are colors.

## Coverage and procedure

| Family | Coverage |
| --- | --- |
| Play | `score-player`, `simple-score-player`, `rack-control`, all three `note-input` layouts, `score-recorder`, all six `synth-panel` sections; nonvisual `rack-part` inspected. |
| View | Five `score-view` types; three `pitch-view` types; real MusicXML/OSMD `sheet-view`; public SVG / internal Canvas renderer paint and explicit color precedence. |
| Analyze | `chord-analysis`, `live-chord-analysis`, `key-analysis`, `roman-analysis`, `voice-leading-analysis`. |
| UIKit | All public presenter entries inspected for surface/color/control hooks; focused tests include all surface families and embedded/stylesheet-free paths. |
| Demo wrappers | Player, preset player, rack, note input, recorder and synth wrapper inheritance. |

The browser fixture uses public package entries and a bundled MusicXML file.
Controls switch themes and container widths through real UI actions. Browser
inspection reads computed styles and geometry; it does not inject private
component state. A deliberately striped dark ancestor makes an unintended
opaque inner surface visible. A second palette checks runtime inheritance.
The fixture's held-note action emits documented player note events for visual
state coverage; it is not an audible playback or timing measurement.

Baseline screenshots were captured from the default note-input documentation
demo and the complete fixture before rebuilding. The old built output showed
hardcoded white Sheet paper and zero-radius/unframed Pitch/Analyze surfaces even
when the ancestor requested a common border and radius.

## Verification

Integrated build, rendered-browser results and final repository checks are
recorded below. Source-specific test results and their limits are retained in
[UIKit](SCORE-STYLING-UIKIT.md), [View](SCORE-STYLING-VIEW.md) and
[Analyze](SCORE-STYLING-ANALYZE.md) companion reports.

- `npm run docs:sync` — passed; inventories include this report and its owners.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run check` — passed on the final
  source: 209 workspace test files / 2,637 tests; 148 checked documentation
  examples; source/test types, lint, architecture, documentation, license,
  61 public export entries and release-manifest gates passed. These totals
  describe this checkout's current release scope, not the earlier Audio scope.
- The first integrated check found one old test asserting that the ScoreView
  accent must never be inherited. The test now checks the requested inheritance
  and still verifies that an explicit color attribute takes precedence; the
  second complete run passed.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run docs:build` — passed, producing
  68 pages. The site-only build was repeated after the final prose corrections.
- `git diff --check` — passed. No commit, merge or push was performed.

### Rendered browser checks

The local browser loaded rebuilt public packages at `127.0.0.1:4322`. For all
22 main fixture instances, computed outer backgrounds were `rgba(0, 0, 0, 0)`,
borders `1px`, and radii `14px`. Switching the ancestor palette changed the
radii to `22px` without remounting. At a 760px fixture width, each host and
outer surface measured 728px; at 320px, each measured 288px. Neither setting
produced document horizontal overflow. The 32px difference is fixture padding.

- Real OSMD SVG default ink changed from `rgb(229, 231, 235)` to
  `rgb(255, 223, 148)` on an ancestor palette switch. Both Stage and paper
  computed transparent backgrounds.
- Synth LFO primary/selected controls computed green accent background
  `rgb(34, 197, 160)` and opaque `rgb(9, 40, 32)` text while all surface tokens
  were transparent. Graph viewports also computed transparent.
- Score map regions followed the second accent palette. Score thumbnail/idle
  note paint followed foreground; the integrated active-note chain now reads
  the shared accent after its specific token, retaining the previous red when
  neither is set. Actual piano-roll fill resolved to the green accent at its
  existing 0.83 opacity.
- Legacy event-source fixture input produced four held marks in keyboard and
  staff, eleven fretboard placements, and a visible `CM` live-chord symbol.
  Pitch's degree-role palette remains independently controllable through
  `--wm-degree-*`; it is not flattened into a single accent by default.
- The transport seek retained a 2px `rgb(255, 200, 87)` keyboard focus outline
  under the transparent theme. Inherited player/preset demo frames were also
  confirmed transparent with the requested border/radius.
- Screenshots in the task record show the default and transparent Play gallery
  and narrow Analyze layout. Later screenshot/mouse capture became unavailable
  in the browser connection; keyboard actions and read-only computed-style
  inspection still worked. Final active-state checks use that evidence, not a
  claim of a complete post-animation screenshot pass.

The retained [browser fixture](score-styling-fixture.astro.txt) is an audit input,
not a shipped documentation route. To reproduce, copy it to
`apps/doc/webmusic/src/pages/score-styling-qa.astro`, build packages, start the
docs server and open `/score-styling-qa/`. Remove that temporary route after
verification. It mounts demo-owned audio resources, but the **Hold C major**
button only emits visual input events; no microphone is accessed.

The final integration also preserves black-key default borders by reading
`--wm-note-key-alt-border` → `--wm-border` → `#000`. This resolves the temporary
integration item in the UIKit companion report. Updated built declarations and
root test typechecking supersede any stale-declaration failures recorded by
individual agents.

## Boundaries

Browser styling acceptance does not establish audible accuracy, touch-device
behavior or complete accessibility. jsdom tests validate contracts, lifecycles
and CSS declarations; they do not resolve inherited CSS variables or draw text.
Custom injected OSMD instances retain their caller-owned rendering settings.
The internal Canvas adapter takes updated CSS on redraw; public SVG-based Elements
inherit it immediately without reloading their score.
