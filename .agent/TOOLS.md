# Recommended development tools

Recommendation baseline: repository manifests, scripts and current guidance
inspected on 2026-09-09. This is a tool-selection guide, not an installation
manifest or another backlog. [STATUS](../dev/STATUS.md) owns implementation gaps.

## Priorities

| Priority | Capability | What to use | Status and first useful application |
|---|---|---|---|
| Now | Source and contract verification | Git, ripgrep, TypeScript, ESLint and the existing policy scripts | Already used by this project. Trace public entries, layers and state ownership before changing component boundaries. See [Development](../dev/DEVELOPMENT.md). |
| Now | Deterministic musical regression tests | Existing workspace Vitest tests and the [Audio review brief](../dev/log/2026-09-09-score-review-workflow.md#copyable-audio-execution-brief) | Score, Kernel and UI tests are present. Audio fixtures have not been migrated into this checkout; add known tones, silence, click trains and seeded noise with independent expected outputs and stated error tolerances when reviewing Audio. |
| Now | Rendered component review | The session's available browser-control tool, browser developer tools and screenshots | Agent/browser access depends on the client. Exercise actual docs demos and embedded container widths; jsdom is not rendered-layout evidence. |
| Next | Repeatable browser acceptance | Playwright Test in the docs workspace | No direct project dependency or test script is currently declared. Begin with a few representative player/view/analyze compositions, then preserve traces and useful visual assertions. |
| Next | Accessibility regression | axe-core with the browser runner, plus keyboard and screen-reader review | No direct project dependency is currently declared. Start with names/roles, focus, disabled/hidden states and representative interactive controls. |
| Next | Real Web Audio output measurements | A browser harness using OfflineAudioContext, alongside existing Vitest math/lifecycle tests | Recommended harness, not delivered by this setup. Measure rendered samples and graph transitions; keep real-time device timing as a separate procedure. |
| On demand | Animation and memory diagnosis | Browser Performance and Memory tools | Profile a reproducible dense score or long Audio clip before adding an optimization. Record the browser, workload and trace. |
| On demand | Upstream and change review | Read-only GitHub connector or `gh`, and official documentation lookup | `gh` and `rg` are available on the inspected machine, not guaranteed on another checkout. Use actual versions/commits for comparison and choose one working connector. |

Playwright supplies screenshot, DOM and accessibility snapshot assertions.
That makes it a useful candidate for recurring layout regressions; it is not
currently part of this repository's gate.
[Playwright assertions](https://playwright.dev/docs/test-assertions).
Its accessibility guide uses axe-core and explicitly combines automation with
manual assessment; a clean scan alone is insufficient.
[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).

OfflineAudioContext renders a graph to an AudioBuffer rather than the device.
That makes sample inspection possible but does not validate microphone/MIDI
permissions, live suspend/resume or audible latency.
[MDN OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext).
DevTools performance recordings can expose rendering and main-thread work;
use them when profiling identifies an actual bottleneck.
[Chrome runtime performance](https://developer.chrome.com/docs/devtools/performance).

## Skills worth keeping

| Skill | Why this project benefits |
|---|---|
| [webmusic-component-review](skills/webmusic-component-review/SKILL.md) | Keeps algorithms, time units, resources and retain/merge/extract choices together without duplicating design rules |
| [webmusic-frontend-review](skills/webmusic-frontend-review/SKILL.md) | Makes container width, real screenshots, UIKit reuse and meaningful demo controls explicit |
| [webmusic-docs-maintenance](skills/webmusic-docs-maintenance/SKILL.md) | Routes source/types/reference changes through the existing generators and checkers |

If supplied by the agent environment, reuse a skill creator for skill changes,
a product-design audit skill for a visual/UX audit, and official documentation
lookup for unfamiliar tool configuration. A Figma integration becomes useful
when there is an actual Figma design to implement. These are conditional
capabilities, not required packages or claims that every contributor has them.

For third-party algorithm comparisons, pin the upstream implementation and
identify its input assumptions. Agreement with one library is supporting
evidence, not ground truth. Reuse the
[Audio review dimensions](../dev/log/2026-09-09-score-review-workflow.md#copyable-audio-execution-brief)
for sample rates, windows, channel handling, amplitude and timing.

## Rules, workflows, helpers and agents

- **Rules:** keep the [owner map](rules/README.md) small. Accepted architecture
  and UI contracts stay in `dev/`; executable policy stays in existing scripts.
- **Workflows:** use the three task procedures linked in [README](README.md).
  They can be followed by a human or agent and do not create scheduled jobs.
- **Helpers:** the next useful helper would validate named audio fixtures with
  explicit metrics, or capture a reproducible browser matrix. Add it alongside
  the owning tests when implementing that harness, not as an empty scaffold.
- **Subagents:** delegate independent source/algorithm inspection, documentation
  reconciliation, and browser review when those phases are in scope. Give each
  writer distinct files. One coordinator controls builds because they replace
  `dist/`. Start with task delegation; a persistent client-specific agent profile
  is useful only when a repeated role benefits from one.
- **Hooks and MCP:** use existing shell/browser/GitHub tools first. If a repeated
  failure justifies a hook, begin with a narrow local check; preserve the normal
  final gate. Add a connector only for a concrete unavailable capability. No
  blanket approval rules, automatic commits, pushes or publishing are proposed.

## Add only when there is evidence of value

The first addition I recommend is a small browser acceptance suite around real
Astro demos, followed by audio-output measurements for the capability being
reviewed. Keep both distinct from the existing DOM and clock mocks.

Avoid another test framework or documentation inventory, Storybook solely to
duplicate the live demos, and a second UI kit beside `@webmusic/ui`. Do not install
every optional MIR/decoder/synth backend for a general review; select resources
from the actual entry contract and existing license policy. An `analyze` module
here concerns musical analysis and does not by itself call for business-data
analytics tools.
