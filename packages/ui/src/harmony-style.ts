import type {Declarations} from './styles';
import {neutralColor, neutralPalette} from './internal/palette';

/**
 * The analysis skin, declared ONCE — colours, type ladder, geometry and the
 * tone-role palette that every harmony read-out shares.
 *
 * `analysis.ts` used to carry the same design as eight hand-kept inline string
 * literals: the root's box, the muted colour, the timeline row, the roman chip,
 * the motif row, the issue row, the histogram row and the active-span
 * highlight. Changing one colour meant finding all eight and hoping. Worse, a
 * literal cannot be themed and cannot answer a media query, so the analysis
 * family had no dark mode at all.
 *
 * So the skin is data, the way {@link ./styles} already made the transport's
 * skin data. {@link harmonyTokens} is the resolution layer, {@link harmonyParts}
 * is the box each node carries, and both a stylesheet and an inline `cssText`
 * string are generated from them — {@link harmonyRule} for the first,
 * {@link harmonyInline} for the second.
 *
 * ## Why `light-dark()` and not a literal-variable layer
 *
 * The kit paints light-DOM hosts inline. An inline declaration cannot carry a
 * `@media (prefers-color-scheme: dark)` block, so the obvious design — a
 * literal layer flipped by a media query — reaches only the hosts that install
 * a stylesheet, which for this family is none of them.
 *
 * `light-dark()` moves the choice into the VALUE, and a value survives both
 * paths verbatim. Which side it takes is decided by the used `color-scheme`,
 * and this module deliberately does NOT declare one: it INHERITS the host
 * page's. A page that has never heard of dark mode keeps the light values it
 * has always had; a page that opted in with `color-scheme: light dark` — or
 * that forces `dark` — takes the analysis card with it, in step, instead of
 * against it. {@link harmonyScheme} is the opt-out for a host that wants this
 * one card pinned, painted inline or selected by `data-scheme` in the sheet.
 *
 * That inheritance is what lets the light literals below stay EXACTLY the
 * values this family shipped before the token record existed. In light mode
 * nothing moves; dark mode is new behaviour that only a page asking for it can
 * see.
 *
 * Honest limitation: a browser without `light-dark()` support drops the whole
 * declaration, so such a viewer gets the property UNSET — inherited from the
 * page — rather than a wrong colour. Every chain below therefore puts the
 * host's own tokens ahead of the literal, so a themed page never depends on it.
 *
 * ## Why the old names are still in every chain
 *
 * `--webscore-analyze-*` is documented on five live pages and read by real
 * consumers. Each new `--wui-harmony-*` name resolves through the public
 * `--wm-harmony-*` token, then `--wm-analysis-*`, then the old
 * `--webscore-analyze-*` name, and only then reaches a literal. A page written
 * against any of those layers keeps working with no edit, and
 * `test/token-chain.test.ts` holds each chain to its documented predecessor.
 *
 * The module is data only: nothing here reads a browser global.
 */

// ---------------------------------------------------------------------------
// The reads.
//
// A part below is painted onto a node that may NOT be the token-carrying root
// — `renderHistogram(bins, someDiv)` is a supported call. So every read falls
// back through the pre-token chain it replaces, which is exactly the string
// that node carried before this module existed.
//
// A read is therefore NOT the same string as the token's own declaration, and
// the difference is the point: the declaration ends at the design's twin, the
// read ends at the one literal the old inline string used. On a proper root
// the token wins and the card gains dark mode; on a foreign node every COLOUR
// resolves to the byte it always did.
//
// The exception, stated plainly: type SIZE. Nine hand-picked sizes collapse
// into one five-step ladder (see the density records), so a part painted on a
// foreign node reads the ladder's fallback rather than the size that site used
// to hard-code. That is the change this commit is for, not an accident.
// ---------------------------------------------------------------------------

