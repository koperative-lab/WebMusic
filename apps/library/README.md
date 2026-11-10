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

- **The reel.** The home page is a white wall of cards that scrolls
  vertically. A card shows the element's name, its category tag and a still
  picture of the element alone — not the player, input or desk that feeds it in
  a composition — with no controls, playback or interaction; click it to open
  the element's page, where the live demo is. Hovering a card only outlines it.
- **Pictures, not live elements.** The home page mounts no element. A hidden
  background frame ([`render.html`](render.html), [`src/render.ts`](src/render.ts))
  mounts one element at a time with the packages' own code on Arabesque No. 1,
  waits for it to settle and turns it into a self-contained SVG
  ([`src/snapshot.ts`](src/snapshot.ts)): its composed tree with shadow roots
  flattened, every computed style inline, canvases as images and scroll offsets
  kept. Cards near the screen are drawn first. Pictures are kept in IndexedDB
  per build ([`src/pictures.ts`](src/pictures.ts)); the key changes when a
  package is rebuilt or the drawing code changes (restart the dev server after
  either), so later visits show every card at once without drawing. An insert
  is pictured by the panel on its parameters, and a Rack part by its desk.
- **Cards fit their pictures.** Every card is exactly as tall as its picture.
  An element with a width of its own (faders, knobs, keys, a scope, a meter)
  gets a card exactly that wide; an element that stretches (a transport, a
  staff, a lane, a waveform) has a least width, takes the free span where it
  lands and is pictured at that width. Only a picture wider than the window is
  scaled down.
- **Order.** Score and Audio are separate segments, Score first. In each,
  cards follow the composition tree depth-first: each player is followed by
  what attaches to it (a desk and its part, a note input and its recorder,
  views, analysis, meters). A skyline packs the cards a gap apart, each into
  the highest free spot where it fits; a stretching card then fills the row
  beside it, so cards of different sizes close up.
- **Filter.** All, Score or Audio at the top; press `/` to search. Every term
  must match the tag, its category or synonyms, its family and entry, its
  purpose, or one of its attributes, properties or events (`microphone`, `fft`,
  `waveform editor`, `webscore:chordchange`). A card's tag filters by that
  category; the filter shows in the bar until cleared.
- **An element's page** is the demo and nothing else: the element with its
  player's transport, the code for exactly that canvas, its observed
  attributes in Parameters (the code changes as you adjust them), and the plus
  button that adds it to **Your app**. A card in your app carries a check mark.
- **Compose an app.** The app page nests every companion into the player that
  lends it data, state and time — one Score player and one Audio player at
  most — adds what a choice needs (a recorder gets a note input, a Rack part
  gets its desk, an insert gets a panel on its parameters), and shows the
  result live beside the complete page to copy. Editing views
  (`<score-grid-view>`, `<score-sheet-view>`, `<audio-clip-view>`) borrow one
  editor per family that the page loads and lends to the player, as their
  reference pages show; inside a Rack desk the score views stay read-only.
  Score analysis links to its player with `input` (see STATUS LIB-01). The
  selection stays in this browser; the link icon shares it as
  `#/app/<tag>,<tag>`.

The copied page imports the packages by their public entries
(`@webmusic/score/play/element` and so on), so serve it through a bundler such
as Vite, and replace the Arabesque URLs with your own files.

## Sources

| Data | Owner |
|---|---|
| Tags, families, capabilities, behaviour and presenters | [`apps/doc/shared/ui-catalog.ts`](../doc/shared/ui-catalog.ts) |
| Entries, attributes, properties and events | [Parameter catalog](../doc/webmusic/src/lib/params/index.ts) |
| One-line purpose | The first sentence of each owning documentation page, read at build time by [`summaries.ts`](summaries.ts) |
| Functional group and card tag, card sizing (own width or stretch) with first-layout estimates, search synonyms, define function and composition slot | [`src/recipes.ts`](src/recipes.ts), the library's only own inventory |
| Composition rules | [`src/compose.ts`](src/compose.ts); the live canvas and the copied code both come from it |

A new public element fails the library tests until it has a recipe. Tests also
check that every recipe's define function is exported by its entry and that
recipes write only observed attributes.

## Files

| Path | Contents |
|---|---|
| `src/main.ts` | Routing, the vertical reel of still cards, element page with Parameters, and the app composer |
| `render.html`, `src/render.ts` | The background frame that draws one element at a time for its picture |
| `src/snapshot.ts` | An element as a self-contained SVG picture |
| `src/pictures.ts` | The drawing queue and the per-build IndexedDB store of pictures |
| `src/layout.ts` | Topological order, skyline packing at exact card sizes, widening stretch cards, and how a card fits its picture |
| `src/catalog.ts` | Library entries joined from the catalogs above |
| `src/compose.ts` | Selection → nested markup, define imports and a complete page |
| `src/elements.ts` | Loads the element entries and mounts a composition in a live canvas |
| `src/search.ts` | Weighted all-terms search |
| `src/styles.css` | Library chrome in the [visual design](../../dev/design/VISUAL-DESIGN.md) |
| `test/` | Catalog, composition, layout, picture and search tests (`npm test -w webmusic-library`) |

## Checks

```bash
npm run typecheck -w webmusic-library
npm test -w webmusic-library
npm run check:library
```

`npm run check:library` builds the page into the ignored `dist/` and is part of
`npm run check:source`. Live playback, audio devices, keyboard use and how the
reel looks are browser checks; the static checks do not establish them.
