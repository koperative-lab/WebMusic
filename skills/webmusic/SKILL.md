---
name: webmusic
description: Build or fix music interactions in applications using WebMusic's published Score, UI Kit and Kernel packages. Use for playback, notation, musical input, score analysis or custom interfaces with Web Components, Headless objects or API + UI composition.
license: MIT
metadata:
  runtime-compatibility: "@webmusic/score 0.1.0; @webmusic/ui 0.1.0; @webmusic/kernel 0.1.0"
---

# Develop with WebMusic

Use the application's existing framework, package manager and integration
choice. This skill supports package consumers; its bundled guidance does not
require a WebMusic source checkout or maintainer instructions.

## Establish the available contract

Inspect the application's manifest, lockfile and installed WebMusic package
versions. Read the relevant package `exports` and declarations before choosing
imports. A package subpath is an import, not a separate npm package. Resolve
version differences with matching references; do not silently upgrade the app
or assume the latest development documentation describes its installed API.

Start with the [context index](https://koperative-lab.github.io/WebMusic/llms.txt)
and inspect its version/revision metadata. Select the owning reference using
[integration choices](references/integrations.md); fetch only what the task needs.
Use the bundled Node scripts to list component IDs and retrieve verified
references, styling contracts or selected source files. Begin with
`node scripts/list_components.mjs` from this skill folder, then
`node scripts/get_component_docs.mjs element/score-player` for a chosen ID.
Read [lookup commands](references/scripts.md) for options, task bundles and
offline snapshots. These scripts need Node 22.19.0 or later and no npm install.
If generated context is unavailable, use [public setup](https://koperative-lab.github.io/WebMusic/score/)
and its linked references. Network or documentation failure
does not justify inventing members: use installed declarations and report the
specific missing contract when necessary.

The compatibility target is `0.1.0` of Score, UI Kit and Kernel. Audio and Bridge
are outside this skill's supported release surface. Headless means no UI DOM;
it does not guarantee that an audio operation runs in Node or during SSR.

## Build the requested interaction

- **Choose the composition:** Web Components for ready-made interaction,
  Headless for custom interfaces, API + UI for explicit bindings. API-only
  parsing and analysis need no UI. Read [integration choices](references/integrations.md)
  for entries, peers and browser boundaries.
- **For playback or followers:** read [playback and lifecycle](references/playback-and-lifecycle.md).
  Use one intended playback source for related views, name time units, start
  sound from user activation, and release only resources this composition owns.
- **For failures or unavailable features:** read [troubleshooting](references/troubleshooting.md)
  before replacing a backend, adding dependencies or changing the architecture.
- **For project instruction setup requested by the user:** copy the section from
  [project instruction guidance](https://koperative-lab.github.io/WebMusic/agent-toolkit/agents-md/)
  into the existing project `AGENTS.md`. Preserve surrounding rules. Skill use
  alone is not a request to create or rewrite instruction files.

Run the application's relevant typecheck/build/tests. For browser interactions,
exercise loading, the requested controls and teardown; separate observed UI and
cleanup behavior from unverified audible output, hardware permissions or timing
accuracy. Report concrete results and remaining limitations.

Maintainers evaluating a copied skill can use the
[application scenarios](evals/scenarios.md).
