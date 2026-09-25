# Design prototypes

This directory preserves exploratory visual artifacts alongside their design
history. They demonstrate proposed interaction and appearance; they do not
define the current public component contract or establish production behavior.
Use [the development map](../README.md) and [STATUS](../STATUS.md) for current
guidance and implementation gaps.

| Prototype | Context | Current reference |
|---|---|---|
| [Harmony Workbench](harmony-workbench.html) | Self-contained HTML exploration of the earlier Chordio workbench, documented in the [analysis workbench design](../plans/analysis-workbench-design.md) | [Analyze component design](../design/ANALYZE-COMPONENTS.md), [View component design](../design/VIEW-COMPONENTS.md) and the owning public pages in [COMPONENTS](../COMPONENTS.md) |

The Harmony Workbench file can be opened directly in a browser without a
package build. Its scripted demo state, timing and visual composition are
prototype behavior. Do not use it as evidence of the library's playback
algorithms, resource cleanup, accessibility or current component inventory.
The repository's generated Markdown/MDX map discovers this index; it does not
validate the linked HTML's interactions or rendering.

When retaining another prototype, link its design record and state its input,
execution requirements and known limitations. Record actual browser evidence in
[audits](../audits/README.md). Move reusable implementation into its owning
package and document the implemented contract before presenting it as supported
library behavior.
