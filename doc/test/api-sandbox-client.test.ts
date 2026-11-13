// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ReactElement} from 'react';

const {createRoot, render, unmount} = vi.hoisted(() => {
  const render = vi.fn();
  const unmount = vi.fn();
  return {createRoot: vi.fn(() => ({render, unmount})), render, unmount};
});
vi.mock('react-dom/client', () => ({createRoot}));
vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackCodeEditor: 'code-editor',
  SandpackLayout: 'sandbox-layout',
  SandpackPreview: 'sandbox-preview',
  SandpackProvider: 'sandbox-provider',
}));

import {mountApiSandbox} from '../src/components/api-sandbox-client';

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('API sandbox React ownership', () => {
  it('retains one React root, unmounts once and restores the readable fallback', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre>original code</pre>';
    document.body.append(root);
    const cleanup = mountApiSandbox(root);
    expect(mountApiSandbox(root)).toBe(cleanup);
    expect(createRoot).toHaveBeenCalledOnce();
    expect(root.dataset.apiSandboxState).toBe('initialized');
    cleanup();
    cleanup();
    expect(unmount).toHaveBeenCalledOnce();
    expect(root.querySelector('pre')?.textContent).toBe('original code');
    expect(root.dataset.apiSandboxState).toBeUndefined();
    const remountCleanup = mountApiSandbox(root);
    expect(createRoot).toHaveBeenCalledTimes(2);
    remountCleanup();
  });

  it('keeps the live preview opt-in when creating the editor tree', () => {
    const root = document.createElement('div');
    const cleanup = mountApiSandbox(root);
    const tree = render.mock.calls[0][0] as ReactElement<{children: ReactElement<{children: ReactElement[]}>}>;
    expect(tree.props.children.props.children.map((child) => child.type)).toEqual(['code-editor']);
    cleanup();
    root.dataset.preview = 'true';
    const cleanupPreview = mountApiSandbox(root);
    const previewTree = render.mock.calls[1][0] as typeof tree;
    expect(previewTree.props.children.props.children.map((child) => child.type)).toEqual(['code-editor', 'sandbox-preview']);
    cleanupPreview();
  });
});
