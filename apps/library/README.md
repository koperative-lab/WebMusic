# Component library

`apps/library` (workspace `webmusic-library`) is a standalone page that lists
every WebMusic Web Component by what it does, lets you search them, and
composes the ones you pick into one working page. It is for people who want to
assemble a music application from finished components instead of writing new
ones. It is not part of the documentation site and owns no component contract:
each entry links to its owning reference page.

All musical material is Arabesque No. 1, read from the documentation site's
owner-maintained [`public/`](../doc/webmusic/public/) folder. The library only
reads that folder.

## Start

From the repository root:

```bash
npm run library:dev
```

This builds the packages, then serves the library at <http://localhost:4341>.
After a package source change, rebuild with `npm run build:packages` and reload.
Reference links point at the documentation server on <http://localhost:4321> in
development and at the published site in a production build; set
`VITE_WEBMUSIC_DOCS` to point them elsewhere.

## Use

- **Browse by function.** Elements are grouped into Playback, Mixing and
  effects, Note input and recording, Sound design, Notation and piano roll,
  Waveform and spectrum, Music theory analysis, and Metering and signal
  analysis. The side list filters by group; Score and Audio narrow by family.
- **Search.** Press `/` to focus the search field. Every term must match the
  tag, its group or synonyms, its family and entry, its purpose, or one of its
  attributes, properties or events (`microphone`, `fft`, `waveform editor`,
  `webscore:chordchange`). Escape clears it.
- **Try one.** An element page mounts it on Arabesque No. 1 together with the
  player it follows, shows the code for exactly that canvas, and binds its
  observed attributes in Parameters, so the code changes as you adjust them.
  Its properties, methods and events come from the documentation catalog.
- **Compose an app.** The plus button adds an element to **Your app**. The app
  page nests every companion into the player that lends it data, state and
  time — one Score player and one Audio player at most — adds what a choice
  needs (a recorder gets a note input, a Rack part gets its desk), and shows the
  result live beside the complete page to copy. Editing views
  (`<score-grid-view>`, `<score-sheet-view>`, `<audio-clip-view>`) borrow one
  editor per family that the page loads and lends to the player, as their
  reference pages show; inside a Rack desk the score views stay read-only. The selection stays in this
  browser; **Copy link** shares it as `#/app/<tag>,<tag>`.

The copied page imports the packages by their public entries
(`@webmusic/score/play/element` and so on), so serve it through a bundler such
as Vite, and replace the Arabesque URLs with your own files.

## Sources

| Data | Owner |
|---|---|
| Tags, families, capabilities, behaviour and presenters | [`apps/doc/shared/ui-catalog.ts`](../doc/shared/ui-catalog.ts) |
| Entries, attributes, properties and events | [Parameter catalog](../doc/webmusic/src/lib/params/index.ts) |
| One-line purpose | The first sentence of each owning documentation page, read at build time by [`summaries.ts`](summaries.ts) |
| Functional group, search synonyms, define function and composition slot | [`src/recipes.ts`](src/recipes.ts), the library's only own inventory |
| Composition rules | [`src/compose.ts`](src/compose.ts); the live canvas and the copied code both come from it |

A new public element fails the library tests until it has a recipe. Tests also
check that every recipe's define function is exported by its entry and that
recipes write only observed attributes.

## Files

| Path | Contents |
|---|---|
| `src/main.ts` | Routing, catalog, element page with Parameters, and the app composer |
| `src/catalog.ts` | Library entries joined from the catalogs above |
| `src/compose.ts` | Selection → nested markup, define imports and a complete page |
| `src/elements.ts` | Loads the element entries and mounts a composition in a live canvas |
| `src/search.ts` | Weighted all-terms search |
| `src/styles.css` | Library chrome in the [visual design](../../dev/design/VISUAL-DESIGN.md) |
| `test/` | Catalog, composition and search tests (`npm test -w webmusic-library`) |

## Checks

```bash
npm run typecheck -w webmusic-library
npm test -w webmusic-library
npm run check:library
```

`npm run check:library` builds the page into the ignored `dist/` and is part of
`npm run check:source`. Live playback, audio devices and keyboard use are
browser checks; the static checks do not establish them.
