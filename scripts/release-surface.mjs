/** A WebMusic import must belong to the reviewed release, including subpaths. */
export function unpublishedWorkspacePackage(specifier, publishedNames) {
  const name = specifier.split('/').slice(0, 2).join('/');
  return specifier.startsWith('@webmusic/') && !new Set(publishedNames).has(name) ? name : undefined;
}

/** All dependency kinds can pull a deferred package back into this checkout. */
export function manifestBoundaryProblems(manifest, publishedNames) {
  const names = new Set(publishedNames);
  const problems = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (unpublishedWorkspacePackage(name, names)) {
        problems.push(`${field}.${name} references a package outside this release.`);
      }
    }
  }
  return problems;
}
