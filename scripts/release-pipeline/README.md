# release-pipeline (archive)

Historical release scripts and tests, retained as implementation evidence.
They are not connected to the root `npm run check` chain or to an active
publication workflow in this checkout. This describes local wiring, not the
outcome of any remote release or the availability of packages on npm.

Use the [manual release instructions](../../CONTRIBUTING.md#releasing)
for the current version policy and publishing procedure.
[DESIGN.md](DESIGN.md) preserves the archived candidate/staging/promotion and
deployment design alongside these scripts.

Before reusing any of this code, review these concrete mismatches:

- The archive's `release-packages.mjs` still lists thirteen pre-migration
  packages. The current dependency-safe order lives in
  [../release-packages.mjs](../release-packages.mjs).
- Historical root aliases, script locations, workflow files and artifact
  contracts do not describe the active manual flow. In particular, the root
  `check:external-install` is a separate implementation and does not accept
  the archived candidate-manifest interface.
- The archive's tests include expectations for release/promotion workflows
  and toolchain pins that are not present in the active CI configuration.
  They are historical evidence, not a substitute for the current gate.
- Repository slugs already mention `mrsteamedbun/WebMusic` in parts of the
  archive. Inspect each assumption when porting; do not infer that every
  script needs a repository-name replacement or that a matching slug makes
  the rest of the pipeline usable.

A future restoration needs its own reviewed design and verification against
the current manifests, policy and workflow configuration. The archived
commands must not be run as a ready-made publishing procedure.
