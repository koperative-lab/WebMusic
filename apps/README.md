# apps/

This directory contains the WebMusic documentation application and its shared
assets. The site demonstrates the music interaction component packages through
Web Components, Headless objects, and API + UI composition. It is a consumer of
the workspace packages, not the implementation of the component library or a
complete online DAW.

Start with the [project overview](../README.md) and
[contribution guide](../CONTRIBUTING.md) for setup, authoring and verification.
The public documentation entry point is [the introduction](doc/webmusic/src/content/docs/index.mdx).
The [asset inventory](doc/webmusic/ASSETS.md) records demo resources, ownership
and license notices; review it before adding or replacing music or sound banks.

| Path | Workspace | Purpose |
|---|---|---|
| `doc/webmusic` | `webmusic-doc` | Astro Starlight documentation, examples, and API reference for the WebMusic packages. |
| `doc/shared` | — | Shared documentation catalogs and UI assets; not a workspace. |

## Start locally

Run from the repository root:

```bash
npm ci
npm run dev
```

`npm run dev` builds the packages in dependency order before starting the docs
at <http://localhost:4321>. Demos resolve workspace packages through their built
`dist/` files. Both `/` and `/introduction/` render the introduction.

Each documentation page shows breadcrumbs above its title. The shared
[page heading](doc/webmusic/src/starlight/PageTitle.astro) preserves Starlight's
title and adds links to the page's section, integration form and capability.
The [hero override](doc/webmusic/src/starlight/Hero.astro) provides the same
navigation for the 404 page and pages that use a hero.
Groups without their own page link to the corresponding inventory section.
The [route resolver](doc/webmusic/src/starlight/breadcrumbs.ts) respects the
configured deployment base; the current page is plain text.
Score's Web Components and Headless menu groups each start with an Overview
link to their inventory, followed by Play, Analyze and View.

The source of every route below is under `doc/webmusic/src/content/docs/`:

| URL | Content |
|---|---|
| `/` | `index.mdx` — introduction |
| `/quick-start/` | `quick-start.mdx` |
| `/agent-toolkit/…` | AI-assisted application development: overview, context downloads, Skills, AGENTS.md and CLAUDE.md |
| `/score/…` | Symbolic music |
| `/uikit/…` | Presenter overview, catalog, and reference |
| `/kernel/…` | Shared platform contracts |

The [Astro configuration](doc/webmusic/astro.config.mjs) owns navigation and
build integration; the owning MDX pages define each public route's content.
Follow the [documentation contribution instructions](../CONTRIBUTING.md#documentation)
and the existing page for the component or API being changed.

Content and components under `apps/doc/webmusic/src/` hot-reload. Package source
changes require rebuilding the affected package and any dependent build output
before reloading. Use `npm run build:packages` or a focused workspace build such
as `npm run build -w @webmusic/score`.

If Vite reports `504 (Outdated Optimize Dep)`, stop the server, clear its generated
cache directories (`node_modules/.vite` and
`apps/doc/webmusic/node_modules/.vite` where present), then restart.
Audio and Bridge documentation and their optional-engine configuration remain
on `dev`. A successful docs build does not verify optional runtime paths.

## Verification and production

```bash
npm run typecheck -w webmusic-doc
npm run lint -w webmusic-doc
npm run check:docs
npm run docs:build
npm run pages:build
```

`docs:build` builds the packages and a normal docs site. `pages:build` builds for
the `/WebMusic/` base and checks its base-prefixed assets. These commands create
local output; they do not establish a successful deployment or npm publication.
Snippet compilation and manual browser checks have separate responsibilities;
follow the contribution instructions for the pages being changed.

The [CI and Pages workflow](../.github/workflows/ci.yml) runs this Pages build
on every branch push, pull request and manual dispatch. In the official
`koperative-lab/WebMusic` repository, a `main` push or manual run from `main`
deploys `doc/webmusic/dist/` after the documentation build and both Node quality
checks pass. The configured URL is
[koperative-lab.github.io/WebMusic](https://koperative-lab.github.io/WebMusic/).
Follow [Pages setup and deployment](../CONTRIBUTING.md#ci-and-github-pages) for
initial repository settings and remote verification. Keep the generated
`licenses/` directory with the deployed output. Other branches, pull requests
and forks do not deploy.

Documentation search uses the site's own `search-index.json`, generated from
rendered public article titles and text during the build. It keeps queries in
the browser, supports title and multi-word matching, and respects the deployment
base. Search is available in the built site and `npm run preview -w webmusic-doc`;
the development server displays a build-and-preview reminder. The Search
override and local index integration replace Pagefind's browser output.

Agent Toolkit context is available in both the development server and built
site. The [generator](doc/webmusic/scripts/agent-context.mjs) emits a task index
(`llms.txt`), full/component/pattern bundles (`llms-full.txt`,
`llms-components.txt`, `llms-patterns.txt`), per-page Markdown under
`agent-context/`, and a manifest with release and content identity. It also
provides the catalog, selected source and styling text used by the portable
skill's lookup scripts. It preserves documentation examples and applies the configured site
base to generated links. A [Markdown link plugin](doc/webmusic/scripts/docs-base-links.mjs)
also applies the base while rendering article links in development and builds;
the Pages postprocessor still covers component-emitted HTML targets.
The public [consumer skill](../skills/README.md) can
be copied independently of this repository. The AGENTS.md / CLAUDE.md
documentation page provides instructions to copy into an application directly.
