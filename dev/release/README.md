# Release guides

These guides own the current manual release procedure and version policy.
They do not establish registry availability, remote tag state or deployment.

| Document | Purpose |
| --- | --- |
| [Publishing](PUBLISHING.md) | Verify release identity, validate the checkout, publish in dependency order and verify delivery. |
| [Releasing](RELEASING.md) | Shared version policy, local quality gates and the active CI boundary. |
| [0.2.1 preparation notes](0.2.1.md) | Review corrections, shared version metadata and compatibility notes for the next source update. |
| [0.2.0 release preparation and migration](0.2.0.md) | Five-package upgrade notes, reviewed npm baseline and the manual publication checklist. |
| [Archived pipeline design](../../scripts/release-pipeline/DESIGN.md) | Historical candidate, staging, promotion and deployment design; not an active runbook. |

Current release gaps belong to [STATUS](../STATUS.md). Development commands and
final acceptance belong to [DEVELOPMENT](../DEVELOPMENT.md); accepted policy
changes belong to [DECISIONS](../DECISIONS.md).

Return to the [development entry point](../README.md).
