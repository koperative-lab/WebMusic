# Public demo assets

This inventory describes the files currently under `apps/doc/webmusic/public/`.
Astro copies them into the built website. A file's presence in this repository,
a working demo, or a passing code-license check does not establish permission to
redistribute the file. [DEV-05](../../../dev/STATUS.md) remains open: verify the
creator, exact source, redistribution terms, and required notices for every
unresolved asset before deploying the site or publishing a release containing it.
The five npm tarballs do not include these site media files. CI continues to
build the site for validation; deployment requires a manual dispatch on `main`
with `deploy_pages` selected after this review is complete. This does not remove
files already deployed by earlier workflow runs.

| Public path | Evidence currently available | Redistribution status |
| --- | --- | --- |
| `favicon.svg` | The original repository icon's artwork and embedded MIT notice are retained from the prior `main` inventory; see the repository [MIT license](../../../LICENSE). | Project-owned artwork with a distributed notice. |
| `audio-analysis-demo.wav` | PCM audio; no creator, generating source, or license record is retained. It is currently unreferenced by the documentation source. | Unverified. |
| `midi/Arabesque No.1.mid` | MIDI file; no creator, export source, or license record is retained. | Unverified. |
| `mxl/Arabesque No.1.mxl` | Its embedded MusicXML names Claude Achille Debussy as composer, MuseScore 3.5.2 as encoding software, an encoding date of 2020-11-07, and `https://musescore.com/user/19710/scores/55396` as source. These fields identify a possible source, not the arranger's identity or a redistribution license. | Unverified. |
| `wav/Arabesque No.1.wav` | PCM recording; no performer, recording owner, source, or license record is retained. | Unverified. |
| `mp3/Arabesque No.1.mp3` | MP3 recording; no performer, recording owner, source, or license record is retained. | Unverified. |
| `soundfont/8bit.sf2` | SoundFont bank; no reviewed creator, source, or license record is retained. | Unverified. |
| `soundfont/TR-808.sf2` | SoundFont bank; embedded text includes a HammerSound URL, but no reviewed source or redistribution terms are retained. | Unverified. |
| `soundfont/YamahaGP.sf2` | SoundFont bank; no reviewed creator, source, or license record is retained. | Unverified. |

The prior `main` branch had a generated, original **WebMusic Study No. 1** and an
`assets.json` inventory with hashes and license references. The `dev` demo
assets replaced those files and removed that generator and inventory. Neither
the former MIT designation nor the age of Debussy's composition licenses the
current score file, recording, MIDI export, or sampled instruments.

Before closing DEV-05, record the exact source and author of each file, obtain
redistribution terms covering the shipped bytes, retain required attribution and
license text in the site output, and verify the final file hashes. Replace any
file whose rights cannot be established with a documented project-owned or
properly licensed asset. The site's generated JavaScript/CSS notices are a
separate inventory and do not clear these standalone assets.

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
