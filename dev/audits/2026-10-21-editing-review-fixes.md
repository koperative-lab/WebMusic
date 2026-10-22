# Editing branch review and repairs — 2026-10-21

## Scope and baseline

A full review of the editing branch (Score/Audio Core, Edit, Play, View, build
policy, tooling and public references) found one CI-blocking defect and a set of
reproduced and static findings. This record covers their repair. Earlier dated
evidence remains unchanged; the interaction-acceptance record only had four links
renamed to the committed evidence files described below.

Baseline: `editing-capabilities` at `dcb144a74856392c42ad85bf1a2dd3207a220596`,
repaired as uncommitted changes on a separate local branch; macOS, Node
26.8.1/npm 11.19.0. No version, release commit, authentication, publication or
deployment is changed.

## CI-blocking evidence links

`npm run check` failed on every clean checkout: the [interaction acceptance
record](2026-10-15-editing-interaction-acceptance.md) linked four `.log` files
that `.gitignore` excludes, so they existed only in the authoring checkout. This
change adds them as `.txt` evidence with the same content; they must be
committed with it. The documentation link check previously accepted any file
present on disk; it now accepts only files git would publish (tracked or
untracked but not ignored) and directories containing such files, so an ignored
local copy can no longer hide a missing target.

## Repaired defects

Reproduced with failing probes before repair:

- **Audio waveform:** a Trim-tool tap committed a trim to an empty document; an
  empty gain field committed gain 0.
- **Audio playback:** seeking to the exact end of a playing sequence restarted it
  from 0; a configured loop was lost on document replacement; `setLoop` and
  transport attachment wrote a clip loop (including an A–B region object) into a
  borrowed `AudioPlaylist`'s list loop, a regression from `0.2.0`.
- **Score editing:** transposition respelled written pitch (B♭4 up an octave became
  A♯5); a piano-roll resize stored dotless lengths that staff entry then refused
  to delete or follow.
- **Score playback:** an editor-bound `<score-player loop>` stopped looping after
  the first applied revision; the documented `<score-document src>` markup
  reported `webscore:error` and readiness `error` while loading.
- **Reference:** four types documented as exports of `@webmusic/audio/play` were
  not exported there.
- **Sequence waveform:** envelopes with more interior points than one call can
  spread made zoomed-out peak reads throw `RangeError`.

Static findings repaired. Each repaired behavior has a regression that fails before
its fix; some added cases cover adjacent behavior that already passed:

- Score View: geometric hit-testing so a double-click on an existing note never
  inserts a duplicate; empty numeric fields rejected; an unchanged Apply commits
  nothing; staff input keeps its settings across presentation re-renders and
  derives notation durations; one-sided pitch bounds; pointer-ID-scoped
  cancellation; Escape left to enclosing handlers unless it cancels; a read-only
  grid is a labelled graphic; selection cues no longer rely on colour alone;
  playback-only frames repaint overlays only; stale editor/playback state
  attributes are removed outside editor mode.
- Score Edit: velocity overrides reject rests and tie continuations; display-only
  hints no longer block notation replacement; sounding pitch respects Part
  transposition; partial deletion of authored slur pairs and beam groups (grace
  beams grouped separately) rejects; affected IDs list only changed notes; an
  identity-only re-entry is a no-op; `noteVelocity` again accepts plain note data.
- Score Play: stopped/ended states survive edits; adoption publishes one cursor
  update; a start superseded during context resume settles; pre-upgrade conflicts
  and failed mounts remain observable and recoverable; the transport presenter no
  longer repaints for every native note publication.
- Audio Edit/Core: processing validates its splice before running DSP;
  `duplicate-id` is produced; odd WAV data chunks are padded; export format
  errors use `incompatible-audio-format`; envelope reads are O(frames + points);
  normalize rejects non-finite input; malformed entries throw typed errors; a
  reset in a composed position map is terminal.
- Audio Play/View: conflict recovery after the earlier source is cleared; source
  events report a retained clip without a player; one load on declaration
  upgrade; pending declarations do not report errors (including through
  `preload`); a configured loop survives an edit that supersedes the first
  request; regions and playhead mode survive drawing rebuilds and invalid zoom is
rejected; editable scrub
  views use position geometry; typed frame fields apply before form commands; a
  click near a selected edge places the cursor; bounded range caching; PageUp/PageDown
