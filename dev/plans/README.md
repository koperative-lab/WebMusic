# Historical plans

This directory preserves proposals, implementation briefs and earlier review
snapshots. Their component lists, phase order, source-line citations and uses of
“current” describe the recorded baseline. They are not instructions to resume an
old backlog or evidence that a proposed capability shipped.

Start new work from [the development map](../README.md), [STATUS](../STATUS.md)
and [accepted decisions](../DECISIONS.md). Use the current
[component design contract](../design/COMPONENT-DESIGN.md) for a new capability.
The [Score review workflow](../log/2026-09-09-score-review-workflow.md) provides
an execution brief for an Audio review; these older expansion plans supply
context rather than its scope.

| Record | Historical scope | Current starting point |
|---|---|---|
| [Analysis workbench design](analysis-workbench-design.md) | Chordio workbench proposal and its visual prototype | [Analyze design](../design/ANALYZE-COMPONENTS.md) |
| [Analysis implementation brief](analysis-workbench-implementation-brief.md) | Source comparisons, implementation choices and verification notes | Analyze design and the owning references in [COMPONENTS](../COMPONENTS.md) |
| [Analysis workbench wiring](analysis-workbench-wiring.md) | Earlier composition and dependency proposal | [Architecture](../ARCHITECTURE.md) and [player binding](../design/PLAYER-BINDING.md) |
| [Score Analyze expansion](score-analyze-elements.md), [Score View expansion](score-view-elements.md) | Earlier element selection and expansion phases | [Analyze design](../design/ANALYZE-COMPONENTS.md) and [View design](../design/VIEW-COMPONENTS.md) |
| [Audio Analyze expansion](audio-analyze-elements.md), [Audio Play expansion](audio-play-elements.md), [Audio View expansion](audio-view-elements.md) | Earlier Audio element proposals and implementation corrections | [STATUS](../STATUS.md), [product direction](../PRODUCT.md) and [architecture](../ARCHITECTURE.md); Audio implementation and public references are outside this checkout |
| [Documentation site backlog](docs-site-backlog.md) | Earlier documentation work and completion notes | [Site plan](../docs/DOCS-SITE-PLAN.md), [conventions](../docs/DOCS-CONVENTIONS.md) and STATUS |
| [Repository review — 2026-08-22](repo-review-2026-08-22.md) | Earlier source and documentation findings | STATUS and the later [audit records](../audits/README.md) |

Preserve recorded bodies and their evidence. Add a dated navigation or correction
note when later work changes their interpretation; put accepted rules in their
current owner and remaining work in STATUS. New proposals should identify their
source baseline, scope and unresolved choices. Record completed review sequences
in [log](../log/README.md) and verification results in [audits](../audits/README.md).
