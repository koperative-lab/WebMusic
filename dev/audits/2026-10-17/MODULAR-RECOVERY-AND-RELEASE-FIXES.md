# Modular recovery and release fixes

The modular source has been recovered on `modular-redesign` in commit
`3dd46988236592598ed98827eb637dbb9e1f9056`. This is a recovery checkpoint,
including the eight defects recorded in the
[previous candidate review](../2026-10-16/MODULAR-RELEASE-CANDIDATE-REVIEW.md).
Repairs and fresh acceptance follow that checkpoint as separate changes.

## Recovery evidence

The restored environment initially contained clean `ef8664d`, without the
previous uncommitted modular implementation. The original task and 31 child
task histories retained the source edits. Recovery applied 900 recorded edits
to an isolated copy, with exact patch matching and reviewed local text
transformations. All 900 applied; no source edit remained unresolved.

The frozen tree contains 1,445 files. Its checksum-manifest SHA-256 is
`06ea5eab87b68b5670403f89ab982793765ac3de6575b9279c4bd798b163c7e0`.
All 12 final input hashes printed by the previous review match. The final
lockfile, original demo media and licenses also match their retained checksums.
Two truncated source records were completed from overlapping retained reads
and exact recorded patches. Historical deletions and temporary probe removal
were applied before creating the recovery commit.

The full old 1,181-input manifest, generated logs, screenshots and package
archives were not retained in the accessible task history. Old reports remain
historical records; their missing evidence is not replaced with newly invented
receipts. New checks below validate the recovered and repaired code separately.

Portable recovery copies were created in the task artifact directory:

- `webmusic-modular-recovered-20261017.bundle`: Git history and recovery branch;
  SHA-256 `0b1ffee5fb3c43100f1bf8f497204a696bce3567c1c38fd35025485c342c3d9f`.
- `webmusic-modular-recovered-20261017.tar.gz`: recovered source;
  SHA-256 `599faeef37d8f1744e909c53a4733ba2b48f54863eba2d78a05b63ce08786416`.

## Repair scope

All eight candidate findings are repaired. The maintained workspace suite adds
90 regression cases, including analyzer teardown followed by synchronous
reconnection. Negative runs against the recovered checkpoint were retained
separately from the final installed-package checks.

| Finding | Repair and observed result |
| --- | --- |
| RC-01 | AudioClipPlayer guards graph preparation and validates ownership after effect factories. Disposal during construction releases the candidate once and produces silence. |
| RC-02 | Session completion checks scheduling epochs; TransportGroup rejects stale reconciliation results. Reentrant stop, seek, play and disposal retain the newer command in both manual and timer paths. |
| RC-03 | Mixer forwards its shared scheduled start to both built-in AudioPlayer and AudioClipPlayer. Initial play and playing seek begin both channels at frame 2,880 with a 60 ms lead at 48 kHz. |
| RC-04 | Lazy Mixer membership checks channel-ID occupancy before a port becomes available. Rejected collisions cannot hide direct channels or leave a route after removal. |
| RC-05 | The lazy sampler forwards ParamSurface and scheduled-duration/retiming capabilities without allocating on discovery. Attached ADSR controls work, and rate changes retain the native voice rather than retriggering it. |
| RC-06 | Analyzer binding uses generation guards and releases stale taps, subscriptions and discovery handles. Teardown cannot erase resources created by synchronous reconnection. Borrowed modules remain borrowed. |
| RC-07 | Analyzer errors follow the documented `detail: {error: Error}` contract; stale bindings cannot dispatch obsolete errors. |
| RC-08 | Audio View and Analyze auto entries expose the constructor registered for their shared meter tag. Both classic-script orders, repeated loading and direct construction work; manual registration remains in the explicit Element entry. |

## Fresh verification

The final product inputs were frozen before the full gates. The
[input manifest](evidence/frozen-inputs.json) records 1,448 files. Node 24 used
a separate copied tree and fresh installation; its
[post-check verification](evidence/node24-input-verification.json) found no
changed or missing input. Node 22's frozen inputs were also verified unchanged
before recording the final audit and STATUS updates. Those documentation-only
updates receive the focused documentation and formatting checks afterward.

