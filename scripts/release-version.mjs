/** The release lane accepts stable, npm-compatible versions only. */
export function isReleaseVersion(value) {
  return typeof value === 'string'
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every((part) => Number.isSafeInteger(Number(part)));
}
