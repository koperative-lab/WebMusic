import {describe, expect, it} from 'vitest';
import {UI_PRESENTER_CLASSES} from '../../shared/ui-presenter-catalog';
import {docId, holds, links, navigationSections, navigationTree, pager, sectionFor, type NavGroup, type NavPage} from '../src/site/navigation';

const page = (id: string, title: string, sidebar: NavPage['sidebar'] = {}): NavPage => ({id, title, sidebar});

/** One page per listed directory, so every directory group resolves. */
function fixture(extra: NavPage[] = []): NavPage[] {
  const directories = [
    ...['score', 'audio'].flatMap((family) => ['element', 'headless'].flatMap((form) =>
      ['play', 'analyze', 'view'].map((capability) => `${family}/${form}/${capability}`))),
    'bridge/headless',
    ...UI_PRESENTER_CLASSES.map((entry) => `uikit/${entry.slug}`),
  ];
  return [...directories.map((directory) => page(`${directory}/only`, `${directory} only`)), ...extra];
}

describe('documentation navigation', () => {
  it('derives page ids from content paths', () => {
    expect(docId('index.mdx')).toBe('index');
    expect(docId('score/index.mdx')).toBe('score');
    expect(docId('score/element/play/score-player.mdx')).toBe('score/element/play/score-player');
  });

  it('lists a directory by order, then title, without hidden pages', () => {
    const tree = navigationTree(fixture([
      page('score/element/play/b', 'B', {order: 2}),
      page('score/element/play/a', 'A', {order: 1, label: 'First'}),
      page('score/element/play/z', 'Z'),
      page('score/element/play/hidden', 'Hidden', {order: 0, hidden: true}),
    ]));
    const score = tree.find((entry): entry is NavGroup => entry.type === 'group' && entry.label === 'Score')!;
    const components = score.entries.find((entry): entry is NavGroup => entry.type === 'group' && entry.label === 'Web Components')!;
    const play = components.entries.find((entry): entry is NavGroup => entry.type === 'group' && entry.label === 'Play')!;
    expect(play.entries.map((entry) => entry.label)).toEqual(['First', 'B', 'score/element/play only', 'Z']);
    expect(play.collapsed).toBe(true);
  });

  it('takes the UI Kit groups from the presenter catalog', () => {
    const uikit = navigationTree(fixture()).find((entry): entry is NavGroup => entry.type === 'group' && entry.label === 'UI Kit')!;
    const groups = uikit.entries.filter((entry) => entry.type === 'group').map((entry) => entry.label);
    expect(groups).toEqual(UI_PRESENTER_CLASSES.map((entry) => entry.label));
  });

  it('fails when a listed directory has no pages', () => {
    expect(() => navigationTree([])).toThrow(/lists no pages/);
  });

  it('makes one tab per section and finds the section of a route', () => {
    const sections = navigationSections(navigationTree(fixture()));
    expect(sections.map((section) => section.label)).toEqual(['Start', 'Agents', 'Score', 'Audio', 'Bridge', 'UI Kit', 'Kernel']);
    expect(sectionFor(sections, '/audio/element/play/audio-player/').label).toBe('Audio');
    expect(sectionFor(sections, '/agent-toolkit/skills/').label).toBe('Agents');
    expect(sectionFor(sections, '/quick-start/').label).toBe('Start');
    expect(sectionFor(sections, '/').label).toBe('Start');
  });

  it('pages through every section in reading order', () => {
    const tree = navigationTree(fixture());
    expect(pager(tree, '/')).toEqual({prev: undefined, next: {type: 'link', label: 'Quick Start', href: '/quick-start/'}});
    expect(pager(tree, '/quick-start').next?.href).toBe('/agent-toolkit/');
    expect(pager(tree, '/agent-toolkit/agents-md/').next?.href).toBe('/score/');
    expect(pager(tree, '/kernel/api/').next).toBeUndefined();
    expect(pager(tree, '/not-listed/')).toEqual({});
    expect(links(tree).every((entry) => entry.href.startsWith('/') && entry.href.endsWith('/'))).toBe(true);
  });

  it('opens a collapsed group that holds the current page', () => {
    const tree = navigationTree(fixture());
    const score = tree.find((entry): entry is NavGroup => entry.type === 'group' && entry.label === 'Score')!;
    expect(holds(score, '/score/element/play/only/')).toBe(true);
    expect(holds(score, '/audio/')).toBe(false);
  });
});