// Public fallbacks also work when a helper paints into a caller-owned root
// without the private token record installed. Keep compatibility names ahead
// of shared semantics, and preserve the historical unthemed literals.
const INK = 'var(--wui-harmony-ink, var(--wm-harmony-foreground, var(--wm-analysis-foreground, var(--webscore-analyze-color, var(--wm-foreground, inherit)))))';
// SVG paints must end at a colour, unlike inherited text.
const PAINT = `var(--wui-harmony-paint, var(--wm-harmony-paint, var(--wm-harmony-foreground, var(--wm-analysis-foreground, var(--webscore-analyze-color, var(--wm-foreground, ${neutralColor('foreground')}))))))`;
const INK_MUTED = 'var(--wui-harmony-ink-muted, var(--wm-harmony-muted, var(--wm-analysis-muted, var(--webscore-analyze-muted, var(--wm-foreground-muted, var(--wm-foreground, #777))))))';
const SURFACE = 'var(--wui-harmony-surface, var(--wm-harmony-background, var(--wm-analysis-background, var(--webscore-analyze-bg, var(--wm-surface, transparent)))))';
// Accent text has its own fallback: a transparent surface must not erase it.
const ON_ACCENT = 'var(--wui-harmony-on-accent, var(--cp-accent-foreground, var(--wm-harmony-on-accent, var(--wm-accent-foreground, #fff))))';
const LINE = 'var(--wui-harmony-line, var(--wm-harmony-rule, var(--wm-analysis-rule, var(--webscore-analyze-rule, var(--wm-control-border, var(--wm-border, #d8d8d8))))))';
const BORDER = 'var(--wui-harmony-border, var(--wm-harmony-border, var(--wm-analysis-border, var(--webscore-analyze-border, 1px solid var(--wm-border, #d8d8d8)))))';
const PAD = 'var(--wui-harmony-pad, var(--wm-analysis-padding, var(--webscore-analyze-padding, .75rem)))';
const ACCENT = 'var(--wui-harmony-accent, var(--wm-harmony-accent, var(--wm-analysis-accent, var(--webscore-analyze-accent, var(--wm-accent, #111)))))';
const TRACK = 'var(--wui-harmony-track, var(--wm-harmony-track, var(--wm-analysis-track, var(--webscore-analyze-track, var(--wm-surface-muted, #eee)))))';
const DANGER = 'var(--wui-harmony-danger, var(--wm-analysis-error, var(--wm-error, #c0392b)))';

const FONT = 'var(--wui-harmony-font, inherit)';
const FONT_MONO = 'var(--wui-harmony-font-mono, ui-monospace, monospace)';
const FONT_DISPLAY = 'var(--wui-harmony-font-display, inherit)';
const SIZE_DISPLAY = 'var(--wui-harmony-size-display, 2rem)';
const SIZE_TITLE = 'var(--wui-harmony-size-title, 1rem)';
const SIZE_BODY = 'var(--wui-harmony-size-body, .8rem)';
const SIZE_LABEL = 'var(--wui-harmony-size-label, .74rem)';
const SIZE_MICRO = 'var(--wui-harmony-size-micro, .7rem)';

/**
 * The values a caller needs outside a declaration block — an SVG `stroke`
 * attribute takes a paint, not a rule. Paints only: a shorthand such as the
 * border can never be an attribute value, so it is not offered here.
 */
export const harmonyValues = {
  ink: INK,
  paint: PAINT,
  inkMuted: INK_MUTED,
  surface: SURFACE,
  onAccent: ON_ACCENT,
  line: LINE,
  accent: ACCENT,
  track: TRACK,
  danger: DANGER,
  fontMono: FONT_MONO,
} as const;

// ---------------------------------------------------------------------------
// Tone roles — the visual signature, and the one answer to "what colour is the
// root note". Seven mounts will read these three functions; none of them gets
// its own opinion.
// ---------------------------------------------------------------------------

/** What a sounding pitch is DOING in the chord a caller named. */
export type ToneRole =
  | 'root'
  | 'third'
  | 'fifth'
  | 'seventh'
  | 'extension'
  | 'bass'
  | 'other'
  | 'ghost';

/** A light/dark pair of the same hue: one value, two schemes. */
type Twin = readonly [light: string, dark: string];

/**
 * The palette, written ONCE. Both the `--wui-degree-*` declaration in
 * {@link harmonyTokens} and the value {@link toneFill} returns are generated
 * from this table. That matters because a mount is allowed to paint onto a
 * node that carries no tokens: a bare `var(--wui-degree-root)` would be
 * invalid at computed-value time there and the notehead would come out
 * INVISIBLE, which is the one failure a colour system may not have.
 *
 * The hues are new — nothing in the kit had a degree colour before — so the
 * public `--wm-degree-*` token sits directly behind the literal with no
 * compatibility layer to honour.
 */
const DEGREE: Readonly<Record<ToneRole, Twin>> = {
  root: ['#c2410c', '#fb923c'],
  third: ['#0369a1', '#38bdf8'],
  fifth: ['#15803d', '#4ade80'],
  seventh: ['#6d28d9', '#a78bfa'],
  extension: ['#a16207', '#facc15'],
  bass: ['#9f1239', '#fb7185'],
  other: neutralPalette.muted,
  // A wash, not a fill: "in the key but not sounding". Its contrast is
  // deliberately far below the 3:1 graphic floor — it is a hint behind the
  // data, and the mark beside it is what carries the fact.
  ghost: ['rgba(17, 17, 17, .1)', 'rgba(238, 238, 238, .14)'],
};

