# Paylo design system

Canonical brand per Full Spec v2 §1.1. Tokens live in `tailwind.config.ts`; component
classes live in `app/globals.css`.

## Colour

| Token | Hex | Role |
|---|---|---|
| `rose` | `#E63E88` | Primary accent, large calls to action |
| `rose-600` | `#C42E71` | Small buttons and text links — see contrast note |
| `rose-700` | `#A32560` | Hover on `rose-600` |
| `rose-50` / `rose-100` | `#FDEDF4` / `#FBD9E8` | Accent tints, selected states |
| `tide` | `#384D95` | Midnight Tide: deep surfaces, secondary buttons |
| `tide-700/800/900` | `#2C3D77` / `#22305F` / `#16203F` | Hero and footer surfaces, darkest text |
| `pearl` | `#FFFFFF` | Cards, clean surfaces |
| `mist` | `#F4F5FA` | Page background |
| `ink` | `#1E2748` | Body text |
| `ink-soft` | `#5A648A` | Secondary text |
| `success` / `warn` / `danger` | `#1E9E6A` / `#B7791F` / `#D94141` | Status semantics only, never brand |

Pure black is never used; the darkest value is a Midnight Tide shade (v2 §1.1).

**Contrast.** White on `rose` measures about 3.9:1 — fine for large bold text, short of AA
for body copy. So `rose` carries big calls to action (`.btn-cta`) and `rose-600` (5.3:1)
carries small buttons and links. Do not put small white text on `rose`.

Status colours are reserved for state. A green badge always means the same thing wherever
it appears, which is why they sit outside the three brand colours.

## Type

Plus Jakarta Sans for Latin, Cairo for Arabic, both from Google Fonts. Arabic glyphs fall
through to Cairo automatically because Jakarta has none, so one stack serves both scripts.

- Display: 800 weight, `tracking-[-0.035em]`, `leading-[1.02]`
- Section heading: `.section-title` — 24px, 700
- Body: 16px, 400; secondary text in `ink-soft`
- Labels: `.label` — 12px, 600, uppercase, wide tracking
- Headlines may colour one word in `rose` (v2 §1.3)

## Shape and depth

- Radius 8–16px (v2 §7.3). Cards 16px, buttons 10–12px, badges pill.
- Three shadows only: `soft` for resting cards, `lift` for raised or hovered elements,
  `deep` for elements over a dark surface.
- Icons are geometric line art: 24px box, 1.8–2px stroke, round caps and joins, no fills.

## Components

`app/globals.css` defines `.btn-*`, `.input`, `.label`, `.card`, `.card-pad`, `.table`,
`.badge`, `.alert-*`, `.stat*`, `.link`, `.section-title`. Compose these rather than
restating colours inline, so a token change lands everywhere at once.

## Spacing and layout

4px base. Page gutters `px-4`; content `max-w-7xl` for dashboards, `max-w-3xl` for reading,
`max-w-2xl` for forms. Card padding `p-5 sm:p-6`. Grid gaps 12–20px.

Everything directional uses logical properties — `ms-*`, `me-*`, `text-start`,
`inset-inline-start` — so Arabic mirrors without a second stylesheet.

## Motion

Subtle and purposeful (v2 §7.3). Transitions 200–300ms on `transform`, `opacity`, `color`
and `box-shadow` only, never on layout properties. The hero waterfall and the loading mark
animate `transform` and `opacity` alone, and every animation is disabled under
`prefers-reduced-motion: reduce`.

## Logo

`components/Logo.tsx` renders all variants; `public/brand/` holds the static exports.

The mark is a circular containment holding an upward chevron and a dot: containment for the
"o" substitution, the chevron for dispatch and movement, the dot to stop it reading as a
plain arrow. It is vertically symmetric, so it needs no mirrored variant in RTL.

| Export | Use |
|---|---|
| `logo-primary-dark.svg` / `logo-primary-light.svg` | Horizontal lockup |
| `icon-square-*.svg`, `icon-circle-*.svg` | App icon and favicon |
| `icon-transparent.svg` | Placement over an existing surface |
| `logo-mono-*.svg`, `icon-mono-*.svg` | Single-colour for print and constrained contexts |

In React: `<LogoMark />`, `<Logo onDark />`, `<WordmarkWithMark />` for the headline
treatment, `<LogoLoader />` for loading states.

Minimum icon size 24px. Clear space on all sides equals the ring's stroke width. Never
recolour the mark outside the palette, stretch it, or add effects.
