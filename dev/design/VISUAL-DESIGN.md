# Visual design

> Required contract for every visible WebMusic UI, accepted in DEC-059: UIKit
> presenters, domain Elements that draw their own surfaces, renderers with
> controls, and the component area of documentation demos. Read it before
> writing or changing UI code, not after. [Design principles](../DESIGN-PRINCIPLES.md)
> explain why; the [UI contracts](../../packages/ui/README.md) own the token
> chain; the [frontend workflow](../../.agent/workflows/frontend-review.md) owns
> rendered acceptance.

The language is monochrome, square, minimal and quiet. Musical content — notes,
waveforms, notation, spectra — is the only thing that draws attention. Every
component looks like part of one instrument, whichever domain it belongs to.

## Before writing UI

1. Read this document, Design principles §5–7 and the UI contracts' styling model.
2. Find an existing presenter, part, token or handle in [COMPONENTS](../COMPONENTS.md)
   and reuse it. A new visual pattern needs a reason recorded in the component
   design, not just a new stylesheet.
3. Build against the tokens below, never against literal colours or sizes.
4. Verify in a browser with the checklist at the end, and compare with an
   existing component on the same page (for example the transport above it).

## Palette

Defaults are neutral greys. Each value is a fallback behind a public token, and
`light-dark()` supplies the dark-scheme pair.

| Role | Token chain | Light / dark fallback |
| --- | --- | --- |
| Ink: text, icons, pressed fills, selected marks | `--wm-foreground` | `#111` / `#eee` |
| Muted: idle icons, captions, secondary marks | `--wm-foreground-muted` | `#777` / `#aaa` |
| Lines: frames, dividers, fields | `--wm-control-border` → `--wm-border` | `#d8d8d8` / `#333` |
| Surface | `--wm-<component>-background` → `--wm-surface` | `#fff` / `#111` |
| Raised: hover fill | `--wm-surface-muted` | `#f3f3f3` / `#1c1c1c` |
| On ink: content over a pressed fill | `--wm-accent-foreground` | `#fff` / `#111` |
| Emphasis: values, fills that are on, sounding notes | `--wm-<component>-…` → `--wm-accent` | the component's own |
| Danger: errors, clipping | `--wm-<component>-error` → `--wm-danger` | `#b42318` / `#f97066` |
| Recording | `--wm-recording` | `#c62828` / `#ef5350` |
| Playhead | `--wm-<component>-playhead` → `--wm-playhead` | the component's own red |
| Scrim behind an adjustment card | `--wm-<component>-scrim` → `--wm-scrim` | 45% black |

These roles, with the geometry and type tokens below, are the theme
vocabulary (DEC-088): `THEME_TOKENS` in `@webmusic/bridge/component` lists
them for editors. A part's own token always falls back to one of them before
its literal, so setting the roles on a component, or on an app's root,
restyles every display part at once. A colour that is meaning in itself — a
piano's black keys, a loop region, a spectral map — keeps its own token and
no shared role.

Colour is reserved for meaning: a sounding note, recording, clipping, an error,
or musical data with its own palette (pitch classes, spectral maps). Do not add
a brand or accent colour, blue selection or tinted panels by default. Selection
is ink, not colour.

## Geometry

- Corners are square: `--wm-control-radius`, default `0`.
- One control height: `--wm-control-size`, default `2rem`. Buttons, fields,
  toolbar rows and card headers share it.
- Lines are 1px hairlines in the line colour. Separate groups with a hairline,
  not with spacing, shadows or nested boxes.
- One outer frame per component (`--wm-component-border`, `--wm-component-radius`),
  falling back to `1px solid var(--wm-border)`. Outer frames never fall back to
  `--wm-control-border`, which is for controls inside the frame, so every
  component edge has the same colour. Inner parts do not draw a second card.
- No shadows, gradients or blur, except the single shadow under a floating card.

## Type

- UI text uses `--wm-font-family`; values, numbers, units, short labels and
  captions use `--wm-font-mono`.
- Captions are small mono text, uppercase with wide letter spacing, in the
  muted colour.
- A component surface carries no explanatory prose: no instructions, hints,
  event logs or "how to use" lines. Instructions and live status exist for
  assistive technology only (visually hidden, `role="status"` where needed);
  explanation belongs on the documentation page.

## Controls

| Kind | Idle | Hover | Pressed or selected | Disabled |
| --- | --- | --- | --- | --- |
| Icon button | Muted icon, no fill, no border | Ink icon, raised fill | Ink fill, on-ink icon (`aria-pressed` / `aria-expanded`) | 30% opacity |
| Secondary action | 1px ink outline, mono uppercase caption | — | — | 30% opacity |
| Primary action | Ink fill, on-ink caption | — | — | 30% opacity |
| Field (input, select) | 1px line, surface fill, mono value | — | — | — |

- Focus is a 2px ink outline drawn inside the control (`--wm-focus-ring`).
- Native select arrows, rounded native controls and platform popups are
  replaced by square equivalents.
- A pressed state never relies on colour alone: it inverts fill and content.

## Icons

- Inline SVG, 24-unit view box drawn at 16px, `currentColor` stroke 1.5, no
  fill, square line caps and mitred joins.
- One meaning per icon. The name goes in `aria-label` and `title`; the icon is
  `aria-hidden`. Toolbars show icons only; a value readout (such as `1/16`) may
  sit beside its icon in mono type.
