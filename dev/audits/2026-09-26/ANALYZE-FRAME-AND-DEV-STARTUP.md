# Score Analyze frames and development startup correction

## Baseline and scope

2026-09-26, Node 24.21.0, local `dev` at `ae0742a` with the restored migration
and previous uncommitted follow-ups. This corrects the maintainer's report of
missing Score Analyze borders/padding and an Astro startup ending with code 143.
The separate main checkout is unchanged.

## Correction to earlier acceptance

The [earlier Analyze demo audit](ANALYZE-DEMO-ALIGNMENT.md) verified widths,
sibling gaps and interactions but incorrectly accepted the bare Score surface.
Rendered inspection in this follow-up showed zero border and zero padding on
the Roman Element's wrapper and workbench, while Score Player used a 1px neutral
border and 9.6px padding. Matching sibling geometry alone was insufficient.
DEC-034 records the scoped runtime styling exception to main's baseline.

All five Analyze Elements now use the existing public `surface` part as their
single painted frame. It receives the neutral component defaults while keeping
inherited component/workbench tokens and legacy theme overrides. Lanes and
nameplates remain unframed. No analysis algorithm or player binding is changed.
The five Styling references describe the actual default frame and padding.

## Development process failure

The previous root `predev` stopped the tracked server, and the docs command used
`astro dev --force=true`. Installed Astro 7.3.5's takeover path sends SIGTERM to
the tracked process (then SIGKILL if needed). A second start could therefore
terminate the first terminal after it had reported ready; 143 is 128 + SIGTERM.
The daemon observed in this review started at 01:23:22, following the reported
01:22:40 startup. The exact external sender of the reported signal was not
retained, but the destructive repeated-start path is confirmed in source.

Ordinary starts must reuse an existing server before any package build, and
must not pass force or implicitly stop another terminal. Rebuilding and
replacement require the explicit restart command. The development handbook
owns the current command details.

## Verification

- Score Analyze: 33 files / 530 tests passed, including 15 surface/hidden/remount
  cases. Score source typecheck and scoped ESLint passed.
- Startup: 12 isolated regressions passed, including concurrent reuse, failed
  builds, racing stale-owner recovery, foreground readiness, preserved 143 and
  interruption of an owned build process tree with delayed descendant exit.
  The startup check is now part of `check:source`; scoped ESLint passed.
- `npm run docs:build`: all five packages and 113 site pages built; Toolkit
  verified 111 public references. `check:doc-snippets`: 244 examples passed.
  Test typecheck, architecture and public documentation checks passed.
- `npm run check` passed format, lockfile and startup tests, then stopped at the
  same seven main Score/UI lint findings tracked by DEV-06. The full gate did
  not pass; no rules were disabled.

In the in-app browser, all five Score Analyze pages had exactly one outer
1px neutral border, 9.6px padding on all sides, a white default background and
an 8px sibling gap. The player and Analyze host measured equal widths: about
538px in the ordinary 1265px viewport and 218px at 320px, without page overflow.
Roman's explicit dark scheme produced a dark surface/border; ArrowRight still
updated the linked player, and Reset restored attributes. No browser errors
were recorded. A new screenshot captures the complete framed pair; the earlier
bare screenshot is not acceptance evidence for this correction.

The previous daemon's ownership was verified against the actual earlier
assistant command output (PID 16192) and matching Astro receipt before a
controlled stop for package rebuilds. The fixed startup created PID 20217.
Repeating both `npm run dev` and `npm run docs:dev` returned success with that
same PID and startup timestamp, without a package build or takeover. The
preview remains running at localhost:4321. Isolated tests cover foreground
lifetime; this live verification used Astro's native agent-background mode.

These checks do not establish audio timing, hardware interaction, screen-reader
acceptance, Windows process-tree cancellation, publication or remote CI.
