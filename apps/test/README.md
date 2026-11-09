# Manual acceptance runner

`apps/test` (workspace `webmusic-test`) is a small standalone page for the
person who accepts WebMusic on real devices. It is not part of the
documentation site. Each check names what to do and what must hold, mounts its
own live composition of the real Elements and Headless objects, and records Pass,
Fail or Skip with notes for each tested environment. All musical material is
Arabesque No. 1, read from the documentation site's owner-maintained
[`public/`](../doc/webmusic/public/) folder. The runner only reads that folder.

The procedure and the dated record live in the
[MOD-15 device acceptance](../../dev/audits/2026-11-07-mod15-device-acceptance.md)
audit. [STATUS](../../dev/STATUS.md) VERIFY-01 owns the remaining gap.

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

## Use

1. **0 · Before you start**: fill in the environment (device, browser,
   output, microphone). Add a new environment for each further device or browser.
2. Work down the list. Follow **Steps**, compare with **Expected**, then choose
   **Pass**, **Fail** or **Skip** and write notes for a failure. Configuration and
   measurements a check needs are under **Parameters**, outside the component.
3. **Copy Markdown** produces the environment and result tables for the audit
   record. **Download JSON** keeps the raw record.

Results stay in this browser's `localStorage`. They are kept across sittings
but are not shared between devices; export from each device. The page shows a
warning when storage is unavailable.

## Structure

| Path | Role |
| --- | --- |
| `src/checks.ts` | The catalog: groups, check IDs, bilingual steps and expectations |
| `src/checks/*.ts` | One mount function per composition; each returns its cleanup |
| `src/main.ts` | Runner: list, check page, result controls, environments, export |
| `src/results.ts` | Result store, storage parsing and Markdown export |
| `test/` | Store and catalog tests (`npm test -w webmusic-test`) |

Add a check by adding a catalog entry, and a mount function if it needs a new
composition. Use Arabesque through the shared loaders in
`apps/doc/webmusic/src/components/headless/`. `npm run check:demo-music` scans
this app's source too. A check's component area follows the
[visual design](../../dev/design/VISUAL-DESIGN.md): the real controls only, with
settings and readouts in Parameters.

## Verify

```bash
npm run typecheck -w webmusic-test
npm test -w webmusic-test
npm run build -w webmusic-test
```

The build writes `apps/test/dist/`, which git ignores, and copies the read-only
Arabesque files there. A green build does not stand in for the manual checks.
