import {existsSync, readFileSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {
  capabilityDependencies,
  domFreeEntrySources,
  domainFamilies,
  expectedPublicEntries,
  expectedSideEffectEntries,
  expectedWorkspaceDependencies,
  forbiddenEntryReachability,
  internalBuildEntries,
  packageDirectories,
  requiredFeatureLayers,
  staticOptionalPeerEntries,
} from './package-policy.mjs';
import {elementCompositionPolicy, standaloneUiPresenters} from './element-composition-policy.mjs';
import {releasePackageNames} from './release-packages.mjs';
import {manifestBoundaryProblems, unpublishedWorkspacePackage} from './release-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const rootTsconfig = JSON.parse(await readFile(path.join(root, 'tsconfig.json'), 'utf8'));
const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

// UI Kit documentation follows UI function, independent of the Score Elements
// that consume these presenters. Keep this map explicit so moving a
// presenter between classes remains a reviewed information-architecture change.
const uiPresenterClassPolicy = Object.freeze({
  'transport-time': ['transport', 'timeline', 'minimap', 'playlist', 'track-list'],
  'parameters-gestures': ['parameter', 'macro', 'envelope', 'lfo', 'eq'],
  'mixing-capture': ['mixer', 'meter', 'recorder'],
  notes: ['note'],
  'views-analysis': ['analysis', 'pitch', 'harmony'],
  'layout-feedback': ['panel', 'stage', 'status', 'workbench'],
});

// The published packages of the consolidated monorepo — the shared list in
// the policy file is the single source, so a new package is scanned here
// automatically.
const packageDirs = packageDirectories.map((dir) => path.join(root, ...dir.split('/')));

const packages = new Map();
for (const directory of packageDirs) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const tsconfig = JSON.parse(await readFile(path.join(directory, 'tsconfig.json'), 'utf8'));
  const sourceRoot = path.join(directory, 'src');
  const files = await sourceFiles(sourceRoot);
  const buildEntries = await buildEntriesFor(manifest, directory);
  packages.set(manifest.name, {directory, sourceRoot, files, manifest, tsconfig, buildEntries});
}

compareExactSet('Root workspace', 'workspace directory', rootManifest.workspaces ?? [], [
  ...packageDirectories,
  'apps/doc/webmusic',
]);
compareExactSet('Package policy', 'published package', [...packages.keys()], Object.keys(expectedPublicEntries));
if ([...packages.keys()].join() !== releasePackageNames.join()) {
  errors.push('Release package order must match packageDirectories and the published manifests.');
}
for (const directory of ['', ...packageDirectories, 'apps/doc/webmusic']) {
  const file = path.join(root, directory, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  errors.push(...manifestBoundaryProblems(manifest, packages.keys()).map((problem) => `${relativeToRoot(file)} ${problem}`));
}

const allSourceFiles = new Set([...packages.values()].flatMap((pkg) => pkg.files));
const modules = new Map();
for (const pkg of packages.values()) {
  for (const file of pkg.files) modules.set(file, await inspectModule(file));
}
checkTypeScriptSolution();

for (const [name, pkg] of packages) {
  checkPublicEntryPolicy(name, pkg);
  checkDependencyPolicy(name, pkg);
  checkExportEntries(name, pkg);
  checkFeatureLayers(name, pkg);
  checkCapabilityBoundaries(name, pkg);
  checkSideEffectPolicy(name, pkg);
  checkImports(name, pkg);
  checkUiWebComponentFreedom(name, pkg);
  checkUiDomainVocabulary(name, pkg);
  checkKernelPrimitiveOwnership(name, pkg);
  checkWuiInternalNamespace(name, pkg);
  checkLayerBoundary(name, pkg);
  checkInternalSourceReachability(name, pkg);
  checkInternalCycles(name, pkg);
}

/**
 * The build entry list. Family packages keep it in tsup.config.mjs
 * (`moduleEntries`) as the single source of truth for the dist layout;
 * kernel and UI build via plain tsup CLI flags, so their entries are
 * parsed from the build script strings (including npm-run sub-scripts).
 */
async function buildEntriesFor(manifest, directory) {
  const configPath = path.join(directory, 'tsup.config.mjs');
  if (existsSync(configPath)) {
    const config = await import(pathToFileURL(configPath).href);
    if (!Array.isArray(config.moduleEntries) || config.moduleEntries.length === 0) {
      errors.push(`${relativeToRoot(directory)}/tsup.config.mjs does not export a moduleEntries list.`);
      return [];
    }
    return config.moduleEntries.map((entry) => path.join(directory, entry));
  }
  const scripts = manifest.scripts ?? {};
  const visited = new Set();
  const commands = [];
  const visit = (scriptName) => {
    if (visited.has(scriptName)) return;
    visited.add(scriptName);
    const command = scripts[scriptName];
    if (typeof command !== 'string') return;
    commands.push(command);
    for (const match of command.matchAll(/\bnpm\s+run\s+([\w:-]+)/g)) visit(match[1]);
  };
  visit('build');
  return [...new Set(commands
    .flatMap((command) => command.match(/src\/[\w./-]+\.(?:tsx|ts)/g) ?? [])
    .map((entry) => path.join(directory, entry)))];
}

function checkDependencyPolicy(name, pkg) {
  const policy = expectedWorkspaceDependencies[name];
  if (!policy) {
    errors.push(`${name} has no workspace-dependency policy in scripts/package-policy.mjs.`);
    return;
  }
  const actualDependencies = Object.keys(pkg.manifest.dependencies ?? {}).filter((dependency) => packages.has(dependency));
  const actualPeers = Object.keys(pkg.manifest.peerDependencies ?? {}).filter((dependency) => packages.has(dependency));
  const actualOptionalPeers = actualPeers.filter((dependency) => pkg.manifest.peerDependenciesMeta?.[dependency]?.optional === true);
  const actualRequiredPeers = actualPeers.filter((dependency) => !actualOptionalPeers.includes(dependency));

  compareExactSet(name, 'workspace dependencies', actualDependencies, policy.dependencies);
  compareExactSet(name, 'optional workspace peers', actualOptionalPeers, policy.optionalPeers);
  compareExactSet(name, 'required workspace peers', actualRequiredPeers, policy.requiredPeers ?? []);
}

function compareExactSet(name, label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const value of expectedSet) {
    if (!actualSet.has(value)) errors.push(`${name} is missing expected ${label}: ${value}.`);
  }
  for (const value of actualSet) {
    if (!expectedSet.has(value)) errors.push(`${name} has unreviewed ${label}: ${value}.`);
  }
}

function checkPublicEntryPolicy(name, pkg) {
  const expected = expectedPublicEntries[name];
  if (!expected) {
    errors.push(`${name} has no public-entry policy in scripts/package-policy.mjs.`);
    return;
  }
  const actual = Object.keys(pkg.manifest.exports ?? {});
  for (const subpath of expected) {
    if (!actual.includes(subpath)) errors.push(`${name} is missing expected public export ${subpath}.`);
  }
  for (const subpath of actual) {
    if (!expected.includes(subpath)) errors.push(`${name} publishes unreviewed public export ${subpath}.`);
  }
}

