---
name: webmusic-frontend-review
description: Build, review or repair any visible WebMusic UI — presenters, Element surfaces, toolbars, popups, live demos — to the required visual design, with responsive sizing, UIKit reuse, focus and clipping checks. Use whenever UI is added or changed, not only when a review is requested.
---

# WebMusic frontend review

Read [Visual design](../../../dev/design/VISUAL-DESIGN.md) before writing or
changing UI code and build to it; its acceptance checklist is part of done.
Follow the [frontend workflow](../../../.agent/workflows/frontend-review.md)
for the actual component, modes and route. Begin with screenshots and behavior
from an available browser, then inspect the owning presenter and renderer.
If only DOM/source inspection is possible, label that evidence accurately.

Use [UI contracts](../../../packages/ui/README.md) and
[design principles](../../../dev/DESIGN-PRINCIPLES.md) to locate existing tokens,
parts, handles and reusable presentation. Fix a library sizing defect at its
owner rather than relying on corrective demo-only CSS.

Inspect the host's container in composed layouts, not just the viewport.
For time-based plots, verify clipping, scroll, drawing and pointer coordinates
together. Element demos show the default composition (no Parameters); Headless
and presenter demos keep external Parameters. Intrinsic musical controls such
as seeking and note input remain interactive.

Preserve review-only scope. For authorized fixes, verify the same scenarios
afterwards and report tested sizes, focus behavior, modes and screenshots.
Rendered evidence does not establish audible timing, microphone/MIDI behavior
or screen-reader acceptance. Use the workflow's corresponding checks where
those are in scope.
