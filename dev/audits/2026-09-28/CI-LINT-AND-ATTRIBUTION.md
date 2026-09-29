# Local CI lint and attribution repair

**Baseline:** the `dev` working tree based on `ae0742a`, with its five-package
migration still uncommitted, and a separate local `main` worktree based on
`1e0fb7b`. Checks below ran on 2026-09-28 with Node 24.21.0. They do not
describe a remote CI run for either changed tree.

Seven Score/UI lint diagnostics were repaired in both local trees without
disabling rules. The fixes remove unused assignments, release the first-pass
MXL manifest by ending its scope before score extraction, and retain the
original OSMD load error as `cause`. Main's seven now-unused ESLint suppression
entries were pruned; the archived release-script suppressions remain. Project
LICENSE names and package `author` fields were aligned to **Koperative** in the
workspaces present in each tree. Third-party notices and historical evidence
were not rewritten.

## Verification

| Checkout | Result |
|---|---|
| `dev` working tree | `npm ci`, `npm run check`, `npm run pages:build`, `npm run check:external-install`, and `npm run audit:dependencies` passed on Node 24. The external consumer imported 168 ESM/CommonJS entries and checked public declarations without `skipLibCheck`; the dependency audit reported zero vulnerabilities. |
| Local `main` worktree | `npm ci`, `npm run lint`, Score/UI source typechecks, and Score/UI tests passed (2,115 Score and 585 UI tests). `npm run check` reached documentation tests, where five agent-context tests rejected changed package source/metadata against the unchanged published `0.1.0` release baseline. |

The main agent-context guard is intentional: its verified mapping fingerprints
source and package manifests, not just API names. No version, verified release
mapping, tag, registry package or remote branch was changed here. Integrate the
main patch and update that mapping only with a reviewed release identity chosen
by the release owner; then run the complete main gate and remote CI on its
commit. These local checks do not establish browser, device or acoustic
acceptance for Audio/Bridge.