function checkTypeScriptSolution() {
  if (!Array.isArray(rootTsconfig.files) || rootTsconfig.files.length !== 0) {
    errors.push('Root tsconfig.json must be a solution config with "files": [].');
  }
  const packageValues = [...packages.values()];
  const rootReferences = new Set((rootTsconfig.references ?? [])
    .map((reference) => path.resolve(root, reference.path)));
  for (const pkg of packageValues) {
    if (!rootReferences.has(pkg.directory)) {
      errors.push(`Root tsconfig.json does not reference ${pkg.manifest.name}.`);
    }
    const expectedExtends = path.relative(pkg.directory, path.join(root, 'tsconfig.base.json')).split(path.sep).join('/');
    if (pkg.tsconfig.extends !== expectedExtends) {
      errors.push(`${pkg.manifest.name} must extend ${expectedExtends}.`);
    }
    if (pkg.tsconfig.compilerOptions?.composite !== true) {
      errors.push(`${pkg.manifest.name} must enable compilerOptions.composite.`);
    }
  }
  for (const reference of rootReferences) {
    if (!packageValues.some((pkg) => pkg.directory === reference)) {
      errors.push(`Root tsconfig.json references a non-package project: ${relativeToRoot(reference)}.`);
    }
  }

  for (const [name, pkg] of packages) {
    const expectedDependencies = new Set([
      ...Object.keys(pkg.manifest.dependencies ?? {}),
      ...Object.keys(pkg.manifest.peerDependencies ?? {}),
    ].filter((dependency) => packages.has(dependency)));
    const actualDependencies = new Set((pkg.tsconfig.references ?? []).map((reference) => {
      const target = path.resolve(pkg.directory, reference.path);
      return [...packages.entries()].find(([, candidate]) => candidate.directory === target)?.[0];
    }).filter(Boolean));
    for (const dependency of expectedDependencies) {
      if (!actualDependencies.has(dependency)) {
        errors.push(`${name} tsconfig.json does not reference workspace dependency ${dependency}.`);
      }
    }
    for (const dependency of actualDependencies) {
      if (!expectedDependencies.has(dependency)) {
        errors.push(`${name} tsconfig.json references undeclared workspace dependency ${dependency}.`);
      }
    }
  }
}
checkWorkspaceCycles();
await checkApplicationImports();
await checkElementComposition();

if (errors.length > 0) {
  console.error(`Architecture check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed for ${packages.size} packages and ${modules.size} source modules.`);
}

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) output.push(full);
  }
  return output;
}

async function inspectModule(file) {
  const sourceText = await readFile(file, 'utf8');
  if (sourceText.includes('\0')) errors.push(`${relativeToRoot(file)} contains a raw NUL byte.`);
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = [];
  const declaredNames = new Set();
  const domRuntimeReferences = new Set();
  const uiPlatformReferences = new Set();
  const uiSurfaceFeatures = new Set();
  const createdElementTags = new Set();
  const markupTags = new Set();
  const classExtends = new Set();
  const wuiInternalLiterals = new Set();
  const domNames = new Set(['window', 'document', 'customElements']);

  const collectDeclarations = (node) => {
    if (
      ts.isVariableDeclaration(node) || ts.isParameter(node) ||
      ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
      ts.isImportClause(node) || ts.isImportSpecifier(node)
    ) {
      collectBindingNames(node.name, declaredNames);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(source);

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          dynamic: false,
          runtime: !isTypeOnlyDeclaration(node),
        });
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = unwrapTransparentExpression(node.arguments[0]);
      if (argument && ts.isStringLiteralLike(argument)) {
        imports.push({specifier: argument.text, dynamic: true, runtime: true});
      }
    } else if (
      ts.isIdentifier(node) && domNames.has(node.text) &&
      !declaredNames.has(node.text) && isRuntimeIdentifierReference(node)
    ) domRuntimeReferences.add(node.text);
    if (
      ts.isIdentifier(node) && isUiPlatformName(node.text) &&
      !declaredNames.has(node.text) && isIdentifierReference(node)
    ) uiPlatformReferences.add(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      if (isGlobalThisExpression(node.expression)) {
        if (domNames.has(node.name.text)) domRuntimeReferences.add(`globalThis.${node.name.text}`);
        if (isUiPlatformName(node.name.text)) uiPlatformReferences.add(`globalThis.${node.name.text}`);
      }
      // `window.customElements` / `self.customElements` hide the registry in
      // property-name position where the bare-identifier scan cannot see it.
      if (node.name.text === 'customElements') domRuntimeReferences.add('.customElements');
      const feature = uiPropertyFeature(node.name.text);
      if (feature) uiSurfaceFeatures.add(feature);
    }
    if (
      ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'customElements'
    ) domRuntimeReferences.add('.customElements');
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const feature = uiMethodFeature(node.expression.name.text);
      if (feature) uiSurfaceFeatures.add(feature);
      if (node.expression.name.text === 'createElement') {
        const tag = unwrapTransparentExpression(node.arguments[0]);
        if (tag && ts.isStringLiteralLike(tag)) createdElementTags.add(tag.text.toLowerCase());
      } else if (node.expression.name.text === 'createElementNS') {
        const tag = unwrapTransparentExpression(node.arguments[1]);
        if (tag && ts.isStringLiteralLike(tag)) createdElementTags.add(tag.text.toLowerCase());
      }
    }
    if (
      ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      for (const match of node.text.matchAll(/<(style|svg|canvas|template|div|span|button|input|select|option)(?:\s|>)/gi)) {
        const markup = match[1].toLowerCase();
        markupTags.add(markup);
        uiSurfaceFeatures.add(`<${markup}> markup`);
      }
      for (const internal of node.text.match(/(?<![a-z0-9-])wui-[a-z0-9-]+__[a-z0-9-]*/g) ?? []) {
        wuiInternalLiterals.add(internal);
      }
    }
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const type of clause.types) classExtends.add(type.expression.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const forwardingOnly = source.statements.every((statement) =>
    ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isEmptyStatement(statement));
  const forwardingSpecifiers = source.statements
    .filter((statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
    .map((statement) => statement.moduleSpecifier)
    .filter((specifier) => specifier && ts.isStringLiteralLike(specifier))
    .map((specifier) => specifier.text);
  return {
    imports,
    classExtends,
    createdElementTags,
    domRuntimeReferences,
    forwardingOnly,
    forwardingSpecifiers,
    uiPlatformReferences,
    uiSurfaceFeatures,
    markupTags,
    wuiInternalLiterals,
  };
}

function collectBindingNames(name, output) {
  if (!name) return;
  if (ts.isIdentifier(name)) {
    output.add(name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, output);
    }
  }
}

function isUiPlatformName(name) {
  return name === 'Audio' || name === 'Window' || name === 'Document' ||
    name === 'DocumentFragment' || name === 'Element' || name === 'ShadowRoot' ||
    name === 'CustomElementRegistry' || name === 'CanvasRenderingContext2D' ||
    name === 'OffscreenCanvas' || name === 'OffscreenCanvasRenderingContext2D' ||
    name === 'CanvasGradient' || name === 'CanvasPattern' || name === 'Path2D' ||
    name === 'ImageBitmap' || name === 'ImageData' || name === 'CSSStyleDeclaration' ||
    name === 'CSSStyleSheet' || name === 'DOMRect' || name === 'DOMRectReadOnly' ||
    name === 'ResizeObserver' || /^HTML[A-Za-z0-9]*Element$/.test(name) ||
    /^SVG[A-Za-z0-9]*Element$/.test(name);
}

function isGlobalThisExpression(node) {
  while (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return ts.isIdentifier(node) && node.text === 'globalThis';
}

function unwrapTransparentExpression(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

function uiPropertyFeature(name) {
  if (name === 'style') return '.style access';
  if (name === 'cssText') return '.cssText access';
  if (name === 'innerHTML') return '.innerHTML access';
  if (name === 'outerHTML') return '.outerHTML access';
  if (name === 'adoptedStyleSheets') return '.adoptedStyleSheets access';
  return undefined;
}

function uiMethodFeature(name) {
  if (name === 'attachShadow') return 'attachShadow()';
  if (name === 'createElement') return 'createElement()';
  if (name === 'createElementNS') return 'createElementNS()';
  if (name === 'getBoundingClientRect') return 'getBoundingClientRect()';
  return undefined;
}

function isIdentifierReference(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) ||
      ts.isImportClause(parent) || ts.isImportSpecifier(parent) ||
      ts.isBindingElement(parent)) && parent.name === node
  ) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isComputedPropertyName(parent.name)) return false;
  return true;
}

function isRuntimeIdentifierReference(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return false;
    if (ts.isExpressionStatement(current) || ts.isStatement(current) || ts.isSourceFile(current)) break;
  }
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isComputedPropertyName(parent.name)) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  return true;
}

