// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import {
  ANALYSIS_SPAN_SELECTOR,
  analysisStyle,
  createAnalysisPlayhead,
  createAnalysisRoot,
  readAnalysisIdleStyle,
  renderChordTimeline,
  renderMotifList,
  renderRomanStrip,
  renderVoiceLeadingList,
} from '../src/analysis';
import {
  harmonyDensity,
  harmonyInline,
  harmonyMotion,
  harmonyParts,
  harmonyRootDeclarations,
  harmonyScheme,
  harmonyStyle,
  harmonyTokens,
  harmonyValues,
  progressionTone,
  severityFill,
  toneFill,
  toneInk,
  toneMark,
  type ToneRole,
} from '../src/harmony-style';

/**
 * The name each `--wui-*` token must still reach.
 *
 * The eight compatibility tokens carry a documented `--webscore-analyze-*`
 * predecessor: those names are printed on five live docs pages and read by
 * pages this repo does not own, so a chain that stops short of one silently
 * un-themes somebody's site. Everything else is a new concept whose oldest
 * name is its own public `--wm-*` token.
 *
 * The table is exhaustive in both directions — a new token with no recorded
 * predecessor fails here rather than shipping unthemed.
 */
const PREDECESSOR: Readonly<Record<string, string>> = {
  '--wui-harmony-ink': '--webscore-analyze-color',
  '--wui-harmony-paint': '--wm-harmony-paint',
  '--wui-harmony-ink-muted': '--webscore-analyze-muted',
  '--wui-harmony-surface': '--webscore-analyze-bg',
  '--wui-harmony-on-accent': '--wm-accent-foreground',
  '--wui-harmony-line': '--webscore-analyze-rule',
  '--wui-harmony-border': '--webscore-analyze-border',
  '--wui-harmony-pad': '--webscore-analyze-padding',
  '--wui-harmony-accent': '--webscore-analyze-accent',
  '--wui-harmony-track': '--webscore-analyze-track',
  '--wui-harmony-danger': '--wm-analysis-error',
  '--wui-harmony-warning': '--wm-harmony-warning',
  '--wui-harmony-info': '--wm-harmony-info',
  '--wui-harmony-focus': '--wm-focus',
  '--wui-harmony-radius': '--wm-control-radius',
  '--wui-harmony-font': '--wm-harmony-font',
  '--wui-harmony-font-mono': '--wm-harmony-font-mono',
  '--wui-harmony-font-display': '--wm-harmony-font-display',
  '--wui-harmony-space-1': '--wm-harmony-space-1',
  '--wui-harmony-space-2': '--wm-harmony-space-2',
  '--wui-harmony-space-3': '--wm-harmony-space-3',
  '--wui-harmony-space-4': '--wm-harmony-space-4',
  '--wui-harmony-space-5': '--wm-harmony-space-5',
  '--wui-harmony-motion-ease': '--wm-harmony-motion-ease',
  '--wui-harmony-motion-tone': '--wm-harmony-motion-tone',
  '--wui-harmony-motion-chip': '--wm-harmony-motion-chip',
  '--wui-harmony-size-display': '--wm-harmony-size-display',
  '--wui-harmony-size-title': '--wm-harmony-size-title',
  '--wui-harmony-size-body': '--wm-harmony-size-body',
  '--wui-harmony-size-label': '--wm-harmony-size-label',
  '--wui-harmony-size-micro': '--wm-harmony-size-micro',
  '--wui-harmony-keyboard-height': '--wm-keyboard-height',
  '--wui-harmony-staff-space': '--wm-staff-space',
  '--wui-harmony-fretboard-height': '--wm-fretboard-height',
  '--wui-harmony-flow-height': '--wm-harmony-flow-height',
  '--wui-harmony-lane-height': '--wm-harmony-lane-height',
  '--wui-degree-root': '--wm-degree-root',
  '--wui-degree-third': '--wm-degree-third',
  '--wui-degree-fifth': '--wm-degree-fifth',
  '--wui-degree-seventh': '--wm-degree-seventh',
  '--wui-degree-extension': '--wm-degree-extension',
  '--wui-degree-bass': '--wm-degree-bass',
  '--wui-degree-other': '--wm-degree-other',
  '--wui-degree-ghost': '--wm-degree-ghost',
  '--wui-degree-ink': '--wm-degree-ink',
  '--wui-progression-tone-0': '--wm-progression-tone-0',
  '--wui-progression-tone-1': '--wm-progression-tone-1',
  '--wui-progression-tone-2': '--wm-progression-tone-2',
  '--wui-progression-tone-3': '--wm-progression-tone-3',
  '--wui-progression-tone-4': '--wm-progression-tone-4',
  '--wui-progression-tone-5': '--wm-progression-tone-5',
  '--wui-progression-tone-6': '--wm-progression-tone-6',
  '--wui-progression-tone-7': '--wm-progression-tone-7',
  '--wui-progression-tone-8': '--wm-progression-tone-8',
  '--wui-progression-tone-9': '--wm-progression-tone-9',
  '--wui-progression-tone-10': '--wm-progression-tone-10',
  '--wui-progression-tone-11': '--wm-progression-tone-11',
};

