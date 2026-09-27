---
source: original-b90212e1cd1e815c834849d4ad873081.jpeg
name: this is a travel image-derived design system
surface: mobile travel app
---

# Image-Derived Design System

Soft sage travel UI with ivory cards, dark pine navigation, rounded mobile shells, compact pills, and photo-led itinerary cards.

## Core Tokens

```css
:root {
  --bg: oklch(100% 0.00011 271.152);
  --surface: oklch(98.94% 0.0119 101.5);
  --fg: oklch(19.54% 0.0182 137.9);
  --muted: oklch(49.83% 0.0184 154.1);
  --border: oklch(90.54% 0.0172 145.4);
  --accent: oklch(76.19% 0.1405 98.4);
}
```

`--bg` is deliberately pure white, not the original pale sage. The canvas reads as blank
paper so destination photography carries all the colour; sage survives in the supporting
roles below instead.

## Token Discipline

**Raw colour literals belong in exactly two places: the `:root` block in `src/index.css`
and the `[data-theme="dark"]` block in `src/App.css`.** Everywhere else — component CSS,
`style={{}}` props — a colour is a `var(--token)` reference. `scripts/check-colors.mjs`
enforces this on `npm run lint`; known exceptions are listed in
`scripts/color-baseline.json`.

One class is legitimately exempt, because a token would misrepresent it:

- **Translucent scrims** — `rgba(255,255,255,α)` overlays that lift text off a gradient
  or photo. These are alpha, not a palette colour, so they are baselined.

Prefer a new token over a `!important` patch. If a component needs different ink in dark
mode, the fix is the role token that already exists for that surface, not a
`[data-theme="dark"]` override that hardcodes a colour.

### What the guard does and does not cover

`scripts/check-colors.mjs` scans `*.css` outside the token blocks, plus literals inside
`style={{ }}` props in `*.jsx`. Known gaps, so nothing here is assumed covered:

- `*.js`, `*.ts` and `*.html` are not scanned at all. `src/data/members.js` avatar tints
  pass because of their file extension, not because data colours are exempt.
- CSS inside a `<style>` block in a `.jsx` file is not scanned.
- Named CSS colours (`white`, `red`) are not matched.

Per-record data colours and third-party library props (Mapbox marker and paint values)
stay exempt by intent, but the guard does not detect them — it simply never looks.

## Supporting Color Notes

| Token | Source read | Usage |
| --- | --- | --- |
| `--bg` | pure white | app canvas, ambient background |
| `--surface` | warm ivory card | phone screens, sheets, cards |
| `--surface-2` | elevated ivory | raised or layered surfaces above `--surface` |
| `--bg-alt` | soft sage wash | alternate canvas band, contrasting section |
| `--fg` | near-black pine | headings, active nav, primary pills |
| `--muted` | softened green-gray | metadata, inactive text, icon labels |
| `--border` | quiet sage line | dividers, card outlines, subtle shell edges |
| `--accent` | sun yellow | highlights, saved/star state, weather glyph |

## Ink Roles

Ink is chosen by the surface it sits on, never by the theme alone. Using the wrong role
token is how dark mode loses contrast.

| Token | Sits on | Resolves to |
| --- | --- | --- |
| `--fg` | any themed surface (`--surface`, `--bg`, `--bg-alt`) | flips light/dark with the theme |
| `--accent-ink` | **solid** `--accent` fill | near-black in both themes, because `--accent` is the same sun yellow in both |
| `--surface` | solid dark fill (dark pine, brick, ink) — the established "light ink on solid fill" role | warm ivory in both themes |
| `--on-photo` | photography and translucent white scrims over photos | always `#fff`, theme-independent |

`--accent-ink` is for **solid** `--accent` fills only. The single exception is
`.styleline .tag`, whose `rgba(255,255,255,.6)` fill is light in both themes and so needs
that same dark ink.

Two further cases need a *fixed* ink, because the surface behind them does not change with
the theme:

- **Photo-backed surfaces** — `.setup-hero` (`alfama.jpg`) and `.stylecard`
  (`gradient-mesh.jpg` under a 62–80% white `::before`). These currently force
  `color: #2E2723 !important`, which is correct but hardcoded. There is **no token for
  dark ink over a photo**; `--on-photo` is the white one. Adding one is the clean fix, and
  until then any `var(--fg)` set beneath those overrides is inert.
- **Dark solid fills** — `.btn-primary` and friends use `#2E2723` as a *background* with
  `--surface` ink, which is the "light ink on solid fill" role and is correct.

`--accent-ink` is **not** for text on `--accent-soft`. That token is a 16-22% translucent
wash over a themed surface, so the correct role is `--fg`, which flips with the theme.
Pairing `--accent-ink` with `--accent-soft` renders near-black on near-black in dark mode.

## Semantic States

Restrained signal colours for the swipe and task surfaces, each with a `-soft` companion
for tinted backgrounds.

| Token | Source read | Usage |
| --- | --- | --- |
| `--gerund` | quiet mint | consensus / yes |
| `--nom` | softened brick | skip / no |
| `--warn` | warm amber | split / caution |

## Typography

- **Display:** Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif
- **Body:** Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif
- **Mono:** SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace

## Observed Visual Rules

1. Use large rounded phone surfaces with 28-36px radii, but keep internal cards and controls closer to 8-18px depending on density.
2. Treat photography as the emotional anchor: destination cards use full-bleed natural scenes with readable overlays and compact itinerary metadata.
3. Navigation is dark pine with small filled icons; active states use a small sun-yellow or light-sage signal rather than broad color fills.
4. Controls are capsule-like, dense, and tactile: category chips, floating icon buttons, date pills, and compact weather badges.
5. The layout mixes stacked cards with slight physical overlap and shadow, but text stays inside its image/card bounds and never crosses an edge.

## Component Guidance

- **Buttons:** primary actions are dark pine capsules with ivory text; secondary chips are pale sage/ivory with dark text and a 1px quiet border.
- **Cards:** destination cards use 8-24px radii, soft shadows, and photo masks. Important metadata sits in small pills at the bottom edge.
- **Forms:** search is a vertical or square floating control on mobile, visually secondary to swipe/discovery content.
- **Navigation:** bottom navigation is a single dark rounded bar with five compact destinations; one selected item at a time.

## Imagery

Use crisp real travel photography: forests, alpine valleys, mountain ranges, lakes, and warm golden-hour terrain. Avoid generic illustrated landmarks, heavy filters, and over-saturated vacation stock treatments.
