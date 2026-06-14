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

### Neue Montreal — Sole typeface across all UI and editorial text. Used at weight 400 for body and nav, weight 700 reserved for emphasis words inside body copy and the rare bolded phrase. The 105–136px display sizes are the signature — nearly line-height 1.0 with -0.02em tracking makes the headlines feel like they are pressed against the canvas, not floating above it. · `--font-neue-montreal`
- **Substitute:** Inter (close proportional alternative), Manrope, Söhne
- **Weights:** 400, 700
- **Sizes:** 14, 15, 17, 18, 20, 21, 22, 32, 33, 36, 56, 105, 136
- **Line height:** 1.00, 1.01, 1.13, 1.17, 1.20, 1.24, 1.50
- **Letter spacing:** -0.02em at 56px and above (display and large headings), -0.01em at 32–36px (subheadings), 0 at 14–22px (body and nav), +0.01 to +0.02em occasionally on small labels
- **Role:** Sole typeface across all UI and editorial text. Used at weight 400 for body and nav, weight 700 reserved for emphasis words inside body copy and the rare bolded phrase. The 105–136px display sizes are the signature — nearly line-height 1.0 with -0.02em tracking makes the headlines feel like they are pressed against the canvas, not floating above it.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 14px | 1.5 | — | `--text-caption` |
| body-lg | 18px | 1.5 | — | `--text-body-lg` |
| subheading | 22px | 1.2 | — | `--text-subheading` |
| heading-sm | 36px | 1.17 | -0.01px | `--text-heading-sm` |
| heading | 56px | 1.13 | -0.02px | `--text-heading` |
| display | 105px | 1 | -0.02px | `--text-display` |
| display-xl | 136px | 1 | -0.02px | `--text-display-xl` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 40 | 40px | `--spacing-40` |
| 56 | 56px | `--spacing-56` |
| 60 | 60px | `--spacing-60` |
| 64 | 64px | `--spacing-64` |
| 72 | 72px | `--spacing-72` |
| 108 | 108px | `--spacing-108` |

### Border Radius

| Element | Value |
|---------|-------|
| nav | 5px |
| other | 15px |
| buttons | 0px |
| sections | 0px |

### Layout

- **Section gap:** 108px
- **Card padding:** 20px
- **Element gap:** 15-20px

## Components

### Outlined Ghost Button
**Role:** Sole interactive control shape — used for CONTACT in the nav and any primary action

Transparent background, 1px border in #fffdf9 (or #6f879c for the accent variant), 0px border-radius (perfectly rectangular), text in #fffdf9 at 14–15px weight 400 with slight tracking. Padding roughly 9px vertical, 15px horizontal. No fill on hover — the border may shift to #6f879c. All-caps tracking-tight label.

### Top Navigation Bar
**Role:** Persistent site navigation

Full-width transparent bar sitting on the Slate Veil canvas. Left: wordmark 'Vivid+Co' at 17–18px weight 400 in #fffdf9. Right: nav items (EXPERTISE, WORK, TEAM, CAREERS) at 14–15px weight 400 in #fffdf9, 15px horizontal gap, plus the outlined CONTACT button at the far right with 5px corner radius and 9px/15px padding. No background fill, no border, no shadow.

### Display Headline Block
**Role:** Hero and manifesto typography — the primary visual element

Single massive sentence in Neue Montreal weight 400 at 105–136px, line-height 1.0, letter-spacing -0.02em, color #fffdf9. Sits on Slate Veil with no background container. Often overlaps or sits beside 3D glass-prism decorative graphics. Specific words may carry weight 700 for emphasis.

### Manifesto Paragraph
**Role:** Long-form editorial statement on the page

Multi-line block of display-weight text (56–105px) at line-height ~1.13, color #fffdf9, left-aligned, sitting directly on the dark canvas. No card, no background — the text IS the section.

### Supporting Subhead
**Role:** Small lead-in sentence above a display headline

Body-size Neue Montreal weight 400 at 18–22px in #fffdf9, sitting above a display headline. Tightly kerned, single or two lines, no label styling.

### 3D Glass Prism Graphic
**Role:** Decorative signature visual — the only non-typographic graphic

Photorealistic rendered glass/crystal shapes with chromatic-aberration refractions (rainbow edges in red, blue, green). Placed overlapping or behind display headlines, masked with soft vignetting into the Slate Veil background. Black and white base tones with iridescent color leaks. No flat illustration or vector — always photoreal 3D render.

### List Item (Nav/Inline)
**Role:** Vertical or inline lists of links or items

Neue Montreal weight 400 at 15–17px in #fffdf9. Items separated by 7–15px vertical gap. No bullet markers, no underlines unless hover state.

### Icon Glyph
**Role:** Decorative or functional inline icons (small set)

