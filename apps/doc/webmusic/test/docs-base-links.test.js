import {describe, expect, it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {markdownToHtml, mdxToJs} from 'satteri';
import {docsBaseLinks, docsBaseLinksIntegration, withDocsBase} from '../scripts/docs-base-links.mjs';

describe('documentation base links', () => {
  it('prefixes root paths once with query strings and fragments intact', () => {
    for (const [source, expected] of [
      ['/llms.txt', '/WebMusic/llms.txt'],
      ['/agent-context/manifest.json?download=1#schema', '/WebMusic/agent-context/manifest.json?download=1#schema'],
      ['/', '/WebMusic/'],
      ['/WebMusic', '/WebMusic'],
      ['/WebMusic?query=1', '/WebMusic?query=1'],
      ['/WebMusic/#top', '/WebMusic/#top'],
      ['/WebMusicElsewhere/', '/WebMusic/WebMusicElsewhere/'],
      ['https://example.test/llms.txt', 'https://example.test/llms.txt'],
      ['//example.test/llms.txt', '//example.test/llms.txt'],
      ['../reference/', '../reference/'],
      ['#example', '#example'],
      ['mailto:maintainer@example.test', 'mailto:maintainer@example.test'],
    ]) {
      expect(withDocsBase(source, '/WebMusic/')).toBe(expected);
      expect(withDocsBase(expected, '/WebMusic')).toBe(expected);
      expect(withDocsBase(source, '/')).toBe(source);
    }
  });

  it('renders authored Markdown links, definitions and images for development and production', () => {
    const source = '[Index](/llms.txt)\n\n[Manifest][manifest]\n\n[manifest]: /agent-context/manifest.json\n\n![Demo](/demo.png)';
    const result = markdownToHtml(source, {mdastPlugins: [docsBaseLinks('/WebMusic/')]});
    expect(result.html).toContain('href="/WebMusic/llms.txt"');
    expect(result.html).toContain('href="/WebMusic/agent-context/manifest.json"');
    expect(result.html).toContain('src="/WebMusic/demo.png"');
    const root = markdownToHtml(source, {mdastPlugins: [docsBaseLinks('/')]});
    expect(root.html).toContain('href="/llms.txt"');
  });

  it('rewrites literal native MDX anchors while preserving code and custom component props', () => {
    const source = '<a href="/llms.txt">Index</a>\n\n<Demo href="/custom-component-input" />\n\n```html\n<a href="/application-route">Example</a>\n```\n\n`[sample](/code-route)`';
    const result = mdxToJs(source, {mdastPlugins: [docsBaseLinks('/WebMusic/')]});
    expect(result.code).toContain('/WebMusic/llms.txt');
    expect(result.code).toContain('/custom-component-input');
    expect(result.code).not.toContain('/WebMusic/custom-component-input');
    expect(result.code).toContain('/application-route');
    expect(result.code).not.toContain('/WebMusic/application-route');
    expect(result.code).not.toContain('/WebMusic/code-route');
  });

  it('renders the actual llms.txt documentation download link with the deployment base', async () => {
    const source = await readFile(new URL('../src/content/docs/agent-toolkit/llms-txt.mdx', import.meta.url), 'utf8');
    const result = mdxToJs(source, {mdastPlugins: [docsBaseLinks('/WebMusic/')]});
    expect(result.code).toContain('/WebMusic/llms.txt');
    expect(result.code).toContain('/WebMusic/llms-full.txt');
    expect(result.code).toContain('/WebMusic/llms-components.txt');
    expect(result.code).toContain('/WebMusic/llms-patterns.txt');
    expect(result.code).toContain('/WebMusic/agent-context/manifest.json');
    expect(result.code).not.toContain('/WebMusic/WebMusic/');
  });

  it('extends the configured processor without removing existing plugins', () => {
    const existing = {name: 'existing-plugin'};
    const processor = {name: 'satteri', options: {mdastPlugins: [existing]}};
    docsBaseLinksIntegration().hooks['astro:config:setup']({config: {base: '/WebMusic/', markdown: {processor}}});
    expect(processor.options.mdastPlugins).toHaveLength(2);
    expect(processor.options.mdastPlugins[0]).toBe(existing);
    expect(processor.options.mdastPlugins[1].name).toBe('webmusic-docs-base-links');
    expect(() => docsBaseLinksIntegration().hooks['astro:config:setup']({config: {markdown: {processor: {name: 'other'}}}})).toThrow(/Satteri/);
  });

  it.each(['https://example.test/', '//example.test/', '/foo/../bar', '/base?x', '/base#x'])('rejects an invalid base %s', (base) => {
    expect(() => docsBaseLinks(base)).toThrow(/root-relative path/);
  });
});
