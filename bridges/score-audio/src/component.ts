// @webmusic/bridge/component — components made of objects, as page elements
// and exported code (DEC-078), and the manifests that place the packages'
// Components in a graph (DEC-081) and their own settings there (DEC-085). Uses the UI Kit and the packages' Elements, so
// it needs @webmusic/ui installed; the Bridge's main entry does not.
export {CONTROL_OBJECTS, controlSize, mountObjectControl, type ObjectControl} from './component/controls';
export {
  CLIP_PLUGIN, COMPONENT_PLUGIN_VERSION, KEYS_PLUGIN, LEVEL_PLUGIN, METER_PLUGIN, OFFICIAL_COMPONENTS, ROLL_PLUGIN, SCOPE_PLUGIN, SPECTRUM_PLUGIN,
  componentManifestOf, componentPorts, componentUsage, configOfArguments, findComponentManifest, isListener, migrateBufferViews, parameterValue, projectManifest,
  type ComponentAsset, type ComponentFit, type ComponentManifest, type ComponentParameter, type ComponentPort, type ComponentPortBinding, type ProjectManifest,
} from './component/manifest';
export {
  GRAPH_ATTRIBUTES, componentSettings, isStyleSetting, settableAttributes, withComponentSetting,
  type ComponentSettingKind, type ComponentSettings, styleSource, withStyleSource, type StyleSource,
} from './component/settings';
export {SAVED_SCORE_ENCODING, SAVED_SCORE_FORMAT, canSaveScores, decodeScore, encodeScore} from './component/document';
export {
  THEME_TOKENS, applyComponentStyle, componentTheme, ownStyle, styleDeclarations, styleSettings, withComponentTheme,
  type ThemeToken, type ThemeTokenKind,
} from './component/theme';
export {ComponentSurfaces, SurfaceSlot, type ComponentDocumentState, type SurfaceChannel, type SurfaceEntry} from './component/surfaces';
export {
  bindBufferView, bindComponentElement, componentTarget, configureComponentElement, createComponentElement, defineComponentElements, fitComponentElement, rebindsOnConfig,
  type BufferViewOptions, type ComponentBindOptions,
} from './component/views';
export {createComponentPlugins, resolveComponentAsset, type ComponentPluginOptions} from './component/plugins';
export {componentContents, defineComponentElement, keepComponentSessionPreloaded, mountComponent, type ComponentContent, type ComponentHandle, type MountComponentOptions} from './component/mount';
export {
  componentModuleSource, componentPageSource, componentResources, standardPluginIds,
  type ComponentExportOptions, type ComponentPageOptions,
} from './component/export';
