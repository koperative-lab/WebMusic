// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {mountTooltips, tooltipContent, type TooltipHandle} from '../src/controls';

let handles: TooltipHandle[] = [];
afterEach(() => {
  for (const handle of handles) handle.dispose();
  handles = [];
  document.body.replaceChildren();
});

function mount(help?: boolean): TooltipHandle {
  const handle = mountTooltips(document, help === undefined ? {} : {help});
  handles.push(handle);
  return handle;
}

const box = () => document.querySelector<HTMLElement>('[data-wm-tooltip]');
const shownName = () => (box()?.hidden === false ? box()!.querySelector('[data-part="name"]')!.textContent : undefined);
const shownDescription = () => box()!.querySelector<HTMLElement>('[data-part="description"]')!;

function hover(target: Element, x = 20, y = 30): void {
  target.dispatchEvent(new PointerEvent('pointerover', {bubbles: true, composed: true, clientX: x, clientY: y, pointerType: 'mouse'}));
}
function leaveWindow(from: Element): void {
  from.dispatchEvent(new PointerEvent('pointerout', {bubbles: true, composed: true, relatedTarget: null, pointerType: 'mouse'}));
}

function iconButton(label: string, attributes: Record<string, string> = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.setAttribute('aria-label', label);
  for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value);
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>';
  document.body.append(button);
  return button;
}

describe('tooltipContent', () => {
  it('names only what shows no text: icon controls and titled icons, not text, cards or readouts', () => {
    const icon = iconButton('Play');
    expect(tooltipContent(icon)).toEqual({name: 'Play', description: ''});
    const text = document.createElement('button');
    text.setAttribute('aria-label', 'Logic');
    text.textContent = 'Logic';
    expect(tooltipContent(text)).toBeUndefined();
    const link = document.createElement('a');
    link.href = '#';
    link.setAttribute('aria-label', 'GitHub (opens in a new tab)');
    link.textContent = 'GitHub';
    expect(tooltipContent(link)).toBeUndefined();
    const readout = document.createElement('button');
    readout.setAttribute('aria-label', 'Snap: 1/16');
    readout.textContent = '1/16';
    expect(tooltipContent(readout)).toBeUndefined();
    const card = document.createElement('article');
    card.title = 'Plays a score';
    card.textContent = 'score-player';
    expect(tooltipContent(card)).toBeUndefined();
    const glyph = document.createElement('button');
    glyph.setAttribute('aria-label', 'Close');
    glyph.textContent = '×';
    expect(tooltipContent(glyph)?.name).toBe('Close');
    const plain = document.createElement('div');
    plain.setAttribute('aria-label', 'Region');
    expect(tooltipContent(plain)).toBeUndefined();
    plain.title = 'Gain';
    expect(tooltipContent(plain)?.name).toBe('Gain');
  });

  it('adds the description only in help mode, naming even a control that shows its name', () => {
    const tab = document.createElement('button');
    tab.textContent = 'Logic';
    tab.setAttribute('aria-description', 'Build the component');
    expect(tooltipContent(tab)).toBeUndefined();
    expect(tooltipContent(tab, true)).toEqual({name: 'Logic', description: 'Build the component'});
  });
});

describe('mountTooltips', () => {
  it('shows the name at once and stands in for the platform title while hovered', () => {
    mount();
    const button = iconButton('Stop', {title: 'Stop (Space)'});
    hover(button.querySelector('path')!);
    expect(shownName()).toBe('Stop (Space)');
    expect(button.hasAttribute('title')).toBe(false);
    expect(box()!.style.transform).toBe('translate(32px, 48px)');
    leaveWindow(button);
    expect(box()!.hidden).toBe(true);
    expect(button.getAttribute('title')).toBe('Stop (Space)');
  });

  it('keeps the name of a titled control whose title is its only name', async () => {
    mount();
    const button = document.createElement('button');
    button.title = 'Close';
    button.innerHTML = '<svg aria-hidden="true"></svg>';
    document.body.append(button);
    hover(button);
    expect(button.getAttribute('aria-label')).toBe('Close');
    expect(shownName()).toBe('Close');
    leaveWindow(button);
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.title).toBe('Close');
  });

  it('follows a title the element changes while shown, and returns the new one', async () => {
    mount();
    const button = iconButton('Play', {title: 'Play'});
    hover(button);
    button.title = 'Pause';
    await new Promise((resolve) => setTimeout(resolve));
    expect(shownName()).toBe('Pause');
    expect(button.hasAttribute('title')).toBe(false);
    leaveWindow(button);
    expect(button.title).toBe('Pause');
  });

  it('reaches controls inside open shadow roots', () => {
    mount();
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({mode: 'open'});
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Record');
    shadow.append(button);
    hover(button);
    expect(shownName()).toBe('Record');
  });

  it('hides on press until the pointer leaves the control, and ignores touch', () => {
    mount();
    const button = iconButton('Loop');
    hover(button);
    button.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, composed: true}));
    expect(box()!.hidden).toBe(true);
    hover(button);
    expect(box()!.hidden).toBe(true);
    hover(document.body);
    hover(button);
    expect(shownName()).toBe('Loop');
    leaveWindow(button);
    button.dispatchEvent(new PointerEvent('pointerover', {bubbles: true, composed: true, pointerType: 'touch'}));
    expect(box()!.hidden).toBe(true);
  });

  it('shows descriptions in help mode, shared by every handle of the document', () => {
    const first = mount();
    const second = mount();
    const tab = document.createElement('button');
    tab.textContent = 'Debug';
    tab.setAttribute('aria-description', 'Watch the component work');
    document.body.append(tab);
    hover(tab);
    expect(box()!.hidden).toBe(true);
    second.setHelp(true);
    expect(first.help).toBe(true);
    expect(document.documentElement.hasAttribute('data-wm-help')).toBe(true);
    hover(document.body);
    hover(tab);
    expect(shownName()).toBe('Debug');
    expect(shownDescription().textContent).toBe('Watch the component work');
    expect(box()!.hasAttribute('data-help')).toBe(true);
  });

  it('serves a document once and removes everything on the last release', () => {
    const first = mount();
    const second = mount(true);
    expect(document.querySelectorAll('[data-wm-tooltip]')).toHaveLength(1);
    expect(document.querySelectorAll('style[data-webmusic-ui="tooltip"]')).toHaveLength(1);
    first.dispose();
    first.dispose();
    expect(box()).not.toBeNull();
    second.dispose();
    handles = [];
    expect(box()).toBeNull();
    expect(document.querySelector('style[data-webmusic-ui="tooltip"]')).toBeNull();
    expect(document.documentElement.hasAttribute('data-wm-help')).toBe(false);
    const button = iconButton('Play');
    hover(button);
    expect(box()).toBeNull();
  });
});
