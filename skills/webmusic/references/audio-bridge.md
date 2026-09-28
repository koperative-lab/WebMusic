# Audio and Bridge source context

Audio adds decoded-clip playback, recording, waveform/spectral views and
analysis. Bridge coordinates Score and Audio. These additions use the same
Web Components, Headless and API + UI choices and resource-ownership workflow
as the main WebMusic Skill.

Use the existing lookup commands with the context source for the checkout you
are developing against. No additional command or mode is needed:

```sh
node scripts/list_components.mjs --base-url http://localhost:4321/
node scripts/get_component_docs.mjs headless/audio/audio-clip-player --context-dir /path/to/site
node scripts/get_source.mjs element/audio-view --context-dir /path/to/site
node scripts/get_docs.mjs /bridge/composition/ --context-dir /path/to/site
```

Include any deployment prefix in the URL. Keep the complete generated context
from one build together. Audio/Bridge context identifies the current five-package
source snapshot, verifies source/manifest fingerprints and output hashes, and
records its exact comparison with main's unchanged release baseline. A package
version label does not establish published compatibility. Read the checkout's
exports and declarations before selecting an API.

The default lookup still uses the published Score, UI Kit and Kernel context.
Source snapshots require an explicitly selected URL or directory. This keeps
release references and application-owned source checkouts distinguishable
without changing the main commands or installation workflow.
