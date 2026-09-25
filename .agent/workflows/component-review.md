# Component review

Use for a bounded algorithm, architecture or component review, with fixes only
when the task authorizes them. Start from the user's requested capability and
checkout; this procedure does not start an Audio review or authorize publication.

## 1. Establish scope and owners

1. Read `git status --short` and `git branch --show-current`; preserve dirty work.
2. State the requested outcome, review-only or implementation scope, and the
   phases included. An architecture-only request ends before frontend changes.
3. Read [development entry](../../dev/README.md), [STATUS](../../dev/STATUS.md),
   [Architecture](../../dev/ARCHITECTURE.md) and [Decisions](../../dev/DECISIONS.md).
4. Use [COMPONENTS](../../dev/COMPONENTS.md) to locate source, exported types,
   tests, public references and existing composition rather than inventing APIs.

## 2. Decide the component boundary

1. Apply the [design template](../../dev/design/COMPONENT-DESIGN.md) and the
   applicable [family contract](../../dev/design/README.md).
2. Map each user task to its inputs, state, time authority, resources and UI.
   Compare actual ownership and lifecycle, not similar names or appearances.
3. Record a keep, merge, extract or retire recommendation for affected surfaces,
   with the observable benefit, compatibility cost and migration destination.
4. For playback followers, review [player binding](../../dev/design/PLAYER-BINDING.md).
   Identify which owner supplies data, snapshots, commands and cleanup.

## 3. Inspect algorithms and implementation

1. Follow the [Score review sequence](../../dev/log/2026-09-09-score-review-workflow.md).
   Trace normalization, matching or estimation, ranking and result projection.
2. Record units, valid ranges, defaults, rounding, ambiguous input and failure
   behavior. Separate mathematical contract correctness from empirical quality.
3. Create small reproducible probes with expected and actual results, boundaries
   and counterexamples. Pin external sources to versions/commits; comparison
   agreement, repository reputation and self-checks are not accuracy measures.
4. Map state changes and resource acquisition through cancellation, replacement,
   stale completion, reentrancy and disposal. Record what remains borrowed.
5. For an authorized Audio task, adapt the [Audio brief](../../dev/log/2026-09-09-score-review-workflow.md#copyable-audio-execution-brief):
   examine PCM/sample frames, sample rate, channels, dB/reference conventions,
   windowing and permission lifetimes against actual APIs, not Score assumptions.

## 4. Implement only the authorized result

1. In review-only work, return findings with source locations, reproduction and
   bounded recommendations; do not silently convert the review into edits.
2. Otherwise implement the chosen contract and meaningful regression cases,
   including failed replacement and repeated cleanup where applicable.
3. Reconcile exports, policies, catalogs, demos and owning references through
   [documentation maintenance](docs-maintenance.md); record shared decisions
   and remaining gaps with their existing owners.
4. If frontend work is included, continue with [frontend review](frontend-review.md).
   Otherwise deliver the completed algorithm/architecture phase and stop there.

## 5. Verify and hand off

Follow [Development](../../dev/DEVELOPMENT.md) for focused and final gates,
coordinating builds with other writers and consumers. Report scope, decisions,
changed contracts, reproducible evidence, commands/results and unverified work.
Keep source/DOM, browser and audio/device evidence separate. Phase boundaries do
not add approval gates; use existing authorization. Commit, push, merge or publish
only when included in the task, never as an automatic conclusion to this workflow.
