import { getDb, newId, nowIso } from './db';
import type { Coupon } from './types';

export class CouponError extends Error {}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

export function findCoupon(sellerId: string, code: string): Coupon | undefined {
  return getDb().prepare('SELECT * FROM coupons WHERE seller_id = ? AND code = ?').get(sellerId, normalizeCode(code)) as Coupon | undefined;
}

/**
 * Discount on goods value for a coupon, or an error code the checkout can show.
 * Never exceeds the goods value minus 1 SYP, so an order always has something to
 * charge commission on and a payment to confirm.
 */
export function discountFor(c: Coupon | undefined, subtotal: number): { discount: number } | { error: 'coupon_invalid' | 'coupon_min' } {
  if (!c || !c.active) return { error: 'coupon_invalid' };
  if (c.expires_at && c.expires_at <= nowIso()) return { error: 'coupon_invalid' };
  if (c.max_uses !== null && c.used_count >= c.max_uses) return { error: 'coupon_invalid' };
  if (subtotal < c.min_subtotal) return { error: 'coupon_min' };
  const raw = c.kind === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value;
  return { discount: Math.max(0, Math.min(raw, subtotal - 1)) };
}

/** Atomic claim of one use, run inside the order transaction. False = lost the race. */
export function claimCouponUse(couponId: string): boolean {
  const r = getDb().prepare(`UPDATE coupons SET used_count = used_count + 1
    WHERE id = ? AND active = 1 AND (max_uses IS NULL OR used_count < max_uses) AND (expires_at IS NULL OR expires_at > ?)`)
    .run(couponId, nowIso());
  return r.changes === 1;
}

export function releaseCouponUse(sellerId: string, code: string | null) {
  if (!code) return;
  getDb().prepare('UPDATE coupons SET used_count = max(0, used_count - 1) WHERE seller_id = ? AND code = ?').run(sellerId, code);
}

export interface NewCoupon { code: string; kind: 'percent' | 'fixed'; value: number; minSubtotal: number; maxUses: number | null; expiresAt: string | null }

export function createCoupon(sellerId: string, input: NewCoupon): Coupon {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new CouponError('coupon_code_format');
  if (!Number.isInteger(input.value) || input.value <= 0 || (input.kind === 'percent' && input.value > 90)) throw new CouponError('coupon_value_range');
  if (findCoupon(sellerId, code)) throw new CouponError('coupon_code_taken');
  const id = newId();
  getDb().prepare('INSERT INTO coupons (id, seller_id, code, kind, value, min_subtotal, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, sellerId, code, input.kind, input.value, Math.max(0, input.minSubtotal), input.maxUses, input.expiresAt);
  return getDb().prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Coupon;
}

export function setCouponActive(sellerId: string, couponId: string, active: boolean) {
  getDb().prepare('UPDATE coupons SET active = ? WHERE id = ? AND seller_id = ?').run(active ? 1 : 0, couponId, sellerId);
}

export const sellerCoupons = (sellerId: string) =>
  getDb().prepare('SELECT * FROM coupons WHERE seller_id = ? ORDER BY created_at DESC').all(sellerId) as Coupon[];
