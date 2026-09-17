# Query WebMusic context

Run these commands with Node 22.19.0 or later. They use only built-in Node
modules; installing the skill does not require `npm install`. Paths below are
relative to the copied skill folder. From an application directory, use the
absolute path to the installed script instead.

## Choose a lookup

| Command | Result |
|---|---|
| `node scripts/list_components.mjs` | IDs and reference paths for Web Components, Headless objects and UI presenters |
| `node scripts/get_component_docs.mjs element/score-player` | The owning player reference, including setup and lifecycle |
| `node scripts/get_source.mjs element/score-player` | Selected implementation entry files from the verified release |
| `node scripts/get_styles.mjs element/score-player` | Public styling reference: tokens, parts and presenter bindings |
| `node scripts/get_theme.mjs` | Shared theming documentation and selected token/style implementation files |
| `node scripts/get_docs.mjs /score/api/react/` | A documentation page selected by its site route |

`list_components.mjs --kind headless` narrows discovery; `--kind element` and
`--kind ui` select the other integration layers. Add `--json` for structured
results. Use the returned exact ID in the component commands; one musical
capability can have different Element, Headless and presenter contracts.

Source output is for implementation inspection. It contains selected entry
files, not every imported file, and does not grant a public import path. Use
installed `exports` and declarations for application imports. Styling output is
reference text, not an installable stylesheet. Headless objects have no visual
styling contract; choose a UI presenter or Element when styling the interface.
Source and theme command output includes the bundled MIT license notice so it
stays with source excerpts saved or passed to another tool.

## Start with an index or task bundle

```sh
node scripts/get_docs.mjs index
node scripts/get_docs.mjs components
node scripts/get_docs.mjs patterns
node scripts/get_docs.mjs full
```

Start with `index` to locate the owning page. `components` covers Web Components,
Headless objects and UI presenters. `patterns` covers common composition and
integration tasks. Use `full` when the task needs the complete public manual and
the agent has enough context space. Filenames such as `llms-patterns.txt` and
generated page paths such as `agent-context/score/api/react.md` also work.

## Select a context source

The default site root is `https://koperative-lab.github.io/WebMusic/`. Each
command accepts `--base-url` for another deployment, including a local preview:

```sh
node scripts/get_docs.mjs patterns --base-url http://localhost:4321/WebMusic/
```

For offline use, keep a complete generated documentation site together,
including `agent-context/manifest.json`, the catalog, selected source files and
the Markdown outputs. Point `--context-dir` to its root, not its
`agent-context/` subdirectory:

```sh
node scripts/list_components.mjs --context-dir /path/to/documentation-site
node scripts/get_component_docs.mjs element/score-player --context-dir /path/to/documentation-site
```

A single downloaded `llms.txt` or bundle can be attached directly to an agent;
it is not a complete offline snapshot for these scripts. `--base-url` and
`--context-dir` are alternative sources and cannot be combined. `--help` works
without fetching or reading context.

## Versions, output and failures

The scripts require context for Score, UI Kit and Kernel `0.1.0`, then verify
each fetched output against the manifest's SHA-256 hash. This detects mixed or
incomplete builds; it is not an independent signature of the documentation
publisher. Compare the target application's installed package versions yourself.
The scripts do not inspect or change the application's dependencies.

Successful results go to standard output; failures go to standard error with a
nonzero exit code. They do not write application files, install dependencies or
modify agent instructions. Requests time out after 30 seconds and redirects
are rejected; pass the final documentation site root when a host redirects.

- **Unknown ID or route:** run the list or index command and select its exact
  returned ID or route. Package names are not component IDs.
- **Version mismatch:** obtain matching context and skill guidance. Do not
  upgrade the application merely to make a lookup succeed.
- **Hash mismatch or missing file:** refresh the complete snapshot. Do not mix
  a manifest with files from another build.
- **HTTP or network failure:** confirm the toolkit is available at the chosen
  site root, use a complete local snapshot, or read the owning public page and
  installed declarations. Do not guess unavailable API members.
