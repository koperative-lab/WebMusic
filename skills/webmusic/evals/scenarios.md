# Consumer skill behavioral cases

These are evaluation tasks and observable criteria, not recorded passing runs.
Run them in independent application directories with a copied skill and public
package inputs. Do not give the agent private WebMusic notes or workspace
symlinks. Use `0.1.0` of the needed WebMusic packages for the initial compatibility
target; retain each app's lockfile and the skill source revision.

For each run, record the prompt, environment, installed versions, artifacts,
commands/outcomes and browser observations. Distinguish compiled behavior from
audible output or device behavior. A check that merely finds particular words
in the skill cannot establish these outcomes.

## 1. Web Components: player and followers

**Setup:** Fresh Vite/TypeScript application and a served MIDI or MusicXML file.

**Prompt:** Use the webmusic skill. Build one player with a following staff view
and a keyboard readout. Use the built-in oscillator. Add visible loading and
error feedback. The file should be loaded once. Verify pause, seek and removal.

**Observe:**

- Public package imports compile in the independent app.
- The selected tags are registered; both views borrow one playback owner.
- Valid and missing file URLs produce the expected ready and error UI.
- Pause and seek update both followers; removal releases the composition.
- The result does not present a readout keyboard as playable input.

## 2. React: custom Headless controls

**Setup:** Existing React application with its own button styles and test setup.

**Prompt:** Use the webmusic skill. Add a Headless score player controlled by our
existing buttons. Keep our React conventions. Support score replacement and
unmount during loading. We may share an AudioContext with another widget.

**Observe:**

- No replacement framework or unrelated global configuration is introduced.
- Public Headless imports compile; audio starts from user interaction.
- Loading and command failures reach visible application state.
- Late loads cannot attach to an unmounted or replaced component.
- Remount does not accumulate listeners; borrowed context remains usable by
  the other widget after this player is removed.

## 3. API-only import and analysis

**Setup:** Node/TypeScript application with a local MIDI fixture and no UI.

**Prompt:** Use the webmusic skill. Read this MIDI file, report import diagnostics
where available and summarize key/chord analysis. Explain position units. Keep
this a command-line task; include empty-input behavior.

**Observe:**

- Only needed public entries and runtime dependencies are selected.
- The program runs without UI DOM or a created live audio context.
- Its output explains units and treats estimates as heuristics.
- Empty or failed input does not produce a fabricated positive musical result.

## 4. API + UI with application-owned state

**Setup:** Browser application with an existing observable transport store,
commands and unrelated DOM children in the intended presenter host.

**Prompt:** Use the webmusic skill. Add WebMusic's transport presenter to this
store. Do not introduce a ScorePlayer. Preserve the store and the existing DOM.
Verify command routing and cleanup.

**Observe:**

- Imports resolve from `@webmusic/ui/transport` in an independent install.
- Play/pause/seek reach the application commands; snapshot changes repaint.
- Keyboard controls retain usable focus and labels.
- Destroy releases the presenter subscription and owned nodes; the store and
  pre-existing host children survive. No audio owner is added.

## 5. Missing backend and incompatible API

**Setup:** Score installed without a SoundFont backend; a second fixture with an
installed export map that lacks a requested entry/member. Record its actual
version rather than inventing a published old version.

**Prompt:** Use the webmusic skill. Make this player use my SF2 sound with the
packages already installed. Another example mentions an export that our
installation cannot resolve. Diagnose both failures before changing packages.

**Observe:**

- The agent checks the real installed exports, peer requirement and asset URL.
- It names the unavailable dependency/member instead of inventing a method or
  silently substituting an oscillator.
- It proposes a matching supported route and does not silently upgrade the app.
- No claim of successful sound is based solely on typecheck or npm installation.

## 6. Existing project instructions

**Setup:** An application instruction file with unrelated rules. Repeat using a
symlink to an instruction file within the same application.

**Prompt:** Use the bundled WebMusic instruction fragment to add relevant music
development guidance to our existing project instructions. Keep our rules and
the existing instruction-file arrangement.

**Observe:**

- Existing instructions and symlinks survive; no competing instruction file is
  created merely because the client's preferred filename differs.
- The added section uses public references and application checks.
- No maintainer source-build workflow or private path is required.
- An ordinary development task with this skill does not rewrite instructions
  unless the user requests setup.

## 7. Portable copy with limited context

**Setup:** Copy only `skills/webmusic/` outside this checkout. No other WebMusic
source directory or local maintainer notes are present. Test with network
access, then with access unavailable and installed declarations available.

**Prompt:** Read the copied skill and identify the imports and resource lifecycle
needed for a custom score player in this application. Inspect the installed
version. Explain any contract you cannot verify.

**Observe:**

- Every local link resolves inside the copied folder.
- Public references are sufficient for normal API lookup with network access.
- Offline operation uses installed contracts and names remaining uncertainty;
  it does not claim the skill bundles all API documentation.
