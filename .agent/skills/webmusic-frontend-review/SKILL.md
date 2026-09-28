---
name: webmusic-frontend-review
description: Review or repair WebMusic component rendering, responsive container sizing, UIKit reuse, focus, clipping, and live-demo Parameters when frontend acceptance is requested.
---

# WebMusic frontend review

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
together. External demo Parameters configure the surface; intrinsic musical
controls such as seeking and note input remain interactive.

Preserve review-only scope. For authorized fixes, verify the same scenarios
afterwards and report tested sizes, focus behavior, modes and screenshots.
Rendered evidence does not establish audible timing, microphone/MIDI behavior
or screen-reader acceptance. Use the workflow's corresponding checks where
those are in scope.