Monochrome outline-style glyphs in #fffdf9 or #6f879c, stroke weight ~1px, no fill. Rarely used — the site prefers type and 3D art over iconography. Hairline border treatment mirrors the outlined button.

## Do's and Don'ts

### Do
- Set every section directly on the #495764 Slate Veil canvas — never wrap content in card or panel containers.
- Use Neue Montreal at 105–136px for display headlines with line-height 1.0 and -0.02em letter-spacing.
- Keep the color palette to three roles: #fffdf9 for text, #495764 for canvas, #6f879c for the single accent on borders and ghost controls.
- Build buttons as perfect rectangles (0px radius) with 1px outlined borders — never filled with a chromatic background.
- Let display headlines sit on line-height 1.0–1.13 so the text appears pressed against the canvas, not floating.
- Use 3D glass-prism renders as the only decorative imagery — never flat illustration, stock photography, or icon-heavy graphics.
- Apply weight 400 universally for body and headlines; reserve weight 700 for emphasis words inside body sentences.

### Don't
- Don't introduce a chromatic filled button background — the system is outlined-ghost only.
- Don't add card surfaces, rounded panels, or box-shadow elevation — depth comes from type and 3D art, not from container chrome.
- Don't use colors outside the six defined tokens — no gradients, no additional accent hues, no semantic green/red/yellow indicators.
- Don't set body text below 14px or above 22px — the system jumps from body directly to display scale.
- Don't use border-radius above 15px on any element — most components are 0px or 5px, the 15px is reserved for a single accent shape.
- Don't use pure #ffffff — always use the warm #fffdf9 for foreground.
- Don't use solid icon fills or colored icon glyphs — icons are hairline outlines in #fffdf9 or #6f879c only.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Slate Veil Canvas | `#495764` | Page background for every section. Full-bleed, no card treatment. |
| 2 | Carbon Recess | `#101010` | Optional deeper surface for inset blocks, darker text blocks, or decorative gradients — used rarely to add depth variation. |

## Elevation

The system deliberately avoids shadows and elevation. Depth comes from typographic scale, 3D glass-prism decorative graphics, and the off-white-on-slate contrast — never from box-shadow stacks or elevated card surfaces. Sections sit directly on the canvas with no panel borders.

## Imagery

Imagery is dominated by photorealistic 3D renders of glass prisms and crystal shapes with chromatic-aberration refractions — rainbow edge leaks in red, blue, and green bleed from otherwise clear glass forms. These sit overlapping or behind display headlines, partially masked into the dark canvas with soft vignetting. There is no photography of people, places, or products. No flat illustration, no vector graphics, no icon sets beyond small monochrome glyphs. The 3D prisms ARE the hero visual — they carry the 'Vivid' brand name literally through their prismatic light-play. Image treatment: full-bleed, mask-faded edges, dark and moody base with vivid color leaks, contained only by the editorial type composition they sit within.

## Layout

Full-bleed dark canvas with no maximum content width — sections span the entire viewport. The first screen is a centered or slightly-left-offset display headline (105–136px) sitting beside/behind a 3D glass prism, with a small supporting paragraph bottom-right. Below: a second full-bleed dark section with a smaller lead-in sentence top-left and a multi-line display manifesto occupying the center. No card grids, no feature blocks, no pricing tables — the page is a vertical sequence of full-viewport editorial compositions. Vertical rhythm is extremely spacious (~108px section gaps), and there are no light/dark alternations because the entire page stays on the single Slate Veil canvas. Navigation is a minimal transparent top bar with wordmark left and 4 nav links + outlined CONTACT button right. The page model is essentially a typography magazine: one dark page, many large passages of type, sparse 3D visual punctuation.

## Agent Prompt Guide

Quick Color Reference:
- text: #fffdf9
- background: #495764
- border / accent: #6f879c
- nav border: #fffdf9
- primary action: #6f879c (outlined action border)

Example Component Prompts:

1. Create a full-bleed hero section: #495764 background spanning the full viewport. Display headline at 136px Neue Montreal weight 400, color #fffdf9, line-height 1.0, letter-spacing -0.02em, left-aligned. One word within the headline switches to weight 700. A 3D glass-prism render sits behind the right portion of the text, partially masked with soft vignetting.

2. Create a top navigation bar: transparent background, full width. Left: wordmark 'Vivid+Co' at 18px Neue Montreal weight 400, #fffdf9. Right: four nav links at 14px weight 400, #fffdf9, 15px horizontal gap, all-caps. Far right: outlined ghost button labeled 'CONTACT' with 1px #fffdf9 border, 0px radius, 9px vertical / 15px horizontal padding, #fffdf9 text at 14px.