// Every fill above is dark in the light scheme and light in the dark one, so a
// single ink flips with all seven.
const DEGREE_INK: Twin = ['#ffffff', '#111'];

/** What a `--wui-*` token DECLARES: the public token, then the twin. */
const declares = (name: string, [light, dark]: Twin): string =>
  `var(--wm-${name}, light-dark(${light}, ${dark}))`;

/** What a part READS: the same chain with the `--wui-*` name in front. */
const reads = (name: string, twin: Twin): string => `var(--wui-${name}, ${declares(name, twin)})`;

const TONE_FILLS: Readonly<Record<ToneRole, string>> = {
  root: reads('degree-root', DEGREE.root),
  third: reads('degree-third', DEGREE.third),
  fifth: reads('degree-fifth', DEGREE.fifth),
  seventh: reads('degree-seventh', DEGREE.seventh),
  extension: reads('degree-extension', DEGREE.extension),
  bass: reads('degree-bass', DEGREE.bass),
  other: reads('degree-other', DEGREE.other),
  ghost: reads('degree-ghost', DEGREE.ghost),
};

const TONE_INK = reads('degree-ink', DEGREE_INK);

/**
 * The role abbreviation printed ALONGSIDE the colour. Colour never carries a
 * fact on its own here: the mark is what keeps a grayscale print, a colour-blind
 * reader and a screenshot legible, so no density setting may drop it.
 *
 * ASCII only, deliberately. `packages/ui/src` may not contain a notation glyph
 * — the kit lays notes out and its caller says what they are called — so an
 * unnamed tone reads '.', never a musical symbol.
 *
 * Two known limits, both waiting for a caller that can act on them: 'other' and
 * 'ghost' share '.', and 'extension' prints '9' for every 9/11/13 and altered
 * tone. The role alone cannot say which — the caller knows the real figure, so
 * an override belongs on the mount that finally prints one.
 */
const TONE_MARKS: Readonly<Record<ToneRole, string>> = {
  root: 'R',
  third: '3',
  fifth: '5',
  seventh: '7',
  extension: '9',
  bass: 'B',
  other: '.',
  ghost: '.',
};

/** The fill a tone in this role is painted with. Unknown roles read as 'other'. */
export function toneFill(role: ToneRole | undefined): string {
  return TONE_FILLS[role ?? 'other'] ?? TONE_FILLS.other;
}

/**
 * The ink to print ON that fill. One token serves every role because the fills
 * are dark in the light scheme and light in the dark one, so the contrast ink
 * flips with them. A ghost tone is a wash rather than a fill, so it takes the
 * surrounding muted ink instead.
 */
export function toneInk(role: ToneRole | undefined): string {
  return role === 'ghost' ? INK_MUTED : TONE_INK;
}

/** The role abbreviation — 'R', '3', '5', '7', '9', 'B' or '.'. ASCII only. */
export function toneMark(role: ToneRole | undefined): string {
  return TONE_MARKS[role ?? 'other'] ?? TONE_MARKS.other;
}

/** How loud a read-out shouts. Domain-neutral: a strip, a row or a dot uses it. */
export type Severity = 'info' | 'warning' | 'error';

/**
 * The fill for one severity. The fallbacks are single light-mode values, not
 * twins, on purpose: this is what a node carrying no tokens gets, and that node
 * used to carry exactly these bytes. A proper root resolves the token, which
 * does have a dark twin.
 */
export function severityFill(severity: Severity | undefined): string {
  if (severity === 'error') return 'var(--wui-harmony-danger, #c0392b)';
  if (severity === 'warning') return 'var(--wui-harmony-warning, #a86a00)';
  return 'var(--wui-harmony-info, #888)';
}

/**
 * The twelve-slot progression table, indexed by pitch class rather than by a
 * hash of the chord's name. `analysis-timeline.ts` colours by hashing the
 * label, which gives the same chord two different colours in two elements;
 * this table is what lets that become a lookup instead of a guess.
 */
const PROGRESSION: readonly Twin[] = [
  ['#b91c1c', '#f87171'],
  ['#c2410c', '#fb923c'],
  ['#a16207', '#facc15'],
  ['#4d7c0f', '#a3e635'],
  ['#15803d', '#4ade80'],
  ['#0f766e', '#2dd4bf'],
  ['#0369a1', '#38bdf8'],
  ['#1d4ed8', '#60a5fa'],
  ['#4338ca', '#818cf8'],
  ['#6d28d9', '#a78bfa'],
  ['#a21caf', '#e879f9'],
  ['#9f1239', '#fb7185'],
];

