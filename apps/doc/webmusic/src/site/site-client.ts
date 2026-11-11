/**
 * Page chrome behaviour: the narrow-screen navigation toggle, the navigation's
 * scroll offset across page loads, copy buttons on code blocks and the current
 * heading in the contents column. Each part works without the others.
 */

const SCROLL_KEY = 'webmusic:nav-scroll';

function storage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

/** Every click is a full page load, so the long navigation keeps its offset per tab. */
export function keepNavigationScroll(nav: HTMLElement): void {
  const store = storage();
  const saved = Number(store?.getItem(SCROLL_KEY) ?? Number.NaN);
  const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
  if (Number.isFinite(saved) && saved > 0) nav.scrollTop = saved;
  // A first visit has nothing to restore: bring the current page into view instead.
  else if (current) nav.scrollTop = current.offsetTop - nav.clientHeight / 2 + current.offsetHeight / 2;
  // An offset from another section can hide the current page; show it then.
  if (current) {
    const top = current.offsetTop - nav.scrollTop;
    if (top < 0 || top + current.offsetHeight > nav.clientHeight) {
      nav.scrollTop = current.offsetTop - nav.clientHeight / 2 + current.offsetHeight / 2;
    }
  }
  const write = (): void => { try { store?.setItem(SCROLL_KEY, String(nav.scrollTop)); } catch { /* storage is optional */ } };
  nav.addEventListener('click', write, {capture: true});
  window.addEventListener('pagehide', write);
}

/** Below the two-column width the navigation opens over the page from the menu button. */
export function mountNavigationToggle(document: Document): void {
  const button = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const nav = document.getElementById('doc-nav');
  if (!button || !nav) return;
  const set = (open: boolean): void => {
    button.setAttribute('aria-expanded', String(open));
    document.body.toggleAttribute('data-nav-open', open);
    if (open) (nav.querySelector<HTMLElement>('[aria-current="page"]') ?? nav.querySelector<HTMLElement>('a'))?.focus();
  };
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  // A pointer on the scrim beside the open navigation closes it.
  document.addEventListener('click', (event) => {
    if (document.body.hasAttribute('data-nav-open') && event.target === document.body) set(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.hasAttribute('data-nav-open')) { set(false); button.focus(); }
  });
}

/** One delegated listener copies the code of the block whose button was pressed. */
export function mountCodeCopy(document: Document): void {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-code-copy]') : null;
    const code = button?.closest('.doc-code')?.querySelector('pre');
    if (!button || !code) return;
    const done = (ok: boolean): void => {
      button.dataset.copied = ok ? 'true' : 'false';
      button.setAttribute('aria-label', ok ? 'Copied' : 'Copy failed');
      window.setTimeout(() => { delete button.dataset.copied; button.setAttribute('aria-label', 'Copy code'); }, 1500);
    };
    void navigator.clipboard?.writeText(code.textContent ?? '').then(() => done(true), () => done(false));
  });
}

/** Mark the contents link of the last heading above the top fifth of the window. */
export function mountContentsTracking(document: Document): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.doc-toc a[href^="#"]')];
  if (!links.length) return;
  const targets = links.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  let queued = false;
  const update = (): void => {
    queued = false;
    const line = window.innerHeight / 5;
    let index = -1;
    targets.forEach((target, i) => { if (target && target.getBoundingClientRect().top <= line) index = i; });
    links.forEach((link, i) => { if (i === index) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current'); });
  };
  const schedule = (): void => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', schedule, {passive: true});
  window.addEventListener('resize', schedule);
  update();
}

/** On narrow screens the section tabs scroll; start with the current one in view. */
export function revealCurrentTab(document: Document): void {
  const tabs = document.querySelector<HTMLElement>('.doc-tabs');
  const tab = tabs?.querySelector<HTMLElement>('[aria-current]');
  if (!tabs || !tab) return;
  const offset = tab.getBoundingClientRect().left - tabs.getBoundingClientRect().left;
  if (offset < 0 || offset + tab.offsetWidth > tabs.clientWidth) tabs.scrollLeft += offset - (tabs.clientWidth - tab.offsetWidth) / 2;
}

export function mountSite(document: Document): void {
  revealCurrentTab(document);
  const nav = document.getElementById('doc-nav');
  if (nav) keepNavigationScroll(nav);
  mountNavigationToggle(document);
  mountCodeCopy(document);
  mountContentsTracking(document);
}
