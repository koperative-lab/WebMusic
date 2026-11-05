# Editing release fixes — 2026-10-16

## Scope and baseline

This repair follows the five reproduced P2 findings and two documentation gaps
in the [release review](2026-10-16-editing-release-review.md). It applies to the
uncommitted `editing-capabilities` tree based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, using Node 26.8.1/npm 11.19.0 on macOS.
The earlier review and its failing probes remain unchanged.

## Repairs

- Piano-roll numeric fields bind to document identity, committed revision and
  selected note IDs. Shared selection changes and external revisions refresh
  even focused fields; same-target redraws preserve pending values. Commands
  reject a target/revision change during draft cancellation. Empty/multiple
  selections retain insertion parameters and disable Apply.
- Audio history accounting plans the future lease graph before adopting a
  root or changing history. Statistics failures preserve the previous revision,
  undo/redo branch and active processing job, and release candidate leases.
  If cleanup callbacks make accounting fail after adoption, the editor reports
  the error, releases unverifiable history and publishes a coherent committed
  snapshot/state. This conservative fallback does not retain unbounded history.
- Clipboard clearing detaches ownership before releasing its lease and guards
  the entire mutation against nested commands.
- Audio document disposal rechecks attachment identity after callback-bearing
  cleanup. A newly bound document keeps its requested/applied revision and
  revision waiters.
- Waveform range endpoints and segment gain retain pending values across public
  `updatePlayback()` calls and focus changes. Shared range selection, document
  revisions and segment replacement refresh the appropriate fields. Commands
  reject a revision change during draft cancellation. The built-in Element's
  frame loop still uses `redrawFrame`; the reproduced path is API + UI playback
  synchronization.

The [migration guide](../release/EDITING-MIGRATION.md) documents Score JSON v0.2
old-reader incompatibility, the Audio source-detail discriminated union, and
new Edit entry points. Score's public introduction now describes the existing
Audio and Bridge packages. Owning View and Editor references describe the
corrected interaction and failure behavior.

## Verification

Targeted regressions pass: Score editing and two integration suites (27 tests),
waveform editing (45 tests), and Audio editor/sequence/processing/rendering/
document binding/Element integration (120 tests). Workspace and test typechecks
and targeted lint checks pass. A separate read-only cross-review found no new
blockers in ownership transfer, history budgets, callback guards or numeric
target binding. Nineteen regression cases were added to the existing suites.

| Command | Result and evidence |
| --- | --- |
| `npm run check` | Passed: 369 workspace test files / 4,573 tests, plus script tests, typechecks, architecture, documentation, license, package and release-manifest gates. [Log](2026-10-16-editing-release-fixes/full-check.txt). |
| `npm run docs:build` | Passed: 117 pages, 115 public references, site notices covering 74 records / 367 files. [Log](2026-10-16-editing-release-fixes/docs-build.txt). |
| `npm run check:external-install` | Passed: five tarballs installed outside the workspace; 184 runtime entries, 96 ESM/browser and 92 CommonJS declaration entries checked with `skipLibCheck: false`. [Log](2026-10-16-editing-release-fixes/external-install.txt). |
| `npm run audit:production` | Passed: zero reported production vulnerabilities. [Log](2026-10-16-editing-release-fixes/production-audit.txt). |
| `npm run docs:sync` and final documentation/diff checks | Passed after recording results; generated inventory contains 268 Markdown/MDX documents. |

Browser acceptance used a temporary local fixture with the current production
renderers; it is not a shipped demo. The retained
[fixture source](2026-10-16-editing-release-fixes/browser-fixture.txt) and
[HTML](2026-10-16-editing-release-fixes/browser-fixture-html.txt) expose ordinary
controls for shared selection and public playback synchronization. Browser
automation operated those controls without injecting application state:

- With Pitch focused and edited to 61 for note a, an external shared-session
  selection of b kept focus and refreshed fields to quarter 3/pitch 64. Apply
  retained a at quarter 0/pitch 60 and b at quarter 3/pitch 64. It creates one
  revision because the numeric form explicitly applies the default velocity.
- Start 101 and End 303 survived a playback update and committed that exact
  selection. Gain 0.25 survived moving focus out of its field and another
  playback update, then committed 0.25 at revision 1.

The [browser result](2026-10-16-editing-release-fixes/browser-result.png) shows
both final states. No browser warning/error logs were observed in this fixture.
This focused regression exercise does not establish physical audio output,
screen-reader behavior or touch interaction.
The rebuilt documentation preview was also reloaded: the MIDI editing workflow
initialized eight notes with document and playback both ready at revision 0,
and the updated numeric-field contract appeared in the public reference.

## Release boundary

These repairs close the five known code findings, not the entire publication
process. No version bump, commit, push, authentication change, publication,
tag or deployment was performed. A new shared version, clean reviewed release
commit/CI and authorized publisher remain necessary under
[STATUS](../STATUS.md), RELEASE-01. Existing manual device/accessibility and
Audio/MusicXML file-picker acceptance gaps remain in EDIT-01. The independent
site asset redistribution gap remains in DEV-05.
