# Diagnose the failing boundary

| Symptom | Inspect first | Appropriate next step |
| --- | --- | --- |
| Package or subpath cannot resolve | Installed version, package `exports`, lockfile and chosen capability | Use an exported entry for that version; a source directory name is not an import contract. |
| Tag remains inert | Browser registration and matching tag name | Call the tag's registration function through its owning `/element` entry. Play auto registration does not cover View/Analyze. |
| UI entry reports a missing dependency | Its static imports and documented optional peers | Add the required peer for the requested feature, without installing unrelated backends. |
| No sound after a successful file load | User activation, command rejection, audio-context state and selected backend | Run start/resume from a user action; surface the actual failure and verify resource URLs. |
| View and sound disagree after a rate change | Nominal versus transport seconds and the shared playback source | Bind to the intended owner with a consistent axis instead of adding a second timer or player. |
| Old score appears after a new selection | Async result ordering and source revision | Cancel or ignore stale loads and release their newly owned resources. |
| Sound stops when one widget unmounts | Borrowed context/synth/player ownership | Detach that widget's route and subscription; preserve resources owned by another component. |
| Playback or callbacks survive navigation | Player disposal, subscription/driver teardown and late async completion | Tie cleanup to the composition's actual lifecycle. |
| Sample or worklet fails despite installed peer | Requested URL, public asset location, HTTP response and backend preparation | Follow the selected backend's resource setup; an npm package alone does not serve application assets. |

## Missing API or version mismatch

Read the installed package's declarations and the owning public page. When they
disagree, report the precise package version and missing export/member. Use a
matching supported composition when it satisfies the user, or explain which
dependency/feature decision is needed. Do not mask a missing API with casts,
deep imports into package internals or a silent runtime upgrade.

This skill's `0.1.0` target includes Score, UI Kit and Kernel. A request for
unreleased Audio or Bridge functionality requires an explicit change of scope
or an application-owned alternative; it must not produce invented package APIs.
Likewise, do not quietly substitute an oscillator when the user specifically
requires a SoundFont. Explain the missing backend/resource and complete work
that does not depend on it.

## Documentation unavailable

The bundled references explain decisions but are not an offline copy of every
API. Use installed exported types, included package documentation and the
application's existing examples. Fetch the public owning reference when access
is available. If behavior remains uncertain, state the narrow uncertainty and
verify it rather than claiming a complete integration.

Useful public starting points:

- [Installation and peers](https://koperative-lab.github.io/WebMusic/score/)
- [Playback and backend options](https://koperative-lab.github.io/WebMusic/score/api/play/)
- [I/O formats and diagnostics](https://koperative-lab.github.io/WebMusic/score/api/io/)
- [UI presenter contracts](https://koperative-lab.github.io/WebMusic/uikit/api/)
