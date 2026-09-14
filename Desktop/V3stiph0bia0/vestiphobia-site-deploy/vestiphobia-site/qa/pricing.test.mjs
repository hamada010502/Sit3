/**
 * Unit tests for the discount engine. Pure module, no browser — these run in
 * milliseconds and cover the arithmetic the browser tests only sample.
 */
import { priceCart, promotionNeedsConfirmation } from '../assets/js/pricing.js';
import { site } from '../site.config.js';

const cfg = { ...site.discounts, freeShippingMinPieces: site.shipping.freeShippingMinPieces };
let pass = 0;
const fails = [];

const cart = (qty, unit = 17) => ({
  pieces: qty,
  subtotal: qty * unit,
  items: [{ qty, price: unit }],
});

function eq(actual, expected, label) {
  if (actual === expected) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fails.push(`${label} — expected ${expected}, got ${actual}`);
    console.log(`  FAIL  ${label} — expected ${expected}, got ${actual}`);
  }
}

console.log('\nPricing engine');

// Bundle tiers
let r = priceCart(cart(1), { config: cfg });
eq(r.discountPercent, 0, '1 piece: no discount');
eq(r.total, 17, '1 piece: total $17');
eq(r.freeShipping, false, '1 piece: no free shipping');

r = priceCart(cart(2), { config: cfg });
eq(r.discountPercent, 5, '2 pieces: 5% off');
eq(r.total, 32.3, '2 pieces: $34 - 5% = $32.30');
eq(r.freeShipping, true, '2 pieces: free shipping');

r = priceCart(cart(3), { config: cfg });
eq(r.discountPercent, 10, '3 pieces: 10% off');
eq(r.total, 45.9, '3 pieces: $51 - 10% = $45.90');

r = priceCart(cart(10), { config: cfg });
eq(r.discountPercent, 10, '10 pieces: still 10% (top tier)');

// Returning customer
r = priceCart(cart(1), { config: cfg, isReturning: true });
eq(r.discountPercent, 5, '1 piece + returning: 5% off');
eq(r.appliedDiscount.type, 'returning', '1 piece + returning: returning discount applied');

// No stacking — the best single discount wins
r = priceCart(cart(3), { config: cfg, isReturning: true });
eq(r.discountPercent, 10, '3 pieces + returning: 10%, NOT 15% (no stacking)');
eq(r.candidates.length, 2, '3 pieces + returning: both qualify but one applies');
eq(r.appliedDiscount.type, 'bundle', '3 pieces + returning: bundle wins as the larger');

// Tie: 2 pieces (5%) vs returning (5%) — bundle wins, still 5% not 10%
r = priceCart(cart(2), { config: cfg, isReturning: true });
eq(r.discountPercent, 5, '2 pieces + returning: 5% total, not 10%');
eq(r.appliedDiscount.type, 'bundle', 'tie at 5%: bundle takes precedence');

// Promotion
r = priceCart(cart(1), { config: cfg, promotion: { percent: 15, name: 'Drop week' } });
eq(r.discountPercent, 15, 'promotion 15% applies over nothing');
r = priceCart(cart(3), { config: cfg, promotion: { percent: 15, name: 'Drop week' } });
eq(r.discountPercent, 15, 'promotion 15% beats the 10% bundle');

// Ceiling guard
eq(promotionNeedsConfirmation(15, cfg), false, '15% promotion: no extra confirmation');
eq(promotionNeedsConfirmation(25, cfg), true, '25% promotion: needs confirmation');

// Rounding never favours the discount over the merchant
r = priceCart({ pieces: 3, subtotal: 0.01, items: [] }, { config: cfg });
eq(r.discountAmount, 0, 'sub-cent discount floors to 0, never rounds up');

// Empty cart
r = priceCart({ pieces: 0, subtotal: 0, items: [] }, { config: cfg });
eq(r.total, 0, 'empty cart: total 0');
eq(r.discountPercent, 0, 'empty cart: no discount');

// Progress hints
r = priceCart(cart(1), { config: cfg });
eq(r.piecesToFreeShipping, 1, '1 piece: 1 away from free shipping');
eq(r.nextTier.percent, 5, '1 piece: next tier is 5%');
r = priceCart(cart(2), { config: cfg });
eq(r.piecesToNextTier, 1, '2 pieces: 1 away from the 10% tier');

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
