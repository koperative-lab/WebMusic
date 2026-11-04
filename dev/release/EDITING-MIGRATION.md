# Editing migration from 0.2.0

This guide covers consumer changes between the published `0.2.0` packages and
the next release containing the document editing work. It does not choose
that release's npm version or assert that the editing artifacts are published.
Use [Releasing](RELEASING.md) and [Publishing](PUBLISHING.md) to prepare and
verify a new shared package version; [STATUS](../STATUS.md) owns remaining work.

The comparison uses the actual Score and Audio `0.2.0` registry tarballs
inspected in the [October 16 release review](../audits/2026-10-16-editing-release-review.md).
Their [retained registry metadata](../audits/2026-10-16-editing-release-review/registry-package-metadata.json)
identifies the downloaded artifacts. This is separate from the historical
`0.1.0` release receipt and its [earlier migration guide](0.2.0.md).

## Score JSON readers and writers

The editing release writes Score JSON schema **v0.2**. This schema identifier
is independent of the npm package version: the published
`@webmusic/score@0.2.0` writes schema **v0.1**.

| Data | Published 0.2.0 reader | Editing-release reader |
| --- | --- | --- |
| Score JSON with the exact v0.1 marker | Accepted | Accepted and written back as v0.2 |
| Legacy Score JSON without a marker | Accepted when otherwise valid | Accepted when otherwise valid; written back as v0.2 |
| Score JSON with the exact v0.2 marker | Rejected with `unsupported-schema` | Accepted when valid |
| Unknown marked schema | Rejected | Rejected |

Every `Score.toJSON()` result now carries the v0.2 marker, even when the Score
has not been edited and has no new fields. The new optional
`NoteData.velocityOverride` preserves authored velocity without creating
absolute performed timing. Effective velocity is
`velocityOverride ?? performed?.velocity ?? 80`. The
[Score Core reference](../../apps/doc/webmusic/src/content/docs/score/api/index.mdx)
owns serialization and field validation; the
[Score View API](../../apps/doc/webmusic/src/content/docs/score/api/view.mdx)
explains when timing edits clear performed timing.

Upgrade every reader of shared persisted Score JSON before allowing new
writers to replace that data. Include browser clients, servers, workers and
background import/export jobs in that rollout. If old readers must remain,
keep their storage flow separate and retain original v0.1 records until those
readers are retired. A newer reader can open the old records; opening and
resaving them migrates the output to v0.2.

Do not change `$schema` back to v0.1 or remove it to bypass the old reader's
version check. The old implementation does not preserve `velocityOverride`,
so disguising newer data can silently lose authored velocity. There is no
built-in v0.2-to-v0.1 serializer. Any application-specific downgrade needs an
explicit field mapping and loss policy; MIDI or MusicXML export is a separate
format conversion, not a lossless JSON downgrade.

## Audio source-detail events

In published `0.2.0`, `AudioPlayerSourceDetail` and
`AudioPlayerElementSourceDetail` were interfaces with `clip` and `revision`.
They now alias the Core `AudioPlaybackSourceSnapshot` discriminated union:

| `kind` | Source fields |
| --- | --- |
| `empty` | `clip: undefined`, `revision` |
| `clip` | `clip: AudioClip`, `revision` |
| `sequence` | `clip: undefined`, `sequence`, `assets`, `documentId`, `documentRevision`, `revision` |

The Headless `sourcechange` event and Element `webaudio:sourcechange` event
carry this shape. `revision` counts source publications; `documentRevision`
identifies committed sequence content. See the
[Headless player](../../apps/doc/webmusic/src/content/docs/audio/headless/play/audio-player.mdx)
and [Element player](../../apps/doc/webmusic/src/content/docs/audio/element/play/audio-player.mdx)
for initial snapshots and playback readiness.

Existing listeners that read `detail.clip` still compile, but a missing clip
can now mean an editable sequence. Branch on `kind` before treating that state
as empty. Custom adapters, test fixtures and manually constructed event details
must add the discriminator. For a known single-clip source:

