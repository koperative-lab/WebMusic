# Public demo assets

The website ships **WebMusic Study No. 1**, an original sixteen-bar exercise
owned by WebMusic Contributors and distributed under the repository's
[MIT license](../../../LICENSE). The composition, notation and procedural audio
come from [scripts/demo-assets.mjs](../../../scripts/demo-assets.mjs); no downloaded
score, recording or instrument sample contributes to these files. The notation
continues the original study retained in repository commit
`b714a004a0f604ad6717704d237cee3409ad14d1`.

[assets.json](assets.json) records exact SHA-256 hashes, authorship, source and
license references. Its identical distributed copy is
`public/licenses/DEMO_ASSETS.json`. The inventory covers six files; the seventh
public file is that inventory itself, which the checker compares byte for byte
with its source rather than requiring an impossible self hash.

| Public path | Content and provenance |
| --- | --- |
| `midi/webmusic-study-no-1.mid` | Generated format-1 MIDI: independent Upper and Lower musical tracks, channels 1 and 2, and complete MIT copyright metadata. |
| `mxl/webmusic-study-no-1.mxl` | Deterministic compressed MusicXML: one piano part, two staves, complete MIT rights, triplets, beams, cross-bar slurs, positioned rests, clef changes, dynamics, articulations, wedges and pedal marks. |
| `wav/webmusic-study-no-1.wav` | Generated 44,100 Hz, 16-bit stereo PCM from the same pitched events. Its two panned triangle-based synthesized voices use no external samples. RIFF metadata retains the title, author and complete MIT license. |
| `mp3/webmusic-study-no-1.mp3` | 128 kbps stereo libmp3lame encoding of the generated WAV. ID3v2.3 metadata retains the title, author and complete MIT license. |
| `favicon.svg` | Original repository artwork and embedded MIT notice, unchanged from the reviewed historical asset. |
| `licenses/DEMO_ASSETS_MIT.txt` | Complete repository MIT license, distributed alongside the standalone media. |

Both score formats contain the same 381 pitched events at 120 quarter notes per
minute in 4/4, over sixteen bars and exactly 32 seconds. The MXL additionally
retains notation and three rests. The WAV uses those note onsets and gate lengths;
its synthesized timbre does not model the notation's pedal and expressive marks.
The MP3 carries encoder delay/padding metadata; decoders must apply it for exact
PCM alignment. The two score formats and WAV share the authored timeline, not a
promise that every MP3 decoder reports an identical encoded-frame duration.

## Regeneration and verification

Normal validation needs Node and the installed workspace dependencies, without
FFmpeg or network access:

```sh
node scripts/demo-assets.mjs --check
node --test scripts/demo-assets.test.mjs
```

The checker regenerates MIDI, MXL, WAV and the standalone license in memory,
compares their bytes, verifies the independently pinned MP3 hash and copyright metadata,
checks both inventory copies and the generator hash, and rejects unlisted files or symbolic links under
`public/`. The icon and encoded MP3 remain tied to reviewed hashes in the generator; changing an inventory alone cannot approve replacement bytes. Refreshing a
manifest is a mechanical step and does not approve a new resource's rights.

Regenerate the original media with an installed FFmpeg that provides libmp3lame:

```sh
node scripts/demo-assets.mjs --write
node scripts/demo-assets.mjs --check
```

The current MP3 was generated with FFmpeg `7.1.5-0+deb13u1`. The complete encoder
arguments are retained in the generator. MIDI, MXL and PCM generation is
independent of FFmpeg. MP3 bytes can change across encoder versions. The writer rejects an output that differs from its reviewed hash. Review the generating source, codec metadata and audible/browser validation before explicitly updating that hash in the generator and regenerating the inventories. Neither the FFmpeg executable nor its libraries are shipped by the site.

## Replaced unresolved resources

The former Arabesque MIDI, MXL, WAV and MP3 files, the unreferenced
`audio-analysis-demo.wav`, and the three unreferenced SoundFonts (`8bit.sf2`,
`TR-808.sf2`, `YamahaGP.sf2`) were removed from the public distribution because
redistribution rights for their exact bytes could not be established. The
replacement uses new filenames and honest original-work attribution. This does
not assign a license to the removed files or retroactively clear older deployments.

The former MXL named a MuseScore source but contained no rights statement. The NES
SoundFont named The Eighth Bit and a 2009 copyright; TR-808 named Jeremy Arsenault
and Thomas Hammer with a 1997 copyright. These identify possible authors, not
redistribution permission. The other recordings and sampled piano had no reviewed
license. Historical review records retain their original baseline.

For any future public resource, record its exact author, source, redistribution
terms, distributed notices and hash before adding it to the manifest and checker.
A composition's age, a file's availability, and passing bundled-code license
checks do not establish rights to its score export, performance or instrument
samples. The five npm tarballs exclude these site media. Site deployment remains
a separate manual operation with its own release acceptance.

## Bundled code notices

The Score and Audio browser bundles use [bundle-notices.mjs](../../../scripts/bundle-notices.mjs)
to collect dependency notices from bundled source-map owners. Its output is
embedded in the generated JavaScript and emitted as
`dist/THIRD_PARTY_NOTICES.txt`.

The Astro build uses [site-notices.mjs](../../../scripts/site-notices.mjs) to
inventory bundled client code, workers, CSS and known prebundled assets. Built
site output includes `licenses/THIRD_PARTY_NOTICES.txt` and
`licenses/BUNDLED_ASSETS.json`. Each generated JavaScript/CSS file links to the
notices, and HTML includes a license link. The
[versioned supplements](../../../scripts/licenses/site/README.md) cover assets
that module discovery cannot identify on its own, including embedded Bravura
outlines and browser runtimes. Package upgrades require reviewing that boundary.

The generated-code inventory can be checked after a normal or Pages build with
`node scripts/site-notices.mjs --check`. These checks do not establish rights
for the standalone files listed above.
