# Score Recorder standalone page

## Baseline and scope

2026-09-26, Node 24.21.0, the `dev` working tree at `ae0742a` with the restored
migration and prior Audio work. The maintainer requested a standalone Score
Recorder page corresponding to Audio Recorder. DEC-032 records this explicit
exception to main's Score documentation baseline. No Score package source or
package tests were changed; the separate main checkout remained clean.

## Changes

- Move the complete recorder contract from Note Input to its own tag-named page;
  update sidebar order, catalog destinations, Toolkit demo inventory and links.
- Remove the old standalone-page redirect and optional recorder editor from the
  Note Input demo. Note Input retains its three input layouts and sound monitoring.
- Add a dedicated sibling input/recorder demo: `.source` captures events once,
  while shared demo monitoring handles sound readiness, held voices and cleanup.
- Document the actual zero quantization default, capture-only source versus
  monitored imperative input, borrowed resources, reconnect and empty-take rules.

## Verification

- `npm run check:docs`: passed, 111 routes and 72 live-demo pages.
- `npm run check:dev-docs` and `npm run check:format`: passed.
- `npm run check:doc-snippets`: 243 examples passed against built declarations.
- `npm run typecheck -w webmusic-doc`: no errors or warnings; three inherited
  `keyCode` hints. `npm run typecheck:tests`: passed.
- `npm run test -w webmusic-doc`: 218 tests passed. Six new regression tests
  execute the actual recorder demo script, lifecycle and monitoring helper,
  mocking only package boundaries. They cover local source binding, navigation
  cleanup/remount, late audio readiness, replaced attacks, original-voice release,
  parameter scoping, copied setup and Reset.
- `npm run check`: stopped at the seven inherited Score/UI lint findings recorded
  in the [main alignment audit](../2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md).
  The complete gate did not pass; rules were retained.
- `npm run docs:build`: passed for all five packages and 113 site pages;
  Toolkit verified 111 public Markdown references and its demo catalog.

In the local in-app browser, the new canonical route rendered directly with
its sidebar entry. Three input notes produced `captured 3`, enabled exports and
entered take playback. BPM/layout edits stayed scoped to their components;
Reset restored 120 BPM, zero quantization and piano, and subsequent recording
still captured three notes. Copy reported success and showed both sibling tags
and source wiring. The two hosts measured equal widths with an 8px gap. Note
Input contained no recorder or optional mount editor and linked to the new page.

These checks establish documentation and demo interaction, not acoustic timing,
real-device behavior or release/deployment. Source APIs and those wider acceptance
boundaries remain owned by the existing Score implementation and STATUS.
