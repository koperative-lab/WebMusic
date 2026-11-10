# Manual acceptance runner

`apps/test` (workspace `webmusic-test`) is a small standalone page for the
person who accepts WebMusic on real devices. It is not part of the
documentation site. Each check names what to do and what must hold, mounts a
**live canvas** built from the packages' own Elements and Headless objects, and
records Pass, Fail or Skip with notes for each tested environment. All musical
material is Arabesque No. 1, read from the documentation site's owner-maintained
[`public/`](../doc/webmusic/public/) folder. The runner only reads that folder.
The page is light and English only.

It is the third layer of every version's verification and the third release
gate: see the [version workflow](../../dev/DEVELOPMENT.md#version-workflow) and
the [release gates](../../dev/release/PUBLISHING.md#release-gates). The
[MOD-15 device acceptance](../../dev/audits/2026-11-07-mod15-device-acceptance.md)
record names the minimum environments; [STATUS](../../dev/STATUS.md) VERIFY-01
owns the remaining gap.

## Start

From the repository root:

```bash
npm run test:manual
```

This builds the packages, then serves the runner at <http://localhost:4331>.
After a package source change, rebuild with `npm run build:packages` and reload.
Do not rebuild while the page is open: a rebuild empties `dist/` for a moment.
For a phone or tablet on the same network:

```bash
npm run dev -w webmusic-test -- --host
```

Open the printed network URL. Plain-HTTP network origins are not secure
contexts, so run the microphone check (F1) on the desktop `localhost` URL.

## Build under test

The top bar and the first page show the build: the shared package version, the
commit, the branch, the number of uncommitted changes and each package's
version. The development server reads them from Git on every page load
(`/build-info.json`), so reload after committing. A build with uncommitted
changes is shown in red: use it for debugging, then commit and accept the
commit itself.

## Use

1. **0 · Before you start**: confirm the build, then fill in the environment
   (device, browser, output, microphone). Add a new environment for each
   further device or browser.
2. Work down the list. On a wide window the live canvas sits on the left and
   Steps, Expected, Parameters and the result stay beside it; on a narrow one
   they stack, instructions first. Follow **Steps** in the live canvas, compare
   with **Expected**, then choose **Pass**, **Fail** or **Skip**. A failure or a skip
   needs a note. Settings and measurements a check needs are under
   **Parameters**; **Reload canvas** remounts the check's components.
3. Send what fails, with its notes, to the agent. It fixes the problem as a
   new round and hands off a new commit; reload and test that commit. When the
   build is right, tell the agent that manual acceptance is complete — that
   statement is the gate. Nothing has to be saved or exported.

**Copy Markdown** and **Download Markdown** are optional: they put the build
identity, a summary and every check's result per environment into text you
can paste into the conversation.

Results are stored in this browser's `localStorage` under the build they were
taken on, so a new commit starts a fresh record and results never mix across
builds. They are not shared between devices. Nothing the runner records is
committed.

The **Summary** on the first page says whether a sitting is complete: the build
is a commit with a clean tree, no check failed in any environment, every check
passed in at least one environment, and every skip has a note. It guides the
person testing; it is not stored or verified anywhere.

## Structure

| Path | Role |
| --- | --- |
| `src/checks.ts` | The catalog: groups, check IDs, steps and expectations (pure data; mounts load lazily) |
| `src/checks/*.ts` | One mount function per live canvas; each returns its cleanup |
| `src/build.ts` | The build identity the page shows and keys results to |
| `src/report.ts` | Result store, sitting summary and the optional Markdown export |
| `src/main.ts` | Runner: list, check page, live canvas, result controls, environments, export |
| `build-identity.ts` | Reads the identity from Git and the manifests (Vite plugin) |
| `test/` | Catalog, store, summary and export tests (`npm test -w webmusic-test`) |

Add a check by adding a catalog entry and, if it needs a new composition, a
mount function. Every check has a live canvas of package components; use
Arabesque through the shared loaders in
`apps/doc/webmusic/src/components/headless/`. `npm run check:demo-music` scans
this app's source too. A check's canvas follows the
[visual design](../../dev/design/VISUAL-DESIGN.md): the real controls only, with
settings and readouts in Parameters. The runner separates every component in a
canvas by one gap (`--mt-gap`), including the members a desk composes, so a
mount function adds no spacing of its own.

## Verify

```bash
npm run typecheck -w webmusic-test
npm test -w webmusic-test
npm run check:acceptance
```

`check:acceptance` (part of `npm run check`, so CI runs it) builds the runner
into `apps/test/dist/`, which git ignores, with the read-only Arabesque files
and a `build-info.json`. A green build does not stand in for the manual checks.
