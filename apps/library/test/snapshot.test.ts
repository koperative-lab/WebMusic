import {describe, expect, it} from 'vitest';
import {snapshot, styleText} from '../src/snapshot.ts';

const declaration = (values: Record<string, string>) => {
  const style = document.createElement('div').style;
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
  return style;
};

describe('picture styles', () => {
  it('writes what differs from the default, and inherited values only where they change', () => {
    const computed = declaration({display: 'flex', color: 'rgb(17, 17, 17)', 'font-size': '12px', 'transition-duration': '1s', width: '200px'});
    const parent = declaration({color: 'rgb(17, 17, 17)', 'font-size': '15px'});
    const defaults = declaration({display: 'block', width: '200px'});
    const text = styleText(computed, parent, defaults);
    expect(text).toContain('display:flex');
    expect(text).toContain('font-size:12px');
    // Same as inherited, same as default, or behaviour rather than look: left out.
    expect(text).not.toContain('color:');
    expect(text).not.toContain('width:');
    expect(text).not.toContain('transition');
  });
});

describe('pictures', () => {
  it('flattens shadow roots, fills slots and leaves out styles and scripts', () => {
    const host = document.createElement('demo-card');
    host.innerHTML = '<span class="slotted">Arabesque</span><script>alert(1)</script>';
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = '<style>.inner{color:red}</style><div class="inner"><slot></slot><b>No. 1</b></div><canvas width="4" height="4"></canvas>';
    document.body.append(host);
    const picture = snapshot(host, () => undefined);
    host.remove();
    expect(picture.svg.startsWith('<svg')).toBe(true);
    expect(picture.svg).toContain('<foreignObject');
    expect(picture.svg).toContain('<demo-card');
    // The slot is replaced by what was assigned to it, inside the shadow content.
    expect(picture.svg).toMatch(/class="inner"[^>]*>\s*<span[^>]*class="slotted"[^>]*>Arabesque<\/span>\s*<b[^>]*>No\. 1<\/b>/);
    expect(picture.svg).not.toContain('<slot');
    expect(picture.svg).not.toContain('<style');
    expect(picture.svg).not.toContain('alert(1)');
    // A canvas becomes an image of what it drew.
    expect(picture.svg).toContain('<img');
    expect(picture.svg).not.toContain('<canvas');
    expect(picture.width).toBeGreaterThanOrEqual(1);
    expect(picture.height).toBeGreaterThanOrEqual(1);
  });

  it('keeps SVG content in its own namespace', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
    document.body.append(host);
    const picture = snapshot(host, () => undefined);
    host.remove();
    const parsed = new DOMParser().parseFromString(picture.svg, 'image/svg+xml');
    const path = parsed.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'path')[0];
    expect(path?.getAttribute('d')).toBe('M0 0L10 10');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
  });
});

describe('culling', () => {
  it('leaves out what lies wholly outside the picture', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="near">seen</div><div class="far">unseen</div><svg><g class="far-svg"><path d="M0 0"/></g></svg>';
    document.body.append(host);
    // jsdom has no layout: give the boxes positions by hand.
    const box = (left: number, top: number, width: number, height: number) => () => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({})}) as DOMRect;
    host.getBoundingClientRect = box(0, 0, 100, 50);
    host.querySelector<HTMLElement>('.near')!.getBoundingClientRect = box(0, 0, 100, 20);
    host.querySelector<HTMLElement>('.far')!.getBoundingClientRect = box(5000, 0, 100, 20);
    host.querySelector('.far-svg')!.getBoundingClientRect = box(9000, 0, 10, 10);
    const picture = snapshot(host, () => undefined);
    host.remove();
    expect(picture.svg).toContain('seen');
    // The far box stays, so layout does not shift, but its text does not.
    expect(picture.svg).toContain('class="far"');
    expect(picture.svg).not.toContain('unseen');
    expect(picture.svg).not.toContain('far-svg');
  });
});