| Check | Result and retained evidence |
| --- | --- |
| Node 22.22.3, fresh `npm ci`, complete `npm run check` | Exit 0; 373 test files / 4,833 tests. [Receipt](evidence/node22-check.json), [log](evidence/node22-check.txt). |
| Node 24.19.0, independent fresh `npm ci`, complete `npm run check` | Exit 0; the same 373 files / 4,833 tests. [Receipt](evidence/node24-check.json), [log](evidence/node24-check.txt). |
| Actual tarballs installed outside all workspaces | Exit 0; 174 runtime entries, 91 ESM/browser and 87 CommonJS declarations, both module formats and package identity checks. [Receipt](evidence/external-install.json), [log](evidence/external-install.txt). |
| Dependency audits | Both full and production-only audits report zero vulnerabilities. [Full](evidence/audit-all.json), [production](evidence/audit-production.json). |
| Installed Audio native cases | 5/5 pass, including silent disposal/collision cleanup and sample-aligned mixed starts. [Results](evidence/audio-native.json), [inputs](evidence/audio-inputs.json). |
| Installed Score native cases | 2/2 pass with real decoding, attached ADSR and voice-preserving retiming. [Results and inputs](evidence/score-native.json). |
| Installed analyzer native cases | 52/52 pass, no browser exceptions. [Results](evidence/analyzers-native.json), [receipt](evidence/analyzers-receipt.json). |
| Installed Session/Group public ESM and CommonJS cases | 36/36 pass; installed bytes unchanged. [Results](evidence/session-installed.json). |
| Installed classic View/Analyze bundles | 6/6 load-order and repeated-load cases pass in Chromium. [Results](evidence/globals-installed.json). |

The browser probes used Chromium 151.0.7922.173. Product inputs came from the
final independent consumer's installed public entries or actual classic bundles,
with no source aliases. The
[installed-dist manifest](evidence/installed-dist-hashes.json) records all 1,121
files across the five packages; the analyzer run verified them unchanged.
These finite native fixtures do not establish every browser, device latency,
background scheduling condition or microphone/MIDI behavior.

The linked text logs are display copies with ANSI colors and trailing whitespace
removed. [Raw and display hashes](evidence/log-copies.json) preserve that
distinction; original logs remain in the portable verification archive.

Both normal and `/WebMusic/` documentation builds pass, with 114 generated pages,
112 search/reference pages and 74 license records covering 356 files. The Pages
prefix and notice checks also pass. [Normal build receipt](evidence/normal-docs-build.json),
[Pages build log](evidence/docs-pages-build.txt),
[prefix check](evidence/docs-pages-prefix.txt),
[notice check](evidence/docs-pages-notices.txt).

The [normal](evidence/docs-normal.json) and [Pages](evidence/docs-pages.json)
browser runs each pass all five pages. They exercise standalone Score/Audio
play and pause, three nested participants on one Session, shared effect controls,
mirrored ADSR, matching routed note IDs, LFO, macro and automation controls,
project keyboard seeking, save/load and export/import, missing-plugin recovery
and invalid-import rejection. The project fits a 320 px viewport. Each run
records 79 actually loaded HTTP inputs and their hashes, with no page,
console, component or HTTP response errors.

One canceled WAV request is retained in each raw network record. Its exact URL
is also the successfully decoded 1,411,200-frame stereo clip at 44.1 kHz, with
32 seconds of data, nonzero samples and observed Session playback progression.
The harness distinguishes that cancellation from a failed asset; initial
harness attempts are retained in the portable evidence archive. These runs do
not claim that every network request completed without cancellation.

The full gates additionally cover source documentation, snippets, declarations,
package exports, artifacts, licenses, original demo media and the shared `0.3.0`
release manifests. RC-01 through RC-08 have no remaining known blocker within
the recorded acceptance scope.

No npm publication, release tag or site deployment is part of this recovery.
The final release commit's remote CI, publisher authentication and registry
consumer verification remain governed by the
[publishing runbook](../../release/PUBLISHING.md). Local acceptance is evidence
for this candidate; it is not a registry delivery receipt.
