# Score Analyze styling review — 2026-09-10

Scope: the five retained Score Analyze Elements on the current main checkout. Existing uncommitted algorithm/Headless/API work is baseline and was preserved. This review changes presentation composition only; ANALYZE-02 (written versus sounding pitch for transposing parts) is explicitly excluded.

## Coverage

| Element | Musical presenter | Shared surface / custom paint coverage |
| --- | --- | --- |
| `chord-analysis` | Flow lane | One external frame, uniform or pitch-class band fills, now line, text/rules, radius/border. |
| `key-analysis` | Flow lane | Same surface and palette contract; tonal result calculation unchanged. |
| `roman-analysis` | Flow lane | Same contract for all visible tracks; `function` configuration and seeking unchanged. |
| `voice-leading-analysis` | Flow lane | Same surface contract plus existing info/warning/danger mark tokens. |
| `live-chord-analysis` | Nameplate | One external frame, inherited name/alternate colors, independent accent foreground; naming and alternate selection unchanged. |

Inspected shared Element mounting, presenter creation, refresh/remount and fixed recipes, plus UIKit workbench/harmony paint paths. The Element has light DOM, zero-specificity fluid host layout and no local public theme defaults. No per-Element palette was introduced.

## Findings and fixes

1. The existing workbench root and flow viewport both painted the inherited background. A translucent surface could compound over itself. The shared Element now asks its inner flow/nameplate presenter for `surface: 'none'`; UIKit owns the opt-out and the one workbench frame paints the outer surface. The Element does not write UIKit tokens or target private presenter selectors.
2. The bare workbench had no configurable border/padding surface and its frame had no stable hook. UIKit now applies the existing component surface contract with zero border/padding defaults and exposes `WorkbenchParts.frame`. The Element names that node `surface`.
3. Per-band private tone assignments masked an inherited uniform fill. UIKit now reads public `--wm-harmony-flow-tone` before each derived tone. Existing `--wm-progression-tone-0` through `-11` remain usable when no uniform fill is selected. The now line uses its existing specific token and shared accent fallback.
4. UIKit previously used the analysis background as an on-accent text fallback. An explicitly transparent background could make that text transparent. The UI owner removed that coupling after parent approval: accent foreground now follows its own existing tokens.
5. The Element now exposes stable light-DOM part aliases through presenter options: direct wrapper `root`; `presentation`, `surface`, `content`, `index`; flow `lane`, `viewport`, `reel`; live nameplate `nameplate`, `symbol`. Public references explain `[part~="..."]` selectors rather than Shadow DOM `::part()`.

UIKit source changes and its token-level regressions are owned by the UI review agent, not this file's author. No private UIKit selector is imported into Score.

## Public customization contract

Applications may set tokens on an ancestor or the Element. The shared surface uses `--wm-component-background`, `--wm-component-border` (complete border shorthand), `--wm-component-radius`, and `--wm-component-padding`. Specific `--wm-workbench-surface-*` values take precedence. Shared `--wm-surface`, `--wm-foreground`, `--wm-accent`, `--wm-border`, and `--wm-control-radius` remain the general palette/control route. Existing analysis/harmony-specific palette overrides remain supported.

Defaults remain an unframed, transparent Analyze display with its existing musical data colors and interactions. An application can add one border and radius or keep the surface transparent without removing notes, band fills, focus indicators, controls, or semantic content. Palette overrides do not change the score axis or pointer geometry.

## Files owned in this change

- `packages/score/src/analyze/element/internal/analysis-component.ts`
- `packages/score/test/analyze/element-styling.test.ts`
- `apps/doc/webmusic/src/content/docs/score/element/analyze/chord-analysis.mdx`
- `apps/doc/webmusic/src/content/docs/score/element/analyze/key-analysis.mdx`
- `apps/doc/webmusic/src/content/docs/score/element/analyze/roman-analysis.mdx`
- `apps/doc/webmusic/src/content/docs/score/element/analyze/voice-leading-analysis.mdx`
- `apps/doc/webmusic/src/content/docs/score/element/analyze/live-chord-analysis.mdx`

## Verification and boundaries

- `npm run test -w @webmusic/score -- test/analyze/element-styling.test.ts test/analyze/elements.test.ts test/analyze/elements-ssr.test.ts` — 3 files, 30 tests passed. The 10 new cases cover every retained tag: one outer surface, transparent/unframed inner presenter, stable named parts, existing slider/live-region presence, preservation of application styles, no descendant public-token defaults, and part availability after update/remount/reconnect.
- The new regression aliases the actual UIKit source for these two presenter imports; it does not stub presenter behavior or rebuild `dist`.
- `npx eslint packages/score/src/analyze/element/internal/analysis-component.ts packages/score/test/analyze/element-styling.test.ts` — passed.
- Scoped `git diff --check` — passed.
- No package build, dist edit, commit, push, algorithm change, new Element tag, or frontend demo correction was performed.
- These are source/DOM/CSSOM checks. jsdom does not resolve inherited custom properties or perform real layout. Computed colors, translucent compositing, actual radius clipping, visual focus/contrast, browser resizing and screenshot comparison remain parent-owned browser integration checks. This report does not claim browser or audio/device acceptance.
- Full repository checks and built declaration/snippet verification remain parent-owned after all source owners freeze.