function isTypeOnlyDeclaration(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    return !clause.name && ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
  }
  if (node.isTypeOnly) return true;
  return node.exportClause && ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly);
}

function checkExportEntries(name, pkg) {
  const sourceByExport = new Set();
  for (const [subpath, target] of Object.entries(pkg.manifest.exports ?? {})) {
    if (subpath === './package.json') continue;
    // Module entries nest conditions ({import: {types, default}, require:
    // {...}}); browser-IIFE entries stay flat {types, default}.
    const typesTarget =
      typeof target === 'object' ? (target.import?.types ?? target.types) : undefined;
    if (!typesTarget) {
      errors.push(`${name} export ${subpath} has no types target.`);
      continue;
    }
    const relative = typesTarget.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '');
    const candidates = [
      path.join(pkg.sourceRoot, `${relative}.ts`),
      path.join(pkg.sourceRoot, `${relative}.tsx`),
    ];
    const source = candidates.find((candidate) => allSourceFiles.has(candidate));
    if (!source) {
      errors.push(`${name} export ${subpath} does not map to a source entry (${typesTarget}).`);
      continue;
    }
    sourceByExport.add(source);
    if (!pkg.buildEntries.includes(source)) {
      errors.push(`${name} export ${subpath} source ${relative} is missing from its build entries.`);
    }
  }
  const internal = new Set((internalBuildEntries[name] ?? []).map((entry) => path.join(pkg.sourceRoot, entry)));
  for (const entry of pkg.buildEntries) {
    if (!sourceByExport.has(entry) && !internal.has(entry)) {
      errors.push(`${name} builds ${relativeToRoot(entry)} but does not publish a matching export.`);
    }
  }
}

function checkFeatureLayers(name, pkg) {
  // Only the family packages carry the capability/feature-layer contract;
  // kernel and UI are flat packages.
  const layersByCapability = requiredFeatureLayers[name];
  if (!layersByCapability) return;

  // The package root barrel must forward the core model, and each feature
  // capability's root must forward its internal src/api (the capability root
  // IS the API since the merge — no /api subpath is published).
  const packageRoot = modules.get(path.join(pkg.sourceRoot, 'index.ts'));
  if (!packageRoot?.forwardingOnly || packageRoot.forwardingSpecifiers.length !== 1 ||
      packageRoot.forwardingSpecifiers[0] !== './core') {
    errors.push(`${name} root source must be a forwarding barrel containing only an export from ./core.`);
  }

  for (const [capability, layers] of Object.entries(layersByCapability)) {
    const sources = Object.fromEntries(Object.entries(layers)
      .map(([layer, relative]) => [layer, path.join(pkg.sourceRoot, relative)]));
    for (const [layer, source] of Object.entries(sources)) {
      if (!allSourceFiles.has(source)) {
        errors.push(`${name} ${capability} is missing required ${layer} layer source ${relativeToRoot(source)}.`);
      }
    }

    // The capability root export maps to <capability>/index.ts; headless and
    // element layers keep their own public subpaths.
    for (const [layer, subpath] of Object.entries({
      api: `./${capability}`,
      headless: `./${capability}/headless`,
      element: `./${capability}/element`,
    })) {
      const target = pkg.manifest.exports?.[subpath];
      if (!target || typeof target !== 'object') {
        errors.push(`${name} is missing public ${layer} layer export ${subpath}.`);
        continue;
      }
      const source = sourceForTypesTarget(pkg, target.import?.types ?? target.types);
      const expectedSource = layer === 'api'
        ? path.join(pkg.sourceRoot, capability, 'index.ts')
        : sources[layer];
      if (source !== expectedSource) {
        errors.push(`${name} ${subpath} must map to ${path.relative(pkg.sourceRoot, expectedSource).replaceAll(path.sep, '/')}.`);
      }
    }

    const capabilityRoot = modules.get(path.join(pkg.sourceRoot, capability, 'index.ts'));
    if (!capabilityRoot?.forwardingOnly || capabilityRoot.forwardingSpecifiers.length !== 1 ||
        capabilityRoot.forwardingSpecifiers[0] !== './api') {
      errors.push(`${name} ${capability} root source must be a forwarding barrel containing only an export from ./api.`);
    }

    // render/ and demos/ are DOM-capable siblings that may legally import
    // @webmusic/ui, so a code-only layer reaching them would open a two-hop
    // route to the presenter surface.
    const forbiddenLayers = {
      core: [`${capability}/api/`, `${capability}/headless/`, `${capability}/element/`, `${capability}/render/`, `${capability}/demos/`],
      api: [`${capability}/element/`, `${capability}/render/`, `${capability}/demos/`],
      headless: [`${capability}/api/`, `${capability}/element/`, `${capability}/render/`, `${capability}/demos/`],
    };

    // Audit every physically classified source, not just files re-exported by
    // the layer barrel. Technical entries can legitimately reach a private
    // layer module directly (for example a Worker handler), and that module
    // must obey the same direction even when it is not part of the public
    // barrel.
    for (const file of pkg.files) {
      const relative = path.relative(pkg.sourceRoot, file).replaceAll(path.sep, '/');
      const layer = ['core', 'api', 'headless']
        .find((candidate) => relative.startsWith(`${capability}/${candidate}/`));
      if (!layer) continue;
      const inspected = modules.get(file);
      if (!inspected) continue;
      for (const imported of inspected.imports) {
        if (!imported.specifier.startsWith('.')) {
          // Code-only layers may reach other workspace packages only through
          // the platform kernel. A headless module that pulls in @webmusic/ui
          // (or a sibling domain) collapses "element = headless + ui
          // presenter" without any relative edge for the rules below to see.
          const dependency = packageName(imported.specifier);
          const kernelElementEntry = dependency === '@webmusic/kernel' &&
            (imported.specifier === '@webmusic/kernel/element' ||
              imported.specifier.startsWith('@webmusic/kernel/element/'));
          if (packages.has(dependency) && dependency !== name &&
              (dependency !== '@webmusic/kernel' || kernelElementEntry)) {
            errors.push(`${name} ${capability} ${layer} source ${relative} imports workspace package ${imported.specifier}; code-only layers may reach only @webmusic/kernel (and never its /element entry).`);
          }
          continue;
        }
        const resolved = resolveLocal(file, imported.specifier);
        if (!resolved) continue;
        const target = path.relative(pkg.sourceRoot, resolved).replaceAll(path.sep, '/');
        for (const forbidden of forbiddenLayers[layer]) {
          if (target.startsWith(forbidden)) {
            errors.push(`${name} ${capability} ${layer} source ${relative} imports forbidden ${target}.`);
          }
        }
      }
      const features = codeOnlyUiFeatures(inspected);
      if (features.size > 0) {
        errors.push(`${name} ${capability} ${layer} source ${relative} contains UI/DOM surface feature(s) ${[...features].join(', ')}.`);
      }
    }

    for (const layer of ['core', 'api', 'headless']) {
      const source = sources[layer];
      if (!allSourceFiles.has(source)) continue;
      // Layer direction applies to every static edge, including type-only and
      // dynamic imports; those edges still couple the source responsibilities.
      for (const file of staticReachable(source, {includeTypeOnly: true, includeDynamic: true})) {
        const relative = path.relative(pkg.sourceRoot, file).replaceAll(path.sep, '/');
        for (const forbidden of forbiddenLayers[layer]) {
          if (relative.startsWith(forbidden)) {
            errors.push(`${name} ${capability} ${layer} layer reaches forbidden ${relative}.`);
          }
        }
        const inspected = modules.get(file);
        if (!inspected) continue;
        const features = codeOnlyUiFeatures(inspected);
        if (features.size > 0) {
          errors.push(`${name} ${capability} ${layer} layer reaches UI/DOM surface feature(s) ${[...features].join(', ')} via ${relative}.`);
        }
      }
    }
  }
}

