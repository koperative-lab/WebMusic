/** Canvas does not resolve CSS variables; read the DOM's resolved text ink. */
export function canvasInk(element: Element, fallback: string): string {
  const color = element.ownerDocument.defaultView?.getComputedStyle(element).color;
  // Non-browser DOMs can return unresolved custom-property expressions.
  return color && !/\b(?:var|light-dark)\(/.test(color) ? color : fallback;
}
