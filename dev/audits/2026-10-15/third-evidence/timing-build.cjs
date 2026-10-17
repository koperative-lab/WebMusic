const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const repository = process.env.WEBMUSIC_REPOSITORY ?? path.resolve(__dirname, '../../../..');
const artifacts = process.env.WEBMUSIC_ACCEPTANCE_OUTPUT ?? path.join(os.tmpdir(), 'webmusic-modular-third');
const requireWorkspace = createRequire(path.join(repository, 'package.json'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async () => {
  fs.mkdirSync(artifacts, {recursive: true});
  const optionalPeers = new Set();
  for (const directory of ['packages/score', 'packages/audio']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(repository, directory, 'package.json'), 'utf8'));
    for (const [name, policy] of Object.entries(manifest.peerDependenciesMeta ?? {})) if (policy.optional && !name.startsWith('@webmusic/')) optionalPeers.add(name);
  }
  const output = path.join(artifacts, 'modular-third-timing-bundle.js');
  const result = await requireWorkspace('esbuild').build({
    entryPoints: [path.join(__dirname, 'timing-entry.ts')], absWorkingDir: repository,
    nodePaths: [path.join(repository, 'node_modules')], outfile: output, bundle: true,
    format: 'esm', platform: 'browser', target: 'chrome125', external: [...optionalPeers],
    metafile: true, sourcemap: true, logLevel: 'warning',
  });
  const publicEntries = ['@webmusic/kernel/session', '@webmusic/kernel/effect', '@webmusic/score', '@webmusic/score/play/headless', '@webmusic/audio', '@webmusic/audio/play/headless'].map(name => {
    const esm = requireWorkspace.resolve(name).replace(/\.cjs$/, '.js');
    return {name, esm, sha256: hash(esm)};
  });
  const inputs = Object.keys(result.metafile.inputs).map(file => path.resolve(repository, file));
  const sourceInputs = inputs.filter(file => file.startsWith(repository + '/') && /\/(?:platform|packages|bridges)\/[^/]+\/src\//.test(file.slice(repository.length)));
  if (sourceInputs.length) throw new Error(`Acceptance must use public built exports; source files were bundled: ${sourceInputs.join(', ')}`);
  fs.writeFileSync(path.join(artifacts, 'modular-third-timing-build.json'), JSON.stringify({builtAt: new Date().toISOString(), publicEntries, bundle: output, bundleSha256: hash(output), inputCount: inputs.length, repositorySourceInputs: sourceInputs}, null, 2) + '\n');
  fs.copyFileSync(path.join(__dirname, 'timing.html'), path.join(artifacts, 'modular-third-timing.html'));
  console.log(`Prepared native shared timing acceptance in ${artifacts}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
