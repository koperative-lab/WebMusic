# WebMusic

[![CI and Pages](https://github.com/koperative-lab/WebMusic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/koperative-lab/WebMusic/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/docs-website-blue)](https://koperative-lab.github.io/WebMusic/)
[![License](https://img.shields.io/github/license/koperative-lab/WebMusic)](LICENSE)

Composable TypeScript building blocks for music software, interactive demos,
and web-based musical installations.

Use **Web Components** for ready-made workflows, **Headless objects** for
behavior behind your own interface, or **APIs and UI presenters** for deeper
composition. The same data and runtime contracts should support a small demo,
a custom instrument, and eventually a full online music workstation.

The source tree contains five package workspaces. Kernel, UI Kit and Score have
an earlier published release; source integration of Audio and Bridge does not
establish npm availability. Current gaps and verification belong in
[implementation status](dev/STATUS.md).

## Packages

| Package | Responsibility |
|---|---|
| [@webmusic/score](packages/score/README.md) | Symbolic music: Score data, MIDI/MusicXML/MXL/ABC, playback, analysis, and views |
| [@webmusic/audio](packages/audio/README.md) | Digital audio: clips, decoding, playback, mixing, recording, analysis, and views |
| [@webmusic/bridge](bridges/score-audio/README.md) | Cross-domain synchronization, time mapping, score rendering, and transcription-result assembly |
| [@webmusic/ui](packages/ui/README.md) | Domain-neutral presenters, accessible interaction, and public styling hooks |
| [@webmusic/kernel](platform/kernel/README.md) | Domain-neutral timing, lifecycle, events, worker, and interoperability contracts |

Score and Audio retain independent models. Participants performing together
follow a session time authority, with explicit mappings between musical
positions and audio time. The current implementation coordinates separate
transport clocks through kernel contracts and Bridge; shared-instance clock
injection remains further work. See [architecture](dev/ARCHITECTURE.md) and
[current status](dev/STATUS.md).

An online DAW and expressive musical installations are product goals, rather
than claims that project editing, undo, persistence, or collaboration already
ship here. [Product definition](dev/PRODUCT.md) explains the intended scope.

## Use the toolkit

The [documentation site sources](apps/doc/webmusic/src/content/docs/index.mdx)
cover both families and all integration choices. Start with
[Quick Start](apps/doc/webmusic/src/content/docs/quick-start.mdx), then
[Score](apps/doc/webmusic/src/content/docs/score/index.mdx) or
[Audio](apps/doc/webmusic/src/content/docs/audio/index.mdx).
The [component index](dev/COMPONENTS.md) links every reviewed tag, presenter,
Headless reference owner, and manifest entry.

Registry and CDN examples require the requested package versions to be
available. This repository supports local workspace development; consult
[PUBLISHING.md](dev/release/PUBLISHING.md) before making claims about remote publication.

## Develop locally

Use the Node.js range declared in [package.json](package.json). Node 24.21.0 is suitable; see
[checkout setup](dev/DEVELOPMENT.md#prepare-and-inspect-the-checkout).

~~~bash
npm ci
npm run dev
~~~

The dev command builds the packages and starts the unified documentation site
at http://localhost:4321. Each Git worktree needs its own `npm ci`; a sibling
checkout's dependencies do not install build tools here. [apps/README.md](apps/README.md)
explains documentation development and debugging.

~~~bash
npm run docs:sync       # refresh derived component/document inventories
npm run check           # source, docs, types, tests, package and release gates
npm run docs:build      # production documentation build
~~~

## Understand and extend the design

Start at [dev/README.md](dev/README.md) for the documentation ownership map:
[product](dev/PRODUCT.md), [design principles](dev/DESIGN-PRINCIPLES.md),
[accepted decisions](dev/DECISIONS.md), [architecture](dev/ARCHITECTURE.md),
[component design template](dev/design/COMPONENT-DESIGN.md), and
[development workflow](dev/DEVELOPMENT.md).

Repository-wide guidance is grouped into [component design](dev/design/README.md),
[documentation authoring](dev/docs/README.md) and [release operations](dev/release/README.md).
Agents use [AGENTS.md](AGENTS.md) for task routing and repository guidance.

The [repository documentation map](dev/DOCUMENTATION-MAP.md) separates current
contracts, user reference, operational guides, and historical evidence.
Versions, dependencies, and exports remain authoritative in package manifests
and reviewed policies, not copied prose inventories.

## License

The project source is available under the [MIT License](LICENSE). Optional
engines have their own licensing and installation requirements;
the [license gate](scripts/license-gate.mjs) checks the repository's declared
restricted-package policy. It is not a comprehensive legal audit.
