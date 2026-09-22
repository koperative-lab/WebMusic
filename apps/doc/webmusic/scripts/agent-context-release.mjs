// Runtime src/ fingerprints retain the v0.1.0 source commit below. Manifest
// fingerprints preserve the reviewed contracts on main at
// 4e33304ec40c8bc9cd8a79b850355f9f42947652, including its fast-xml-parser update;
// that revision does not establish a new package release. Their previous raw
// hashes were verified before converting to parsed JSON with sorted top-level
// keys and only devDependencies omitted. Nested order, including conditional
// exports, remains significant. Build verification needs neither Git history
// nor private notes. Review contract changes explicitly; never refresh these
// fingerprints merely to silence a mismatch.
export const releaseBaseline = Object.freeze({
  "commit": "3ab5cdf116fda6f3bf364bf5b6ea56dc315942ce",
  "packages": [
    {
      "name": "@webmusic/kernel",
      "version": "0.1.0",
      "directory": "platform/kernel",
      "manifestSha256": "3f9543e6f9707846d7f659fc50b5d8303facf82ab4247809ead40b0ec79c4a02",
      "sourceSha256": "fb45484124885e046df348b45ab03ea907f5cba38f066c39cb4aedd0cb199ec3"
    },
    {
      "name": "@webmusic/ui",
      "version": "0.1.0",
      "directory": "packages/ui",
      "manifestSha256": "c0137ca349adda7c6f7abf181e7a36472788b005e9d58f26436da7205fc689f0",
      "sourceSha256": "483b34dca1122d9b424a0faa0e34e8d9bfee8f2e08b540ce04ecc95bbdb84868"
    },
    {
      "name": "@webmusic/score",
      "version": "0.1.0",
      "directory": "packages/score",
      "manifestSha256": "f8f4d3b78cbd1baa71064fb9594eb47cd713ab513baa3818544bcdc522effa0a",
      "sourceSha256": "7d0007a1c52ff81ba3842bd9959e5f148cbddea6449d54987e184a9ec4faeb68"
    }
  ]
});
