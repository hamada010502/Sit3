'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/guards';
import {
  adminSetDelivered, adminSetFulfillment, adminSetInTransit, adminSetReadyForPickup, cancelOrder,
  getOrder, markCodCollected, OrderError, refundOrder, reviewAddressChange, reviewTransfer,
} from '@/lib/orders';
import type { FulfillmentMethod } from '@/lib/types';

async function run(orderId: string, fn: (o: import('@/lib/types').Order) => Promise<void> | void): Promise<void> {
  requireAdmin();
  const o = getOrder(orderId);
  if (!o) return;
  try { await fn(o); } catch (e) { if (!(e instanceof OrderError)) throw e; }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/ops');
}

export async function setFulfillmentAction(orderId: string, method: FulfillmentMethod, formData: FormData) {
  await run(orderId, (o) => adminSetFulfillment(o, method, String(formData.get('ref') || '').trim() || null));
}
export async function setInTransitAction(orderId: string, formData: FormData) {
  await run(orderId, (o) => adminSetInTransit(o, String(formData.get('ref') || '').trim() || null));
}
export async function setReadyAction(orderId: string, formData: FormData) {
  await run(orderId, (o) => adminSetReadyForPickup(o, String(formData.get('pickup_location') || '').trim()));
}
export async function setDeliveredAction(orderId: string, formData: FormData) {
  await run(orderId, (o) => adminSetDelivered(o, String(formData.get('note') || '').trim() || null));
}
export async function refundAction(orderId: string, formData: FormData) {
  await run(orderId, (o) => refundOrder(o, 'admin', String(formData.get('note') || '').trim() || 'Refunded by admin'));
}
export async function cancelAction(orderId: string, formData: FormData) {
  await run(orderId, (o) => cancelOrder(o, 'admin', String(formData.get('note') || '').trim() || 'Cancelled by admin'));
}
export async function codCollectedAction(orderId: string, formData: FormData) {
  await run(orderId, (o) => { markCodCollected(o, String(formData.get('note') || '').trim() || null); });
}
export async function reviewTransferAction(orderId: string, approve: boolean, formData: FormData) {
  await run(orderId, (o) => reviewTransfer(o, approve, String(formData.get('note') || '').trim() || null));
}
export async function reviewAddressAction(orderId: string, approve: boolean, formData: FormData) {
  await run(orderId, (o) => reviewAddressChange(o, approve, String(formData.get('note') || '').trim() || null));
}
