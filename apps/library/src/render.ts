// The background frame that draws the home page's pictures. It mounts one
// element at a time with the packages' own code on Arabesque No. 1, waits for
// it to settle, turns the element alone — not the player or input that feeds
// it — into a picture, and releases everything before the next one. The home
// page calls `renderPicture` on this frame's window; it never mounts elements
// itself.
import {composeApp, recipeFor} from './compose.ts';
import {mountComposition} from './elements.ts';
import {defaultStylesFrom, snapshot, type Picture} from './snapshot.ts';

export interface PictureJob {
  readonly tag: string;
  /** Width to lay a stretching element out at; absent for an element with its own width. */
  readonly width?: number;
}

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: light; }
  html, body { margin: 0; background: #fff; color: #111; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #stage { display: grid; gap: 12px; }
  :where(#stage) > :where(:not([hidden], style, script, template)) { display: block; min-width: 0; max-width: 100%; }
  :where(#stage) :where(score-player, audio-player, audio-mixer, score-rack-control, score-rack-part) > :where(:not([hidden], style, script, template, score-effect, audio-effect)) { display: block; }
`;
document.head.append(style);
const stage = document.querySelector<HTMLElement>('#stage')!;

// UA defaults come from a blank document, so only real styling is written into a picture.
const blank = document.createElement('iframe');
blank.setAttribute('aria-hidden', 'true');
blank.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
document.body.append(blank);
const defaults = defaultStylesFrom(blank.contentDocument!);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** Statuses that mean the element has not finished drawing what it shows. */
const UNFINISHED = '.wui-status[data-kind="loading"], .wui-status[data-kind="waiting"], .wui-status[data-kind="error"], [aria-busy="true"]';

/** Visible unfinished statuses anywhere in the element's composed tree, shadow roots included. */
export function unfinished(root: Element): string[] {
  const found: string[] = [];
  const visit = (scope: Element | ShadowRoot) => {
    for (const node of scope.querySelectorAll(UNFINISHED)) {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (box.width && box.height && style.visibility !== 'hidden' && style.display !== 'none') {
        found.push(node.textContent?.trim() || node.getAttribute('data-kind') || 'busy');
      }
    }
    for (const element of scope.querySelectorAll('*')) if (element.shadowRoot) visit(element.shadowRoot);
  };
  visit(root);
  if (root.shadowRoot) visit(root.shadowRoot);
  return found;
}

/** Wait until the element has stopped changing: no DOM or size change for a while. */
async function settle(root: HTMLElement, signal: AbortSignal): Promise<void> {
  await document.fonts.ready;
  const start = performance.now();
  let changed = start;
  const touch = () => { changed = performance.now(); };
  const mutations = new MutationObserver(touch);
  mutations.observe(root, {subtree: true, childList: true, attributes: true, characterData: true});
  const sizes = new ResizeObserver(touch);
  sizes.observe(root);
  try {
    while (!signal.aborted && performance.now() - start < 15000) {
      await sleep(120);
      const now = performance.now();
      if (now - changed > 700 && now - start > 1200) break;
    }
  } finally {
    mutations.disconnect();
    sizes.disconnect();
  }
  await frame();
  await frame();
}

let running: Promise<unknown> = Promise.resolve();

/** Draw one element and return its picture. Calls run one after another. */
export function renderPicture(job: PictureJob): Promise<Picture> {
  const next = running.then(() => draw(job));
  running = next.catch(() => undefined);
  return next;
}

async function draw(job: PictureJob): Promise<Picture> {
  const recipe = recipeFor(job.tag);
  stage.style.width = job.width ? `${job.width}px` : 'max-content';
  const controller = new AbortController();
  const errors: unknown[] = [];
  const cleanup = await mountComposition(stage, composeApp([job.tag], {mediaBase: import.meta.env.BASE_URL, bareHosts: true}), (error) => errors.push(error), controller.signal);
  try {
    await settle(stage, controller.signal);
    const target = stage.querySelector(recipe.picture ?? job.tag);
    if (!target) throw new Error(`<${job.tag}> drew nothing to picture`);
    // Never picture a half-drawn element: wait out loading and waiting states.
    for (let waited = 0; unfinished(target).length && waited < 10000 && !errors.length; waited += 250) await sleep(250);
    const pending = unfinished(target);
    if (pending.length) throw new Error(`<${job.tag}> did not finish drawing: ${pending.join('; ')}`);
    if (errors.length) throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
    return snapshot(target, defaults);
  } finally {
    controller.abort();
    cleanup();
  }
}

declare global {
  interface Window { renderPicture?: typeof renderPicture }
}
window.renderPicture = renderPicture;
window.parent.postMessage({type: 'webmusic-library:pictures-ready'}, location.origin);
