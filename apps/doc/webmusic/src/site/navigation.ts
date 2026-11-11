import {UI_PRESENTER_CLASSES} from '../../../shared/ui-presenter-catalog';
import type {BreadcrumbSidebarEntry} from './breadcrumbs';

/**
 * The site's navigation, owned here rather than by a theme. The top bar shows
 * one tab per section; the left column lists that section's tree. Groups that
 * name a directory list its pages by `sidebar.order`, then title, leaving out
 * `sidebar.hidden` pages. The tree has the shape the breadcrumbs read.
 */

/**
 * A page's id is its route without slashes at either end: `score/index.mdx`
 * is `score`, and the site root is `index`.
 */
export const docId = (entry: string): string => {
  const route = entry.replace(/\.mdx?$/, '').replace(/(?:^|\/)index$/, '').toLowerCase();
  return route || 'index';
};

export interface NavPage {
  /** Route without slashes at either end; the root page is `index`. */
  id: string;
  title: string;
  sidebar: {label?: string; order?: number; hidden?: boolean};
}

export interface NavLink {
  type: 'link';
  label: string;
  /** Site route with a trailing slash, before the deployment base is added. */
  href: string;
}

export interface NavGroup {
  type: 'group';
  label: string;
  entries: readonly NavEntry[];
  /** Starts closed unless it holds the current page. */
  collapsed?: boolean;
}

export type NavEntry = NavLink | NavGroup;

export interface NavSection {
  /** First path segment the section owns (`''` for the start pages). */
  slug: string;
  label: string;
  /** Where the section's tab points. */
  href: string;
  entries: readonly NavEntry[];
}

type Spec =
  | {link: string; label: string}
  | {directory: string}
  | {group: string; items: readonly Spec[]; collapsed?: boolean};

const link = (label: string, href: string): Spec => ({link: href, label});
const group = (label: string, items: readonly Spec[], collapsed = false): Spec => ({group: label, items, collapsed});
const directory = (path: string): Spec => ({directory: path});

const capability = (family: string, form: 'element' | 'headless', name: 'play' | 'analyze' | 'view') =>
  group({play: 'Play', analyze: 'Analyze', view: 'View'}[name], [directory(`${family}/${form}/${name}`)], form === 'element');

const domain = (family: 'score' | 'audio', label: string, entries: readonly string[]): Spec => group(label, [
  link('Overview', `/${family}/`),
  group('Web Components', [
    link('Overview', `/${family}/element/`),
    capability(family, 'element', 'play'),
    capability(family, 'element', 'analyze'),
    capability(family, 'element', 'view'),
  ]),
  group('Headless', [
    link('Overview', `/${family}/headless/`),
    capability(family, 'headless', 'play'),
    capability(family, 'headless', 'analyze'),
    capability(family, 'headless', 'view'),
  ]),
  group('API', entries.map((entry) => link(`@webmusic/${family}${entry ? `/${entry}` : ''}`, `/${family}/api/${entry ? `${entry}/` : ''}`))),
]);

/** The published hierarchy. Top-level links are the start section; top-level groups are sections. */
export const SITE_NAVIGATION: readonly Spec[] = [
  link('Introduction', '/'),
  link('Quick Start', '/quick-start/'),
  group('Agent Toolkit', [
    link('Overview', '/agent-toolkit/'),
    link('llms.txt', '/agent-toolkit/llms-txt/'),
    link('Skills', '/agent-toolkit/skills/'),
    link('AGENTS.md', '/agent-toolkit/agents-md/'),
  ]),
  domain('score', 'Score', ['', 'io', 'play', 'analyze', 'view', 'react']),
  domain('audio', 'Audio', ['', 'play', 'analyze', 'view', 'react']),
  group('Bridge', [
    link('Overview', '/bridge/'),
    link('Playback composition', '/bridge/composition/'),
    link('Modular composition', '/bridge/modular-composition/'),
    group('Headless', [directory('bridge/headless')]),
    link('@webmusic/bridge', '/bridge/api/'),
  ]),
  group('UI Kit', [
    link('Overview', '/uikit/'),
    link('Catalog', '/uikit/catalog/'),
    // Presenter classes come from the catalog, so labels and order stay one list.
    ...UI_PRESENTER_CLASSES.map((entry) => group(entry.label, [directory(`uikit/${entry.slug}`)], true)),
    link('@webmusic/ui', '/uikit/api/'),
  ]),
  group('Kernel', [
    link('Overview', '/kernel/'),
    link('@webmusic/kernel', '/kernel/api/'),
  ]),
];

