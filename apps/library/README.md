# Component library

`apps/library` (workspace `webmusic-library`) is a standalone page that lists
every WebMusic Web Component by what it looks like and what it does, lets you
search them, and opens a live demo of each with the code to use it. It is for
people who want to assemble a music application from finished components
instead of writing new ones. It is not part of the documentation site and owns no component contract:
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
  gets a card exactly that wide. An element that stretches (a transport, a
  staff, a lane, a waveform) has a least width and a preferred one, half again
  as wide, and is pictured at whatever width packing gives it. Only a picture
  wider than the window is scaled down. A picture is never taken while the
  element still shows a loading, waiting or error status: it waits, and a card
  whose element never finishes shows a hatched frame instead.
- **Order.** Score and Audio are separate segments, Score first. In each,
  cards follow the composition tree depth-first: each player is followed by
  what attaches to it (a desk and its part, a note input and its recorder,
  views, analysis, meters). A skyline packs the cards a gap apart. Each step
  looks at the next three cards and places the one that sits highest, so a
  small card takes the hole beside a wide one while the order stays close to
  the tree. A stretching card takes its preferred width when the next card still
  fits beside it, and the rest of the row only when what would be left is too
  narrow — so rows close up without every stretching card running full width.
- **Filter.** All, Score or Audio at the top; press `/` to search. Every term
  must match the tag, its category or synonyms, its family and entry, its
  purpose, or one of its attributes, properties or events (`microphone`, `fft`,
  `waveform editor`, `webscore:chordchange`). A card's tag filters by that
  category; the filter shows in the bar until cleared.
- **An element's page** is the demo and nothing else: the element with the
  player that lends it data, state and time (a recorder with its note input),
  the code for exactly that canvas, and its observed attributes in Parameters —
  the code changes as you adjust them. Editing views (`<score-grid-view>`,
  `<score-sheet-view>`, `<audio-clip-view>`) borrow an editor the page loads and
  lends to the player, as their reference pages show; Score analysis links to
  its player with `input` (see STATUS LIB-01).

The code imports the packages by their public entries
(`@webmusic/score/play/element` and so on), so use it through a bundler such
as Vite, and replace the Arabesque URLs with your own files.

## Sources

| Data | Owner |
|---|---|
| Tags, families, capabilities, behaviour and presenters | [`apps/doc/shared/ui-catalog.ts`](../doc/shared/ui-catalog.ts) |
| Entries, attributes, properties and events | [Parameter catalog](../doc/webmusic/src/lib/params/index.ts) |
| One-line purpose | The first sentence of each owning documentation page, read at build time by [`summaries.ts`](summaries.ts) |
| Functional group and card tag, card sizing (own width or stretch) with first-layout estimates, search synonyms, define function and composition slot | [`src/recipes.ts`](src/recipes.ts), the library's only own inventory |
| Composition rules | [`src/compose.ts`](src/compose.ts); the live canvas, its code and each picture's composition come from it |

A new public element fails the library tests until it has a recipe. Tests also
check that every recipe's define function is exported by its entry and that
recipes write only observed attributes.

## Files

| Path | Contents |
|---|---|
| `src/main.ts` | Routing, the vertical reel of still cards and the element page with Parameters |
| `render.html`, `src/render.ts` | The background frame that draws one element at a time for its picture |
| `src/snapshot.ts` | An element as a self-contained SVG picture |
| `src/pictures.ts` | The drawing queue and the per-build IndexedDB store of pictures |
| `src/layout.ts` | Topological order, skyline packing at exact card sizes, widening stretch cards, and how a card fits its picture |
| `src/catalog.ts` | Library entries joined from the catalogs above |
| `src/compose.ts` | Elements → nested markup, define imports and editors, and the code snippet |
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