/** The progression fill for one pitch class, wrapped to 0…11. */
export function progressionTone(pitchClass: number): string {
  const slot = Number.isFinite(pitchClass) ? ((Math.trunc(pitchClass) % 12) + 12) % 12 : 0;
  return reads(`progression-tone-${slot}`, PROGRESSION[slot] ?? PROGRESSION[0]!);
}

// ---------------------------------------------------------------------------
// Density — five type sizes and three geometries, and nothing else.
//
// Not a fluid scale. A staff and a fretboard have to be pixel-stable or the
// fret markers blur, so geometry gets its own tokens rather than riding a
// font-size multiplier.
// ---------------------------------------------------------------------------

const COMFORTABLE: Declarations = {
  '--wui-harmony-size-display': 'var(--wm-harmony-size-display, 2.75rem)',
  '--wui-harmony-size-title': 'var(--wm-harmony-size-title, 1.0625rem)',
  '--wui-harmony-size-body': 'var(--wm-harmony-size-body, .875rem)',
  '--wui-harmony-size-label': 'var(--wm-harmony-size-label, .75rem)',
  '--wui-harmony-size-micro': 'var(--wm-harmony-size-micro, .6875rem)',
  '--wui-harmony-keyboard-height':
    'var(--wm-harmony-keyboard-height, var(--wm-keyboard-height, 92px))',
  '--wui-harmony-staff-space': 'var(--wm-harmony-staff-space, var(--wm-staff-space, 9px))',
  '--wui-harmony-fretboard-height':
    'var(--wm-harmony-fretboard-height, var(--wm-fretboard-height, 104px))',
  // The conveyor's two heights. They are here rather than as literals in
  // `harmony.ts` for one reason: without them `data-density="compact"` changed
  // every read-out in the family EXCEPT the lane, which went on standing 96px
  // tall in a card that had just been told to be small.
  '--wui-harmony-flow-height': 'var(--wm-harmony-flow-height, 96px)',
  '--wui-harmony-lane-height': 'var(--wm-harmony-lane-height, 48px)',
};

const COMPACT: Declarations = {
  '--wui-harmony-size-display': 'var(--wm-harmony-size-display, 1.75rem)',
  '--wui-harmony-size-title': 'var(--wm-harmony-size-title, .9375rem)',
  '--wui-harmony-size-body': 'var(--wm-harmony-size-body, .8125rem)',
  '--wui-harmony-size-label': 'var(--wm-harmony-size-label, .6875rem)',
  '--wui-harmony-size-micro': 'var(--wm-harmony-size-micro, .625rem)',
  '--wui-harmony-keyboard-height':
    'var(--wm-harmony-keyboard-height, var(--wm-keyboard-height, 68px))',
  '--wui-harmony-staff-space': 'var(--wm-harmony-staff-space, var(--wm-staff-space, 7px))',
  '--wui-harmony-fretboard-height':
    'var(--wm-harmony-fretboard-height, var(--wm-fretboard-height, 80px))',
  '--wui-harmony-flow-height': 'var(--wm-harmony-flow-height, 72px)',
  '--wui-harmony-lane-height': 'var(--wm-harmony-lane-height, 36px)',
};

/**
 * The two densities, as data. A host that installs the sheet switches with
 * `data-density`; a host painting inline paints the record it wants. Note that
 * a `--wm-harmony-*` override wins in BOTH — an explicit host size is a
 * decision, and density is only a default.
 */
export const harmonyDensity = {
  comfortable: COMFORTABLE,
  compact: COMPACT,
} satisfies Readonly<Record<string, Declarations>>;

/** The name of a density this skin knows. */
export type HarmonyDensity = keyof typeof harmonyDensity;

/**
 * The motion budget, as data — because the reduced-motion escape has to reach
 * the inline path too, and no `cssText` string can carry a media query. A mount
 * that reads the user's preference paints the `reduced` record instead; a host
 * that installs the sheet gets the same override from the media block.
 *
 * The durations are the whole budget: a tone highlight has to keep up with a
 * player, so it is barely a transition at all.
 */
export const harmonyMotion = {
  full: {
    '--wui-harmony-motion-tone': 'var(--wm-harmony-motion-tone, 90ms)',
    '--wui-harmony-motion-chip': 'var(--wm-harmony-motion-chip, 120ms)',
  },
  reduced: {
    '--wui-harmony-motion-tone': '0s',
    '--wui-harmony-motion-chip': '0s',
  },
} satisfies Readonly<Record<string, Declarations>>;

/** The name of a motion budget this skin knows. */
export type HarmonyMotion = keyof typeof harmonyMotion;

/**
 * Light, dark, follow the viewer — or, by default, do not answer at all.
 *
 * `inherit` declares nothing, which is what makes every `light-dark()` below
 * follow the HOST page rather than argue with it: a page that never opted into
 * dark mode keeps the light values it always had, and a page that did takes
 * this card along. Painting `system` is a decision to follow the OS even on a
 * light-only page, which is right for a shell that paints its own ground and
 * wrong for a card that sits on the host's.
 */