one-second steps; chunk-aware loop voice limits; reentrant detach; ignored
`history` changes keep the editor; mount rollback.
- Build and tooling: the Audio CommonJS build shares one Core implementation
  across entries, so `AudioEditError`/`AudioSequenceError` keep identity and codes
  across `@webmusic/audio` and `@webmusic/audio/edit`; the Element focus-write
  policy exempts each editor's own read-only tab-stop removal as an exact literal
  (a loop that had bypassed the literal check was replaced); the documentation
  launcher tolerates a repeated interrupt for a zombie-only process group and still
publishes its cleanup barrier when the owner marker cannot be renamed; Score
  Edit pages have their own task group in `llms.txt`.

[Editing migration](../release/EDITING-MIGRATION.md) lists the changes visible to
`0.2.0` consumers that do not use editing: non-finite seeks, `<audio-view player>`
target resolution and the WAV pad byte.

## Final re-review repairs

A final round of independent Score, Audio, documentation and standards reviews
judged both domains releasable for their documented scope; its one P2 (the Score
history reload below) and smaller findings are repaired. Each behavior change
has a regression that fails before its fix:

- Audio: an invalid sequence limit no longer leaves a rejected document source
  marked as attached, so retrying the same source fails again instead of being
  ignored; a mapped or clamped loop that an edit leaves too short to schedule is
  disabled instead of failing the revision; copy/cut shortcuts need a range, so a
  cursor never replaces the clipboard; an output `assetId` that identifies a
  stored asset fails before DSP; Escape that cancels nothing is left to enclosing
  handlers; `@webmusic/audio/play` type exports are compile-tested.
- Score: `<score-document>` keeps its editor and edits when an ignored history
  setting changes (as Audio already did); `<score-view>` treats a missing,
  loading, cleared or disposed editor as pending without stale content or an
  alert, and a `format` change no longer rebinds its editing session; grace beams
  form their own groups for partial-deletion protection;
  `<score-view>` removes `data-playback-state` when it leaves editor mode; the
  staff controller reuses the Core notation-duration helper.
- Tooling: the documentation link check is exercised through its default path,
  and the launcher's cleanup barrier is tested when the owner marker cannot be
  renamed.
- References: CHANGELOG has an Unreleased entry; Architecture describes the split
  CommonJS builds; STATUS records the `vite` advisory and the API decisions
  below; design headings no longer call shipped behavior a target; Audio Play,
  Score Play, Score/Audio Edit and View pages, parameter catalogs, a headless demo
  and the migration guide were corrected against source (WAV writers, seek and
  fraction validation, pending editor states, error codes, grid stepping and
  read-only accessibility wording).

## Not changed

- A processed output asset ID that was already retired (not one currently stored)
  is still detected only at
  registration, after DSP; probing would add a member to the public
  `AudioAssetStore` interface. The reference documents that a failure after
  registration needs a new ID.
- `commitDraft` clears the draft before executing in both domains; keeping it on a
  rejected commit is a joint Score/Audio decision.
- Read-only piano-roll click selection needs a keyboard-accessible read-only
  presentation first.
- Score Edit pairs slurs by voice and number while the staff renderer pairs by
  part and number; aligning them needs a shared Core pairing helper.
- `webscore:documentstatechange`/`webaudio:documentstatechange` carry different
  details from declarations and players, and Score View edit events are
  unprefixed; renaming them is an API decision before release.

## Verification

- `npm run check`: passes with 4,802 maintained tests (Kernel 163, UI 653,
  Score 2,395, Audio 1,154, Bridge 182, site 255), against 4,661 at the baseline
  ([check excerpt](2026-10-21-editing-review-fixes/check-excerpt.txt)).
- `npm run pages:build` and `npm run check:external-install` pass
  ([excerpts](2026-10-21-editing-review-fixes/site-and-install-excerpt.txt)).
  Machine paths in the excerpts are replaced by placeholders.
- `npm run audit:dependencies` reports one high advisory in the development
  dependency `vite` 8.3.0–8.3.2, published after the baseline lockfile; the
  lockfile is unchanged by this repair and the same report applies to `main`.

Browser, pointer, screen-reader and audible verification were not repeated for
these repairs; STATUS EDIT-01 retains those acceptance gaps.