/** The eight names an existing page may already be theming with. */
const COMPAT_TOKENS = [
  '--wui-harmony-ink',
  '--wui-harmony-ink-muted',
  '--wui-harmony-surface',
  '--wui-harmony-line',
  '--wui-harmony-border',
  '--wui-harmony-pad',
  '--wui-harmony-accent',
  '--wui-harmony-track',
] as const;

/**
 * What each chain resolves to on an unthemed page in the LIGHT scheme, and the
 * byte the equivalent inline literal ended at before this module existed.
 *
 * This is the table that makes the refactor a refactor. Five documentation
 * pages print these values as the family's defaults — `transparent` root,
 * `inherit` text, `#fff` active chip, `#777` muted, `#eee` track, `#111`
 * accent, `#d8d8d8` rule, `.75rem` padding — and a token layer that quietly
 * moved any of them would make all five wrong while every test still passed.
 * Dark mode is added strictly as a second branch that only a page declaring a
 * `color-scheme` can reach.
 */
const LIGHT_DEFAULT: Readonly<Record<string, string>> = {
  '--wui-harmony-ink': 'inherit',
  '--wui-harmony-surface': 'transparent',
  '--wui-harmony-on-accent': '#fff',
  '--wui-harmony-ink-muted': '#777',
  '--wui-harmony-line': '#d8d8d8',
  '--wui-harmony-pad': '.75rem',
  '--wui-harmony-accent': '#111',
  '--wui-harmony-track': '#eee',
  '--wui-harmony-danger': '#c0392b',
  '--wui-harmony-info': '#888',
};

/** The light side of a chain: the first arm of its twin, or its last fallback. */
function terminalLight(chain: string): string {
  const twin = /light-dark\(\s*([^,]+),/.exec(chain);
  if (twin) return twin[1]!.trim();
  const bare = /,\s*([^,()]+)\)+$/.exec(chain);
  return bare ? bare[1]!.trim() : chain;
}

const ROLES: readonly ToneRole[] = [
  'root',
  'third',
  'fifth',
  'seventh',
  'extension',
  'bass',
  'other',
  'ghost',
];

