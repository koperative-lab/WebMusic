import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  type SandpackTheme,
} from '@codesandbox/sandpack-react';

// The editor is a light sample canvas in either documentation color mode.
// Weight and neutral ink distinguish syntax without a separate color palette.
const sandboxTheme = {
  colors: {
    surface1: '#ffffff',
    surface2: '#e6e6e6',
    surface3: '#f3f3f3',
    disabled: '#999999',
    base: '#444444',
    clickable: '#666666',
    hover: '#111111',
    accent: '#111111',
    error: '#111111',
    errorSurface: '#eeeeee',
    warning: '#444444',
    warningSurface: '#f3f3f3',
  },
  syntax: {
    plain: '#111111',
    comment: {color: '#666666', fontStyle: 'italic'},
    keyword: {color: '#111111', fontWeight: 'bold'},
    definition: {color: '#111111', fontWeight: 'bold'},
    punctuation: '#666666',
    property: '#444444',
    tag: {color: '#111111', fontWeight: 'bold'},
    static: '#444444',
    string: '#444444',
  },
  font: {
    body: 'var(--wui-font-ui, system-ui, sans-serif)',
    mono: 'var(--wui-font-mono, ui-monospace, monospace)',
    size: '13px',
    lineHeight: '20px',
  },
} satisfies SandpackTheme;

const mounted = new WeakMap<HTMLElement, () => void>();

/**
 * Mount one API editor after the lightweight Astro bootstrap has determined
 * that it is near the viewport. Keeping this module separate is intentional:
 * React and Sandpack stay out of the initial documentation-page payload.
 */
export function mountApiSandbox(el: HTMLElement): () => void {
  const existing = mounted.get(el);
  if (existing) return existing;

  const code = JSON.parse(el.dataset.code ?? '""') as string;
  const height = Number(el.dataset.height) || 340;
  const preview = el.dataset.preview === 'true';
  const dependencies = JSON.parse(el.dataset.deps ?? '{}') as Record<string, string>;

  const children: React.ReactNode[] = [
    React.createElement(SandpackCodeEditor, {
      key: 'editor',
      showLineNumbers: true,
      showTabs: false,
      style: { height },
    }),
  ];
  if (preview) {
    children.push(React.createElement(SandpackPreview, { key: 'preview', style: { height } }));
  }

  // Do not remove the static code sample until all props have been read. If
  // JavaScript or the dynamic module fails to load, the page still has a
  // useful, readable fallback.
  const fallback = Array.from(el.childNodes);
  const root = createRoot(el);
  const dispose = (): void => {
    if (mounted.get(el) !== dispose) return;
    mounted.delete(el);
    root.unmount();
    delete el.dataset.apiSandboxState;
    el.replaceChildren(...fallback);
  };
  mounted.set(el, dispose);
  try {
    root.render(
      React.createElement(
        SandpackProvider,
        {
          template: 'vanilla-ts',
          theme: sandboxTheme,
          customSetup: { dependencies },
          files: { '/index.ts': { code, active: true } },
          options: { visibleFiles: ['/index.ts'] },
        },
        React.createElement(SandpackLayout, {style: {borderRadius: 0}}, children),
      ),
    );
    el.dataset.apiSandboxState = 'initialized';
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
