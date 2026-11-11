// ============================================================================
// The parameter catalog behind <ElementDemo> and the site checks.
//
// One entry per Score / Audio web component. `params` is the element's COMPLETE
// observed-attribute surface — every name in its `static observedAttributes`,
// including the ones no demo would normally set — so a tool can describe every
// one of them. `properties` and `events` round out the members that have no
// attribute form, so the whole surface is in one place.
// ============================================================================

/** How the playground renders a control for one attribute. */
export type ParamKind =
  /** Fixed value set → `<select>` with an "unset" option first. */
  | 'enum'
  /** Tri-state `boolAttr`: absent → the documented fallback, present → true, `"false"` → false. */
  | 'bool'
  /** Numeric attribute → `<input type="number">`. */
  | 'number'
  /** Free text (URL, selector, label, CSS length, colour, …). */
  | 'text'
  /**
   * Space-separated token list → one checkbox per `options` value. Every box
   * checked while the attribute is absent shows the all-tokens fallback; any
   * change writes the checked tokens (an empty list when none are checked).
   */
  | 'tokens';

export interface ParamSpec {
  /** Attribute name exactly as it appears in `observedAttributes`. */
  readonly name: string;
  readonly kind: ParamKind;
  /** `enum` / `tokens` — the accepted values, in source order. */
  readonly options?: readonly string[];
  /** `number` only. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** `text` / `number` only — shown greyed in the empty control. */
  readonly placeholder?: string;
  /**
   * What the element does when the attribute is absent.
   *
   * For `text` / `number` this is the control's placeholder, verbatim. For a
   * `select` it is the SOURCE of the unset option's label, not the label
   * itself: `defaultOptionLabel` shortens it to a name a closed control can
   * show. Write it as `name — explanation` when the default has a name, and
   * keep anything the reader still needs in `note` — the option label will not
   * carry it.
   */
  readonly fallback?: string;
  /** Boolean only: an existing legacy attribute supplies the inverse fallback. Keep explicit on/off choices. */
  readonly inverseFallbackAttribute?: string;
  /** One line: what this attribute changes. */
  readonly note: string;
  /**
   * Set when flipping the control cannot show a visible change in THIS demo —
   * the attribute needs data, a device, a peer or a code path the doc page does
   * not provide. The control is still wired; the flag is an honesty marker.
   */
  readonly inert?: string;
  /**
   * This enum selects the element's drawing, surface or recipe — its `type`,
   * or an equivalent such as `layout`. `<ElementDemo>` renders its options as
   * the demo's one type switch, so readers can see every variant. At most one
   * attribute per element sets it.
   */
  readonly switch?: true;
  /** Show this row only for these values; hidden rows retain their attributes. */
  readonly when?: {
    readonly attribute: string;
    readonly values: readonly string[];
    /** Effective value when the controlling enum is absent or invalid. */
    readonly fallback: string;
    /** Also require this attribute on the same target; retained legacy controls only. */
    readonly presentAttribute?: string;
  };
}

/** A public member with no attribute form — property or event. */
export interface MemberSpec {
  readonly name: string;
  readonly note: string;
}

export interface ElementParamSpec {
  /** Custom element tag, e.g. `score-chord-analysis`. */
  readonly tag: string;
  /** Public import entry, e.g. `@webmusic/score/analyze/element`. */
  readonly entry: string;
  /** Every observed attribute, in `observedAttributes` order. */
  readonly params: readonly ParamSpec[];
  /** Properties that cannot be set from markup (objects, callbacks, readonly state). */
  readonly properties?: readonly MemberSpec[];
  /** Events the element dispatches. */
  readonly events?: readonly MemberSpec[];
}

export type ElementParamCatalog = Readonly<Record<string, ElementParamSpec>>;
