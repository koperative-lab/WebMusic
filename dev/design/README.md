# Component design contracts

These documents own component responsibilities and composition intent. Start
with [Product](../PRODUCT.md), [Design principles](../DESIGN-PRINCIPLES.md) and
[Architecture](../ARCHITECTURE.md). [Decisions](../DECISIONS.md) records accepted
choices; [STATUS](../STATUS.md) distinguishes delivery from target design.

| Contract | Use |
|---|---|
| [COMPONENT-DESIGN.md](COMPONENT-DESIGN.md) | Design questions, a copyable contract template and acceptance scenarios for any component |
| [PLAYER-BINDING.md](PLAYER-BINDING.md) | Borrowing Play data, state and time, including ownership, standalone use and open binding choices |
| [ANALYZE-COMPONENTS.md](ANALYZE-COMPONENTS.md) | Score's live analysis roles, sibling composition and Headless report boundary |
| [VIEW-COMPONENTS.md](VIEW-COMPONENTS.md) | Score's type-selected representations and separate engraving/view responsibilities |
| [STAFF-NOTATION.md](STAFF-NOTATION.md) | Written-time staff projection, beam grouping, glyph rendering and the boundary with page engraving |
| [PLAY-COMPONENTS.md](PLAY-COMPONENTS.md) | Score's playback, input and control roles with shared transport behavior |

The family records describe Score decisions; they are a comparison for an Audio
review, not evidence that Audio has the same components or has passed review.
Use the [review workflow and Audio starting brief](../log/2026-09-09-score-review-workflow.md)
to sequence algorithm, implementation, architecture and frontend acceptance.
Inspect Audio's actual source and public contracts before accepting the same
abstraction.

Find existing capabilities in [COMPONENTS](../COMPONENTS.md). Write public
member references using the [documentation templates](../docs/README.md).
Keep proposals in [plans](../plans/README.md) and dated findings in
[audits](../audits/README.md); promote accepted changes into their current owner.

Return to the [development entry point](../README.md).
