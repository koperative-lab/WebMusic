import {describe, expect, it} from 'vitest';
import {UI_PRESENTER_CLASSES} from '../../shared/ui-presenter-catalog';
import {getBreadcrumbs, type BreadcrumbSidebarEntry} from '../src/starlight/breadcrumbs';

const group = (label: string, entries: BreadcrumbSidebarEntry[]): BreadcrumbSidebarEntry => ({type: 'group', label, entries});
const link = (label: string, href: string): BreadcrumbSidebarEntry => ({type: 'link', label, href});

function sidebar(base = '/'): BreadcrumbSidebarEntry[] {
  const prefix = base === '/' ? '' : base.replace(/\/$/, '');
  const page = (label: string, path: string): BreadcrumbSidebarEntry => link(label, `${prefix}${path}`);
  return [
    page('Introduction', '/'),
    page('Quick Start', '/quick-start/'),
    group('Score', [
      page('Overview', '/score/'),
      ...(['element', 'headless'] as const).map((form) => group(form === 'element' ? 'Web Components' : 'Headless',
        ['play', 'analyze', 'view'].map((capability) => group(capability[0]!.toUpperCase() + capability.slice(1), [
          page('Player', `/score/${form}/${capability}/example/`),
        ])),
      )),
      group('API', [page('@webmusic/score', '/score/api/'), page('@webmusic/score/play', '/score/api/play/')]),
    ]),
    group('UI Kit', [
      page('Overview', '/uikit/'),
      page('Catalog', '/uikit/catalog/'),
      page('@webmusic/ui', '/uikit/api/'),
      ...UI_PRESENTER_CLASSES.map((entry) => group(entry.label, [page('Presenter', `/uikit/${entry.slug}/example/`)])),
    ]),
    group('Agent Toolkit', [page('Overview', '/agent-toolkit/'), page('Skills', '/agent-toolkit/skills/')]),
    group('Kernel', [page('Overview', '/kernel/'), page('@webmusic/kernel', '/kernel/api/')]),
  ];
}

describe('documentation breadcrumbs', () => {
  it.each(['/', '/WebMusic/'])('uses direct capability anchors and exactly one %s base prefix', (base) => {
    const prefix = base === '/' ? '' : base.slice(0, -1);
    for (const form of ['element', 'headless']) {
      for (const capability of ['play', 'analyze', 'view']) {
        expect(getBreadcrumbs({
          pathname: `${prefix}/score/${form}/${capability}/example/?demo=1#details`,
          base,
          title: '<score-player>',
          sidebar: sidebar(base),
        })).toEqual([
          {label: 'WebMusic', href: `${prefix}/`},
          {label: 'Score', href: `${prefix}/score/`},
          {label: form === 'element' ? 'Web Components' : 'Headless', href: `${prefix}/score/${form}/`},
          {label: capability[0]!.toUpperCase() + capability.slice(1), href: `${prefix}/score/${form}/#${capability}`},
          {label: '<score-player>'},
        ]);
      }
    }
  });

  it('keeps hidden inventories discoverable without a sidebar entry', () => {
    for (const [path, label] of [['element', 'Web Components'], ['headless', 'Headless']]) {
      expect(getBreadcrumbs({pathname: `/score/${path}/`, base: '/', title: `Score ${label}`, sidebar: sidebar()})).toEqual([
        {label: 'WebMusic', href: '/'},
        {label: 'Score', href: '/score/'},
        {label},
      ]);
    }
  });

  it('links Score API references to the root API page', () => {
    expect(getBreadcrumbs({pathname: '/score/api/play/', base: '/', title: '@webmusic/score/play', sidebar: sidebar()})).toEqual([
      {label: 'WebMusic', href: '/'},
      {label: 'Score', href: '/score/'},
      {label: 'API', href: '/score/api/'},
      {label: '@webmusic/score/play'},
    ]);
    expect(getBreadcrumbs({pathname: '/score/api', base: '/', title: '@webmusic/score', sidebar: sidebar()}).at(-1)).toEqual({label: 'API'});
  });

  it('links every UI category to its owning catalog section', () => {
    for (const entry of UI_PRESENTER_CLASSES) {
      expect(getBreadcrumbs({pathname: `/uikit/${entry.slug}/example/`, base: '/', title: 'Presenter', sidebar: sidebar()})).toEqual([
        {label: 'WebMusic', href: '/'},
        {label: 'UI Kit', href: '/uikit/'},
        {label: entry.label, href: `/uikit/catalog/#presenter-class-${entry.slug}`},
        {label: 'Presenter'},
      ]);
    }
  });

  it.each([
    ['/uikit/catalog/', 'Catalog', 'UI Kit', '/uikit/'],
    ['/uikit/api/', '@webmusic/ui', 'UI Kit', '/uikit/'],
    ['/kernel/api/', '@webmusic/kernel', 'Kernel', '/kernel/'],
    ['/agent-toolkit/skills/', 'Skills', 'Agent Toolkit', '/agent-toolkit/'],
  ])('gives %s its section parent', (pathname, title, section, href) => {
    expect(getBreadcrumbs({pathname, title, base: '/', sidebar: sidebar()})).toEqual([
      {label: 'WebMusic', href: '/'}, {label: section, href}, {label: title},
    ]);
  });

  it.each([
    ['/score/', 'Score'], ['/uikit/', 'UI Kit'], ['/kernel/', 'Kernel'], ['/agent-toolkit/', 'Agent Toolkit'],
  ])('does not duplicate Overview on %s', (pathname, label) => {
    expect(getBreadcrumbs({pathname, title: label, base: '/', sidebar: sidebar()})).toEqual([
      {label: 'WebMusic', href: '/'}, {label},
    ]);
  });

  it.each(['/', '/introduction', '/introduction/', '/introduction?reset-cache=1'])('treats %s as the homepage', (route) => {
    for (const base of ['/', '/WebMusic/']) {
      const prefix = base === '/' ? '' : base.slice(0, -1);
      expect(getBreadcrumbs({pathname: prefix + route, title: 'Introduction', base, sidebar: sidebar(base)})).toEqual([{label: 'WebMusic'}]);
    }
  });

  it('uses the page title on a direct page and never makes the current item a link', () => {
    expect(getBreadcrumbs({pathname: '/quick-start', base: '/', title: 'Quick Start', sidebar: sidebar()})).toEqual([
      {label: 'WebMusic', href: '/'}, {label: 'Quick Start'},
    ]);
  });

  it.each(['/404/', '/score/not-a-page/', '/uikit/no-such-category/', '/WebMusical/score/api/'])('does not invent hierarchy for %s', (pathname) => {
    expect(getBreadcrumbs({pathname, base: '/WebMusic/', title: 'Page not found', sidebar: sidebar('/WebMusic/')})).toEqual([
      {label: 'WebMusic', href: '/WebMusic/'}, {label: 'Page not found'},
    ]);
  });
});
