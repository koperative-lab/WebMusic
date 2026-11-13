/**
 * Code blocks in the visual design: a monochrome Shiki theme (ink text, muted
 * comments and punctuation, weight for keywords; colour stays reserved for
 * meaning) and a frame with a one-height header naming the language and a
 * copy icon. The site client copies on click; the search index drops buttons.
 */

const INK = '#111111';
const SOFT = '#4a4a4a';
const MUTED = '#777777';

/** @type {import('shiki').ThemeRegistration} */
export const monochromeTheme = {
  name: 'webmusic-monochrome',
  type: 'light',
  colors: {'editor.background': '#ffffff', 'editor.foreground': INK},
  tokenColors: [
    {settings: {foreground: INK}},
    {scope: ['comment', 'punctuation.definition.comment'], settings: {foreground: MUTED, fontStyle: 'italic'}},
    {scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'], settings: {foreground: SOFT}},
    {scope: ['punctuation', 'meta.brace', 'punctuation.definition.tag'], settings: {foreground: MUTED}},
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'entity.name.tag', 'markup.heading', 'keyword.operator.new'],
      settings: {foreground: INK, fontStyle: 'bold'},
    },
    {scope: ['keyword.operator'], settings: {foreground: SOFT, fontStyle: ''}},
    {scope: ['constant.numeric', 'constant.language', 'support.constant'], settings: {foreground: SOFT}},
    {scope: ['entity.other.attribute-name', 'support.type.property-name', 'meta.object-literal.key'], settings: {foreground: SOFT}},
  ],
};

const LABELS = {ts: 'TS', tsx: 'TSX', js: 'JS', html: 'HTML', css: 'CSS', json: 'JSON', bash: 'Shell', sh: 'Shell', txt: 'Text', text: 'Text', markdown: 'Markdown'};

const element = (tagName, properties, children = []) => ({type: 'element', tagName, properties, children});
const copyIcon = () => element('svg', {
  className: ['doc-svg'], ariaHidden: 'true', width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'square', strokeLinejoin: 'miter',
}, [element('path', {d: 'M8 8h12v12H8zM4 16V4h12'})]);

/** Wrap every highlighted block in its frame. */
export const codeFrame = {
  name: 'webmusic-code-frame',
  root(root) {
    const lang = this.options.lang ?? 'text';
    const label = LABELS[lang] ?? lang.toUpperCase();
    return {
      type: 'root',
      children: [element('div', {className: ['doc-code', 'not-content'], dataLanguage: lang}, [
        element('div', {className: ['doc-code__head']}, [
          element('span', {className: ['doc-caption']}, [{type: 'text', value: label}]),
          element('button', {type: 'button', className: ['doc-icon'], dataCodeCopy: '', ariaLabel: 'Copy code', title: 'Copy code'}, [copyIcon()]),
        ]),
        ...root.children,
      ])],
    };
  },
};
