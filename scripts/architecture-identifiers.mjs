import ts from 'typescript';

/** Exclude declaration names and property labels while retaining computed references. */
export function isIdentifierReference(node) {
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

/** Type-only members do not access browser globals; executable initializers still do. */
export function isRuntimeIdentifierReference(node) {
  if (!isIdentifierReference(node)) return false;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isInterfaceDeclaration(current)) return false;
    if (ts.isExpressionStatement(current) || ts.isStatement(current) || ts.isSourceFile(current)) break;
  }
  return true;
}
