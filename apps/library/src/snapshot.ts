// Turn a drawn element into a still picture: a self-contained SVG whose
// foreignObject holds a copy of the element's composed tree (shadow roots
// flattened, slots resolved) with every node's computed style written inline,
// canvases as images, pseudo-elements as spans and scroll offsets kept. The
// picture needs no stylesheet, script or custom element definition, so the
// home page shows it as a plain image: nothing loads, plays or upgrades.

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Properties a child takes from its parent unless it sets its own. */
const INHERITED = new Set([
  'color', 'color-scheme', 'cursor', 'direction', 'font-family', 'font-feature-settings', 'font-kerning', 'font-optical-sizing',
  'font-size', 'font-stretch', 'font-style', 'font-variant', 'font-variant-caps', 'font-variant-ligatures',
  'font-variant-numeric', 'font-variation-settings', 'font-weight', 'hyphens', 'letter-spacing', 'line-break', 'line-height',
  'list-style-image', 'list-style-position', 'list-style-type', 'orphans', 'overflow-wrap', 'paint-order', 'quotes',
  'tab-size', 'text-align', 'text-align-last', 'text-anchor', 'text-indent', 'text-rendering', 'text-shadow',
  'text-transform', 'visibility', 'white-space', 'white-space-collapse', 'text-wrap', 'text-wrap-mode', 'widows',
  'word-break', 'word-spacing', 'writing-mode', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
  'dominant-baseline', 'clip-rule', 'marker', 'marker-start', 'marker-mid', 'marker-end', '-webkit-font-smoothing',
  '-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke-width', 'pointer-events',
]);

/** Behaviour, not appearance: left out of the picture. */
const SKIPPED = /^(transition|animation|will-change|cursor|pointer-events|user-select|-webkit-user|touch-action|caret-color|scroll-|overscroll|content-visibility|contain-intrinsic|view-transition|anchor|position-try)/;

/** Elements whose content is not part of the look. */
const DROPPED = new Set(['script', 'style', 'template', 'link', 'meta', 'noscript', 'title']);

/** UA default styles per element kind, so only what differs is written. */
export type DefaultStyles = (namespace: string, localName: string) => CSSStyleDeclaration | undefined;

