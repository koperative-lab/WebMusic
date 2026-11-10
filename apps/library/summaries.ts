// Build-time summaries for the library cards. Each element's one-line purpose
// is read from its owning documentation page, the same way dev/COMPONENTS.md
// is generated (scripts/docs-catalog.mjs): the first sentence under the
// element's own heading, else the page description. Nothing here is a second
// hand-written inventory; only the extracted sentence reaches the bundle.
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

export interface SummarySource {
  readonly tag: string;
  /** Documentation route, such as `/score/element/play/score-player/`. */
  readonly href: string;
}

const DOCS = 'apps/doc/webmusic/src/content/docs';

/** Markdown and MDX syntax a card shows as plain text. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, (tag) => /^<[a-z]+-[a-z-]+>$/.test(tag) ? tag : '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, (_match, strong: string | undefined, em: string | undefined) => strong ?? em ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function frontmatter(source: string, key: string): string {
  const block = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  const raw = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block)?.[1] ?? '';
  return raw.replace(/^(['"])([\s\S]*)\1$/, '$2');
}

/** The first sentence that describes `tag` on its page. */
export function summaryFromPage(source: string, tag: string): string {
  const lines = source.split('\n');
  const heading = lines.findIndex((line) => /^##\s/.test(line) && line.includes(`<${tag}>`));
  if (heading >= 0) {
    const paragraph = lines.slice(heading + 1).join('\n').trimStart().split(/\n\s*\n/)[0];
    if (paragraph && !/^[<`|:-]/.test(paragraph)) return plainText(paragraph.split(/(?<=\.)\s+/)[0]!);
  }
  return plainText(frontmatter(source, 'description'));
}

export function pageFile(root: string, href: string): string {
  const base = path.join(root, DOCS, href.split('#')[0]!.replace(/^\/|\/$/g, ''));
  const file = [`${base}.mdx`, path.join(base, 'index.mdx')].find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`No documentation page for ${href}`);
  return file;
}

export function readSummaries(root: string, entries: readonly SummarySource[]): Record<string, string> {
  const summaries: Record<string, string> = {};
  for (const entry of entries) {
    const summary = summaryFromPage(readFileSync(pageFile(root, entry.href), 'utf8'), entry.tag);
    if (!summary) throw new Error(`No summary sentence for <${entry.tag}> on ${entry.href}`);
    summaries[entry.tag] = summary;
  }
  return summaries;
}
