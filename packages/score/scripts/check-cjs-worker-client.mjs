import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * The CommonJS worker clients must ship with `import.meta.url` compiled away
 * (tsup `--define.import.meta.url=undefined`) so that under require() they
 * take the documented in-process fallback instead of spawning a Worker with
 * a URL that cannot resolve.
 */
const clients = [
  {
    dist: "../dist/io/worker-client.cjs",
    async smoke(exportsObject) {
      const parser = exportsObject.createParserWorker();
      await parser.parse("X:1\nK:C\nC", "abc");
      parser.dispose();
    },
    label: "io parser worker client",
  },
  {
    dist: "../dist/analyze/worker-client.cjs",
    async smoke(exportsObject) {
      exportsObject.createAnalysisWorker().dispose();
    },
    label: "analyze worker client",
  },
];

for (const client of clients) {
  const clientPath = fileURLToPath(new URL(client.dist, import.meta.url));
  const source = await readFile(clientPath, "utf8");

  if (/\bimport_meta\b|\bimport\.meta\b/.test(source)) {
    throw new Error(
      `CommonJS ${client.label} must not retain an import.meta shim.`,
    );
  }

  const previousWorker = globalThis.Worker;
  let constructed = 0;

  class FakeWorker {
    constructor() {
      constructed += 1;
    }

    addEventListener() {}
    postMessage() {}
    terminate() {}
  }

  globalThis.Worker = FakeWorker;
  try {
    await client.smoke(require(clientPath));
    if (constructed !== 0) {
      throw new Error(
        `CommonJS ${client.label} must use the in-process fallback.`,
      );
    }
  } finally {
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  }
}

console.log(`CommonJS worker-client fallback verified for ${clients.length} clients.`);
