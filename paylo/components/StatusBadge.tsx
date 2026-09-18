import type { TFn } from '@/lib/i18n';
import type { OrderStatus, SellerStatus, DisputeStatus, ProductStatus } from '@/lib/types';

const ORDER_COLORS: Record<OrderStatus, string> = {
  pending_payment: 'bg-bluewood/10 text-bluewood', payment_failed: 'bg-blossom/10 text-blossom', paid: 'bg-tangerine/30 text-blossom',
  handed_off: 'bg-sky-100 text-sky-800', in_transit: 'bg-sky-100 text-sky-800', ready_for_pickup: 'bg-violet-100 text-violet-800',
  delivered: 'bg-emerald-100 text-emerald-800', disputed: 'bg-blossom/15 text-blossom', refunded: 'bg-bluewood/10 text-bluewood/70', cancelled: 'bg-bluewood/10 text-bluewood/70',
};
export function OrderStatusBadge({ status, t }: { status: OrderStatus; t: TFn }) {
  return <span className={`badge ${ORDER_COLORS[status]}`}>{t(`st_${status}` as const)}</span>;
}
const SELLER_COLORS: Record<SellerStatus, string> = { pending: 'bg-tangerine/30 text-blossom', approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-blossom/10 text-blossom', suspended: 'bg-bluewood/10 text-bluewood' };
export function SellerStatusBadge({ status, t }: { status: SellerStatus; t: TFn }) {
  return <span className={`badge ${SELLER_COLORS[status]}`}>{t(`st_seller_${status}` as const)}</span>;
}
const DISPUTE_COLORS: Record<DisputeStatus, string> = { open: 'bg-blossom/15 text-blossom', investigating: 'bg-tangerine/30 text-blossom', resolved_refund: 'bg-emerald-100 text-emerald-800', resolved_found: 'bg-emerald-100 text-emerald-800', resolved_dismissed: 'bg-bluewood/10 text-bluewood' };
export function DisputeStatusBadge({ status, t }: { status: DisputeStatus; t: TFn }) {
  return <span className={`badge ${DISPUTE_COLORS[status]}`}>{t(`ds_${status}` as const)}</span>;
}
const PRODUCT_COLORS: Record<ProductStatus, string> = { active: 'bg-emerald-100 text-emerald-800', inactive: 'bg-bluewood/10 text-bluewood', out_of_stock: 'bg-tangerine/30 text-blossom', removed: 'bg-blossom/10 text-blossom' };
export function ProductStatusBadge({ status, t }: { status: ProductStatus; t: TFn }) {
  return <span className={`badge ${PRODUCT_COLORS[status]}`}>{t(`product_${status}` as const)}</span>;
}
