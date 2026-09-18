'use server';
import { revalidatePath } from 'next/cache';
import { requireApprovedSeller } from '@/lib/guards';
import { getOrder, OrderError, sellerHandOff } from '@/lib/orders';

export async function handOffAction(orderId: string, formData: FormData) {
  const { seller } = requireApprovedSeller();
  const order = getOrder(orderId);
  if (!order) return;
  try { await sellerHandOff(order, seller.id, String(formData.get('ref') || '').trim()); }
  catch (e) { if (!(e instanceof OrderError)) throw e; }
  revalidatePath(`/seller/orders/${orderId}`);
}
