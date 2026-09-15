# Documentation-site license supplements

[site-notices.mjs](../../site-notices.mjs) reads installed package LICENSE and
NOTICE files for actual client/worker modules and CSS. These records cover
boundaries a module graph cannot reveal: prebundled code, converted font data,
and published archives missing their declared license text. Builds do not
request license texts over the network.

Astro's prerender environment emits public CSS, and its client build can inline
small scripts into HTML. The collector retains those owners before inlining.
Expressive Code emits `ec.*` assets from templates outside `chunk.modules`; their
notices follow the installed renderer's resolution chain to the core, frames,
text-markers and Shiki plugins. This is a specific generated-asset boundary,
not a list of every server-side build dependency.

## Font and prebundled-code records

| Record | Evidence and treatment |
| --- | --- |
| [VexFlow 4.2.5](vexflow-4.2.5.json) | The [fixed upstream instructions](https://github.com/0xfe/vexflow/tree/4.2.5/tools/fonts) convert Bravura 1.392 into JavaScript outline data. The [Bravura OFL](bravura-1.392-OFL.txt) retains the 2019 Steinberg copyright. The bravura entry also imports PetalumaScript text metrics; the [Petaluma OFL](petaluma-OFL.txt) accompanies those metrics without claiming that its outline font is bundled. Installed font modules are fingerprinted. |
| [OpenSheetMusicDisplay 1.9.9](opensheetmusicdisplay-1.9.9.json) | The official [release source map](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/releases/download/1.9.9/opensheetmusicdisplay.min.js.map) identifies JSZip, loglevel, TypeScript Collections and patched VexFlow. Release JavaScript and the npm artifact match byte-for-byte after removing the final sourceMappingURL comment. The JSON retains both hashes and the map's npm-source list. Its [bundled notices](opensheetmusicdisplay-1.9.9-bundled.txt) include those packages, source copyright statements, and immediate/lie/pako/setimmediate nested inside JSZip. The readable-stream entry is an external placeholder, so Node stream dependencies are not listed as bundled. The MIT option is selected for JSZip; pako's zlib source notice is retained. |
| [static-browser-server 1.0.3](static-browser-server-1.0.3.json) | Its unminified esbuild artifact identifies embedded `mime-db@1.52.0` modules. The [upstream MIT license](mime-db-1.52.0-MIT.txt) is preserved separately from the server's Apache license. Artifact hashes prevent a later internal bundle from silently reusing this review. |
| [SpessaSynth Core 4.3.20](spessasynth_core-4.3.20.json) | The installed source map's fflate input is byte-identical to the npm gitHead's vendored source. Its [2023 MIT notice](spessasynth-core-fflate-MIT.txt) is separate from the newer installed fflate package. The map explicitly identifies adapted MeltySynth filter code and DattorroReverbNode, accompanied by their [MIT](meltysynth-MIT.txt) and [public-domain](dattorro-reverb-LICENSE.txt) notices. Both the JavaScript and map are fingerprinted. |
| [stb-vorbis 0.0.6](stb-vorbis-0.0.6.json) | The npm artifact embeds an 83,506-byte WASM decoder. The package's fixed source commit and release workflow identify stb_vorbis 1.22 and Emscripten 6.0.6. Complete upstream stb, Emscripten, musl, compiler-rt and per-file C runtime notices are preserved. The reviewed runtime notice set conservatively includes code that optimization may remove; individual linked functions were not reconstructed. C++ libraries and compiler frontend tools are excluded. Package/WASM hashes and provenance-inspection limits are recorded. |

[Gonville's upstream license](gonville-LICENSE.txt) distinguishes unrestricted
generated font output from its MIT-licensed generator source. The generated
VexFlow-18 font inherited by OSMD is documented without claiming a new
restriction on Gonville font output.

## Missing license files

[missing-licenses.json](missing-licenses.json) requires exact package versions,
declared licenses, upstream repositories and artifact hashes. Replacement texts
also have SHA-256 records. Missing or changed records fail generation.

| Package | Source of the preserved text |
| --- | --- |
| `@stitches/core@1.2.8` | [LICENSE.md at the v1.2.8 commit](https://github.com/stitchesjs/stitches/blob/c268db3938e2cf6bdbaa3d30f3ce7b67c0492a41/LICENSE.md), retaining the 2020 Modulz copyright. The npm archive omits this file. |
| `static-browser-server@1.0.3` | Its installed manifest and [upstream repository](https://github.com/codesandbox/static-browser-server) designate Apache-2.0 but omit LICENSE. The [unmodified ASF text](https://www.apache.org/licenses/LICENSE-2.0.txt) is provided; no copyright holder or year is invented. The original package contains no NOTICE file. |
| `intersection-observer@0.10.0` | Its source header supplies the 2016 Google copyright and links to the [W3C 2015 license](https://www.w3.org/copyright/software-license-2015/). The snapshot retains the header and full official notice, and identifies the site's bundling/minification step. |

The [entities snapshot](../README.md) is also reused when that package appears
in a site bundle.

## Updating a dependency

Only explicitly reviewed site license identifiers pass the ordinary-package
gate. An unknown identifier requires review against the site's distribution
policy; a license text alone does not establish suitability. Sandpack's optional
Nodebox runtime has a Sustainable Use License and is excluded. The docs Vite
configuration replaces only its exact package import with a project-owned
unsupported-runtime adapter. Browser/Parcel templates continue to use Sandpack's
browser implementation; requesting a Node server template reports a clear error.
Both real Nodebox code and unexpected license identifiers are regression-tested
to fail the collector.

For prebundled dependencies, examine actual source maps, module markers and
upstream sources before replacing a record. Record input hashes and verify
notices within vendored subcomponents. Matching the outer package's SPDX field
alone is insufficient. Preserve license texts verbatim, retain additional source
copyright statements, and record any choice between alternative licenses.

Run `node --test scripts/site-notices.test.mjs`, build the site, and run
`node scripts/site-notices.mjs --check`. The real-bundle regression covers React,
Sandpack, VexFlow, OSMD, SpessaSynth and the missing-license repairs above. A synthetic build
exercises CSS, workers, unused imports and missing notices. A real Astro build
covers client/prerender environments, inline and lazy scripts, extracted CSS,
Expressive Code assets and compact redirect documents. Pagefind output is
deliberately rejected; the site uses its own search client and generated index.
