import {describe, expect, it} from 'vitest';
import {getBreadcrumbs, type BreadcrumbSidebarEntry} from '../src/starlight/breadcrumbs';

const base = '/WebMusic/';
const group = (label: string, entries: BreadcrumbSidebarEntry[]): BreadcrumbSidebarEntry => ({type: 'group', label, entries});
const page = (label: string, path: string): BreadcrumbSidebarEntry => ({type: 'link', label, href: `/WebMusic${path}`});

describe('Audio and Bridge documentation breadcrumbs', () => {
  it('uses Audio capability and inventory owners with exactly one deployment prefix', () => {
    for (const form of ['element', 'headless']) {
      const formLabel = form === 'element' ? 'Web Components' : 'Headless';
      const sidebar = [group('Audio', [group(formLabel, [group('View', [
        page('Waveform', `/audio/${form}/view/waveform/`),
      ])])])];
      expect(getBreadcrumbs({pathname: `/WebMusic/audio/${form}/view/waveform/`, base, title: 'Waveform', sidebar})).toEqual([
        {label: 'WebMusic', href: base},
        {label: 'Audio', href: `${base}audio/`},
        {label: formLabel, href: `${base}audio/${form}/`},
        {label: 'View', href: `${base}audio/${form}/#view`},
        {label: 'Waveform'},
      ]);
      expect(getBreadcrumbs({pathname: `/WebMusic/audio/${form}/`, base, title: 'Inventory'})).toEqual([
        {label: 'WebMusic', href: base},
        {label: 'Audio', href: `${base}audio/`},
        {label: formLabel},
      ]);
    }
    const sidebar = [group('Audio', [group('API', [page('Playback', '/audio/api/play/')])])];
    expect(getBreadcrumbs({pathname: '/WebMusic/audio/api/play/', base, title: 'Playback', sidebar})).toEqual([
      {label: 'WebMusic', href: base},
      {label: 'Audio', href: `${base}audio/`},
      {label: 'API', href: `${base}audio/api/`},
      {label: 'Playback'},
    ]);
    expect(getBreadcrumbs({pathname: '/WebMusic/audio/missing/', base, title: 'Page not found', sidebar})).toEqual([
      {label: 'WebMusic', href: base}, {label: 'Page not found'},
    ]);
  });

  it('routes Bridge objects through their real Headless inventory while API and composition link to Bridge', () => {
    const sidebar = [group('Bridge', [
      page('Playback composition', '/bridge/composition/'),
      page('@webmusic/bridge', '/bridge/api/'),
      group('Headless', [page('ScoreAudioSync', '/bridge/headless/score-audio-sync/')]),
    ])];
    expect(getBreadcrumbs({pathname: '/WebMusic/bridge/headless/score-audio-sync/', base, title: 'ScoreAudioSync', sidebar})).toEqual([
      {label: 'WebMusic', href: base},
      {label: 'Bridge', href: `${base}bridge/`},
      {label: 'Headless', href: `${base}bridge/headless/`},
      {label: 'ScoreAudioSync'},
    ]);
    expect(getBreadcrumbs({pathname: '/WebMusic/bridge/headless/', base, title: 'Bridge Headless'})).toEqual([
      {label: 'WebMusic', href: base},
      {label: 'Bridge', href: `${base}bridge/`},
      {label: 'Headless'},
    ]);
    for (const [route, title] of [['api', '@webmusic/bridge'], ['composition', 'Playback composition']]) {
      expect(getBreadcrumbs({pathname: `/WebMusic/bridge/${route}/`, base, title: title!, sidebar})).toEqual([
        {label: 'WebMusic', href: base}, {label: 'Bridge', href: `${base}bridge/`}, {label: title},
      ]);
    }
    expect(getBreadcrumbs({pathname: '/WebMusic/bridge/', base, title: 'Bridge', sidebar})).toEqual([
      {label: 'WebMusic', href: base}, {label: 'Bridge'},
    ]);
    expect(getBreadcrumbs({pathname: '/WebMusic/bridge/missing/', base, title: 'Page not found', sidebar})).toEqual([
      {label: 'WebMusic', href: base}, {label: 'Page not found'},
    ]);
  });
});