export interface Picture {
  /** A standalone SVG document. */
  readonly svg: string;
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/** A default-style source backed by a blank document the caller owns. */
export function defaultStylesFrom(blank: Document): DefaultStyles {
  const cache = new Map<string, CSSStyleDeclaration>();
  const host = blank.body ?? blank.documentElement;
  const svgRoot = blank.createElementNS(SVG_NS, 'svg');
  host.append(svgRoot);
  return (namespace, localName) => {
    const key = `${namespace}|${localName}`;
    let style = cache.get(key);
    if (!style) {
      const element = blank.createElementNS(namespace, localName);
      (namespace === SVG_NS ? svgRoot : host).append(element);
      // Copy the values: a live declaration would change as more elements are added.
      const view = blank.defaultView!;
      const live = view.getComputedStyle(element);
      const frozen = blank.createElement('div').style;
      for (let index = 0; index < live.length; index += 1) {
        const name = live.item(index);
        frozen.setProperty(name, live.getPropertyValue(name));
      }
      style = frozen;
      cache.set(key, style);
    }
    return style;
  };
}

/** The style text an element needs: what differs from its default and from what it inherits. */
export function styleText(computed: CSSStyleDeclaration, parent: CSSStyleDeclaration | undefined, defaults: CSSStyleDeclaration | undefined): string {
  const parts: string[] = [];
  for (let index = 0; index < computed.length; index += 1) {
    const name = computed.item(index);
    if (SKIPPED.test(name) || name.startsWith('--')) continue;
    const value = computed.getPropertyValue(name);
    if (!value) continue;
    if (INHERITED.has(name) && parent) {
      if (parent.getPropertyValue(name) === value) continue;
    } else if (defaults && defaults.getPropertyValue(name) === value) {
      continue;
    }
    parts.push(`${name}:${value}`);
  }
  return parts.join(';');
}

/** Children in the composed tree: a shadow root's content with its slots filled. */
function composedChildren(node: Element): Node[] {
  const root = (node as Element & {shadowRoot: ShadowRoot | null}).shadowRoot;
  const children = [...(root ?? node).childNodes];
  return children.flatMap((child) => {
    if (child instanceof child.ownerDocument!.defaultView!.HTMLSlotElement) {
      const assigned = (child as HTMLSlotElement).assignedNodes({flatten: true});
      return assigned.length ? assigned : [...child.childNodes];
    }
    return [child];
  });
}

interface Context {
  readonly view: Window;
  readonly out: Document;
  readonly defaults: DefaultStyles;
  /** Rules a picture carries for pseudo-elements inline styles cannot reach (range thumbs and tracks). */
  readonly rules: string[];
}

const RANGE_PSEUDO = /^(.*?)(::-(?:webkit-slider-[a-z-]+|moz-range-[a-z-]+))\s*$/;

/** Every style rule in the sheets of the element's own tree (its shadow root or document). */
function rulesAround(element: Element): CSSStyleRule[] {
  const root = element.getRootNode() as Document | ShadowRoot;
  const sheets = [...root.styleSheets, ...(root.adoptedStyleSheets ?? [])];
  const out: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList) => {
    for (const rule of [...list]) {
      if ('selectorText' in rule) out.push(rule as CSSStyleRule);
      else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of sheets) {
    try { walk(sheet.cssRules); } catch { /* A sheet that cannot be read is skipped. */ }
  }
  return out;
}

/** Copy the range pseudo-element rules that apply to `input` onto its copy, under a class of its own. */
function carryRangeRules(context: Context, input: Element, copy: Element, computed: CSSStyleDeclaration): void {
  const name = `snap-range-${context.rules.length}`;
  let carried = false;
  for (const rule of rulesAround(input)) {
    for (const selector of rule.selectorText.split(',')) {
      const match = RANGE_PSEUDO.exec(selector.trim());
      if (!match) continue;
      let applies = false;
      try { applies = input.matches(match[1]!.trim() || '*'); } catch { /* Not a selector this element can test. */ }
      if (!applies) continue;
      context.rules.push(`.${name}${match[2]}{${rule.style.cssText}}`);
      carried = true;
    }
  }
  if (!carried) return;
  copy.setAttribute('class', `${copy.getAttribute('class') ?? ''} ${name}`.trim());
  // The carried rules read custom properties; give the copy their values.
  const custom: string[] = [];
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    if (property.startsWith('--')) custom.push(`${property}:${computed.getPropertyValue(property)}`);
  }
  if (custom.length) copy.setAttribute('style', `${copy.getAttribute('style') ?? ''};${custom.join(';')}`);
}

