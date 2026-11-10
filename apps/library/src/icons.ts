// Inline icons in the WebMusic language: 24-unit view box drawn at 16px,
// currentColor stroke 1.5, no fill, square caps and mitred joins.
const PATHS = {
  search: '<path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm4.6 11.1L20 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  copy: '<path d="M9 9h10v10H9zM5 15V5h10"/>',
  app: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  docs: '<path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4"/>',
  reload: '<path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"/>',
  link: '<path d="M10 14l4-4M8.5 11.5l-2 2a3 3 0 0 0 4.24 4.24l2-2M15.5 12.5l2-2a3 3 0 0 0-4.24-4.24l-2 2"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}
