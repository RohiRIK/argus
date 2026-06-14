# Vivid+Co — Style Reference
> darkroom editorial spread

**Theme:** dark

Vivid+Co operates as a dark-canvas editorial stage where the entire interface is a single moody slate field and typography is the only subject. Massive Neue Montreal headlines at 105–136px sit directly on the dark background with no card containers, no grid scaffolding, and almost no color — the page reads like a typography magazine spread. The lone chromatic accent is a muted blue-gray (#6f879c) that appears only as hairline borders, ghost button outlines, and subtle icon strokes; warmth comes from an off-white #fffdf9 rather than from any hue. 3D glass-prism motifs float behind the text, adding depth and refraction light-play without introducing surface clutter. Components are intentionally absent in the traditional sense — sections are full-bleed type compositions, nav is a floating minimal bar, and the lone interactive shape is the rectangular outlined button. The system rewards restraint: a new page should feel like it was set on a darkroom table, not built in a component library.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Bone White | `#fffdf9` | `--color-bone-white` | Primary text, headlines, nav links, all foreground typography. The warm off-white (not pure white) is the single most-used color in the system and gives the dark canvas a paper-print feel rather than a screen-glow feel |
| Slate Veil | `#495764` | `--color-slate-veil` | Dominant page background and the base canvas. This desaturated dark blue-slate is the entire stage — every section sits on it directly with no card or panel treatment |
| Carbon | `#101010` | `--color-carbon` | Deeper accent within dark passages, occasional icon fills, and decorative surface variation. A step darker than Slate Veil for moments that need recess rather than flat canvas |
| Obsidian | `#000000` | `--color-obsidian` | Pure black used sparingly for 3D-rendered glass prism fills and icon glyphs. Anchors decorative elements against the Slate Veil canvas |
| Graphite | `#403f3f` | `--color-graphite` | Rare border and divider color for very subtle structural lines. Not used for text or backgrounds |
| Gunmetal Blue | `#6f879c` | `--color-gunmetal-blue` | The only chromatic accent in the system — appears as outlined button borders, hairline icon strokes, and selected/active states. Cool blue-gray gives interactivity a quiet presence without breaking the monochromatic mood |

## Tokens — Typography

### Neue Montreal — Sole typeface across all UI and editorial text.
Weight 400 for body and nav, weight 700 reserved for emphasis words. The 105–136px display sizes are the signature — near line-height 1.0 with -0.02em tracking makes headlines feel pressed against the canvas.
- **Substitute:** Inter, Manrope, Söhne (this project ships Geist Sans — a close grotesque)
- **Weights:** 400, 700
- **Sizes:** 14, 15, 17, 18, 20, 21, 22, 32, 33, 36, 56, 105, 136
- **Line height:** 1.00–1.50
- **Letter spacing:** -0.02em ≥56px, -0.01em 32–36px, 0 at 14–22px, +0.01–0.02em on small labels

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 14px | 1.5 | — | `--text-caption` |
| body-lg | 18px | 1.5 | — | `--text-body-lg` |
| subheading | 22px | 1.2 | — | `--text-subheading` |
| heading-sm | 36px | 1.17 | -0.01em | `--text-heading-sm` |
| heading | 56px | 1.13 | -0.02em | `--text-heading` |
| display | 105px | 1 | -0.02em | `--text-display` |
| display-xl | 136px | 1 | -0.02em | `--text-display-xl` |

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** comfortable · **Section gap:** 108px · **Card padding:** 20px

### Border Radius

| Element | Value |
|---------|-------|
| nav | 5px |
| other | 15px (single accent shape) |
| buttons | 0px |
| sections | 0px |

## Components

- **Outlined Ghost Button** — transparent bg, 1px border (#fffdf9, or #6f879c accent variant), 0px radius, bone text 14–15px/400, ~9px×15px padding. No fill; border may shift to #6f879c on hover. The sole interactive shape.
- **Top Navigation Bar** — full-width transparent, wordmark left, nav links + outlined CONTACT right. No fill, border, or shadow.
- **Display Headline Block** — single massive sentence, 105–136px/400, line-height 1.0, -0.02em, bone, on bare canvas. Emphasis words at 700.
- **Manifesto Paragraph** — 56–105px/400, line-height ~1.13, bone, left-aligned, no container.
- **Supporting Subhead** — 18–22px/400 bone above a display headline.
- **3D Glass Prism Graphic** — photoreal rendered glass/crystal with chromatic-aberration edges, masked into the canvas. The only non-typographic graphic.
- **Icon Glyph** — monochrome outline, ~1px stroke, bone or gunmetal, no fill. Used sparingly.

## Do / Don't

**Do:** set sections directly on the slate canvas; use display type at 105–136px with 1.0 line-height; keep to three color roles (bone text / slate canvas / gunmetal accent); build rectangular 0px outlined buttons; let 3D glass prisms be the only imagery; weight 400 universal, 700 for surgical emphasis.

**Don't:** introduce filled chromatic buttons; add card surfaces / rounded panels / box-shadow elevation; use colors outside the six tokens (no gradients, no extra accents); set body <14px or >22px; use radius >15px; use pure #ffffff (always bone #fffdf9); use solid/colored icon fills.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Slate Veil Canvas | `#495764` | Page background, full-bleed, no card treatment |
| 2 | Carbon Recess | `#101010` | Optional deeper inset/recess, used rarely |

## Elevation

No shadows. Depth comes from typographic scale, 3D glass-prism graphics, and bone-on-slate contrast — never box-shadow or elevated cards.

## Quick Color Reference

- text: `#fffdf9` · background: `#495764` · border/accent: `#6f879c` · nav border: `#fffdf9` · primary action: `#6f879c` outlined

---

## Argus implementation notes (pragmatic deviations)

Argus is a **functional Microsoft 365 operations dashboard**, not a marketing site, so a literal application of this editorial system is adjusted where usability demands it. Deviations, deliberately:

1. **Semantic status colors are kept, but muted into the palette.** Failed/success/suppressed runs must be scannable at a glance; success/warning/danger/info remain as low-saturation tints that sit quietly on the slate canvas rather than the spec's "no indicators" rule.
2. **Tables and the log console are kept.** Logs and report data require tabular layout and a monospace console — the spec's "no tables/cards" is relaxed to hairline-bordered, shadowless panels (no fills, no elevation) so they still read as editorial surfaces, not component-library cards.
3. **A persistent left sidebar is kept** (the app's Jenkins-style operational model) rather than a floating nav bar — rendered as a carbon recess against the slate canvas.
4. **Light mode is retained** as a bone-paper inversion of the same three-color system (the spec is dark-only; the toggle stays for accessibility).
5. **Typeface:** Geist Sans (already shipped) stands in for Neue Montreal — a close neo-grotesque. No new font dependency added.

Everything else follows the spec: slate-veil canvas, bone-white type, single gunmetal accent, 0px radius, no shadows/gradients, ghost outlined buttons, big tight headings, and 3D glass-prism imagery (the README hero/pipeline renders).
