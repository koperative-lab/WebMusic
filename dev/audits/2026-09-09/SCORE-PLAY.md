# Score Play implementation audit — 2026-09-09

Scope: algorithm, implementation and component responsibility review on
`claude/analysis-view-chord-design-693b7b`. Frontend visual review was explicitly
deferred. [Play design](../../design/PLAY-COMPONENTS.md) and DEC-016 own current intent;
[STATUS](../../STATUS.md) owns open work.

## Findings addressed

- Audio-clock suspension no longer permits wall-clock onset callbacks to publish
  early notes. Reentrant pause/stop/seek/rate/loop commands preserve newer intent
  and tracked voice handles; listener seeks do not receive an older time update.
- Rack public seeks and time readback use the same facade as its UI. Rack nominal
  seeks reject rather than claiming a successful no-op. Borrowed controllers keep
  their existing rate on mount; only explicit property writes change it.
  Real engine operation failures reach the facade and Element error channel,
  without duplicate startup notifications or stale destroyed-handle callbacks.
  Mode switching preserves
  authored children; removed/replaced desks release the composed Rack binding.
- Recorder unisons pair FIFO. Source replacement discards unmatched presses;
  disconnect cancels active capture, reconnect retains the configured source,
  and bubbling cannot duplicate
  captured gestures. Input callback order and MIDI handler identity survive
  reentrant cleanup. Distinct recording voice names receive distinct PartIds.
- Synth Panel same-context DSP replacement preserves external port identities.
  Failed candidates retain the previous chain and clean partial resources.
  Non-audio section edits do not rebuild DSP, and stale parameter failures cannot
  roll back newer values or replacement descriptors.
- Rack part identity edits announce changes without refetching. Replaced/detached
  URL loads abort and stale completion is ignored; standalone declarations do not
  fetch without a desk.
- Play retains its five interactive roles plus one declaration. Conflicting
  component, mode, UIKit and lifecycle documentation is aligned with source.

## Verification

- `npm run docs:sync`: generated this checkout's inventories.
- `npm run check`: passed. All 2,767 tests in 229 files passed, including 1,596
  Score tests. Formatting, lint, architecture, documentation, declaration
  builds, source/test typechecking, licenses and release-manifest checks passed.
  All 158 scanned documentation snippets compiled; 89 public package entries
  passed export checks.
- `npm run docs:build`: passed with the updated package output and Play pages.
- `git diff --check`: passed.

Verification includes existing Analyze/View work in this shared branch; test
counts are dated evidence, not a maintained capability inventory. No unrelated
uncommitted work was reset or replaced.

## Evidence boundaries

No browser visual audit, audible timing measurement or physical MIDI test was
performed in this pass. Headless clock tests use controlled clocks; DOM tests
verify behavior rather than rendered layout. Rack still coordinates separate
member players; a shared AudioContext is not a common transport epoch. Rack
readback requires built timeline members, group rate/loop and a uniform companion
Score snapshot remain outside the implemented contract. JIT backend accuracy
still depends on main-thread wakeups and backend capabilities.
