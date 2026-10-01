# Paylo design system

Two brand colours, a lot of cream, and one filled element per view. Tokens live in
`tailwind.config.ts`; component classes live in `app/globals.css`.

## Colour — Forest & Cream

Supersedes Cherry Cola / Cream Vanilla entirely. Values were sampled from the reference
fintech landing page, then checked against WCAG.

| Token | Hex | Role |
|---|---|---|
| `brand` | `#04380E` | **Primary accent.** Forest green: filled buttons, links, logo, active states |
| `brand-dark` | `#022707` | Hover |
| `brand-tint` | `#E3EEDF` | Rare wash behind an accented block |
| `accent` | `#00BD3E` | Bright green. **Decoration only**: dots, the logo chevron, icons, badges |
| `accent-display` | `#00A235` | Bright green for **large** headline words (≥ 24px bold) |
| `accent-deep` | `#00802A` | The readable bright-ish green when text must be green at body size |
| `night` | `#09180C` | **Dark surface.** Card-style panels, the hero phone, any dark block |
| `cream` | `#F8F4EC` | **Clean surface.** The page itself |
| `cream-deep` | `#ECE6DA` | Quiet dividers, hover fills, empty image tiles |
| `paper` | `#FFFFFF` | Cards and inputs |
| `ink` | `#0A1B0A` | Text. Near-black with a green cast, never pure black |
| `ink-soft` | `#5B6658` | Secondary text |
| `danger` | `#B42318` | The one red: errors, failures, destructive actions |
| `success` / `warn` | `#17703A` / `#8A6318` | Status only, never brand |

**Contrast (on cream unless noted).** ink 16.3:1 · brand 12.1:1 (white on brand 13.3:1) ·
ink-soft 5.5:1 · accent-deep 4.7:1 · danger 6.0:1 · accent-display 3.1:1 (large text only) ·
**accent 2.3:1, and white on accent 2.5:1** — so the bright green never carries body text
or a button label. The reference uses white-on-bright-green buttons; Paylo uses
white-on-forest instead, which reads the same at a glance and passes AA.

**Danger is its own colour now.** Under Cherry Cola the accent doubled as the destructive
colour; with a green accent that would make errors look like success, so every error,
failure, "No" badge and delete action uses `danger`.

## Type

Figtree (Google Fonts) for Latin, Cairo for Arabic, in one stack — Arabic glyphs fall
through to Cairo. Figtree is the closest freely served match to the reference's General
Sans / Switzer style (rounded geometric, double-storey a); General Sans itself is on
Fontshare, which this build cannot fetch — swap the family in `tailwind.config.ts` and the
`<link>` in `app/layout.tsx` if you self-host it.

- Display (h1): **800**, `tracking-[-0.03em…-0.04em]`, `leading-[1.02]`, forest; key words in
  `accent-display`
- Section heading: `.section-title`, 24px, **800**; h2/h3 **700**
- Stat values 700; body 16px regular, measure capped at `max-w-prose` (62ch)
- Labels: 12px, 600, uppercase, `tracking-[0.08em]`

## Space

Space is the main design element, so it gets a budget rather than leftovers. Sections
breathe at `py-20 sm:py-24`; cards pad at `p-6 sm:p-7`; step lists gap at 40px. When a
layout feels wrong, add space before adding anything else.

## Shape and depth

Radius 8–14px. **Shadows are for lift on hover only** — resting surfaces separate with a
1px `ink/10` hairline. Cream and white are close enough in value that a border reads more
cleanly than a shadow and keeps the page flat and quiet.

## Hero imagery

The landing hero is a phone showing a real Paylo storefront (`components/HeroShowcase.tsx`)
with "New order" and "Transfer confirmed" notifications arriving beside it. Product tiles
use real photographs from `public/hero/products/<key>.jpg` (also .jpeg/.webp/.png) when
present — keys: seal (candle), wave (silk scarf), count (coffee cups), peak (honey),
axis (perfume oil), arch (woven basket). Square, neutral background, at least 600px.
Without a file a tile is a plain cream block with the product name: never an illustration
standing in for a product. The old glyph system is retired.

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