/** Short top-bar names; the group label stays the breadcrumb and heading. */
const TAB_LABELS: Record<string, string> = {'Agent Toolkit': 'Agents'};

const route = (id: string): string => id === 'index' ? '/' : `/${id}/`;

function directoryLinks(path: string, pages: readonly NavPage[]): NavLink[] {
  const prefix = `${path}/`;
  return pages
    .filter((page) => page.id.startsWith(prefix) && !page.id.slice(prefix.length).includes('/') && !page.sidebar.hidden)
    .sort((a, b) => (a.sidebar.order ?? Number.POSITIVE_INFINITY) - (b.sidebar.order ?? Number.POSITIVE_INFINITY)
      || a.title.localeCompare(b.title))
    .map((page) => ({type: 'link', label: page.sidebar.label ?? page.title, href: route(page.id)}));
}

function resolve(specs: readonly Spec[], pages: readonly NavPage[]): NavEntry[] {
  return specs.flatMap((spec): NavEntry[] => {
    if ('link' in spec) return [{type: 'link', label: spec.label, href: spec.link}];
    if ('directory' in spec) {
      const links = directoryLinks(spec.directory, pages);
      if (!links.length) throw new Error(`Navigation directory ${spec.directory} lists no pages.`);
      return links;
    }
    return [{type: 'group', label: spec.group, entries: resolve(spec.items, pages), collapsed: spec.collapsed}];
  });
}

/** The full tree, in the shape the breadcrumbs read. */
export function navigationTree(pages: readonly NavPage[]): NavEntry[] {
  return resolve(SITE_NAVIGATION, pages);
}

/** One section per top-level group, after the start section of top-level links. */
export function navigationSections(tree: readonly NavEntry[]): NavSection[] {
  const start = tree.filter((entry): entry is NavLink => entry.type === 'link');
  const sections: NavSection[] = [{slug: '', label: 'Start', href: '/', entries: start}];
  for (const entry of tree) {
    if (entry.type !== 'group') continue;
    const first = links(entry.entries)[0];
    if (!first) continue;
    sections.push({slug: first.href.split('/')[1] ?? '', label: TAB_LABELS[entry.label] ?? entry.label, href: first.href, entries: entry.entries});
  }
  return sections;
}

/** Every link in reading order. */
export function links(entries: readonly NavEntry[]): NavLink[] {
  return entries.flatMap((entry) => entry.type === 'link' ? [entry] : links(entry.entries));
}

const normalize = (path: string): string => `/${path.split(/[?#]/, 1)[0]!.replace(/^\/+|\/+$/g, '')}`;

/** The section a route belongs to: its first path segment, or start. */
export function sectionFor(sections: readonly NavSection[], path: string): NavSection {
  const segment = normalize(path).split('/')[1] ?? '';
  return sections.find((section) => section.slug && section.slug === segment) ?? sections[0]!;
}

/** True when the link names the route (fragments and trailing slashes aside). */
export const isCurrent = (href: string, path: string): boolean => normalize(href) === normalize(path);

/** True when a group holds the current route. */
export const holds = (entry: NavEntry, path: string): boolean => entry.type === 'link'
  ? isCurrent(entry.href, path)
  : entry.entries.some((child) => holds(child, path));

/** The neighbours of a route in reading order across every section. */
export function pager(tree: readonly NavEntry[], path: string): {prev?: NavLink; next?: NavLink} {
  const order = links(tree).filter((entry) => !entry.href.includes('#'));
  const index = order.findIndex((entry) => isCurrent(entry.href, path));
  if (index < 0) return {};
  return {prev: order[index - 1], next: order[index + 1]};
}

/** The breadcrumbs read the same tree. */
export const breadcrumbSidebar = (tree: readonly NavEntry[]): readonly BreadcrumbSidebarEntry[] => tree;
