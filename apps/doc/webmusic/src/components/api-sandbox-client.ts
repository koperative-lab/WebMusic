import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
} from '@codesandbox/sandpack-react';

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
          theme: 'light',
          customSetup: { dependencies },
          files: { '/index.ts': { code, active: true } },
          options: { visibleFiles: ['/index.ts'] },
        },
        React.createElement(SandpackLayout, null, children),
      ),
    );
    el.dataset.apiSandboxState = 'initialized';
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
