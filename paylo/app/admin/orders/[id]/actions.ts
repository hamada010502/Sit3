'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/guards';
import { adminSetDelivered, adminSetFulfillment, adminSetInTransit, adminSetReadyForPickup, getOrder, OrderError, refundOrder } from '@/lib/orders';
import type { FulfillmentMethod } from '@/lib/types';

async function run(orderId: string, fn: () => Promise<void> | void) {
  requireAdmin();
  try { await fn(); } catch (e) { if (!(e instanceof OrderError)) throw e; }
  revalidatePath(`/admin/orders/${orderId}`);
}
export async function setFulfillmentAction(orderId: string, method: FulfillmentMethod, formData: FormData) {
  await run(orderId, () => { const o = getOrder(orderId); if (o) adminSetFulfillment(o, method, String(formData.get('ref') || '').trim() || null); });
}
export async function setInTransitAction(orderId: string, formData: FormData) {
  await run(orderId, async () => { const o = getOrder(orderId); if (o) await adminSetInTransit(o, String(formData.get('ref') || '').trim() || null); });
}
export async function setReadyAction(orderId: string, formData: FormData) {
  await run(orderId, async () => { const o = getOrder(orderId); if (o) await adminSetReadyForPickup(o, String(formData.get('pickup_location') || '').trim()); });
}
export async function setDeliveredAction(orderId: string, formData: FormData) {
  await run(orderId, async () => { const o = getOrder(orderId); if (o) await adminSetDelivered(o, String(formData.get('note') || '').trim() || null); });
}
export async function refundAction(orderId: string, formData: FormData) {
  await run(orderId, async () => { const o = getOrder(orderId); if (o) await refundOrder(o, 'admin', String(formData.get('note') || '').trim() || 'Refunded by admin'); });
}
