# WebMusic agent toolkit

Project-local skills, workflow entry points and tool recommendations. This is
the requested repository-root `.agent/` directory, not a system directory.
[AGENTS.md](../AGENTS.md) is the instruction entry point.
[dev/](../dev/README.md) owns the project's accepted design, current status
and verification policy.

## Start here

| Resource | Use |
|---|---|
| [Tool recommendations](TOOLS.md) | Choose existing tools first; identify useful additions and what they would prove |
| [Rule ownership](rules/README.md) | Find the authoritative rule and its existing mechanical check |
| [Component review skill](skills/webmusic-component-review/SKILL.md) | Review musical algorithms, lifecycle and component boundaries |
| [Frontend review skill](skills/webmusic-frontend-review/SKILL.md) | Inspect actual rendering, responsive composition and UIKit reuse |
| [Documentation maintenance skill](skills/webmusic-docs-maintenance/SKILL.md) | Align public contracts, examples, navigation and generated indexes |
| [Component review workflow](workflows/component-review.md) | Run an architecture/algorithm phase, including Audio-specific evidence |
| [Frontend review workflow](workflows/frontend-review.md) | Run the rendered UI acceptance phase |
| [Documentation workflow](workflows/docs-maintenance.md) | Reconcile references and verify a documentation change |

For the next Audio review, start with the component review skill and the agreed
capability. Apply frontend review when that phase is in scope. The
[Score workflow and Audio brief](../dev/log/2026-09-09-score-review-workflow.md)
explain the reusable sequence; current Audio behavior still requires inspection.

## What is usable now

The three skills and workflows are instruction resources ready to read by path.
No new browser dependency, MCP server, scheduled task, hook, command-approval
policy or client discovery adapter is installed by this toolkit.

For example, give the agent this request from the repository:

```text
Read .agent/skills/webmusic-component-review/SKILL.md and use it to review
Audio/play algorithms and component architecture. Keep frontend acceptance
for the next phase. Preserve the current working-tree changes.
```

`.agent/` is our storage convention. Codex documents repository discovery in
`.agents/skills/`, including symlinked skill folders; a file existing here does
not itself make it available in the skill picker. See
[OpenAI's skill loading documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
Claude Code documents project skills in `.claude/skills/` and also supports
symlinked skill folders. See
[Claude Code skill locations](https://code.claude.com/docs/en/skills#where-skills-live).

If client discovery is wanted later, link each named skill directory from that
client's supported location to the canonical directory here. Preserve existing
client settings and verify discovery in that client. Do not maintain copied
skill bodies. These skills reference this repository and are not standalone
global skills. The repository currently ignores `.claude/`; a team-shared Claude
adapter would also need an intentional ignore-policy change.

## Keep the toolkit small

Skill descriptions select a task; workflows explain the procedure; rules link
to their owner. A new accepted contract belongs in `dev/`, not only in a skill.
Put findings in [audits](../dev/audits/README.md), work records in
[log](../dev/log/README.md), and remaining work in [STATUS](../dev/STATUS.md).

Add a helper script only for repeated, demonstrated work. Reuse root package
scripts instead of maintaining a second build/test runner. Client-specific
subagents, hooks and MCP configuration can be added when an actual workflow
needs them; this recommendation set does not change execution permissions.

When adding a resource, link it here or from an existing workflow. Run
`npm run docs:sync` and the documentation checks in
[Development](../dev/DEVELOPMENT.md). `.agent/` Markdown participates in the
repository inventory, local-link validation and maintained-navigation check.