function pseudo(context: Context, element: Element, which: '::before' | '::after', parent: CSSStyleDeclaration): Element | undefined {
  const style = context.view.getComputedStyle(element, which);
  const content = style.getPropertyValue('content');
  if (!content || content === 'none' || content === 'normal') return undefined;
  const span = context.out.createElementNS(HTML_NS, 'span');
  const text = /^["'](.*)["']$/.exec(content)?.[1] ?? '';
  if (text) span.textContent = text;
  span.setAttribute('style', styleText(style, parent, context.defaults(HTML_NS, 'span')));
  return span;
}

function copyNode(context: Context, node: Node, parent: CSSStyleDeclaration | undefined): Node | undefined {
  const {view, out} = context;
  if (node.nodeType === Node.TEXT_NODE) return out.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  const element = node as Element;
  const name = element.localName;
  if (DROPPED.has(name)) return undefined;
  const namespace = element.namespaceURI ?? HTML_NS;
  const computed = view.getComputedStyle(element);
  if (computed.display === 'none') return undefined;

  if (name === 'canvas') {
    const image = out.createElementNS(HTML_NS, 'img');
    let source = '';
    try { source = (element as HTMLCanvasElement).toDataURL('image/png'); } catch { /* A canvas that cannot export stays blank. */ }
    if (source && source !== 'data:,') image.setAttribute('src', source);
    image.setAttribute('style', styleText(computed, parent, context.defaults(HTML_NS, 'canvas')));
    return image;
  }

  // Unknown custom elements keep their name: in the picture they are plain elements.
  const copy = out.createElementNS(namespace, name);
  for (const attribute of [...element.attributes]) {
    if (attribute.name === 'style' || attribute.name.startsWith('on')) continue;
    try { copy.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value); } catch { /* Skip a name XML cannot hold. */ }
  }
  if (name === 'input' || name === 'textarea') copy.setAttribute('value', (element as HTMLInputElement).value);
  copy.setAttribute('style', styleText(computed, parent, context.defaults(namespace, name)));
  if (name === 'input' && (element as HTMLInputElement).type === 'range') carryRangeRules(context, element, copy, computed);

  const before = namespace === HTML_NS ? pseudo(context, element, '::before', computed) : undefined;
  if (before) copy.append(before);
  // A scrolled box shows where it was scrolled to; sticky children stay on the axis they stick to.
  const scrollX = element.scrollLeft;
  const scrollY = element.scrollTop;
  for (const child of composedChildren(element)) {
    const copied = copyNode(context, child, computed);
    if (!copied) continue;
    if ((scrollX || scrollY) && copied.nodeType === Node.ELEMENT_NODE && child.nodeType === Node.ELEMENT_NODE) {
      const childStyle = view.getComputedStyle(child as Element);
      const sticky = childStyle.position === 'sticky';
      const x = sticky && childStyle.left !== 'auto' ? 0 : scrollX;
      const y = sticky && childStyle.top !== 'auto' ? 0 : scrollY;
      if (x || y) {
        const target = copied as Element;
        target.setAttribute('style', `${target.getAttribute('style') ?? ''};translate:${-x}px ${-y}px`);
      }
    }
    copy.append(copied);
  }
  const after = namespace === HTML_NS ? pseudo(context, element, '::after', computed) : undefined;
  if (after) copy.append(after);
  return copy;
}

/**
 * The picture of `target` as it is drawn now. `defaults` gives each element
 * kind's unstyled values; `parent` styles are taken from the target's parent.
 */
export function snapshot(target: Element, defaults: DefaultStyles): Picture {
  const view = target.ownerDocument.defaultView!;
  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const out = target.ownerDocument.implementation.createDocument(SVG_NS, 'svg', null);
  const svg = out.documentElement;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const object = out.createElementNS(SVG_NS, 'foreignObject');
  object.setAttribute('x', '0');
  object.setAttribute('y', '0');
  object.setAttribute('width', String(width));
  object.setAttribute('height', String(height));
  const body = out.createElementNS(HTML_NS, 'div');
  const parent = target.parentElement ? view.getComputedStyle(target.parentElement) : undefined;
  // Everything the target inherits, written once on the wrapper.
  const inherited = parent ? [...INHERITED].map((name) => [name, parent.getPropertyValue(name)] as const)
    .filter(([name, value]) => value && !SKIPPED.test(name)).map(([name, value]) => `${name}:${value}`) : [];
  body.setAttribute('style', [...inherited, 'margin:0', 'color-scheme:light', `width:${width}px`, `height:${height}px`, 'overflow:hidden'].join(';'));
  const context: Context = {view, out, defaults, rules: []};
  const copy = copyNode(context, target, parent);
  if (context.rules.length) {
    const style = out.createElementNS(HTML_NS, 'style');
    style.textContent = context.rules.join('\n');
    body.append(style);
  }
  if (copy && copy.nodeType === Node.ELEMENT_NODE) {
    const element = copy as Element;
    // The picture starts at the element's own edge.
    element.setAttribute('style', `${element.getAttribute('style') ?? ''};margin:0;position:relative;left:0;top:0;translate:none`);
    body.append(element);
  }
  object.append(body);
  svg.append(object);
  return {svg: new view.XMLSerializer().serializeToString(out), width, height};
}
