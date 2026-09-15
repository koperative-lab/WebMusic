/**
 * The option list for a playground control, and the label of the one that
 * means "the attribute is not set".
 *
 * Two rounds of this got it wrong in opposite directions, and both mistakes are
 * worth keeping written down.
 *
 * FIRST, the label was the spec's whole `fallback` sentence behind an em dash,
 * so a closed select read `— hidden — volume is settable but has no control`
 * and truncated before it said anything. The label has to be the NAME of what
 * you get by default.
 *
 * SECOND, that name was a paraphrase — `hidden` where the two real options were
 * `on` and `off`. The reader is choosing between values, so the default has to
 * be spelled in the same vocabulary, and the specs now lead with the value.
 *
 * Which makes the separate "unset" entry redundant wherever the default IS one
 * of the values: three options where two will do, two of them reading `off`,
 * and a native select's type-ahead landing on whichever came first. So the
 * default is MERGED into the option that carries it — a boolean offers `on`
 * and `off`, nothing else, with the default one already selected. Choosing it
 * removes the attribute, which is exactly what the default means; the markup
 * readout below the panel is what shows the difference.
 *
 * A default that is NOT one of the values still needs its own entry: `format`
 * has no default format, the loader derives one, so `adaptive` sits ahead of
 * `midi`, `mxl`, `musicxml`, `abc` as a real fourth choice.
 */

/** A fallback that names its default before explaining it. */
const NAMED = /^(.+?)\s+[—–-]\s+\S/;

/** Beyond this the fallback is prose, and prose does not fit in an option. */
const PROSE_WORDS = 5;

/**
 * The bare name of the default: the words before the em dash, the whole string
 * when it is already short, or `default` when it is a sentence with no name in
 * it. `no handler`, `full duration` and `built-in glyphs` are already the short
 * answer and are left alone — flattening those to `default` would trade a fact
 * for a placeholder.
 */
export function defaultOptionLabel(fallback: string | undefined): string {
  const text = fallback?.trim();
  if (!text) return 'default';
  const named = NAMED.exec(text);
  if (named) return named[1].trim();
  return text.split(/\s+/).length >= PROSE_WORDS ? 'default' : text;
}

export interface DefaultChoice {
  /** Submitted value. The default's is the caller's "not set" sentinel. */
  value: string;
  label: string;
  /** Whether this is what the control shows before anyone touches it. */
  selected: boolean;
}

/**
 * Build a select's options with the default folded in.
 *
 * @param fallback What the element does when the attribute is absent.
 * @param options The real values, in source order — `['on', 'off']` for a
 *   boolean.
 * @param unsetValue The sentinel this playground's client reads as "remove the
 *   attribute": `'unset'`, `''` or `'__unset__'` depending on the surface.
 */
export function defaultChoices(
  fallback: string | undefined,
  options: readonly string[],
  unsetValue: string,
): DefaultChoice[] {
  const label = defaultOptionLabel(fallback);
  const carrier = options.find((option) => option.trim().toLowerCase() === label.toLowerCase());
  if (carrier !== undefined) {
    // The label stays the plain value. Which one is the default is carried by
    // the selection, not by an annotation on it.
    return options.map((option) =>
      option === carrier
        ? {value: unsetValue, label: option, selected: true}
        : {value: option, label: option, selected: false},
    );
  }
  return [
    {value: unsetValue, label, selected: true},
    ...options.map((option) => ({value: option, label: option, selected: false})),
  ];
}
