import type { TFn } from '@/lib/i18n';
import type { DisputeStatus, KycStatus, OrderState, OrderStatus, PaymentStatus, ProductStatus, RegistrationStatus, SellerStatus } from '@/lib/types';

const ORDER_COLORS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-warn/12 text-warn', payment_failed: 'bg-cherry/8 text-cherry', confirmed: 'bg-cherry/12 text-cherry-dark',
  handed_off: 'bg-ink/8 text-ink', in_transit: 'bg-ink/8 text-ink', ready_for_pickup: 'bg-ink/8 text-ink',
  delivered: 'bg-success/12 text-success', disputed: 'bg-cherry/12 text-cherry',
  refunded: 'bg-ink/10 text-ink-soft', cancelled: 'bg-ink/10 text-ink-soft',
};
export function OrderStatusBadge({ status, t }: { status: OrderStatus; t: TFn }) {
  return <span className={`badge ${ORDER_COLORS[status]}`}>{t(`st_${status}` as const)}</span>;
}

const STATE_COLORS: Record<OrderState, string> = {
  open: 'bg-warn/12 text-warn', closed: 'bg-success/12 text-success',
  cancelled: 'bg-ink/10 text-ink-soft', returned: 'bg-cherry/12 text-cherry',
};
export function OrderStateBadge({ state, t }: { state: OrderState; t: TFn }) {
  return <span className={`badge ${STATE_COLORS[state]}`}>{t(`os_${state}` as const)}</span>;
}

const PAY_COLORS: Record<PaymentStatus, string> = {
  pending: 'bg-warn/12 text-warn', confirmed: 'bg-success/12 text-success', collected_cod: 'bg-success/12 text-success',
  failed: 'bg-cherry/8 text-cherry', refunded: 'bg-ink/10 text-ink-soft',
};
export function PaymentStatusBadge({ status, t }: { status: PaymentStatus; t: TFn }) {
  return <span className={`badge ${PAY_COLORS[status]}`}>{t(`ps_${status}` as const)}</span>;
}

const SELLER_COLORS: Record<SellerStatus, string> = {
  pending: 'bg-warn/12 text-warn', approved: 'bg-success/12 text-success', rejected: 'bg-cherry/8 text-cherry', suspended: 'bg-ink/10 text-ink-soft',
};
export function SellerStatusBadge({ status, t }: { status: SellerStatus; t: TFn }) {
  return <span className={`badge ${SELLER_COLORS[status]}`}>{t(`st_seller_${status}` as const)}</span>;
}

const KYC_COLORS: Record<KycStatus, string> = {
  not_started: 'bg-ink/10 text-ink-soft', submitted: 'bg-warn/12 text-warn', approved: 'bg-success/12 text-success', rejected: 'bg-cherry/8 text-cherry',
};
export function KycBadge({ status, t }: { status: KycStatus; t: TFn }) {
  return <span className={`badge ${KYC_COLORS[status]}`}>{t(`kyc_${status}` as const)}</span>;
}

const DISPUTE_COLORS: Record<DisputeStatus, string> = {
  open: 'bg-cherry/12 text-cherry', investigating: 'bg-warn/12 text-warn', resolved_refund: 'bg-success/12 text-success',
  resolved_found: 'bg-success/12 text-success', resolved_dismissed: 'bg-ink/10 text-ink-soft',
};
export function DisputeStatusBadge({ status, t }: { status: DisputeStatus; t: TFn }) {
  return <span className={`badge ${DISPUTE_COLORS[status]}`}>{t(`ds_${status}` as const)}</span>;
}

const PRODUCT_COLORS: Record<ProductStatus, string> = {
  active: 'bg-success/12 text-success', inactive: 'bg-ink/10 text-ink-soft', out_of_stock: 'bg-warn/12 text-warn', removed: 'bg-cherry/8 text-cherry',
};
export function ProductStatusBadge({ status, t }: { status: ProductStatus; t: TFn }) {
  return <span className={`badge ${PRODUCT_COLORS[status]}`}>{t(`product_${status}` as const)}</span>;
}

const REG_COLORS: Record<RegistrationStatus, string> = {
  PENDING_REVIEW: 'bg-warn/12 text-warn', MORE_INFORMATION_REQUIRED: 'bg-warn/12 text-warn',
  APPROVED: 'bg-success/12 text-success', REJECTED: 'bg-cherry/12 text-cherry',
};
const REG_LABEL: Record<RegistrationStatus, string> = {
  PENDING_REVIEW: 'Pending review', MORE_INFORMATION_REQUIRED: 'More info requested', APPROVED: 'Approved', REJECTED: 'Rejected',
};
export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  return <span className={`badge ${REG_COLORS[status]}`}>{REG_LABEL[status]}</span>;
}
