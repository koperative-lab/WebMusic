# Rule ownership

This directory maps engineering rules to their current owners. It contains no
independent architecture policy, client permission configuration or auto-loaded
rule file. Start from [AGENTS.md](../../AGENTS.md), the sole instruction entry.

| Topic | Authoritative guidance | Existing enforcement or evidence |
|---|---|---|
| Scope, working-tree preservation and workflow | [AGENTS](../../AGENTS.md), [Development](../../dev/DEVELOPMENT.md) | Git status/diff and the actual requested task |
| Product and accepted choices | [Product](../../dev/PRODUCT.md), [Decisions](../../dev/DECISIONS.md) | Design review; current delivery is recorded in STATUS |
| Domains, source layers and public entries | [Architecture](../../dev/ARCHITECTURE.md) | `check:architecture`, package policy and export checks |
| Component responsibility and composition | [Component design](../../dev/design/COMPONENT-DESIGN.md), [family designs](../../dev/design/README.md) | Owning types, tests, composition catalogs and reviewed use cases |
| Time, data and resource ownership | [Player binding](../../dev/design/PLAYER-BINDING.md), [shared-clock design](../../platform/shared-clock-injection.md) | Scheduler/attachment/lifecycle regressions; real-time acceptance remains separate |
| UI behavior and styling | [Design principles](../../dev/DESIGN-PRINCIPLES.md), [UI contracts](../../packages/ui/README.md) | Presenter tests plus actual browser, keyboard and device evidence |
| Reference and demo accuracy | [Conventions](../../dev/docs/DOCS-CONVENTIONS.md), [page templates](../../dev/docs/README.md) | Existing documentation gates, snippets and manual semantics review |
| Versions and publication | [Release guides](../../dev/release/README.md) | Manifest/export checks and the release procedure's external verification |

When a rule changes, update its owner and applicable check. Skills link to that
rule instead of copying it. Use current user instructions to determine the
requested scope; a workflow example does not authorize unrelated mutations.

The word "rules" here means engineering guidance. Codex command-execution rules
use a separate `.rules` format and control whether commands may execute outside
the sandbox; Markdown in this directory does not configure that mechanism.
[Official Codex rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules).

Return to the [toolkit](../README.md).
