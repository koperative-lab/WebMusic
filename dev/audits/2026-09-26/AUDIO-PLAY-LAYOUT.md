# Audio Recorder naming and Audio Play layout alignment

Baseline: local dev worktree at `ae0742a` with the existing migration and Audio
Player changes. Main `1e0fb7b` remains the Score and Agent Toolkit reference.
Environment: Node 24.21.0, Codex in-app browser, default light theme.

## Scope and changes

- `audio-recorder` and AudioRecorderElement are the canonical tag and class,
  with matching factory/detail types, source file, demo, page, catalog, package
  policy and Toolkit mapping. No clip-qualified Element alias or route remains.
  Historical records retain their original wording. See DEC-031.
- Audio Player, Playlist, Mixer and Recorder own full-width block sizing,
  border-box geometry, zero minimum inline size, a parent-width maximum and
  an effective hidden state. Application host width remains customizable.
- Audio Play demo compositions reuse one grid stage with a 0.5rem component
  gap. Score Synth Panel measured the same 8px gap in this environment.
- AudioPlayer's transport gap changes from the observed 6.4px to Score's 12px
  default, retaining public transport/control gap overrides. Control height and
  surface padding were already equal (32px controls and 9.6px padding).
- A playlist without its transport bar no longer reserves 0.7rem above its list.
  The ordinary transport/list layout keeps that spacing. The disabled-row rule
  remains intact; enabled browser rows had opacity 1 after the repair.
- Copy markup includes the player and linked companion. Playlist and mixer
  include the data setup needed to reconstruct the example. Recorder guidance
  names the actual Record button and requests no microphone automatically.

## Rendered verification

Before editing layout, inspected Score Synth Panel and Score Player plus Audio
Player/Mixer. Audio's player and mixer touched with a 0px composition gap. The
Recorder's source and demo both specified inline-block, causing shrink-to-fit.

At the normal 1265px browser viewport, the content stage and each Audio companion
measured 537.8125px wide; linked surfaces had an 8px vertical gap. AudioPlayer's
inner transport measured 12px gap and 53.1875px total height, matching Score.
The playlist list's top margin measured 0px in the connected composition.

At a 320px viewport, all four public Play demos had a 217.8125px stage and equal
host widths, with no page-level horizontal overflow. Recorder controls wrapped
within their own surface. The temporary viewport override was reset afterwards.

Verified keyboard Play/Pause for the playlist, mixer Play/Pause and Solo,
Reset preserving the mixer player connection, current composed markup/data setup,
and the new recorder route/title/navigation. No unexpected browser warning or
error was observed on the checked pages. Microphone permission and hardware
recording were not invoked for this layout task.

Final screenshot: `/private/tmp/webmusic-audio-recorder-layout.png`.
Pre-layout source backup: `/private/tmp/webmusic-audio-layout-before-jlv62pds/files.tar.gz`.

## Automated verification

- Audio: 66 files / 869 tests passed.
- UI playlist: 1 file / 27 tests passed.
- Documentation: 25 files / 221 tests passed.
- Source/test typechecks and 242 documentation snippets passed; Astro reported
  zero errors/warnings and three inherited main search-client hints.
- Architecture, documentation contracts, developer-documentation routes, format
  and built-package checks passed.
- Five-package/documentation build passed: 112 pages, 110 searchable references.
- Full `npm run check` remains blocked by the same seven inherited main Score/UI
  lint findings. No rule was disabled and no new lint finding was introduced.

Logs are retained locally under `/private/tmp/webmusic-audio-layout-*.log`.
Main source and working-tree state were preserved; this work is not a commit,
push or deployment result.
