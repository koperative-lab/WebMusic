import {createHash} from 'node:crypto';
import {readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {packageDirectories} from '../../../../scripts/package-policy.mjs';
import {releaseBaseline} from './agent-context-release.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const additions = ['packages/audio', 'bridges/score-audio'];
const headlessSources = {
  'play/audio-player': ['audio-player'],
  'play/audio-clip-player': ['player'],
  'play/audio-mixer': ['mixer'],
  'play/audio-playlist': ['playlist'],
  'play/audio-recorder': ['recorder'],
  'play/effects': ['effects'],
  'play/engines': ['engines/buffer-engine', 'engines/media-engine'],
  'analyze/audio-analysis-session': ['session'],
  'analyze/realtime-analyzer': ['realtime'],
  'view/audio-meter': ['meter'],
  'view/audio-timeline': ['timeline', 'binding'],
  'view/live-projection': ['live'],
  'view/peaks': ['peaks'],
  'view/view-models': ['waveform', 'spectrogram'],
};

async function inspectSources(root) {
  const expected = [...releaseBaseline.packages.map(({directory}) => directory), ...additions];
  if (JSON.stringify(packageDirectories) !== JSON.stringify(expected)) throw new Error('Audio/Bridge context must cover the main packages and exactly its two additions.');
  root = await realpath(root);
  const read = async (relative) => {
    const filename = path.join(root, relative);
    if (await realpath(filename) !== filename) throw new Error(`Audio/Bridge context rejects symbolic links: ${relative}`);
    return readFile(filename, 'utf8');
  };
  const walk = async (directory, prefix = '') => {
    const result = [];
    for (const entry of (await readdir(path.join(root, directory, prefix), {withFileTypes: true})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.isSymbolicLink()) throw new Error(`Audio/Bridge context rejects symbolic links: ${directory}/${prefix}${entry.name}`);
      if (entry.name.startsWith('.')) continue;
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) result.push(...await walk(directory, `${relative}/`));
      else if (entry.isFile()) result.push(relative);
    }
    return result;
  };
  const packages = [];
  for (const directory of expected) {
    const manifest = JSON.parse(await read(`${directory}/package.json`));
    const contract = Object.fromEntries(Object.keys(manifest).filter((key) => key !== 'devDependencies').sort().map((key) => [key, manifest[key]]));
    const sources = [];
    for (const filename of await walk(`${directory}/src`)) sources.push([filename, digest(await read(`${directory}/src/${filename}`))]);
    packages.push({directory, name: manifest.name, version: manifest.version, manifestSha256: digest(json(contract)), sourceSha256: digest(json(sources))});
  }
  return {packages, sourceSnapshot: {
    adapter: 'audio-bridge', revision: digest(json(packages)),
    packages: Object.fromEntries(packages.map(({name, version}) => [name, version])),
    fingerprints: packages,
    verification: 'working-tree-source-and-manifest-sha256',
    releaseComparison: {commit: releaseBaseline.commit, packages: Object.fromEntries(releaseBaseline.packages.map((baseline) => {
      const actual = packages.find(({directory}) => directory === baseline.directory);
      return [baseline.name, Object.keys(baseline).every((key) => actual[key] === baseline[key])];
    }))},
  }};
}