export const harmonyScheme = {
  inherit: {},
  system: {'color-scheme': 'light dark'},
  light: {'color-scheme': 'light'},
  dark: {'color-scheme': 'dark'},
} satisfies Readonly<Record<string, Declarations>>;

/** The name of a colour scheme this skin knows. */
export type HarmonyScheme = keyof typeof harmonyScheme;

// ---------------------------------------------------------------------------
// The tokens.
//
// Group A, `--wui-harmony-*`, is the interface skeleton: neutral, quiet, and
// each of them carrying its old `--webscore-analyze-*` name as the last
// fallback before a literal. Every light-side literal is the byte the old
// inline string ended at, so light mode does not move.
//
// Group B, `--wui-degree-*` and `--wui-progression-tone-*`, is generated from
// the tables above rather than written twice.
// ---------------------------------------------------------------------------

const degreeTokens: Declarations = {
  ...Object.fromEntries(
    Object.entries(DEGREE).map(([role, twin]): [string, string] => [
      `--wui-degree-${role}`,
      declares(`degree-${role}`, twin),
    ]),
  ),
  '--wui-degree-ink': declares('degree-ink', DEGREE_INK),
};

const progressionTokens: Declarations = Object.fromEntries(
  PROGRESSION.map((twin, slot): [string, string] => [
    `--wui-progression-tone-${slot}`,
    declares(`progression-tone-${slot}`, twin),
  ]),
);

export const harmonyTokens: Declarations = {
  // `inherit` and `transparent`, not a literal pair: the card defers to the
  // page it sits on, which is both what five documentation pages promise and
  // the only ground on which an inherited `color-scheme` can be trusted.
  '--wui-harmony-ink':
    'var(--cp-foreground, var(--wm-harmony-foreground, var(--wm-analysis-foreground, var(--webscore-analyze-color, var(--wm-foreground, inherit)))))',
  // The paint twin of the ink, and the only difference is where it stops. See
  // {@link PAINT}: a shape whose fill resolved to `inherit` is painted black,
  // which is the one colour a read-out may never fall back to.
  '--wui-harmony-paint':
    `var(--cp-foreground, var(--wm-harmony-paint, var(--wm-harmony-foreground, var(--wm-analysis-foreground, var(--webscore-analyze-color, var(--wm-foreground, ${neutralColor('foreground')}))))))`,
  '--wui-harmony-surface':
    'var(--cp-background, var(--wm-harmony-background, var(--wm-analysis-background, var(--webscore-analyze-bg, var(--wm-surface, transparent)))))',
  '--wui-harmony-on-accent':
    'var(--cp-accent-foreground, var(--wm-harmony-on-accent, var(--wm-accent-foreground, light-dark(#fff, #111))))',
  '--wui-harmony-ink-muted':
    `var(--cp-muted, var(--wm-harmony-muted, var(--wm-analysis-muted, var(--webscore-analyze-muted, var(--wm-foreground-muted, var(--wm-foreground, ${neutralColor('muted')}))))))`,
  '--wui-harmony-line':
    `var(--cp-rule, var(--wm-harmony-rule, var(--wm-analysis-rule, var(--webscore-analyze-rule, var(--wm-control-border, var(--wm-border, ${neutralColor('border')}))))))`,
  // The border is a SHORTHAND, not a colour: `--webscore-analyze-border` always
  // carried `1px solid …`. Keeping it apart from the rule colour is what lets
  // both old names stay honest instead of one silently swallowing the other.
  '--wui-harmony-border':
    'var(--cp-border, var(--wm-harmony-border, var(--wm-analysis-border, var(--webscore-analyze-border, 1px solid var(--wui-harmony-line)))))',
  '--wui-harmony-pad':
    'var(--cp-padding, var(--wm-harmony-padding, var(--wm-analysis-padding, var(--webscore-analyze-padding, .75rem))))',
  '--wui-harmony-accent':
    `var(--cp-accent, var(--wm-harmony-accent, var(--wm-analysis-accent, var(--webscore-analyze-accent, var(--wm-accent, ${neutralColor('foreground')})))))`,
  '--wui-harmony-track':
    `var(--cp-track, var(--wm-harmony-track, var(--wm-analysis-track, var(--webscore-analyze-track, var(--wm-surface-muted, ${neutralColor('surfaceMuted')})))))`,
  '--wui-harmony-danger':
    'var(--wm-harmony-danger, var(--wm-analysis-error, var(--wm-error, light-dark(#c0392b, #f87171))))',
  // Amber at #d98c00 is 2.73:1 on white — under the 3:1 floor for a graphic,
  // and this colour IS the graphic: the severity bead is the only thing
  // distinguishing a warning row from an error one. Darkened to 4.44:1.
  '--wui-harmony-warning': 'var(--wm-harmony-warning, light-dark(#a86a00, #fbbf24))',
  // 3.54:1 on white — enough for the bead it paints, not enough for text.
  '--wui-harmony-info': 'var(--wm-harmony-info, light-dark(#888, #aaa))',
  '--wui-harmony-focus': 'var(--wm-harmony-focus, var(--wm-focus, var(--wui-focus, currentColor)))',
  '--wui-harmony-radius': 'var(--wm-harmony-radius, var(--wm-control-radius, 0))',

  // Three families, three jobs. Everything numeric or note-named goes mono with
  // tabular figures so a column of beats does not shimmer as it counts up. The
  // text family ends at `inherit`: a card that overrode the host's typeface
  // without being asked would be the loudest thing on the page.
  '--wui-harmony-font': 'var(--wm-harmony-font, var(--wm-font-family, inherit))',
  '--wui-harmony-font-mono':
    'var(--wm-harmony-font-mono, var(--wm-font-mono, var(--wui-font-mono, ui-monospace, monospace)))',
  '--wui-harmony-font-display': 'var(--wm-harmony-font-display, var(--wui-harmony-font))',

  // The 4px grid of §2.1, as tokens rather than as a convention. Seven mounts
  // are about to need a gap; without these they would pick seven of them.
  '--wui-harmony-space-1': 'var(--wm-harmony-space-1, 4px)',
  '--wui-harmony-space-2': 'var(--wm-harmony-space-2, 8px)',
  '--wui-harmony-space-3': 'var(--wm-harmony-space-3, 12px)',
  '--wui-harmony-space-4': 'var(--wm-harmony-space-4, 16px)',
  '--wui-harmony-space-5': 'var(--wm-harmony-space-5, 24px)',
  '--wui-harmony-motion-ease': 'var(--wm-harmony-motion-ease, ease-out)',

  ...COMFORTABLE,
  ...harmonyMotion.full,
  ...degreeTokens,
  ...progressionTokens,
};

