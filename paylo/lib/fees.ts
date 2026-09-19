import { getSetting } from './db';

export interface FeeBreakdown { rate: number; fixed: number; commission: number; vat: number; sellerNet: number }

/**
 * Commission = percentage of the item subtotal + a fixed fee, with VAT applied to the
 * commission itself (Functional Spec §2.4). The buyer's delivery fee is not part of the
 * seller's subtotal — Paylo collects it and pays the courier — so it never earns commission.
 *
 * Rates stay admin-configurable and are frozen onto each order, because v2 §3 blocks
 * finalising a fee model until the settlement partner is known.
 *
 * Server-only: reads platform settings, so never import this from a client component.
 */
export function computeFees(subtotal: number, rate?: number, fixed?: number, vatRate?: number): FeeBreakdown {
  const r = rate ?? (parseFloat(getSetting('commission_rate')) || 0);
  const f = fixed ?? (parseInt(getSetting('commission_fixed_fee'), 10) || 0);
  const v = vatRate ?? (parseFloat(getSetting('commission_vat_rate')) || 0);
  const commission = Math.round((subtotal * r) / 100) + f;
  const vat = Math.round((commission * v) / 100);
  return { rate: r, fixed: f, commission, vat, sellerNet: subtotal - commission - vat };
}