function checkCapabilityBoundaries(name, pkg) {
  const table = capabilityDependencies[name];
  if (!table) return;
  const capabilityOf = (relative) =>
    relative === 'index.ts' ? 'root' : relative.split('/')[0];
  for (const file of pkg.files) {
    const relative = path.relative(pkg.sourceRoot, file).replaceAll(path.sep, '/');
    const capability = capabilityOf(relative);
    const allowed = table[capability];
    if (!allowed) {
      errors.push(`${name} source ${relative} belongs to unreviewed capability "${capability}".`);
      continue;
    }
    for (const imported of modules.get(file)?.imports ?? []) {
      if (!imported.specifier.startsWith('.')) continue;
      const resolved = resolveLocal(file, imported.specifier);
      if (!resolved) continue;
      const target = capabilityOf(path.relative(pkg.sourceRoot, resolved).replaceAll(path.sep, '/'));
      if (target !== capability && target !== 'root' && !allowed.includes(target)) {
        errors.push(`${name} capability boundary violation: ${relative} imports ${target} (allowed: ${allowed.join(', ') || 'none'}).`);
      }
    }
  }
}

function codeOnlyUiFeatures(inspected) {
  return new Set([
    ...[...inspected.domRuntimeReferences].map((name) => `runtime ${name}`),
    ...[...inspected.uiPlatformReferences].map((name) => `${name} reference`),
    ...inspected.uiSurfaceFeatures,
  ]);
}

function sourceForTypesTarget(pkg, typesTarget) {
  if (typeof typesTarget !== 'string') return undefined;
  const relative = typesTarget.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '');
  return [
    path.join(pkg.sourceRoot, `${relative}.ts`),
    path.join(pkg.sourceRoot, `${relative}.tsx`),
  ].find((candidate) => allSourceFiles.has(candidate));
}

function checkSideEffectPolicy(name, pkg) {
  const expected = expectedSideEffectEntries[name];
  if (!expected) {
    errors.push(`${name} has no side-effect entry policy in scripts/package-policy.mjs.`);
    return;
  }
  const expectedSet = new Set(expected);
  for (const subpath of expectedSet) {
    if (!pkg.manifest.exports?.[subpath]) errors.push(`${name} is missing side-effect export ${subpath}.`);
  }
  for (const [subpath, target] of Object.entries(pkg.manifest.exports ?? {})) {
    // Nested conditions put the runtime files under import.default /
    // require.default; the flat browser-IIFE entry keeps a plain default.
    const runtimeTargets = typeof target === 'object'
      ? [target.import?.default, target.require?.default, target.default]
          .filter((value) => typeof value === 'string')
      : [];
    for (const runtimeTarget of runtimeTargets) {
      const covered = sideEffectsCover(pkg.manifest.sideEffects, runtimeTarget);
      if (expectedSet.has(subpath) && !covered) {
        errors.push(`${name} side-effect export ${subpath} target ${runtimeTarget} is missing from sideEffects.`);
      } else if (!expectedSet.has(subpath) && covered) {
        errors.push(`${name} marks pure export ${subpath} target ${runtimeTarget} as a side effect.`);
      }
    }
  }
}

function sideEffectsCover(sideEffects, target) {
  if (!Array.isArray(sideEffects)) return false;
  const normalized = target.replace(/^\.\//, '');
  return sideEffects.some((pattern) => globMatches(pattern.replace(/^\.\//, ''), normalized));
}

function globMatches(pattern, value) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (char === '*') expression += '[^/]*';
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${expression}$`).test(value);
}

function checkImports(name, pkg) {
  const declared = {
    ...pkg.manifest.dependencies,
    ...pkg.manifest.peerDependencies,
  };
  for (const file of pkg.files) {
    for (const imported of modules.get(file).imports) {
      if (imported.specifier.startsWith('.')) {
        const resolved = resolveLocal(file, imported.specifier);
        if (!resolved) {
          errors.push(`${relativeToRoot(file)} cannot resolve ${imported.specifier}.`);
        } else if (!resolved.startsWith(`${pkg.sourceRoot}${path.sep}`)) {
          errors.push(`${relativeToRoot(file)} escapes its package source through ${imported.specifier}.`);
        }
        continue;
      }
      const dependency = packageName(imported.specifier);
      if (unpublishedWorkspacePackage(imported.specifier, packages.keys())) {
        errors.push(`${relativeToRoot(file)} imports unavailable release package ${dependency}.`);
        continue;
      }
      if (!packages.has(dependency)) continue;
      if (dependency === name) {
        // Node resolves a package's own name through its exports map, which
        // would let a file reach a public entry (say, /play/element from the
        // headless layer) while the relative-only layer, capability, and
        // reachability checks stay blind to the edge. Force relative imports
        // inside a package so every rule sees them.
        errors.push(`${relativeToRoot(file)} imports its own package as ${imported.specifier} — use a relative import so the layer and capability rules apply.`);
        continue;
      }
      if (!declared[dependency]) {
        errors.push(`${relativeToRoot(file)} imports undeclared workspace dependency ${dependency}.`);
      }
      const subpath = imported.specifier === dependency
        ? '.'
        : `./${imported.specifier.slice(dependency.length + 1)}`;
      if (!packages.get(dependency).manifest.exports?.[subpath]) {
        errors.push(`${relativeToRoot(file)} imports unpublished subpath ${imported.specifier}.`);
      }
    }
  }
}

// The ui kit publishes presenters, not Web Components: registration and
// HTMLElement subclassing live in the domain families' element layers. The
// dependency policy keeps ui import-clean and the entry checks prove imports
// are DOM-safe, but a registration inside a mount function evaluates nothing
// at import — this source scan closes that runtime-deferred route.
/**
 * L4, the semantic half: @webmusic/ui may take a domain COORDINATE but must not
 * know a domain CONVENTION.
 *
 * The kit's ports are structural, so a MIDI number, a position in quarters or a
 * level in dB are all fine — they are numbers its callers happen to name. What
 * it must not carry is how those numbers are SPELLED: which accidental a pitch
 * takes, which glyph a duration takes, that a dot adds half again. Those are
 * answers @webmusic/score already has, and when the kit answered them too the
 * two disagreed inside one panel — `midiName` spelled all sharps against
 * Score's mixed spelling (a58ab87), and `durationGlyph` notated rhythm the kit
 * had no business notating.
 *
 * The check is the notation itself: the Musical Symbols block and the
 * note/accidental range. Transport iconography is deliberately NOT caught —
 * a play triangle or a skip glyph is UI, not a convention of this domain, and
 * mixer/playlist/recorder use several.
 *
 * The forbidden-import rule is what grows these copies: the kit cannot import
 * the fact, so it reimplements it. A callback is how a domain-neutral presenter
 * borrows one instead.
 */
function checkUiDomainVocabulary(name, pkg) {
  if (name !== '@webmusic/ui') return;
  const notation = /[\u2669-\u266F]|[\u{1D100}-\u{1D1FF}]/gu;
  for (const file of pkg.files) {
    const text = readFileSync(file, 'utf8');
    const seen = new Set();
    for (const match of text.matchAll(notation)) {
      if (seen.has(match[0])) continue;
      seen.add(match[0]);
      errors.push(
        `${relativeToRoot(file)} contains the musical notation ${JSON.stringify(match[0])}; @webmusic/ui lays notes out, and its caller says what they are called — take a formatter callback instead.`,
      );
    }
  }
}

/**
 * L3: the element lifecycle primitives live in @webmusic/kernel, once.
 *
 * `numAttr`, `boolAttr`, `cssSizeAttr`, `upgradeProperty`, `upgradeProperties`
 * and `defineOnce` are re-exported into every element family through its own
 * `internal/base.ts` seam, so a private copy is never the shorter path — it is
 * just a copy that will not receive the next hardening. Two byte-identical
 * `defineOnce`s had already drifted out into the demo elements.
 */
function checkKernelPrimitiveOwnership(name, pkg) {
  if (name === '@webmusic/kernel') return;
  const primitives = [
    'numAttr',
    'boolAttr',
    'cssSizeAttr',
    'upgradeProperty',
    'upgradeProperties',
    'defineOnce',
  ];
  for (const file of pkg.files) {
    const text = readFileSync(file, 'utf8');
    for (const primitive of primitives) {
      if (new RegExp(`^(?:export )?(?:function|const|let) ${primitive}\\b`, 'm').test(text)) {
        errors.push(
          `${relativeToRoot(file)} defines ${primitive}; @webmusic/kernel/element owns it, and this package's element internal/base.ts already re-exports it.`,
        );
      }
    }
  }
}