```ts
import type {AudioClip} from '@webmusic/audio';
import type {AudioPlayerSourceDetail} from '@webmusic/audio/play/headless';
import type {AudioPlayerElementSourceDetail} from '@webmusic/audio/play/element';

export function clipSource(
  clip: AudioClip | undefined,
  revision: number,
): AudioPlayerSourceDetail {
  return clip
    ? {kind: 'clip', clip, revision}
    : {kind: 'empty', clip: undefined, revision};
}

export const cleared: AudioPlayerElementSourceDetail = clipSource(undefined, 0);

export function sourceDuration(source: AudioPlayerSourceDetail): number {
  switch (source.kind) {
    case 'empty': return 0;
    case 'clip': return source.clip.duration;
    case 'sequence': return source.sequence.length / source.sequence.sampleRate;
  }
}
```

For a real player, forward its `.source` snapshot instead of rebuilding one
from `.clip`. This preserves sequence identity and its borrowed asset reader.
The snapshot does not itself retain PCM for asynchronous work; follow the
[asset lease contract](../../apps/doc/webmusic/src/content/docs/audio/api/view.mdx).

Because these exported types are now unions, an application interface cannot
`extend AudioPlayerSourceDetail`. Use a type intersection for additional
application metadata, such as
`type NamedSource = AudioPlayerSourceDetail & {label: string}`, or select one
branch with `Extract<AudioPlayerSourceDetail, {kind: 'clip'}>`.

## Existing members with changed behavior

These members exist in published `0.2.0`. Applications that do not use editing
can still observe the changes below.

| Member | Published 0.2.0 | Editing release |
| --- | --- | --- |
| `ScorePlayer.seek`, `seekNominal`, `seekFraction` | Non-finite input was not validated | `NaN` or `±Infinity` returns a promise rejected with `RangeError`; the position is unchanged |
| `AudioPlayer.seek`, `scrub`, `seekFraction` and the `<audio-player>` `.seek`, `.scrub`, `.seekFraction` methods | Non-finite input was not validated | A `NaN` or `±Infinity` seek or scrub throws `RangeError`; `seekFraction` throws only for `NaN` and still clamps `±Infinity` to 0–1 |
| `<audio-view player="…">` | One `querySelector` lookup bound the first match, once | Kernel target observation: exactly one match in the host root binds, a later insertion binds, several matches bind nothing, and invalid selector syntax dispatches `webaudio:error`, as `<score-view player>` and the Analyze Elements already behaved |
| CommonJS entries of `@webmusic/audio` | Each entry carried its own copy of shared Core modules | Entries share one Core implementation per format, so `instanceof` checks and Core classes such as `AudioEditError` agree across `require('@webmusic/audio')` and its subpaths |
| `serializeWav`, `clipToWav`, `clipToBlob` and the WAV exports built on them | An odd-sized `data` chunk (for example 24-bit mono with an odd frame count) had no RIFF pad byte | One zero pad byte follows the chunk and is counted in the RIFF size; the `data` chunk size and decoded PCM are unchanged, and the byte length grows by one |

`AudioPlayer.setLoop` still rejects every borrowed queue or mix, and a configured
clip loop is not applied to them, exactly as in `0.2.0`. Owned clips loop as
before; among borrowed transport paths, only the player's own document sequence
accepts loop commands.

## Score View types and annotations

`0.2.0`'s `<score-view>` also accepted `type="map"` and `type="thumbnail"`, and
drew score annotations on every type. The next release keeps three types and
draws annotations only on the staff (DEC-056).

| Published 0.2.0 | Next release | Upgrade |
| --- | --- | --- |
| `type="map"`, with `for-part`, `cells`, `.forPart`, `.cells`, the `webscore:seek` event and `ScoreViewSeekDetail` | Removed; the value falls back to `piano-roll` | Compose `createScoreMapView` from `@webmusic/score/view/headless` with the `@webmusic/ui/timeline` presenter, and seek your player from its commands |
| `type="thumbnail"` | Removed; the value falls back to `piano-roll` | Use `mountScoreThumbnail` / `renderScoreThumbnail` from `@webmusic/score/view/render` |
| `--wm-score-view-map` styling token | Removed | Style the timeline presenter you compose |
| Piano-roll expression strip and waterfall expression rail | Not drawn; no space reserved | Show annotations with `type="staff"` |
| `showAnnotations` on `VisualizerRenderOptions` and React `ViewProps` | Only on `StaffRenderOptions` and `StaffViewProps` | Remove it from piano-roll and waterfall options; `validateScoreViewConfiguration` rejects it there |
| `show-annotations` on any `<score-view>` | Affects only `type="staff"` | No change needed for staff views |

