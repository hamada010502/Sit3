/* eslint-disable @next/next/no-img-element */
/**
 * Animated product-card "waterfall" for the landing hero (mechanic modeled on shopier.com, re-skinned for Paylo).
 * Pure CSS keyframes on `transform` only (see .wf-* rules in app/globals.css) — no JS animation.
 * Swap the placeholder artwork below for real product photos without touching layout.
 */
export interface HeroProduct { name: string; image: string; bg: string }

const PALETTE = ['#FFA364', '#FC7643', '#FFEBD2'] as const; // card backgrounds cycle through these only

const NAMES: [string, string][] = [
  ['Pistachio baklava', 'baklava'], ['Roasted mixed nuts', 'nuts'], ['Damascus rose candle', 'candle'], ['Olive oil soap', 'soap'],
  ['Embroidered tote', 'tote'], ['Ceramic coffee cups', 'cups'], ['Silk scarf', 'scarf'], ['Aleppo pepper', 'pepper'],
  ['Handmade earrings', 'earrings'], ['Linen shirt', 'shirt'], ['Woven basket', 'basket'], ['Copper tray', 'tray'],
];
export const products: HeroProduct[] = NAMES.map(([name, key], i) => ({ name, image: `/hero/${key}.svg`, bg: PALETTE[i % PALETTE.length] }));

const COLUMNS = 4;
const CARDS_PER_COLUMN = 6;                 // one loop half must be taller than the visible area for a seamless loop
const SPEEDS_S = [28, 36, 44, 32];          // different speeds per column for depth
const OFFSETS_PX = [0, -160, -70, -230];    // vertical stagger per column

function Card({ p }: { p: HeroProduct }) {
  return (
    <div className="wf-card" style={{ background: p.bg }}>
      <img src={p.image} alt="" decoding="async" draggable={false} />
    </div>
  );
}

/** Desktop / tablet: tilted columns scrolling downward forever. Renders nothing visible below `md`. */
export function HeroCardWaterfall({ items = products }: { items?: HeroProduct[] }) {
  const columns = Array.from({ length: COLUMNS }, (_, c) =>
    Array.from({ length: CARDS_PER_COLUMN }, (_, k) => items[(c + k * COLUMNS) % items.length]),
  );
  return (
    <div className="wf-wrap" aria-hidden="true">
      <div className="wf-grid">
        {columns.map((col, i) => (
          <div key={i} className="wf-col" style={{ animationDuration: `${SPEEDS_S[i]}s`, marginTop: OFFSETS_PX[i] }}>
            {[...col, ...col].map((p, j) => <Card key={j} p={p} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mobile: one horizontal strip scrolling sideways with the same seamless technique. */
export function HeroCardStrip({ items = products }: { items?: HeroProduct[] }) {
  return (
    <div className="wf-strip-wrap" aria-hidden="true">
      <div className="wf-strip">
        {[...items, ...items].map((p, j) => <Card key={j} p={p} />)}
      </div>
    </div>
  );
}
