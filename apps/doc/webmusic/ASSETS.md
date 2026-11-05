# Public demo assets

`apps/doc/webmusic/public/` is maintained by the repository owner and is fixed
input for agents and contributors: do not add, remove, rename, regenerate or
re-encode its files (see [AGENTS](../../../AGENTS.md#demo-music-arabesque-no-1-only)).
[public.sha256](public.sha256) pins the exact files and bytes the owner approved;
`npm run check:demo-music` fails when the folder differs from it. Only the owner
updates that pin, after changing the folder themselves.
Every musical demo and copyable example uses one of its **Arabesque No. 1**
files. This inventory describes the files currently present; Astro copies them
into the built website.

A file's presence in this repository, a working demo, or a passing code-license
check does not establish permission to redistribute it. [DEV-05](../../../dev/STATUS.md)
tracks the open rights review: record the creator, exact source, redistribution
terms and required notices for each file before deploying the site or publishing
a release that contains it. The npm tarballs do not include these site media.

| Public path | Use | Evidence currently available |
| --- | --- | --- |
| `mxl/Arabesque No.1.mxl` | Staff, sheet and notation-dependent analysis demos | Compressed MusicXML, one piano part on two staves, 107 measures. Its embedded MusicXML names Claude Debussy as composer, MuseScore 3.5.2 as encoding software, an encoding date of 2020-11-07 and `https://musescore.com/user/19710/scores/55396` as source. These fields identify a possible source, not the arranger or a redistribution license. |
| `midi/Arabesque No.1.mid` | Score playback, MIDI, Rack and analysis demos | Two piano parts (one per hand). Imported spelling and notation are inferred; no creator, export source or license record is retained. |
| `wav/Arabesque No.1.wav` | Decoded-audio demos | 44,100 Hz 16-bit stereo PCM recording, about 218 seconds and 37 MB. No performer, recording owner, source or license record is retained. |
| `mp3/Arabesque No.1.mp3` | Native decode and media-streaming demos | MP3 recording. No performer, recording owner, source or license record is retained. |
| `soundfont/8bit.sf2`, `soundfont/TR-808.sf2`, `soundfont/YamahaGP.sf2` | Timbre demos | SoundFont banks; no reviewed creator, source or license record is retained. |
| `favicon.svg` | Site icon | Original repository artwork with an embedded MIT notice. |

In browser URLs, percent-encode the space in the Arabesque filenames as `%20`
and prefix site demo URLs with `import.meta.env.BASE_URL` so Pages subpaths
resolve. Neither the age of Debussy's composition nor a file's availability
licenses the score export, recording or sampled instruments.

## Removed editing fixtures

`midi/Editing.mid` and `wav/Editing.wav`, the generated editing fixtures added on
2026-10-15, were removed by the owner on 2026-11-05: every demo and example uses
Arabesque No. 1, and automated tests build their own small fixtures. The dated
audits that used them keep their original descriptions.

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