/** How a root wants to be dressed. Every field defaults to the quiet answer. */
export interface HarmonyRootOptions {
  /** Follow the host page unless a caller says otherwise. */
  scheme?: HarmonyScheme;
  density?: HarmonyDensity;
  motion?: HarmonyMotion;
}

/**
 * The whole token layer for one root, composed in the ONE order that works.
 *
 * `harmonyTokens` embeds the comfortable density and the full motion budget so
 * that it is complete on its own — which means a caller who writes
 * `harmonyInline(harmonyDensity.compact, harmonyTokens)` gets comfortable back
 * and no error. Composing through here is the sanctioned way to avoid that:
 * the overrides land after the record they override.
 */
export function harmonyRootDeclarations(options: HarmonyRootOptions = {}): Declarations {
  return {
    ...harmonyScheme[options.scheme ?? 'inherit'],
    ...harmonyTokens,
    ...harmonyDensity[options.density ?? 'comfortable'],
    ...harmonyMotion[options.motion ?? 'full'],
  };
}

// ---------------------------------------------------------------------------
// The parts.
//
// Keys are CSS property names, so one record feeds both a rule body and an
// inline `cssText` string. Nothing here computes: a width that changes every
// frame is a VALUE the caller passes, not a box declaration, or the number
// would live in two places again.
//
// The lengths below are transcribed from the boxes `analysis.ts` used to
// hard-code, off-grid values and all, so that this commit moves no pixel it
// did not mean to. The spacing scale above is for the mounts that replace
// these read-outs, not for retro-fitting them.
// ---------------------------------------------------------------------------

