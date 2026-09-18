import type { PaymentProvider, ChargeRequest, ChargeResult, RefundRequest, RefundResult } from './provider';

/**
 * Placeholder adapter for the QNB Syria Mastercard acquiring rail.
 * The merchant agreement / PSP contract is not finalized (see project overview, Phase 1).
 * Once the gateway spec is available, implement charge() and refund() here against
 * the bank's API and set PAYMENT_PROVIDER=qnb. No other code path changes.
 */
export const qnbProvider: PaymentProvider = {
  name: 'qnb',
  async charge(_req: ChargeRequest): Promise<ChargeResult> {
    return { ok: false, failureReason: 'provider_not_configured' };
  },
  async refund(_req: RefundRequest): Promise<RefundResult> {
    return { ok: false, failureReason: 'provider_not_configured' };
  },
};
