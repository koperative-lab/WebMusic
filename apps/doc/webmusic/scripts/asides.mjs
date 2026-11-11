import {defineMdastPlugin} from 'satteri';

/**
 * `:::note` and `:::caution` blocks, optionally titled (`:::note[Title]`),
 * become `<aside class="doc-aside">` with a caption. Any other container
 * directive is an authoring error rather than silently dropped text.
 *
 * Directives are parsed for these blocks only. A `:name` inside prose
 * (`C:major`, `1:2`) is ordinary text, so it is written back as authored.
 */
const KINDS = {note: 'Note', caution: 'Caution'};

const plain = (nodes) => nodes.map((node) => node.value ?? plain(node.children ?? [])).join('');

export const asides = defineMdastPlugin({
  name: 'webmusic-asides',
  containerDirective(node, context) {
    const label = KINDS[node.name];
    if (!label) throw new Error(`Unsupported directive :::${node.name}; use :::note or :::caution.`);
    const titled = node.children[0]?.data?.directiveLabel === true;
    const title = titled ? node.children[0].children : [{type: 'text', value: label}];
    context.replaceNode(node, {
      ...node,
      data: {hName: 'aside', hProperties: {className: ['doc-aside'], dataKind: node.name}},
      children: [
        {type: 'paragraph', data: {hName: 'p', hProperties: {className: ['doc-aside__title', 'doc-caption']}}, children: title},
        ...node.children.slice(titled ? 1 : 0),
      ],
    });
  },
  leafDirective(node, context) {
    context.replaceNode(node, {type: 'paragraph', children: [{type: 'text', value: `::${node.name}${node.children.length ? `[${plain(node.children)}]` : ''}`}]});
  },
  textDirective(node, context) {
    context.replaceNode(node, {type: 'text', value: `:${node.name}${node.children.length ? `[${plain(node.children)}]` : ''}`});
  },
});
