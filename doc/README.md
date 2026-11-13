# Documentation application

`doc/` is the public repository's only application. The site demonstrates the music interaction component packages through
Web Components, Headless objects, and API + UI composition. It is a consumer of
the workspace packages, not the implementation of the component library or a
complete online DAW. Website, Library, Studio and the manual acceptance runner
belong to the separate closed-source `WebMusic-studio` repository (DEC-072).

The local menu has a Doc home link on the left, section navigation in the middle,
and search and narrow-screen page navigation on the right. The current section
stays highlighted on its nested pages. Doc returns to this application's
introduction; the Website's global menu owns project navigation and GitHub.

For product direction, see [PRODUCT.md](../dev/PRODUCT.md). Development and
authoring entry points live in [dev/README.md](../dev/README.md); the repository
[documentation map](../dev/DOCUMENTATION-MAP.md) routes to the owning documents.

| Path | Workspace | Purpose |
|---|---|---|
| `doc/` | `webmusic-doc` | Documentation, examples, and API reference for the WebMusic packages: Astro pages in the site's own shell (DEC-070). |
| `doc/shared/` | — | Shared documentation catalogs and UI assets; part of the documentation application. |

Private applications consume built public package entries and read the catalogs,
references and owner-maintained media from this checkout. They do not add
application source or generated output to the public repository. The
[development workflow](../dev/DEVELOPMENT.md#private-manual-acceptance-runner)
explains how manual device acceptance uses the private runner.

## Start locally

Run from the repository root:

```bash
npm ci
npm run dev
```

`npm run dev` reuses the running docs site, or builds packages in dependency
order before starting it. Use `npm run dev:restart` after package source changes
to explicitly stop the site, rebuild and restart. The site is served
at <http://localhost:4321>. Run the install in this worktree even if another
checkout already has dependencies. If `tsup` is missing, confirm development
dependencies were installed; see [build troubleshooting](../dev/DEVELOPMENT.md#build-and-packaging-troubleshooting).
Demos resolve workspace packages through their built `dist/` files. The introduction is at `/`; `/introduction/` is a legacy content alias.

The source of every route below is under `doc/src/content/docs/`:

| URL | Content |
|---|---|
| `/` | `index.mdx` — introduction |
| `/quick-start/` | `quick-start.mdx` |
| `/agent-toolkit/…` | Agent context downloads, skills and application instructions |
| `/score/…`, `/audio/…` | The two domain families |
| `/bridge/…` | Cross-family composition |
| `/uikit/…` | Presenter overview, catalog, and reference |
| `/kernel/…` | Shared platform contracts |

The [site information architecture](../dev/docs/DOCS-SITE-PLAN.md) owns route and page
responsibilities. Page templates and exact gate coverage are linked from
[DOCS-CONVENTIONS.md](../dev/docs/DOCS-CONVENTIONS.md); current gaps belong in
[STATUS.md](../dev/STATUS.md). The [public asset inventory](ASSETS.md)
records the site files and their redistribution status.

Content and components under `doc/src/` hot-reload. Package source
changes require rebuilding the affected package and any dependent build output
before reloading. Use `npm run build` or a focused workspace build such
as `npm run build -w @webmusic/score`.

If Vite reports `504 (Outdated Optimize Dep)`, stop the server, clear its generated
cache directories (`node_modules/.vite` and
`doc/node_modules/.vite` where present), then restart. The optional
audio peers listed in [astro.config.mjs](astro.config.mjs) are stubbed in development
and externalized in production. A successful docs build does not verify those
optional runtime paths.

## Verification and production

```bash
npm run typecheck -w webmusic-doc
npm run lint
npm run check:docs
npm run docs:build
npm run pages:build
```

`docs:build` builds the packages and a normal docs site. `pages:build` builds for
the `/WebMusic/` base and checks its base-prefixed assets. These commands create
local output; they do not establish a successful deployment or npm publication.
Snippet compilation and manual browser checks have separate responsibilities;
follow the authoring conventions for the pages being changed.
