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
| `midi/Editing.mid` | Original programmatically generated WebMusic editing fixture, added 2026-10-15; reproducible contents and hash below. | Project-owned fixture under the repository [MIT license](../../../LICENSE). |
| `musicxml/StaffEditing.musicxml` | Original WebMusic two-measure staff-input fixture, added 2026-10-15; source contents and hash below. | Project-owned fixture under the repository [MIT license](../../../LICENSE). |
| `mxl/Arabesque No.1.mxl` | Its embedded MusicXML names Claude Achille Debussy as composer, MuseScore 3.5.2 as encoding software, an encoding date of 2020-11-07, and `https://musescore.com/user/19710/scores/55396` as source. These fields identify a possible source, not the arranger's identity or a redistribution license. | Unverified. |
| `wav/Editing.wav` | Original programmatically generated WebMusic editing fixture, added 2026-10-15; reproducible contents and hash below. | Project-owned fixture under the repository [MIT license](../../../LICENSE). |
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

## Editing fixture

`midi/Editing.mid` is an original eight-note technical fixture, not an imported
performance or transcription. It contains MIDI pitches 60, 64, 67, 72, 67, 64,
62, 60 at successive integer quarter positions 0–7, each lasting one quarter
with velocity 80. The file uses format 1, 480 ticks per quarter, 120 quarters
per minute, 4/4, channel 1 and program 0. Its conductor track has an empty name,
tempo and time-signature events; the note track is named `Piano`. Both tracks
end with an end-of-track event. These values specify the complete fixture's
musical content without any sampled sound or external source material.

SHA-256 of the 141-byte file:
`cc7a03e4087d3fae92b413b27f4ed4a3243eb5b4c4c9444786a53d21e80cce93`.

## Staff editing fixture

`musicxml/StaffEditing.musicxml` is an original notation test fixture with two
explicit four-quarter measures, one piano part, voice 1, staff 1, a treble clef,
C major and 120 quarters per minute. The first measure contains C4, E4, G4 and
C5 quarter notes; the second contains a whole-measure rest. Its uncompressed
MusicXML source is the complete authored fixture. It contains no imported
composition, engraving or performance.

SHA-256 of the 1,744-byte file:
`8d38e7a49dc8024449e923071c082cba24e5437b2bd414788204d9cec8b70183`.

## Audio editing fixture

`wav/Editing.wav` is an original six-second technical test signal, not a recording.
It is a mono, 16-bit little-endian PCM WAV at 8,000 Hz with 48,000 frames and a
standard 44-byte RIFF header. Its sample intervals are 220 Hz at frames 0–15,999,
silence at 16,000–19,999, 440 Hz at 20,000–35,999 and 330 Hz at 36,000–47,999.
For each non-silent interval `[start, end)`, sample `i` is
`round(32767 * 0.3 * min(1, (i-start)/80, (end-1-i)/80) * sin(2*pi*frequency*(i-start)/8000))`.
This defines the complete signal without external recordings or sampled instruments.

SHA-256 of the 96,044-byte file:
`e576caccd1f304b53c444ef07989bc9d43e4b3576ac85c30b3c531e1e611c7b4`.

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
