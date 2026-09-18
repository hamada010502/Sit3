import type { PaymentProvider } from './provider';
import { mockProvider } from './mock';
import { qnbProvider } from './qnb';

export function getPaymentProvider(): PaymentProvider {
  switch ((process.env.PAYMENT_PROVIDER || 'mock').toLowerCase()) {
    case 'qnb': return qnbProvider;
    case 'mock':
    default: return mockProvider;
  }
}
export type { PaymentProvider, CardInput, ChargeResult } from './provider';
