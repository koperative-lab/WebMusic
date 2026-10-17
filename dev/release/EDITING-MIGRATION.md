# Editing migration from 0.2.0

This guide covers consumer changes between the published `0.2.0` packages and
the next release containing the `editing-capabilities` work. It does not choose
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
[Edit API](../../apps/doc/webmusic/src/content/docs/score/api/edit.mdx)
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
[asset lease contract](../../apps/doc/webmusic/src/content/docs/audio/api/edit.mdx).

Because these exported types are now unions, an application interface cannot
`extend AudioPlayerSourceDetail`. Use a type intersection for additional
application metadata, such as
`type NamedSource = AudioPlayerSourceDetail & {label: string}`, or select one
branch with `Extract<AudioPlayerSourceDetail, {kind: 'clip'}>`.

## Adopt the new Edit entries

The inspected `0.2.0` packages do not export `/edit`, `/edit/headless`,
`/edit/element` or `/edit/auto`. Those subpaths are additions to the existing
`@webmusic/score` and `@webmusic/audio` packages; they are not separately
installed packages. Until an editing release is published, use this checkout's
built tarballs or workspace entries. Installing an older package successfully
does not make its missing Edit subpaths available.

`/edit` supplies semantic operations and editor factories. `/edit/headless`
supplies the persistent editor owners. `/edit/element` supplies explicit
registration for nonvisual `<score-document>` and `<audio-document>` owners;
`/edit/auto` registers the corresponding default tag on import. There is no
Edit `/global` or `/render` entry, or dedicated Edit React wrapper. The package
root remains Core; it does not re-export the editor implementation. Use the
owning [Score Edit](../../apps/doc/webmusic/src/content/docs/score/api/edit.mdx)
and [Audio Edit](../../apps/doc/webmusic/src/content/docs/audio/api/edit.mdx)
references for imports, environments and dependencies.

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

Piano-roll and waveform editing are opt-in interactions on existing Views.
Staff entry requires authored measures and supports the documented simple
notation subset; MIDI time signatures alone do not create editable measures.
These entries do not imply complete notation authoring, spectral repair or
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
