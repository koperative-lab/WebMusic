import {UI_PRESENTER_CLASSES} from '../../../shared/ui-presenter-catalog';

export interface Breadcrumb {
  label: string;
  /** Only ancestors are links; the final item names the current page. */
  href?: string;
}

export type BreadcrumbSidebarEntry =
  | {type: 'link'; label: string; href: string}
  | {type: 'group'; label: string; entries: readonly BreadcrumbSidebarEntry[]};

export interface BreadcrumbOptions {
  pathname: string;
  base: string;
  title: string;
  sidebar?: readonly BreadcrumbSidebarEntry[];
}

const capabilities: Record<string, string> = {
  play: 'Play',
  analyze: 'Analyze',
  view: 'View',
};

function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? '/';
  return `/${pathname.replace(/^\/+|\/+$/g, '')}`;
}

function withoutBase(pathname: string, base: string): string {
  const path = normalizePath(pathname);
  if (base === '/') return path;
  if (path === base) return '/';
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

function sidebarTrail(
  entries: readonly BreadcrumbSidebarEntry[],
  path: string,
  base: string,
): readonly BreadcrumbSidebarEntry[] | undefined {
  for (const entry of entries) {
    if (entry.type === 'link') {
      if (entry.href.startsWith('/') && !entry.href.startsWith('//')
        && withoutBase(entry.href, base) === path) return [entry];
    } else {
      const nested = sidebarTrail(entry.entries, path, base);
      if (nested) return [entry, ...nested];
    }
  }
  return undefined;
}

/**
 * Match the site's published hierarchy, including inventories hidden from the
 * sidebar. Group links target real pages/anchors instead of legacy redirects.
 */
export function getBreadcrumbs({pathname, base, title, sidebar = []}: BreadcrumbOptions): Breadcrumb[] {
  const normalizedBase = normalizePath(base);
  const path = withoutBase(pathname, normalizedBase);
  const href = (route: string): string => normalizedBase === '/' ? route : `${normalizedBase}${route}`;
  const home = {label: 'WebMusic', href: href('/')};
  if (path === '/' || path === '/introduction') return [{label: home.label}];

  const trail = sidebarTrail(sidebar, path, normalizedBase);
  const groupLabels = trail?.filter((entry) => entry.type === 'group').map((entry) => entry.label) ?? [];
  const crumbs: Breadcrumb[] = [home];
  const ancestor = (label: string, route: string): void => { crumbs.push({label, href: href(route)}); };
  const current = (label = title): Breadcrumb[] => [...crumbs, {label}];
  const [, section, form, capability] = path.split('/');

  if (section === 'score') {
    if (path === '/score') return current('Score');
    const isInventory = path === '/score/element' || path === '/score/headless';
    if (!trail && !isInventory && path !== '/score/api') return current();
    ancestor(groupLabels[0] ?? 'Score', '/score/');
    if (form === 'element' || form === 'headless') {
      const formLabel = groupLabels[1] ?? (form === 'element' ? 'Web Components' : 'Headless');
      if (isInventory) return current(formLabel);
      ancestor(formLabel, `/score/${form}/`);
      if (capability && capabilities[capability]) {
        ancestor(groupLabels[2] ?? capabilities[capability], `/score/${form}/#${capability}`);
      }
    } else if (form === 'api') {
      const apiLabel = groupLabels[1] ?? 'API';
      if (path === '/score/api') return current(apiLabel);
      ancestor(apiLabel, '/score/api/');
    }
    return current();
  }

  if (section === 'uikit') {
    if (path === '/uikit') return current('UI Kit');
    if (!trail) return current();
    ancestor(groupLabels[0] ?? 'UI Kit', '/uikit/');
    const presenterClass = UI_PRESENTER_CLASSES.find((entry) => entry.slug === form);
    if (presenterClass) {
      ancestor(presenterClass.label, `/uikit/catalog/#presenter-class-${presenterClass.slug}`);
    }
    return current();
  }

  if (section === 'agent-toolkit' || section === 'kernel') {
    const label = section === 'agent-toolkit' ? 'Agent Toolkit' : 'Kernel';
    if (path === `/${section}`) return current(label);
    if (trail) ancestor(groupLabels[0] ?? label, `/${section}/`);
  }
  return current();
}
