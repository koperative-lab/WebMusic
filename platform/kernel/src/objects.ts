// @webmusic/kernel/objects — the object library (DEC-075): Max-style message
// objects as project plugins, and the framework to define more.
export {
  OBJECT_INTERFACE, OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, inletId, objectInterfaceOf, objectPlugin, outletId, parseArgs,
  type ObjectBehavior, type ObjectContext, type ObjectDefinition, type ObjectEnvironment, type ObjectInterface, type PortSpec,
} from './objects/core';
export {OBJECT_DEFINITIONS} from './objects/library';
export {compileExpr, type CompiledExpr, type ExprValue} from './objects/expr';

import {objectPlugin, type ObjectEnvironment} from './objects/core';
import {OBJECT_DEFINITIONS} from './objects/library';
import type {ProjectPluginFactory} from './module/project-types';

/** Project plugins for every object in the library, sharing one environment. */
export function createObjectPlugins(environment: ObjectEnvironment = {}): readonly ProjectPluginFactory[] {
  return Object.freeze(OBJECT_DEFINITIONS.map(definition => objectPlugin(definition, environment)));
}

/** The library's object names, in palette order. */
export const OBJECT_NAMES: readonly string[] = Object.freeze(OBJECT_DEFINITIONS.map(definition => definition.name));
