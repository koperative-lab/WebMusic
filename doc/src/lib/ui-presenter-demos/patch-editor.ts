import {
  mountPatchEditor,
  type PatchEditorBinding,
  type PatchEditorOptions,
  type PatchEditorState,
} from '@webmusic/ui/patch-editor';
import type {UiPresenterDemoHandle} from './types';

/** This reference page illustrates the UI contract with caller-owned static data. */
export function mountPatchEditorDemo(host: HTMLElement): UiPresenterDemoHandle {
  const initial = (): PatchEditorState => ({
    modules: [
      {id: 'source', label: 'Source', position: {x: 24, y: 24}, ports: [{id: 'output', direction: 'output', kind: 'audio'}]},
      {id: 'effect', label: 'Effect', position: {x: 312, y: 24}, ports: [{id: 'input', direction: 'input', kind: 'audio'}, {id: 'output', direction: 'output', kind: 'audio'}]},
      {id: 'meter', label: 'Meter', position: {x: 600, y: 24}, ports: [{id: 'input', direction: 'input', kind: 'audio'}]},
      {id: 'plugin', label: 'Missing plugin', position: {x: 312, y: 236}, status: 'unresolved', ports: [], diagnostic: 'The saved plugin is unavailable. Its identity and wiring remain in the project.'},
    ],
    connections: [
      {id: 'default', from: {moduleId: 'source', port: 'output'}, to: {moduleId: 'effect', port: 'input'}, mode: 'default'},
      {id: 'saved', from: {moduleId: 'effect', port: 'output'}, to: {moduleId: 'plugin', port: 'input'}, mode: 'send', status: 'unresolved', diagnostic: 'The destination plugin must be restored before this connection can run.'},
    ],
  });
  let state = initial();
  let sequence = 0;
  let destroyed = false;
  let options: PatchEditorOptions = {};
  const listeners = new Set<() => void>();
  const notify = (): void => {for (const listener of [...listeners]) listener();};
  const subscribe = (listener: () => void): (() => void) => {listeners.add(listener); return () => listeners.delete(listener);};
  const binding: PatchEditorBinding = {
    snapshot: () => state,
    subscribe,
    connect(request) {
      state = {...state, connections: [...state.connections, {...request, id: `patch-${++sequence}`} ]};
      notify();
    },
    disconnect(id) {
      state = {...state, connections: state.connections.filter((connection) => connection.id !== id)};
      notify();
    },
    moveModule(id, position) {
      state = {...state, modules: state.modules.map((module) => module.id === id ? {...module, position} : module)};
      notify();
    },
  };
  let presenter = mountPatchEditor(host, binding, options);
  const remount = (): void => {presenter = mountPatchEditor(host, binding, options);};
  return {
    setOption(name, value) {
      if (destroyed) return;
      if (name === 'label') options = {...options, label: typeof value === 'string' ? value : undefined};
      else if (name === 'stylesheet') options = {...options, stylesheet: typeof value === 'boolean' ? value : undefined};
      else return;
      remount();
    },
    reset() {
      if (destroyed) return;
      options = {}; state = initial(); sequence = 0; remount(); notify();
    },
    snapshot: () => ({modules: state.modules.length, connections: state.connections.length}),
    subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true; presenter.destroy(); listeners.clear();
    },
  };
}
