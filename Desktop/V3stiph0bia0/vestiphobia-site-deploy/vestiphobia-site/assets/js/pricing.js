/**
 * VESTIPHOBIA — discount engine.
 *
 * ONE implementation, imported by both the Node build and the browser, so the
 * price a customer sees can never drift from the price the order records.
 * It is pure: no DOM, no storage, no network — which is also what makes it
 * directly unit-testable.
 *
 * RULES (confirmed by the owner)
 *   1 piece   → normal price
 *   2 pieces  → 5% off merchandise
 *   3+ pieces → 10% off merchandise
 *   2+ pieces → free shipping
 *   returning customer → 5% off (only after a previous order reached DELIVERED)
 *
 * Discounts DO NOT STACK. Exactly one percentage applies: the largest the
 * customer qualifies for. Ties go to the bundle, because it is the one the
 * customer can see themselves earning in the cart.
 */

/** Money is held in whole cents internally to avoid float drift. */
const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => c / 100;

/**
 * Round a percentage off a cent amount. Rounds the DISCOUNT down (floor), so
 * the rounding error can never favour the discount over the merchant by a
 * fraction of a cent.
 */
const percentOff = (cents, percent) => Math.floor((cents * percent) / 100);

/**
 * @param {object}  cart              { items: [{ qty, price }], pieces, subtotal }
 * @param {object}  opts
 * @param {object}  opts.config       site.discounts
 * @param {boolean} opts.isReturning  a previous order for this phone is DELIVERED
 * @param {object}  opts.promotion    optional { code, percent, name } already validated
 *
 * @returns {{
 *   pieces, subtotal, discountPercent, discountAmount, total,
 *   appliedDiscount: null | { type, percent, label },
 *   candidates: Array<{ type, percent, label }>,
 *   freeShipping: boolean,
 *   piecesToFreeShipping: number,
 *   piecesToNextTier: number|null,
 *   nextTier: object|null
 * }}
 */
export function priceCart(cart, { config, isReturning = false, promotion = null } = {}) {
  const cfg = config || {};
  const tiers = [...(cfg.bundleTiers || [])].sort((a, b) => b.minQty - a.minQty);
  const pieces = Number(cart.pieces) || 0;
  const subtotalCents = toCents(cart.subtotal || 0);

  // Every discount the customer qualifies for. Only one will be applied.
  const candidates = [];

  const tier = tiers.find((t) => pieces >= t.minQty);
  if (tier) candidates.push({ type: 'bundle', percent: tier.percent, label: tier.label });

  if (isReturning && cfg.returningCustomerPercent > 0) {
    candidates.push({
      type: 'returning',
      percent: cfg.returningCustomerPercent,
      label: `Returning customer — ${cfg.returningCustomerPercent}% off`,
    });
  }

  if (promotion && promotion.percent > 0) {
    candidates.push({
      type: 'promotion',
      percent: promotion.percent,
      label: promotion.name || `Promotion — ${promotion.percent}% off`,
      code: promotion.code || null,
    });
  }

  // No stacking: take the single best. `bundle` first on a tie because a
  // customer can watch themselves earn it by adding a piece.
  const order = { bundle: 0, promotion: 1, returning: 2 };
  const applied =
    candidates.length === 0
      ? null
      : candidates.slice().sort((a, b) => b.percent - a.percent || order[a.type] - order[b.type])[0];

  const discountCents = applied ? percentOff(subtotalCents, applied.percent) : 0;
  const totalCents = subtotalCents - discountCents;

  const minFree = cfg.freeShippingMinPieces ?? 2;
  const nextTier = tiers.filter((t) => pieces < t.minQty).sort((a, b) => a.minQty - b.minQty)[0] || null;

  return {
    pieces,
    subtotal: fromCents(subtotalCents),
    discountPercent: applied ? applied.percent : 0,
    discountAmount: fromCents(discountCents),
    total: fromCents(totalCents),
    appliedDiscount: applied,
    candidates,
    freeShipping: pieces >= minFree,
    piecesToFreeShipping: Math.max(0, minFree - pieces),
    piecesToNextTier: nextTier ? nextTier.minQty - pieces : null,
    nextTier,
  };
}

/**
 * Guard for Admin-created promotions. A percentage above the configured
 * ceiling is not silently applied — it needs an explicit confirmation flag,
 * so a mistyped "50" cannot quietly sell the drop at half price.
 */
export function promotionNeedsConfirmation(percent, config) {
  const ceiling = config?.maxPercentWithoutConfirmation ?? 20;
  return Number(percent) > ceiling;
}

/** Human-readable line for the cart/checkout summary. */
export function discountLabel(result) {
  if (!result.appliedDiscount) return null;
  const { label, percent } = result.appliedDiscount;
  return label || `${percent}% off`;
}

export default priceCart;
