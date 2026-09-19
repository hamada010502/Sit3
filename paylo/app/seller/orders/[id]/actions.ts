'use server';
import { revalidatePath } from 'next/cache';
import { requireApprovedSeller } from '@/lib/guards';
import { cancelOrder, getOrder, OrderError, refundOrder, sellerHandOff } from '@/lib/orders';
import { getDb, nowIso } from '@/lib/db';
import { audit } from '@/lib/audit';

async function own(orderId: string, fn: (o: import('@/lib/types').Order, sellerId: string) => Promise<void> | void) {
  const { seller } = requireApprovedSeller();
  const order = getOrder(orderId);
  if (!order || order.seller_id !== seller.id) return { error: 'not_found' };
  try { await fn(order, seller.id); } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/seller/orders/${orderId}`);
  return {};
}

export async function handOffAction(orderId: string, _prev: { error?: string } | null, formData: FormData) {
  return own(orderId, (o, sellerId) => sellerHandOff(o, sellerId, String(formData.get('ref') || '').trim(), String(formData.get('tracking') || '').trim()));
}
export async function updateTrackingAction(orderId: string, formData: FormData): Promise<void> {
  await own(orderId, (o) => {
    const tracking = String(formData.get('tracking') || '').trim() || null;
    getDb().prepare('UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?').run(tracking, nowIso(), o.id);
    audit('seller', o.seller_id, null, 'order', o.id, 'tracking.updated', tracking);
  });
}
export async function sellerCancelAction(orderId: string, formData: FormData): Promise<void> {
  await own(orderId, (o) => cancelOrder(o, 'seller', String(formData.get('reason') || '').trim() || 'Cancelled by seller'));
}
export async function sellerRefundAction(orderId: string, formData: FormData): Promise<void> {
  await own(orderId, (o) => refundOrder(o, 'seller', String(formData.get('reason') || '').trim() || 'Refunded by seller'));
}
