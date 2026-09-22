// Runtime src/ trees and complete package manifests were compared with the
// published v0.1.0 source commit below. SHA-256 verification during builds
// needs neither Git history nor private maintainer notes. Update only after
// reviewing a published baseline; never refresh to silence a source mismatch.
export const releaseBaseline = Object.freeze({
  "commit": "3ab5cdf116fda6f3bf364bf5b6ea56dc315942ce",
  "packages": [
    {
      "name": "@webmusic/kernel",
      "version": "0.1.0",
      "directory": "platform/kernel",
      "manifestSha256": "035727320610c0fdf87879d2625bd4cd659d5892dce2354be05bfe0fd3d1a5f5",
      "sourceSha256": "fb45484124885e046df348b45ab03ea907f5cba38f066c39cb4aedd0cb199ec3"
    },
    {
      "name": "@webmusic/ui",
      "version": "0.1.0",
      "directory": "packages/ui",
      "manifestSha256": "eb44b94b798d20aaec050d82ea9651ef55bfed3c871b83f650e83cee358dcee1",
      "sourceSha256": "483b34dca1122d9b424a0faa0e34e8d9bfee8f2e08b540ce04ecc95bbdb84868"
    },
    {
      "name": "@webmusic/score",
      "version": "0.1.0",
      "directory": "packages/score",
      "manifestSha256": "97b8cdc42836e615356fa3fbedb6c29b73bd157c230db0fdbcbbd8248a5cc0d5",
      "sourceSha256": "7d0007a1c52ff81ba3842bd9959e5f148cbddea6449d54987e184a9ec4faeb68"
    }
  ]
});
