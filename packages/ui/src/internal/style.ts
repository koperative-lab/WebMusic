/**
 * One way to create a presenter's stylesheet node.
 *
 * Nineteen mounts built this node by hand and only eleven of them tagged it
 * `data-webmusic-ui`, so the marker that identifies kit-owned style — the one a
 * host page or a test uses to tell the kit's CSS from its own — was a coin
 * flip. This does exactly what those nineteen did, in one place, and always
 * stamps the marker.
 *
 * Deliberately unopinionated about placement: the node is returned, and the
 * caller appends it to its own host exactly as before. Moving light-DOM sheets
 * to `document.head` or de-duplicating them per document would change cascade
 * order and break mounts into a detached host, and no caller asked for it.
 */

/**
 * Build the stylesheet node for a presenter, or nothing when the caller opted
 * out with `stylesheet: false`.
 *
 * ```ts
 * const style = installStyle(document, 'stage', stageStyle, options.stylesheet);
 * if (style) host.append(style, root);
 * else host.append(root);
 * ```
 */
export function installStyle(document: Document, id: string, css: string): HTMLStyleElement;
export function installStyle(
  document: Document,
  id: string,
  css: string,
  enabled: boolean | undefined,
): HTMLStyleElement | undefined;
export function installStyle(
  document: Document,
  id: string,
  css: string,
  enabled?: boolean,
): HTMLStyleElement | undefined {
  if (enabled === false) return undefined;
  const style = document.createElement('style');
  style.dataset.webmusicUi = id;
  style.textContent = css;
  return style;
}

/**
 * Write a rule's declarations straight onto a node.
 *
 * The other half of {@link installStyle}: a host that opts out of the
 * stylesheet still needs the box, and this paints it from the very same
 * records the sheet is generated from, so the two cannot drift. Custom
 * properties go through the same call — `setProperty` takes both.
 */
export function paint(
  node: {style: CSSStyleDeclaration},
  ...groups: ReadonlyArray<Readonly<Record<string, string>>>
): void {
  for (const group of groups) {
    for (const [property, value] of Object.entries(group)) {
      node.style.setProperty(property, value);
    }
  }
}
