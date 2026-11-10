// Search over the library: every whitespace-separated term must match one of
// an entry's fields. Matches in the tag rank first, then the category and
// synonyms, then the summary and member names.
import type {LibraryEntry} from './catalog.ts';

export type Family = 'all' | 'Score' | 'Audio';

const normalize = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

interface Field { readonly text: string; readonly weight: number }

function fields(entry: LibraryEntry): Field[] {
  const members = [
    ...entry.spec.params.map((param) => param.name),
    ...(entry.spec.properties ?? []).map((member) => member.name),
    ...(entry.spec.events ?? []).map((member) => member.name),
  ];
  return [
    {text: entry.tag, weight: 8},
    {text: `${entry.category.label} ${entry.recipe.keywords.join(' ')}`, weight: 4},
    {text: `${entry.family} ${entry.capability} ${entry.entry}`, weight: 3},
    {text: entry.summary, weight: 2},
    {text: `${members.join(' ')} ${entry.headless} ${entry.ui}`, weight: 1},
  ].map((field) => ({...field, text: normalize(field.text)}));
}

/** Score an entry against a query; 0 means no match. */
export function score(entry: LibraryEntry, query: string): number {
  const terms = normalize(query).split(/\s+/).map((term) => term.replace(/^<|>$/g, '')).filter(Boolean);
  if (!terms.length) return 1;
  const all = fields(entry);
  let total = 0;
  for (const term of terms) {
    const best = Math.max(0, ...all.filter((field) => field.text.includes(term)).map((field) => field.weight));
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** Entries matching the query and family, best first; ties keep catalog order. */
export function search(entries: readonly LibraryEntry[], query: string, family: Family = 'all'): LibraryEntry[] {
  return entries
    .filter((entry) => family === 'all' || entry.family === family)
    .map((entry, index) => ({entry, index, score: score(entry, query)}))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((hit) => hit.entry);
}