3. Create a manifesto paragraph section: #495764 canvas, left-aligned block of display text at 56px Neue Montreal weight 400, #fffdf9, line-height 1.13, letter-spacing -0.02em. Above it, a 18px supporting sentence in the same font, 1.5 line-height, #fffdf9. No card, no border, no background — text sits directly on canvas.

4. Create a 3D decorative visual element: a photorealistic rendered glass prism/crystal shape, mostly transparent with chromatic-aberration rainbow edges in red, blue, and green. Black and white base tones. Place it absolutely positioned, partially overlapping a display headline, masked with a soft radial fade into the #495764 background.

5. Create an outlined ghost button: 0px border-radius, 1px solid #fffdf9 border, transparent background, #fffdf9 text at 14px Neue Montreal weight 400, all-caps with +0.01em tracking, 9px padding top/bottom, 15px padding left/right. No shadow, no fill on any state.

## Type Pairing Logic

Neue Montreal is the only font — the system has no secondary typeface, no serif, no mono, no display alternate. Weight contrast is the only hierarchy tool: 400 carries almost everything (headlines, body, nav, labels), and 700 is used surgically for single emphasis words inside otherwise-400 sentences. This means the type system communicates not through face-switching but through extreme scale jumps — body text at 17px sits on the same canvas as 136px display, with nothing in between, creating a radical editorial tension.

## Similar Brands

- **Instrument (instrument.com)** — Same dark-canvas editorial stage with massive display type, 3D-rendered decorative graphics, and a single muted accent color for interactivity.
- **Active Theory** — Dark-mode agency site with full-bleed layouts, oversized editorial headlines, and 3D/WebGL visual elements as the primary imagery.
- **Resn** — Experimental dark-canvas agency aesthetic with large-scale typography floating on a moody background and minimal UI chrome.
- **B-Reel** — Dark editorial agency layout with big type compositions, sparing use of color, and decorative visual elements rather than card grids.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-bone-white: #fffdf9;
  --color-slate-veil: #495764;
  --color-carbon: #101010;
  --color-obsidian: #000000;
  --color-graphite: #403f3f;
  --color-gunmetal-blue: #6f879c;

  /* Typography — Font Families */
  --font-neue-montreal: 'Neue Montreal', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 14px;
  --leading-caption: 1.5;
  --text-body-lg: 18px;
  --leading-body-lg: 1.5;
  --text-subheading: 22px;
  --leading-subheading: 1.2;
  --text-heading-sm: 36px;
  --leading-heading-sm: 1.17;
  --tracking-heading-sm: -0.01px;
  --text-heading: 56px;
  --leading-heading: 1.13;
  --tracking-heading: -0.02px;
  --text-display: 105px;
  --leading-display: 1;
  --tracking-display: -0.02px;
  --text-display-xl: 136px;
  --leading-display-xl: 1;
  --tracking-display-xl: -0.02px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-40: 40px;
  --spacing-56: 56px;
  --spacing-60: 60px;
  --spacing-64: 64px;
  --spacing-72: 72px;
  --spacing-108: 108px;

  /* Layout */
  --section-gap: 108px;
  --card-padding: 20px;
  --element-gap: 15-20px;

  /* Border Radius */
  --radius-md: 5px;
  --radius-xl: 15px;

  /* Named Radii */
  --radius-nav: 5px;
  --radius-other: 15px;
  --radius-buttons: 0px;
  --radius-sections: 0px;

  /* Surfaces */
  --surface-slate-veil-canvas: #495764;
  --surface-carbon-recess: #101010;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-bone-white: #fffdf9;
  --color-slate-veil: #495764;
  --color-carbon: #101010;
  --color-obsidian: #000000;
  --color-graphite: #403f3f;
  --color-gunmetal-blue: #6f879c;

  /* Typography */
  --font-neue-montreal: 'Neue Montreal', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 14px;
  --leading-caption: 1.5;
  --text-body-lg: 18px;
  --leading-body-lg: 1.5;
  --text-subheading: 22px;
  --leading-subheading: 1.2;
  --text-heading-sm: 36px;
  --leading-heading-sm: 1.17;
  --tracking-heading-sm: -0.01px;
  --text-heading: 56px;
  --leading-heading: 1.13;
  --tracking-heading: -0.02px;
  --text-display: 105px;
  --leading-display: 1;
  --tracking-display: -0.02px;
  --text-display-xl: 136px;
  --leading-display-xl: 1;
  --tracking-display-xl: -0.02px;

  /* Spacing */
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-40: 40px;
  --spacing-56: 56px;
  --spacing-60: 60px;
  --spacing-64: 64px;
  --spacing-72: 72px;
  --spacing-108: 108px;

  /* Border Radius */
  --radius-md: 5px;
  --radius-xl: 15px;
}
```

