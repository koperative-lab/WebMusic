import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRegistryLockMatchesCandidate,
  assertRequiredProvenance,
} from '../verify-registry-release.mjs';
import {releasePackageNames} from '../release-packages.mjs';

const artifacts = releasePackageNames.map((name, index) => ({
  name,
  version: '1.2.3',
  integrity: `sha512-candidate-${index}`,
}));

function matchingLock() {
  return {
    lockfileVersion: 3,
    packages: Object.fromEntries([
      ['', {name: 'fixture', version: '0.0.0'}],
      ...artifacts.map((artifact) => [
        `node_modules/${artifact.name}`,
        {
          version: artifact.version,
          resolved:
            `https://registry.npmjs.org/${artifact.name.replace('/', '%2f')}/-/` +
            `${artifact.name.slice(artifact.name.indexOf('/') + 1)}-${artifact.version}.tgz`,
          integrity: artifact.integrity,
        },
      ]),
    ]),
  };
}

test('accepts a complete exact-version registry graph matching the candidate manifest', () => {
  assert.doesNotThrow(() => assertRegistryLockMatchesCandidate(matchingLock(), artifacts));
});

test('rejects a registry graph with a different candidate integrity or non-registry source', () => {
  const wrongIntegrity = matchingLock();
  wrongIntegrity.packages['node_modules/@webscore/play'].integrity = 'sha512-other';
  assert.throws(
    () => assertRegistryLockMatchesCandidate(wrongIntegrity, artifacts),
    /integrity that differs/i,
  );

  const localSource = matchingLock();
  localSource.packages['node_modules/@webscore/play'].resolved = 'file:../play.tgz';
  assert.throws(
    () => assertRegistryLockMatchesCandidate(localSource, artifacts),
    /public npm registry/i,
  );
});

test('requires npm SLSA provenance metadata for every release package', () => {
  const artifact = artifacts[0];
  assert.doesNotThrow(() =>
    assertRequiredProvenance(artifact, {
      url: `https://registry.npmjs.org/-/npm/v1/attestations/${artifact.name}@${artifact.version}`,
      provenance: {predicateType: 'https://slsa.dev/provenance/v1'},
    }),
  );
  assert.throws(
    () => assertRequiredProvenance(artifact, {url: 'https://example.com/attestation'}),
    /required npm SLSA provenance/i,
  );
});
