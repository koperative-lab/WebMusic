/**
 * The published package directories, relative to the repository root, in
 * dependency/publish order. EVERY gate script derives its scan list from
 * here (check-architecture, check-package-exports, license-gate,
 * release-manifests), so adding a package to the policy automatically puts
 * it under every gate — no script keeps its own copy of this list.
 */
export const packageDirectories = Object.freeze([
  "platform/kernel",
  "packages/ui",
  "packages/score",
]);

/**
 * Deliberate first-release public surface: Kernel, UI Kit and Score.
 * Updating a package's exports is an API decision, so the manifest and this
 * policy must change together. Score nests its tables per capability — a
 * capability is a first-level directory under the package's `src/`.
 */
export const expectedPublicEntries = Object.freeze({
  "@webmusic/kernel": [
    ".",
    "./events",
    "./element",
    "./worker",
    "./audio-context",
    "./player",
    "./effect",
    "./meter",
    "./transport",
    "./tick",
    "./sync",
    "./package.json",
  ],
  "@webmusic/ui": [
    ".",
    "./analysis",
    "./envelope",
    "./eq",
    "./harmony",
    "./lfo",
    "./macro",
    "./meter",
    "./minimap",
    "./mixer",
    "./note",
    "./panel",
    "./parameter",
    "./pitch",
    "./playlist",
    "./recorder",
    "./stage",
    "./status",
    "./timeline",
    "./track-list",
    "./transport",
    "./workbench",
    "./package.json",
  ],
  "@webmusic/score": [
    ".",
    "./io",
    "./io/load",
    "./io/formats",
    "./io/worker-client",
    "./io/worker-protocol",
    "./io/worker",
    "./view",
    "./view/headless",
    "./view/render",
    "./view/element",
    "./play",
    "./play/headless",
    "./play/drivers",
    "./play/element",
    "./play/auto",
    "./play/demos",
    "./play/global",
    "./analyze",
    "./analyze/headless",
    "./analyze/element",
    "./analyze/worker-client",
    "./analyze/worker-protocol",
    "./analyze/worker",
    "./react",
    "./package.json",
  ],
});

/**
 * Build entries that intentionally have no public export, per package.
 * `worker-url.ts` anchors the analyze worker URL to `dist/analyze/` (entry
 * modules keep a deterministic dist path even when their code is hoisted
 * into chunks).
 */
export const internalBuildEntries = Object.freeze({
  "@webmusic/score": ["analyze/worker-url.ts"],
});

/**
 * Capability dependency DAG over each family package's `src/<capability>/`
 * directories. A relative import from capability A into capability B is
 * reviewed here. The package root barrel (`src/index.ts`) is the `root`
 * pseudo-capability.
 */
export const capabilityDependencies = Object.freeze({
  "@webmusic/score": Object.freeze({
    root: ["core"],
    core: [],
    io: ["core"],
    view: ["core", "io"],
    play: ["core", "io"],
    analyze: ["core", "io"],
    react: ["core", "io", "view", "play", "analyze"],
  }),
});

/** Domain families with reviewed capability contracts in this release. */
export const domainFamilies = Object.freeze(
  Object.keys(capabilityDependencies).map((name) => name.slice('@webmusic/'.length)),
);

/**
 * Every concrete feature capability has the same four source
 * responsibilities. `core` is deliberately internal: it is the reusable
 * implementation floor, not an additional semver surface. The capability
 * ROOT is the API (`./api` is not published; `src/api/` stays as the
 * internal implementation the root barrel forwards).
 */
const featureLayersFor = (capabilities) =>
  Object.freeze(
    Object.fromEntries(
      capabilities.map((capability) => [
        capability,
        Object.freeze({
          core: `${capability}/core/index.ts`,
          api: `${capability}/api/index.ts`,
          headless: `${capability}/headless/index.ts`,
          element: `${capability}/element/index.ts`,
        }),
      ]),
    ),
  );

export const requiredFeatureLayers = Object.freeze({
  "@webmusic/score": featureLayersFor(["play", "analyze", "view"]),
});

/**
 * Public entrypoints that deliberately are not dual ESM/CommonJS modules.
 * Their export-map conditions and artifact checks must reflect their runtime
 * shape instead of treating a `default` condition as a JavaScript default
 * export.
 */
export const expectedPublicEntryKinds = Object.freeze({
  "@webmusic/score": Object.freeze({
    "./play/global": "browser-iife",
  }),
});

/** Browser-IIFE global contract per `./…/global` entry, keyed by subpath:
 * the global name the bundle must expose, its define-all function, and
 * representative custom elements the IIFE must register on evaluation. */
export const expectedBrowserGlobals = Object.freeze({
  "@webmusic/score": Object.freeze({
    "./play/global": {
      globalName: "WebMusicScorePlay",
      defineFunction: "defineAllElements",
      elements: ["score-player", "simple-score-player", "rack-control"],
    },
  }),
});

