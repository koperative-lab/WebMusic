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

## First release

`main` contains Kernel, UI Kit and Score. Audio and Bridge remain accepted
product and architecture directions, but their source, tests and public pages
are absent from this `main` checkout. UI Kit remains a separate package
because Score Elements and visual renderers use its presenters. See the
[product scope](dev/PRODUCT.md) and [current status](dev/STATUS.md).

## Packages

| Package | npm | Responsibility |
|---|---|---|
| [@webmusic/score](packages/score/README.md) | [![npm @webmusic/score](https://img.shields.io/npm/v/%40webmusic%2Fscore)](https://www.npmjs.com/package/@webmusic/score) | Symbolic music: Score data, MIDI/MusicXML/MXL/ABC, playback, analysis, and views |
| [@webmusic/ui](packages/ui/README.md) | [![npm @webmusic/ui](https://img.shields.io/npm/v/%40webmusic%2Fui)](https://www.npmjs.com/package/@webmusic/ui) | Domain-neutral presenters, accessible interaction, and public styling hooks |
| [@webmusic/kernel](platform/kernel/README.md) | [![npm @webmusic/kernel](https://img.shields.io/npm/v/%40webmusic%2Fkernel)](https://www.npmjs.com/package/@webmusic/kernel) | Domain-neutral timing, lifecycle, events, worker, and interoperability contracts |

Score provides symbolic music, including sound playback. Kernel supplies neutral
timing and lifecycle contracts, and UI Kit supplies presentation. Cross-domain
coordination and shared-instance clock injection remain design and implementation
work. See the
[Score architecture](packages/score/ARCHITECTURE.md) and
[session-clock design boundary](platform/shared-clock-injection.md).

An online DAW and expressive musical installations are product goals, rather
than claims that project editing, undo, persistence, or collaboration already
ship here.

## Use the toolkit

Install the packages from npm:

~~~bash
npm install @webmusic/kernel @webmusic/ui @webmusic/score
~~~

The [documentation site](https://koperative-lab.github.io/WebMusic/)
covers Score and all integration choices. Start with
[Quick Start](https://koperative-lab.github.io/WebMusic/quick-start/), then
[Score](https://koperative-lab.github.io/WebMusic/score/).
The [Score component reference](apps/doc/webmusic/src/content/docs/score/element/index.mdx),
[Headless reference](apps/doc/webmusic/src/content/docs/score/headless/index.mdx) and
[UI presenter catalog](apps/doc/webmusic/src/content/docs/uikit/catalog.mdx)
link to the owning public pages. Package manifests define the available entries.

For AI-assisted application development, see
[Agent Toolkit](apps/doc/webmusic/src/content/docs/agent-toolkit/index.mdx)
for public reference entry points, task prompts, project instructions and
the [portable WebMusic skill](skills/README.md). Documentation builds also
generate a task-oriented `llms.txt` index, full/component/pattern documentation
bundles and Markdown API references. The skill includes six lookup scripts;
the repository's [AGENTS.md](AGENTS.md) guides project work.

The npm badges above show the published package versions. Some integrations
require optional peers or external resources; follow the owning package's
installation instructions. For contributing and publishing updates, see the
[release instructions](CONTRIBUTING.md#releasing).

## Develop locally

Repository development requires Node.js 22.22.3+ on the 22.x line, 24.16.0+
on the 24.x line, or 26.3.0+. The package runtime requirements are declared
separately in each package manifest.

~~~bash
npm ci
npm run dev
~~~

The dev command builds the packages and starts the unified documentation site
at http://localhost:4321. [apps/README.md](apps/README.md) explains documentation
development and debugging.

~~~bash
npm run docs:sync       # refresh tracked dev documentation indexes
npm run check           # source, docs, types, tests, package and release gates
npm run docs:build      # production documentation build
~~~

The [CI and Pages workflow](.github/workflows/ci.yml) checks every branch push
and pull request on Node 22.22.3 and 24, and builds the documentation on Node 24.
After both jobs pass, a push to `main` in the official repository deploys the
site to [GitHub Pages](https://koperative-lab.github.io/WebMusic/). The same
workflow can be run manually from `main`; other branches, pull requests and
forks only run checks. See [Pages setup and deployment](CONTRIBUTING.md#ci-and-github-pages)
for the repository settings and how to confirm a deployment. npm publication
remains manual.

## Understand and extend the design

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, bug reports, changes,
validation and manual release instructions. The [Score architecture](packages/score/ARCHITECTURE.md),
[UI Kit contract](packages/ui/README.md) and [platform ledger](platform/README.md)
explain package boundaries and resource ownership. [apps/README.md](apps/README.md)
explains documentation development.

Use [SECURITY.md](SECURITY.md) for private vulnerability reporting and
[CHANGELOG.md](CHANGELOG.md) for release notes. The maintained
[development guide](dev/README.md) and [AGENTS.md](AGENTS.md) are part of this
checkout. Versions, dependencies and exports remain
authoritative in package manifests and reviewed policies.

## License

The project source is available under the [MIT License](LICENSE). Optional
engines have their own licensing and installation requirements;
the [license gate](scripts/license-gate.mjs) checks the repository's declared
restricted-package policy. Demo resources and their provenance are recorded in
the [asset inventory](apps/doc/webmusic/ASSETS.md). Dependency and asset checks
do not replace the license terms of the materials you use.