export const harmonyParts = {
  /**
   * The card itself: the token carrier, and the only node with a border. It
   * sets its own body size — that is what the audio cards get for free from
   * this commit — and therefore a line-height ratio, since a page's inherited
   * line-height is an absolute pixel value that would not follow it down.
   */
  root: {
    'font-family': FONT,
    'font-size': SIZE_BODY,
    'line-height': '1.45',
    color: INK,
    background: SURFACE,
    border: BORDER,
    padding: PAD,
  },
  inkMuted: {color: INK_MUTED},
  caption: {'font-size': SIZE_LABEL, 'margin-bottom': '.25rem'},
  /** The same caption when a whole block, not one line, follows it. */
  captionSpaced: {'font-size': SIZE_LABEL, 'margin-bottom': '.5rem'},
  /** The one big word: a chord symbol or a key name. */
  headline: {
    'font-family': FONT_DISPLAY,
    'font-weight': '700',
    'font-size': SIZE_DISPLAY,
    'line-height': '1.1',
  },
  /** The line under the headline — confidence, or why there is nothing yet. */
  subhead: {'font-size': SIZE_BODY, margin: '.15rem 0 .6rem'},
  meterList: {display: 'flex', 'flex-direction': 'column', gap: '.3rem'},
  /** One candidate: a fixed label gutter, then the bar. */
  candidateRow: {
    display: 'grid',
    'grid-template-columns': '4.5rem 1fr',
    'align-items': 'center',
    gap: '.5rem',
    'font-size': SIZE_LABEL,
  },
  /** One histogram bin: label gutter, bar, then the readout. */
  histogramRow: {
    display: 'grid',
    'grid-template-columns': '3.2rem 1fr 3rem',
    'align-items': 'center',
    gap: '.5rem',
    'font-size': SIZE_LABEL,
  },
  /** A note name or a number: mono, so columns line up. */
  monoLabel: {'font-family': FONT_MONO, 'font-variant-numeric': 'tabular-nums'},
  monoValue: {
    'text-align': 'right',
    'font-family': FONT_MONO,
    'font-variant-numeric': 'tabular-nums',
  },
  meterTrack: {height: 'var(--wm-analysis-bar-height, .5rem)', background: TRACK},
  // No `width` here: the fill's is a VALUE, written per bar by the caller, not
  // a box declaration. Declaring it as well would put one number in two
  // places, which is what the rest of this module exists to stop.
  meterFill: {display: 'block', height: '100%', background: ACCENT},

  /** A stacked list of spans — chords, motifs, issues, rhythms. */
  stackList: {
    'list-style': 'none',
    margin: '0',
    padding: '0',
    display: 'flex',
    'flex-direction': 'column',
  },
  /** The chord timeline's own spacing: rows separated by a rule, not a gap. */
  timelineRow: {
    display: 'flex',
    'align-items': 'baseline',
    'justify-content': 'space-between',
    gap: '.6rem',
    padding: '.3rem .45rem',
    'border-bottom': `1px solid ${LINE}`,
    'font-size': SIZE_BODY,
  },
  stackRow: {
    display: 'flex',
    'align-items': 'center',
    gap: '.6rem',
    'font-size': SIZE_BODY,
    padding: '.2rem .45rem',
  },
  /** The voice-leading row is the same box with a tighter gap for the dot. */
  issueRow: {
    display: 'flex',
    'align-items': 'center',
    gap: '.5rem',
    'font-size': SIZE_BODY,
    padding: '.2rem .45rem',
  },
  stackGap: {gap: '.15rem'},
  chordName: {'font-weight': '700', 'font-family': FONT_MONO},
  beatLabel: {'font-size': SIZE_LABEL},
  /** An occurrence count, in a gutter wide enough not to ragged-edge. */
  count: {'font-weight': '700', 'min-width': '2rem'},
  /** The shape of a motif or a rhythm, in mono. */
  figure: {
    'font-family': FONT_MONO,
    'font-size': SIZE_TITLE,
    'letter-spacing': '.08em',
  },
  /** A trailing note too small to compete with the row's subject. */
  microNote: {'font-size': SIZE_MICRO},
  // The severity bead. Its `background` is the datum and arrives per row.
  severityDot: {
    width: '.55rem',
    height: '.55rem',
    'border-radius': '50%',
    flex: '0 0 auto',
  },

  chipStrip: {display: 'flex', gap: '.4rem', 'flex-wrap': 'wrap'},
  chip: {
    'border-radius': 'var(--wm-harmony-radius, var(--wm-control-radius, 0))',
    border: `1px solid ${LINE}`,
    padding: '.3rem .5rem',
    'text-align': 'center',
    'min-width': '2.5rem',
  },
  chipNumeral: {'font-family': FONT_DISPLAY, 'font-weight': '700', 'font-size': SIZE_TITLE},
  chipCaption: {'font-size': SIZE_MICRO, 'font-family': FONT_MONO},

  /** The live chord's name. `min-height` is in `em` so it tracks the density. */
  nameplate: {
    'font-family': FONT_DISPLAY,
    'font-weight': '700',
    'font-size': SIZE_DISPLAY,
    'line-height': '1.15',
    'min-height': '1.2em',
  },
  voicing: {
    'font-family': FONT_MONO,
    'font-size': SIZE_BODY,
    margin: '.3rem 0 .6rem',
    'min-height': '1.1rem',
  },
  history: {display: 'flex', gap: '.35rem', 'flex-wrap': 'wrap', 'min-height': '1.4rem'},
  historyChip: {
    border: `1px solid ${LINE}`,
    padding: '.15rem .45rem',
    'font-size': SIZE_LABEL,
    'font-family': FONT_MONO,
  },
  /** The chip that is sounding: the accent, and the ink that survives on it. */
  historyChipActive: {background: ACCENT, color: ON_ACCENT},

  summaryTitle: {display: 'block', 'font-size': SIZE_TITLE, 'margin-bottom': '.15rem'},
  /** The definition grid of scalar facts. */
  summaryList: {
    display: 'grid',
    'grid-template-columns': 'auto 1fr',
    gap: '.15rem .75rem',
    margin: '.35rem 0 0',
    'font-size': SIZE_BODY,
  },
  /** The same grid, tighter, for the audio card's loudness block. */
  factList: {
    display: 'grid',
    'grid-template-columns': 'auto 1fr',
    gap: '.15rem .6rem',
    margin: '0',
  },
  summaryTerm: {margin: '0'},
  summaryValue: {margin: '0', 'font-weight': '600'},

  failure: {color: DANGER},
  strong: {'font-weight': '700'},
  onsetTrack: {
    position: 'relative',
    height: 'var(--wm-analysis-strip-height, 1.4rem)',
    'margin-top': '.5rem',
    background: TRACK,
    overflow: 'hidden',
  },
  // One onset. Its `left` is the datum and arrives per mark.
  onsetMark: {position: 'absolute', 'inset-block': '0', width: '1px', background: ACCENT},
  contour: {display: 'block', 'margin-top': '.5rem', width: '100%', height: 'auto'},

  /**
   * The highlight a playhead lays over a sounding span. It is CONCATENATED onto
   * the node's idle string, which is why every string this module generates ends
   * with a semicolon: without one the idle string's last declaration and this
   * `background` were both dropped, and only the outline ever showed.
   */
  activeSpan: {background: TRACK, outline: `2px solid ${ACCENT}`, 'outline-offset': '-2px'},
} satisfies Readonly<Record<string, Declarations>>;

