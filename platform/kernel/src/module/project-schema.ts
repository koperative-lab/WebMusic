import type {
  ModuleProject, ProjectAssetReference, ProjectAutomationRecord, ProjectConnectionRecord,
  ProjectContextRecord, ProjectJson, ProjectJsonObject, ProjectLayout, ProjectMacroRecord,
  ProjectModulationRecord, ProjectModuleRecord, ProjectParamEndpoint, ProjectSessionState,
} from './project-types';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 50000;
const MAX_ITEMS = 10000;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** Copy only bounded plain JSON data. Accessors are rejected without invoking them. */
export function copyProjectJson(input: unknown): ProjectJson {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const copy = (value: unknown, depth: number): ProjectJson => {
    if (++nodes > MAX_NODES || depth > 32) throw new RangeError('Project JSON exceeds structural limits.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      bytes += value.length * 2;
      if (value.length > 65536 || bytes > MAX_BYTES) throw new RangeError('Project JSON exceeds string limits.');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Project numbers must be finite.');
      return value;
    }
    if (typeof value !== 'object') throw new TypeError('Project values must be plain JSON data.');
    if (ancestors.has(value)) throw new TypeError('Project JSON cannot contain object cycles.');
    const prototype = Object.getPrototypeOf(value);
    const array = Array.isArray(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError('Project objects must have plain prototypes.');
    if (array && value.length > MAX_ITEMS) throw new RangeError('Project array exceeds item limit.');
    ancestors.add(value);
    try {
      const output: Record<string, ProjectJson> | ProjectJson[] = array ? [] : {};
      const keys = Reflect.ownKeys(value);
      if (keys.length > MAX_ITEMS + 1) throw new RangeError('Project object exceeds item limit.');
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string' || forbiddenKeys.has(key)) throw new TypeError('Project JSON contains an unsafe property key.');
        if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw new TypeError('Project arrays must contain only indexed values.');
        bytes += key.length * 2;
        if (bytes > MAX_BYTES) throw new RangeError('Project JSON exceeds size limit.');
        const property = Object.getOwnPropertyDescriptor(value, key)!;
        if (!property.enumerable || !('value' in property)) throw new TypeError('Project JSON must not contain accessors or hidden properties.');
        (output as Record<string, ProjectJson>)[key] = copy(property.value, depth + 1);
      }
      if (array && (output as ProjectJson[]).length !== value.length) throw new TypeError('Project arrays must not contain holes.');
      if (array && Object.keys(output).length !== value.length) throw new TypeError('Project arrays must not contain holes.');
      return Object.freeze(output);
    } finally { ancestors.delete(value); }
  };
  return copy(input, 0);
}

