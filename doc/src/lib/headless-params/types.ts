// Construction and live command controls; full member contracts belong to the API reference.

/** How the panel renders a control. Shared by options and commands. */
export type HeadlessControlKind =
  /** Fixed value set → `<select>`. */
  | 'enum'
  /** `<select>` over on/off, for a boolean option. */
  | 'bool'
  /** `<input type="number">`. */
  | 'number'
  /** Free text. */
  | 'text'
  /** No input — a `<button>` that calls the method with no argument. */
  | 'action';

export interface HeadlessControlSpec {
  /** Option key or method name, exactly as it appears in the source. */
  readonly name: string;
  readonly kind: HeadlessControlKind;
  /** `enum` only — the accepted values, in source order. */
  readonly options?: readonly string[];
  /** `number` only. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** `text` / `number` only. */
  readonly placeholder?: string;
  /**
   * Options: what the object does when the option is omitted. Feeds the unset
   * option through `defaultOptionLabel`, which shortens it — see the note on
   * `ParamSpec.fallback`. Commands: not used — a command has no unset state.
   */
  readonly fallback?: string;
  /** One line: what this option or command does. */
  readonly note: string;
  /**
   * Set when the control cannot do anything visible in THIS demo — the demo's
   * synth is mono, the option needs a peer the page does not load, and so on.
   * The control stays wired; the flag is an honesty marker, never a silent
   * dead control.
   */
  readonly inert?: string;
}

export interface HeadlessObjectSpec {
  /** Export name exactly as written in code, e.g. `ScorePlayer`. */
  readonly name: string;
  /** Public import entry, e.g. `@webmusic/score/play/headless`. */
  readonly entry: string;
  /**
   * The construction call the readout renders, with `{options}` where the
   * current options literal goes — e.g. `new ScorePlayer(score, {options})`.
   */
  readonly construction: string;
  readonly options?: readonly HeadlessControlSpec[];
  readonly commands?: readonly HeadlessControlSpec[];
  /** Operational event names routed to compact error feedback, never a trace. */
  readonly errors?: readonly string[];
  /** Element tags that compose this object; reference navigation metadata. */
  readonly composedBy?: readonly string[];
}

export type HeadlessObjectCatalog = Readonly<Record<string, HeadlessObjectSpec>>;
