# Review workflow records

This directory preserves dated accounts of how a review was carried out:
the order of decisions, evidence used, corrections made, and a reusable brief
for a similar task. A workflow record can explain why a process worked or where
it stopped; it does not certify another branch or a later implementation.

Current product and architectural guidance belongs to the owners linked from
[the development entry point](../README.md). [STATUS](../STATUS.md) owns current
implementation gaps. [Audits](../audits/) hold dated findings and verification
results. Public references own API contracts; these logs link to them rather
than maintaining another member or component inventory.

| Record | Purpose |
|---|---|
| [First-release branch split — 2026-09-10](2026-09-10-first-release-split.md) | Audio/Bridge preservation on dev, three-package main release scope, original work preservation and independent verification. |
| [Shared agent guidance synchronization — 2026-09-09](2026-09-09-agent-guidance-sync.md) | Toolkit and documentation distribution across branches, preservation boundaries and per-baseline verification. |
| [Score review workflow — 2026-09-09](2026-09-09-score-review-workflow.md) | Analyze, View and Play review sequence, evidence boundaries, and an execution brief for a future Audio review. |
| [Original main work integration — 2026-09-09](2026-09-09-main-work-integration.md) | Reconciliation of the preserved main drafts with the Score review, including shared playback contracts, navigation and delivery checks. |

When adding a record, name the source baseline and task scope, distinguish
observed behavior from accepted design, and identify unverified work. Link
durable evidence and owning decisions. Do not turn old test totals, temporary
screenshots or a successful merge into a claim of current browser, device or
algorithm acceptance.