type Data = Record<string, unknown>;
function object(value: unknown, path: string): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object.`);
  return value as Data;
}
function fields(data: Data, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(data)) if (!allowed.includes(key)) throw new TypeError(`${path}.${key} is not a supported field.`);
}
function text(value: unknown, path: string, max = 256): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) throw new TypeError(`${path} must be a nonempty trimmed string of at most ${max} characters.`);
  return value;
}
function number(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`${path} must be a finite number in range.`);
  return value;
}
function list(value: unknown, path: string): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}
function enumeration<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (!choices.includes(value as T)) throw new TypeError(`${path} has an unsupported value.`);
  return value as T;
}
function optionalText(data: Data, key: string, path: string): string | undefined {
  return data[key] === undefined ? undefined : text(data[key], `${path}.${key}`, key === 'label' ? 1024 : 256);
}
function unique<T extends {readonly id: string}>(items: readonly T[], path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new TypeError(`${path} contains duplicate ID ${item.id}.`);
    result.set(item.id, item);
  }
  return result;
}
function endpoint(value: unknown, path: string): {moduleId: string; port: string} {
  const data = object(value, path);
  fields(data, ['moduleId', 'port'], path);
  return {moduleId: text(data.moduleId, `${path}.moduleId`), port: text(data.port, `${path}.port`)};
}
function parameter(value: unknown, path: string): ProjectParamEndpoint {
  const data = object(value, path);
  fields(data, ['moduleId', 'param'], path);
  return {moduleId: text(data.moduleId, `${path}.moduleId`), param: text(data.param, `${path}.param`)};
}
function layout(value: unknown): ProjectLayout {
  const data = object(value ?? {}, 'layout');
  fields(data, ['modules'], 'layout');
  const seen = new Set<string>();
  return {modules: list(data.modules, 'layout.modules').map((entry, index) => {
    const path = `layout.modules[${index}]`, item = object(entry, path);
    fields(item, ['moduleId', 'x', 'y', 'collapsed'], path);
    const moduleId = text(item.moduleId, `${path}.moduleId`);
    if (seen.has(moduleId)) throw new TypeError(`Duplicate layout module ${moduleId}.`);
    seen.add(moduleId);
    if (item.collapsed !== undefined && typeof item.collapsed !== 'boolean') throw new TypeError(`${path}.collapsed must be boolean.`);
    return {moduleId, x: number(item.x, `${path}.x`, -1e7, 1e7), y: number(item.y, `${path}.y`, -1e7, 1e7),
      ...(item.collapsed !== undefined ? {collapsed: item.collapsed as boolean} : {})};
  })};
}
function session(value: unknown): ProjectSessionState {
  const data = object(value ?? {}, 'session');
  fields(data, ['positionSeconds', 'rate', 'loop'], 'session');
  let loop: ProjectSessionState['loop'];
  if (data.loop === null) loop = null;
  else if (data.loop !== undefined) {
    const region = object(data.loop, 'session.loop');
    fields(region, ['startSeconds', 'endSeconds'], 'session.loop');
    const startSeconds = number(region.startSeconds, 'session.loop.startSeconds', 0);
    const endSeconds = number(region.endSeconds, 'session.loop.endSeconds', 0);
    if (endSeconds <= startSeconds) throw new TypeError('Session loop end must follow start.');
    loop = {startSeconds, endSeconds};
  }
  return {positionSeconds: number(data.positionSeconds ?? 0, 'session.positionSeconds', 0),
    rate: number(data.rate ?? 1, 'session.rate', Number.MIN_VALUE), ...(loop !== undefined ? {loop} : {})};
}

/** Validate schema/version, exact references and topology before creating any runtime resources. */
export function parseModuleProject(input: unknown): ModuleProject {
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES) throw new RangeError('Project JSON text exceeds size limit.');
    input = JSON.parse(input) as unknown;
  }
  const data = object(copyProjectJson(input), 'project');
  fields(data, ['schema', 'version', 'id', 'contexts', 'modules', 'assets', 'connections', 'modulations', 'macros', 'automation', 'session', 'layout'], 'project');
  if (data.schema !== 'webmusic.module-project' || data.version !== 1) throw new TypeError('Unsupported module project schema/version.');
  const contexts: ProjectContextRecord[] = list(data.contexts, 'contexts').map((entry, index) => {
    const path = `contexts[${index}]`, item = object(entry, path);
    fields(item, ['id', 'parentId', 'ownerModuleId'], path);
    const parentId = optionalText(item, 'parentId', path), ownerModuleId = optionalText(item, 'ownerModuleId', path);
    return {id: text(item.id, `${path}.id`), ...(parentId ? {parentId} : {}), ...(ownerModuleId ? {ownerModuleId} : {})};
  });
  const assets: ProjectAssetReference[] = list(data.assets, 'assets').map((entry, index) => {
    const path = `assets[${index}]`, item = object(entry, path);
    fields(item, ['id', 'uri', 'mediaType', 'integrity'], path);
    const mediaType = optionalText(item, 'mediaType', path), integrity = optionalText(item, 'integrity', path);
    return {id: text(item.id, `${path}.id`), uri: text(item.uri, `${path}.uri`, 8192), ...(mediaType ? {mediaType} : {}), ...(integrity ? {integrity} : {})};
  });
  const modules: ProjectModuleRecord[] = list(data.modules, 'modules').map((entry, index) => {
    const path = `modules[${index}]`, item = object(entry, path);
    fields(item, ['id', 'plugin', 'contextId', 'label', 'config', 'assets', 'params'], path);
    const plugin = object(item.plugin, `${path}.plugin`);
    fields(plugin, ['id', 'version'], `${path}.plugin`);
    const label = optionalText(item, 'label', path);
    const config = object(item.config ?? {}, `${path}.config`) as ProjectJsonObject;
    let roles: Record<string, string> | undefined, params: Record<string, number> | undefined;
    if (item.assets !== undefined) {
      roles = {};
      for (const [role, value] of Object.entries(object(item.assets, `${path}.assets`))) roles[text(role, `${path}.asset role`)] = text(value, `${path}.assets.${role}`);
    }
    if (item.params !== undefined) {
      params = {};
      for (const [id, value] of Object.entries(object(item.params, `${path}.params`))) params[text(id, `${path}.parameter ID`)] = number(value, `${path}.params.${id}`);
    }
    return {id: text(item.id, `${path}.id`), contextId: text(item.contextId, `${path}.contextId`),
      plugin: {id: text(plugin.id, `${path}.plugin.id`), version: text(plugin.version, `${path}.plugin.version`)}, config,
      ...(label ? {label} : {}), ...(roles ? {assets: roles} : {}), ...(params ? {params} : {})};
  });
  const connections: ProjectConnectionRecord[] = list(data.connections, 'connections').map((entry, index) => {
    const path = `connections[${index}]`, item = object(entry, path);
    fields(item, ['id', 'kind', 'from', 'to', 'mode'], path);
    const kind = enumeration(item.kind, ['audio', 'control', 'note', 'transport', 'source'], `${path}.kind`);
    const mode = item.mode === undefined ? undefined : enumeration(item.mode, ['replace', 'send', 'tap'], `${path}.mode`);
    if (kind !== 'audio' && mode !== undefined) throw new TypeError('Only audio connections have routing modes.');
    return {id: text(item.id, `${path}.id`), kind, from: endpoint(item.from, `${path}.from`), to: endpoint(item.to, `${path}.to`), ...(mode ? {mode} : {})};
  });
  const modulations: ProjectModulationRecord[] = list(data.modulations, 'modulations').map((entry, index) => {
    const path = `modulations[${index}]`, item = object(entry, path);
    fields(item, ['id', 'source', 'target', 'depth', 'polarity'], path);
    const polarity = item.polarity === undefined ? undefined : enumeration(item.polarity, ['bipolar', 'unipolar'], `${path}.polarity`);
    return {id: text(item.id, `${path}.id`), source: endpoint(item.source, `${path}.source`), target: parameter(item.target, `${path}.target`), depth: number(item.depth, `${path}.depth`), ...(polarity ? {polarity} : {})};
  });
  const macros: ProjectMacroRecord[] = list(data.macros, 'macros').map((entry, index) => {
    const path = `macros[${index}]`, item = object(entry, path);
    fields(item, ['id', 'label', 'value', 'targets'], path);
    const label = optionalText(item, 'label', path);
    const targets = list(item.targets, `${path}.targets`).map((target, targetIndex) => {
      const place = `${path}.targets[${targetIndex}]`, targetData = object(target, place);
      fields(targetData, ['moduleId', 'param', 'min', 'max'], place);
      return {...parameter({moduleId: targetData.moduleId, param: targetData.param}, place), min: number(targetData.min, `${place}.min`), max: number(targetData.max, `${place}.max`)};
    });
    return {id: text(item.id, `${path}.id`), value: number(item.value, `${path}.value`, 0, 1), targets, ...(label ? {label} : {})};
  });
  const automation: ProjectAutomationRecord[] = list(data.automation, 'automation').map((entry, index) => {
    const path = `automation[${index}]`, item = object(entry, path);
    fields(item, ['id', 'target', 'points', 'loop', 'enabled', 'initialValue'], path);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new TypeError(`${path}.enabled must be boolean.`);
    let previous = -Infinity;
    const points = list(item.points, `${path}.points`).map((point, pointIndex) => {
      const place = `${path}.points[${pointIndex}]`, event = object(point, place);
      fields(event, ['type', 'value', 'timeSeconds'], place);
      const type = enumeration(event.type, ['set', 'linear', 'exponential'], `${place}.type`);
      const timeSeconds = number(event.timeSeconds, `${place}.timeSeconds`, 0), value = number(event.value, `${place}.value`);
      if (timeSeconds < previous) throw new TypeError('Automation points must be ordered by time.');
      if (type === 'exponential' && value <= 0) throw new TypeError('Exponential automation requires positive values.');
      previous = timeSeconds;
      return {type, value, timeSeconds};
    });
    const loop = item.loop === undefined ? undefined : enumeration(item.loop, ['repeat', 'once'], `${path}.loop`);
    return {id: text(item.id, `${path}.id`), target: parameter(item.target, `${path}.target`), points, ...(loop ? {loop} : {}), ...(item.enabled !== undefined ? {enabled: item.enabled as boolean} : {}), ...(item.initialValue !== undefined ? {initialValue: number(item.initialValue, `${path}.initialValue`)} : {})};
  });
  const project: ModuleProject = {schema: 'webmusic.module-project', version: 1, id: text(data.id, 'project.id'), contexts, modules, assets, connections, modulations, macros, automation, session: session(data.session), layout: layout(data.layout)};
  validateReferences(project);
  return copyProjectJson(project) as unknown as ModuleProject;
}

function validateReferences(project: ModuleProject): void {
  const contexts = unique(project.contexts, 'contexts'), modules = unique(project.modules, 'modules'), assets = unique(project.assets, 'assets');
  for (const [name, entries] of [['connections', project.connections], ['modulations', project.modulations], ['macros', project.macros], ['automation', project.automation]] as const) unique<{readonly id: string}>(entries, name);
  if (project.contexts.filter(context => !context.parentId).length !== 1) throw new TypeError('A project requires exactly one root context.');
  for (const context of project.contexts) {
    const visited = new Set<string>();
    let current: ProjectContextRecord | undefined = context;
    while (current) {
      if (visited.has(current.id)) throw new TypeError('Project context topology contains a cycle.');
      visited.add(current.id);
      if (visited.size > 128) throw new RangeError('Project context nesting exceeds 128 scopes.');
      if (current.parentId && !contexts.has(current.parentId)) throw new TypeError(`Missing parent context ${current.parentId}.`);
      current = current.parentId ? contexts.get(current.parentId) : undefined;
    }
    if (context.ownerModuleId) {
      const owner = modules.get(context.ownerModuleId);
      if (!context.parentId || !owner || owner.contextId !== context.parentId) throw new TypeError('A context owner must belong to its direct parent context.');
    }
  }
  const requireModule = (id: string): void => { if (!modules.has(id)) throw new TypeError(`Project references missing module ${id}.`); };
  for (const module of project.modules) {
    if (!contexts.has(module.contextId)) throw new TypeError(`Module ${module.id} references missing context ${module.contextId}.`);
    for (const id of Object.values(module.assets ?? {})) if (!assets.has(id)) throw new TypeError(`Module ${module.id} references missing asset ${id}.`);
  }
  const routes = new Map<string, Set<string>>();
  const replacements = new Set<string>();
  for (const connection of project.connections) {
    requireModule(connection.from.moduleId); requireModule(connection.to.moduleId);
    if (connection.kind === 'audio') {
      const next = routes.get(connection.from.moduleId) ?? new Set<string>();
      next.add(connection.to.moduleId); routes.set(connection.from.moduleId, next);
      if ((connection.mode ?? 'replace') === 'replace') {
        const key = JSON.stringify(connection.from);
        if (replacements.has(key)) throw new TypeError('An audio output can have only one replacement connection.');
        replacements.add(key);
      }
    }
  }
  const degrees = new Map<string, number>();
  for (const [source, targets] of routes) {
    if (!degrees.has(source)) degrees.set(source, 0);
    for (const target of targets) degrees.set(target, (degrees.get(target) ?? 0) + 1);
  }
  const ready = [...degrees.keys()].filter(id => degrees.get(id) === 0);
  let consumed = 0;
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]!; consumed++;
    for (const target of routes.get(id) ?? []) {
      const remaining = degrees.get(target)! - 1;
      degrees.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  if (consumed !== degrees.size) throw new TypeError('Project audio connections contain a feedback cycle.');
  for (const modulation of project.modulations) { requireModule(modulation.source.moduleId); requireModule(modulation.target.moduleId); }
  for (const macro of project.macros) {
    const targets = new Set<string>();
    for (const target of macro.targets) {
      requireModule(target.moduleId);
      const key = JSON.stringify([target.moduleId, target.param]);
      if (targets.has(key)) throw new TypeError('A macro cannot map one target twice.');
      targets.add(key);
    }
  }
  const automated = new Set<string>();
  for (const automation of project.automation) {
    requireModule(automation.target.moduleId);
    const key = JSON.stringify(automation.target);
    if (automated.has(key)) throw new TypeError('A parameter can have only one project automation track.');
    automated.add(key);
  }
  for (const position of project.layout.modules) requireModule(position.moduleId);
}

/** Canonical validated data only; no runtime objects are visited or serialized. */
export function serializeModuleProject(project: unknown, space?: number): string {
  const text = JSON.stringify(parseModuleProject(project), null, space);
  // Escaping and indentation can exceed the input text budget even when the
  // structured values fit. Never return a save file this parser cannot reopen.
  if (text.length > MAX_BYTES) throw new RangeError('Project JSON text exceeds size limit.');
  return text;
}
