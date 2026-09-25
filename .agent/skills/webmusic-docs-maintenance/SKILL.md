---
name: webmusic-docs-maintenance
description: Maintain WebMusic public API references, live-demo documentation, developer guides, document moves, and generated navigation when source contracts or documentation ownership change.
---

# WebMusic documentation maintenance

Use the [documentation workflow](../../../.agent/workflows/docs-maintenance.md).
Start from [dev ownership](../../../dev/README.md), then select the applicable
[public-page template](../../../dev/docs/README.md). Do not load all templates
for an ordinary guide edit.

Reconcile implementation, exported types, owning reference and catalogs rather
than treating a passing name/link scan as complete API coverage. Generated
inventories derive from source; update their inputs and use `docs:sync`.

For a move, check relative outbound paths, inbound links, anchors and script
messages. Include `.agent/` explicitly in searches. Keep `AGENTS.md` as the
canonical instruction entry, and preserve historical bodies and raw evidence.

Use the existing checks from [Development](../../../dev/DEVELOPMENT.md).
Coordinate builds before snippet consumers read declarations. Keep the final
report precise about link validation, example compilation, browser execution
and any unverified semantics. A documentation task does not automatically
authorize publication or client-configuration changes.
