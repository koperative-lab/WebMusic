// The home page's pictures: drawn once in a hidden background frame
// (render.html), kept in IndexedDB for this build, and handed to the cards as
// plain images. Cards near the screen are drawn first; the rest follow in the
// background, one at a time.
import type {PictureJob} from './render.ts';
import type {Picture} from './snapshot.ts';

export type {Picture} from './snapshot.ts';

/** Changes whenever the packages or the library's drawing code change (vite.config.ts). */
const VERSION: string = __LIBRARY_PICTURE_VERSION__;
const DB = 'webmusic-library';
const STORE = 'pictures';
/** A stretching element's picture is reused within this many pixels of the width asked for. */
const WIDTH_TOLERANCE = 12;

const keyOf = (job: PictureJob) => `${VERSION}|${job.tag}|${job.width === undefined ? 'own' : Math.round(job.width)}`;

const pictures = new Map<string, Picture>();
const urls = new Map<string, string>();

function open(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

let database: Promise<IDBDatabase | undefined> | undefined;
let loaded: Promise<void> | undefined;

/** Read this build's pictures into memory (once) and delete those of earlier builds. */
export function loadPictures(): Promise<void> {
  loaded ??= readAll();
  return loaded;
}

function readAll(): Promise<void> {
  database ??= open();
  return database.then((db) => new Promise<void>((resolve) => {
    if (!db) { resolve(); return; }
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      const cursor = transaction.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const key = String(current.key);
        if (key.startsWith(`${VERSION}|`)) pictures.set(key, current.value as Picture);
        else current.delete();
        current.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    } catch {
      resolve();
    }
  }));
}

function store(key: string, picture: Picture): void {
  pictures.set(key, picture);
  void database?.then((db) => {
    try { db?.transaction(STORE, 'readwrite').objectStore(STORE).put(picture, key); } catch { /* Drawn again next visit. */ }
  });
}

function candidates(tag: string): [number | 'own', Picture][] {
  const prefix = `${VERSION}|${tag}|`;
  return [...pictures].filter(([key]) => key.startsWith(prefix))
    .map(([key, picture]) => [key.slice(prefix.length) === 'own' ? 'own' : Number(key.slice(prefix.length)), picture]);
}

/** A picture for this job: exact, or (for a stretching element) one drawn at a close width. */
export function pictureFor(job: PictureJob): Picture | undefined {
  const exact = pictures.get(keyOf(job));
  if (exact || job.width === undefined) return exact;
  return candidates(job.tag).filter(([width]) => width !== 'own' && Math.abs(width - job.width!) <= WIDTH_TOLERANCE)
    .sort(([a], [b]) => Math.abs(Number(a) - job.width!) - Math.abs(Number(b) - job.width!))[0]?.[1];
}

/** Any picture of the element, to size and show its card while the right one is drawn. */
export function anyPicture(tag: string): Picture | undefined {
  return candidates(tag)[0]?.[1];
}

/** An object URL for a picture, made once. */
export function pictureUrl(picture: Picture): string {
  let url = urls.get(picture.svg);
  if (!url) {
    url = URL.createObjectURL(new Blob([picture.svg], {type: 'image/svg+xml'}));
    urls.set(picture.svg, url);
  }
  return url;
}

// ---------------------------------------------------------------- background drawing

interface Pending {
  readonly job: PictureJob;
  priority: number;
  readonly waiting: {resolve: (picture: Picture) => void; reject: (error: unknown) => void}[];
}

const queue = new Map<string, Pending>();
let busy = false;
let frame: HTMLIFrameElement | undefined;
let ready: Promise<(job: PictureJob) => Promise<Picture>> | undefined;
let idle = 0;

function drawer(): Promise<(job: PictureJob) => Promise<Picture>> {
  if (ready) return ready;
  window.clearTimeout(idle);
  frame = document.createElement('iframe');
  frame.title = 'Picture renderer';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // On screen but invisible, so the browser keeps drawing it at full rate.
  frame.style.cssText = 'position:fixed;left:0;top:0;width:2000px;height:1600px;border:0;opacity:0;pointer-events:none;z-index:-1';
  frame.src = `${import.meta.env.BASE_URL}render.html`;
  const current = frame;
  ready = new Promise((resolve, reject) => {
    const check = () => {
      const render = current.contentWindow?.renderPicture;
      if (render) resolve(render);
      else if (current.isConnected) setTimeout(check, 100);
      else reject(new Error('The picture renderer was closed'));
    };
    current.addEventListener('load', check, {once: true});
  });
  document.body.append(frame);
  return ready;
}

/** Close the background frame once nothing is left to draw, releasing its audio and players. */
function scheduleClose(): void {
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    if (busy || queue.size) return;
    frame?.remove();
    frame = undefined;
    ready = undefined;
  }, 4000);
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (queue.size) {
      const [key, next] = [...queue].sort(([, a], [, b]) => a.priority - b.priority)[0]!;
      try {
        // Pictures kept from an earlier visit are never drawn again.
        await loadPictures();
        const kept = pictures.get(key);
        if (kept) {
          queue.delete(key);
          for (const waiting of next.waiting) waiting.resolve(kept);
          continue;
        }
        const render = await drawer();
        const picture = await render(next.job);
        store(key, picture);
        queue.delete(key);
        for (const waiting of next.waiting) waiting.resolve(picture);
      } catch (error) {
        queue.delete(key);
        for (const waiting of next.waiting) waiting.reject(error);
      }
    }
  } finally {
    busy = false;
    scheduleClose();
  }
}

/** Draw a picture in the background; a lower priority number is drawn sooner. */
export function requestPicture(job: PictureJob, priority: number): Promise<Picture> {
  const key = keyOf(job);
  const known = pictures.get(key);
  if (known) return Promise.resolve(known);
  return new Promise((resolve, reject) => {
    const pending = queue.get(key);
    if (pending) {
      pending.priority = Math.min(pending.priority, priority);
      pending.waiting.push({resolve, reject});
    } else {
      queue.set(key, {job, priority, waiting: [{resolve, reject}]});
    }
    void pump();
  });
}

/** Change how soon a waiting picture is drawn. */
export function prioritize(job: PictureJob, priority: number): void {
  const pending = queue.get(keyOf(job));
  if (pending) pending.priority = priority;
}

/** Forget pictures nobody waits for any more (the reel was filtered or resized). */
export function cancelPending(keep: (job: PictureJob) => boolean): void {
  for (const [key, pending] of queue) {
    if (!keep(pending.job)) {
      queue.delete(key);
      for (const waiting of pending.waiting) waiting.reject(new DOMException('No longer needed', 'AbortError'));
    }
  }
}
