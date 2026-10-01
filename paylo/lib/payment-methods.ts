import { getSetting } from './db';
import { getPaymentProvider } from './payments';
import type { PaymentMethod } from './types';

/**
 * The single source of truth for which payment methods a buyer may use. The checkout page
 * lists exactly availablePaymentMethods(); checkout() rejects anything else server-side.
 *
 *   cod           — pay_cod_enabled, OFF by policy (transfers only) and locked in the admin
 *                   form; never for digital goods. Kept so pre-policy COD orders still work.
 *   bank_transfer — admin toggle pay_bank_transfer_enabled (default ON: it needs no bank API,
 *                   only Paylo's own account details and a manual confirm).
 *   card          — admin toggle pay_card_enabled AND PAYMENT_CARD_ENABLED=1 AND a provider
 *                   that reports itself configured (lib/payments).
 *
 * Toggles only affect new checkouts; existing orders keep the method they were placed with.
 * Sellers have no payment-method settings, so nothing can re-enable a method Paylo turned off.
 */
// Order = checkout order: bank transfer first (the default), COD last (policy-off).
export const ALL_METHODS: PaymentMethod[] = ['bank_transfer', 'card', 'cod'];

export type MethodBlock = 'admin_off' | 'env_off' | 'provider_not_configured' | 'digital';
export interface MethodStatus { method: PaymentMethod; adminOn: boolean; block: MethodBlock | null }

const on = (key: string, dflt: '0' | '1') => (getSetting(key) || dflt) === '1';

export function paymentMethodStatus(method: PaymentMethod, opts: { isDigital?: boolean } = {}): MethodStatus {
  if (method === 'cod') {
    const adminOn = on('pay_cod_enabled', '1');
    return { method, adminOn, block: !adminOn ? 'admin_off' : opts.isDigital ? 'digital' : null };
  }
  if (method === 'bank_transfer') {
    const adminOn = on('pay_bank_transfer_enabled', '1');
    return { method, adminOn, block: adminOn ? null : 'admin_off' };
  }
  const adminOn = on('pay_card_enabled', '0');
  const block: MethodBlock | null = !adminOn ? 'admin_off'
    : (process.env.PAYMENT_CARD_ENABLED || '0') !== '1' ? 'env_off'
    : !getPaymentProvider().configured ? 'provider_not_configured' : null;
  return { method, adminOn, block };
}

export function availablePaymentMethods(opts: { isDigital?: boolean } = {}): PaymentMethod[] {
  return ALL_METHODS.filter((m) => paymentMethodStatus(m, opts).block === null);
}

export const isPaymentMethodAvailable = (m: PaymentMethod, opts: { isDigital?: boolean } = {}) =>
  (ALL_METHODS as string[]).includes(m) && paymentMethodStatus(m, opts).block === null;
