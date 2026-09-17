# WebMusic agent skills

The [webmusic skill](webmusic/SKILL.md) helps a coding agent develop applications
with the public WebMusic packages. It covers Web Components, Headless behavior,
API-only operations and API + UI composition. Its bundled instructions target
Kernel, UI Kit and Score `0.1.0`; installed exports and declarations remain the
authority for the application being changed.

The skill is separate from the npm packages. Installing `@webmusic/score` does
not install or activate agent instructions. No MCP server is required.

## Use a local copy

1. Obtain a source checkout or archive that contains this `skills/webmusic/`
   directory. Copy the **whole directory**, including `scripts/`, `references/`,
   `evals/` and `LICENSE`, into the skill directory supported by your coding agent.
   Choose a new `webmusic` destination rather than overwriting an existing skill
   without reviewing it.
2. Follow the agent client's normal skill discovery or reload procedure. Confirm
   that its skill list shows `webmusic`; a folder in an arbitrary project
   location does not activate a skill by itself.
3. Ask the agent to use the `webmusic` skill and describe the application change.
   Where the client supports named invocation, select it through that client's
   skill picker or invocation syntax.

For example, after choosing an existing client skill directory, copy from this
repository root (replace the example destination):

```sh
cp -R skills/webmusic /path/to/agent-skills/webmusic
```

If the client has no skill loader, attach or explicitly ask it to read the
copied `webmusic/SKILL.md` and follow its linked references. This is manual
context loading, not automatic discovery.

Example task:

> Use the webmusic skill in my Vite application. Add a MIDI player, following
> staff view and keyboard readout. Keep one playback owner, use the built-in
> oscillator and show file-load and playback errors. Verify pause, seek and
> cleanup using the installed package version.

This local-copy route is usable from a checkout containing these files.
Repository-based installers additionally require the skill directory to exist
at the public Git ref they fetch. Check that ref before choosing a remote
installation route; a local change does not establish remote availability.

### Optional Skills CLI

The [Skills CLI](https://github.com/vercel-labs/skills) can install from a local
folder and guide you through client selection. Run this from your **application
directory**, replacing the source path with the checkout that contains the
skill:

```sh
npx skills add /path/to/WebMusic/skills/webmusic --copy
```

Select the intended agent and project scope in the prompts. `--copy` keeps the
installed folder independent of the WebMusic checkout. The local source was
verified with the CLI's `--agent universal --copy --yes` mode in a separate
application directory; other clients' discovery behavior remains their own
contract. Running the CLI may download it from npm. The manual-copy option
above does not require this tool.

## Context, updates and project instructions

The skill contains workflow guidance and public reference links, not a complete
offline API manual. API lookup normally needs network access; an installed
package's exported declarations can establish available members when offline.
Do not infer an undocumented method from a similar library.

The skill includes six read-only lookup commands, with no npm dependencies:

```text
skills/webmusic/
├── SKILL.md
├── LICENSE
├── scripts/
│   ├── list_components.mjs
│   ├── get_component_docs.mjs
│   ├── get_source.mjs
│   ├── get_styles.mjs
│   ├── get_theme.mjs
│   ├── get_docs.mjs
│   └── _context.mjs
├── references/
└── evals/
```

Use Node 22.19.0 or later. For example, from the installed skill folder:

```sh
node scripts/list_components.mjs --kind element
node scripts/get_component_docs.mjs element/score-player
node scripts/get_docs.mjs patterns
```

The commands check context versions and content hashes. They retrieve public
docs, styling contracts and selected implementation entry files, and accept
`--context-dir` for a complete offline site snapshot. See the
[lookup command reference](webmusic/references/scripts.md) for the full interface
and source/style boundaries. The shared `_context.mjs` module must stay beside
the six commands.

Record the source ref when copying a skill. To update, compare a newer complete
folder with your installed copy and review its runtime compatibility. Updating
the skill does not require upgrading the application's runtime dependencies.

For persistent project guidance, copy the relevant section from
[the public project-instruction page](https://koperative-lab.github.io/WebMusic/agent-toolkit/agents-md/)
into the application's
existing `AGENTS.md` or `CLAUDE.md`, according to its agent client. Preserve its
other rules and any symlink. This is
an independent manual option; installing the skill does not rewrite project
instructions.

## Maintain and verify

- Keep local links inside `webmusic/` so a copied skill is self-contained.
- Update compatibility metadata and public reference links when supported
  runtime contracts change. Keep detailed APIs in their owning documentation.
- Review the [behavioral cases](webmusic/evals/scenarios.md) with a copied skill
  and independently installed public packages. Record actual checks and browser
  observations; these cases are acceptance prompts, not claims of passing runs.
- Keep copyable project instructions in their public documentation page.

See the [Agent Toolkit documentation source](../apps/doc/webmusic/src/content/docs/agent-toolkit/index.mdx)
for the corresponding user-facing guide.
