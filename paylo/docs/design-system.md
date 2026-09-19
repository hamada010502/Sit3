# Paylo design system

Two brand colours, a lot of cream, and one filled element per view. Tokens live in
`tailwind.config.ts`; component classes live in `app/globals.css`.

## Colour

| Token | Hex | Role |
|---|---|---|
| `cherry` | `#9A0002` | Cherry Cola. The single accent: primary buttons, links, glyph accents |
| `cherry-dark` | `#7A0002` | Hover |
| `cherry-tint` | `#F4E4E2` | Rare wash behind an accented block |
| `cream` | `#EFE6DE` | Cream Vanilla. The page itself, and the whitespace |
| `cream-deep` | `#E3D8CE` | Quiet dividers and hover fills |
| `paper` | `#FFFFFF` | Cards and inputs, so they lift off cream without a shadow |
| `ink` | `#2A1A17` | Body text. A very dark warm brown, never black |
| `ink-soft` | `#6B5A54` | Secondary text |
| `success` / `warn` | `#2F6B4F` / `#8A6318` | Status only, never brand |

**Contrast.** White on Cherry Cola is 8.8:1 and Cherry Cola on Cream Vanilla is 7.2:1, so
the accent works as both a filled button and body-size text. Ink on cream is 13.5:1 and
ink-soft is 5.3:1. Every pairing in the system clears AA without special cases, which is
what a two-colour palette buys you.

**There is no second red.** Destructive actions reuse `cherry` as an outline
(`.btn-danger`), so a delete never competes with the primary call to action on the same
screen. A filled cherry button always means "the main thing to do here".

## Type

Plus Jakarta Sans for Latin, Cairo for Arabic. Arabic glyphs fall through to Cairo
automatically because Jakarta has none, so one stack serves both scripts.

- Display: 600 weight, `tracking-[-0.035em]`, `leading-[1.04]`. Semibold, not extrabold —
  at this size weight reads as shouting.
- Section heading: `.section-title`, 24px, 600
- Body 16px, measure capped at `max-w-prose` (62ch)
- Labels: 12px, 600, uppercase, `tracking-[0.08em]`

## Space

Space is the main design element, so it gets a budget rather than leftovers. Sections
breathe at `py-20 sm:py-24`; cards pad at `p-6 sm:p-7`; step lists gap at 40px. When a
layout feels wrong, add space before adding anything else.

## Shape and depth

Radius 8–14px. **Shadows are for lift on hover only** — resting surfaces separate with a
1px `ink/10` hairline. Cream and white are close enough in value that a border reads more
cleanly than a shadow and keeps the page flat and quiet.

## Glyphs

The product cards carry an invented symbol system, not pictures. Twelve glyphs in
`public/hero/`, each composed from the same primitives — ring, bar, arc, dot, triangle,
square — on a 120 box with an 8px stroke, and each carrying exactly one cherry mark.

The product name next to the glyph carries the meaning; the glyph carries identity, like a
seal. That is why they are abstract: a literal drawing of a candle competes with the word
"candle" beside it and loses. Two rules when adding one: no glyph may resolve into a face,
and no glyph may use a primitive the rest of the set does not.

The logo is the same vocabulary — a ring holding a chevron and a dot — so the mark and the
cards read as one system. It is vertically symmetric, so RTL needs no mirrored variant, and
the ring lets it stand in for the "o" in headline use.

| Export | Use |
|---|---|
| `logo-primary-light.svg`, `logo-primary-cherry.svg` | Horizontal lockup |
| `icon-square-*.svg`, `icon-circle-*.svg` | App icon and favicon |
| `icon-transparent.svg` | Over an existing surface |
| `logo-mono-*.svg`, `icon-mono-*.svg` | Single colour for print and constrained contexts |

Minimum icon size 24px. Clear space equals the ring's stroke width. Never recolour outside
the palette.

## Motion

`components/Loader.tsx` — three variants (`dots`, `bar`, `grid`) sharing one exported cycle,
`AI_LOADER_CYCLE_SECONDS`. Two loaders on a screen at different tempos read as two
unrelated things loading, so anything ambient should align to the same beat:

```tsx
import Loader, { AI_LOADER_CYCLE_SECONDS } from '@/components/Loader';
```

**The bar sweeps; it never fills.** Determinate progress on a wait of unknown length
promises a finish time nobody knows. For waits that can run long, pass `showElapsed`: real
elapsed time is honest and still reassuring. Every variant is a `role="status"` with a
polite live region and a screen-reader label.

Elsewhere: transitions 200–300ms on `transform`, `opacity`, `color` and `box-shadow` only,
never on layout properties. The hero waterfall animates `transform` alone. Everything stops
under `prefers-reduced-motion: reduce`.

## Direction

Everything directional uses logical properties — `ms-*`, `me-*`, `text-start`,
`inset-inline-start` — so Arabic mirrors without a second stylesheet. The hero waterfall
tilts the opposite way under `[dir="rtl"]` and the mobile strip reverses its sweep.