- On a page that mounts the UI Kit's tooltips (DEC-083), the name shows the
  moment the pointer rests on an icon: an ink box with on-ink mono text, square
  and without shadow, just below and right of the pointer, following it; under
  the control for keyboard focus. Never on touch. Only what shows no text gets
  a box: cards, tabs, chips, readouts and components already say what they are,
  so give them no `title` that repeats or expands their text.
- Help is a pressed-state `?` icon at the right end of an application's menu.
  While it is on, the box adds the hovered element's `aria-description`, in the
  UI font. Describe only small things and the basic layers: a tool, chip,
  filter or parameter in one plain sentence of purpose; an object as an object,
  then what this one does; a component only as a component, never with a
  summary of what it does. Pages and text navigation carry no description.

## Toolbars

- A single row along the top edge of the component window, one control height
  tall, with a hairline under it. It never wraps; on narrow hosts it scrolls
  sideways without a visible scrollbar.
- Square icon buttons sit edge to edge; groups are separated by full-height
  hairline dividers. A spacer pushes secondary panels to the right end.
- A feature the application did not enable is absent, not disabled.

## Adjustment cards

Settings that need more than one button never use native menus, popovers or
inline expanding panels. They open an adjustment card inside the component
window:

- A scrim covers the whole component: 45% black by default
  (`--wm-<component>-scrim`). The rest of the page is untouched.
- The card is square, surface-filled, framed by a hairline, below the toolbar,
  and at most about 20rem wide. Its header is one control height: a mono
  uppercase caption on the left and a close icon on the right.
- Choices are a hairline grid of square cells; the current choice is inverted.
  Forms use two columns of captioned square fields, with secondary and primary
  actions as the last row.
- The card is a modal `dialog`. Opening it moves focus to the current choice
  or first field; Tab stays inside; Escape, the close icon or a pointer on the
  scrim closes it and returns focus to its trigger. A one-shot choice applies
  and closes.

## Scrolling surfaces

- Scrolling regions inside a component hide their scrollbars
  (`scrollbar-width: none` and the WebKit equivalent) and stay operable by
  wheel, trackpad, keyboard and gestures.
- Rulers, keys, headers and lanes that label a scrolling surface are sticky
  layers, so they never move or redraw while the content scrolls.

## Documentation demos

The live canvas shows the component in its default composition with the real
controls it needs to be used (for example its transport). Component demos
have no Parameters strip, markup readout or Copy/Reset (DEC-071): the page's
reference tables document configuration, and interactive adjustment is not part
of the documentation site. The one exception is the type switch between the
panel title and the canvas: a mono uppercase attribute name, then one square
toggle per value, edge to edge, the current one inverted, for an element with
several drawings, surfaces or recipes. Components in a demo stand 0.5rem apart,
whether siblings or nested in a player, and each shows its own single frame in
the line colour. No demo-only checkboxes, hint text or event logs
inside the canvas; a failed load may show one error line. Headless demos follow
the same rule: the object works in its default configuration, with only the
controls that operate it (play, a note, an edit and its undo) in the canvas,
and no Parameters, code readout or Copy/Reset. UI Kit presenter demos keep their
external Parameters for configuration.

## Styling mechanics

- Resolve every value through `--wm-<component>-<role>` → shared `--wm-<role>`
  → the fallback above. Hard-code a literal only as the final fallback, and
  never as the only one: a token that ends in a literal without a shared role
  is a part a theme cannot reach.
- A presenter's own stylesheet, or a scoped one injected by a renderer, keeps
  rules at zero specificity with `:where()` so application CSS wins. Inline
  styles are for geometry that changes with data.
- Document every new part, token and state attribute on the owning page.

## Reference

`<score-grid-view>` ([renderer](../../packages/score/src/view/render/score-grid.ts))
implements every section above: icon toolbar, inverted pressed state, snap and
note-value adjustment cards over a scrim, hidden scrollbars and sticky keys,
ruler and lane. `<score-sheet-view>` ([renderer](../../packages/score/src/view/render/score-sheet.ts))
follows the same toolbar, card and scrollbar rules for notation editing, and
`<audio-clip-view>` ([renderer](../../packages/audio/src/view/render/audio-clip.ts))
for waveform editing, with a gain HUD instead of numeric gain fields. The transport and mixer presenters in
[UIKit](../../packages/ui/src/) show the shared control geometry and pressed
inversion.

## Acceptance checklist

- [ ] Only neutral tokens are used; colour appears only for meaning.
- [ ] Corners are square, controls share one height and lines are hairlines.
- [ ] Toolbars are one icon row with names in `aria-label` and `title`; on the
      site each name shows at once in the ink tooltip.
- [ ] Pressed and selected states invert ink; focus outlines are visible.
- [ ] Adjustments open as an in-component card over a scrim, with modal focus.
- [ ] No scrollbars are visible; labels of scrolling content are sticky.
- [ ] No explanatory text inside the component or the demo canvas.
- [ ] Element demos show the default composition without Parameters, plus a type switch when the element has several drawings, surfaces or recipes; Headless demos show the object with its defaults and no Parameters; presenter demo configuration is in Parameters.
- [ ] Checked in a browser beside an existing component, at a narrow width and
      with keyboard focus; dark-scheme fallbacks are present.
