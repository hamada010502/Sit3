import type { TFn } from '@/lib/i18n';
import type { DisputeStatus, KycStatus, OrderState, OrderStatus, PaymentStatus, ProductStatus, SellerStatus } from '@/lib/types';

const ORDER_COLORS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-warn/12 text-warn', payment_failed: 'bg-danger/10 text-danger', confirmed: 'bg-rose-100 text-rose-700',
  handed_off: 'bg-tide/12 text-tide', in_transit: 'bg-tide/12 text-tide', ready_for_pickup: 'bg-tide/12 text-tide',
  delivered: 'bg-success/12 text-success', disputed: 'bg-danger/12 text-danger',
  refunded: 'bg-ink/10 text-ink-soft', cancelled: 'bg-ink/10 text-ink-soft',
};
export function OrderStatusBadge({ status, t }: { status: OrderStatus; t: TFn }) {
  return <span className={`badge ${ORDER_COLORS[status]}`}>{t(`st_${status}` as const)}</span>;
}

const STATE_COLORS: Record<OrderState, string> = {
  open: 'bg-warn/12 text-warn', closed: 'bg-success/12 text-success',
  cancelled: 'bg-ink/10 text-ink-soft', returned: 'bg-danger/12 text-danger',
};
export function OrderStateBadge({ state, t }: { state: OrderState; t: TFn }) {
  return <span className={`badge ${STATE_COLORS[state]}`}>{t(`os_${state}` as const)}</span>;
}

const PAY_COLORS: Record<PaymentStatus, string> = {
  pending: 'bg-warn/12 text-warn', confirmed: 'bg-success/12 text-success', collected_cod: 'bg-success/12 text-success',
  failed: 'bg-danger/10 text-danger', refunded: 'bg-ink/10 text-ink-soft',
};
export function PaymentStatusBadge({ status, t }: { status: PaymentStatus; t: TFn }) {
  return <span className={`badge ${PAY_COLORS[status]}`}>{t(`ps_${status}` as const)}</span>;
}

const SELLER_COLORS: Record<SellerStatus, string> = {
  pending: 'bg-warn/12 text-warn', approved: 'bg-success/12 text-success', rejected: 'bg-danger/10 text-danger', suspended: 'bg-ink/10 text-ink-soft',
};
export function SellerStatusBadge({ status, t }: { status: SellerStatus; t: TFn }) {
  return <span className={`badge ${SELLER_COLORS[status]}`}>{t(`st_seller_${status}` as const)}</span>;
}

const KYC_COLORS: Record<KycStatus, string> = {
  not_started: 'bg-ink/10 text-ink-soft', submitted: 'bg-warn/12 text-warn', approved: 'bg-success/12 text-success', rejected: 'bg-danger/10 text-danger',
};
export function KycBadge({ status, t }: { status: KycStatus; t: TFn }) {
  return <span className={`badge ${KYC_COLORS[status]}`}>{t(`kyc_${status}` as const)}</span>;
}

const DISPUTE_COLORS: Record<DisputeStatus, string> = {
  open: 'bg-danger/12 text-danger', investigating: 'bg-warn/12 text-warn', resolved_refund: 'bg-success/12 text-success',
  resolved_found: 'bg-success/12 text-success', resolved_dismissed: 'bg-ink/10 text-ink-soft',
};
export function DisputeStatusBadge({ status, t }: { status: DisputeStatus; t: TFn }) {
  return <span className={`badge ${DISPUTE_COLORS[status]}`}>{t(`ds_${status}` as const)}</span>;
}

const PRODUCT_COLORS: Record<ProductStatus, string> = {
  active: 'bg-success/12 text-success', inactive: 'bg-ink/10 text-ink-soft', out_of_stock: 'bg-warn/12 text-warn', removed: 'bg-danger/10 text-danger',
};
export function ProductStatusBadge({ status, t }: { status: ProductStatus; t: TFn }) {
  return <span className={`badge ${PRODUCT_COLORS[status]}`}>{t(`product_${status}` as const)}</span>;
}
