# Score analysis review corrections — 2026-10-07

## Scope and baseline

An independent review of `dev` at `4471a22ff0eaaa2e99751a9bd090554f7ef01d4d`
(the four elementary Analyze tools from DEC-047/048 and the lockfile
follow-up) reran `VITEST_MAX_WORKERS=2 npm run check`, which passed its 4,301
workspace tests, and inspected the four Analyze demos on the local
documentation site without console errors. The corrections below were then
implemented on the working tree and recorded in DEC-049. This record does not
commit them; the `dev` history after the review also contains the merged
dependency integration, which this work does not touch.

## Findings and corrections

| Finding | Reproduction and correction |
|---|---|
| Wrapped chord labels had no minimum band width | `window="30"` on the chord demo produced 10px bands, one glyph per line, a 486px row and a 580px component; `window="8"` produced 224px rows. [Harmony](../../packages/ui/src/harmony.ts) now hides the label stack of a wrapped band narrower than 48px, marks it `data-label-fit="hidden"`, excludes it from the row measurement and restores it on zoom or resize. The band title and semantic entry keep the reading. |
| Default beat grouping failed on irregular and mixed meters | The chord Element defaults to `grouping="beat"`, so any 5/4 or 7/8 score reported an error until `beat-groups` was set, and one list could never satisfy a score with differing irregular numerators. [Rhythm inspection](../../packages/score/src/analyze/core/rhythm-inspection.ts) now accepts one list or several (`BeatGroups`); each applies to the numerator equal to its sum, conventional meters keep their pulses unless a list sums to them, equal sums are rejected, and the error names the meter and required sum. The attribute accepts `2+3 2+2+3`. |
| Same-voice harmonic overlap was an unrecorded contract change | `analyzeIntervals` now reports a sustained note beneath a later attack in the same voice, which the 0.2.0 release excluded. The behavior is kept; the API page, the interval Element page and DEC-049 state it. |
| Full-range float selection rounded a triplet-ending last span | The Element always passes `durationQuarters.toFloat()`, which `Rational.from` approximates with a million denominator. [Chord inspection](../../packages/score/src/analyze/core/chord-inspection.ts) now uses the authored Rational ends when a float bound reaches the Score's start or end. |
| Unnamed live note sets were exposed to screen readers twice | The stable nameplate speaks the notes through its live region and also showed them in the visible note row. The row is now `aria-hidden` while the live region carries the same notes. |
| Unobserved attributes could put a tool into an error state | `kind` on a rhythm tool or `subdivision` on a chord tool was validated although never observed. [The shared Element](../../packages/score/src/analyze/element/internal/analysis-component.ts) validates only the attributes each tool observes. |
| The independent-loops demo decoded the complete recording for every session | A 1 s and a 1.5 s loop downloaded and decoded the 37 MB WAV on each start after Dispose. The new [shared excerpt helper](../../apps/doc/webmusic/src/components/headless/arabesque-audio.ts) decodes once per excerpt length, keeps only the opening excerpt and forgets a failed load so the next start can retry. The composition page shows its source, so the helper is added to the Agent Toolkit's public raw-input allowlist in [the Audio/Bridge context extension](../../apps/doc/webmusic/scripts/agent-context-audio-bridge.mjs) and its test. |

## Verification

New or revised regressions cover mixed 4/4, 5/8 and 7/8 scores with one and
several lists, equal-sum rejection, a conventional meter replaced by a matching
list, hidden and restored wrapped stacks across zoom and resize, exact triplet
ends, nameplate `aria-hidden`, unobserved attributes and the cached excerpt's
disposal and retry paths. After the corrections, `npm run build:packages`,
`check:format`, `lint`, `check:architecture`, `check:docs`,
`check:doc-snippets`, `typecheck`, `typecheck:tests`, `check:lockfile`,
`check:licenses`, `check:packages`, `check:release-manifests`, `docs:sync` with
`check:dev-docs`, and `VITEST_MAX_WORKERS=2 npm test` across every workspace
(4,307 tests) passed on the tree that also contains the merged dependency
integration. The site's agent-context tests first rejected the new raw helper
until it was allowlisted; the rerun passed.

The chord demo on the local documentation site, after the package rebuild,
confirmed the correction with the actual Arabesque No. 1 score:

| `window` | Band width | Hidden stacks / bands | Row height | Component height |
|---|---|---|---|---|
| 1 s (default) | 296px | 0 / 423 | token minimum | 142px |
| 4 s | 74px | 0 / 423 | 108px | 202px (unchanged) |
| 8 s | 37px | 415 / 423 | 91px | 185px (previously 319px) |
| 30 s | 10px | 423 / 423 | token minimum | 142px (previously 580px) |

Hidden bands retained their title (for example `A/C# — C#4 E4 A4`) and the
current readout; the browser console stayed empty, and the demo was returned to
its one-second window. A local check is not CI, publication, screen-reader or
device evidence.

## Moderate audit follow-up

The ten moderate findings all reduce to one advisory, GHSA-rj75-hqrm-r3gf in
`postcss-selector-parser` below 7.1.6, reached only through the documentation
site: `@astrojs/starlight` → `astro-expressive-code` → `rehype-expressive-code`
→ `expressive-code` → `@expressive-code/core` → `postcss-nested` 6.2.0 → the
nested parser 6.1.4. The latest Expressive Code 0.44.2 still declares
`postcss-nested ^6.0.1`, and npm's only suggestion is a breaking Starlight
downgrade, which DEP-02 rejects.

The correction adds a root npm override scoped to `@expressive-code/core`:
`postcss-nested ^7.0.2`. Upstream 7.0.0 raised the selector parser to 7 and
refined comment movement; 7.0.1 and 7.0.2 fixed nested comment and selector
regressions; 8.x only moves to ESM and drops older Node.js, so 7.0.2 keeps the
CommonJS consumer unchanged. After `npm update postcss-nested` the lockfile drops
the nested 6.1.4 parser (901 locked packages), the chain deduplicates to the
hoisted 7.1.6, `npm run check:lockfile` passes and `npm audit
--audit-level=moderate` reports no vulnerabilities. `npm install` alone kept the
locked 6.2.0 and only marked it invalid; the explicit update re-resolved it.

With the override in place, `VITEST_MAX_WORKERS=2 npm run check` (4,307
workspace tests), `npm run docs:build` (112 pages), `npm run pages:build` (112
pages, 350 emitted files validated by the site-notice check),
`npm run audit:dependencies`, `npm audit --audit-level=moderate` and
`npm run check:external-install` all passed. Because `postcss-nested` runs at
build time inside Expressive Code's CSS pipeline, the rebuilt site was also
served with `astro preview` and compared with the development server, whose
long-running process still held the previous module: the Analyze API page
rendered the same 27 code frames with identical computed frame background,
padding, border, radius and line layout, the same 23 Expressive Code style
rules and the same first-frame height, with no console errors. Starlight and
Expressive Code versions are unchanged; the override should be removed once
Expressive Code requires `postcss-nested` 7 or later.
