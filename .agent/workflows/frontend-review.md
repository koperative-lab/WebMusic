# Frontend review

Use when frontend inspection or repair is in scope. Preserve review-only requests;
otherwise carry authorized fixes through verification. This workflow does not
install browser tooling or authorize commits, pushes or publication by itself.

## 1. Define the surface and evidence

1. Inspect `git status --short`, the current branch and affected changes.
2. Read [Design principles](../../dev/DESIGN-PRINCIPLES.md), the applicable
   [component contract](../../dev/design/README.md) and [STATUS](../../dev/STATUS.md).
3. Locate the real component, UIKit presenter, owning page and live demo through
   [COMPONENTS](../../dev/COMPONENTS.md). List the modes and interactions in scope.
4. Record the source revision, fixture, browser/version, theme and container
   dimensions. Use existing authorized browser tools and a reproducible route.

## 2. Capture the baseline before changing layout

1. Capture real screenshots of the reported state before editing. Include the
   full containing layout and a focused image where overlap or clipping occurs.
2. Candidate container widths are 320, 480, 768 and 1280 CSS px; choose relevant
   widths and the reported failure width rather than treating these as mandates.
3. Inspect the component in ordinary block, flex and grid composition, not only
   in a full-window demo. Measure the actual container and scroll dimensions.
4. Exercise long labels, sparse/dense data, applicable modes, empty/loading/error
   states, two instances and real light/dark parents. Inspect keyboard focus.
5. For moving surfaces, record time samples, playhead/note coordinates and scroll
   offsets as well as screenshots; a still image cannot prove synchronization.
6. If browser access is unavailable, report that boundary. Continue useful source
   or DOM inspection without labeling it rendered-layout acceptance.

## 3. Diagnose and make the smallest reusable repair

1. Trace sizing, overflow and stacking from host through presenter to drawing.
   Identify the element causing clipping, overlay or an unusable control target.
2. Reuse existing UIKit options, tokens, parts and handles. Place a reusable
   layout repair with its owner; avoid demo CSS that hides a library defect.
3. Check host `hidden`, minimum sizing, long-label wrapping and type switching.
   Preserve readable notation/keys with local scrolling where fitting would
   shrink them excessively; keep pointer coordinates aligned with the plot.
4. Put demo configuration in external Parameters while preserving intrinsic
   musical controls such as seeking, note input and direct plot gestures.
5. Verify each parameter affects its intended instance/mode. Preserve inactive
   mode values, accurate copied markup, visibility settings and Reset behavior.
6. Remove redundant framing only when the remaining surface retains orientation,
   accessible names, status feedback and operable focus targets.

## 4. Verify the repaired interaction

1. Add focused regressions when changed behavior, targeting, cleanup or geometry
   needs durable coverage; use rendered checks for a simple visual adjustment.
2. Repeat the baseline scenarios and capture matching after screenshots. Check
   focus order/visibility, keyboard operation, disabled state and pointer cancel.
3. Inspect nearby modes and compositions affected by shared UIKit changes.
   Confirm the ordinary host works without corrective demo-only display rules.
4. Run the applicable gates from [Development](../../dev/DEVELOPMENT.md); coordinate
   package builds before consumers read declarations or generated output.

## 5. Report the actual result

Link evidence and source changes; explain the defect, repair, tested dimensions
and remaining limitations. Follow [documentation maintenance](docs-maintenance.md)
for contract changes. Separate browser evidence from DOM tests, screen-reader
acceptance and real audio/device measurements. Use existing task authorization;
do not introduce a new approval checkpoint merely because a phase has ended.
