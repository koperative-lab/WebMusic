# @webscore/view

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current view API reference](../../../apps/doc/webmusic/src/content/docs/score/api/view.mdx); [Current view Web Components](../../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#view); [Current view Headless reference](../../../apps/doc/webmusic/src/content/docs/score/headless/index.mdx#view).
> See the [archive index](README.md) for scope, the
> [contribution guide](../../../CONTRIBUTING.md) for setup and validation, and
> [Score architecture](../ARCHITECTURE.md) for current package boundaries.

<!-- docs:historical-body -->

---

The **visualization** package for WebScore. It turns immutable `Score` objects
from [`@webscore/core`](../core) into layout data and visual renderings —
**staff**, **piano roll**, and **waterfall** — and ships the drop-in view Web
Component `<score-view>` (one tag, three views via the `type` attribute).

It is purely visual: **playback lives in [`@webscore/play`](../play)**. A view
renders a `Score` and highlights whichever note is currently sounding — drive
that highlight by binding a `<score-player>` (`player="#id"`) or by
calling `redraw` yourself.

```bash
npm install @webscore/view   # @webscore/core and staffrender come along
```

> **Note:** not yet published to npm — clone the monorepo and use the workspace
> packages locally until then.

Optional peers: `@webscore/io` (used by the Web Components to load a `src`
file) and `opensheetmusicdisplay` (required only for OSMD staff engraving).
Playback sync is event-based and does not add a package dependency.

## API surface

`@webscore/view` is split across four clear entry points:

- **`@webscore/view/api`** — the stateless **API** (data in / data out): layout
  functions (`createStaffLayout` / `createPianoRollLayout` /
  `createWaterfallLayout`) that return plain geometry, note-sequence helpers
  (`scoreToNoteSequence` / `findSequenceNote` / `secondsToQuarters`), and all
  type-only exports. No DOM, no engine state.
- **`@webscore/view/headless`** — the code-only `createScoreView` component.
  It tracks the current time, active notes, view mode and visible time window,
  returning immutable plain-data snapshots for any caller-owned renderer. It
  never creates an element/canvas, accesses the DOM, or applies visual styles.
- **`@webscore/view/render`** — the explicit imperative browser-rendering
  compatibility surface: `renderStaffVisualizer`,
  `renderPianoRollVisualizer`, `renderWaterfallVisualizer`,
  `renderOSMDStaffVisualizer`, `ScrollType`, and `bindPlayerToVisualizer`.
  These APIs intentionally own DOM/canvas/SVG work.
- **`@webscore/view/element`** — **Web Components**: the consolidated
  `<score-view>` element, registered with `defineScoreViewElement()`.

Internally, browser rendering is split by responsibility under `src/render/renderers`:
`base.ts` owns sizing and lifecycle, `svg.ts` owns SVG virtualization,
`piano-roll.ts`, `waterfall.ts`, and `staff.ts` own view-specific DOM work,
and `factory.ts` converts a `Score` and returns the public renderer handle.

```ts
// Pure layout data (root, no DOM) — feed your own renderer
import {createPianoRollLayout, scoreToNoteSequence} from '@webscore/view/api';
const layout = createPianoRollLayout(score, {pixelsPerSecond: 30, laneHeight: 6});
const sequence = scoreToNoteSequence(score);

// Stateful behavior with no UI or DOM
import {createScoreView} from '@webscore/view/headless';
const view = createScoreView(score, {type: 'piano-roll'});
view.setViewport(0, 8);
view.noteOn(60, 0);
console.log(view.state.activeNotes, view.state.visibleNotes);

// Or explicitly opt into WebScore's browser renderer
import {renderPianoRollVisualizer} from '@webscore/view/render';
const viz = renderPianoRollVisualizer(score, svg, {pixelsPerSecond: 30, noteHeight: 6});
viz.redraw(sequence.notes[0]); // highlight one currently-sounding sequence note
viz.clearActiveNotes();
```

`scoreToNoteSequence` / `findSequenceNote` convert a `Score` into a flat,
render-friendly note sequence; `renderOSMDStaffVisualizer` engraves through the
optional `opensheetmusicdisplay` peer.

## Web Components

Custom elements ship from the `/element` subpath so the main entry stays
DOM-free. Registration is explicit:

The root still forwards `/api`; `/render` preserves the historical imperative
renderer surface; and `/elements` aliases `/element` for existing consumers.

```ts
import {defineScoreViewElement} from '@webscore/view/element';
defineScoreViewElement(); // <score-view>
```

```html
<score-player id="p" src="song.mid"></score-player>
<score-view src="song.mid" player="#p"></score-view>
<score-view type="staff" src="song.musicxml" player="#p"></score-view>
<score-view type="waterfall" src="song.mid" player="#p"></score-view>
```

One element, three views: the `type` attribute selects `piano-roll` (default),
`staff` or `waterfall`; switching it at runtime disposes the old visualizer and
re-renders. The element loads its `src` file through the optional
`@webscore/io` peer, or takes an already-loaded `Score` via the `.score`
property. Put a player above it and bind with `player="#id"` to follow playback
progress. `defineScoreViewElement(tag?)` supports custom tag names.

Every visual knob is customizable per instance via attributes (or the
camelCase `.options` property, which wins): `width` / `height` (element size),
`note-height` / `note-spacing` / `pixels-per-second` (note geometry and zoom),
`min-pitch` / `max-pitch` / `show-only-octaves-used` (pitch / piano display
range), `white-note-width` / `white-note-height` / `black-note-width` /
`black-note-height` (waterfall keyboard geometry), `note-color` /
`active-note-color` (hex, `rgb()` or `r, g, b`), and `default-key` /
`scroll-type` for the staff. Numeric attributes are NaN-safe.

## Documentation

Full API docs live in the monorepo's documentation site
([`apps/doc/webmusic-score`](../../../apps/doc/webmusic-score), `npm run docs:dev:score`) — see the **View API** page.

## License

MIT
