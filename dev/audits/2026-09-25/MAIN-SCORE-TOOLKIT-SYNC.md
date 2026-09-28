# Main Score and Agent Toolkit synchronization

Date: 2026-09-25. Source: main `1e0fb7b`. Target: dev `ae0742a` plus its
existing uncommitted five-package migration and Audio review work. This is a
local working-tree integration; neither branch was committed or pushed.

## Scope and preservation

The target's commit history already included reviewed main work, but its
restored files replaced portions of that implementation. The synchronization
therefore compared actual source, types, tests and references with main.

- Restored Score Core/IO, Play, View, Analyze and React fixes, including written
  notation metadata, VexFlow rendering, playback followers, annotations,
  lifecycle and shared ESM/CJS model identity.
- Retained dev-only controllers and Element injection hooks. The standard staff
  renderer receives the original Score. The retained controller's explicit
  cropped viewport uses a lossy sequence projection, documented by its owner.
- Restored Quick Start, current Score references, shared Headless demos and their
  fixtures. Retained Audio's Quick Start example and dev MIDI controller docs.
- Restored Agent Toolkit navigation, four pages, generated Markdown/catalog/
  source/Skill assets and six standalone query scripts. Development context is
  explicitly marked; queries require an explicit development option and source.
  Release compatibility checks retain main's reviewed fingerprints.
- Merged Score's required UI geometry/theme support. Retained the existing
  Astro/Vitest toolchain and added only required generator/Score dependencies.
  Main's wider release-receipt and site-tooling migration remains DEV-05.

The pre-change index, unstaged diff and complete current file contents were
backed up under `/private/tmp/webmusic-main-sync-ntzhsbu8`. A SHA-256 comparison
confirmed 259 Audio/Bridge/documentation and recent waveform-related files were
unchanged. Main remained clean. Previous staged migration work was not staged,
reset or replaced as a Git operation.

## Verification

- `npm run check`: passed. Six workspaces ran 361 test files / 4720 tests.
  Architecture checked five packages; 269 documentation examples compiled;
  package export checks covered 112 entries. License and manifest checks passed.
- `npm run docs:build`: passed, 189 routes built / 182 pages indexed before the
  final removal of duplicate helper routes. Agent generation verified 119
  Markdown references and four llms files. After consolidating the six old
  helper pages into their main owners, the final `npm run build -w webmusic-doc`
  passed with 183 routes / 182 indexed pages and 113 generated Markdown
  references. Existing package output was unchanged and reused for this build.
- Final documentation gates: `docs:sync`, `check:dev-docs`, `check:docs` and
  `check:doc-snippets` passed; 257 remaining examples compile. All 49 Toolkit
  tests passed again against the consolidated references. Old helper URLs retain
  redirects, and managed MIDI controllers remain in the InteractivePlayer page.
- Toolkit tests: 49 passed, including explicit development opt-in, release
  rejection, immutable reviewed baselines, generated source ownership and local
  origin handling. Headless policy: seven tests passed.
- Existing toolchain differences required equivalent CSS serialization
  expectations and preservation of native AudioNode overloads in test doubles.
  A missing demo test adapter was restored while retaining Audio regressions.
- Native browser: Agent Toolkit navigation renders; Quick Start loads the
  32-second notation study, starts playback, advances time and pauses without
  console errors. Audio View loads the existing 5:19 clip and retains height 96.
- Local HTTP: llms.txt and the manifest return five-package development context.
  Direct browser opening of the text download was blocked by the browser's
  download handling; HTTP and generator verification establish its contents.

Main's earlier browser/PDF evidence is historical and was not rerun in full.
Broad audible timing, MIDI/device and accessibility acceptance, remote CI and
publication are not established by this synchronization.