/** Exact workspace dependency graph. External implementation dependencies
 * are intentionally outside this policy; workspace package ownership is not.
 */
// Kernel is a REQUIRED peer of every family package: cross-package element
// and transport identities require one shared instance. UI is an OPTIONAL
// peer: Headless-only installs do not need it, while callers opting into a
// family's /element or /auto entries install one shared UI instance.
export const expectedWorkspaceDependencies = Object.freeze({
  "@webmusic/kernel": { dependencies: [], optionalPeers: [] },
  "@webmusic/ui": { dependencies: [], optionalPeers: [] },
  "@webmusic/score": {
    dependencies: [],
    optionalPeers: ["@webmusic/ui"],
    requiredPeers: ["@webmusic/kernel"],
  },
});

/** Public entries whose evaluation intentionally performs registration. */
export const expectedSideEffectEntries = Object.freeze({
  "@webmusic/kernel": [],
  "@webmusic/ui": [],
  "@webmusic/score": ["./io/worker", "./analyze/worker", "./play/auto", "./play/global"],
});

/** Build entries allowed to STATICALLY import an optional peer. The rule
 * exists so that ordinary entries stay importable without optional peers
 * installed; an opt-in framework adapter entry is the sanctioned exception —
 * importing `<family>/react` without react present is a caller error by
 * contract. */
export const staticOptionalPeerEntries = Object.freeze({
  "@webmusic/score": Object.freeze({
    "view/element/index.ts": ["@webmusic/ui"],
    "play/element/index.ts": ["@webmusic/ui"],
    "play/element/auto.ts": ["@webmusic/ui"],
    "play/demos/index.ts": ["@webmusic/ui"],
    "analyze/element/index.ts": ["@webmusic/ui"],
    "react/index.tsx": ["react"],
  }),
});

/** Entry modules that must remain free of runtime DOM globals. Browser-only
 * adapters plus render/element entries are deliberately not listed. All
 * feature-capability headless entries are code-only domain components: they
 * may calculate values or perform non-visual work, but never own a DOM
 * surface. UI presenter entries intentionally are not DOM-free: they may use
 * a caller-supplied DOM when mounted, while SSR-safe evaluation is covered by
 * package import checks and UI's SSR test. Kernel entries are audited but not
 * yet enforced DOM-free (elements.ts is DOM by design). */
export const domFreeEntrySources = Object.freeze({
  "@webmusic/kernel": [],
  "@webmusic/ui": [],
  "@webmusic/score": [
    "index.ts",
    "core/index.ts",
    "io/index.ts",
    "io/load.ts",
    "io/formats/index.ts",
    "io/worker-client.ts",
    "io/worker-protocol.ts",
    "play/index.ts",
    "play/core/index.ts",
    "play/api/index.ts",
    "play/headless/index.ts",
    "analyze/index.ts",
    "analyze/core/index.ts",
    "analyze/api/index.ts",
    "analyze/headless/index.ts",
    "analyze/worker-client.ts",
    "analyze/worker-protocol.ts",
    "view/index.ts",
    "view/core/index.ts",
    "view/api/index.ts",
    "view/headless/index.ts",
  ],
});

/** Known implementation layers that selected public entries must never reach
 * through runtime imports. Paths are relative to the package source root. */
export const forbiddenEntryReachability = Object.freeze({
  "@webmusic/score": {
    "index.ts": ["io/", "view/", "play/", "analyze/", "react/"],
    "io/index.ts": ["io/worker-client.ts", "io/worker-protocol.ts", "io/worker.ts"],
    "play/index.ts": [
      "play/drivers.ts",
      "play/headless/interactive-player.ts",
      "play/headless/rack.ts",
      "play/headless/sound.ts",
      "play/headless/controller.ts",
      "play/headless/loop-player.ts",
      "play/headless/ab-player.ts",
      "play/headless/tone-player.ts",
      "play/element/",
      "play/demos/",
    ],
    "play/core/index.ts": ["play/headless/", "play/element/", "play/demos/"],
    "play/api/index.ts": ["play/element/", "play/demos/"],
    "play/headless/index.ts": ["play/drivers.ts", "play/element/", "play/demos/"],
    "analyze/index.ts": ["analyze/worker-client.ts", "analyze/element/"],
    "analyze/core/index.ts": ["analyze/worker-client.ts", "analyze/headless/", "analyze/element/"],
    "analyze/api/index.ts": ["analyze/worker-client.ts", "analyze/headless/", "analyze/element/"],
    "analyze/headless/index.ts": ["analyze/element/"],
    "analyze/worker-client.ts": ["analyze/worker.ts"],
    "analyze/worker-protocol.ts": ["analyze/worker.ts"],
    "view/index.ts": ["view/render/", "view/headless/", "view/element/"],
    "view/core/index.ts": ["view/render/", "view/headless/", "view/element/"],
    "view/api/index.ts": ["view/render/", "view/headless/", "view/element/"],
    "view/headless/index.ts": ["view/render/", "view/element/"],
  },
});