// These additions do not change the main Toolkit's commands, release baseline,
// Score catalog, UI categories or default published-context lookup.
export const audioBridgeContext = Object.freeze({
  pageRoots: ['audio', 'bridge'],
  inputs: ['apps/doc/webmusic/scripts/agent-context-audio-bridge.mjs'],
  rawInputs: [
    'apps/doc/webmusic/src/components/bridges/bridge-composition-client.ts',
    'apps/doc/webmusic/src/components/bridges/independent-loops-client.ts',
    'apps/doc/webmusic/src/components/headless/arabesque-score.ts',
  ],
  htmlElements: ['kbd'],
  demoComponents: [
    'AudioAnalysisDemo', 'AudioAnalysisTimelinePlayground', 'AudioAnalysisViewDemo',
    'HlAudioPlayerDemo', 'AudioPlayerDemo', 'AudioRecorderDemo', 'AudioClipSummaryPlayground',
    'AudioCustomStyleDemo', 'AudioHistogramPlayground',
    'AudioLiveViewPlayground', 'AudioMeterDemo', 'AudioMixerDemo',
    'AudioPlaylistPlayground', 'AudioViewDemo', 'AudioWorkbenchDemo',
    'MultibandWaveformDemo', 'WaveformExamplesDemo', 'IndependentLoopsDemo', 'ScoreAudioSyncDemo',
  ],
  componentInventories: ['/audio/element/', '/audio/headless/'],
  sourceScope: 'Selected owning implementation files from the identified source snapshot. Package version labels do not establish release compatibility; imports and internal selectors are not public entries.',
  owner: (relative) => relative.startsWith('audio/') ? '@webmusic/audio' : relative.startsWith('bridge/') ? '@webmusic/bridge' : null,
  inspectSources,
  provenance: ({sourceSnapshot}, owner) => {
    const versions = owner ? {[owner]: sourceSnapshot.packages[owner]} : sourceSnapshot.packages;
    return `Source snapshot ${sourceSnapshot.revision}: ${Object.entries(versions).map(([name, version]) => `${name}@${version}`).join(', ')}. Includes Audio/Bridge additions; package version labels do not establish published compatibility. Match this source checkout's exports and declarations. The manifest retains the exact comparison with the unchanged main release baseline.`;
  },
  components(pages, record) {
    return pages.flatMap((page) => {
      if (page.route === '/bridge/headless/score-audio-sync/') return [record('headless/bridge/score-audio-sync', 'headless', page, ['sync', 'audio-master'].map((name) => `bridges/score-audio/src/${name}.ts`), {styles: false})];
      const match = /^\/audio\/headless\/(play|analyze|view)\/([^/]+)\/$/.exec(page.route);
      if (!match) return [];
      const [, family, name] = match;
      const modules = headlessSources[`${family}/${name}`];
      if (!modules) throw new Error(`Audio/Bridge context has no reviewed source mapping: ${page.route}`);
      return [record(`headless/audio/${name}`, 'headless', page, modules.map((module) => `packages/audio/src/${family}/headless/${module}.ts`), {styles: false})];
    });
  },
  functionalIndexGroup({route}) {
    if (route.startsWith('/bridge/')) return 'Coordinate Score and Audio';
    if (/^\/audio\/(?:element|headless|api)\/play\//.test(route)) return 'Play audio, record and mix';
    if (/^\/audio\/(?:element|headless|api)\/view\//.test(route)) return 'Display audio waveforms and spectral data';
    if (/^\/audio\/(?:element|headless|api)\/analyze\//.test(route)) return 'Analyze audio and follow playback';
    return undefined;
  },
  patterns: [
    {title: 'Play a decoded audio clip from custom UI', page: 'audio/headless/play/audio-clip-player.mdx', sections: ['Import', 'Ownership and the tap', 'Scratch sessions']},
    {title: 'Attach an audio waveform and choose its interaction', page: 'audio/element/view/audio-view.mdx', sections: ['Three ways in', 'Dragging and seeking']},
    {title: 'Coordinate Score and Audio from one session', page: 'bridge/composition.mdx', sections: ['Setup in your application', 'Three integration choices in one session', 'Independent loop lengths']},
  ],
  serverOrigin(server, request) {
    const origins = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])].flatMap((value) => {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? [url.origin] : [];
      } catch { return []; }
    });
    const known = origins.find((origin) => new URL(origin).host === request.headers?.host);
    if (known || origins.length) return known ?? origins[0];
    const address = server.httpServer?.address();
    const port = typeof address === 'object' && address ? address.port : 4321;
    return `${server.config?.server?.https ? 'https' : 'http'}://localhost:${Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4321}`;
  },
});
