/**
 * Lightweight DOM stubs for exercising the visualizers in plain Node — the
 * same pattern as visualizer.test.ts, extended with parent/child wiring,
 * scroll metrics and event listeners so virtualization and canvas layering
 * can be tested without jsdom.
 */

export class StubStyle {
  props: Record<string, string | null> = {};
  setProperty(key: string, value: string | null): void {
    this.props[key] = value;
  }
}

export class StubClassList {
  private names = new Set<string>();
  add(...names: string[]): void {
    names.forEach((name) => this.names.add(name));
  }
  remove(...names: string[]): void {
    names.forEach((name) => this.names.delete(name));
  }
  contains(name: string): boolean {
    return this.names.has(name);
  }
}

export class StubElement {
  tagName: string;
  children: StubElement[] = [];
  parentElement: StubElement | null = null;
  style = new StubStyle();
  dataset: Record<string, string> = {};
  classList = new StubClassList();
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  isConnected = true;
  clientWidth = 0;
  clientHeight = 0;
  scrollLeft = 0;
  scrollTop = 0;
  scrollHeight = 0;
  rectWidth = 0;
  rectHeight = 0;

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  get parentNode(): StubElement | null {
    return this.parentElement;
  }

  get firstChild(): StubElement | null {
    return this.children[0] ?? null;
  }

  set innerHTML(_value: string) {
    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
  }

  appendChild(child: StubElement): StubElement {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: StubElement, reference: StubElement | null): StubElement {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  removeChild(child: StubElement): StubElement {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  setAttribute(key: string, value: string): void {
    this.attrs[key] = value;
  }

  getAttribute(key: string): string | null {
    return this.attrs[key] ?? null;
  }

  removeAttribute(key: string): void {
    delete this.attrs[key];
  }

  querySelector(): null {
    return null;
  }

  getBoundingClientRect(): {width: number; height: number} {
    return {width: this.rectWidth, height: this.rectHeight};
  }

  addEventListener(type: string, listener: (...args: unknown[]) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners[type];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index !== -1) list.splice(index, 1);
  }

  dispatch(type: string): void {
    [...(this.listeners[type] ?? [])].forEach((listener) => listener({type, target: this}));
  }
}

/** 2D context stub counting draw calls and recording the last transform. */
export class StubCanvasContext {
  fillStyle = '';
  fillRectCalls = 0;
  clearRectCalls = 0;
  lastTransform: number[] = [1, 0, 0, 1, 0, 0];
  readonly canvas: StubCanvasElement;

  constructor(canvas: StubCanvasElement) {
    this.canvas = canvas;
  }

  fillRect(): void {
    this.fillRectCalls += 1;
  }

  clearRect(): void {
    this.clearRectCalls += 1;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.lastTransform = [a, b, c, d, e, f];
  }

  scale(): void {}
  translate(): void {}
  save(): void {}
  restore(): void {}
}

export class StubCanvasElement extends StubElement {
  width = 0;
  height = 0;
  readonly ctx: StubCanvasContext;

  constructor() {
    super('canvas');
    this.ctx = new StubCanvasContext(this);
  }

  getContext(type: string): StubCanvasContext | null {
    return type === '2d' ? this.ctx : null;
  }
}

export interface StubDocument {
  createElement(tag: string): StubElement;
  createElementNS(ns: string, tag: string): StubElement;
  /** Total elements created via createElementNS, by tag. */
  nsCreated: Record<string, number>;
}

export function makeStubDocument(): StubDocument {
  const doc: StubDocument = {
    nsCreated: {},
    createElement(tag: string): StubElement {
      return tag === 'canvas' ? new StubCanvasElement() : new StubElement(tag);
    },
    createElementNS(_ns: string, tag: string): StubElement {
      doc.nsCreated[tag] = (doc.nsCreated[tag] ?? 0) + 1;
      return new StubElement(tag);
    },
  };
  return doc;
}

export interface StubGlobals {
  document: StubDocument;
  restore(): void;
}

/** Install global `document`/`window` stubs; call `restore()` when done. */
export function installStubGlobals(devicePixelRatio = 1): StubGlobals {
  const globals = globalThis as Record<string, unknown>;
  const previousDocument = globals.document;
  const previousWindow = globals.window;
  const previousHTMLDivElement = globals.HTMLDivElement;
  const doc = makeStubDocument();
  globals.document = doc;
  globals.window = {
    devicePixelRatio,
    getComputedStyle: () => ({height: '0', minHeight: '0'}),
  };
  // Lets `instanceof HTMLDivElement` guards accept StubElement containers.
  globals.HTMLDivElement = StubElement;
  return {
    document: doc,
    restore() {
      if (previousDocument === undefined) delete globals.document;
      else globals.document = previousDocument;
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
      if (previousHTMLDivElement === undefined) delete globals.HTMLDivElement;
      else globals.HTMLDivElement = previousHTMLDivElement;
    },
  };
}
