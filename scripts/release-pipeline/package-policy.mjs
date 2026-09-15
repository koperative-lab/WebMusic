/**
 * Deliberate public package surface. Updating a package's exports is an API
 * decision, so the manifest and this policy must change together.
 */
export const expectedPublicEntries = Object.freeze({
  "@webscore/core": ["."],
  "@webscore/io": [
    ".",
    "./load",
    "./formats",
    "./worker-client",
    "./worker-protocol",
    "./worker",
  ],
  "@webscore/play": [
    ".",
    "./api",
    "./headless",
    "./drivers",
    "./element",
    "./elements",
    "./auto",
    "./global",
    "./demos",
  ],
  "@webscore/analyze": [
    ".",
    "./api",
    "./headless",
    "./session",
    "./worker-client",
    "./worker-protocol",
    "./element",
    "./elements",
    "./worker",
  ],
  "@webscore/view": [
    ".",
    "./api",
    "./headless",
    "./render",
    "./element",
    "./elements",
  ],
  "@webscore/react": ["."],
  "@webaudio/core": ["."],
  "@webaudio/play": [
    ".",
    "./api",
    "./headless",
    "./element",
    "./elements",
    "./auto",
    "./global",
    "./worker-client",
    "./worker",
  ],
  "@webaudio/analyze": [
    ".",
    "./api",
    "./headless",
    "./element",
    "./elements",
    "./auto",
    "./global",
    "./transcribe",
    "./worker-client",
    "./worker",
  ],
  "@webaudio/view": [
    ".",
    "./api",
    "./headless",
    "./render",
    "./element",
    "./elements",
    "./auto",
    "./global",
  ],
  "@webaudio/react": ["."],
  "@webmusic/kernel": [
    ".",
    "./events",
    "./elements",
    "./worker",
    "./audio-context",
    "./player",
    "./effect",
    "./transport",
    "./tick",
  ],
  "@webmusic/score-audio": ["."],
});

/**
 * Every concrete feature package has the same four source responsibilities.
 * `core` is deliberately internal: it is the reusable implementation floor,
 * not an additional semver surface. The other three layers are public. The
 * singular `/element` spelling is canonical for new code while `/elements`
 * remains an exact compatibility alias.
 */
export const requiredFeatureLayers = Object.freeze(
  Object.fromEntries(
    [
      "@webscore/play",
      "@webscore/analyze",
      "@webscore/view",
      "@webaudio/play",
      "@webaudio/analyze",
      "@webaudio/view",
    ].map((name) => [
      name,
      Object.freeze({
        core: "core/index.ts",
        api: "api/index.ts",
        headless: "headless/index.ts",
        element: "element/index.ts",
      }),
    ]),
  ),
);

/**
 * Public entrypoints that deliberately are not dual ESM/CommonJS modules.
 * Their export-map conditions and artifact checks must reflect their runtime
 * shape instead of treating a `default` condition as a JavaScript default
 * export.
 */
export const expectedPublicEntryKinds = Object.freeze({
  "@webscore/play": Object.freeze({
    "./global": "browser-iife",
  }),
  "@webaudio/play": Object.freeze({
    "./global": "browser-iife",
  }),
  "@webaudio/analyze": Object.freeze({
    "./global": "browser-iife",
  }),
  "@webaudio/view": Object.freeze({
    "./global": "browser-iife",
  }),
});

/** Browser-IIFE global contract per package with a `./global` entry: the
 * global name the bundle must expose, its define-all function, and
 * representative custom elements the IIFE must register on evaluation. */
