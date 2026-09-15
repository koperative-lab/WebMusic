# WebMusic

Composable TypeScript building blocks for music software, interactive demos,
and web-based musical installations.

Use **Web Components** for ready-made workflows, **Headless objects** for
behavior behind your own interface, or **APIs and UI presenters** for deeper
composition. The same data and runtime contracts should support a small demo,
a custom instrument, and eventually a full online music workstation.

## First release

`main` contains Kernel, UI Kit and Score. Audio and Bridge development continues
on [`dev`](https://github.com/mrsteamedbun/WebMusic/tree/dev), including their
source, tests, documentation and demos. UI Kit remains a separate package because
Score Elements and visual renderers use its presenters.

## Packages

| Package | Responsibility |
|---|---|
| [@webmusic/score](packages/score/README.md) | Symbolic music: Score data, MIDI/MusicXML/MXL/ABC, playback, analysis, and views |
| [@webmusic/ui](packages/ui/README.md) | Domain-neutral presenters, accessible interaction, and public styling hooks |
| [@webmusic/kernel](platform/kernel/README.md) | Domain-neutral timing, lifecycle, events, worker, and interoperability contracts |

Score provides symbolic music, including sound playback. Kernel supplies neutral
timing and lifecycle contracts, and UI Kit supplies presentation. Cross-domain
coordination and shared-instance clock injection continue on `dev`. See the
[Score architecture](packages/score/ARCHITECTURE.md) and
[session-clock design boundary](platform/shared-clock-injection.md).

An online DAW and expressive musical installations are product goals, rather
than claims that project editing, undo, persistence, or collaboration already
ship here.

## Use the toolkit

The [documentation site sources](apps/doc/webmusic/src/content/docs/index.mdx)
cover Score and all integration choices. Start with
[Quick Start](apps/doc/webmusic/src/content/docs/quick-start.mdx), then
[Score](apps/doc/webmusic/src/content/docs/score/index.mdx).
The [Score component reference](apps/doc/webmusic/src/content/docs/score/element/index.mdx),
[Headless reference](apps/doc/webmusic/src/content/docs/score/headless/index.mdx) and
[UI presenter catalog](apps/doc/webmusic/src/content/docs/uikit/catalog.mdx)
link to the owning public pages. Package manifests define the available entries.

Registry and CDN examples require the requested package versions to be
available. This repository supports local workspace development; consult
[release instructions](CONTRIBUTING.md#releasing) before making claims
about remote publication.

## Develop locally

Node.js 22.19.0 or later is required for repository development. The package
runtime requirements are declared separately in each package manifest.

~~~bash
npm ci
npm run dev
~~~

The dev command builds the packages and starts the unified documentation site
at http://localhost:4321. [apps/README.md](apps/README.md) explains documentation
development and debugging.

~~~bash
npm run docs:sync       # refresh optional .dev indexes when present
npm run check           # source, docs, types, tests, package and release gates
npm run docs:build      # production documentation build
~~~

The [CI and Pages workflow](.github/workflows/ci.yml) checks every branch push
and pull request on Node 22.19.0 and 24, and builds the documentation on Node 24.
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
[CHANGELOG.md](CHANGELOG.md) for release notes. Ignored `.dev/` notes and local
agent configuration are optional; the public checkout contains the instructions
needed to build and contribute. Versions, dependencies and exports remain
authoritative in package manifests and reviewed policies.

## License

The project source is available under the [MIT License](LICENSE). Optional
engines have their own licensing and installation requirements;
the [license gate](scripts/license-gate.mjs) checks the repository's declared
restricted-package policy. Demo resources and their provenance are recorded in
the [asset inventory](apps/doc/webmusic/ASSETS.md). Dependency and asset checks
do not replace the license terms of the materials you use.
