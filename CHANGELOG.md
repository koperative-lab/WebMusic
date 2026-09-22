# Changelog

User-facing changes are recorded here. An Unreleased entry describes repository
work and does not establish npm publication, a release tag or a deployment.

## Unreleased

- Prepare the first public source and npm release for `@webmusic/kernel`,
  `@webmusic/ui` and `@webmusic/score`.
- Include contributor, security, development and release guidance in the public
  source tree without requiring ignored local agent settings.
- Harden package-consumer, dependency, asset-license and documentation checks
  used during release preparation.
- Preserve Score model identity across CommonJS subpaths and repair strict
  TypeScript consumption of the Element and browser-global entries.
- Include complete bundled dependency notices and font licensing; replace
  unverified demo resources with original music and oscillator synthesis.
- Upgrade the documentation and test toolchain, add Node 22.22.3/24 CI and
  reject missing or stale package output before packing.
- Adopt Astro's ESLint 3 plugin with ESLint 10 and its supported development
  Node versions, retaining project diagnostics through `astro check`.
- Adopt ESLint 10's JavaScript rules with scoped compatibility exceptions for
  retained release sources; preserve original errors in Agent Toolkit helpers.
- Keep Agent Toolkit release verification stable across development dependency
  updates while retaining runtime source and package contract checks.
- Resolve optional SoundFont and OSMD dependencies in browser production
  builds; require the supported Spessa 4.x API and remove obsolete SoundFont
  inspection documentation.
- Export playback tempos as valid MusicXML sound elements, preserving measure
  timing and preventing OSMD sheet engraving from failing on spanning slurs.
- Track ancestor and alternate tsup configurations when checking package
  freshness before packing.
- Generate production-site notices from bundled modules, styles and embedded
  dependencies, with per-file notice references and integrity checks.
- Retain local documentation search with a built article index and keyboard
  navigation, replacing the Pagefind browser runtime.
- Remove the unused local font and static license copies; keep asset provenance
  in source configuration and embed original-resource licenses in downloads.
- Run quality checks and a documentation build on every branch push and pull
  request; deploy GitHub Pages from successful official `main` runs, with a
  manual workflow trigger and deployment permissions limited to the deploy job.

No published release is asserted by this changelog. Follow the
[publishing procedure](CONTRIBUTING.md#releasing) to verify release identity and
record a versioned release after publication has been confirmed.