export const expectedBrowserGlobals = Object.freeze({
  "@webscore/play": {
    globalName: "WebScorePlay",
    defineFunction: "defineAllElements",
    elements: ["simple-score-player", "rack-control"],
  },
  "@webaudio/play": {
    globalName: "WebAudioPlay",
    defineFunction: "defineAllAudioElements",
    elements: ["audio-clip-player", "audio-mixer"],
  },
  "@webaudio/analyze": {
    globalName: "WebAudioAnalyze",
    defineFunction: "defineAllAudioElements",
    elements: ["audio-analysis"],
  },
  "@webaudio/view": {
    globalName: "WebAudioView",
    defineFunction: "defineAllAudioElements",
    elements: ["audio-view"],
  },
});

/** Exact workspace dependency graph. External implementation dependencies are
 * intentionally outside this policy; workspace package ownership is not. */
export const expectedWorkspaceDependencies = Object.freeze({
  "@webscore/core": { dependencies: ["@webmusic/kernel"], optionalPeers: [] },
  "@webscore/io": {
    dependencies: ["@webmusic/kernel", "@webscore/core"],
    optionalPeers: [],
  },
  "@webscore/play": {
    dependencies: ["@webmusic/kernel", "@webscore/core", "@webscore/io"],
    optionalPeers: [],
  },
  "@webscore/analyze": {
    dependencies: ["@webmusic/kernel", "@webscore/core"],
    optionalPeers: ["@webscore/io"],
  },
  "@webscore/view": {
    dependencies: ["@webmusic/kernel", "@webscore/core"],
    optionalPeers: ["@webscore/io"],
  },
  "@webscore/react": {
    dependencies: [
      "@webscore/analyze",
      "@webscore/core",
      "@webscore/play",
      "@webscore/view",
    ],
    optionalPeers: [],
  },
  "@webaudio/core": { dependencies: ["@webmusic/kernel"], optionalPeers: [] },
  "@webaudio/play": {
    dependencies: ["@webmusic/kernel", "@webaudio/core"],
    optionalPeers: [],
  },
  "@webaudio/analyze": {
    dependencies: ["@webmusic/kernel", "@webaudio/core"],
    optionalPeers: ["@webaudio/play"],
  },
  "@webaudio/view": {
    dependencies: ["@webmusic/kernel", "@webaudio/core"],
    optionalPeers: ["@webaudio/play"],
  },
  "@webaudio/react": {
    dependencies: [
      "@webaudio/analyze",
      "@webaudio/core",
      "@webaudio/play",
      "@webaudio/view",
    ],
    optionalPeers: [],
  },
  "@webmusic/kernel": { dependencies: [], optionalPeers: [] },
  "@webmusic/score-audio": {
    dependencies: [
      "@webaudio/analyze",
      "@webaudio/core",
      "@webaudio/play",
      "@webmusic/kernel",
      "@webscore/core",
      "@webscore/play",
    ],
    optionalPeers: [],
  },
});

/** Public entries whose evaluation intentionally performs registration. */
export const expectedSideEffectEntries = Object.freeze({
  "@webscore/core": [],
  "@webscore/io": ["./worker"],
  "@webscore/play": ["./auto", "./global"],
  "@webscore/analyze": ["./worker"],
  "@webscore/view": [],
  "@webscore/react": [],
  "@webaudio/core": [],
  "@webaudio/play": ["./auto", "./global", "./worker"],
  "@webaudio/analyze": ["./auto", "./global", "./worker"],
  "@webaudio/view": ["./auto", "./global"],
  "@webaudio/react": [],
  "@webmusic/kernel": [],
  "@webmusic/score-audio": [],
});

/** Entry modules that must remain free of runtime DOM globals. Browser-only
 * adapters plus render/element entries are deliberately not listed. All six
 * feature-package headless entries are code-only domain components: they may
 * calculate values or perform non-visual work, but never own a DOM surface. */
