'use server';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/guards';
import { confirmOrderClaim, requestOrderClaim, CustomerError } from '@/lib/customer';

export interface ClaimState { error?: string; ok?: boolean; codeSent?: boolean; code?: string; contact?: string }

export async function requestClaimAction(_prev: ClaimState | null, formData: FormData): Promise<ClaimState> {
  const user = requireCustomer();
  const code = String(formData.get('code') || '').trim();
  const contact = String(formData.get('contact') || '').trim();
  if (!code || !contact) return { error: 'apply_error_generic' };
  // Always the same "a code was sent" response, whether the order/contact actually
  // matched or not (lib/customer.ts only sends the email/SMS on a real match) — this is
  // the same anti-enumeration principle as the registration duplicate-check message:
  // never let the response itself confirm which case it was.
  try {
    await requestOrderClaim(user.id, code, contact);
  } catch (e) {
    if (!(e instanceof CustomerError)) throw e;
  }
  return { codeSent: true, code, contact };
}

export async function confirmClaimAction(_prev: ClaimState | null, formData: FormData): Promise<ClaimState> {
  const user = requireCustomer();
  const code = String(formData.get('code') || '').trim();
  const verifyCode = String(formData.get('verify_code') || '').trim();
  try {
    confirmOrderClaim(user.id, code, verifyCode);
  } catch (e) {
    if (e instanceof CustomerError) {
      const key = e.message === 'code_expired' ? 'account_link_order_error_expired'
        : e.message === 'too_many_attempts' ? 'account_link_order_error_attempts'
        : e.message === 'code_invalid' ? 'account_link_order_error_invalid'
        : 'account_link_order_error_cannot';
      return { error: key, codeSent: true, code };
    }
    throw e;
  }
  revalidatePath('/account');
  revalidatePath('/account/orders');
  return { ok: true };
}
