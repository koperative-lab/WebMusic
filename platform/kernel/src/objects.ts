// @webmusic/kernel/objects — the object library (DEC-075): Max-style message
// objects as project plugins, and the framework to define more.
export {
  OBJECT_INTERFACE, OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, inletId, objectInterfaceOf, objectPlugin, outletId, parseArgs,
  type ObjectBehavior, type ObjectContext, type ObjectDefinition, type ObjectEnvironment, type ObjectInterface, type PortSpec,
} from './objects/core';
export {OBJECT_DEFINITIONS} from './objects/library';
export {PRESET_DEFINITIONS, nodeWeights} from './objects/presets';
export {
  BOUNDARY_DEFINITIONS, COMPONENT_BOUNDARY, COMPONENT_PLUGIN, componentPlugin, createComponentPlugins,
  type BoundaryInlet, type BoundaryKind, type BoundaryOutlet, type ComponentBoundary,
} from './objects/component';
export {compileExpr, type CompiledExpr, type ExprValue} from './objects/expr';

import {objectPlugin, type ObjectDefinition, type ObjectEnvironment} from './objects/core';
import {OBJECT_DEFINITIONS as LIBRARY} from './objects/library';
import {PRESET_DEFINITIONS as PRESETS} from './objects/presets';
import {createComponentPlugins as componentPlugins} from './objects/component';
import type {ProjectPluginFactory} from './module/project-types';

/** Every message-object definition: the library, then presets and nodes. */
export const ALL_OBJECT_DEFINITIONS: readonly ObjectDefinition[] = Object.freeze([...LIBRARY, ...PRESETS]);

/**
 * Project plugins for every object, sharing one environment: the library,
 * `preset` and `nodes`, and the nested `component` with its `inlet`,
 * `outlet`, `inlet~` and `outlet~`.
 */
export function createObjectPlugins(environment: ObjectEnvironment = {}): readonly ProjectPluginFactory[] {
  return Object.freeze([...ALL_OBJECT_DEFINITIONS.map(definition => objectPlugin(definition, environment)), ...componentPlugins(environment)]);
}

/** The object names, in palette order (boundary objects and `component` last). */
export const OBJECT_NAMES: readonly string[] = Object.freeze([...ALL_OBJECT_DEFINITIONS.map(definition => definition.name), 'component', 'inlet', 'outlet', 'inlet~', 'outlet~']);