export const domFreeEntrySources = Object.freeze({
  "@webscore/core": ["index.ts"],
  "@webscore/io": [
    "index.ts",
    "load.ts",
    "formats/index.ts",
    "worker-client.ts",
    "worker-protocol.ts",
  ],
  "@webscore/play": [
    "index.ts",
    "core/index.ts",
    "api/index.ts",
    "headless/index.ts",
  ],
  "@webscore/analyze": [
    "index.ts",
    "core/index.ts",
    "api/index.ts",
    "headless/index.ts",
    "session/index.ts",
    "worker-client.ts",
    "worker-protocol.ts",
  ],
  "@webscore/view": [
    "index.ts",
    "core/index.ts",
    "api/index.ts",
    "headless/index.ts",
  ],
  "@webscore/react": [],
  "@webaudio/core": [],
  "@webaudio/play": [
    "index.ts",
    "core/index.ts",
    "api/index.ts",
    "headless/index.ts",
  ],
  "@webaudio/analyze": [
    "index.ts",
    "core/index.ts",
    "api/index.ts",
    "headless/index.ts",
  ],
  "@webaudio/view": [
    "index.ts",
    "core/index.ts",
    "api/index.ts",
    "headless/index.ts",
  ],
  "@webaudio/react": [],
  // Kernel entries are audited but not yet enforced DOM-free (elements.ts is
  // DOM by design; the rest tighten as verified). Bridge root is API-only.
  "@webmusic/kernel": [],
  "@webmusic/score-audio": [],
});

/** Known implementation layers that selected public entries must never reach
 * through runtime imports. Paths are relative to the package source root. */
export const forbiddenEntryReachability = Object.freeze({
  "@webscore/io": {
    "index.ts": ["worker-client.ts", "worker-protocol.ts", "worker.ts"],
  },
  "@webscore/play": {
    "index.ts": [
      "drivers.ts",
      "interactive-player.ts",
      "rack.ts",
      "sound.ts",
      "controller.ts",
      "loop-player.ts",
      "ab-player.ts",
      "tone-player.ts",
      "element/",
      "demos/",
    ],
    "core/index.ts": ["headless/", "element/", "demos/"],
    "api/index.ts": ["element/", "demos/"],
    "headless/index.ts": [
      "drivers.ts",
      "headless/drivers.ts",
      "element/",
      "demos/",
    ],
  },
  "@webscore/analyze": {
    "index.ts": ["session.ts", "worker-client.ts", "element/"],
    "core/index.ts": [
      "session.ts",
      "worker-client.ts",
      "headless/",
      "element/",
    ],
    "api/index.ts": ["session.ts", "worker-client.ts", "headless/", "element/"],
    "headless/index.ts": ["element/"],
    "worker-client.ts": ["worker.ts"],
    "worker-protocol.ts": ["worker.ts"],
  },
  "@webscore/view": {
    "index.ts": [
      "binding.ts",
      "osmd-staff.ts",
      "renderers/",
      "render/",
      "headless/",
      "element/",
    ],
    "core/index.ts": [
      "binding.ts",
      "osmd-staff.ts",
      "renderers/",
      "render/",
      "headless/",
      "element/",
    ],
    "api/index.ts": [
      "binding.ts",
      "osmd-staff.ts",
      "renderers/",
      "render/",
      "headless/",
      "element/",
    ],
    "headless/index.ts": ["render/", "element/"],
  },
  "@webaudio/play": {
    "index.ts": ["element/", "worker.ts"],
    "core/index.ts": ["headless/", "element/"],
    "api/index.ts": ["element/"],
    "headless/index.ts": ["element/"],
    "worker-client.ts": ["worker.ts"],
  },
  "@webaudio/analyze": {
    "index.ts": ["headless/", "element/", "worker.ts"],
    "core/index.ts": ["headless/", "element/"],
    "api/index.ts": ["headless/", "element/"],
    "headless/index.ts": ["element/"],
    "worker-client.ts": ["worker.ts"],
  },
  "@webaudio/view": {
    "index.ts": ["render/", "headless/", "element/"],
    "core/index.ts": ["render/", "headless/", "element/"],
    "api/index.ts": ["render/", "element/"],
    "headless/index.ts": ["render/", "element/"],
  },
});
