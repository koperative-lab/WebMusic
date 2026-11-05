# Score analysis review and dev consolidation — 2026-10-07

## Scope and baseline

The accepted `score-analysis-basics` working tree was reviewed against
`de1c65ca36974906431cbd3a3c141317862d8705`, the shared local and remote
`dev`/`main` baseline at the start of the task. Its 80 changed paths included
16 new implementation, test and documentation files. This consolidation keeps
the four elementary Analyze tools selected by DEC-047, DEC-048 chord grouping,
fixed readout fields, and existing Arabesque No. 1 demo assets.

Review followed the [component review workflow](../../.agent/workflows/component-review.md)
across Core/API/Headless, Element playback and source lifetimes, shared UI,
exports, policies, demos and public references. The delivery target is `dev`;
`main` and npm publication are outside this change.

## Findings and corrections

| Finding | Reproduction and correction |
|---|---|
| Structured readout gaps ignored the default `reservePinned: false` contract in [Harmony](../../packages/ui/src/harmony.ts) | Between two bands with readout fields, the presenter retained empty labeled columns even when reservation was omitted or disabled. Empty structured fields now persist only when reservation is enabled; an explicit pinned override still displays during a gap. Regression cases cover omitted/false options with and without the presenter stylesheet, override removal, and keyed slot reuse. |
| Rhythm selection inherited accents from excluded notes in [the Headless projection](../../packages/score/src/analyze/headless/basic-inspection.ts) | Two notes share an onset, but only the unaccented note is selected. The Headless inspection previously inherited the onset's accent from the excluded note. It now computes authored accent from the selected members; separate `accent` and `marcato` cases also preserve the positive selected and whole-onset readings. |

No further merge-blocking issue was found in the reviewed scope. Element
score/live switching, source replacement and borrowed player cleanup retain
their cancellation and ownership contracts. These findings do not change the
musical methods or add a new Analyze surface.

## Branch and work preservation

- `midi_vis_features` at `ddb1494` is already an ancestor of the shared baseline;
  it has no unique commit to merge. Current Score View and Bridge implementations
  retain its integrated capabilities.
- The old research branch at `bff1ca0da27efc02ab711d1c2ed643782a6d9d54`
  contains a broader historical snapshot, including retired recurrence UI.
  The local annotated `archive/score-pattern-analysis-research` tag and the
  original unmerged research branch preserve it; only merged branches are
  eligible for deletion in this closeout.
  Its old tree is not merged over the accepted basic analysis implementation.
  Recurrence algorithms and projections remain available through API/Headless.
- Both existing stashes are retained unchanged: the dev stash
  `f9051e14b6ee9e42de543954f4a479dc32d81389` and the MIDI stash
  `6649dc08d8c4e76ffb6b7cb6b043e4929fab95c0`. Neither is applied or discarded;
  the broad historical MIDI stash is not treated as a pending feature patch.

## Verification boundaries

The pre-correction full check passed 4,295 workspace tests, and the documentation
build produced 112 pages. All six new regressions failed before their correction
and passed afterward: the focused UI file passed 91 tests and the Headless
projection file passed 19. Final `VITEST_MAX_WORKERS=2 npm run check` passed
4,301 workspace tests on Node 26.8.1; `npm run docs:build` built 112 pages.
[STATUS](../STATUS.md) records the current delivery and verification boundary.

Earlier browser checks in STATUS cover Arabesque playback, all four Analyze
surfaces, score/live switching and normal/390px layouts. They remain evidence
for those checks; this closeout does not add real MIDI hardware, screen-reader
or acoustic timing acceptance. A local check is not remote CI or deployment
evidence.

## Remote CI and dependency follow-up

Commit `92e841abc455b6c2c00067f85c3d2485fb72420b` was fast-forwarded and
pushed to `dev`. The merged `score-analysis-basics` and `midi_vis_features`
branches were deleted locally; neither had a remote branch. The original
research branch, its local archive tag and both stashes remain. `main` stays
at the baseline above.

The [first CI run](https://github.com/koperative-lab/WebMusic/actions/runs/37707309933)
passed `npm run check` and `check:external-install` on Node 22.22.3 and 24,
and passed `pages:build`. Its final audit failed with four high and ten moderate
findings. All package manifests and the lockfile were unchanged by the analysis
commit; both baseline and reviewed lockfile had blob
`bb2bb6efd879f64fcd89831fdbc7ba5b0178858a`.

A separate compatible lockfile update resolves the high findings:

| Dependency | Previous | Updated |
|---|---|---|
| `devalue` | 5.9.1 | 5.9.4 |
| `http-cache-semantics` | 4.2.0 | 4.3.0 |
| `sharp` | 0.35.4 | 0.35.5 |
| `source-map-js` | 1.2.1 | 1.2.2 |

Manifest ranges are unchanged. The remaining lockfile differences are Sharp's
matching native packages and libvips 1.3.4, including npm's hoisting of those
packages. Lockfile-only audit now reports zero high/critical findings and ten
moderate findings in the PostCSS selector-parser chain. The latter remain
DEP-02; no forced Starlight downgrade is applied. This is a high-severity gate
pass, not a claim that the dependency tree has no advisory findings.

After a fresh `npm ci`, the corrected tree passed
`VITEST_MAX_WORKERS=2 npm run check` (4,301 workspace tests), `npm run docs:build`
(112 pages), `npm run check:external-install` and `npm run audit:dependencies`.
External-install verification imported 168 runtime entries, exercised Score
model composition in ESM/CommonJS, and checked 88 ESM/browser and 84 CommonJS
declarations without `skipLibCheck`. The final audit exits successfully at the
repository's high threshold while retaining the ten moderate findings above.