function checkUiWebComponentFreedom(name, pkg) {
  if (name !== '@webmusic/ui') return;
  for (const file of pkg.files) {
    const inspected = modules.get(file);
    for (const reference of inspected.domRuntimeReferences) {
      if (reference === 'customElements' || reference === 'globalThis.customElements' || reference === '.customElements') {
        errors.push(`${relativeToRoot(file)} references ${reference}; @webmusic/ui must stay free of web-component machinery.`);
      }
    }
    for (const heritage of inspected.classExtends) {
      if (/^(globalThis\.)?(HTML[A-Za-z0-9]*Element|Element|ShadowRoot)$/.test(heritage)) {
        errors.push(`${relativeToRoot(file)} declares a class extending ${heritage}; @webmusic/ui must not define Web Components.`);
      }
    }
  }
}

// The `wui-*__*` descendant class names are @webmusic/ui presenter internals;
// handles and part tokens are the stable route to presenter DOM. Ban the
// namespace in every other package's sources so a caret-compatible ui markup
// change cannot silently break a consumer keyed to the old internals.
function checkWuiInternalNamespace(name, pkg) {
  if (name === '@webmusic/ui') return;
  for (const file of pkg.files) {
    for (const literal of modules.get(file).wuiInternalLiterals) {
      errors.push(`${relativeToRoot(file)} embeds ui-internal class name ${literal}; use part tokens or the presenter handle instead.`);
    }
  }
}

function checkLayerBoundary(name, pkg) {
  const boundaryRoots = new Set(pkg.buildEntries.filter((entry) => {
    const relative = path.relative(pkg.sourceRoot, entry).replaceAll(path.sep, '/');
    // `element/global.ts` is the declaration source for the browser-only
    // IIFE global. Like the element index/auto entries, it intentionally
    // belongs to the element/browser surface rather than a headless root;
    // demos are published element compositions. Since the merge these live
    // one capability directory down.
    return !/(?:^|\/)element\/(?:index|auto|global)\.ts$/.test(relative) &&
      !/(?:^|\/)demos\/index\.ts$/.test(relative);
  }));
  const domFreeRelatives = domFreeEntrySources[name] ?? [];
  const domFreeEntries = new Set(domFreeRelatives.map((relative) => path.join(pkg.sourceRoot, relative)));
  const reachabilityPolicy = forbiddenEntryReachability[name] ?? {};
  const optionalPeers = new Set(Object.entries(pkg.manifest.peerDependenciesMeta ?? {})
    .filter(([, metadata]) => metadata?.optional)
    .map(([peer]) => peer));

  // These tables are keyed by source module. Several rows name a layer index
  // (`play/api/index.ts`) that is not a tsup build entry, so walking build
  // entries alone would skip them — the row would read as an enforced rule
  // while enforcing nothing. Analyse from every keyed module as well, and
  // reject a key that names no source at all.
  const sourceFiles = new Set(pkg.files);
  const policyRoots = new Set();
  for (const [table, keys] of [
    ['domFreeEntrySources', domFreeRelatives],
    ['forbiddenEntryReachability', Object.keys(reachabilityPolicy)],
    ['staticOptionalPeerEntries', Object.keys(staticOptionalPeerEntries[name] ?? {})],
  ]) {
    for (const key of keys) {
      const absolute = path.join(pkg.sourceRoot, key);
      if (sourceFiles.has(absolute)) policyRoots.add(absolute);
      else errors.push(`${name} ${table} row "${key}" names no source module in the package.`);
    }
  }

  for (const entry of new Set([...pkg.buildEntries, ...policyRoots])) {
    const isBuildEntry = pkg.buildEntries.includes(entry);
    for (const file of staticReachable(entry)) {
      const module = modules.get(file);
      if (!module) {
        errors.push(`${relativeToRoot(entry)} reaches unknown source module ${relativeToRoot(file)}.`);
        continue;
      }
      const relative = path.relative(pkg.sourceRoot, file).replaceAll(path.sep, '/');
      if (boundaryRoots.has(entry) && /(?:^|\/)element\//.test(relative)) {
        errors.push(`${name} non-element entry ${relativeToRoot(entry)} reaches ${relative}.`);
      }
      if (domFreeEntries.has(entry) && module.domRuntimeReferences.size > 0) {
        errors.push(`${relativeToRoot(entry)} reaches runtime DOM global(s) ${[...module.domRuntimeReferences].join(', ')} via ${relative}.`);
      }
      const entryRelative = path.relative(pkg.sourceRoot, entry).replaceAll(path.sep, '/');
      for (const forbidden of reachabilityPolicy[entryRelative] ?? []) {
        if (relative === forbidden || (forbidden.endsWith('/') && relative.startsWith(forbidden))) {
          errors.push(`${relativeToRoot(entry)} reaches forbidden state/resource layer ${relative}.`);
        }
      }
      if (!isBuildEntry) continue;
      const entryAllowedPeers = staticOptionalPeerEntries[name]?.[
        path.relative(pkg.sourceRoot, entry).replaceAll(path.sep, '/')
      ] ?? [];
      for (const imported of module.imports) {
        if (imported.dynamic || !imported.runtime || imported.specifier.startsWith('.')) continue;
        const dependency = packageName(imported.specifier);
        if (optionalPeers.has(dependency) && !entryAllowedPeers.includes(dependency)) {
          errors.push(`${relativeToRoot(entry)} statically reaches optional peer ${dependency} via ${relative}.`);
        }
      }
    }
  }
}

function staticReachable(entry, {includeTypeOnly = false, includeDynamic = false} = {}) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imported of modules.get(file)?.imports ?? []) {
      if (
        (!includeDynamic && imported.dynamic) ||
        (!includeTypeOnly && !imported.runtime) ||
        !imported.specifier.startsWith('.')
      ) continue;
      const resolved = resolveLocal(file, imported.specifier);
      if (resolved) pending.push(resolved);
    }
  }
  return seen;
}

function checkInternalSourceReachability(name, pkg) {
  const reachable = new Set();
  const pending = [...pkg.buildEntries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const imported of modules.get(file)?.imports ?? []) {
      if (!imported.specifier.startsWith('.')) continue;
      const resolved = resolveLocal(file, imported.specifier);
      if (resolved) pending.push(resolved);
    }
  }
  for (const file of pkg.files) {
    if (!reachable.has(file)) {
      errors.push(`${name} has orphan source not reachable from any build entry: ${relativeToRoot(file)}.`);
    }
  }
}

function checkInternalCycles(name, pkg) {
  const visited = new Set();
  const active = [];
  const reported = new Set();
  const visit = (file) => {
    const cycleStart = active.indexOf(file);
    if (cycleStart >= 0) {
      const cycle = [...active.slice(cycleStart), file];
      const key = [...new Set(cycle)].sort().join('|');
      if (!reported.has(key)) {
        reported.add(key);
        errors.push(`${name} runtime source cycle: ${cycle.map((entry) => path.relative(pkg.sourceRoot, entry).replaceAll(path.sep, '/')).join(' -> ')}.`);
      }
      return;
    }
    if (visited.has(file)) return;
    active.push(file);
    for (const imported of modules.get(file)?.imports ?? []) {
      if (imported.dynamic || !imported.runtime || !imported.specifier.startsWith('.')) continue;
      const resolved = resolveLocal(file, imported.specifier);
      if (resolved?.startsWith(`${pkg.sourceRoot}${path.sep}`)) visit(resolved);
    }
    active.pop();
    visited.add(file);
  };
  for (const file of pkg.files) visit(file);
}

