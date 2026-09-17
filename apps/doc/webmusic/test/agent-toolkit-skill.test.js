import {cp, mkdtemp, readFile, readdir, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {load} from 'js-yaml';
import {markdownToMdast} from 'satteri';
import {expect, it} from 'vitest';

const skillSource = fileURLToPath(new URL('../../../../skills/webmusic/', import.meta.url));

function links(node) {
  return [
    ...(['link', 'image', 'definition'].includes(node.type) ? [node.url] : []),
    ...(node.children ?? []).flatMap(links),
  ];
}

it('can install the complete consumer skill without references back to the source checkout', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'webmusic-skill-'));
  try {
    const installed = path.join(temporary, 'webmusic');
    await cp(skillSource, installed, {recursive: true});
    const entry = await readFile(path.join(installed, 'SKILL.md'), 'utf8');
    const metadata = load(/^---\n([\s\S]*?)\n---/.exec(entry)?.[1] ?? '');
    expect(metadata?.name).toBe('webmusic');
    expect(metadata?.description?.length).toBeGreaterThan(0);
    const files = await readdir(installed, {recursive: true});
    const root = await realpath(installed);
    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const filename = path.join(installed, file);
      const tree = markdownToMdast(await readFile(filename, 'utf8'));
      for (const href of links(tree)) {
        if (/^(?:https?:|mailto:|#)/.test(href)) continue;
        const target = await realpath(path.resolve(path.dirname(filename), decodeURI(href.split(/[?#]/)[0])));
        const relative = path.relative(root, target);
        expect(relative, `${file}: ${href} escapes the installed skill`).not.toMatch(/^\.\.(?:\/|$)|^\//);
        expect((await stat(target)).isFile(), `${file}: ${href} is not a bundled file`).toBe(true);
      }
    }
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});
