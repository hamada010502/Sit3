'use server';
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { createCoupon, CouponError, setCouponActive } from '@/lib/coupons';
import { requireApprovedSeller } from '@/lib/guards';

export interface CouponFormState { error?: string; ok?: boolean }

export async function createCouponAction(_prev: CouponFormState | null, formData: FormData): Promise<CouponFormState> {
  const { user, seller } = requireApprovedSeller();
  const num = (k: string) => { const v = String(formData.get(k) || '').replace(/[^0-9]/g, ''); return v ? parseInt(v, 10) : null; };
  const expires = String(formData.get('expires_at') || '').trim();
  try {
    const c = createCoupon(seller.id, {
      code: String(formData.get('code') || ''),
      kind: formData.get('kind') === 'fixed' ? 'fixed' : 'percent',
      value: num('value') ?? 0,
      minSubtotal: num('min_subtotal') ?? 0,
      maxUses: num('max_uses'),
      // A date input gives YYYY-MM-DD; the code stays valid through the end of that day (UTC).
      expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(expires) ? `${expires} 23:59:59` : null,
    });
    audit('seller', user.id, seller.store_name, 'coupon', c.id, 'created', { code: c.code, kind: c.kind, value: c.value });
  } catch (e) {
    if (e instanceof CouponError) return { error: e.message };
    throw e;
  }
  revalidatePath('/seller/coupons');
  return { ok: true };
}

export async function toggleCouponAction(couponId: string, active: boolean) {
  const { user, seller } = requireApprovedSeller();
  setCouponActive(seller.id, couponId, active);
  audit('seller', user.id, seller.store_name, 'coupon', couponId, active ? 'activated' : 'deactivated');
  revalidatePath('/seller/coupons');
}
