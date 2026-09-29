/**
 * Read-only source probe. Run after package output is stable:
 * node /private/tmp/webmusic-audio-view-render-probe.mjs /path/to/WebMusic-dev-review
 *
 * Browser layout/canvas drawing are stubbed. Counts and backing dimensions
 * measure the renderer's requested work; timings are CPU-only harness timings,
 * not browser page-load, GPU-memory, or audible timing measurements.
 */
import {createRequire} from 'node:module';
import path from 'node:path';
const repository = path.resolve(process.argv[2] ?? process.cwd());
const require = createRequire(path.join(repository, 'package.json'));
const {build} = require('esbuild');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>');
const {window} = dom;
globalThis.window = window;
globalThis.document = window.document;
let width = 0;
let blits = 0;
let pixels = 0;
Object.defineProperty(window.HTMLDivElement.prototype, 'clientWidth', {
  get: () => width, configurable: true,
});
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    setTransform() {}, clearRect() {}, strokeRect() {},
    createImageData(w, h) {
      return {width: w, height: h, data: new Uint8ClampedArray(w * h * 4)};
    },
    putImageData(image) { blits++; pixels += image.width * image.height; },
  };
};
async function source(relative) {
  const result = await build({
    entryPoints: [path.join(repository, relative)], absWorkingDir: repository,
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {renderSpectrogramVisualizer} = await source('packages/audio/src/view/render/spectrogram-view.ts');
const host = document.createElement('div');
document.body.append(host);
const data = {
  magnitudes: new Float32Array([0, 1]), binsPerFrame: 1,
  frequencies: new Float32Array([1_000]), times: new Float32Array([0, 60]),
};
let start = performance.now();
const first = renderSpectrogramVisualizer(host, data, {
  durationSeconds: 60, pixelsPerSecond: 100, height: 256, devicePixelRatio: 2,
});
console.log(JSON.stringify({
  scenario: 'hidden spectrogram mount', blits, pixels,
  backingPixels: [...host.querySelectorAll('canvas')].reduce((n, c) => n + c.width * c.height, 0),
  elapsedMs: Math.round(performance.now() - start),
}));
first.dispose();
width = 400;
const second = renderSpectrogramVisualizer(host, data, {
  durationSeconds: 60, pixelsPerSecond: 100, height: 256, devicePixelRatio: 2,
});
blits = 0;
pixels = 0;
start = performance.now();
for (let i = 0; i < 20; i++) second.redraw(i / 20, true);
console.log(JSON.stringify({
  scenario: '20 follow cursor ticks before viewport movement', blits, pixels,
  viewport: second.viewport(), elapsedMs: Math.round(performance.now() - start),
}));
second.dispose();
width = 573;
const third = renderSpectrogramVisualizer(host, data, {
  durationSeconds: 319.98, pixelsPerSecond: 90, height: 256, devicePixelRatio: 2,
});
console.log(JSON.stringify({
  scenario: 'canonical-page geometry probe',
  canvases: [...host.querySelectorAll('canvas')].map(c => ({width: c.width, height: c.height, cssWidth: c.style.width})),
  backingBytes: [...host.querySelectorAll('canvas')].reduce((n, c) => n + c.width * c.height * 4, 0),
}));
third.dispose();
const {bindPlayerToWaveform} = await source('packages/audio/src/view/render/binding.ts');
let seeks = 0;
const binding = bindPlayerToWaveform({
  seconds: 0, duration: 60, on: () => () => {}, seek() { seeks++; },
}, {
  redraw() {}, hitTest() { return {seconds: 5}; }, setRegions() {},
}, {surface: host});
host.dispatchEvent(new window.MouseEvent('pointerdown', {clientX: 50}));
host.dispatchEvent(new window.MouseEvent('pointerup', {clientX: 50}));
console.log(JSON.stringify({scenario: 'one click on low-level binding', seeks}));
binding.unsubscribe();
dom.window.close();
