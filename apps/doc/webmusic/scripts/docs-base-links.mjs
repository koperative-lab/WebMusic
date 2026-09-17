import {defineMdastPlugin} from 'satteri';

const urlAttributes = new Set(['href', 'src', 'action', 'poster']);

/** Prefix authored site paths once, preserving external/relative URLs and fragments. */
export function withDocsBase(url, base = '/') {
  const prefix = base.replace(/\/+$/, '');
  if (prefix && (!prefix.startsWith('/') || prefix.startsWith('//') || /[?#\\]/.test(prefix)
    || prefix.split('/').some((part) => part === '.' || part === '..'))) {
    throw new Error(`Documentation base must be a root-relative path: ${base}`);
  }
  if (!prefix || !url.startsWith('/') || url.startsWith('//')) return url;
  const pathname = url.split(/[?#]/, 1)[0];
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return url;
  return `${prefix}${url}`;
}

/**
 * Transform actual Markdown nodes before both development and build rendering.
 * Code nodes, ESM, expressions and custom-component properties are untouched.
 */
export function docsBaseLinks(base = '/') {
  withDocsBase('/', base); // Validate configuration even for an empty document.
  const rewriteUrl = (node, context) => {
    const url = withDocsBase(node.url, base);
    if (url !== node.url) context.setProperty(node, 'url', url);
  };
  const rewriteElement = (node, context) => {
    if (!node.name || !/^[a-z]/.test(node.name)) return;
    let changed = false;
    const attributes = node.attributes.map((attribute) => {
      if (attribute.type !== 'mdxJsxAttribute' || !urlAttributes.has(attribute.name) || typeof attribute.value !== 'string') return attribute;
      const value = withDocsBase(attribute.value, base);
      if (value === attribute.value) return attribute;
      changed = true;
      return {...attribute, value};
    });
    if (changed) context.replaceNode(node, {...node, attributes});
  };
  return defineMdastPlugin({
    name: 'webmusic-docs-base-links',
    link: rewriteUrl,
    image: rewriteUrl,
    definition: rewriteUrl,
    mdxJsxFlowElement: rewriteElement,
    mdxJsxTextElement: rewriteElement,
  });
}

/** Extend Astro's configured native processor, retaining Starlight's plugins. */
export function docsBaseLinksIntegration() {
  return {
    name: 'webmusic-docs-base-links',
    hooks: {
      'astro:config:setup': ({config}) => {
        const processor = config.markdown.processor;
        if (processor?.name !== 'satteri' || !Array.isArray(processor.options?.mdastPlugins)) {
          throw new Error('WebMusic documentation base links require the configured Satteri Markdown processor.');
        }
        processor.options.mdastPlugins.push(docsBaseLinks(config.base));
      },
    },
  };
}
