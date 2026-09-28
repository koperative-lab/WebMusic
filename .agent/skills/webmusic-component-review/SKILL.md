---
name: webmusic-component-review
description: Review WebMusic Score or Audio algorithms, playback lifecycles, and component boundaries when auditing a capability or deciding which components to retain, merge, extract, or retire.
---

# WebMusic component review

Use the [component review workflow](../../../.agent/workflows/component-review.md)
for the agreed capability and phases. Read [AGENTS](../../../AGENTS.md) and the
current [design owners](../../../dev/design/README.md); these repository files
remain authoritative when this skill is loaded through a client adapter.

Start with task/data/time/resource differences. Similar presentation is a
reason to investigate a shared presenter or type, not enough to merge lifecycle
contracts. Pin upstream algorithm references and compare against independently
justified examples, units and tolerances. Borrowed players and contexts require
explicit subscription/replacement/cleanup reasoning.

For Audio, use the [Audio review brief](../../../dev/log/2026-09-09-score-review-workflow.md#copyable-audio-execution-brief)
and existing signal fixtures. Do not transfer Score's component inventory or
music-time assumptions into PCM processing. Check actual exported APIs.

Deliver source-located findings, reproducible probes, retain/merge/extract
reasoning and tested evidence. Implement fixes when the task includes them;
keep a read-only review read-only. If the user defers frontend review, finish
the requested algorithm/architecture phase without starting that phase.
