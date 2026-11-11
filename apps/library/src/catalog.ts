// The library's entries. Everything except the functional category, search
// synonyms and composition recipe comes from the documentation catalogs that
// also generate dev/COMPONENTS.md: the element inventory, the parameter
// catalog and each owning page's first sentence.
import summaries from 'virtual:webmusic-library/summaries';
import {UI_COMPOSITION_CATALOG, type UiCompositionEntry} from '../../doc/shared/ui-catalog.ts';
import {ELEMENT_PARAMS, type ElementParamSpec} from '../../doc/webmusic/src/lib/params/index.ts';
import {CATEGORIES, RECIPES, type Category, type CategoryId, type Recipe} from './recipes.ts';

export interface LibraryEntry {
  readonly tag: string;
  readonly family: UiCompositionEntry['family'];
  readonly capability: UiCompositionEntry['capability'];
  readonly category: Category;
  readonly summary: string;
  /** Behaviour the element composes, as the inventory names it. */
  readonly headless: string;
  /** Presenters it draws with, as the inventory names them. */
  readonly ui: string;
  /** Renders nothing itself: a declaration or insert. */
  readonly nonvisual: boolean;
  /** Public import entry, such as `@webmusic/score/play/element`. */
  readonly entry: string;
  /** Documentation route of the owning page. */
  readonly href: string;
  readonly spec: ElementParamSpec;
  readonly recipe: Recipe;
  /** Values of the element's `type` attribute, each a card of its own on the home page; empty when it has none. */
  readonly types: readonly string[];
}

const CATEGORY = new Map(CATEGORIES.map((category) => [category.id, category]));
const RECIPE = new Map(RECIPES.map((recipe) => [recipe.tag, recipe]));

function entryFor(item: UiCompositionEntry): LibraryEntry {
  const recipe = RECIPE.get(item.tag);
  const spec = ELEMENT_PARAMS[item.tag];
  const summary = summaries[item.tag];
  if (!recipe) throw new Error(`<${item.tag}> has no library recipe in apps/library/src/recipes.ts`);
  if (!spec) throw new Error(`<${item.tag}> has no parameter catalog entry`);
  if (!summary) throw new Error(`<${item.tag}> has no documentation summary`);
  return {
    tag: item.tag,
    family: item.family,
    capability: item.capability,
    category: CATEGORY.get(recipe.category)!,
    summary,
    headless: item.headless,
    ui: item.ui,
    nonvisual: item.status === 'behavior',
    entry: spec.entry,
    href: item.href,
    spec,
    recipe,
    types: spec.params.find((param) => param.name === 'type' && param.kind === 'enum')?.options ?? [],
  };
}

/** Every public element, in functional category order, then recipe order. */
export const LIBRARY: readonly LibraryEntry[] = UI_COMPOSITION_CATALOG.map(entryFor).sort((a, b) =>
  CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)
  || RECIPES.indexOf(a.recipe) - RECIPES.indexOf(b.recipe));

export function byTag(tag: string): LibraryEntry | undefined {
  return LIBRARY.find((entry) => entry.tag === tag);
}

export function inCategory(id: CategoryId, entries: readonly LibraryEntry[] = LIBRARY): LibraryEntry[] {
  return entries.filter((entry) => entry.category.id === id);
}
