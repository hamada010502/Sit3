'use server';
import { redirect } from 'next/navigation';
import { checkout } from '@/lib/orders';
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

  let card;
  if (paymentMethod === 'card') {
    const number = f('card_number').replace(/\s|-/g, ''); if (!/^\d{13,19}$/.test(number)) fields.card_number = 'required';
    const holder = f('card_holder'); if (holder.length < 2) fields.card_holder = 'required';
    const m = f('card_exp').match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/); if (!m) fields.card_exp = 'required';
    const cvc = f('card_cvc'); if (!/^\d{3,4}$/.test(cvc)) fields.card_cvc = 'required';
    if (m) card = { number, holder, cvc, expMonth: parseInt(m[1], 10), expYear: m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10) };
  }
  if (Object.keys(fields).length) return { error: 'checkout_error', fields };

  const result = await checkout({
    productId, variantId, quantity, buyerName, buyerPhone, buyerEmail: buyerEmail || undefined,
    governorate, address, note: f('note') || undefined, paymentMethod, card,
  });
  if (!result.ok) return { error: result.error };
  redirect(`/track/${result.order.code}?new=1`);
}
