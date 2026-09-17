import path from 'node:path';
import {elementCompositionPolicy} from '../../../../scripts/element-composition-policy.mjs';

export const contextFiles = Object.freeze({
  index: 'llms.txt', full: 'llms-full.txt', components: 'llms-components.txt', patterns: 'llms-patterns.txt',
});
export const catalogOutput = 'agent-context/catalog.json';
export const licenseOutput = 'agent-context/LICENSE.txt';
export const sourceOutput = (source) => `agent-context/source/${source}.txt`;

// Documentation filenames differ from these reviewed owning modules. The
// default mapping covers pages whose filename already matches their module.
const headlessSources = {
  'play/player-controller': ['controller'],
  'play/metronome': ['inputs', 'tempo'],
  'play/effect': ['effects'],
  'play/score-player': ['score-player', 'tone-player'],
  'analyze/analysis-session': ['session', 'report'],
  'analyze/analysis-follower': ['follower', 'transport-clock'],
  'view/score-map-view': ['score-map'],
};
const themeSources = ['styles', 'internal/palette', 'internal/surface', 'internal/control']
  .map((name) => `packages/ui/src/${name}.ts`);

/** Public catalog records derive from the same reviewed catalogs as the site. */
export function componentCatalog(pages, presenters, composition) {
  const byRoute = new Map(pages.map((page) => [page.route, page]));
  const requirePage = (route) => {
    const page = byRoute.get(route);
    if (!page) throw new Error(`Agent component catalog has no documentation page: ${route}`);
    return page;
  };
  const record = (id, kind, page, sources, {styles = true, description = page.description} = {}) => ({
    id, kind, title: page.title, description,
    docs: [page.output], source: sources.map(sourceOutput),
    // These are documented public styling contracts, not an executable CSS
    // download or a promise that private source selectors are public API.
    styles: styles ? [page.output, 'agent-context/uikit/index.md'] : [],
  });
  const components = composition.map((entry) => {
    const policy = elementCompositionPolicy.find(({tag}) => tag === entry.tag);
    if (!policy) throw new Error(`Agent component catalog has no reviewed source: ${entry.tag}`);
    return record(`element/${entry.tag}`, 'element', requirePage(entry.href.split('#')[0]), [policy.source], {
      styles: !policy.behaviorOnly,
    });
  });
  for (const page of pages) {
    const match = /^\/score\/headless\/(play|analyze|view)\/([^/]+)\/$/.exec(page.route);
    if (!match) continue;
    const [, family, name] = match;
    const sources = (headlessSources[`${family}/${name}`] ?? [name]).map((module) => `packages/score/src/${family}/headless/${module}.ts`);
    components.push(record(`headless/${name}`, 'headless', page, sources, {styles: false}));
  }
  for (const entry of presenters) {
    components.push(record(`ui/${entry.presenter}`, 'ui', requirePage(`/uikit/${entry.classSlug}/${entry.presenter}/`), [`packages/ui/src/${entry.presenter}.ts`], {description: entry.summary}));
  }
  components.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(components.map(({id}) => id)).size !== components.length) throw new Error('Agent component catalog contains duplicate IDs.');
  return {
    schemaVersion: 1,
    sourceScope: 'Selected owning implementation files at the verified release; imports and internal selectors are not public entry points.',
    license: {id: 'MIT', output: licenseOutput},
    stylesFormat: 'public-documentation',
    components,
    theme: {docs: ['agent-context/uikit/index.md'], source: themeSources.map(sourceOutput)},
  };
}

export function catalogSourcePaths(catalog) {
  const outputs = [...catalog.components.flatMap(({source}) => source), ...catalog.theme.source];
  return [...new Set(outputs)].sort().map((output) => output.slice('agent-context/source/'.length, -'.txt'.length));
}

export function assertPublicRuntimeSource(source, release) {
  const owner = release.packages.find(({directory}) => source.startsWith(`${directory}/src/`));
  if (!owner || source.includes('\\') || source.split('/').some((part) => part.startsWith('.')) || !['.ts', '.tsx', '.css'].includes(path.extname(source))) {
    throw new Error(`Agent catalog source is outside verified runtime sources: ${source}`);
  }
}

// Curated task sections retain code and lifecycle notes from their owning
// references. Full member tables remain available in the components/full set.
export const patternSelection = [
  {title: 'Build a browser player', page: 'quick-start.mdx'},
  {title: 'Share one player with views and analysis', page: 'score/element/play/score-player.mdx', sections: ['Four ways to drive it', 'Share data and state with companions', 'Ownership and teardown']},
  {title: 'Own a player from custom UI', page: 'score/headless/play/score-player.mdx', sections: ['Import', 'Borrow data and playback state', 'Time and resource roles']},
  {title: 'Connect a view to playback', page: 'score/element/view/score-view.mdx', sections: ['Data and playback']},
  {title: 'Follow analysis and navigate musical positions', page: 'score/headless/analyze/analysis-follower.mdx', sections: ['Import', 'Data and time ownership', 'Navigation outcomes']},
  {title: 'Compose React state and components', page: 'score/api/react.mdx', sections: ['Install', 'Customize With Provider', 'Customize With Hooks', 'Customize Individual Components']},
  {title: 'Bind an independent presenter', page: 'uikit/api.mdx', sections: ['The shared presenter shape']},
  {title: 'Style a custom music interface', page: 'uikit/index.mdx', sections: ['Use UI Kit directly', 'Theme with CSS custom properties', 'Customization depth']},
  {title: 'Load, convert and parse music in a worker', page: 'score/api/io.mdx', sections: ['Install', 'Load and detect formats', 'Parse and serialize directly', 'Parse in a Worker']},
];

/** Every public page appears once in the task-oriented index. */
export function functionalIndexGroup(page) {
  const route = page.route;
  if (route.startsWith('/agent-toolkit/')) return 'Set up an AI coding agent';
  if (/^\/score\/(?:element|headless)\/play\/|^\/score\/api\/play\/|^\/uikit\/(?:transport-time|mixing-capture)\//.test(route)) return 'Play music, control time and capture input';
  if (/^\/score\/(?:element|headless)\/view\/|^\/score\/api\/view\/|^\/uikit\/(?:notes|layout-feedback)\//.test(route)) return 'Display scores, pitches and application state';
  if (/^\/score\/(?:element|headless)\/analyze\/|^\/score\/api\/analyze\/|^\/uikit\/views-analysis\//.test(route)) return 'Analyze harmony and follow playback';
  if (route === '/score/api/io/') return 'Load, parse and export music';
  if (route === '/score/api/react/') return 'Compose a React application';
  if (route.startsWith('/uikit/')) return 'Build and theme custom UI';
  if (route.startsWith('/kernel/')) return 'Use domain-neutral state and timing primitives';
  return 'Start here and choose an integration';
}
