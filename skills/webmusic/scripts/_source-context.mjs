import {createHash} from 'node:crypto';

const owners = {
  '@webmusic/kernel': 'platform/kernel', '@webmusic/ui': 'packages/ui',
  '@webmusic/score': 'packages/score', '@webmusic/audio': 'packages/audio',
  '@webmusic/bridge': 'bridges/score-audio',
};
const hash = (value) => /^[a-f0-9]{64}$/.test(value ?? '');

/** Audio/Bridge source additions use the existing explicit-source options. */
export function sourceContextReference(manifest, settings) {
  const snapshot = manifest.sourceSnapshot;
  if (!snapshot) return undefined;
  if (!settings['--base-url'] && !settings['--context-dir']) throw new Error('Source snapshots require an explicitly selected --base-url or --context-dir. The default lookup uses published context.');
  if (manifest.release || snapshot.adapter !== 'audio-bridge' || snapshot.verification !== 'working-tree-source-and-manifest-sha256' || !Array.isArray(snapshot.fingerprints) || snapshot.fingerprints.length !== Object.keys(owners).length) {
    throw new Error('Unsupported Audio/Bridge source snapshot. Refresh the complete context.');
  }
  if (Object.keys(snapshot.packages ?? {}).length !== Object.keys(owners).length) throw new Error('Incomplete Audio/Bridge source package metadata.');
  for (const [name, directory] of Object.entries(owners)) {
    const records = snapshot.fingerprints.filter((entry) => entry?.name === name);
    const record = records[0];
    if (records.length !== 1 || record.directory !== directory || typeof record.version !== 'string' || !record.version || record.version !== snapshot.packages[name] || !hash(record.sourceSha256) || !hash(record.manifestSha256)) {
      throw new Error(`Incomplete Audio/Bridge source snapshot for ${name}.`);
    }
  }
  const revision = createHash('sha256').update(`${JSON.stringify(snapshot.fingerprints, null, 2)}\n`).digest('hex');
  if (!hash(snapshot.revision) || snapshot.revision !== revision) throw new Error('Source snapshot fingerprint mismatch. Refresh the complete context.');
  return `source snapshot ${snapshot.revision} (Audio/Bridge additions; not a publication or installed-package compatibility claim)`;
}
