// @webmusic/bridge/component — components made of objects, as page elements
// and exported code (DEC-078). Uses the UI Kit and the packages' Elements, so
// it needs @webmusic/ui installed; the Bridge's main entry does not.
export {CONTROL_OBJECTS, controlSize, mountObjectControl, type ObjectControl} from './component/controls';
export {
  ComponentSurfaces, KEYS_PLUGIN, METER_PLUGIN, ROLL_PLUGIN, SCOPE_PLUGIN, SPECTRUM_PLUGIN, SURFACE_PLUGINS, SurfaceSlot, isListener, surfaceKindOf,
  type SurfaceKind,
} from './component/surfaces';
export {bindBufferView, bindViewElement, configureViewElement, createViewElement, defineViewElements, fitViewElement, viewWidth, type BufferViewOptions} from './component/views';
export {createComponentPlugins, resolveComponentAsset, type ComponentPluginOptions} from './component/plugins';
export {defineComponentElement, mountComponent, type ComponentHandle, type MountComponentOptions} from './component/mount';
export {
  componentModuleSource, componentPageSource, componentResources, standardPluginIds,
  type ComponentExportOptions, type ComponentPageOptions,
} from './component/export';
