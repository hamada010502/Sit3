'use server';
import { isPaymentMethodAvailable } from '@/lib/payment-methods';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { checkout } from '@/lib/orders';
import { discountFor, findCoupon } from '@/lib/coupons';
import { getDb } from '@/lib/db';
import { GOVERNORATES, type PaymentMethod } from '@/lib/types';

export interface CheckoutState { error?: string; fields?: Record<string, string> }

export async function checkoutAction(productId: string, _prev: CheckoutState | null, formData: FormData): Promise<CheckoutState> {
  const f = (k: string) => String(formData.get(k) || '').trim();
  const fields: Record<string, string> = {};

  const buyerName = f('buyer_name'); if (buyerName.length < 2) fields.buyer_name = 'required';
  const buyerPhone = f('buyer_phone'); if (!/^\+?[0-9\s-]{8,15}$/.test(buyerPhone)) fields.buyer_phone = 'required';
  const buyerEmail = f('buyer_email'); if (buyerEmail && !buyerEmail.includes('@')) fields.buyer_email = 'required';
  const governorate = f('governorate'); if (!(GOVERNORATES as readonly string[]).includes(governorate)) fields.governorate = 'required';
  const address = f('address'); if (address.length < 5) fields.address = 'required';
  const quantity = parseInt(f('quantity'), 10) || 1;
  const variantId = f('variant_id') || null;
  const paymentMethod = f('payment_method') as PaymentMethod;
  if (!['cod', 'bank_transfer', 'card'].includes(paymentMethod)) fields.payment_method = 'required';
  // A method Paylo has switched off is refused before anything else (checkout() checks again).
  const pType = (getDb().prepare('SELECT type FROM products WHERE id = ?').get(productId) as { type: string } | undefined)?.type;
  if (!fields.payment_method && !isPaymentMethodAvailable(paymentMethod, { isDigital: pType === 'digital' })) return { error: 'payment_method_unavailable' };

  let card;
  if (paymentMethod === 'card') {
    const number = f('card_number').replace(/\s|-/g, ''); if (!/^\d{13,19}$/.test(number)) fields.card_number = 'required';
    const holder = f('card_holder'); if (holder.length < 2) fields.card_holder = 'required';
    const m = f('card_exp').match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/); if (!m) fields.card_exp = 'required';
    const cvc = f('card_cvc'); if (!/^\d{3,4}$/.test(cvc)) fields.card_cvc = 'required';
    if (m) card = { number, holder, cvc, expMonth: parseInt(m[1], 10), expYear: m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10) };
  }
  if (Object.keys(fields).length) return { error: 'checkout_error', fields };

  // Optional: if a customer account is signed in, the order is linked to it. Guests
  // (the common case — checkout never requires this) simply have no user here.
  const user = getCurrentUser();
  const userId = user && user.role === 'customer' ? user.id : null;

  const result = await checkout({
    productId, variantId, quantity, buyerName, buyerPhone, buyerEmail: buyerEmail || undefined,
    governorate, address, note: f('note') || undefined, paymentMethod, card, userId,
    couponCode: f('coupon_code') || null,
  });
  if (!result.ok) return { error: result.error };
  redirect(`/track/${result.order.code}?new=1`);
}

/** Checkout preview only — the real check (and use claim) happens again inside checkout(). */
export async function previewCouponAction(productId: string, code: string, variantId: string | null, qty: number): Promise<{ discount?: number; code?: string; error?: string }> {
  const db = getDb();
  const product = db.prepare('SELECT id, seller_id, price FROM products WHERE id = ?').get(productId) as { id: string; seller_id: string; price: number } | undefined;
  if (!product || !code.trim()) return { error: 'coupon_invalid' };
  const variant = variantId ? db.prepare('SELECT price FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, productId) as { price: number } | undefined : undefined;
  const coupon = findCoupon(product.seller_id, code);
  const d = discountFor(coupon, (variant?.price ?? product.price) * Math.max(1, Math.floor(qty)));
  return 'error' in d ? { error: d.error } : { discount: d.discount, code: coupon!.code };
}
