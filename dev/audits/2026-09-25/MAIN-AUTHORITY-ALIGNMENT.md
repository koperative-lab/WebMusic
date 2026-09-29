# Main authority alignment — 2026-09-25

## Baseline and correction

Source: main `1e0fb7b`. Target: the existing dev `ae0742a` working tree with its
uncommitted migration and Audio review work. The user clarified that Score and
Agent Toolkit must follow main; Audio and Bridge are the product additions.
This supersedes the broader preservation choice in
[the earlier synchronization](MAIN-SCORE-TOOLKIT-SYNC.md), whose dated evidence
is retained. Main was not modified, and no commit or push was made.

The complete pre-change working files and staged/unstaged patches were saved
locally in `/private/tmp/webmusic-main-authority-ayttixqr`. Retired files were
checked against that backup before removal.

## Scope and preservation

- All 415 maintained Score package files and 36 Score public reference pages
  match main byte for byte. The six Score parameter catalogs also match main.
- The four Toolkit pages, release baseline and strict validation behavior follow
  main. The six query commands retain main's argument parser. The temporary
  `--development` mode and dev-only Score/UI recipes were removed.
- A separate Audio/Bridge adapter adds its references and true source/manifest
  fingerprints. Existing `--base-url` and `--context-dir` options select those
  snapshots; they do not claim published compatibility.
- UI exports, six documentation groups and shared site theme follow main.
  Audio-required gesture, lifecycle and neutral presentation changes are retained
  in their owning presenters. Recorder's main default label is preserved; Audio
  explicitly supplies its stop-playback label.
- Obsolete Score controllers, experiments and unrelated UI application/gallery
  surfaces were retired. Main search, breadcrumbs, navigation, browser sandbox,
  Introduction alias and original Score demo assets were restored.
- Audio waveform/scratch/inertia implementation is preserved. The only production
  Audio changes in this correction are its explicit recorder label and preservation
  of a timeout's original error cause. Bridge runtime source is unchanged.
- Shared development dependencies follow main. React uses one 19.3 instance;
  Audio/Bridge tests use the same Vitest/jsdom family. Test doubles were adjusted
  for real mock-isolation and type differences. No Score test was changed.

## Verification

Node 24.21.0; final working-tree results, not a transferred main result:

- All workspace tests passed: 322 files / 4,098 tests (Kernel 155, UI 626,
  Score 2,115, Audio 827, Bridge 154, documentation 221).
- Workspace typechecks and test typechecking passed. The main search client has
  three deprecated-keyCode hints, with no Astro errors or warnings.
- Architecture, documentation contracts, generated inventories, snippet compilation,
  site-notice regressions, format and lockfile checks passed during validation.
- `npm run docs:build` passed: 110 pages; local search indexed 108 public pages;
  Toolkit verified 108 Markdown references; site notices verified 86 records and
  331 covered files. Audio's fft.js MIT text is preserved verbatim from its
  installed README with exact version, repository, text and artifact hashes.
- Package, receipt, bundled-notice and release-manifest checks passed: 89 public
  entries and five package receipts. Dependency audit reported zero vulnerabilities.
- External installation passed: 160 ESM/CommonJS runtime imports, Score model
  composition in both formats, and Node16/NodeNext/Bundler declaration checks
  without skipLibCheck.
- Native browser: Toolkit navigation and breadcrumbs render; Score playback
  advances and pauses; Audio View loads its 5:19 fixture and centered-scrub
  controls. No console errors were captured on those checked pages. The main
  search dialog correctly explains that live dev search requires a built preview;
  this pass verifies index generation and search regressions, not a native query.
- Local development preview was restarted at `http://localhost:4321/`.

### Existing main lint baseline

`npm run check` fails at lint with seven findings in unchanged main files:
Score `abc.ts`, `mxl.ts` (two), `rack.ts`, `osmd-staff.ts`, and UI `parameter.ts`
and `workbench.ts`. These were independently reproduced against the main checkout
using its ESLint API. The rules remain enabled and the files remain identical;
the full check is not reported as passing. All later gates were run separately.
[The normalized main findings](main-lint-baseline.json) retain rule, location and
message evidence. Earlier React-version failures were resolved by unifying the
installed dependency graph; they are not remaining runtime test failures.

## Limits

This synchronization does not establish device listening, sample-accurate clocks,
complete accessibility acceptance, remote CI, registry publication or deployment.
The Audio/Bridge static-asset provenance inventory still needs a separate review.
