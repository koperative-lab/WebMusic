import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isReleaseVersion} from './release-version.mjs';

test('accepts the first release and stable major/minor/patch versions', () => {
  for (const version of ['0.1.0', '0.0.0', '1.0.0', '12.34.567']) assert.equal(isReleaseVersion(version), true);
});

test('rejects versions npm cannot publish and non-stable release lanes', () => {
  for (const version of ['01.2.3', '1.02.3', '1.2.03', '1.2', 'v1.2.3', '1.2.3-beta.1', '1.2.3+build', '^1.2.3', '1.2.3\n', '9007199254740992.0.0', '', null]) {
    assert.equal(isReleaseVersion(version), false, String(version));
  }
});