describe('the token record', () => {
  it('declares every token the predecessor table records, and no other', () => {
    expect(Object.keys(harmonyTokens).sort()).toEqual(Object.keys(PREDECESSOR).sort());
  });

  it('keeps every chain reaching the name it replaced', () => {
    for (const [token, predecessor] of Object.entries(PREDECESSOR)) {
      expect(harmonyTokens[token], `${token} is missing`).toBeTruthy();
      expect(harmonyTokens[token], `${token} lost ${predecessor}`).toContain(predecessor);
    }
  });

  it('puts the host layers ahead of the old name, and the old name ahead of the literal', () => {
    for (const token of COMPAT_TOKENS) {
      const chain = harmonyTokens[token]!;
      const harmony = chain.indexOf('--wm-harmony-');
      const analysis = chain.indexOf('--wm-analysis-');
      const legacy = chain.indexOf('--webscore-analyze-');
      expect(harmony, `${token} has no --wm-harmony-* layer`).toBeGreaterThan(-1);
      expect(analysis, `${token} has no --wm-analysis-* layer`).toBeGreaterThan(-1);
      expect(legacy, `${token} has no --webscore-analyze-* layer`).toBeGreaterThan(-1);
      // Outermost wins in CSS, so a later index is a deeper fallback.
      expect(harmony).toBeLessThan(analysis);
      expect(analysis).toBeLessThan(legacy);
    }
  });

  it('ends every documented chain at the byte the docs page prints', () => {
    for (const [token, expected] of Object.entries(LIGHT_DEFAULT)) {
      expect(terminalLight(harmonyTokens[token]!), `${token} moved its light default`).toBe(
        expected,
      );
    }
    // The border is a shorthand, so it delegates its colour rather than
    // carrying one — that is what keeps `-border` and `-rule` distinguishable.
    expect(harmonyTokens['--wui-harmony-border']).toContain('1px solid var(--wui-harmony-line)');
  });

  it('keeps selected text independent from a transparent background', () => {
    for (const chain of [harmonyTokens['--wui-harmony-on-accent']!, harmonyValues.onAccent]) {
      expect(chain).toContain('--wm-accent-foreground');
      expect(chain).toContain('--cp-accent-foreground');
      expect(chain).not.toContain('--wm-analysis-background');
      expect(chain).not.toContain('--webscore-analyze-bg');
      expect(chain).not.toContain('--wm-surface');
    }
  });

  it('darkens the one light literal it deliberately moved', () => {
    // #d98c00 on white is 2.73:1, under the 3:1 floor for a graphic — and the
    // severity bead IS the graphic that tells a warning row from an error one.
    expect(harmonyTokens['--wui-harmony-warning']).not.toContain('#d98c00');
    expect(terminalLight(harmonyTokens['--wui-harmony-warning']!)).toBe('#a86a00');
    expect(severityFill('warning')).toContain('#a86a00');
  });

  it('resolves light and dark from one value rather than a media query', () => {
    // The inline path cannot carry an @media block, so the scheme has to live
    // in the value. Every token that ends at a COLOUR ends at a light-dark().
    for (const [token, chain] of Object.entries(harmonyTokens)) {
      if (!/#[0-9a-f]{3,8}|rgba?\(/.test(chain)) continue;
      expect(chain, `${token} has a literal colour outside a light-dark()`).toContain('light-dark(');
    }
    // The two that defer to the page instead of answering: a card that painted
    // its own opaque ground would stop being able to sit on the host's.
    expect(harmonyTokens['--wui-harmony-ink']).not.toContain('light-dark(');
    expect(harmonyTokens['--wui-harmony-surface']).not.toContain('light-dark(');
    expect(harmonyTokens['--wui-harmony-pad']).not.toContain('light-dark(');
  });

  it('never lets a PAINT bottom out at a CSS-wide keyword', () => {
    // A var() that substitutes `inherit` is invalid at computed-value time, so
    // the property falls back to its inherited value: `fill` paints black and
    // `stroke` paints nothing. A rule can afford to defer to the page; an SVG
    // presentation attribute cannot, which is the whole reason `paint` exists
    // beside `ink`. Chrome, unthemed page: `stroke` reads `none` and `fill`
    // reads `rgb(0, 0, 0)` the moment a paint ends at `inherit`.
    for (const [name, value] of Object.entries(harmonyValues)) {
      if (name === 'ink' || name.startsWith('font')) continue;
      expect(value, `harmonyValues.${name} defers instead of painting`).not.toMatch(
        /\b(?:inherit|initial|unset|revert|revert-layer)\b/,
      );
    }
    expect(harmonyTokens['--wui-harmony-paint']).not.toContain('inherit');
    expect(harmonyValues.paint).toContain('--wui-harmony-paint');
    // The deferring twin is still there, and still defers.
    expect(harmonyValues.ink).toContain('inherit');
  });

  it('leaves the colour scheme to the host unless a caller pins it', () => {
    // `inherit` declares nothing: on a light-only page every light-dark() below
    // stays light, which is why the defaults above can be believed.
    expect(harmonyScheme.inherit).toEqual({});
    expect(harmonyScheme.system['color-scheme']).toBe('light dark');
    expect(harmonyScheme.light['color-scheme']).toBe('light');
    expect(harmonyScheme.dark['color-scheme']).toBe('dark');
  });

  it('gives both densities the same five sizes and five geometries', () => {
    expect(Object.keys(harmonyDensity.compact)).toEqual(Object.keys(harmonyDensity.comfortable));
    for (const [token, value] of Object.entries(harmonyDensity.compact)) {
      // A host that names a size explicitly outranks the density default.
      expect(value).toContain(PREDECESSOR[token]!);
      expect(value).not.toBe(harmonyDensity.comfortable[token]);
    }
  });

  it('gives both motion budgets the same durations to spend', () => {
    expect(Object.keys(harmonyMotion.reduced)).toEqual(Object.keys(harmonyMotion.full));
    for (const value of Object.values(harmonyMotion.reduced)) expect(value).toBe('0s');
  });

  it('composes a root in the one order where an override wins', () => {
    // `harmonyTokens` embeds the comfortable density so it is complete alone,
    // which makes `harmonyInline(harmonyDensity.compact, harmonyTokens)` a
    // silent no-op. This is the composer that cannot be held wrong way round.
    const comfortable = harmonyRootDeclarations();
    const compact = harmonyRootDeclarations({density: 'compact', motion: 'reduced'});
    expect(comfortable['--wui-harmony-size-body']).toBe(
      harmonyDensity.comfortable['--wui-harmony-size-body'],
    );
    expect(compact['--wui-harmony-size-body']).toBe(
      harmonyDensity.compact['--wui-harmony-size-body'],
    );
    expect(compact['--wui-harmony-motion-tone']).toBe('0s');
    expect(comfortable['color-scheme']).toBeUndefined();
    expect(harmonyRootDeclarations({scheme: 'dark'})['color-scheme']).toBe('dark');
  });
});

describe('the tone-role palette', () => {
  it('answers every role from the degree tokens', () => {
    for (const role of ROLES) {
      expect(toneFill(role)).toContain(`var(--wui-degree-${role},`);
      expect(harmonyTokens[`--wui-degree-${role}`]).toBeTruthy();
    }
    expect(toneFill(undefined)).toBe(toneFill('other'));
    expect(toneInk('root')).toContain('var(--wui-degree-ink,');
    // A ghost is a wash rather than a fill, so it takes the surrounding ink.
    expect(toneInk('ghost')).toContain('var(--wui-harmony-ink-muted,');
  });

  it('still paints when the host node carries no tokens at all', () => {
    // `mountKeyboard(someDiv, …)` is a supported call, and there the degree
    // tokens are undeclared. A bare `var(--wui-degree-root)` would be invalid
    // at computed-value time and the key would come out INVISIBLE, so every
    // read carries the public token and the literal behind it.
    for (const role of ROLES) {
      const fill = toneFill(role);
      expect(fill, `${role} has no --wm-* layer`).toContain(`var(--wm-degree-${role},`);
      expect(fill, `${role} has no literal behind it`).toMatch(/light-dark\(/);
    }
    expect(toneInk('root')).toContain('var(--wm-degree-ink,');
    for (const slot of [0, 5, 11]) {
      expect(progressionTone(slot)).toContain(`var(--wm-progression-tone-${slot},`);
    }
    // Out-of-range and non-numeric pitch classes wrap rather than throw.
    expect(progressionTone(12)).toBe(progressionTone(0));
    expect(progressionTone(-1)).toBe(progressionTone(11));
    expect(progressionTone(Number.NaN)).toBe(progressionTone(0));
  });

  it('prints an ASCII mark beside every colour', () => {
    const marks = [...ROLES.map(toneMark), toneMark(undefined)];
    expect(marks).toEqual(['R', '3', '5', '7', '9', 'B', '.', '.', '.']);
    for (const mark of marks) {
      expect(mark.length).toBe(1);
      // The kit may not contain a notation glyph, and colour alone may not
      // carry a fact — so the second channel has to survive a grayscale print.
      expect(mark.codePointAt(0)!).toBeLessThanOrEqual(0x7e);
      expect(mark.codePointAt(0)!).toBeGreaterThanOrEqual(0x20);
    }
  });
});

describe('the generated strings', () => {
  it('terminates every inline declaration list', () => {
    for (const [name, part] of Object.entries(harmonyParts)) {
      const inline = harmonyInline(part);
      expect(inline.endsWith(';'), `${name} does not end with a semicolon`).toBe(true);
      expect(inline.includes(';;'), `${name} contains an empty declaration`).toBe(false);
    }
  });

  it('namespaces its own selectors away from the docs stylesheet', () => {
    for (const selector of harmonyStyle.matchAll(/\.(wui-[a-z0-9-]+)/g)) {
      expect(selector[1]).toMatch(/^wui-harmony/);
    }
    for (const selector of analysisStyle.matchAll(/\.(wui-[a-z0-9-]+)/g)) {
      expect(selector[1]).toMatch(/^wui-analysis/);
    }
  });

  it('switches on the class the root actually carries', () => {
    // A sheet whose state rules named a class nothing stamps would look
    // installed and do nothing at all.
    const {className} = createAnalysisRoot(document);
    for (const attribute of ['[data-density="compact"]', '[data-scheme="dark"]']) {
      expect(analysisStyle).toContain(`.wui-analysis${attribute}`);
    }
    expect(className.split(' ')).toContain('wui-analysis');
    expect(analysisStyle).toContain('prefers-reduced-motion');
    expect(harmonyStyle).toContain('[data-density="compact"]');
    expect(harmonyStyle).toContain('prefers-reduced-motion');
  });
});

describe('the analysis root', () => {
  it('defers to the page it was dropped into', () => {
    // Every value below was the rendered default before the token record
    // existed. A refactor that moved them would be a redesign with no notice.
    const root = createAnalysisRoot(document);
    expect(root.style.getPropertyValue('color-scheme')).toBe('');
    expect(root.style.background).toContain('transparent');
    expect(root.style.color).toContain('inherit');
    expect(root.style.fontFamily).toContain('inherit');
    expect(root.style.padding).toContain('.75rem');
    expect(root.style.border).toContain('1px solid var(--wm-border, #d8d8d8)');
  });
});

describe('the playhead highlight', () => {
  /**
   * The regression this commit fixes. The active style begins with
   * `background:`, and it is concatenated onto the idle string a renderer
   * stamped. While the idle strings did not end with a semicolon the join
   * produced one malformed declaration, and a browser dropped BOTH the idle
   * string's last declaration and the active background — leaving only the
   * outline, which is why every `.includes('outline')` assertion kept passing.
   */
  it('carries the background it always claimed to, not just the outline', () => {
    const root = createAnalysisRoot(document);
    renderChordTimeline([{chord: 'C', startQuarters: 0, endQuarters: 4}], root);
    const row = root.querySelector<HTMLElement>(ANALYSIS_SPAN_SELECTOR)!;

    const idle = readAnalysisIdleStyle(row)!;
    expect(idle.endsWith(';')).toBe(true);
    // The last declaration of the idle string is the one the join used to eat.
    expect(row.style.fontSize).toBeTruthy();

    createAnalysisPlayhead(root, {scroll: false}).update(1);
    // `cssText` containing the substring proves nothing — in a real engine the
    // malformed join contained it too. Only the parsed property does.
    expect(row.style.background).toBeTruthy();
    expect(row.style.outline).toContain('2px');
    // The idle box survives underneath the highlight.
    expect(row.style.display).toBe('flex');
    expect(row.style.fontSize).toBeTruthy();
  });

  it('stamps a terminated idle style on every span-carrying renderer', () => {
    const root = createAnalysisRoot(document);
    renderChordTimeline([{chord: 'C', startQuarters: 0, endQuarters: 4}], root);
    renderRomanStrip(
      {tonic: 'C', mode: 'major', confidence: 1, scores: []},
      [{chord: 'C', roman: 'I', startQuarters: 0, endQuarters: 4}],
      root,
    );
    renderMotifList([{intervals: [2], rhythm: [1], occurrences: [{startQuarters: 0}]}], root);
    renderVoiceLeadingList(
      [{type: 'parallel-fifths', severity: 'warning', voices: ['s', 'a'], startQuarters: 0, endQuarters: 1}],
      root,
    );

    const nodes = [...root.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)];
    expect(nodes.length).toBe(4);
    for (const node of nodes) {
      const idle = readAnalysisIdleStyle(node);
      expect(idle, 'a span-carrying node stamped no idle style').toBeTruthy();
      expect(idle!.endsWith(';')).toBe(true);
    }

    const playhead = createAnalysisPlayhead(root, {scroll: false});
    playhead.update(0.5);
    for (const node of nodes) expect(node.style.background).toBeTruthy();
    // And the highlight leaves nothing of itself behind when it moves on.
    playhead.clear();
    for (const node of nodes) {
      expect(node.style.background).toBe('');
      expect(node.style.outline).toBe('');
    }
  });
});
