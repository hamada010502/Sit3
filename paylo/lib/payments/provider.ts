/**
 * Payment provider abstraction.
 *
 * The production acquiring rail (QNB Syria / Mastercard) is not contracted yet, so the
 * checkout and payment-status handling talk ONLY to this interface. Swapping the real
 * PSP in means adding one adapter file and setting PAYMENT_PROVIDER — no changes to
 * checkout, orders or the admin panel.
 */
export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  holder: string;
}

export interface ChargeRequest {
  orderId: string;
  orderCode: string;
  amount: number;      // integer SYP
  currency: 'SYP';
  card: CardInput;
  description: string;
}

export interface ChargeResult {
  ok: boolean;
  providerRef?: string;
  cardLast4?: string;
  cardBrand?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface RefundRequest {
  providerRef: string;
  amount: number;
  reason: string;
}
export interface RefundResult { ok: boolean; providerRef?: string; failureReason?: string; raw?: unknown }

export interface PaymentProvider {
  readonly name: string;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
}