/** The name of a part this skin can paint. */
export type HarmonyPart = keyof typeof harmonyParts;

// ---------------------------------------------------------------------------
// The two generators. Same records, two destinations.
// ---------------------------------------------------------------------------

const body = (...groups: Declarations[]): string =>
  groups
    .flatMap((group) => Object.entries(group))
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');

/** One CSS rule built from any number of declaration records. */
export const harmonyRule = (selector: string, ...groups: Declarations[]): string =>
  `${selector} {\n${body(...groups)}\n}`;

const indent = (rule: string): string =>
  rule
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

/**
 * The same declarations as an inline `cssText` string. ALWAYS terminated: a
 * caller may concatenate onto the result, and an unterminated declaration list
 * silently eats both the last declaration and the first appended one.
 */
export const harmonyInline = (...groups: Declarations[]): string =>
  groups
    .flatMap((group) => Object.entries(group))
    .map(([property, value]) => `${property}:${value};`)
    .join('');

/**
 * The base sheet for one root class: the token layer, the card's box, and the
 * three things an inline declaration cannot express — the attribute selectors
 * that switch density and scheme, the focus ring, and the reduced-motion
 * opt-out. Per-mount rules arrive with their mounts; this is the shell they all
 * sit inside.
 *
 * Taking the selector as an argument is what keeps the sheet honest: an
 * `analysisStyle` whose state rules named a class the analysis root does not
 * carry would look installed and do nothing.
 */
export const harmonySheet = (selector: string): string =>
  [
    harmonyRule(selector, harmonyTokens, harmonyParts.root),
    harmonyRule(`${selector}[data-density="compact"]`, harmonyDensity.compact),
    harmonyRule(`${selector}[data-scheme="system"]`, harmonyScheme.system),
    harmonyRule(`${selector}[data-scheme="light"]`, harmonyScheme.light),
    harmonyRule(`${selector}[data-scheme="dark"]`, harmonyScheme.dark),
    harmonyRule(`${selector} :focus-visible`, {
      outline: `2px solid var(--wui-harmony-focus)`,
      'outline-offset': '2px',
    }),
    // Two escapes, because a mount may spend the budget through the token or
    // hard-code a transition of its own, and only one of those is inspectable.
    [
      '@media (prefers-reduced-motion: reduce) {',
      indent(harmonyRule(selector, harmonyMotion.reduced)),
      indent(
        harmonyRule(`${selector} *, ${selector} *::before, ${selector} *::after`, {
          transition: 'none',
          animation: 'none',
        }),
      ),
      '}',
    ].join('\n'),
  ].join('\n\n');

/** The sheet for the workbench shell, whose root class is `.wui-harmony`. */
export const harmonyStyle = harmonySheet('.wui-harmony');