`ScoreViewElementType` remains exported and now equals `ScoreViewType`.

## Adopt editing through the View entries

Editing adds members to existing entries and one Element, `<score-grid-view>`,
registered by `defineAllViewElements()`; it adds no new subpath. The inspected
`0.2.0` packages lack these members, so installing an older package does not
make them available. Until an editing release is published, use this checkout's
built tarballs or workspace entries.

| Need | Score | Audio |
| --- | --- | --- |
| Semantic operations, position maps and document contracts | `@webmusic/score/view` | `@webmusic/audio/view` (also range-processor recipes) |
| Persistent editor owner | `ScoreEditor` from `@webmusic/score/view/headless` | `AudioClipEditor` from `@webmusic/audio/view/headless` |
| Load a file into a new editor | `loadScoreEditor(url, options)` from `@webmusic/score/view/headless` | `loadAudioClipEditor(url, options)` from `@webmusic/audio/view/headless` |
| Bind an editor to Elements | Assign `.editor` on `<score-grid-view editable>` (editing), `<score-view>` (read-only display) and `<score-player>`; the application disposes the editor | Assign `.editor` on `<audio-view>` / `<audio-player>`; the application disposes the editor |
| Render or export an edited sequence | — | `renderAudioSequence`, `exportAudioSequenceWav` from `@webmusic/audio/play` |

There is no dedicated editing React wrapper. The package root remains Core; it
does not re-export the editor implementation. Use the owning
[Score View](../../apps/doc/webmusic/src/content/docs/score/api/view.mdx),
[Audio View](../../apps/doc/webmusic/src/content/docs/audio/api/view.mdx) and
[Audio Play](../../apps/doc/webmusic/src/content/docs/audio/api/play.mdx)
references for imports, environments and dependencies. Pre-release builds of
this branch briefly published separate `/edit`, `/edit/headless`,
`/edit/element` and `/edit/auto` subpaths; DEC-055 removed them before any
release, so no compatibility alias exists.

Existing immutable Score/AudioClip playback and read-only views remain usable
without an editor. To enable editing, create one editor per document and let
the player and editing views borrow it. Clear an independent player/view data
source before binding an editor; conflicting explicit sources fail instead of
silently choosing one. Applying a document revision pauses playback and leaves
resumption to an explicit play command. Document history is local to that
owner; project persistence and history spanning several documents remain
application responsibilities.

Score's existing `ScoreEditSession` remains the synchronous `score.edit(...)`
batch primitive. Audio's existing `ClipEditSession` remains a materialized-clip
transformation tool. Neither becomes the persistent document owner; use
`ScoreEditor` or `AudioClipEditor` for document revisions, interaction sessions
and undo/redo. Audio editing uses asset references and one contiguous sequence,
not a multitrack project. Create or decode clips with the matching Audio
release before handing them to its editor: older clip objects lack the retained
backing-byte accounting capability required by the new asset store.

Score note editing is the new `<score-grid-view>` piano-roll grid, whose
`tools` attribute chooses the offered features; `<score-view>` stays read-only
and gains only the `.editor` display binding (DEC-058). Waveform editing is an
opt-in interaction on the existing `<audio-view>`. There is no staff or notation
editing. These entries do not imply notation authoring, spectral repair or
multitrack editing. The [editing contract](../design/EDIT-COMPONENTS.md) records
the accepted boundaries.

## Package release and website deployment

Review these migration changes when preparing the next shared package version
and its dependency ranges. Validate the resulting release checkout and tarballs
through [Publishing](PUBLISHING.md); source availability and a local manifest
version do not establish registry delivery. Keep the earlier release guides
and receipts as their original baselines.

Publishing the npm packages does not deploy the documentation site. Website
deployment additionally requires review of its
[public asset inventory](../../apps/doc/webmusic/ASSETS.md). Site media are
excluded from the npm package contents; the two delivery decisions remain
separate.
