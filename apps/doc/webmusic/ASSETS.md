# Public demo assets

[assets.json](assets.json) records every public asset's author, source, SPDX
license, repository-relative license file, and SHA-256. This source inventory
stays outside `public/`; it is not copied to the website. The unused local font
and the former static `public/licenses/` directory have been removed.

## Original music

The XML, MXL and MIDI `demo` files contain **WebMusic Study No. 1**, an original
sixteen-bar, two-staff arpeggio exercise authored for this repository. Its exact
notes, timing and notation are defined in
[scripts/demo-assets.mjs](../../../scripts/demo-assets.mjs). It contains triplets,
beams, slurs crossing bar lines, positioned rests, clef changes, dynamics,
articulations, wedges and pedal marks so the notation/import demonstrations and
regressions exercise real musical structure. The XML and MXL retain identical
notation; the MIDI represents their pitched notes and constant tempo, not the
notation or pedal/dynamic expression.

Regenerate the three formats and refresh reviewed asset hashes with:

```sh
node scripts/demo-assets.mjs --write
```

Verify deterministic generation, asset hashes and accompanying licenses with:

```sh
node scripts/demo-assets.mjs --check
```

The block-chord exercise and SVG favicon are original repository assets. The
grid-input demo uses the toolkit's oscillator synthesis, with no downloaded
instrument samples. These originals are distributed under the repository's
[MIT license](../../../LICENSE). Downloadable XML, MXL and MIDI files embed the
complete license in their rights or copyright metadata; the SVG embeds it in
metadata. They do not depend on a separate static license download.

## Adding or replacing resources

Record the exact source, creator and redistribution license before placing a
resource in `public/`. Add its manifest record, naming its reviewed license file
relative to the repository root. Include required copyright, attribution and
license text in the distributed resource or generated site notices. Hash refresh
is a mechanical update, not a license approval. Do not infer a SoundFont's license from
its availability online or a score file's permission from the age of its composer.

The earlier third-party SoundFonts, Megalovania MIDI and downloaded Debussy score
were removed from the public tree because this checkout did not establish their
redistribution permissions. Their old filenames are not aliases for newly claimed
licenses. The stable `demo.xml`, `demo.mxl` and `demo.mid` URLs now serve the
original exercise above. Historical notation review records describe their own
earlier fixtures and are not acceptance claims for these replacements.

## JavaScript bundles

### npm browser bundle

The published Score IIFE's separate dependency licenses are generated from actual
bundled source-map owners by [bundle-notices.mjs](../../../scripts/bundle-notices.mjs).
The full notices are embedded after the generated JavaScript and also emitted as
`dist/THIRD_PARTY_NOTICES.txt`. Appending the comments preserves the original
generated-code offsets; the existing source map is not rewritten. Any dependency
whose installed package omits its license fails generation unless its exact
version has a [reviewed upstream snapshot](../../../scripts/licenses/README.md).

### Documentation website

The standard Astro build runs [site-notices.mjs](../../../scripts/site-notices.mjs)
after the other site integrations. It records actual client and worker module
graphs before scripts are inlined, includes prerendered CSS owners, and adds the Astro/Starlight producers
of HTML and inline scripts. Server-only dependencies and unused imports do not
become browser bundle owners.

Expressive Code's generated script/style templates carry their own MIT notices.
Sandpack examples use browser templates; the optional Nodebox server runtime is
excluded from this site because its Sustainable Use License has redistribution
restrictions. A docs-only adapter reports unsupported Node templates explicitly.

The built site includes `licenses/THIRD_PARTY_NOTICES.txt` with complete license
texts and `licenses/BUNDLED_ASSETS.json` with module and output inventories.
Each generated JavaScript/CSS file links to the notices in a trailing comment;
HTML includes a `rel="license"` link. Relative links work at both `/` and the
Pages base. Comments are appended without moving source-map offsets. The build
fails if code was not captured, a license is missing, or a reviewed prebundled
dependency changes.

Bravura outlines are embedded by VexFlow even though they are not a separate
file in `public/`. Their Steinberg copyright and OFL remain separate from
VexFlow's MIT license. OpenSheetMusicDisplay and Sandpack's static browser server
also contain dependencies that cannot be discovered as separate Vite modules.
[Versioned supplements](../../../scripts/licenses/site/README.md) record sources,
artifact hashes, complete notices and missing upstream license-file repairs.
Package upgrades require reviewing these boundaries.

Search uses the repository's own browser client and a JSON index of built
documentation. Pagefind output is rejected: its npm MIT declaration does not
describe all dependencies in its generated WebAssembly. No Pagefind runtime
or WebAssembly is shipped by the site.

Check production output after building or applying the Pages prefix:

```sh
node scripts/site-notices.mjs --check
```

The generator's regression suite uses real Vite builds, including workers,
CSS, React, Sandpack, VexFlow and OpenSheetMusicDisplay:

```sh
node --test scripts/site-notices.test.mjs
```