async function checkApplicationImports() {
  const applicationRoots = [path.join(root, 'app'), path.join(root, 'apps')].filter((dir) => existsSync(dir));
  const files = (await Promise.all(applicationRoots.map(applicationTextFiles))).flat();
  const pattern = /(?:from\s+|import\s*(?:\(\s*)?)["'](@(?:webscore|webaudio|webmusic)\/[a-z-]+(?:\/[a-z0-9._/-]+)?)["']/g;
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      const dependency = packageName(specifier);
      if (unpublishedWorkspacePackage(specifier, packages.keys())) {
        errors.push(`${relativeToRoot(file)} imports unavailable release package ${dependency}.`);
        continue;
      }
      if (!packages.has(dependency)) continue;
      const subpath = specifier === dependency
        ? '.'
        : `./${specifier.slice(dependency.length + 1)}`;
      if (!packages.get(dependency).manifest.exports?.[subpath]) {
        errors.push(`${relativeToRoot(file)} imports unpublished workspace subpath ${specifier}.`);
      }
    }
  }
}

async function applicationTextFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['dist', 'node_modules', '.astro'].includes(entry.name)) {
        output.push(...await applicationTextFiles(full));
      }
    } else if (/\.(?:astro|js|md|mdx|mjs|ts|tsx)$/.test(entry.name)) output.push(full);
  }
  return output;
}

/**
 * Every public domain element is a thin composition of reusable domain
 * behavior and a published presenter. Domain-specific painters may live in
 * render/, but controls and visual surfaces must be created by @webmusic/ui.
 */
