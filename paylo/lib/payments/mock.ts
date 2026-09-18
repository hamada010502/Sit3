import type { PaymentProvider, ChargeRequest, ChargeResult, RefundRequest, RefundResult } from './provider';

/**
 * Mock provider for development and demos.
 * - Any Luhn-valid card number is accepted.
 * - Numbers ending in 0002 are declined ("insufficient funds").
 * - Numbers ending in 0069 fail as "expired card".
 * Nothing leaves the process; the full PAN is never stored.
 */
function luhn(num: string) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function brandOf(num: string) {
  if (/^5[1-5]/.test(num) || /^2(2[2-9]|[3-6]|7[01]|720)/.test(num)) return 'Mastercard';
  if (/^4/.test(num)) return 'Visa';
  return 'Card';
}

export const mockProvider: PaymentProvider = {
  name: 'mock',
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const num = req.card.number.replace(/\s|-/g, '');
    await new Promise((r) => setTimeout(r, 400));
    if (!/^\d{13,19}$/.test(num) || !luhn(num)) return { ok: false, failureReason: 'invalid_card' };
    const now = new Date();
    const expOk = req.card.expYear > now.getFullYear() || (req.card.expYear === now.getFullYear() && req.card.expMonth >= now.getMonth() + 1);
    if (!expOk || num.endsWith('0069')) return { ok: false, failureReason: 'expired_card', cardLast4: num.slice(-4) };
    if (num.endsWith('0002')) return { ok: false, failureReason: 'insufficient_funds', cardLast4: num.slice(-4), cardBrand: brandOf(num) };
    return {
      ok: true,
      providerRef: 'mock_' + crypto.randomUUID().slice(0, 12),
      cardLast4: num.slice(-4),
      cardBrand: brandOf(num),
      raw: { simulated: true, amount: req.amount, currency: req.currency },
    };
  },
  async refund(req: RefundRequest): Promise<RefundResult> {
    await new Promise((r) => setTimeout(r, 200));
    return { ok: true, providerRef: 'mockrf_' + crypto.randomUUID().slice(0, 12), raw: { simulated: true, amount: req.amount } };
  },
};
