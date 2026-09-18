'use server';
import { redirect } from 'next/navigation';
import { checkout } from '@/lib/orders';
import { GOVERNORATES } from '@/lib/types';

export interface CheckoutState { error?: string; fields?: Record<string, string>; failedOrderCode?: string }

export async function checkoutAction(productId: string, _prev: CheckoutState | null, formData: FormData): Promise<CheckoutState> {
  const f = (k: string) => String(formData.get(k) || '').trim();
  const fields: Record<string, string> = {};
  const buyerName = f('buyer_name'); if (buyerName.length < 2) fields.buyer_name = 'required';
  const buyerPhone = f('buyer_phone'); if (!/^\+?[0-9\s-]{8,15}$/.test(buyerPhone)) fields.buyer_phone = 'required';
  const buyerEmail = f('buyer_email'); if (buyerEmail && !buyerEmail.includes('@')) fields.buyer_email = 'required';
  const governorate = f('governorate'); if (!(GOVERNORATES as readonly string[]).includes(governorate)) fields.governorate = 'required';
  const address = f('address'); if (address.length < 5) fields.address = 'required';
  const quantity = parseInt(f('quantity'), 10) || 1;
  const cardNumber = f('card_number').replace(/\s|-/g, ''); if (!/^\d{13,19}$/.test(cardNumber)) fields.card_number = 'required';
  const holder = f('card_holder'); if (holder.length < 2) fields.card_holder = 'required';
  const exp = f('card_exp'); const m = exp.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) fields.card_exp = 'required';
  const cvc = f('card_cvc'); if (!/^\d{3,4}$/.test(cvc)) fields.card_cvc = 'required';
  if (Object.keys(fields).length) return { error: 'checkout_error', fields };

  const expMonth = parseInt(m![1], 10);
  const expYear = m![2].length === 2 ? 2000 + parseInt(m![2], 10) : parseInt(m![2], 10);
  const result = await checkout({
    productId, quantity, buyerName, buyerPhone, buyerEmail: buyerEmail || undefined, governorate, address, note: f('note') || undefined,
    card: { number: cardNumber, expMonth, expYear, cvc, holder },
  });
  if (!result.ok) return { error: result.error, failedOrderCode: result.order?.code };
  redirect(`/track/${result.order.code}?new=1`);
}