async function checkElementComposition() {
  const publishedUiSubpaths = Object.keys(packages.get('@webmusic/ui')?.manifest.exports ?? {})
    .filter((subpath) => subpath !== '.' && subpath !== './package.json')
    .map((subpath) => subpath.startsWith('./') ? subpath.slice(2) : subpath);
  const publishedUiSubpathSet = new Set(publishedUiSubpaths);
  const staticallyReachedUiSubpaths = new Set();
  const seenTags = new Set();
  const seenSources = new Set();
  // Counts are derived from reviewed sources and catalogs. Exact membership,
  // dependency closure and presenter ownership below remain the public gates.
  for (const entry of elementCompositionPolicy) {
    if (!domainFamilies.includes(entry.family.toLowerCase())
      || !['Play', 'Analyze', 'View'].includes(entry.capability)) {
      errors.push(`Element composition policy has an unknown family/capability for <${entry.tag}>.`);
    } else if (!entry.source.startsWith(
      `packages/${entry.family.toLowerCase()}/src/${entry.capability.toLowerCase()}/element/`,
    )) {
      errors.push(`Element composition policy source disagrees with its family/capability for <${entry.tag}>.`);
    }
    if (seenTags.has(entry.tag)) errors.push(`Element composition policy repeats tag <${entry.tag}>.`);
    seenTags.add(entry.tag);
    if (seenSources.has(entry.source)) errors.push(`Element composition policy repeats source ${entry.source}.`);
    seenSources.add(entry.source);

    const source = path.join(root, entry.source);
    if (!modules.has(source)) {
      errors.push(`Element composition policy source does not exist: ${entry.source}.`);
      continue;
    }
    const sourceText = await readFile(source, 'utf8');
    const reachable = staticReachable(source, {includeDynamic: true});
    const staticallyReachable = staticReachable(source);
    const architecturalReachable = staticReachable(source, {includeDynamic: true, includeTypeOnly: true});
    const bareUiImports = [...staticallyReachable].flatMap((file) =>
      (modules.get(file)?.imports ?? [])
        .filter((imported) => imported.runtime && !imported.dynamic && imported.specifier === '@webmusic/ui')
        .map(() => relativeToRoot(file)));
    for (const file of bareUiImports) {
      errors.push(`<${entry.tag}> statically reaches bare @webmusic/ui via ${file}; elements must import reviewed presenter subpaths.`);
    }
    const uiImports = new Set([...staticallyReachable].flatMap((file) =>
      (modules.get(file)?.imports ?? [])
        .filter((imported) => imported.runtime && !imported.dynamic && imported.specifier.startsWith('@webmusic/ui/'))
        .map((imported) => imported.specifier.slice('@webmusic/ui/'.length))));
    for (const presenter of uiImports) staticallyReachedUiSubpaths.add(presenter);

    if (entry.behaviorOnly) {
      if (entry.ui.length > 0) errors.push(`<${entry.tag}> is behavior-only but declares UI presenters.`);
      if (uiImports.size > 0) {
        errors.push(`<${entry.tag}> is behavior-only but reaches @webmusic/ui presenter(s): ${[...uiImports].join(', ')}.`);
      }
    } else {
      for (const presenter of entry.ui) {
        if (!publishedUiSubpathSet.has(presenter)) {
          errors.push(`<${entry.tag}> declares unpublished presenter @webmusic/ui/${presenter}.`);
        }
        if (!uiImports.has(presenter)) {
          errors.push(`<${entry.tag}> does not reach its required published presenter @webmusic/ui/${presenter}.`);
        }
      }
    }

    const reachesDomainBehavior = [...architecturalReachable].some((file) => {
      const relative = relativeToRoot(file);
      return /packages\/score\/src\/(?:core\/|(?:play|analyze|view)\/(?:core|headless)\/)/.test(relative);
    });
    if (!reachesDomainBehavior) {
      errors.push(`<${entry.tag}> does not reach a reusable domain core/headless module.`);
    }

    // Slider ARIA belongs to the presenter that owns the control, for every
    // element. Writing `role="slider"`, `aria-value*` or `tabindex` claims a
    // contract @webmusic/ui/stage already implements, and the two owners then
    // disagree the moment one of them repaints.
    //
    // Scanned across the element's own-package closure, because the violation
    // this was written for lived one import away, in render/. A gate that
    // reads `entry.source` alone could miss a second interaction owner in a
    // reachable render module.
    const sliderAriaBans = [
      [/setAttribute\(\s*["']role["']\s*,\s*["']slider["']/, 'writes role="slider"'],
      [
        /(?:setAttribute|removeAttribute)\(\s*["'](?:aria-value(?:min|max|now|text)|tabindex)["']/,
        'writes slider ARIA or tabindex',
      ],
      [/\.tabIndex\s*=/, 'assigns tabIndex'],
    ];
    for (const file of staticallyReachable) {
      const relative = relativeToRoot(file);
      if (!/^packages\/score\/src\//.test(relative)) continue;
      const text = await readFile(file, 'utf8');
      for (const [pattern, description] of sliderAriaBans) {
        if (pattern.test(text)) {
          errors.push(
            `<${entry.tag}> ${description} in ${relative}; the presenter that owns the control owns its ARIA.`,
          );
        }
      }
    }

    const forbiddenTags = new Set(['button', 'input', 'select', 'option', 'canvas', 'svg']);
    for (const file of reachable) {
      const relative = relativeToRoot(file);
      if (!/packages\/score\/src\/(?:play|analyze|view)\/element\//.test(relative)) continue;
      const inspected = modules.get(file);
      const directTags = new Set([
        ...[...inspected.createdElementTags].filter((tag) => forbiddenTags.has(tag)),
        ...[...inspected.markupTags].filter((tag) => forbiddenTags.has(tag)),
      ]);
      if (directTags.size > 0) {
        errors.push(`<${entry.tag}> reaches element-layer UI primitive(s) ${[...directTags].map((tag) => `<${tag}>`).join(', ')} via ${relative}; move them into @webmusic/ui or a domain render adapter.`);
      }
      const htmlMutation = ['.innerHTML access', '.outerHTML access']
        .filter((feature) => inspected.uiSurfaceFeatures.has(feature));
      if (htmlMutation.length > 0) {
        errors.push(`<${entry.tag}> reaches raw HTML mutation (${htmlMutation.join(', ')}) via ${relative}; presenters must own their DOM.`);
      }
    }

    // <note-input> has a reviewed interaction boundary: @webmusic/ui/note owns
    // every presenter-node lookup, pointer/key/focus listener, pressed/ARIA
    // mutation and pointer holder. Keep this deliberately source-specific until
    // the remaining legacy elements have migrated, so source/player binding
    // listeners elsewhere do not become false positives.
    if (entry.tag === 'note-input') {
      const sourceText = await readFile(source, 'utf8');
      const forbiddenInteraction = [
        ['presenter-node query', /\.querySelector(?:All)?\s*\(/],
        ['presenter class mutation', /\.classList\s*\./],
        ['presenter ARIA mutation', /\.(?:setAttribute|removeAttribute)\s*\(\s*['"`]aria-/],
        ['pointer capture', /\.(?:setPointerCapture|releasePointerCapture)\s*\(/],
        ['direct UI interaction listener', /\.addEventListener\s*\(\s*['"`](?:pointer|key|focus|blur)/],
        ['element-owned PointerSurface', /\bnew\s+PointerSurface\s*\(/],
        ['presenter internal access', /\bhandle\??\.(?:element|board)\b/],
      ];
      for (const [label, pattern] of forbiddenInteraction) {
        if (pattern.test(sourceText)) {
          errors.push(`<note-input> contains ${label} in ${entry.source}; @webmusic/ui/note must own note-surface interaction.`);
        }
      }
    }

    // A kit token is the PRESENTER's vocabulary. An element writing one is
    // configuring a presenter through a name it does not own — `<sheet-view>`
    // set `--wm-stage-overflow` to get a scrollable stage until StageOptions
    // grew an `overflow` option for it. Ask the presenter instead.
    //
    // Scoped to element sources on purpose: a render helper composing a
    // presenter for a caller may still pass that caller's theming through, as
    // documented by that helper's public options.
    for (const match of sourceText.matchAll(/setProperty\s*\(\s*['"`](--wm-[a-z0-9-]+)/g)) {
      errors.push(
        `<${entry.tag}> writes the kit token ${match[1]} in ${entry.source}; presenters take options, not token writes from their elements.`,
      );
    }

    // The synth panel is a composition root, not a layout/widget factory.
    // @webmusic/ui/panel owns its section skeleton, macro owns the compound
    // macro list, and the specialized presenters own every descendant class.
    if (entry.tag === 'synth-panel') {
      const sourceText = await readFile(source, 'utf8');
      const forbiddenComposition = [
        ['section/slot DOM creation', /\.createElement(?:NS)?\s*\(/],
        ['presenter-node query', /\.querySelector(?:All)?\s*\(/],
        ['presenter class mutation', /\.classList\s*\./],
        ['single-macro wrapper composition', /\bmountMacro\s*\(/],
        ['presenter-control mutation', /\.(?:controls|element)\b/],
      ];
      for (const [label, pattern] of forbiddenComposition) {
        if (pattern.test(sourceText)) {
          errors.push(`<synth-panel> contains ${label} in ${entry.source}; published UI compound presenters must own its DOM.`);
        }
      }
    }

    // rack-control supplies its own part tokens through MixerOptions. Styling
    // generic descendants would couple the element to mixer's private markup.
    if (entry.tag === 'rack-control') {
      const sourceText = await readFile(source, 'utf8');
      const privateSelector = /(?:\.wui-mixer\s+)?(?:\.fader\b|\.name\b|input\s*\{)/;
      if (privateSelector.test(sourceText)) {
        errors.push(`<rack-control> styles mixer-internal selectors in ${entry.source}; use published mixer parts/classNames.`);
      }
    }

    // Score converts seconds to quarters only. Span lookup, cached parsing,
    // active paint and scrolling belong to the formal UI analysis controller.
    if (entry.family === 'Score' && entry.capability === 'Analyze') {
      const playheadSource = path.join(root, 'packages/score/src/analyze/element/internal/playhead.ts');
      const playheadText = await readFile(playheadSource, 'utf8');
      const forbiddenPlayhead = [
        ['analysis span query', /\.querySelector(?:All)?\s*\(/],
        ['inline style mutation', /\.(?:style|cssText)\b/],
        ['UI span parser dependency', /\b(?:ANALYSIS_SPAN_SELECTOR|readAnalysisSpans|readAnalysisIdleStyle)\b/],
      ];
      for (const [label, pattern] of forbiddenPlayhead) {
        if (pattern.test(playheadText)) {
          errors.push(`Score analysis playhead contains ${label}; @webmusic/ui/analysis must own playhead presentation.`);
        }
      }
      if (!/\bcreateAnalysisPlayhead\s*\(/.test(playheadText)) {
        errors.push('Score analysis playhead must delegate to createAnalysisPlayhead().');
      }
    }
  }

  compareExactSet(
    'Element UI import closure',
    'published UI subpath',
    [...staticallyReachedUiSubpaths],
    publishedUiSubpaths.filter((presenter) => !standaloneUiPresenters.includes(presenter)),
  );
  for (const presenter of standaloneUiPresenters) {
    if (!publishedUiSubpathSet.has(presenter)) {
      errors.push(`Standalone presenter policy names unpublished @webmusic/ui/${presenter}.`);
    }
  }

  const catalogPath = path.join(root, 'apps/doc/shared/ui-catalog.ts');
  const catalog = await readFile(catalogPath, 'utf8');
  const catalogTags = [...catalog.matchAll(/\btag:\s*'([^']+)'/g)].map((match) => match[1]);
  compareExactSet('UI composition catalog', 'element tags', catalogTags, [...seenTags]);
  for (const entry of elementCompositionPolicy) {
    const lines = catalog.split('\n').filter((line) => line.includes(`tag: '${entry.tag}'`));
    if (lines.length !== 1) {
      errors.push(`UI composition catalog must contain exactly one row for <${entry.tag}>; found ${lines.length}.`);
      continue;
    }
    const line = lines[0];
    if (entry.behaviorOnly) {
      if (!line.includes("status: 'behavior'") || line.includes('publishedUi: true')) {
        errors.push(`UI composition catalog must mark <${entry.tag}> as the presenter-free behavior exception.`);
      }
    } else if (!line.includes("status: 'composed'") || !line.includes('publishedUi: true')) {
      errors.push(`UI composition catalog must mark visible element <${entry.tag}> as composed with published UI.`);
    }
  }

  const classifiedUiPresenters = [];
  const presenterClasses = new Map();
  for (const [classSlug, presenters] of Object.entries(uiPresenterClassPolicy)) {
    for (const presenter of presenters) {
      const previousClass = presenterClasses.get(presenter);
      if (previousClass) {
        errors.push(`UI presenter ${presenter} is classified in both ${previousClass} and ${classSlug}.`);
      }
      presenterClasses.set(presenter, classSlug);
      classifiedUiPresenters.push(presenter);
    }
  }
  compareExactSet(
    'UI presenter class policy',
    'published presenter subpath',
    classifiedUiPresenters,
    publishedUiSubpaths,
  );

  const presenterCatalogPath = path.join(root, 'apps/doc/shared/ui-presenter-catalog.ts');
  const presenterCatalog = await readFile(presenterCatalogPath, 'utf8');
  const catalogPresenterPairs = [...presenterCatalog.matchAll(
    /\bpresenter:\s*'([^']+)'[\s\S]*?\bclassSlug:\s*'([^']+)'/g,
  )].map((match) => `${match[2]}/${match[1]}`);
  const expectedPresenterPairs = Object.entries(uiPresenterClassPolicy).flatMap(
    ([classSlug, presenters]) => presenters.map((presenter) => `${classSlug}/${presenter}`),
  );
  if (catalogPresenterPairs.length !== expectedPresenterPairs.length) {
    errors.push(`UI presenter catalog must enumerate exactly ${expectedPresenterPairs.length} classified presenters; found ${catalogPresenterPairs.length}.`);
  }
  compareExactSet(
    'UI presenter catalog',
    'functional classification',
    catalogPresenterPairs,
    expectedPresenterPairs,
  );

  const uikitDocsRoot = path.join(root, 'apps/doc/webmusic/src/content/docs/uikit');
  const docsAstroConfig = await readFile(
    path.join(root, 'apps/doc/webmusic/astro.config.mjs'),
    'utf8',
  );
  const uiKitNavigationStart = docsAstroConfig.indexOf("label: 'UI Kit'");
  const uiKitNavigationEnd = docsAstroConfig.indexOf("label: 'Kernel'", uiKitNavigationStart);
  const uiKitNavigation = docsAstroConfig.slice(uiKitNavigationStart, uiKitNavigationEnd);
  // DOCS-SITE-PLAN.md §"UI Kit": Overview at /uikit/, Catalog at
  // /uikit/catalog/, the six presenter classes, then the root API page
  // labelled by its entry. This assertion used to forbid the Overview item,
  // from when /uikit/ was the catalog and the overview lived at /ui/.
  if (uiKitNavigationStart < 0) {
    errors.push('UI Kit navigation group is missing from the docs sidebar.');
  } else {
    for (const [label, link] of [
      ['Overview', "link: '/uikit/'"],
      ['Catalog', "link: '/uikit/catalog/'"],
      ['@webmusic/ui', "link: '/uikit/api/'"],
    ]) {
      if (!uiKitNavigation.includes(`label: '${label}'`) || !uiKitNavigation.includes(link)) {
        errors.push(`UI Kit navigation must carry a '${label}' item linking ${link.slice(7, -1)}.`);
      }
    }
    if (uiKitNavigation.includes("'/ui/")) {
      errors.push("UI Kit navigation still points at the retired /ui/ prefix.");
    }
  }

  const liveDemoDirectory = path.join(
    root,
    'apps/doc/webmusic/src/lib/ui-presenter-demos',
  );
  const liveDemoSources = await Promise.all(
    ['transport-time.ts', 'parameters-gestures.ts', 'mixing-notes.ts', 'views-analysis.ts'].map(
      (file) => readFile(path.join(liveDemoDirectory, file), 'utf8'),
    ),
  );
  const liveDemoPresenters = liveDemoSources.flatMap((source) => [
    ...source.matchAll(/(?:presenter\s*===\s*|case\s+)['"]([^'"]+)['"]/g),
  ]).map((match) => match[1]);
  compareExactSet(
    'UI presenter live displays',
    'published presenter subpath',
    liveDemoPresenters,
    publishedUiSubpaths,
  );

  const expectedUikitPages = [];
  for (const [classSlug, presenters] of Object.entries(uiPresenterClassPolicy)) {
    if (existsSync(path.join(uikitDocsRoot, classSlug, 'index.mdx'))) {
      errors.push(`UI Kit class ${classSlug} must expand directly to presenter pages without an Overview page.`);
    }
    for (const presenter of presenters) {
      const relativePage = `${classSlug}/${presenter}.mdx`;
      expectedUikitPages.push(relativePage);
      const pagePath = path.join(uikitDocsRoot, relativePage);
      if (!existsSync(pagePath)) {
        errors.push(`@webmusic/ui/${presenter} is missing its classified UI Kit page: apps/doc/webmusic/src/content/docs/uikit/${relativePage}.`);
        continue;
      }
      const page = await readFile(pagePath, 'utf8');
      if (!page.includes(`title: '@webmusic/ui/${presenter}'`)) {
        errors.push(`UI Kit page ${relativePage} must title itself @webmusic/ui/${presenter}.`);
      }
      // Every page authors its own sections; the generated <UiPresenterPage>
      // form and its component are gone.
      const authoredPage =
        page.includes(`<UiPresenterLiveDemo presenter="${presenter}" />`) &&
        page.includes(`<UiPresenterRelated presenter="${presenter}" />`);
      if (!authoredPage) {
        errors.push(`UI Kit page ${relativePage} must render the LiveDemo + Related page skeleton for @webmusic/ui/${presenter}.`);
      }
      if (authoredPage) {
        const liveDemo = `<UiPresenterLiveDemo presenter="${presenter}" />`;
        const related = `<UiPresenterRelated presenter="${presenter}" />`;
        const liveDemoCount = page.split(liveDemo).length - 1;
        const relatedCount = page.split(related).length - 1;
        if (liveDemoCount !== 1 || relatedCount !== 1) {
          errors.push(`Aligned UI Kit page ${relativePage} must render exactly one LiveDemo and one Related block.`);
        }
        const orderedSections = [
          page.indexOf(liveDemo),
          page.indexOf('## Import'),
          page.indexOf('<summary>API</summary>'),
          page.indexOf('<summary>Styling</summary>'),
          page.indexOf(related),
        ];
        if (
          orderedSections.some((index) => index < 0) ||
          orderedSections.some((index, position) =>
            position > 0 ? index <= orderedSections[position - 1] : false,
          )
        ) {
          errors.push(`Aligned UI Kit page ${relativePage} must order LiveDemo, Import, API, Styling, and Related according to the UI Kit page contract.`);
        }
        if (!page.trimEnd().endsWith(related)) {
          errors.push(`Aligned UI Kit page ${relativePage} must end with its generated Related block.`);
        }
      }
    }
  }

  const actualUikitClasses = [];
  const actualUikitPages = [];
  for (const classDirectory of await readdir(uikitDocsRoot, {withFileTypes: true})) {
    if (!classDirectory.isDirectory()) continue;
    const classPath = path.join(uikitDocsRoot, classDirectory.name);
    const pages = await readdir(classPath, {withFileTypes: true});
    const mdxPages = pages.filter((page) => page.isFile() && page.name.endsWith('.mdx'));
    if (mdxPages.length === 0) continue;
    actualUikitClasses.push(classDirectory.name);
    for (const page of mdxPages) {
      if (page.name !== 'index.mdx') {
        actualUikitPages.push(`${classDirectory.name}/${page.name}`);
      }
    }
  }
  compareExactSet(
    'Classified UI Kit docs',
    'functional class',
    actualUikitClasses,
    Object.keys(uiPresenterClassPolicy),
  );
  compareExactSet('Classified UI Kit docs', 'presenter page', actualUikitPages, expectedUikitPages);
}

function checkWorkspaceCycles() {
  const graph = new Map();
  for (const [name, pkg] of packages) {
    const dependencies = new Set([
      ...Object.keys(pkg.manifest.dependencies ?? {}),
      ...Object.keys(pkg.manifest.peerDependencies ?? {}),
    ].filter((dependency) => packages.has(dependency)));
    graph.set(name, dependencies);
  }
  const visited = new Set();
  const active = [];
  const visit = (name) => {
    if (active.includes(name)) {
      errors.push(`Workspace dependency cycle: ${[...active.slice(active.indexOf(name)), name].join(' -> ')}.`);
      return;
    }
    if (visited.has(name)) return;
    active.push(name);
    for (const dependency of graph.get(name)) visit(dependency);
    active.pop();
    visited.add(name);
  };
  for (const name of graph.keys()) visit(name);
}

function resolveLocal(importer, specifier) {
  const raw = path.resolve(path.dirname(importer), specifier.split('?')[0]);
  const withoutJs = raw.replace(/\.(?:m?js|cjs)$/, '');
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    path.join(raw, 'index.ts'),
    path.join(raw, 'index.tsx'),
  ];
  return candidates.find((candidate) => allSourceFiles.has(candidate));
}

function packageName(specifier) {
  if (!specifier.startsWith('@')) return specifier.split('/')[0];
  return specifier.split('/').slice(0, 2).join('/');
}

function relativeToRoot(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}
